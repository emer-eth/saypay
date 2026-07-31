CREATE TABLE `scheduled_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_wallet` text NOT NULL,
	`recipient_wallet` text NOT NULL,
	`recipient_handle` text,
	`amount_lunas` integer NOT NULL,
	`currency` text DEFAULT 'NIM' NOT NULL,
	`note` text NOT NULL,
	`run_at` integer NOT NULL,
	`recurrence` text DEFAULT 'once' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`paid_transaction_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
