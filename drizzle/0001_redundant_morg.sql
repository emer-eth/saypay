CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_address` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`amount_lunas` integer,
	`currency` text DEFAULT 'NIM' NOT NULL,
	`status` text NOT NULL,
	`reference_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`wallet_address` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`owner_wallet` text NOT NULL,
	`contact_wallet` text NOT NULL,
	`nickname` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`owner_wallet`, `contact_wallet`)
);
--> statement-breakpoint
CREATE TABLE `payment_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_wallet` text NOT NULL,
	`recipient_wallet` text,
	`kind` text NOT NULL,
	`amount_lunas` integer NOT NULL,
	`currency` text DEFAULT 'NIM' NOT NULL,
	`note` text NOT NULL,
	`due_at` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `split_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_wallet` text NOT NULL,
	`amount_lunas` integer NOT NULL,
	`currency` text DEFAULT 'NIM' NOT NULL,
	`note` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `split_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`split_id` text NOT NULL,
	`participant_wallet` text NOT NULL,
	`share_lunas` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`paid_transaction_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
