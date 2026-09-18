ALTER TABLE `contacts` ADD `verified_at` text;
--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `paid_transaction_hash` text;
--> statement-breakpoint
ALTER TABLE `protected_deals` ADD `terms_hash` text;
--> statement-breakpoint
ALTER TABLE `protected_deals` ADD `htlc_contract_address` text;
--> statement-breakpoint
ALTER TABLE `protected_deals` ADD `hash_root` text;
--> statement-breakpoint
ALTER TABLE `protected_deals` ADD `timeout_block` integer;
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`sender_wallet` text NOT NULL,
	`recipient_wallet` text NOT NULL,
	`amount_lunas` integer NOT NULL,
	`currency` text DEFAULT 'NIM' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`tx_hash` text NOT NULL,
	`status` text NOT NULL,
	`kind` text DEFAULT 'send' NOT NULL,
	`source_utterance` text,
	`reference_id` text,
	`confirmations` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_tx_hash_unique` ON `payments` (`tx_hash`);
--> statement-breakpoint
CREATE TABLE `event_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`level` text NOT NULL,
	`event` text NOT NULL,
	`wallet_address` text,
	`payload` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `intent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_address` text NOT NULL,
	`utterance` text NOT NULL,
	`source` text NOT NULL,
	`kind` text,
	`confidence` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`duration_ms` integer NOT NULL,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
