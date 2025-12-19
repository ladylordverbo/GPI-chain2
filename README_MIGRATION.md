# Migration Documentation Index

Welcome! This directory contains comprehensive documentation for migrating your GPI Chain application from Replit to alternative hosting solutions.

## 📚 Documentation Files

### Start Here
- **[QUICK_START.md](./QUICK_START.md)** - Get running in 5 minutes
- **[REPLIT_TO_ALTERNATIVES.md](./REPLIT_TO_ALTERNATIVES.md)** - High-level overview of what Replit provided and your options

### Detailed Guides
- **[MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)** - Complete step-by-step migration instructions for all options
- **[SETUP.md](./SETUP.md)** - Original setup documentation
- **[PROJECT_ANALYSIS.md](./PROJECT_ANALYSIS.md)** - Technical analysis of issues found

## 🎯 Quick Decision Tree

**Q: What do I need?**
- Database (PostgreSQL) ✅
- Authentication (replace Replit Auth) ❌
- Hosting (optional for local dev) ⚠️

**Q: What's the easiest path?**
1. Use **Supabase** for database + auth
2. Deploy to **Railway** for hosting
3. See [MIGRATION_GUIDE.md - Option 1](./MIGRATION_GUIDE.md#option-1-supabase--railway-recommended)

**Q: Just want to test locally?**
1. Install PostgreSQL locally
2. Use simple username/password auth
3. See [MIGRATION_GUIDE.md - Option 2](./MIGRATION_GUIDE.md#option-2-local-postgresql--simple-auth)

## 📋 What Replit Provided

| Component | Status | What You Need |
|-----------|--------|---------------|
| **PostgreSQL Database** | ✅ Already in code | Just connect to different server |
| **Session Storage** | ✅ Uses database | Same database (auto-created) |
| **Authentication** | ❌ Replit-specific | Replace with Supabase Auth, NextAuth.js, or simple auth |
| **Hosting** | ⚠️ Optional | Railway, Render, or local |

## 🚀 Recommended Path

### For Development
1. Install PostgreSQL locally
2. Use simple auth (see Option 2 in MIGRATION_GUIDE.md)
3. Run `npm run dev`

### For Production
1. Set up Supabase (database + auth)
2. Deploy to Railway
3. See Option 1 in MIGRATION_GUIDE.md

## 📝 Key Files to Modify

When migrating authentication, you'll need to:

1. **Create new auth file**: `server/supabaseAuth.ts` or `server/simpleAuth.ts`
2. **Update routes**: Change import in `server/routes.ts`:
   ```typescript
   // From:
   import { setupAuth, ... } from "./replitAuth";
   // To:
   import { setupAuth, ... } from "./supabaseAuth"; // or simpleAuth
   ```
3. **Add storage method**: Add `getUserByEmail` to `server/storage.ts` (see MIGRATION_GUIDE.md)
4. **Update frontend**: Change login from GET redirect to POST request (see MIGRATION_GUIDE.md)

## 🔧 Environment Variables Needed

```env
# Required
DATABASE_URL=postgresql://user:pass@host:port/db
SESSION_SECRET=your-secret-here

# For Supabase Auth (if using)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=your-key-here

# Optional
PORT=5000
NODE_ENV=development
```

## 🆘 Getting Help

1. Check [Troubleshooting](./MIGRATION_GUIDE.md#troubleshooting) in MIGRATION_GUIDE.md
2. Review error messages - they're usually descriptive
3. Verify all environment variables are set
4. Check database connection and permissions

## ✅ Checklist

- [ ] Read [QUICK_START.md](./QUICK_START.md)
- [ ] Choose your migration path
- [ ] Set up database (Supabase or local)
- [ ] Create `.env` file with all variables
- [ ] Run `npm run db:push` to create tables
- [ ] Replace authentication (see MIGRATION_GUIDE.md)
- [ ] Test locally with `npm run dev`
- [ ] Deploy to production (if needed)

Good luck! 🚀


