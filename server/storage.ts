import {
  users,
  inviteLinks,
  promotionRequests,
  votes,
  userLevelHistory,
  type User,
  type UpsertUser,
  type InviteLink,
  type InsertInviteLink,
  type PromotionRequest,
  type InsertPromotionRequest,
  type Vote,
  type InsertVote,
  type UserLevelHistory,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { randomBytes } from "crypto";

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // User queries
  getUserCount(): Promise<number>;
  getUsersByLevel(level?: number): Promise<User[]>;
  getUserWithInviter(id: string): Promise<(User & { inviter?: User }) | undefined>;
  getInvitees(userId: string): Promise<User[]>;
  updateUserLevel(userId: string, newLevel: number, changedByUserId: string, reason: string): Promise<User>;
  
  // Level 5 governance helpers
  countLevel5Users(): Promise<number>;
  getLevel5VoteThreshold(): Promise<number>;
  canBootstrapPromoteToLevel5(): Promise<boolean>;
  canDemoteFromLevel5(targetUserId: string): Promise<boolean>;
  
  // Username operations
  isUsernameAvailable(username: string, excludeUserId?: string): Promise<boolean>;
  updateUsername(userId: string, newUsername: string): Promise<User>;
  getUserByUsername(username: string): Promise<User | undefined>;
  
  // Invite link operations
  createInviteLink(userId: string): Promise<InviteLink>;
  getInviteLinkByToken(token: string): Promise<InviteLink | undefined>;
  getInviteLinksByUser(userId: string): Promise<InviteLink[]>;
  useInviteLink(token: string, usedByUserId: string): Promise<InviteLink>;
  
  // Promotion request operations
  createPromotionRequest(data: InsertPromotionRequest): Promise<PromotionRequest>;
  getPromotionRequests(status?: "open" | "approved" | "rejected" | "expired"): Promise<PromotionRequest[]>;
  getPromotionRequestWithDetails(id: string): Promise<any>;
  
  // Vote operations
  createVote(data: InsertVote): Promise<Vote>;
  getVotesByPromotionRequest(promotionRequestId: string): Promise<Vote[]>;
  hasUserVoted(promotionRequestId: string, userId: string): Promise<boolean>;
  processPromotionVotes(promotionRequestId: string): Promise<PromotionRequest>;
  
  // Level history
  getLevelHistory(userId: string): Promise<UserLevelHistory[]>;
}

export class DatabaseStorage implements IStorage {
  // User operations (required for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // User queries
  async getUserCount(): Promise<number> {
    const [result] = await db.select({ count: count() }).from(users);
    return result?.count || 0;
  }

  async getUsersByLevel(level?: number): Promise<User[]> {
    if (level !== undefined) {
      return db.select().from(users).where(eq(users.level, level)).orderBy(desc(users.createdAt));
    }
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getUserWithInviter(id: string): Promise<(User & { inviter?: User }) | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) return undefined;
    
    let inviter: User | undefined;
    if (user.invitedByUserId) {
      const [inv] = await db.select().from(users).where(eq(users.id, user.invitedByUserId));
      inviter = inv;
    }
    
    return { ...user, inviter };
  }

  async getInvitees(userId: string): Promise<User[]> {
    return db.select().from(users).where(eq(users.invitedByUserId, userId)).orderBy(desc(users.createdAt));
  }

  async updateUserLevel(userId: string, newLevel: number, changedByUserId: string, reason: string): Promise<User> {
    const [currentUser] = await db.select().from(users).where(eq(users.id, userId));
    if (!currentUser) throw new Error("User not found");

    // Record history
    await db.insert(userLevelHistory).values({
      userId,
      previousLevel: currentUser.level,
      newLevel,
      changedByUserId,
      reason,
    });

    // Update user
    const [updated] = await db
      .update(users)
      .set({ level: newLevel, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    
    return updated;
  }

  // Level 5 governance helpers
  async countLevel5Users(): Promise<number> {
    const [result] = await db.select({ count: count() }).from(users).where(eq(users.level, 5));
    return result?.count || 0;
  }

  async getLevel5VoteThreshold(): Promise<number> {
    const level5Count = await this.countLevel5Users();
    if (level5Count <= 1) return 0; // Bootstrap mode - no voting required
    if (level5Count === 2) return 2; // Unanimous
    return 3; // 3 or more Level 5s
  }

  async canBootstrapPromoteToLevel5(): Promise<boolean> {
    const level5Count = await this.countLevel5Users();
    return level5Count === 1;
  }

  async canDemoteFromLevel5(targetUserId: string): Promise<boolean> {
    const level5Count = await this.countLevel5Users();
    // Cannot demote the last remaining Level 5
    if (level5Count <= 1) return false;
    return true;
  }

  // Username operations
  async isUsernameAvailable(username: string, excludeUserId?: string): Promise<boolean> {
    const normalizedUsername = username.toLowerCase().trim();
    const existing = await db.select().from(users).where(eq(users.username, normalizedUsername));
    if (existing.length === 0) return true;
    if (excludeUserId && existing.length === 1 && existing[0].id === excludeUserId) return true;
    return false;
  }

  async updateUsername(userId: string, newUsername: string): Promise<User> {
    const normalizedUsername = newUsername.toLowerCase().trim();
    const [updated] = await db
      .update(users)
      .set({ username: normalizedUsername, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const normalizedUsername = username.toLowerCase().trim();
    const [user] = await db.select().from(users).where(eq(users.username, normalizedUsername));
    return user;
  }

  // Invite link operations
  async createInviteLink(userId: string): Promise<InviteLink> {
    const token = randomBytes(16).toString("hex");
    const [link] = await db
      .insert(inviteLinks)
      .values({
        token,
        invitedByUserId: userId,
        maxUses: 1,
      })
      .returning();
    return link;
  }

  async getInviteLinkByToken(token: string): Promise<InviteLink | undefined> {
    const [link] = await db.select().from(inviteLinks).where(eq(inviteLinks.token, token));
    return link;
  }

  async getInviteLinksByUser(userId: string): Promise<InviteLink[]> {
    return db
      .select()
      .from(inviteLinks)
      .where(eq(inviteLinks.invitedByUserId, userId))
      .orderBy(desc(inviteLinks.createdAt));
  }

  async useInviteLink(token: string, usedByUserId: string): Promise<InviteLink> {
    const [link] = await db.select().from(inviteLinks).where(eq(inviteLinks.token, token));
    if (!link) throw new Error("Invite link not found");
    if (link.status !== "active") throw new Error("Invite link is not active");
    if (link.maxUses && link.usesCount >= link.maxUses) throw new Error("Invite link has reached max uses");

    const newUsesCount = link.usesCount + 1;
    const newStatus = link.maxUses && newUsesCount >= link.maxUses ? "used" : "active";

    const [updated] = await db
      .update(inviteLinks)
      .set({
        usesCount: newUsesCount,
        status: newStatus as "active" | "used",
        usedByUserId,
      })
      .where(eq(inviteLinks.token, token))
      .returning();
    
    return updated;
  }

  // Promotion request operations
  async createPromotionRequest(data: InsertPromotionRequest): Promise<PromotionRequest> {
    const [request] = await db.insert(promotionRequests).values(data).returning();
    return request;
  }

  async getPromotionRequests(status?: "open" | "approved" | "rejected" | "expired"): Promise<PromotionRequest[]> {
    if (status) {
      return db
        .select()
        .from(promotionRequests)
        .where(eq(promotionRequests.status, status))
        .orderBy(desc(promotionRequests.createdAt));
    }
    return db.select().from(promotionRequests).orderBy(desc(promotionRequests.createdAt));
  }

  async getPromotionRequestWithDetails(id: string): Promise<any> {
    const [request] = await db.select().from(promotionRequests).where(eq(promotionRequests.id, id));
    if (!request) return undefined;

    const [candidate] = await db.select().from(users).where(eq(users.id, request.candidateUserId));
    const [createdBy] = await db.select().from(users).where(eq(users.id, request.createdByUserId));
    const requestVotes = await db.select().from(votes).where(eq(votes.promotionRequestId, id));

    const votesFor = requestVotes.filter(v => v.vote === "for").length;
    const votesAgainst = requestVotes.filter(v => v.vote === "against").length;

    return {
      ...request,
      candidate,
      createdBy,
      votes: requestVotes,
      votesFor,
      votesAgainst,
    };
  }

  // Vote operations
  async createVote(data: InsertVote): Promise<Vote> {
    const [vote] = await db.insert(votes).values(data).returning();
    return vote;
  }

  async getVotesByPromotionRequest(promotionRequestId: string): Promise<Vote[]> {
    return db.select().from(votes).where(eq(votes.promotionRequestId, promotionRequestId));
  }

  async hasUserVoted(promotionRequestId: string, userId: string): Promise<boolean> {
    const [vote] = await db
      .select()
      .from(votes)
      .where(and(eq(votes.promotionRequestId, promotionRequestId), eq(votes.voterUserId, userId)));
    return !!vote;
  }

  async processPromotionVotes(promotionRequestId: string): Promise<PromotionRequest> {
    const [request] = await db.select().from(promotionRequests).where(eq(promotionRequests.id, promotionRequestId));
    if (!request || request.status !== "open") {
      return request;
    }

    const allVotes = await db.select().from(votes).where(eq(votes.promotionRequestId, promotionRequestId));
    const votesFor = allVotes.filter(v => v.vote === "for").length;

    if (votesFor >= request.requiredVotes) {
      // Determine the action type based on request type
      const requestType = request.requestType || "PROMOTE";
      let reason = `Promotion approved by vote (${votesFor} votes for)`;
      
      // Defensive check: ensure level change matches request type
      const isPromotion = requestType === "PROMOTE" || requestType === "PROMOTE_TO_5";
      const isDemotion = requestType === "DEMOTE" || requestType === "DEMOTE_FROM_5";
      
      if (isPromotion && request.proposedLevel <= request.currentLevel) {
        console.error(`Invalid promotion: proposedLevel ${request.proposedLevel} is not greater than currentLevel ${request.currentLevel}`);
        return request; // Don't apply invalid level change
      }
      if (isDemotion && request.proposedLevel >= request.currentLevel) {
        console.error(`Invalid demotion: proposedLevel ${request.proposedLevel} is not less than currentLevel ${request.currentLevel}`);
        return request; // Don't apply invalid level change
      }
      
      if (isDemotion) {
        reason = `Demotion approved by vote (${votesFor} votes for)`;
      } else if (requestType === "PROMOTE_TO_5") {
        reason = `Level 5 promotion approved by vote (${votesFor} votes for)`;
      }
      
      // Apply the level change
      await this.updateUserLevel(
        request.candidateUserId,
        request.proposedLevel,
        request.createdByUserId,
        reason
      );

      const [updated] = await db
        .update(promotionRequests)
        .set({ status: "approved", updatedAt: new Date() })
        .where(eq(promotionRequests.id, promotionRequestId))
        .returning();
      
      return updated;
    }

    return request;
  }

  // Level history
  async getLevelHistory(userId: string): Promise<UserLevelHistory[]> {
    return db
      .select()
      .from(userLevelHistory)
      .where(eq(userLevelHistory.userId, userId))
      .orderBy(desc(userLevelHistory.createdAt));
  }
}

export const storage = new DatabaseStorage();
