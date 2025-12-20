import { sql, relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  integer,
  text,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userStatusEnum = pgEnum("user_status", ["active", "suspended", "expelled"]);
export const inviteLinkStatusEnum = pgEnum("invite_link_status", ["active", "disabled", "expired", "used"]);
export const promotionStatusEnum = pgEnum("promotion_status", ["open", "approved", "rejected", "expired"]);
export const voteTypeEnum = pgEnum("vote_type", ["for", "against"]);
export const requestTypeEnum = pgEnum("request_type", ["PROMOTE", "DEMOTE", "PROMOTE_TO_5", "DEMOTE_FROM_5"]);

// Session storage table - Required for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table - Extended for membership system
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: varchar("username").unique().notNull(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  level: integer("level").notNull().default(1),
  status: userStatusEnum("status").notNull().default("active"),
  invitedByUserId: varchar("invited_by_user_id"),
  agreementAcceptedAt: timestamp("agreement_accepted_at"),
  agreementVersion: integer("agreement_version"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Invite links table
export const inviteLinks = pgTable("invite_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: varchar("token").notNull().unique(),
  invitedByUserId: varchar("invited_by_user_id").notNull().references(() => users.id),
  maxUses: integer("max_uses").default(1),
  usesCount: integer("uses_count").notNull().default(0),
  status: inviteLinkStatusEnum("status").notNull().default("active"),
  usedByUserId: varchar("used_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Promotion requests table
export const promotionRequests = pgTable("promotion_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  candidateUserId: varchar("candidate_user_id").notNull().references(() => users.id),
  currentLevel: integer("current_level").notNull(),
  proposedLevel: integer("proposed_level").notNull(),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  requestType: requestTypeEnum("request_type").notNull().default("PROMOTE"),
  status: promotionStatusEnum("status").notNull().default("open"),
  requiredVotes: integer("required_votes").notNull().default(3),
  allowedVoterMinLevel: integer("allowed_voter_min_level").notNull().default(4),
  justification: text("justification").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Votes table
export const votes = pgTable("votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  promotionRequestId: varchar("promotion_request_id").notNull().references(() => promotionRequests.id),
  voterUserId: varchar("voter_user_id").notNull().references(() => users.id),
  vote: voteTypeEnum("vote").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow(),
});

// User level history table
export const userLevelHistory = pgTable("user_level_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  previousLevel: integer("previous_level").notNull(),
  newLevel: integer("new_level").notNull(),
  changedByUserId: varchar("changed_by_user_id").references(() => users.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  invitedBy: one(users, {
    fields: [users.invitedByUserId],
    references: [users.id],
    relationName: "inviter",
  }),
  invitees: many(users, { relationName: "inviter" }),
  inviteLinksCreated: many(inviteLinks, { relationName: "createdLinks" }),
  promotionRequestsReceived: many(promotionRequests, { relationName: "candidate" }),
  promotionRequestsCreated: many(promotionRequests, { relationName: "creator" }),
  votes: many(votes),
  levelHistory: many(userLevelHistory, { relationName: "userHistory" }),
}));

export const inviteLinksRelations = relations(inviteLinks, ({ one }) => ({
  invitedBy: one(users, {
    fields: [inviteLinks.invitedByUserId],
    references: [users.id],
    relationName: "createdLinks",
  }),
  usedBy: one(users, {
    fields: [inviteLinks.usedByUserId],
    references: [users.id],
  }),
}));

export const promotionRequestsRelations = relations(promotionRequests, ({ one, many }) => ({
  candidate: one(users, {
    fields: [promotionRequests.candidateUserId],
    references: [users.id],
    relationName: "candidate",
  }),
  createdBy: one(users, {
    fields: [promotionRequests.createdByUserId],
    references: [users.id],
    relationName: "creator",
  }),
  votes: many(votes),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  promotionRequest: one(promotionRequests, {
    fields: [votes.promotionRequestId],
    references: [promotionRequests.id],
  }),
  voter: one(users, {
    fields: [votes.voterUserId],
    references: [users.id],
  }),
}));

export const userLevelHistoryRelations = relations(userLevelHistory, ({ one }) => ({
  user: one(users, {
    fields: [userLevelHistory.userId],
    references: [users.id],
    relationName: "userHistory",
  }),
  changedBy: one(users, {
    fields: [userLevelHistory.changedByUserId],
    references: [users.id],
  }),
}));

// Schemas and Types
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInviteLinkSchema = createInsertSchema(inviteLinks).omit({
  id: true,
  createdAt: true,
  usesCount: true,
  status: true,
});

export const insertPromotionRequestSchema = createInsertSchema(promotionRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
});

export const insertVoteSchema = createInsertSchema(votes).omit({
  id: true,
  createdAt: true,
});

// Self-demotion request schema
export const selfDemotionRequestSchema = z.object({
  newLevel: z.number().int().min(1).max(4), // Levels 1-4 (can't demote to 5 or above)
  reason: z.string().min(10).max(500), // Reason must be 10-500 characters
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type InviteLink = typeof inviteLinks.$inferSelect;
export type InsertInviteLink = z.infer<typeof insertInviteLinkSchema>;

export type PromotionRequest = typeof promotionRequests.$inferSelect;
export type InsertPromotionRequest = z.infer<typeof insertPromotionRequestSchema>;

export type Vote = typeof votes.$inferSelect;
export type InsertVote = z.infer<typeof insertVoteSchema>;

export type SelfDemotionRequest = z.infer<typeof selfDemotionRequestSchema>;

export type UserLevelHistory = typeof userLevelHistory.$inferSelect;
