# How to Get Your Supabase Credentials

## Step 1: Get Database URL

1. In your Supabase project, click **Settings** (gear icon in left sidebar)
2. Click **Database** in the settings menu
3. Scroll down to **Connection string** section
4. Find **URI** (not "Connection pooling" or "Session mode")
5. Click the **copy** icon next to it
6. It looks like: `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`
   
   **OR** the direct connection:
   `postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres`

7. **Important**: Replace `[YOUR-PASSWORD]` with the password you set when creating the project
8. Copy this entire string - this is your `DATABASE_URL`

## Step 2: Get API Keys

1. Still in **Settings**, click **API** tab
2. You'll see:
   - **Project URL** - Copy this (this is `SUPABASE_URL`)
     - Looks like: `https://xxxxx.supabase.co`
   - **anon public** key - Copy this (this is `SUPABASE_ANON_KEY`)
     - Long string starting with `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

## Step 3: Generate Session Secret

Run this in your terminal:
```bash
openssl rand -base64 32
```

Copy the output - this is your `SESSION_SECRET`

## Step 4: Update .env File

Open `.env` in your editor and replace the placeholder values:

```env
DATABASE_URL=postgresql://postgres:YOUR_ACTUAL_PASSWORD@db.xxxxx.supabase.co:5432/postgres
SESSION_SECRET=paste_the_output_from_openssl_here
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=paste_your_anon_key_here
PORT=5000
NODE_ENV=development
```

**Important Notes:**
- Make sure there are NO spaces around the `=` sign
- Make sure there are NO quotes around the values
- Replace `YOUR_ACTUAL_PASSWORD` with the password you set when creating the Supabase project
- The password in DATABASE_URL should NOT have brackets `[]` around it

## Quick Checklist

- [ ] Database URL copied (with password replaced)
- [ ] Supabase URL copied
- [ ] Anon key copied
- [ ] Session secret generated
- [ ] All values pasted into .env file
- [ ] No extra spaces or quotes


