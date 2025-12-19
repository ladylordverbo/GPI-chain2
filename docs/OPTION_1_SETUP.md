# Option 1 Setup Guide: Supabase + Railway

This guide will walk you through setting up your app with Supabase (database + auth) and Railway (hosting).

## ✅ Code Changes Complete!

All the code changes have been made:
- ✅ `getUserByEmail` added to storage
- ✅ `supabaseAuth.ts` created with OAuth support
- ✅ Routes updated to use Supabase auth
- ✅ Frontend login works with OAuth (Google)

## Step-by-Step Setup

### Part 1: Set Up Supabase (15 minutes)

#### Step 1: Create Supabase Account
1. Go to https://supabase.com
2. Click "Start your project" or "Sign up"
3. Sign up with GitHub (easiest) or email

#### Step 2: Create a New Project
1. Click "New Project"
2. Fill in:
   - **Organization**: Create new or select existing
   - **Project Name**: `gpichain` (or your choice)
   - **Database Password**: **SAVE THIS!** You'll need it
   - **Region**: Choose closest to you
3. Click "Create new project"
4. Wait 2-3 minutes for setup

#### Step 3: Get Your Database URL
1. In your project dashboard, go to **Settings** (gear icon) → **Database**
2. Scroll down to **Connection string** section
3. Find **URI** (not Connection pooling)
4. Copy the connection string - it looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
   ```
5. Replace `[YOUR-PASSWORD]` with the password you saved in Step 2

#### Step 4: Get Your API Keys
1. Still in Settings, go to **API** tab
2. Copy:
   - **Project URL** (SUPABASE_URL) - looks like `https://xxxxx.supabase.co`
   - **anon public** key (SUPABASE_ANON_KEY) - long string starting with `eyJ...`

#### Step 5: Enable Google OAuth
1. Go to **Authentication** → **Providers** in the sidebar
2. Find **Google** and click to expand
3. Toggle **Enable Google provider**
4. You'll need to set up Google OAuth credentials:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project (or use existing)
   - Enable Google+ API
   - Create OAuth 2.0 credentials
   - Add authorized redirect URI: `https://xxxxx.supabase.co/auth/v1/callback`
   - Copy Client ID and Client Secret to Supabase
5. Click "Save"

**Note**: For local development, you can skip Google OAuth setup for now and test with email/password later.

#### Step 6: Run Database Migrations
1. Create your `.env` file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your Supabase values:
   ```env
   DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
   SESSION_SECRET=your-generated-secret-here
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_ANON_KEY=your-anon-key-here
   PORT=5000
   NODE_ENV=development
   ```

3. Generate a session secret:
   ```bash
   openssl rand -base64 32
   ```
   Copy the output and paste it as `SESSION_SECRET` in `.env`

4. Run migrations:
   ```bash
   npm run db:push
   ```

   This creates all your tables in Supabase!

### Part 2: Test Locally (5 minutes)

1. Start the dev server:
   ```bash
   npm run dev
   ```

2. Open http://localhost:5000

3. Click "Continue with Google" - it should redirect to Google OAuth

4. After logging in with Google, you'll be redirected back

5. If you're the first user, you'll be asked to choose a username

**Troubleshooting**:
- If you see "SUPABASE_URL and SUPABASE_ANON_KEY must be set", check your `.env` file
- If OAuth doesn't work, make sure Google provider is enabled in Supabase
- Check the browser console for errors

### Part 3: Deploy to Railway (10 minutes)

#### Step 1: Create Railway Account
1. Go to https://railway.app
2. Click "Start a New Project"
3. Sign up with GitHub (recommended)

#### Step 2: Deploy from GitHub
1. Click "Deploy from GitHub repo"
2. Select your repository (`GPI-chain2`)
3. Railway will auto-detect it's a Node.js project
4. Click "Deploy"

#### Step 3: Add Environment Variables
1. In your Railway project, click on the service
2. Go to **Variables** tab
3. Add these variables (click "New Variable" for each):

   ```
   DATABASE_URL=postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres
   SESSION_SECRET=your-session-secret-here
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_ANON_KEY=your-anon-key-here
   NODE_ENV=production
   ```

   **Important**: Use the same values from your `.env` file, but make sure `NODE_ENV=production`

4. Railway will automatically set `PORT` - don't add it manually

#### Step 4: Update Supabase Redirect URL
1. Go back to Supabase → **Authentication** → **URL Configuration**
2. Add your Railway URL to **Redirect URLs**:
   ```
   https://your-app.railway.app/api/callback
   ```
3. Also add for local development:
   ```
   http://localhost:5000/api/callback
   ```

#### Step 5: Deploy
1. Railway will automatically deploy when you push to GitHub
2. Or click "Redeploy" in Railway dashboard
3. Wait for deployment to complete
4. Click on your service → **Settings** → **Generate Domain** to get your URL

#### Step 6: Run Migrations on Production
1. Install Railway CLI (optional):
   ```bash
   npm install -g @railway/cli
   railway login
   ```

2. Link your project:
   ```bash
   railway link
   ```

3. Run migrations:
   ```bash
   railway run npm run db:push
   ```

   Or use Railway's web terminal:
   - Go to your service → **Deployments** → Click on latest deployment → **View Logs**
   - Or use the web terminal in Railway dashboard

### Part 4: Test Production (5 minutes)

1. Visit your Railway URL (e.g., `https://your-app.railway.app`)
2. Test the login flow
3. Create your first admin account
4. Test invite links
5. Test the full app functionality

## Environment Variables Summary

You need these 4 variables:

| Variable | Where to Get It | Example |
|----------|----------------|---------|
| `DATABASE_URL` | Supabase → Settings → Database → URI | `postgresql://postgres:xxx@db.xxx.supabase.co:5432/postgres` |
| `SESSION_SECRET` | Generate with `openssl rand -base64 32` | `abc123...` |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL | `https://xxxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public | `eyJhbGc...` |

## Troubleshooting

### "SUPABASE_URL and SUPABASE_ANON_KEY must be set"
- Check your `.env` file has these variables
- Make sure there are no extra spaces
- Restart your dev server after changing `.env`

### OAuth redirect fails
- Check Supabase → Authentication → URL Configuration
- Make sure your redirect URL is added
- Format: `https://your-domain.com/api/callback`

### Database connection fails
- Verify `DATABASE_URL` is correct
- Check password is correct (no brackets `[]`)
- Make sure Supabase project is active

### Migrations fail
- Check database connection first
- Make sure you have the right permissions
- Try running `npm run db:push` again

### App doesn't start on Railway
- Check Railway logs for errors
- Verify all environment variables are set
- Make sure `NODE_ENV=production` is set

## Next Steps

1. ✅ Set up Supabase
2. ✅ Test locally
3. ✅ Deploy to Railway
4. 🎉 Your app is live!

## Support

- Supabase Docs: https://supabase.com/docs
- Railway Docs: https://docs.railway.app
- Check `MIGRATION_GUIDE.md` for more details

Good luck! 🚀

