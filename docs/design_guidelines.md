# Design Guidelines: Mobile-First Membership Management App

## Design Approach

**Selected Approach:** Design System - Material Design principles adapted for mobile-first productivity

**Rationale:** This is a utility-focused, information-dense application requiring clear data hierarchies, touch-friendly interactions, and consistent patterns across complex workflows (invites, promotions, voting). Material Design provides robust mobile patterns while maintaining professional polish.

**Key Design Principles:**
1. Mobile-first with touch-optimized interactions (minimum 44px touch targets)
2. Clear visual hierarchy for complex data relationships
3. Immediate feedback for all actions (votes, promotions, invites)
4. Efficient information density without overwhelming users
5. Accessible status indicators for user levels and promotion states

## Core Design Elements

### A. Typography

**Font Family:** Inter (primary), SF Pro (fallback)
- Clean, highly legible on small screens
- Excellent number rendering for data tables

**Type Scale:**
- **Headings:** 
  - H1: text-2xl/text-3xl (xl+), font-bold - Page titles
  - H2: text-xl/text-2xl (lg+), font-semibold - Section headers
  - H3: text-lg, font-semibold - Card titles, subsections
- **Body:**
  - Base: text-base, font-normal - Primary content
  - Small: text-sm - Secondary info, metadata
  - Tiny: text-xs - Labels, captions
- **Interactive:**
  - Buttons: text-sm/text-base, font-medium
  - Links: text-sm/text-base, font-medium, underline on hover

### B. Layout System

**Spacing Primitives:** Use Tailwind units of 2, 4, 6, 8, 12, 16
- Component padding: p-4, p-6
- Section spacing: gap-6, gap-8
- Card spacing: p-4 (mobile), p-6 (desktop)
- List item spacing: py-3, py-4

**Grid System:**
- Mobile: Single column (default)
- Tablet (md:): 2-column for dashboard cards
- Desktop (lg:): 3-column max for user grids

**Container Constraints:**
- Mobile: px-4, max-w-full
- Desktop: max-w-7xl, mx-auto

### C. Component Library

#### Navigation
- **Mobile:** Bottom navigation bar (fixed) with 4 primary sections: Dashboard, Invites, Promotions, Profile
- **Desktop:** Sidebar navigation (collapsible) with same structure
- Active state: Filled icon + bold text
- Badge notifications on Promotions tab for pending votes

#### Data Display

**User Cards:**
- Compact card layout: Avatar (48px), Name, Level badge, Inviter info
- Tap to expand: Shows invite count, join date, actions
- Level badges: Pill shape with level number (Level 1-5)

**Tables (Desktop):**
- Sticky headers with sorting indicators
- Row hover states with subtle elevation
- Alternating row backgrounds for readability
- Mobile: Convert to stacked cards

**GPI Chain Visualization:**
- Nested indented list view (mobile-friendly)
- Connector lines (subtle, left border)
- Expandable/collapsible nodes
- Level indicated by badge color intensity

#### Forms

**Invite Generation:**
- Single-page flow with copy-to-clipboard button
- Generated link displayed in read-only input with copy icon
- Success animation on copy

**Promotion Requests:**
- Multi-step form: Select user → Set level → Justification
- Clear current/proposed level comparison
- Character counter on justification field
- Confirmation dialog before submission

**Voting Interface:**
- Card-based layout: Candidate info at top
- Vote buttons: Large, touch-friendly (For/Against)
- Optional comment field (collapsible)
- Vote count progress bar

#### Status Indicators
- **User Status:** Dot indicators (active/suspended/expelled)
- **Promotion Status:** Chips (Open/Approved/Rejected/Expired)
- **Vote Progress:** Progress bar showing votes collected vs. required

#### Buttons & Actions
- **Primary CTA:** Filled, rounded-lg, py-3, px-6, shadow-sm
- **Secondary:** Outline, rounded-lg, py-3, px-6
- **Icon buttons:** 44px minimum touch target, rounded-full
- **Floating Action Button (FAB):** Fixed bottom-right for "Create Invite" on mobile

#### Overlays & Modals
- **Modals:** Slide up from bottom on mobile, centered on desktop
- Backdrop blur with semi-transparent overlay
- Close button: Top-right X or swipe-down gesture (mobile)

### D. Animations

**Minimal, purposeful animations only:**
- Page transitions: Slide (mobile), fade (desktop) - 200ms
- Success feedback: Checkmark scale animation - 300ms
- Loading states: Skeleton screens (no spinners)
- Vote submission: Brief success pulse - 200ms

**Avoid:** Scroll animations, parallax, decorative effects

## Page-Specific Guidelines

### Dashboard (Home)
- Quick stats cards at top: Total members, Pending promotions, My invites
- Level distribution bar chart (horizontal, mobile-friendly)
- Recent activity feed
- Quick actions: Generate invite, View promotions

### User List/Directory
- Search bar (sticky top)
- Level filter chips (horizontal scroll)
- User grid/list with avatar, name, level badge, invite count
- Pull-to-refresh on mobile

### Promotion Voting
- Pending requests feed (card stack)
- Each card shows: Candidate, current→proposed level, justification preview
- Tap to expand full details + voting interface
- Filter: My votes, Open, Closed

### Profile Pages
- User avatar and level badge (prominent)
- Metrics: Joined date, Invited by, Invites sent
- GPI tree visualization (expandable)
- Actions section (context-sensitive based on viewer's level)

## Mobile-First Considerations

- Touch targets: Minimum 44px height/width
- Thumb-zone optimization: Primary actions in bottom half
- Swipe gestures: Swipe to reveal actions on list items
- Haptic feedback on critical actions (vote submission, level changes)
- Bottom sheets for contextual actions
- Persistent navigation at bottom
- Generous spacing between interactive elements (gap-4 minimum)

## Images

**No hero images.** This is a utility application focused on data and workflows.

**Profile Avatars:**
- Google profile pictures via Replit Auth
- Fallback: Initials in circular badge with level-based background gradient
- Sizes: 32px (compact), 48px (standard), 96px (profile page)