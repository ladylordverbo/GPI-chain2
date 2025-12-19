# Where to Find Your Supabase Credentials

## ❌ You DON'T Need:
- Project ID (not needed for our setup)

## ✅ You DO Need (3 things):

### 1. DATABASE_URL
**Location:** Settings → **Database** (in the CONFIGURATION section)
- Click "Database" in the left sidebar
- Scroll to "Connection string" section
- Copy the **URI** (not "Connection pooling")
- Replace `[YOUR-PASSWORD]` with your actual password

### 2. SUPABASE_URL  
**Location:** Settings → **API Keys** (in PROJECT SETTINGS section)
- Click "API Keys" in the left sidebar
- Look for **Project URL**
- Copy it (looks like: `https://xxxxx.supabase.co`)

### 3. SUPABASE_ANON_KEY
**Location:** Settings → **API Keys** (same page as above)
- Still on the "API Keys" page
- Look for **anon public** key
- Copy the long string (starts with `eyJ...`)

## Quick Navigation:
From where you are now (General settings):
1. Click **"API Keys"** in PROJECT SETTINGS section → Get SUPABASE_URL and SUPABASE_ANON_KEY
2. Click **"Database"** in CONFIGURATION section → Get DATABASE_URL

That's it! Just these 3 values.
