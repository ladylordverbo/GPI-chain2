# How to Enable Google OAuth in Supabase

## Step 1: Go to Supabase Authentication Settings

1. In your Supabase project dashboard
2. Click **Authentication** in the left sidebar
3. Click **Providers** tab

## Step 2: Enable Google Provider

1. Find **Google** in the list of providers
2. Click on it to expand
3. Toggle **Enable Google provider** to ON

## Step 3: Set Up Google OAuth Credentials

You'll need to create OAuth credentials in Google Cloud Console:

### A. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Give it a name (e.g., "GPI Chain Auth")
4. Click "Create"

### B. Enable Google+ API

1. In Google Cloud Console, go to **APIs & Services** → **Library**
2. Search for "Google+ API" or "Google Identity"
3. Click on it and click **Enable**

### C. Create OAuth 2.0 Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. If prompted, configure the OAuth consent screen first:
   - User Type: **External** (unless you have a Google Workspace)
   - App name: "GPI Chain" (or your choice)
   - User support email: Your email
   - Developer contact: Your email
   - Click "Save and Continue" through the steps
4. Back to creating OAuth client ID:
   - Application type: **Web application**
   - Name: "GPI Chain Web Client"
   - **Authorized redirect URIs**: Add this:
     ```
     https://zezhiqkfzinswgulblzs.supabase.co/auth/v1/callback
     ```
     (Replace `zezhiqkfzinswgulblzs` with your actual Supabase project reference)
5. Click **Create**
6. Copy the **Client ID** and **Client Secret**

### D. Add Credentials to Supabase

1. Back in Supabase → Authentication → Providers → Google
2. Paste:
   - **Client ID (for OAuth)**: Your Google Client ID
   - **Client Secret (for OAuth)**: Your Google Client Secret
3. Click **Save**

## Step 4: Add Redirect URL for Local Development

1. In Supabase → **Authentication** → **URL Configuration**
2. Under **Redirect URLs**, add:
   ```
   http://localhost:5000/api/callback
   ```
3. Click **Save**

## Step 5: Test It!

1. Go back to your app at `http://localhost:5000`
2. Click "Setup with Google"
3. You should be redirected to Google login
4. After logging in, you'll be redirected back
5. You'll be asked to choose a username
6. You'll become the first Level 5 admin!

## Troubleshooting

**"OAuth initialization failed"**
- Check Google OAuth credentials are correct
- Verify redirect URI matches exactly in Google Cloud Console

**"Redirect URI mismatch"**
- Make sure the redirect URI in Google Cloud Console is:
  `https://zezhiqkfzinswgulblzs.supabase.co/auth/v1/callback`
- Make sure it matches your Supabase project URL

**After login, stuck on callback**
- Check Supabase → Authentication → URL Configuration
- Make sure `http://localhost:5000/api/callback` is added

## Quick Checklist

- [ ] Google provider enabled in Supabase
- [ ] Google Cloud project created
- [ ] OAuth 2.0 credentials created
- [ ] Redirect URI added in Google Cloud Console
- [ ] Client ID and Secret added to Supabase
- [ ] Local redirect URL added in Supabase
- [ ] Test the login flow

Good luck! 🚀

