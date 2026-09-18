CREATE TABLE `work_escrows` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_wallet` text NOT NULL,
	`counterparty_wallet` text NOT NULL,
	`creator_escrow_wallet` text NOT NULL,
	`counterparty_escrow_wallet` text,
	`amount_lunas` integer NOT NULL,
	`currency` text DEFAULT 'NIM' NOT NULL,
	`description` text NOT NULL,
	`terms_hash` text,
	`status` text DEFAULT 'offered' NOT NULL,
	`ai_vote` text,
	`ai_reason` text,
	`htlc_contract_address` text,
	`hash_root` text,
	`timeout_block` integer,
	`escrow_transaction_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_escrow_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`escrow_id` text NOT NULL,
	`wallet_address` text NOT NULL,
	`role` text NOT NULL,
	`vote` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_escrow_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`escrow_id` text NOT NULL,
	`author_wallet` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_keys` (
	`wallet_address` text PRIMARY KEY NOT NULL,
	`public_jwk` text NOT NULL,
	`wrapped_private` text NOT NULL,
	`wrap_iv` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_a` text NOT NULL,
	`wallet_b` text NOT NULL,
	`last_message_at` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sender_wallet` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_pair` ON `conversations` (`wallet_a`, `wallet_b`);
--> statement-breakpoint
CREATE INDEX `chat_messages_conversation` ON `chat_messages` (`conversation_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `work_escrows_creator` ON `work_escrows` (`creator_wallet`);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_escrow_votes_unique` ON `work_escrow_votes` (`escrow_id`, `wallet_address`);
