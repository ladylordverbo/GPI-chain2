import { createClient } from '@supabase/supabase-js';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import session from 'express-session';
import type { Express, RequestHandler } from 'express';
import { storage } from './storage';
import connectPg from 'connect-pg-simple';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required.");
  }
  
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET environment variable is required.");
  }
  
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  return session({
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: sessionTtl,
    },
  });
}

interface PendingRegistration {
  email: string;
  inviteToken?: string;
  invitedByUserId?: string;
  isFirstUser: boolean;
}

async function checkUserRegistration(email: string, inviteToken?: string): Promise<{ user: any, pending?: PendingRegistration, error?: string }> {
  const userCount = await storage.getUserCount();
  const isFirstUser = userCount === 0;

  // Check if user already exists by email
  const existingUser = await storage.getUserByEmail(email);
  
  if (existingUser) {
    return { user: existingUser };
  }

  // New user registration - require invite unless first user
  if (!isFirstUser && !inviteToken) {
    return { user: null, error: "Invite token required for registration" };
  }

  // Validate invite link for new users (not first user)
  let invitedByUserId: string | undefined;
  if (inviteToken && !isFirstUser) {
    const inviteLink = await storage.getInviteLinkByToken(inviteToken);
    if (!inviteLink) {
      return { user: null, error: "Invalid invite token" };
    }
    if (inviteLink.status !== "active") {
      return { user: null, error: "Invite link has expired or been used" };
    }
    if (inviteLink.maxUses && inviteLink.usesCount >= inviteLink.maxUses) {
      return { user: null, error: "Invite link has reached maximum uses" };
    }
    invitedByUserId = inviteLink.invitedByUserId;
  }

  return {
    user: null,
    pending: {
      email,
      inviteToken,
      invitedByUserId,
      isFirstUser,
    }
  };
}

export async function completeRegistration(pendingReg: PendingRegistration, username: string, password?: string, supabaseUserId?: string): Promise<{ user: any, error?: string }> {
  // Validate username
  const normalizedUsername = username.toLowerCase().trim();
  if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
    return { user: null, error: "Username must be 3-30 characters" };
  }
  if (!/^[a-z0-9_]+$/.test(normalizedUsername)) {
    return { user: null, error: "Username can only contain letters, numbers, and underscores" };
  }
  
  // Check username availability
  const isAvailable = await storage.isUsernameAvailable(normalizedUsername);
  if (!isAvailable) {
    return { user: null, error: "Username is already taken" };
  }

  let userId: string;

  // If we have a Supabase user ID from OAuth, use it
  if (supabaseUserId) {
    userId = supabaseUserId;
  } else {
    // Otherwise, create new user in Supabase Auth (email/password)
    const userPassword = password || crypto.randomBytes(16).toString('hex');
    
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: pendingReg.email,
      password: userPassword,
    });

    if (authError || !authData.user) {
      return { user: null, error: authError?.message || "Failed to create user" };
    }

    userId = authData.user.id;
  }

  // Create user in your database
  const user = await storage.upsertUser({
    id: userId,
    username: normalizedUsername,
    email: pendingReg.email,
    level: pendingReg.isFirstUser ? 5 : 1,
    invitedByUserId: pendingReg.invitedByUserId,
    agreementAcceptedAt: new Date(),
    agreementVersion: 1,
  });

  // Mark invite link as used if applicable
  if (pendingReg.inviteToken && pendingReg.invitedByUserId) {
    try {
      await storage.useInviteLink(pendingReg.inviteToken, user.id);
    } catch (e) {
      console.error("Failed to mark invite as used:", e);
    }
  }

  return { user };
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Local strategy for email/password
  passport.use(new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error || !data.user) {
          return done(null, false, { message: error?.message || 'Invalid credentials' });
        }

        // Get user from your database
        const dbUser = await storage.getUser(data.user.id);
        if (!dbUser) {
          return done(null, false, { message: 'User not found in database' });
        }

        return done(null, { ...dbUser, id: data.user.id, email: data.user.email });
      } catch (err) {
        return done(err);
      }
    }
  ));

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  // OAuth login route (GET) - redirects to Supabase OAuth
  app.get("/api/login", async (req, res) => {
    const inviteToken = req.query.invite as string;
    if (inviteToken) {
      (req.session as any).inviteToken = inviteToken;
    }
    
    // Redirect to Supabase OAuth (Google)
    // Use client-side callback page to handle URL fragments
    const redirectUrl = `${req.protocol}://${req.get('host')}/callback.html`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) {
      return res.redirect(`/?error=${encodeURIComponent(error.message)}`);
    }

    if (data?.url) {
      return res.redirect(data.url);
    }

    return res.redirect('/?error=OAuth initialization failed');
  });

  // Handle token-based callback (from client-side callback page)
  app.post("/api/callback-token", async (req, res) => {
    console.log('[CALLBACK-TOKEN] ===== Request received =====');
    console.log('[CALLBACK-TOKEN] Body:', JSON.stringify({ ...req.body, access_token: req.body.access_token ? '[REDACTED]' : undefined }));
    console.log('[CALLBACK-TOKEN] Headers:', {
      'content-type': req.headers['content-type'],
      'origin': req.headers.origin,
      'referer': req.headers.referer,
    });
    console.log('[CALLBACK-TOKEN] Session ID:', req.sessionID);
    console.log('[CALLBACK-TOKEN] Cookie settings:', {
      secure: req.secure,
      protocol: req.protocol,
      host: req.get('host'),
      hasCookie: !!req.headers.cookie,
    });

    const { access_token } = req.body;

    if (!access_token) {
      console.log('[CALLBACK-TOKEN] ERROR: No access token provided');
      return res.status(400).json({ error: 'No access token provided' });
    }

    try {
      // Set the session using the access token
      console.log('[CALLBACK-TOKEN] Setting Supabase session...');
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token,
        refresh_token: req.body.refresh_token || '',
      });

      console.log('[CALLBACK-TOKEN] Supabase session error:', sessionError);
      console.log('[CALLBACK-TOKEN] Supabase user:', sessionData?.user ? {
        id: sessionData.user.id,
        email: sessionData.user.email,
        hasEmail: !!sessionData.user.email,
      } : 'null');

      if (sessionError || !sessionData.user) {
        console.log('[CALLBACK-TOKEN] ERROR: Supabase session failed');
        return res.status(400).json({ error: sessionError?.message || 'Authentication failed' });
      }

      const userEmail = sessionData.user.email;
      if (!userEmail) {
        console.log('[CALLBACK-TOKEN] ERROR: No email in user profile');
        return res.status(400).json({ error: 'No email found in user profile' });
      }

      console.log('[CALLBACK-TOKEN] User email:', userEmail);

      // Get invite token from session
      const inviteToken = (req.session as any).inviteToken;
      delete (req.session as any).inviteToken;
      console.log('[CALLBACK-TOKEN] Invite token:', inviteToken || 'none');

      // Check registration status
      console.log('[CALLBACK-TOKEN] Checking user registration...');
      const result = await checkUserRegistration(userEmail, inviteToken);
      console.log('[CALLBACK-TOKEN] Registration check result:', {
        hasUser: !!result.user,
        isPending: !!result.pending,
        error: result.error,
      });
      
      if (result.error) {
        console.log('[CALLBACK-TOKEN] ERROR: Registration check failed:', result.error);
        return res.status(400).json({ error: result.error });
      }

      if (result.pending) {
        // New user needs to choose username
        console.log('[CALLBACK-TOKEN] New user - setting up pending registration');
        (req.session as any).pendingRegistration = result.pending;
        (req.session as any).supabaseUserId = sessionData.user.id;
        (req.session as any).supabaseEmail = userEmail;
        
        // Create a temporary session so the user can complete registration
        // This allows the frontend to check for pending registration
        console.log('[CALLBACK-TOKEN] Calling req.logIn for pending user...');
        req.logIn({ 
          id: sessionData.user.id, 
          email: userEmail,
          pendingRegistration: true 
        }, (err) => {
          if (err) {
            console.error('[CALLBACK-TOKEN] ERROR: req.logIn failed:', err);
            if (!res.headersSent) {
              return res.status(500).json({ error: 'Failed to create session' });
            }
            return;
          }
          console.log('[CALLBACK-TOKEN] req.logIn successful, saving session...');
          // Explicitly save session to ensure it persists
          req.session.save((saveErr) => {
            console.log('[CALLBACK-TOKEN] Session save attempt');
            console.log('[CALLBACK-TOKEN] Save error:', saveErr);
            console.log('[CALLBACK-TOKEN] Session ID after save:', req.sessionID);
            if (saveErr) {
              console.error('[CALLBACK-TOKEN] ERROR: Session save failed:', saveErr);
              if (!res.headersSent) {
                return res.status(500).json({ error: 'Failed to save session' });
              }
              return;
            }
            console.log('[CALLBACK-TOKEN] SUCCESS: Session saved, redirecting to /?register=pending');
            if (!res.headersSent) {
              return res.json({ redirect: '/?register=pending' });
            }
          });
        });
        return;
      }

      // Existing user - get from database and log in
      console.log('[CALLBACK-TOKEN] Existing user - looking up in database...');
      const dbUser = await storage.getUserByEmail(userEmail);
      console.log('[CALLBACK-TOKEN] Database user lookup result:', dbUser ? {
        id: dbUser.id,
        email: dbUser.email,
        username: dbUser.username,
      } : 'null');
      
      if (!dbUser) {
        console.log('[CALLBACK-TOKEN] ERROR: User not found in database');
        return res.status(400).json({ error: 'User not found in database' });
      }

      // Use the database user as-is - don't try to sync IDs
      // The database user ID is the source of truth
      console.log('[CALLBACK-TOKEN] Calling req.logIn for existing user...');
      req.logIn({ ...dbUser, email: userEmail }, (err) => {
        if (err) {
          console.error('[CALLBACK-TOKEN] ERROR: req.logIn failed:', err);
          if (!res.headersSent) {
            return res.status(500).json({ error: 'Failed to create session' });
          }
          return;
        }
        console.log('[CALLBACK-TOKEN] req.logIn successful, saving session...');
        // Explicitly save session to ensure it persists
        req.session.save((saveErr) => {
          console.log('[CALLBACK-TOKEN] Session save attempt');
          console.log('[CALLBACK-TOKEN] Save error:', saveErr);
          console.log('[CALLBACK-TOKEN] Session ID after save:', req.sessionID);
          if (saveErr) {
            console.error('[CALLBACK-TOKEN] ERROR: Session save failed:', saveErr);
            if (!res.headersSent) {
              return res.status(500).json({ error: 'Failed to save session' });
            }
            return;
          }
          console.log('[CALLBACK-TOKEN] SUCCESS: Session saved, redirecting to /');
          if (!res.headersSent) {
            return res.json({ redirect: '/' });
          }
        });
      });
    } catch (err: any) {
      console.error('[CALLBACK-TOKEN] EXCEPTION:', err);
      console.error('[CALLBACK-TOKEN] Stack:', err.stack);
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message || 'Authentication failed' });
      }
    }
  });

  // OAuth callback route (for code-based flow)
  app.get("/api/callback", async (req, res, next) => {
    const { code, error } = req.query;

    if (error) {
      return res.redirect(`/?error=${encodeURIComponent(error as string)}`);
    }

    if (!code) {
      return res.redirect('/?error=No authorization code received');
    }

    try {
      // Exchange code for session
      const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code as string);

      if (sessionError || !sessionData.user) {
        return res.redirect(`/?error=${encodeURIComponent(sessionError?.message || 'Authentication failed')}`);
      }

      const userEmail = sessionData.user.email;
      if (!userEmail) {
        return res.redirect('/?error=No email found in user profile');
      }

      // Get invite token from session
      const inviteToken = (req.session as any).inviteToken;
      delete (req.session as any).inviteToken;

      // Check registration status
      const result = await checkUserRegistration(userEmail, inviteToken);
      
      if (result.error) {
        return res.redirect(`/?error=${encodeURIComponent(result.error)}`);
      }

      if (result.pending) {
        // New user needs to choose username
        (req.session as any).pendingRegistration = result.pending;
        (req.session as any).supabaseUserId = sessionData.user.id;
        (req.session as any).supabaseEmail = userEmail;
        
        // Create a temporary session so the user can complete registration
        // This allows the frontend to check for pending registration
        req.logIn({ 
          id: sessionData.user.id, 
          email: userEmail,
          pendingRegistration: true 
        }, (err) => {
          if (err) {
            return res.redirect(`/?error=${encodeURIComponent('Failed to create session')}`);
          }
          // Explicitly save session to ensure it persists
          req.session.save((saveErr) => {
            if (saveErr) {
              console.error('Error saving session:', saveErr);
              return res.redirect(`/?error=${encodeURIComponent('Failed to save session')}`);
            }
            return res.redirect('/?register=pending');
          });
        });
        return;
      }

      // Existing user - get from database and log in
      const dbUser = await storage.getUserByEmail(userEmail);
      if (!dbUser) {
        return res.redirect('/?error=User not found in database');
      }

      // Use the database user as-is - don't try to sync IDs
      // The database user ID is the source of truth
      req.logIn({ ...dbUser, email: userEmail }, (err) => {
        if (err) return next(err);
        return res.redirect('/');
      });
    } catch (err: any) {
      return res.redirect(`/?error=${encodeURIComponent(err.message || 'Authentication failed')}`);
    }
  });

  // Email/password login route (POST) - for direct login
  app.post("/api/login", (req, res, next) => {
    const inviteToken = req.body.invite as string;
    if (inviteToken) {
      (req.session as any).inviteToken = inviteToken;
    }
    
    passport.authenticate('local', async (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || 'Login failed' });
      }

      const inviteToken = (req.session as any).inviteToken;
      delete (req.session as any).inviteToken;

      const result = await checkUserRegistration(user.email, inviteToken);
      
      if (result.error) {
        return res.status(400).json({ message: result.error });
      }

      if (result.pending) {
        (req.session as any).pendingRegistration = result.pending;
        req.logIn(user, (err) => {
          if (err) return next(err);
          return res.json({ pending: true });
        });
        return;
      }

      req.logIn(user, (err) => {
        if (err) return next(err);
        return res.json({ success: true, user });
      });
    })(req, res, next);
  });

  // Note: Registration completion is handled in routes.ts
  // This allows the route to call completeRegistration with just username
  // Password will be auto-generated if not provided

  // Logout route
  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.json({ success: true });
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  return next();
};

export const requireLevel = (minLevel: number): RequestHandler => {
  return async (req, res, next) => {
    const user = req.user as any;
    if (!user?.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const dbUser = await storage.getUser(user.id);
    if (!dbUser || dbUser.level < minLevel) {
      return res.status(403).json({ message: `Level ${minLevel}+ required` });
    }

    (req as any).dbUser = dbUser;
    next();
  };
};

