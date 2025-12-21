import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, requireLevel, completeRegistration, getCookieSameSite } from "./supabaseAuth";
import { insertPromotionRequestSchema, insertVoteSchema, selfDemotionRequestSchema, type User } from "@shared/schema";
import { z } from "zod";
import { generateToken } from "./jwtAuth";

// Helper to get user ID from request (works with both Replit and Supabase auth)
function getUserId(req: any): string | undefined {
  // Try multiple locations for user ID
  // 1. req.user.id (Supabase-style, most common)
  if ((req.user as any)?.id) {
    return (req.user as any).id;
  }
  // 2. req.user.claims.sub (Replit-style)
  if ((req.user as any)?.claims?.sub) {
    return (req.user as any).claims.sub;
  }
  // 3. req.session.passport.user.id (Passport session storage)
  if ((req.session as any)?.passport?.user?.id) {
    return (req.session as any).passport.user.id;
  }
  // 4. Direct session storage (fallback)
  if ((req.session as any)?.userId) {
    return (req.session as any).userId;
  }
  // Return undefined - caller should check session.supabaseUserId as final fallback
  return undefined;
}

// Check if viewer can see target user (target level must be <= viewer level)
function canViewerSeeUser(targetLevel: number, viewerLevel: number): boolean {
  return targetLevel <= viewerLevel;
}

// Helper to sanitize user data based on viewer's level
// Returns null if user should not be visible to viewer
function sanitizeUser(user: User, viewerLevel: number): Partial<User> | null {
  // User at higher level than viewer - completely hidden
  if (user.level > viewerLevel) {
    return null;
  }
  
  // Level 5 can see everything about users at their level or below
  if (viewerLevel >= 5) {
    return user;
  }
  
  // Others can see basic info but not email
  const { email, ...rest } = user;
  return rest;
}

// Helper to filter and sanitize users list - only returns visible users
function filterAndSanitizeUsers(users: User[], viewerLevel: number): Partial<User>[] {
  return users
    .filter(u => u.level <= viewerLevel) // Only show users at same level or below
    .map(u => sanitizeUser(u, viewerLevel))
    .filter((u): u is Partial<User> => u !== null);
}

// Filter level distribution to only show levels <= viewer level
function filterLevelDistribution(distribution: { level: number; count: number }[], viewerLevel: number): { level: number; count: number }[] {
  return distribution.filter(d => d.level <= viewerLevel);
}

// Get max visible level for a viewer (what they're allowed to see/know about)
function getMaxVisibleLevel(viewerLevel: number): number {
  return viewerLevel;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup authentication
  await setupAuth(app);

  // Auth routes
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      // Handle both Replit-style (claims.sub) and Supabase-style (id) user objects
      let userId = getUserId(req);
      
      // Debug logging to understand user object structure
      console.log(`[AUTH-USER] getUserId result:`, {
        userId: userId || 'undefined',
        hasUser: !!req.user,
        userStructure: req.user ? {
          hasId: !!(req.user as any).id,
          hasClaims: !!(req.user as any).claims,
          keys: Object.keys(req.user as any),
        } : 'no user',
        hasSupabaseUserId: !!(req.session as any).supabaseUserId,
      });
      
      // Fallback: check multiple session locations if getUserId didn't work
      if (!userId) {
        // Try supabaseUserId from session
        if ((req.session as any).supabaseUserId) {
          userId = (req.session as any).supabaseUserId;
          console.log(`[AUTH-USER] Using Supabase user ID from session: ${userId}`);
        }
        // Try userId from session
        else if ((req.session as any).userId) {
          userId = (req.session as any).userId;
          console.log(`[AUTH-USER] Using userId from session: ${userId}`);
        }
        // Try passport user from session
        else if ((req.session as any)?.passport?.user?.id) {
          userId = (req.session as any).passport.user.id;
          console.log(`[AUTH-USER] Using userId from passport session: ${userId}`);
        }
      }
      
      if (!userId) {
        console.error(`[AUTH-USER] ERROR: Could not find user ID anywhere:`, {
          hasUser: !!req.user,
          userKeys: req.user ? Object.keys(req.user as any) : [],
          sessionKeys: req.session ? Object.keys(req.session as any) : [],
          hasSupabaseUserId: !!(req.session as any).supabaseUserId,
          hasUserId: !!(req.session as any).userId,
          hasPassportUser: !!(req.session as any)?.passport?.user,
        });
        return res.status(401).json({ message: "User ID not found" });
      }
      
      // Check if user exists in database first
      const user = await storage.getUserWithInviter(userId);
      if (user) {
        // User exists - clear any stale pending registration flags
        if ((req.user as any)?.pendingRegistration || (req.session as any)?.pendingRegistration) {
          console.log(`[AUTH-USER] User exists but has pending flags, clearing them`);
          delete (req.session as any).pendingRegistration;
          // Keep supabaseUserId as fallback - don't delete it
          delete (req.session as any).supabaseEmail;
          if (req.user) {
            delete (req.user as any).pendingRegistration;
          }
          // Continue to return user (don't return 401)
        }
        
        // Get additional stats - only count visible invitees
        const invitees = await storage.getInvitees(userId);
        const visibleInvitees = invitees.filter(inv => inv.level <= user.level);
        
        // Sanitize inviter if they are above current user's level (hide their existence)
        const sanitizedInviter = user.inviter && user.inviter.level <= user.level 
          ? sanitizeUser(user.inviter, user.level)
          : undefined;
        
        return res.json({
          ...user,
          inviter: sanitizedInviter,
          inviteCount: visibleInvitees.length,
        });
      }
      
      // User doesn't exist - check for pending registration
      // Return 200 (not 401) when registration is pending, so frontend knows user is authenticated
      // but just needs to complete registration
      if ((req.user as any)?.pendingRegistration || (req.session as any)?.pendingRegistration) {
        return res.json({ 
          message: "Registration pending", 
          pending: true,
          // Include user ID so frontend knows who is registering
          userId: userId,
        });
      }
      
      return res.status(404).json({ message: "User not found" });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Check if first user setup is needed
  app.get("/api/auth/setup-required", async (req, res) => {
    try {
      const userCount = await storage.getUserCount();
      res.json({ setupRequired: userCount === 0 });
    } catch (error) {
      console.error("Error checking setup:", error);
      res.status(500).json({ message: "Failed to check setup status" });
    }
  });

  // Validate invite token
  app.get("/api/invite/:token", async (req, res) => {
    try {
      const link = await storage.getInviteLinkByToken(req.params.token);
      if (!link || link.status !== "active") {
        return res.status(404).json({ valid: false, message: "Invalid or expired invite link" });
      }
      
      const inviter = await storage.getUser(link.invitedByUserId);
      res.json({
        valid: true,
        inviterName: inviter ? inviter.username : "Unknown",
      });
    } catch (error) {
      console.error("Error validating invite:", error);
      res.status(500).json({ message: "Failed to validate invite" });
    }
  });

  // Check pending registration status (requires session but not full auth since user may not be created yet)
  app.get("/api/auth/pending-registration", async (req: any, res) => {
    // Check if there's a session (either Passport authenticated or just session data)
    if (!req.session) {
      return res.status(401).json({ message: "No session" });
    }
    
    let userId = getUserId(req);
    // Fallback: check for Supabase user ID in session if getUserId didn't work
    if (!userId && (req.session as any).supabaseUserId) {
      userId = (req.session as any).supabaseUserId;
      console.log(`[PENDING-REG-CHECK] Using Supabase user ID from session: ${userId}`);
    }
    
    console.log(`[PENDING-REG-CHECK] Checking pending registration:`, {
      hasSession: !!req.session,
      userId: userId || 'none',
      hasPendingInSession: !!req.session.pendingRegistration,
      hasPendingInUser: !!(req.user as any)?.pendingRegistration,
      supabaseUserId: (req.session as any).supabaseUserId || 'none',
      userObject: req.user ? { id: (req.user as any)?.id, hasClaims: !!(req.user as any)?.claims } : 'none',
    });
    
    // If user is authenticated and exists in database, they've completed registration
    if (userId) {
      try {
        const user = await storage.getUser(userId);
        console.log(`[PENDING-REG-CHECK] User lookup result:`, {
          userId,
          found: !!user,
          username: user?.username,
        });
        if (user) {
          // User exists in database, registration is complete
          // Clear any stale pending registration flags
          delete (req.session as any).pendingRegistration;
          delete (req.session as any).supabaseUserId;
          delete (req.session as any).supabaseEmail;
          if (req.user) {
            delete (req.user as any).pendingRegistration;
          }
          console.log(`[PENDING-REG-CHECK] User exists, returning pending: false`);
          return res.json({ pending: false });
        }
      } catch (error) {
        console.error("[PENDING-REG-CHECK] Error checking user in pending-registration:", error);
        // Continue to check pending registration if error
      }
    }
    
    // Check both session data and user object for pending registration
    const pending = req.session?.pendingRegistration || (req.user as any)?.pendingRegistration;
    if (!pending) {
      return res.json({ pending: false });
    }
    
    // If pending is in user object but not session, sync it
    if ((req.user as any)?.pendingRegistration && !req.session.pendingRegistration) {
      const userCount = await storage.getUserCount();
      const pendingFromUser = (req.user as any)?.pendingRegistration;
      // Preserve inviteToken from user object or try to get it from session
      // The user object's pendingRegistration should have the inviteToken from when we logged in
      const inviteToken = pendingFromUser?.inviteToken || 
                          (req.session as any).inviteToken || 
                          undefined;
      const isFirstUser = inviteToken ? false : (userCount === 0);
      req.session.pendingRegistration = {
        email: (req.user as any)?.email,
        inviteToken: inviteToken, // Ensure it's preserved
        invitedByUserId: pendingFromUser?.invitedByUserId,
        isFirstUser: isFirstUser,
      };
      console.log(`[SESSION-SYNC] Synced pending registration to session:`, {
        email: req.session.pendingRegistration.email,
        inviteToken: req.session.pendingRegistration.inviteToken || 'missing',
        invitedByUserId: req.session.pendingRegistration.invitedByUserId || 'missing',
        isFirstUser: req.session.pendingRegistration.isFirstUser,
      });
    }
    
    res.json({
      pending: true,
      isFirstUser: pending.isFirstUser,
      email: pending.email || (req.user as any)?.email,
      // For backward compatibility, try to get name from email or leave undefined
      firstName: pending.firstName,
      lastName: pending.lastName,
    });
  });

  // Complete registration with username
  app.post("/api/auth/complete-registration", async (req: any, res) => {
    try {
      const pending = req.session?.pendingRegistration;
      if (!pending) {
        return res.status(400).json({ message: "No pending registration" });
      }

      // Log to verify inviteToken is present
      console.log(`[COMPLETE-REG] Pending registration from session:`, {
        email: pending.email,
        hasInviteToken: !!pending.inviteToken,
        inviteToken: pending.inviteToken || 'missing',
        invitedByUserId: pending.invitedByUserId || 'missing',
        isFirstUser: pending.isFirstUser,
      });

      const { username } = req.body;
      if (!username || typeof username !== "string") {
        return res.status(400).json({ message: "Username is required" });
      }

      // Get Supabase user ID from session if available (from OAuth flow)
      const supabaseUserId = (req.session as any).supabaseUserId;
      const supabaseEmail = (req.session as any).supabaseEmail;
      
      const result = await completeRegistration(pending, username, undefined, supabaseUserId);
      if (result.error) {
        return res.status(400).json({ message: result.error });
      }

      // Auto-login the user after registration
      if (result.user) {
        console.log(`[COMPLETE-REG] Logging in user after registration:`, {
          userId: result.user.id,
          username: result.user.username,
          email: result.user.email,
        });
        // Verify user object structure before logging in
        console.log(`[COMPLETE-REG] User object structure before logIn:`, {
          hasId: !!(result.user as any).id,
          id: (result.user as any).id,
          keys: Object.keys(result.user as any),
        });
        
        // Ensure user object has id field explicitly set
        const userForLogin = {
          ...result.user,
          id: result.user.id, // Explicitly ensure id is at top level
        };
        
        // Also store userId directly in session as backup
        (req.session as any).userId = result.user.id;
        
        req.logIn(userForLogin, (err: any) => {
          if (err) {
            console.error("[COMPLETE-REG] Error logging in after registration:", err);
            return res.status(500).json({ message: "Registration succeeded but login failed" });
          }
          
          // Verify user object structure after logging in
          console.log(`[COMPLETE-REG] User object structure after logIn:`, {
            hasUser: !!req.user,
            hasId: !!(req.user as any)?.id,
            id: (req.user as any)?.id,
            hasClaims: !!(req.user as any)?.claims,
            keys: req.user ? Object.keys(req.user as any) : [],
            sessionUserId: (req.session as any)?.userId,
            sessionPassportUserId: (req.session as any)?.passport?.user?.id,
          });
          
          // Clear pending registration flags but KEEP supabaseUserId and userId as fallback
          // These are needed as fallback for getUserId when req.user structure doesn't match
          delete req.session.pendingRegistration;
          // DON'T delete supabaseUserId or userId - they're needed as fallback for getUserId
          delete (req.session as any).supabaseEmail;

          // Also clear pendingRegistration from user object if it exists
          if (req.user) {
            delete (req.user as any).pendingRegistration;
          }
          
          console.log(`[COMPLETE-REG] User logged in, saving session...`);
          // Save session and THEN verify user exists
          req.session.save((saveErr) => {
            if (saveErr) {
              console.error("[COMPLETE-REG] Error saving session after registration:", saveErr);
              return res.status(500).json({ message: "Registration succeeded but session save failed" });
            }
            
            console.log(`[COMPLETE-REG] Session saved, verifying user in database...`);
            // Verify user exists in database after session is saved
            storage.getUser(result.user.id).then((verifiedUser) => {
              if (!verifiedUser) {
                console.error("[COMPLETE-REG] ERROR: User not found in database after creation!");
                return res.status(500).json({ message: "User created but not found in database" });
              }
              
              // Double-check that pending registration is cleared (but keep supabaseUserId)
              delete (req.session as any).pendingRegistration;
              if (req.user) {
                delete (req.user as any).pendingRegistration;
              }
              // Note: We intentionally keep supabaseUserId in session as fallback
              
              console.log(`[COMPLETE-REG] User verified in database, generating token...`);
              // Generate JWT token for serverless compatibility
              const jwtToken = generateToken(result.user);
              // Store token in cookie for serverless
              res.cookie('jwt', jwtToken, {
                httpOnly: true,
                secure: true, // Always secure on Vercel
                sameSite: getCookieSameSite(), // Use 'lax' for same-domain
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                path: '/', // Ensure cookie is available site-wide
              });
              console.log(`[COMPLETE-REG] Registration complete, returning success`);
              return res.json({ success: true, user: result.user, token: jwtToken });
            }).catch((verifyErr) => {
              console.error("[COMPLETE-REG] Error verifying user:", verifyErr);
              return res.status(500).json({ message: "Registration succeeded but verification failed" });
            });
          });
        });
      } else {
        res.status(500).json({ message: "Registration failed: user not created" });
      }
    } catch (error) {
      console.error("Error completing registration:", error);
      res.status(500).json({ message: "Failed to complete registration" });
    }
  });

  // Check username availability
  app.get("/api/username/check/:username", async (req, res) => {
    try {
      const username = req.params.username.toLowerCase().trim();
      
      // Validate format
      if (username.length < 3 || username.length > 30) {
        return res.json({ available: false, reason: "Username must be 3-30 characters" });
      }
      if (!/^[a-z0-9_]+$/.test(username)) {
        return res.json({ available: false, reason: "Username can only contain letters, numbers, and underscores" });
      }
      
      const available = await storage.isUsernameAvailable(username);
      res.json({ available, reason: available ? null : "Username is already taken" });
    } catch (error) {
      console.error("Error checking username:", error);
      res.status(500).json({ message: "Failed to check username" });
    }
  });

  // Update username (self or Level 5 can edit others)
  app.patch("/api/users/:userId/username", isAuthenticated, async (req: any, res) => {
    try {
      const targetUserId = req.params.userId;
      const currentUserId = getUserId(req);
      const { username } = req.body;

      // Get current user
      const currentUser = await storage.getUser(currentUserId);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Check permissions: self-edit or Level 5
      const isSelf = targetUserId === currentUserId;
      const isLevel5 = currentUser.level === 5;
      
      if (!isSelf && !isLevel5) {
        return res.status(403).json({ message: "Only Level 5 members can edit other users' usernames" });
      }

      // Validate username
      const normalizedUsername = username.toLowerCase().trim();
      if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
        return res.status(400).json({ message: "Username must be 3-30 characters" });
      }
      if (!/^[a-z0-9_]+$/.test(normalizedUsername)) {
        return res.status(400).json({ message: "Username can only contain letters, numbers, and underscores" });
      }

      // Check availability (excluding target user's current username)
      const available = await storage.isUsernameAvailable(normalizedUsername, targetUserId);
      if (!available) {
        return res.status(400).json({ message: "Username is already taken" });
      }

      const updatedUser = await storage.updateUsername(targetUserId, normalizedUsername);
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating username:", error);
      res.status(500).json({ message: "Failed to update username" });
    }
  });

  // === User endpoints ===
  
  app.get("/api/users", isAuthenticated, async (req: any, res) => {
    try {
      const requestingUser = await storage.getUser(getUserId(req));
      if (!requestingUser) {
        return res.status(401).json({ message: "User not found" });
      }
      
      const level = req.query.level ? parseInt(req.query.level as string) : undefined;
      const allUsers = await storage.getUsersByLevel(level);
      
      // Filter users to only show those at or below the viewer's level
      // and sanitize based on viewer's level (hide emails unless Level 5)
      const visibleUsers = filterAndSanitizeUsers(allUsers, requestingUser.level);
      
      res.json(visibleUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get("/api/users/:id", isAuthenticated, async (req: any, res) => {
    try {
      const requestingUser = await storage.getUser(getUserId(req));
      if (!requestingUser) {
        return res.status(401).json({ message: "User not found" });
      }
      
      const user = await storage.getUserWithInviter(req.params.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Check visibility: can only see users at or below your level
      if (user.level > requestingUser.level) {
        return res.status(403).json({ message: "You cannot view this user's profile" });
      }
      
      const invitees = await storage.getInvitees(req.params.id);
      
      // Sanitize the user, inviter, and invitees based on viewer's level
      const sanitizedUser = sanitizeUser(user, requestingUser.level);
      const sanitizedInviter = user.inviter ? sanitizeUser(user.inviter, requestingUser.level) : undefined;
      const sanitizedInvitees = filterAndSanitizeUsers(invitees, requestingUser.level);
      
      res.json({
        ...sanitizedUser,
        inviter: sanitizedInviter,
        invitees: sanitizedInvitees,
        inviteCount: sanitizedInvitees.length,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.get("/api/users/:id/invitees", isAuthenticated, async (req: any, res) => {
    try {
      const requestingUser = await storage.getUser(getUserId(req));
      if (!requestingUser) {
        return res.status(401).json({ message: "User not found" });
      }
      
      // Check if viewer can access the target user's invitees
      const targetUser = await storage.getUser(req.params.id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      if (targetUser.level > requestingUser.level) {
        return res.status(403).json({ message: "Not authorized" });
      }
      
      const invitees = await storage.getInvitees(req.params.id);
      const sanitizedInvitees = filterAndSanitizeUsers(invitees, requestingUser.level);
      res.json(sanitizedInvitees);
    } catch (error) {
      console.error("Error fetching invitees:", error);
      res.status(500).json({ message: "Failed to fetch invitees" });
    }
  });

  // Direct level change (Level 5 only, non-Level-5 targets)
  app.post("/api/users/:id/level", isAuthenticated, requireLevel(5), async (req: any, res) => {
    try {
      const { newLevel, reason } = req.body;
      if (!newLevel || !reason) {
        return res.status(400).json({ message: "newLevel and reason are required" });
      }
      
      const targetUser = await storage.getUser(req.params.id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Cannot directly change Level 5 users (must use governance process)
      if (targetUser.level === 5 && newLevel !== 5) {
        return res.status(400).json({ message: "Level 5 demotions require the governance voting process" });
      }
      if (newLevel === 5 && targetUser.level !== 5) {
        return res.status(400).json({ message: "Level 5 promotions require the governance voting process" });
      }
      
      const user = await storage.updateUserLevel(
        req.params.id,
        newLevel,
        getUserId(req),
        reason
      );
      res.json(user);
    } catch (error) {
      console.error("Error updating user level:", error);
      res.status(500).json({ message: "Failed to update user level" });
    }
  });

  // Self-demotion endpoint (any member can demote themselves)
  app.post("/api/users/self/demote", isAuthenticated, async (req: any, res) => {
    try {
      const { newLevel, reason } = req.body;
      
      // Validate required fields
      if (newLevel === undefined || newLevel === null || !reason) {
        return res.status(400).json({ message: "newLevel and reason are required" });
      }
      
      // Convert newLevel to number and validate
      const newLevelNum = typeof newLevel === 'string' ? parseInt(newLevel, 10) : Number(newLevel);
      if (isNaN(newLevelNum) || !Number.isInteger(newLevelNum)) {
        return res.status(400).json({ message: "newLevel must be a valid integer" });
      }
      
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Validate: newLevel must be less than current level
      if (newLevelNum >= user.level) {
        return res.status(400).json({ message: "New level must be lower than your current level" });
      }
      
      // Cannot demote to level 0 or below
      if (newLevelNum < 1) {
        return res.status(400).json({ message: "Level cannot be less than 1" });
      }
      
      // Validate reason is a non-empty string
      if (typeof reason !== 'string' || reason.trim().length === 0) {
        return res.status(400).json({ message: "Reason must be a non-empty string" });
      }
      
      // Validate using Zod schema for additional type safety
      const trimmedReason = reason.trim();
      try {
        const validatedData = selfDemotionRequestSchema.parse({
          newLevel: newLevelNum,
          reason: trimmedReason,
        });
        
        const updatedUser = await storage.updateUserLevel(
          userId,
          validatedData.newLevel,
          userId, // Changed by themselves
          `Self-demotion: ${validatedData.reason}`
        );
        res.json(updatedUser);
      } catch (zodError) {
        if (zodError instanceof z.ZodError) {
          console.error("Self-demotion validation error:", {
            newLevel: newLevelNum,
            reasonLength: trimmedReason.length,
            reason: trimmedReason.substring(0, 50), // First 50 chars for debugging
            errors: zodError.errors,
          });
          
          // Extract the first error message for the main message
          const firstError = zodError.errors[0];
          const errorMessage = firstError 
            ? `${firstError.path.join('.')}: ${firstError.message}`
            : "Validation failed";
          
          return res.status(400).json({ 
            message: errorMessage,
            errors: zodError.errors.map(e => ({
              path: e.path.join('.'),
              message: e.message,
            }))
          });
        }
        throw zodError;
      }
    } catch (error) {
      console.error("Error in self-demotion:", error);
      // Provide more specific error messages
      if (error instanceof Error) {
        return res.status(500).json({ message: error.message || "Failed to demote yourself" });
      }
      res.status(500).json({ message: "Failed to demote yourself" });
    }
  });

  // Level 5 governance info endpoint - only visible to Level 5
  app.get("/api/level5-governance", isAuthenticated, async (req: any, res) => {
    try {
      const requestingUser = await storage.getUser(getUserId(req));
      if (!requestingUser) {
        return res.status(401).json({ message: "User not found" });
      }
      
      // Non-Level 5 users should not know about Level 5 governance
      if (requestingUser.level < 5) {
        return res.status(403).json({ message: "Not authorized" });
      }
      
      const level5Count = await storage.countLevel5Users();
      const voteThreshold = await storage.getLevel5VoteThreshold();
      const canBootstrap = await storage.canBootstrapPromoteToLevel5();
      
      res.json({
        level5Count,
        voteThreshold,
        canBootstrap,
        rules: {
          description: canBootstrap 
            ? "As the only Level 5, you can directly promote 1 user to Level 5 without voting."
            : level5Count === 2
              ? "With 2 Level 5 members, Level 5 changes require unanimous 2 votes."
              : "With 3+ Level 5 members, Level 5 changes require 3 votes.",
        }
      });
    } catch (error) {
      console.error("Error fetching governance info:", error);
      res.status(500).json({ message: "Failed to fetch governance info" });
    }
  });

  // Bootstrap direct promotion to Level 5 (only when there's exactly 1 Level 5)
  app.post("/api/level5-governance/bootstrap-promote", isAuthenticated, requireLevel(5), async (req: any, res) => {
    try {
      const { candidateUserId, reason } = req.body;
      if (!candidateUserId || !reason) {
        return res.status(400).json({ message: "candidateUserId and reason are required" });
      }
      
      const canBootstrap = await storage.canBootstrapPromoteToLevel5();
      if (!canBootstrap) {
        return res.status(400).json({ message: "Bootstrap promotion is only available when there is exactly 1 Level 5 member" });
      }
      
      const candidate = await storage.getUser(candidateUserId);
      if (!candidate) {
        return res.status(404).json({ message: "Candidate not found" });
      }
      if (candidate.level === 5) {
        return res.status(400).json({ message: "User is already Level 5" });
      }
      
      const user = await storage.updateUserLevel(
        candidateUserId,
        5,
        getUserId(req),
        `Bootstrap promotion to Level 5: ${reason}`
      );
      res.json(user);
    } catch (error) {
      console.error("Error bootstrap promoting:", error);
      res.status(500).json({ message: "Failed to bootstrap promote to Level 5" });
    }
  });

  // === Invite link endpoints ===
  
  app.get("/api/invites", isAuthenticated, async (req: any, res) => {
    try {
      const links = await storage.getInviteLinksByUser(getUserId(req));
      
      // Add invitee info for used links
      const linksWithDetails = await Promise.all(
        links.map(async (link) => {
          let usedByName: string | undefined;
          if (link.usedByUserId) {
            const usedBy = await storage.getUser(link.usedByUserId);
            usedByName = usedBy ? `${usedBy.firstName || ""} ${usedBy.lastName || ""}`.trim() || usedBy.email || undefined : undefined;
          }
          return { ...link, usedByName };
        })
      );
      
      res.json(linksWithDetails);
    } catch (error) {
      console.error("Error fetching invites:", error);
      res.status(500).json({ message: "Failed to fetch invites" });
    }
  });

  app.post("/api/invites", isAuthenticated, async (req: any, res) => {
    try {
      const link = await storage.createInviteLink(getUserId(req));
      res.json(link);
    } catch (error) {
      console.error("Error creating invite:", error);
      res.status(500).json({ message: "Failed to create invite link" });
    }
  });

  // === Promotion request endpoints ===
  
  app.get("/api/promotions", isAuthenticated, async (req: any, res) => {
    try {
      const requestingUser = await storage.getUser(getUserId(req));
      if (!requestingUser) {
        return res.status(401).json({ message: "User not found" });
      }
      
      const status = req.query.status as "open" | "approved" | "rejected" | "expired" | undefined;
      const requests = await storage.getPromotionRequests(status);
      
      // Filter promotions to only show those where both current and proposed levels
      // are within the viewer's visible range
      const visibleRequests = requests.filter(r => 
        r.currentLevel <= requestingUser.level && r.proposedLevel <= requestingUser.level
      );
      
      // Get details for each visible request
      const requestsWithDetails = await Promise.all(
        visibleRequests.map(async (r) => {
          const details = await storage.getPromotionRequestWithDetails(r.id);
          if (!details) return null;
          
          // Sanitize user data in the response (handle potential undefined users)
          // Filter out votes from higher-level users to prevent leaking their existence
          const visibleVotes = (details.votes || []).filter((v: any) => 
            v.voter && v.voter.level <= requestingUser.level
          ).map((v: any) => ({
            ...v,
            voter: sanitizeUser(v.voter!, requestingUser.level),
          }));
          
          return {
            ...details,
            candidate: details.candidate ? sanitizeUser(details.candidate, requestingUser.level) : null,
            createdBy: details.createdBy ? sanitizeUser(details.createdBy, requestingUser.level) : null,
            proposer: details.proposer ? sanitizeUser(details.proposer, requestingUser.level) : null, // Keep for backward compatibility
            votes: visibleVotes,
            votesFor: visibleVotes.filter((v: any) => v.vote === "for").length,
            votesAgainst: visibleVotes.filter((v: any) => v.vote === "against").length,
          };
        })
      );
      
      // Filter out any requests where candidate or createdBy couldn't be resolved
      const validRequests = requestsWithDetails.filter(r => 
        r !== null && r.candidate !== null && r.createdBy !== null
      );
      res.json(validRequests);
    } catch (error) {
      console.error("Error fetching promotions:", error);
      res.status(500).json({ message: "Failed to fetch promotions" });
    }
  });

  app.get("/api/promotions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const requestingUser = await storage.getUser(getUserId(req));
      if (!requestingUser) {
        return res.status(401).json({ message: "User not found" });
      }
      
      const request = await storage.getPromotionRequestWithDetails(req.params.id);
      if (!request) {
        return res.status(404).json({ message: "Promotion request not found" });
      }
      
      // Check if viewer can see this promotion (both levels must be visible)
      if (request.currentLevel > requestingUser.level || request.proposedLevel > requestingUser.level) {
        return res.status(403).json({ message: "Not authorized" });
      }
      
      // Sanitize user data (handle potential undefined users)
      // Filter out votes from higher-level users to prevent leaking their existence
      const visibleVotes = (request.votes || []).filter((v: any) => 
        v.voter && v.voter.level <= requestingUser.level
      ).map((v: any) => ({
        ...v,
        voter: sanitizeUser(v.voter!, requestingUser.level),
      }));
      
      res.json({
        ...request,
        candidate: request.candidate ? sanitizeUser(request.candidate, requestingUser.level) : null,
        createdBy: request.createdBy ? sanitizeUser(request.createdBy, requestingUser.level) : null,
        proposer: request.proposer ? sanitizeUser(request.proposer, requestingUser.level) : null, // Keep for backward compatibility
        votes: visibleVotes,
        votesFor: visibleVotes.filter((v: any) => v.vote === "for").length,
        votesAgainst: visibleVotes.filter((v: any) => v.vote === "against").length,
      });
    } catch (error) {
      console.error("Error fetching promotion:", error);
      res.status(500).json({ message: "Failed to fetch promotion" });
    }
  });

  app.post("/api/promotions", isAuthenticated, async (req: any, res) => {
    try {
      const requestType = req.body.requestType || "PROMOTE";
      const userId = getUserId(req);
      const creator = await storage.getUser(userId);
      
      if (!creator) {
        return res.status(401).json({ message: "User not found" });
      }
      
      // Get the candidate to check levels
      const candidate = await storage.getUser(req.body.candidateUserId);
      if (!candidate) {
        return res.status(404).json({ message: "Candidate not found" });
      }
      
      // Validate that supplied currentLevel matches actual candidate level
      const suppliedCurrentLevel = parseInt(req.body.currentLevel);
      if (suppliedCurrentLevel !== candidate.level) {
        return res.status(400).json({ message: "Current level does not match candidate's actual level" });
      }
      
      // Validate proposedLevel makes sense for the request type
      const proposedLevel = parseInt(req.body.proposedLevel);
      if (requestType === "PROMOTE" || requestType === "PROMOTE_TO_5") {
        if (proposedLevel <= candidate.level) {
          return res.status(400).json({ message: "Promotion must increase the level" });
        }
        if (proposedLevel > 5) {
          return res.status(400).json({ message: "Level cannot exceed 5" });
        }
      } else if (requestType === "DEMOTE" || requestType === "DEMOTE_FROM_5") {
        if (proposedLevel >= candidate.level) {
          return res.status(400).json({ message: "Demotion must decrease the level" });
        }
        if (proposedLevel < 1) {
          return res.status(400).json({ message: "Level cannot be less than 1" });
        }
      }
      
      // Rule: Creator level must be >= candidate level
      if (creator.level < candidate.level) {
        return res.status(403).json({ message: "You can only create requests for members at or below your level" });
      }
      
      // Level 5 governance requests require Level 5
      if ((requestType === "PROMOTE_TO_5" || requestType === "DEMOTE_FROM_5") && creator.level < 5) {
        return res.status(403).json({ message: "Only Level 5 members can create Level 5 governance requests" });
      }
      
      // Check if bootstrap should be used instead
      if (requestType === "PROMOTE_TO_5") {
        const canBootstrap = await storage.canBootstrapPromoteToLevel5();
        if (canBootstrap) {
          return res.status(400).json({ message: "Use bootstrap promotion when there is only 1 Level 5 member" });
        }
      }
      
      // Cannot demote last Level 5
      if (requestType === "DEMOTE_FROM_5") {
        const canDemote = await storage.canDemoteFromLevel5(req.body.candidateUserId);
        if (!canDemote) {
          return res.status(400).json({ message: "Cannot demote the last remaining Level 5 member" });
        }
      }
      
      // Determine required votes and allowed voter min level based on request type
      let requiredVotes = req.body.requiredVotes || 3;
      let allowedVoterMinLevel = candidate.level; // Default: voters must be at candidate's level or above
      
      if (requestType === "PROMOTE_TO_5" || requestType === "DEMOTE_FROM_5") {
        requiredVotes = await storage.getLevel5VoteThreshold();
        allowedVoterMinLevel = 5; // Only Level 5 can vote on Level 5 governance
      }
      
      const data = insertPromotionRequestSchema.parse({
        candidateUserId: req.body.candidateUserId,
        currentLevel: candidate.level, // Use actual candidate level, not supplied value
        proposedLevel: proposedLevel,
        createdByUserId: userId,
        justification: req.body.justification,
        requestType,
        requiredVotes,
        allowedVoterMinLevel,
      });
      
      const request = await storage.createPromotionRequest(data);
      res.json(request);
    } catch (error) {
      console.error("Error creating promotion:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create promotion request" });
    }
  });

  // === Vote endpoints ===
  
  app.post("/api/promotions/:id/vote", isAuthenticated, async (req: any, res) => {
    try {
      const promotionId = req.params.id;
      const userId = getUserId(req);
      const voter = await storage.getUser(userId);
      
      if (!voter) {
        return res.status(401).json({ message: "User not found" });
      }
      
      // Get the promotion to check requirements
      const promotion = await storage.getPromotionRequestWithDetails(promotionId);
      if (!promotion) {
        return res.status(404).json({ message: "Promotion request not found" });
      }
      
      if (promotion.status !== "open") {
        return res.status(400).json({ message: "This promotion is no longer open for voting" });
      }
      
      // Rule 1: Voter level must be >= allowedVoterMinLevel
      if (voter.level < promotion.allowedVoterMinLevel) {
        return res.status(403).json({ message: `Level ${promotion.allowedVoterMinLevel}+ required to vote on this request` });
      }
      
      // Rule 2: Voter level must be >= candidate's current level
      // (You can only influence your level or lower, never people above you)
      if (voter.level < promotion.currentLevel) {
        return res.status(403).json({ message: "You can only vote on requests for members at or below your level" });
      }
      
      // Check if already voted
      const hasVoted = await storage.hasUserVoted(promotionId, userId);
      if (hasVoted) {
        return res.status(400).json({ message: "You have already voted on this request" });
      }
      
      // Validate vote data
      const voteData = insertVoteSchema.parse({
        promotionRequestId: promotionId,
        voterUserId: userId,
        vote: req.body.vote,
        comment: req.body.comment,
      });
      
      await storage.createVote(voteData);
      
      // Process votes (check if request should be approved)
      const updatedRequest = await storage.processPromotionVotes(promotionId);
      
      res.json({ success: true, promotionStatus: updatedRequest.status });
    } catch (error) {
      console.error("Error voting:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid vote data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to submit vote" });
    }
  });

  // === Stats endpoint ===
  
  app.get("/api/stats", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
      const allUsers = await storage.getUsersByLevel();
      const myInvites = await storage.getInvitees(userId);
      const openPromotions = await storage.getPromotionRequests("open");
      
      // Only show users at or below viewer's level
      const visibleUsers = allUsers.filter(u => u.level <= user.level);
      
      // Only count visible invitees to prevent leaking info about higher-level users
      const visibleInvites = myInvites.filter(u => u.level <= user.level);
      
      // Count users by level - only show levels <= viewer level
      const levelCounts = [];
      for (let level = 1; level <= user.level; level++) {
        levelCounts.push({
          level,
          count: visibleUsers.filter(u => u.level === level).length,
        });
      }
      
      // Filter promotions - only show those where candidate is at viewer's visible level or below
      // and proposed level is also within viewer's visible range
      const visiblePromotions = openPromotions.filter(promo => 
        promo.currentLevel <= user.level && promo.proposedLevel <= user.level
      );
      
      // Count promotions needing my vote
      let pendingMyVote = 0;
      if (user.level >= 4) {
        for (const promo of visiblePromotions) {
          const hasVoted = await storage.hasUserVoted(promo.id, userId);
          if (!hasVoted && promo.allowedVoterMinLevel <= user.level) {
            pendingMyVote++;
          }
        }
      }
      
      res.json({
        totalMembers: visibleUsers.length,
        myInviteCount: visibleInvites.length,
        pendingPromotions: visiblePromotions.length,
        pendingMyVote,
        levelDistribution: levelCounts,
        maxVisibleLevel: user.level,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  return httpServer;
}
