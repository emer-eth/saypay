CREATE TABLE `deal_arbiters` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`wallet_address` text NOT NULL,
	`vote` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deal_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`author_wallet` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `protected_deals` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_wallet` text NOT NULL,
	`counterparty_wallet` text NOT NULL,
	`amount_lunas` integer NOT NULL,
	`currency` text DEFAULT 'USDT' NOT NULL,
	`description` text NOT NULL,
	`due_at` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`escrow_transaction_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
