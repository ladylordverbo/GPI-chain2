import { createClient } from '@supabase/supabase-js';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import session from 'express-session';
import type { Express, RequestHandler } from 'express';
import { storage } from './storage';
import connectPg from 'connect-pg-simple';
import crypto from 'crypto';
import { generateToken } from './jwtAuth';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Determine the correct SameSite value for cookies
 * For same-domain deployments, use 'lax'
 * For cross-origin, use 'none' (requires secure: true)
 */
export function getCookieSameSite(): 'lax' | 'none' {
  // If explicitly set to cross-origin, use 'none'
  // Otherwise, use 'lax' for same-domain (which is the case for Vercel deployments)
  // 'lax' allows cookies to be sent in same-site requests and top-level navigations
  return 'lax';
}

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
  
  // Detect if running behind ngrok or other HTTPS proxy
  // ngrok URLs contain 'ngrok' in the hostname
  // Also check for explicit environment variable
  const isNgrok = process.env.NGROK === 'true' || 
                  process.env.USE_SECURE_COOKIES === 'true' ||
                  process.env.VERCEL_URL?.includes('ngrok') ||
                  false; // Will be detected dynamically in middleware
  
  // Use secure cookies if in production OR behind ngrok (HTTPS proxy)
  const useSecureCookies = process.env.NODE_ENV === 'production' || isNgrok;
  
  return session({
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: useSecureCookies, // Enable for ngrok
      sameSite: getCookieSameSite(), // Use 'lax' for same-domain
      maxAge: sessionTtl,
      path: '/', // Explicitly set path to ensure cookies work across all routes
      // Don't set domain - let browser handle it for ngrok compatibility
    },
  });
}

interface PendingRegistration {
  email: string;
  inviteToken?: string;
  invitedByUserId?: string;
  isFirstUser: boolean;
}

export async function checkUserRegistration(email: string, inviteToken?: string): Promise<{ user: any, pending?: PendingRegistration, error?: string }> {
  const userCount = await storage.getUserCount();
  const isFirstOrSecondUser = userCount <= 1;

  // Check if user already exists by email
  const existingUser = await storage.getUserByEmail(email);
  
  if (existingUser) {
    return { user: existingUser };
  }

  // New user registration - require invite unless first user
  if (userCount >= 1 && !inviteToken) {
    return { user: null, error: "Invite token required for registration" };
  }

  // Validate invite link for new users (not first user)
  let invitedByUserId: string | undefined;
  if (inviteToken && userCount >= 1) {
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
      // If inviteToken exists, user is NOT first user (invites require existing users)
      // Only first user (userCount === 0) doesn't need invite
      // Second user needs invite but still gets level 5 (handled in completeRegistration)
      isFirstUser: inviteToken ? false : (userCount === 0),
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
  // Check user count at registration time (before this user is created)
  const userCount = await storage.getUserCount();
  let assignedLevel: number;

  if (pendingReg.inviteToken || pendingReg.invitedByUserId) {
    // Users with invite tokens: check if this is the second user
    if (userCount === 1) {
      // Second user gets level 5 even with invite token
      assignedLevel = 5;
    } else {
      // All other invited users get level 1
      assignedLevel = 1;
    }
  } else if (userCount === 0) {
    // First user gets level 5
    assignedLevel = 5;
  } else {
    // This shouldn't happen (should have invite token), but default to level 1
    assignedLevel = 1;
  }

  // Log inviteToken status at start of completeRegistration
  console.log(`[REGISTRATION] Starting completeRegistration:`, {
    email: pendingReg.email,
    username: normalizedUsername,
    hasInviteToken: !!pendingReg.inviteToken,
    inviteToken: pendingReg.inviteToken || 'missing',
    hasInvitedByUserId: !!pendingReg.invitedByUserId,
    invitedByUserId: pendingReg.invitedByUserId || 'missing',
  });

  // Ensure invitedByUserId is set if we have an inviteToken but missing invitedByUserId
  let finalInvitedByUserId = pendingReg.invitedByUserId;
  if (pendingReg.inviteToken && !finalInvitedByUserId) {
    console.log(`[REGISTRATION] Invite token present but invitedByUserId missing, fetching from invite link...`);
    try {
      const inviteLink = await storage.getInviteLinkByToken(pendingReg.inviteToken);
      if (inviteLink) {
        finalInvitedByUserId = inviteLink.invitedByUserId;
        console.log(`[REGISTRATION] Retrieved invitedByUserId from invite link: ${finalInvitedByUserId}`);
      } else {
        console.error(`[REGISTRATION] Invite link not found for token: ${pendingReg.inviteToken}`);
      }
    } catch (e) {
      console.error(`[REGISTRATION] Failed to fetch invite link for token ${pendingReg.inviteToken}:`, e);
    }
  }

  console.log(`[REGISTRATION] Creating user with:`, {
    email: pendingReg.email,
    username: normalizedUsername,
    level: assignedLevel,
    invitedByUserId: finalInvitedByUserId,
    inviteToken: pendingReg.inviteToken ? 'present' : 'missing',
  });

  const user = await storage.upsertUser({
    id: userId,
    username: normalizedUsername,
    email: pendingReg.email,
    level: assignedLevel,
    invitedByUserId: finalInvitedByUserId,
    agreementAcceptedAt: new Date(),
    agreementVersion: 1,
  });

  console.log(`[REGISTRATION] User created:`, {
    id: user.id,
    username: user.username,
    level: user.level,
    invitedByUserId: user.invitedByUserId,
  });

  // Mark invite link as used if applicable
  if (pendingReg.inviteToken) {
    try {
      const updatedLink = await storage.useInviteLink(pendingReg.inviteToken, user.id);
      console.log(`[REGISTRATION] Successfully marked invite link as used:`, {
        token: pendingReg.inviteToken,
        usesCount: updatedLink.usesCount,
        status: updatedLink.status,
        usedByUserId: updatedLink.usedByUserId,
        invitedByUserId: updatedLink.invitedByUserId,
      });
      
      // Ensure user's invited_by_user_id is set if it's NULL
      // This fixes cases where the field wasn't set during user creation
      if (!user.invitedByUserId && updatedLink.invitedByUserId) {
        console.log(`[REGISTRATION] Updating user's invited_by_user_id from invite link:`, {
          userId: user.id,
          invitedByUserId: updatedLink.invitedByUserId,
        });
        // Update the user's invited_by_user_id
        const updatedUser = await storage.upsertUser({
          id: user.id,
          invitedByUserId: updatedLink.invitedByUserId,
        });
        // Update the returned user object
        user.invitedByUserId = updatedUser.invitedByUserId;
        console.log(`[REGISTRATION] User's invited_by_user_id updated successfully`);
      }
    } catch (e) {
      // Log error with more context
      console.error("[REGISTRATION] Failed to mark invite as used:", {
        inviteToken: pendingReg.inviteToken,
        userId: user.id,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
      // Note: We don't fail registration here to avoid blocking users, but this should be rare
      // The useInviteLink function will throw if the link is already used or invalid
    }
  }

  return { user };
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  
  // Detect ngrok from request headers and adjust cookie settings
  // This must run before getSession() middleware
  app.use((req, res, next) => {
    const host = req.get('host') || '';
    const forwardedHost = req.headers['x-forwarded-host']?.toString() || '';
    const isNgrok = host.includes('ngrok') || forwardedHost.includes('ngrok');
    
    if (isNgrok) {
      (req as any).isNgrok = true;
      // Only log once per session to reduce noise
      if (!req.session || !(req.session as any).ngrokLogged) {
        console.log('[Auth] Detected ngrok proxy:', { host, forwardedHost });
        if (req.session) {
          (req.session as any).ngrokLogged = true;
        }
      }
    }
    
    next();
  });
  
  app.use(getSession());
  
  // After session middleware, force secure cookies for ngrok if detected
  app.use((req, res, next) => {
    if ((req as any).isNgrok && req.session && req.session.cookie) {
      // Only log if we're actually changing something
      if (!req.session.cookie.secure) {
        req.session.cookie.secure = true;
        console.log('[Auth] Forced secure cookies for ngrok request');
      }
    }
    next();
  });
  
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
    
    // Get the correct redirect URL for production
    // On Vercel, use the host header which includes the correct domain
    let redirectUrl: string;
    const host = req.get('host');
    const protocol = req.protocol || 'https';
    
    if (process.env.VERCEL_URL) {
      // Use VERCEL_URL if available (preview deployments)
      redirectUrl = `https://${process.env.VERCEL_URL}/callback.html`;
    } else if (host) {
      // Use the host from request headers (production/main domain)
      redirectUrl = `${protocol}://${host}/callback.html`;
    } else {
      // Fallback for development
      redirectUrl = 'http://localhost:5000/callback.html';
    }
    
    console.log('[LOGIN] OAuth redirect URL:', redirectUrl, {
      host,
      protocol,
      vercelUrl: process.env.VERCEL_URL,
      headers: {
        host: req.headers.host,
        'x-forwarded-host': req.headers['x-forwarded-host'],
        'x-forwarded-proto': req.headers['x-forwarded-proto'],
      }
    });
    
    // Redirect to Supabase OAuth (Google)
    // Use client-side callback page to handle URL fragments
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
      console.error('[LOGIN] OAuth error:', error);
      return res.redirect(`/?error=${encodeURIComponent(error.message)}`);
    }

    if (data?.url) {
      console.log('[LOGIN] Redirecting to OAuth provider');
      return res.redirect(data.url);
    }

    console.error('[LOGIN] OAuth initialization failed - no URL returned');
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
        // Ensure inviteToken is preserved from result.pending
        // result.pending should already have inviteToken from checkUserRegistration
        (req.session as any).pendingRegistration = {
          ...result.pending,
          inviteToken: result.pending.inviteToken || inviteToken, // Preserve from checkUserRegistration or fallback
        };
        (req.session as any).supabaseUserId = sessionData.user.id;
        (req.session as any).supabaseEmail = userEmail;
        // Also store userId for consistency
        (req.session as any).userId = sessionData.user.id;
        
        // Log what we're storing
        console.log('[CALLBACK-TOKEN] Stored pending registration:', {
          email: (req.session as any).pendingRegistration.email,
          hasInviteToken: !!(req.session as any).pendingRegistration.inviteToken,
          inviteToken: (req.session as any).pendingRegistration.inviteToken || 'none',
          invitedByUserId: (req.session as any).pendingRegistration.invitedByUserId || 'none',
        });
        
        // Log session data before logIn
        console.log('[CALLBACK-TOKEN] Session data before logIn:', {
          hasPendingReg: !!(req.session as any).pendingRegistration,
          pendingRegInviteToken: (req.session as any).pendingRegistration?.inviteToken || 'none',
          supabaseUserId: (req.session as any).supabaseUserId,
          userId: (req.session as any).userId,
        });
        
        // Create a temporary session so the user can complete registration
        // This allows the frontend to check for pending registration
        console.log('[CALLBACK-TOKEN] Calling req.logIn for pending user...');
        req.logIn({ 
          id: sessionData.user.id, 
          email: userEmail,
          pendingRegistration: {
            ...result.pending,
            inviteToken: result.pending.inviteToken || inviteToken,
          }
        }, (err) => {
          if (err) {
            console.error('[CALLBACK-TOKEN] ERROR: req.logIn failed:', err);
            if (!res.headersSent) {
              return res.status(500).json({ error: 'Failed to create session' });
            }
            return;
          }
          // After logIn, verify session data is still there
          console.log('[CALLBACK-TOKEN] Session data after logIn (before save):', {
            hasPendingReg: !!(req.session as any).pendingRegistration,
            pendingRegInviteToken: (req.session as any).pendingRegistration?.inviteToken || 'none',
            supabaseUserId: (req.session as any).supabaseUserId,
            userId: (req.session as any).userId,
          });
          
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
            
            // After save, verify data persisted
            console.log('[CALLBACK-TOKEN] Session data after save:', {
              sessionID: req.sessionID,
              hasPendingReg: !!(req.session as any).pendingRegistration,
              pendingRegInviteToken: (req.session as any).pendingRegistration?.inviteToken || 'none',
              hasSupabaseUserId: !!(req.session as any).supabaseUserId,
              supabaseUserId: (req.session as any).supabaseUserId,
              hasUserId: !!(req.session as any).userId,
              userId: (req.session as any).userId,
            });
            
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
      // Store userId in session as backup
      (req.session as any).userId = dbUser.id;
      if ((req.session as any).supabaseUserId !== dbUser.id) {
        (req.session as any).supabaseUserId = dbUser.id;
      }
      
      req.logIn({ ...dbUser, email: userEmail, id: dbUser.id }, (err) => {
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
          
          // Verify what was saved
          console.log('[CALLBACK-TOKEN] Session data after save (existing user):', {
            sessionID: req.sessionID,
            hasSupabaseUserId: !!(req.session as any).supabaseUserId,
            supabaseUserId: (req.session as any).supabaseUserId,
            hasUserId: !!(req.session as any).userId,
            userId: (req.session as any).userId,
          });
          
          console.log('[CALLBACK-TOKEN] SUCCESS: Session saved, redirecting to /');
          if (!res.headersSent) {
            // Generate JWT token for serverless compatibility
            const jwtToken = generateToken(dbUser);
            console.log('[CALLBACK-TOKEN] Generated JWT token, setting cookie...');
            // Store token in cookie for serverless
            res.cookie('jwt', jwtToken, {
              httpOnly: true,
              secure: true, // Always secure on Vercel
              sameSite: getCookieSameSite(), // Use 'lax' for same-domain
              maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
              path: '/', // Ensure cookie is available site-wide
            });
            console.log('[CALLBACK-TOKEN] Cookie set, sending response with redirect');
            return res.json({ redirect: '/', token: jwtToken });
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
      // Store userId in session as backup
      (req.session as any).userId = dbUser.id;
      if ((req.session as any).supabaseUserId !== dbUser.id) {
        (req.session as any).supabaseUserId = dbUser.id;
      }
      
      req.logIn({ ...dbUser, email: userEmail, id: dbUser.id }, (err) => {
        if (err) return next(err);
        // Generate JWT token for serverless compatibility
        const jwtToken = generateToken(dbUser);
        // Store token in cookie for serverless
        res.cookie('jwt', jwtToken, {
          httpOnly: true,
          secure: true, // Always secure on Vercel
          sameSite: getCookieSameSite(), // Use 'lax' for same-domain
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
          path: '/', // Ensure cookie is available site-wide
        });
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
        // Ensure inviteToken is preserved in pending registration
        (req.session as any).pendingRegistration = {
          ...result.pending,
          inviteToken: result.pending.inviteToken || inviteToken,
        };
        // Store userId in session as backup even for pending users
        if (user.id) {
          (req.session as any).userId = user.id;
        }
        // Also store supabaseUserId for consistency with OAuth flow
        (req.session as any).supabaseUserId = user.id;
        (req.session as any).supabaseEmail = user.email;
        
        req.logIn({ 
          ...user, 
          id: user.id,
          pendingRegistration: {
            ...result.pending,
            inviteToken: result.pending.inviteToken || inviteToken,
          }
        }, (err) => {
          if (err) return next(err);
          req.session.save((saveErr) => {
            if (saveErr) {
              console.error('[LOGIN] Error saving session:', saveErr);
            }
            return res.json({ pending: true });
          });
        });
        return;
      }

      // Store userId in session as backup
      (req.session as any).userId = user.id;
      
      req.logIn({ ...user, id: user.id }, (err) => {
        if (err) return next(err);
        // Generate JWT token for serverless compatibility
        const jwtToken = generateToken(user);
        // Store token in cookie for serverless
        res.cookie('jwt', jwtToken, {
          httpOnly: true,
          secure: true, // Always secure on Vercel
          sameSite: getCookieSameSite(), // Use 'lax' for same-domain
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
          path: '/', // Ensure cookie is available site-wide
        });
        return res.json({ success: true, user, token: jwtToken });
      });
    })(req, res, next);
  });

  // Email/password signup route (POST)
  app.post("/api/auth/signup", async (req, res) => {
    console.log('[SIGNUP] Route hit - /api/auth/signup');
    console.log('[SIGNUP] Request body:', { email: req.body?.email, hasPassword: !!req.body?.password, hasInviteToken: !!req.body?.inviteToken });
    try {
      const { email, password, inviteToken } = req.body;

      // Validate required fields
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }

      // Validate password strength
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      // Check if user already exists in database
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "An account with this email already exists" });
      }

      // Store invite token in session if provided
      if (inviteToken) {
        (req.session as any).inviteToken = inviteToken;
      }

      // Check user registration status (validates invite token if provided)
      const registrationCheck = await checkUserRegistration(email, inviteToken);
      
      if (registrationCheck.error) {
        return res.status(400).json({ message: registrationCheck.error });
      }

      // If user already exists (shouldn't happen due to check above, but double-check)
      if (registrationCheck.user) {
        return res.status(400).json({ message: "An account with this email already exists" });
      }

      // Create Supabase auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError || !authData.user) {
        console.error('[SIGNUP] Supabase signup error:', authError);
        return res.status(400).json({ 
          message: authError?.message || "Failed to create account. Please try again." 
        });
      }

      // Set up pending registration session (same as OAuth flow)
      if (registrationCheck.pending) {
        (req.session as any).pendingRegistration = {
          ...registrationCheck.pending,
          inviteToken: registrationCheck.pending.inviteToken || inviteToken,
        };
        (req.session as any).supabaseUserId = authData.user.id;
        (req.session as any).supabaseEmail = email;
        (req.session as any).userId = authData.user.id;

        // Create temporary session for pending user
        req.logIn({ 
          id: authData.user.id, 
          email: email,
          pendingRegistration: {
            ...registrationCheck.pending,
            inviteToken: registrationCheck.pending.inviteToken || inviteToken,
          }
        }, (err) => {
          if (err) {
            console.error('[SIGNUP] Error creating session:', err);
            if (!res.headersSent) {
              return res.status(500).json({ message: "Account created but session failed. Please try logging in." });
            }
            return;
          }
          
          req.session.save((saveErr) => {
            if (saveErr) {
              console.error('[SIGNUP] Error saving session:', saveErr);
              if (!res.headersSent) {
                return res.status(500).json({ message: "Account created but session save failed. Please try logging in." });
              }
              return;
            }
            
            console.log('[SIGNUP] Session saved successfully, sending response');
            if (!res.headersSent) {
              res.setHeader('Content-Type', 'application/json');
              return res.json({ 
                success: true, 
                pending: true,
                message: "Account created. Please choose a username to continue." 
              });
            } else {
              console.error('[SIGNUP] WARNING: Response headers already sent, cannot send JSON response');
            }
          });
        });
        return;
      }

      // This shouldn't happen, but handle it
      return res.status(500).json({ message: "Unexpected error during registration" });
    } catch (error: any) {
      console.error('[SIGNUP] Unexpected error:', error);
      return res.status(500).json({ message: error.message || "An unexpected error occurred" });
    }
  });

  // Note: Registration completion is handled in routes.ts
  // This allows the route to call completeRegistration with just username
  // Password will be auto-generated if not provided

  // Logout route
  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      // Clear JWT cookie
      res.cookie('jwt', '', {
        httpOnly: true,
        secure: true, // Always secure on Vercel
        sameSite: getCookieSameSite(), // Use 'lax' for same-domain
        maxAge: 0,
        path: '/', // Ensure cookie is available site-wide
      });
      res.redirect('/');
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const path = (req as any).path || (req as any).url || 'unknown';
  
  // Log session state for debugging
  console.log('[Auth] Checking authentication for', path, {
    hasSession: !!req.session,
    sessionID: req.sessionID,
    hasPassportUser: !!(req.session as any)?.passport?.user,
    isAuthenticated: req.isAuthenticated(),
    hasUser: !!(req as any).user,
    hasCookies: !!(req as any).cookies,
    cookieHeader: req.headers.cookie ? 'present' : 'missing',
    isNgrok: !!(req as any).isNgrok,
    host: req.get('host'),
  });
  
  // Try Express session first
  if (req.isAuthenticated()) {
    console.log('[Auth] Authenticated via Express session for', path);
    return next();
  }
  
  // Fall back to JWT for serverless
  try {
    const { authenticateJWT } = await import('./jwtAuth');
    const user = await authenticateJWT(req);
    if (user) {
      console.log('[Auth] Authenticated via JWT for', path, 'user:', user.id);
      (req as any).user = user;
      return next();
    } else {
      console.log('[Auth] JWT authentication failed for', path);
    }
  } catch (error) {
    console.error('[Auth] JWT authentication error for', path, ':', error);
    // JWT auth failed, continue to error
  }
  
  console.log('[Auth] Unauthorized access attempt for', path, {
    hasSession: !!req.session,
    sessionID: req.sessionID,
    hasPassportUser: !!(req.session as any)?.passport?.user,
    hasUser: !!(req as any).user,
    hasCookies: !!(req as any).cookies,
    cookieKeys: (req as any).cookies ? Object.keys((req as any).cookies) : [],
    cookieHeader: req.headers.cookie ? 'present' : 'missing',
    isNgrok: !!(req as any).isNgrok,
  });
  
  return res.status(401).json({ message: "Unauthorized" });
};

export const requireLevel = (minLevel: number): RequestHandler => {
  return async (req, res, next) => {
    const path = (req as any).path || (req as any).url || 'unknown';
    let user = req.user as any;
    
    // If no user from Express session, try JWT
    if (!user?.id) {
      try {
        const { authenticateJWT } = await import('./jwtAuth');
        const jwtUser = await authenticateJWT(req);
        if (jwtUser) {
          console.log('[Auth] Level check: Authenticated via JWT for', path);
          user = jwtUser;
          (req as any).user = jwtUser;
        } else {
          console.log('[Auth] Level check: JWT authentication failed for', path);
        }
      } catch (error) {
        console.error('[Auth] Level check: JWT authentication error for', path, ':', error);
        // JWT auth failed
      }
    }
    
    if (!user?.id) {
      console.log('[Auth] Level check: Unauthorized - no user for', path);
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

