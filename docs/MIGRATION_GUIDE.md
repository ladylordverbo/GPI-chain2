# Complete Migration Guide: From Replit to Alternative Solutions

## Table of Contents
1. [Quick Start: Local Development](#quick-start-local-development)
2. [Option 1: Supabase + Railway (Recommended)](#option-1-supabase--railway-recommended)
3. [Option 2: Local PostgreSQL + Simple Auth](#option-2-local-postgresql--simple-auth)
4. [Option 3: Supabase Everything](#option-3-supabase-everything)
5. [Option 4: Railway Everything](#option-4-railway-everything)
6. [Troubleshooting](#troubleshooting)

---

## Quick Start: Local Development

Get your app running locally first, then deploy to production.

### Step 1: Install PostgreSQL Locally

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

**macOS:**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Windows:**
- Download from https://www.postgresql.org/download/windows/
- Use the installer (includes pgAdmin)

### Step 2: Create Database

```bash
# Create a PostgreSQL user (if needed)
sudo -u postgres createuser --interactive

# Create the database
createdb gpichain

# Or using psql:
psql -U postgres -c "CREATE DATABASE gpichain;"
```

### Step 3: Create Environment File

```bash
# Copy the example
cp .env.example .env

# Generate a session secret
openssl rand -base64 32

# Edit .env with your values:
```

```env
DATABASE_URL=postgresql://your_username:your_password@localhost:5432/gpichain
SESSION_SECRET=paste_your_generated_secret_here
PORT=5000
NODE_ENV=development
```

**Note**: For local development, you can skip `REPL_ID` for now (we'll replace auth next).

### Step 4: Run Database Migrations

```bash
npm run db:push
```

This creates all the tables in your database.

### Step 5: Replace Authentication (Temporary Simple Version)

For now, we'll create a simple username/password auth to get it running. See [Option 2](#option-2-local-postgresql--simple-auth) for details.

### Step 6: Start Development Server

```bash
npm run dev
```

Your app should now be running at `http://localhost:5000`!

---

## Option 1: Supabase + Railway (Recommended)

This is the easiest production setup. Supabase handles database + auth, Railway handles hosting.

### Part A: Set Up Supabase

#### Step 1: Create Supabase Account
1. Go to https://supabase.com
2. Sign up (free)
3. Click "New Project"

#### Step 2: Create Project
1. Choose organization (or create one)
2. Project name: `gpichain` (or your choice)
3. Database password: **Save this!** (you'll need it)
4. Region: Choose closest to you
5. Click "Create new project"
6. Wait 2-3 minutes for setup

#### Step 3: Get Database URL
1. Go to Project Settings → Database
2. Scroll to "Connection string"
3. Copy the "URI" connection string
4. It looks like: `postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres`

#### Step 4: Update Your .env
```env
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
SESSION_SECRET=your-generated-secret-here
PORT=5000
NODE_ENV=production
```

#### Step 5: Run Migrations
```bash
npm run db:push
```

This will create all your tables in Supabase.

### Part B: Set Up Supabase Authentication

#### Step 1: Enable Auth Providers
1. In Supabase dashboard, go to Authentication → Providers
2. Enable providers you want:
   - **Email**: Enable (for email/password)
   - **Google**: Enable (requires OAuth setup)
   - **GitHub**: Enable (requires OAuth setup)

#### Step 2: Install Supabase Client
```bash
npm install @supabase/supabase-js
```

#### Step 3: Add getUserByEmail to Storage

First, add this method to `server/storage.ts`:

```typescript
// Add to IStorage interface (around line 22)
getUserByEmail(email: string): Promise<User | undefined>;

// Add to DatabaseStorage class (around line 70, after getUser)
async getUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user;
}
```

**Note**: Make sure to import `eq` from `drizzle-orm` if not already imported.

#### Step 4: Create Supabase Auth File

Create `server/supabaseAuth.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import session from 'express-session';
import type { Express, RequestHandler } from 'express';
import { storage } from './storage';
import connectPg from 'connect-pg-simple';

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

export async function completeRegistration(pendingReg: PendingRegistration, username: string, password: string): Promise<{ user: any, error?: string }> {
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

  // Create user in Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: pendingReg.email,
    password: password,
  });

  if (authError || !authData.user) {
    return { user: null, error: authError?.message || "Failed to create user" };
  }

  // Create user in your database
  const user = await storage.upsertUser({
    id: authData.user.id,
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

        return done(null, { id: data.user.id, email: data.user.email, ...dbUser });
      } catch (err) {
        return done(err);
      }
    }
  ));

  passport.serializeUser((user: any, cb) => cb(null, user));
  passport.deserializeUser((user: any, cb) => cb(null, user));

  // Login route
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

  // Registration completion
  app.post("/api/auth/complete-registration", async (req, res) => {
    const pendingReg = (req.session as any).pendingRegistration;
    if (!pendingReg) {
      return res.status(400).json({ message: "No pending registration" });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }

    const result = await completeRegistration(pendingReg, username, password);
    
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }

    delete (req.session as any).pendingRegistration;
    
    // Auto-login after registration
    const { data: authData } = await supabase.auth.signInWithPassword({
      email: pendingReg.email,
      password: password,
    });

    if (authData?.user) {
      const user = await storage.getUser(authData.user.id);
      req.logIn({ id: authData.user.id, email: authData.user.email, ...user }, (err) => {
        if (err) return res.status(500).json({ message: "Login failed" });
        return res.json({ success: true, user });
      });
    } else {
      return res.status(500).json({ message: "Registration failed" });
    }
  });

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
```

#### Step 4: Get Supabase Keys
1. In Supabase dashboard, go to Project Settings → API
2. Copy:
   - **Project URL** (SUPABASE_URL)
   - **anon/public key** (SUPABASE_ANON_KEY)

#### Step 5: Update .env
```env
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres
SESSION_SECRET=your-generated-secret-here
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
PORT=5000
NODE_ENV=production
```

#### Step 6: Update server/routes.ts
Replace the import:
```typescript
// Change this:
import { setupAuth, isAuthenticated, requireLevel, completeRegistration } from "./replitAuth";

// To this:
import { setupAuth, isAuthenticated, requireLevel, completeRegistration } from "./supabaseAuth";
```

#### Step 7: Update Frontend Login
You'll need to update the frontend to use POST `/api/login` instead of GET `/api/login`. See frontend changes section below.

### Part C: Deploy to Railway

#### Step 1: Create Railway Account
1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project"

#### Step 2: Deploy from GitHub
1. Click "Deploy from GitHub repo"
2. Select your repository
3. Railway auto-detects Node.js
4. Click "Deploy"

#### Step 3: Add Environment Variables
1. Go to your service → Variables
2. Add all variables from your `.env`:
   - `DATABASE_URL`
   - `SESSION_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `NODE_ENV=production`
   - `PORT` (Railway sets this automatically)

#### Step 4: Run Database Migrations
1. Go to your service → Deployments
2. Click on the latest deployment → View Logs
3. Or use Railway CLI:
```bash
npm install -g @railway/cli
railway login
railway link
railway run npm run db:push
```

#### Step 5: Get Your URL
1. Railway provides a URL like `your-app.railway.app`
2. You can add a custom domain in settings

**Done!** Your app is now live.

---

## Option 2: Local PostgreSQL + Simple Auth

Good for development or if you want full control.

### Step 1: Install PostgreSQL (see Quick Start)

### Step 2: Add getUserByEmail to Storage

First, add this method to `server/storage.ts`:

```typescript
// Add to IStorage interface (around line 22)
getUserByEmail(email: string): Promise<User | undefined>;

// Add to DatabaseStorage class (around line 70, after getUser)
async getUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user;
}
```

**Note**: Make sure `eq` is imported from `drizzle-orm` if not already.

### Step 3: Update Schema (Optional - for password auth)

If you want password-based auth, add to `shared/schema.ts` in the users table:

```typescript
passwordHash: varchar("password_hash"), // Add this field
```

Then run `npm run db:push` to update the database.

### Step 4: Create Simple Auth

Create `server/simpleAuth.ts`:

```typescript
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import type { Express, RequestHandler } from 'express';
import { storage } from './storage';
import connectPg from 'connect-pg-simple';

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
      secure: false, // Set to true in production with HTTPS
      sameSite: 'lax',
      maxAge: sessionTtl,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Local strategy
  passport.use(new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
      try {
        const user = await storage.getUserByEmail(email);
        if (!user) {
          return done(null, false, { message: 'Invalid credentials' });
        }

        // For first user, check if password is set
        // You'll need to add a password field to your user schema
        // For now, this is a simplified version
        if (!user.passwordHash) {
          return done(null, false, { message: 'Password not set' });
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          return done(null, false, { message: 'Invalid credentials' });
        }

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  ));

  passport.serializeUser((user: any, cb) => cb(null, user));
  passport.deserializeUser((user: any, cb) => cb(null, user));

  // Login route
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

      req.logIn(user, (err) => {
        if (err) return next(err);
        return res.json({ success: true, user });
      });
    })(req, res, next);
  });

  // Registration route
  app.post("/api/register", async (req, res) => {
    const { email, password, username, inviteToken } = req.body;

    // Validate
    if (!email || !password || !username) {
      return res.status(400).json({ message: "Email, password, and username required" });
    }

    // Check if first user
    const userCount = await storage.getUserCount();
    const isFirstUser = userCount === 0;

    // Validate invite if not first user
    if (!isFirstUser && !inviteToken) {
      return res.status(400).json({ message: "Invite token required" });
    }

    // Validate username
    const normalizedUsername = username.toLowerCase().trim();
    if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
      return res.status(400).json({ message: "Username must be 3-30 characters" });
    }

    const isAvailable = await storage.isUsernameAvailable(normalizedUsername);
    if (!isAvailable) {
      return res.status(400).json({ message: "Username already taken" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const user = await storage.upsertUser({
      id: crypto.randomUUID(), // Generate UUID
      username: normalizedUsername,
      email: email,
      passwordHash: passwordHash, // You'll need to add this to your schema
      level: isFirstUser ? 5 : 1,
      agreementAcceptedAt: new Date(),
      agreementVersion: 1,
    });

    // Mark invite as used if applicable
    if (inviteToken && !isFirstUser) {
      await storage.useInviteLink(inviteToken, user.id);
    }

    // Auto-login
    req.logIn(user, (err) => {
      if (err) return res.status(500).json({ message: "Registration failed" });
      return res.json({ success: true, user });
    });
  });

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

export async function completeRegistration(pendingReg: any, username: string): Promise<{ user: any, error?: string }> {
  // Similar to Supabase version but simpler
  // Implementation depends on your needs
  return { user: null, error: "Not implemented" };
}
```

### Step 6: Install bcrypt
```bash
npm install bcryptjs
npm install --save-dev @types/bcryptjs
```

### Step 7: Update routes.ts
```typescript
import { setupAuth, isAuthenticated, requireLevel } from "./simpleAuth";
```

---

## Option 3: Supabase Everything

Use Supabase for database, auth, AND hosting (via Supabase Edge Functions).

**Note**: This requires more significant code changes as Supabase Edge Functions work differently than Express. This is more advanced.

**Recommendation**: Use Supabase for database + auth, but host the Express app on Railway/Render.

---

## Option 4: Railway Everything

Host both app and database on Railway.

### Step 1: Create Railway Project
1. Go to https://railway.app
2. Create new project
3. Add PostgreSQL service
4. Add Node.js service

### Step 2: Get Database URL
1. Click on PostgreSQL service
2. Go to Variables tab
3. Copy `DATABASE_URL`

### Step 3: Use Railway Database
- Add `DATABASE_URL` to your Node.js service variables
- Railway automatically connects services in the same project

### Step 4: Set Up Auth
Use one of the auth options above (Supabase Auth, NextAuth.js, or simple auth).

---

## Frontend Changes Needed

### Update Login Component

Your current login probably redirects to `/api/login`. You need to change it to POST:

```typescript
// In your LoginView component or similar
const handleLogin = async (email: string, password: string) => {
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();
    
    if (data.success) {
      // Redirect to dashboard
      window.location.href = '/';
    } else {
      // Show error
      setError(data.message || 'Login failed');
    }
  } catch (error) {
    setError('Login failed');
  }
};
```

### Update Registration Flow

Similar changes needed for registration completion.

---

## Troubleshooting

### Database Connection Issues

**Error**: "Connection refused" or "Cannot connect to database"

**Solutions**:
1. Check PostgreSQL is running: `sudo systemctl status postgresql` (Linux) or `brew services list` (macOS)
2. Verify DATABASE_URL format: `postgresql://user:password@host:port/database`
3. Check firewall/network settings
4. For Supabase: Check if IP is allowed (Supabase dashboard → Settings → Database)

### Session Issues

**Error**: Sessions not persisting

**Solutions**:
1. Check SESSION_SECRET is set
2. Verify sessions table exists: `psql -d gpichain -c "\dt sessions"`
3. Check cookie settings (secure, sameSite) match your environment
4. For production: Ensure HTTPS (secure cookies require HTTPS)

### Authentication Issues

**Error**: "Unauthorized" or login not working

**Solutions**:
1. Check auth strategy is registered correctly
2. Verify user exists in database
3. Check password hashing matches
4. Review session setup
5. Check browser console for errors

### Migration Issues

**Error**: "Table already exists" or migration fails

**Solutions**:
1. Check if tables already exist
2. Use `drizzle-kit push --force` (careful - may drop data)
3. Or manually drop tables and re-run migrations
4. Check database permissions

### Port Issues

**Error**: "Port already in use"

**Solutions**:
1. Change PORT in .env
2. Or kill process using port: `lsof -ti:5000 | xargs kill` (macOS/Linux)

---

## Next Steps After Migration

1. **Set up backups**: Configure database backups (Supabase does this automatically)
2. **Add monitoring**: Set up error tracking (Sentry, etc.)
3. **Configure domain**: Add custom domain to your hosting
4. **Set up CI/CD**: Automate deployments from GitHub
5. **Add logging**: Set up proper logging for production

---

## Quick Reference: Environment Variables

```env
# Required
DATABASE_URL=postgresql://user:pass@host:port/db
SESSION_SECRET=your-secret-here

# For Supabase Auth
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=your-key-here

# Optional
PORT=5000
NODE_ENV=development
```

---

## Support Resources

- **Supabase Docs**: https://supabase.com/docs
- **Railway Docs**: https://docs.railway.app
- **PostgreSQL Docs**: https://www.postgresql.org/docs/
- **Passport.js Docs**: http://www.passportjs.org/

Good luck with your migration! 🚀

