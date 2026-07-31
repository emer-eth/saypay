import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const authSessions = sqliteTable("auth_sessions", {
  token: text("token").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const contacts = sqliteTable("contacts", {
  ownerWallet: text("owner_wallet").notNull(),
  contactWallet: text("contact_wallet").notNull(),
  nickname: text("nickname").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.ownerWallet, table.contactWallet] })]);

export const paymentRequests = sqliteTable("payment_requests", {
  id: text("id").primaryKey(),
  creatorWallet: text("creator_wallet").notNull(),
  recipientWallet: text("recipient_wallet"),
  kind: text("kind").notNull(),
  amountLunas: integer("amount_lunas").notNull(),
  currency: text("currency").notNull().default("NIM"),
  note: text("note").notNull(),
  dueAt: text("due_at"),
  status: text("status").notNull().default("open"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const splitGroups = sqliteTable("split_groups", {
  id: text("id").primaryKey(),
  creatorWallet: text("creator_wallet").notNull(),
  amountLunas: integer("amount_lunas").notNull(),
  currency: text("currency").notNull().default("NIM"),
  note: text("note").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const splitParticipants = sqliteTable("split_participants", {
  id: text("id").primaryKey(),
  splitId: text("split_id").notNull(),
  participantWallet: text("participant_wallet").notNull(),
  shareLunas: integer("share_lunas").notNull(),
  status: text("status").notNull().default("pending"),
  paidTransactionHash: text("paid_transaction_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const activity = sqliteTable("activity", {
  id: text("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  amountLunas: integer("amount_lunas"),
  currency: text("currency").notNull().default("NIM"),
  status: text("status").notNull(),
  referenceId: text("reference_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// A Protected Pay record holds the agreement and trusted circle. It is never a
// custody record by itself. `escrowTransactionHash` can only be populated once
// the audited on-chain contract is integrated.
export const protectedDeals = sqliteTable("protected_deals", {
  id: text("id").primaryKey(),
  creatorWallet: text("creator_wallet").notNull(),
  counterpartyWallet: text("counterparty_wallet").notNull(),
  amountLunas: integer("amount_lunas").notNull(),
  currency: text("currency").notNull().default("USDT"),
  description: text("description").notNull(),
  dueAt: text("due_at"),
  status: text("status").notNull().default("draft"),
  escrowTransactionHash: text("escrow_transaction_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dealArbiters = sqliteTable("deal_arbiters", {
  id: text("id").primaryKey(),
  dealId: text("deal_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  vote: text("vote"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dealEvidence = sqliteTable("deal_evidence", {
  id: text("id").primaryKey(),
  dealId: text("deal_id").notNull(),
  authorWallet: text("author_wallet").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Scheduled send: record + reminder only. Money still moves only when the user
// confirms in Nimiq Pay (no unattended signing).
export const scheduledPayments = sqliteTable("scheduled_payments", {
  id: text("id").primaryKey(),
  creatorWallet: text("creator_wallet").notNull(),
  recipientWallet: text("recipient_wallet").notNull(),
  recipientHandle: text("recipient_handle"),
  amountLunas: integer("amount_lunas").notNull(),
  currency: text("currency").notNull().default("NIM"),
  note: text("note").notNull(),
  runAt: integer("run_at").notNull(),
  recurrence: text("recurrence").notNull().default("once"),
  status: text("status").notNull().default("scheduled"),
  paidTransactionHash: text("paid_transaction_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
