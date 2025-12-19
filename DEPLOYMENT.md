# Deployment Guide

Your app is working locally! Here's how to deploy it to production.

## 🎯 Recommended: Railway (Easiest)

Railway is the simplest option - it runs your Express app as-is with minimal configuration.

### Why Railway?
- ✅ Works with Express apps out of the box
- ✅ Auto-detects Node.js projects
- ✅ Free tier with $5 credit/month
- ✅ Automatic deployments from GitHub
- ✅ Built-in environment variable management
- ✅ Simple pricing (~$5/month after free credit)

### Step 1: Prepare Your Code

1. **Make sure everything is committed to GitHub:**
   ```bash
   git add .
   git commit -m "Ready for deployment"
   git push origin main
   ```

2. **Verify your build works locally:**
   ```bash
   npm run build
   ```
   This should create a `dist/` folder with your built app.

### Step 2: Create Railway Account

1. Go to https://railway.app
2. Click "Start a New Project"
3. Sign up with GitHub (recommended - makes deployments automatic)

### Step 3: Deploy from GitHub

1. Click **"Deploy from GitHub repo"**
2. Select your `GPI-chain2` repository
3. Railway will auto-detect it's a Node.js project
4. Click **"Deploy"**

Railway will start building your app automatically.

### Step 4: Add Environment Variables

1. In your Railway project, click on the service
2. Go to **Variables** tab
3. Click **"New Variable"** and add each of these:

   ```
   DATABASE_URL=postgresql://postgres:[PASSWORD]@aws-0-us-west-2.pooler.supabase.com:5432/postgres
   SESSION_SECRET=your-session-secret-from-local-env
   SUPABASE_URL=https://zezhiqkfzinswgulblzs.supabase.co
   SUPABASE_ANON_KEY=your-anon-key-from-local-env
   NODE_ENV=production
   ```

   **Important:**
   - Use the **same values** from your local `.env` file
   - Make sure `NODE_ENV=production`
   - Railway automatically sets `PORT` - don't add it manually
   - Use the **Session pooler** connection string (not direct connection)

### Step 5: Update Supabase Redirect URLs

1. Go to Supabase Dashboard → **Authentication** → **URL Configuration**
2. In **Redirect URLs**, add your Railway URL:
   ```
   https://your-app.railway.app/callback.html
   ```
   (Railway will give you a URL like `your-app.railway.app`)

3. Keep your local URL too:
   ```
   http://localhost:5000/callback.html
   ```

### Step 6: Run Database Migrations

Your database tables need to exist in production. Run migrations:

**Option A: Using Railway CLI (Recommended)**
```bash
npm install -g @railway/cli
railway login
railway link  # Links to your Railway project
railway run npm run db:push
```

**Option B: Using Railway Web Terminal**
1. Go to your Railway service → **Deployments**
2. Click on the latest deployment
3. Click **"View Logs"** or use the web terminal
4. Run: `npm run db:push`

### Step 7: Get Your URL

1. In Railway, go to your service → **Settings**
2. Click **"Generate Domain"** (or use the auto-generated one)
3. Your app will be live at: `https://your-app.railway.app`

### Step 8: Verify Deployment

1. Visit your Railway URL
2. Try signing in with Google
3. Check Railway logs if there are any issues

**Done!** 🎉 Your app is now live!

---

## 🔄 Alternative Options

### Option 2: Render

Similar to Railway, but with a free tier (slower cold starts).

1. Go to https://render.com
2. Sign up with GitHub
3. Click "New" → "Web Service"
4. Connect your GitHub repo
5. Settings:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Environment**: `Node`
6. Add environment variables (same as Railway)
7. Deploy!

**Render Free Tier:**
- Free for static sites
- $7/month for web services (but has free tier with limitations)

### Option 3: Fly.io

Good for global distribution, more complex setup.

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Sign up: `fly auth signup`
3. Create app: `fly launch`
4. Add environment variables
5. Deploy: `fly deploy`

### Option 4: Vercel (Not Recommended)

Vercel is designed for serverless functions, not Express apps. You'd need to:
- Convert routes to serverless functions
- Significant code changes required
- Not worth it for this app

---

## 📋 Deployment Checklist

Before deploying, make sure:

- [ ] Code is committed and pushed to GitHub
- [ ] `npm run build` works locally
- [ ] All environment variables are ready
- [ ] Supabase redirect URLs are configured
- [ ] Database migrations are ready to run
- [ ] Your first user is created in the database (if you hard-coded it)

---

## 🐛 Troubleshooting

### Build Fails on Railway

- Check Railway logs for errors
- Make sure `package.json` has a `build` script
- Verify all dependencies are in `package.json` (not just devDependencies)

### App Won't Start

- Check environment variables are set correctly
- Verify `DATABASE_URL` uses the pooler (not direct connection)
- Check Railway logs for specific errors

### Database Connection Errors

- Make sure you're using the **Session pooler** connection string
- Verify your Supabase database allows connections from Railway's IPs
- Check Supabase → Settings → Database → Network Restrictions

### OAuth Redirect Errors

- Verify redirect URLs in Supabase match your Railway URL exactly
- Make sure you added `/callback.html` not just `/callback`
- Check that `SUPABASE_URL` and `SUPABASE_ANON_KEY` are correct

### Session Issues

- Make sure `SESSION_SECRET` is set and matches between local and production
- Verify sessions table exists (run migrations)
- Check cookie settings (should work automatically with Railway)

---

## 💰 Cost Estimates

**Railway:**
- Free tier: $5 credit/month
- After free tier: ~$5-10/month for small apps
- Scales with usage

**Render:**
- Free tier available (with limitations)
- Paid: $7/month for web services

**Supabase:**
- Free tier: 500MB database, 50k monthly active users
- Paid: $25/month for more resources

**Total estimated cost: $5-10/month** for a small app.

---

## 🔗 Useful Links

- [Railway Docs](https://docs.railway.app)
- [Render Docs](https://render.com/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Your Migration Guide](./MIGRATION_GUIDE.md)

---

## 🎉 Next Steps After Deployment

1. Set up a custom domain (optional)
2. Configure SSL (automatic with Railway)
3. Set up monitoring/logging
4. Configure backups for your database
5. Set up CI/CD for automatic deployments

