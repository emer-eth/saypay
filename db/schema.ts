import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  walletAddress: text("wallet_address").primaryKey(),
  handle: text("handle").notNull().unique(),
  publicKey: text("public_key").notNull(),
  language: text("language").notNull().default("en"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const authChallenges = sqliteTable("auth_challenges", {
  nonce: text("nonce").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  handle: text("handle").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
});
