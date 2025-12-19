# Setup Guide - GPI Chain Application

## Overview

This application was originally built in Replit and has been exported to run in a standard Node.js environment. This guide will help you set it up outside of Replit.

## Issues Fixed

1. ✅ **Dependencies installed** - All npm packages are now installed
2. ✅ **Vite config updated** - Replit-specific plugins now fail gracefully when not available
3. ⚠️ **Authentication** - Still requires Replit Auth (see below for alternatives)

## Required Environment Variables

Create a `.env` file in the root directory with the following variables:

```bash
# Database Configuration (REQUIRED)
DATABASE_URL=postgresql://username:password@localhost:5432/gpichain

# Session Configuration (REQUIRED)
SESSION_SECRET=your-random-secret-here

# Replit Authentication (REQUIRED if using Replit Auth)
REPL_ID=your-replit-id
ISSUER_URL=https://replit.com/oidc

# Server Configuration (Optional - defaults shown)
PORT=5000
NODE_ENV=development
```

### Generating a Session Secret

You can generate a secure session secret using:

```bash
openssl rand -base64 32
```

Or use any random string generator. This should be a long, random string.

## Database Setup

1. **Install PostgreSQL** (if not already installed):
   - Ubuntu/Debian: `sudo apt-get install postgresql`
   - macOS: `brew install postgresql`
   - Windows: Download from https://www.postgresql.org/download/

2. **Create a database**:
   ```bash
   createdb gpichain
   # Or using psql:
   psql -c "CREATE DATABASE gpichain;"
   ```

3. **Update DATABASE_URL** in your `.env` file with your PostgreSQL credentials

4. **Run database migrations**:
   ```bash
   npm run db:push
   ```

## Authentication Setup

⚠️ **IMPORTANT**: This application currently uses **Replit Auth** for authentication. This will NOT work outside of Replit without modifications.

### Option 1: Use Replit Auth (if you have a Replit deployment)
- Set `REPL_ID` to your Replit deployment ID
- Set `ISSUER_URL` to `https://replit.com/oidc` (or your custom OIDC provider)

### Option 2: Implement Alternative Authentication (Recommended for local development)
You'll need to modify `server/replitAuth.ts` to use a different authentication method such as:
- Passport.js with local strategy
- OAuth2 with a different provider (Google, GitHub, etc.)
- JWT-based authentication
- Session-based authentication with username/password

The current authentication flow expects:
- `/api/login` - Login endpoint
- `/api/callback` - OAuth callback
- `/api/logout` - Logout endpoint
- `isAuthenticated` middleware for protected routes

## Installation Steps

1. **Install dependencies** (already done):
   ```bash
   npm install
   ```

2. **Create `.env` file**:
   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

3. **Set up database** (see Database Setup above)

4. **Start the development server**:
   ```bash
   npm run dev
   ```

5. **Build for production**:
   ```bash
   npm run build
   npm start
   ```

## Common Issues

### Issue: "DATABASE_URL must be set"
**Solution**: Make sure you have a `.env` file with `DATABASE_URL` set to a valid PostgreSQL connection string.

### Issue: "REPL_ID environment variable is required"
**Solution**: Either:
- Set `REPL_ID` in your `.env` file (if using Replit Auth)
- Modify `server/replitAuth.ts` to use alternative authentication

### Issue: "Could not find the build directory"
**Solution**: Run `npm run build` before starting the production server.

### Issue: Vite plugins fail to load
**Solution**: This is now handled gracefully - the app will work without Replit-specific plugins.

## Development vs Production

- **Development** (`npm run dev`): Uses Vite dev server with hot module reloading
- **Production** (`npm run build` then `npm start`): Serves pre-built static files

## Project Structure

- `client/` - React frontend application
- `server/` - Express backend API
- `shared/` - Shared TypeScript types and schemas
- `dist/` - Build output (generated)

## Next Steps

1. Set up your `.env` file with all required variables
2. Set up PostgreSQL database
3. Run `npm run db:push` to create database tables
4. Implement alternative authentication OR configure Replit Auth
5. Run `npm run dev` to start development server

## Need Help?

If you encounter issues:
1. Check that all environment variables are set correctly
2. Verify PostgreSQL is running and accessible
3. Check the console output for specific error messages
4. Ensure all dependencies are installed (`npm install`)

