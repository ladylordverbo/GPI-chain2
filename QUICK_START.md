# Quick Start Guide

## TL;DR - Get Running in 5 Steps

### Option 1: Supabase (Easiest - Recommended)

1. **Create Supabase account** → https://supabase.com
2. **Create project** → Copy `DATABASE_URL` and API keys
3. **Update `.env`**:
   ```env
   DATABASE_URL=postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres
   SESSION_SECRET=$(openssl rand -base64 32)
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   ```
4. **Run migrations**: `npm run db:push`
5. **Replace auth**: See [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md#option-1-supabase--railway-recommended)

### Option 2: Local Development

1. **Install PostgreSQL**: `brew install postgresql` (macOS) or `sudo apt-get install postgresql` (Linux)
2. **Create database**: `createdb gpichain`
3. **Update `.env`**:
   ```env
   DATABASE_URL=postgresql://your_user:password@localhost:5432/gpichain
   SESSION_SECRET=$(openssl rand -base64 32)
   ```
4. **Run migrations**: `npm run db:push`
5. **Start dev server**: `npm run dev`

---

## What You Need to Replace

| Component | Status | Solution |
|-----------|--------|----------|
| **Database** | ✅ Ready | Supabase (free) or local PostgreSQL |
| **Sessions** | ✅ Ready | Uses same database (auto-created) |
| **Auth** | ❌ Needs work | Supabase Auth, NextAuth.js, or simple auth |
| **Hosting** | ⚠️ Optional | Railway, Render, or local |

---

## Files to Read

1. **[MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)** - Complete step-by-step migration instructions
2. **[REPLIT_TO_ALTERNATIVES.md](./REPLIT_TO_ALTERNATIVES.md)** - High-level overview of options
3. **[SETUP.md](./SETUP.md)** - Original setup documentation
4. **[PROJECT_ANALYSIS.md](./PROJECT_ANALYSIS.md)** - Technical analysis of issues

---

## Common First Steps

```bash
# 1. Install dependencies (already done)
npm install

# 2. Create environment file
cp .env.example .env

# 3. Edit .env with your values
nano .env  # or use your editor

# 4. Run database migrations
npm run db:push

# 5. Start development server
npm run dev
```

---

## Next: Choose Your Path

- **Want easiest setup?** → [Supabase + Railway](./MIGRATION_GUIDE.md#option-1-supabase--railway-recommended)
- **Want full control?** → [Local PostgreSQL + Simple Auth](./MIGRATION_GUIDE.md#option-2-local-postgresql--simple-auth)
- **Want to understand options?** → [REPLIT_TO_ALTERNATIVES.md](./REPLIT_TO_ALTERNATIVES.md)

---

## Need Help?

Check the [Troubleshooting](./MIGRATION_GUIDE.md#troubleshooting) section in MIGRATION_GUIDE.md


