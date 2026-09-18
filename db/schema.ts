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
  verifiedAt: text("verified_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.ownerWallet, table.contactWallet] })]);

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  senderWallet: text("sender_wallet").notNull(),
  recipientWallet: text("recipient_wallet").notNull(),
  amountLunas: integer("amount_lunas").notNull(),
  currency: text("currency").notNull().default("NIM"),
  note: text("note").notNull().default(""),
  txHash: text("tx_hash").notNull().unique(),
  status: text("status").notNull(),
  kind: text("kind").notNull().default("send"),
  sourceUtterance: text("source_utterance"),
  referenceId: text("reference_id"),
  confirmations: integer("confirmations"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

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
  paidTransactionHash: text("paid_transaction_hash"),
  invoiceNumber: text("invoice_number"),
  jobId: text("job_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const invoiceLineItems = sqliteTable("invoice_line_items", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  description: text("description").notNull(),
  quantityMilli: integer("quantity_milli").notNull(),
  unitLunas: integer("unit_lunas").notNull(),
  amountLunas: integer("amount_lunas").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const timeEntries = sqliteTable("time_entries", {
  id: text("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  clientWallet: text("client_wallet").notNull(),
  clientHandle: text("client_handle").notNull(),
  description: text("description").notNull().default(""),
  rateLunasPerHour: integer("rate_lunas_per_hour").notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  durationMs: integer("duration_ms"),
  status: text("status").notNull(),
  invoiceId: text("invoice_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
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

export const protectedDeals = sqliteTable("protected_deals", {
  id: text("id").primaryKey(),
  creatorWallet: text("creator_wallet").notNull(),
  counterpartyWallet: text("counterparty_wallet").notNull(),
  amountLunas: integer("amount_lunas").notNull(),
  currency: text("currency").notNull().default("NIM"),
  description: text("description").notNull(),
  termsHash: text("terms_hash"),
  dueAt: text("due_at"),
  status: text("status").notNull().default("offered"),
  htlcContractAddress: text("htlc_contract_address"),
  hashRoot: text("hash_root"),
  timeoutBlock: integer("timeout_block"),
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

export const eventLog = sqliteTable("event_log", {
  id: text("id").primaryKey(),
  at: integer("at").notNull(),
  level: text("level").notNull(),
  event: text("event").notNull(),
  walletAddress: text("wallet_address"),
  payload: text("payload").notNull().default("{}"),
});

export const intentEvents = sqliteTable("intent_events", {
  id: text("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  utterance: text("utterance").notNull(),
  source: text("source").notNull(),
  kind: text("kind"),
  confidence: text("confidence"),
  attempts: integer("attempts").notNull().default(1),
  durationMs: integer("duration_ms").notNull(),
  error: text("error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});

export const workEscrows = sqliteTable("work_escrows", {
  id: text("id").primaryKey(),
  creatorWallet: text("creator_wallet").notNull(),
  counterpartyWallet: text("counterparty_wallet").notNull(),
  creatorEscrowWallet: text("creator_escrow_wallet").notNull(),
  counterpartyEscrowWallet: text("counterparty_escrow_wallet"),
  amountLunas: integer("amount_lunas").notNull(),
  currency: text("currency").notNull().default("NIM"),
  description: text("description").notNull(),
  termsHash: text("terms_hash"),
  status: text("status").notNull().default("offered"),
  aiVote: text("ai_vote"),
  aiReason: text("ai_reason"),
  htlcContractAddress: text("htlc_contract_address"),
  hashRoot: text("hash_root"),
  timeoutBlock: integer("timeout_block"),
  escrowTransactionHash: text("escrow_transaction_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workEscrowVotes = sqliteTable("work_escrow_votes", {
  id: text("id").primaryKey(),
  escrowId: text("escrow_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  role: text("role").notNull(),
  vote: text("vote").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workEscrowEvidence = sqliteTable("work_escrow_evidence", {
  id: text("id").primaryKey(),
  escrowId: text("escrow_id").notNull(),
  authorWallet: text("author_wallet").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const chatKeys = sqliteTable("chat_keys", {
  walletAddress: text("wallet_address").primaryKey(),
  publicJwk: text("public_jwk").notNull(),
  wrappedPrivate: text("wrapped_private").notNull(),
  wrapIv: text("wrap_iv").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  walletA: text("wallet_a").notNull(),
  walletB: text("wallet_b").notNull(),
  lastMessageAt: integer("last_message_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  senderWallet: text("sender_wallet").notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const workJobs = sqliteTable("work_jobs", {
  id: text("id").primaryKey(),
  workerWallet: text("worker_wallet").notNull(),
  clientWallet: text("client_wallet").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("open"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const agentRecords = sqliteTable("agent_records", {
  id: text("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  section: text("section").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  dueAt: text("due_at"),
  status: text("status").notNull().default("open"),
  imageMime: text("image_mime"),
  imageB64: text("image_b64"),
  sourceUtterance: text("source_utterance"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const chatRequests = sqliteTable("chat_requests", {
  id: text("id").primaryKey(),
  fromWallet: text("from_wallet").notNull(),
  toWallet: text("to_wallet").notNull(),
  draft: text("draft").notNull().default(""),
  status: text("status").notNull().default("pending"),
  conversationId: text("conversation_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workJobStages = sqliteTable("work_job_stages", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  title: text("title").notNull(),
  amountLunas: integer("amount_lunas").notNull(),
  dueAt: text("due_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("pending"),
  invoiceId: text("invoice_id"),
  escrowId: text("escrow_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
