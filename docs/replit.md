# Community HQ - Membership Management Application

## Overview

Community HQ is a mobile-first membership management web application for invite-only communities. The system manages a GPI (Guest-Pass-Invitation) chain tracking who invited whom, a 5-level member hierarchy with promotion voting workflows, and an admin dashboard for community oversight. Built as a full-stack TypeScript application with React frontend and Express backend using PostgreSQL for data persistence.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript, bundled via Vite
- **Styling**: Tailwind CSS with shadcn/ui component library (New York style variant)
- **State Management**: TanStack Query (React Query) for server state with custom query client configuration
- **Routing**: Single-page application with tab-based navigation (no React Router, uses component switching)
- **Design Pattern**: Mobile-first with bottom navigation, touch-optimized 44px minimum touch targets
- **Theme Support**: Light/dark mode with CSS variables and ThemeProvider context

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ESM modules
- **Authentication**: Replit Auth integration via OpenID Connect with Passport.js
- **Session Storage**: PostgreSQL-backed sessions using connect-pg-simple
- **API Pattern**: RESTful JSON API under `/api` prefix with authentication middleware

### Data Layer
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with drizzle-zod for schema validation
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Migrations**: Managed via drizzle-kit with `db:push` command

### Core Domain Models
- **Users**: Members with levels 1-5, status tracking, invitation relationships, unique usernames
- **Invite Links**: Tokenized invitation system with usage tracking
- **Promotion Requests**: Workflow for level advancement proposals
- **Votes**: Voting system for promotion approvals
- **User Level History**: Audit trail for level changes

### Username System
- **Username Field**: Unique, required field (3-30 characters, lowercase letters, numbers, underscores)
- **Registration**: New users must choose a username during registration (stored in session as pending registration)
- **Display**: Usernames are the primary display name, with firstName/lastName as fallback
- **Editing**: Users can edit their own username; Level 5 users can edit any username
- **Validation**: Real-time availability checking with debounced API calls
- **API Endpoints**:
  - `GET /api/username/check/:username`: Check username availability
  - `PATCH /api/users/:userId/username`: Update username (self or Level 5)
  - `GET /api/auth/pending-registration`: Check if user has pending registration
  - `POST /api/auth/complete-registration`: Complete registration with chosen username

### Visibility Rules (enforced at API and UI levels)
- **Level-based visibility**: Users can only see members whose level is ≤ their own level
- **Complete information hiding**: Higher levels are completely hidden - users don't know they exist
- **Email privacy**: Emails are only visible to Level 5 users. No one below Level 5 can see any email addresses
- **Stats filtering**: totalMembers, inviteCount, and levelDistribution only include visible-level data
- **Promotion filtering**: Promotions are only visible if both current and proposed levels are within viewer's range
- **Vote filtering**: Votes from higher-level users are filtered out to prevent information leakage
- **Inviter privacy**: If a user's inviter is above their level, the inviter info is hidden
- **API Enforcement**: All endpoints in `server/routes.ts` use `sanitizeUser()` and `filterAndSanitizeUsers()` helper functions
- **Frontend Enforcement**: LevelFilter component accepts `maxVisibleLevel` prop to only show appropriate level options

### Promotion/Demotion Voting Rules

**Request Types:**
- `PROMOTE`: Standard promotion request
- `DEMOTE`: Standard demotion request (configurable per level)
- `PROMOTE_TO_5`: Special Level 5 promotion (Level 5 only)
- `DEMOTE_FROM_5`: Special Level 5 demotion (Level 5 only)

**Who Can Create Requests:**
- Creator must have `creator.level >= candidate.level`
- You can only create requests for members at or below your level

**Who Can Vote:**
- Voter must meet BOTH conditions:
  - `voter.level >= request.allowedVoterMinLevel`
  - `voter.level >= candidate.currentLevel`
- In other words: you can only influence your level or lower, never people above you

**Default Voting Thresholds:**
- Regular promotions/demotions: `allowedVoterMinLevel` = candidate's current level
- Level 5 governance: `allowedVoterMinLevel` = 5 (only Level 5 can vote)

### Level 5 Governance Rules
Special voting requirements for Level 5 (Core) member changes:

**Promotion to Level 5:**
- 1 Level 5 user: Bootstrap mode - can directly promote 1 user without voting
- 2 Level 5 users: Requires unanimous 2 votes from Level 5 members
- 3+ Level 5 users: Requires 3 votes from Level 5 members

**Demotion from Level 5:**
- Cannot demote the last remaining Level 5 member
- 2 Level 5 users: Requires unanimous 2 votes
- 3+ Level 5 users: Requires 3 votes

**API Endpoints:**
- `GET /api/level5-governance`: Returns governance status (level5Count, voteThreshold, canBootstrap)
- `POST /api/level5-governance/bootstrap-promote`: Direct promotion when only 1 Level 5 exists

### Build System
- **Development**: Vite dev server with HMR, tsx for server
- **Production**: esbuild for server bundling, Vite for client build
- **Output**: `dist/` directory with `dist/public/` for static assets

### Path Aliases
- `@/*` → `./client/src/*` (frontend code)
- `@shared/*` → `./shared/*` (shared types and schemas)
- `@assets` → `./attached_assets` (static assets)

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connection via `DATABASE_URL` environment variable
- **Session Table**: `sessions` table for express-session persistence

### Authentication
- **Replit Auth**: OpenID Connect provider at `https://replit.com/oidc`
- **Required Environment Variables**:
  - `DATABASE_URL`: PostgreSQL connection string
  - `REPL_ID`: Replit deployment identifier
  - `SESSION_SECRET`: Session encryption key
  - `ISSUER_URL`: OIDC provider URL (defaults to Replit)

### UI Components
- **Radix UI**: Headless component primitives for accessibility
- **shadcn/ui**: Pre-built component library configured in `components.json`
- **Lucide React**: Icon library
- **React Icons**: Additional icon sets (Google logo)

### Utilities
- **date-fns**: Date formatting and manipulation
- **zod**: Runtime type validation
- **nanoid**: Unique ID generation for invite tokens
- **class-variance-authority**: Component variant styling