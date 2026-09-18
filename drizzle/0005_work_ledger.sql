ALTER TABLE `payment_requests` ADD `invoice_number` text;
--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `job_id` text;
--> statement-breakpoint
CREATE TABLE `invoice_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`description` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`unit_lunas` integer NOT NULL,
	`amount_lunas` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_address` text NOT NULL,
	`client_wallet` text NOT NULL,
	`client_handle` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`rate_lunas_per_hour` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration_ms` integer,
	`status` text NOT NULL,
	`invoice_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invoice_line_items_request` ON `invoice_line_items` (`request_id`);
--> statement-breakpoint
CREATE INDEX `time_entries_wallet_status` ON `time_entries` (`wallet_address`, `status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_requests_creator_invoice` ON `payment_requests` (`creator_wallet`, `invoice_number`) WHERE `invoice_number` IS NOT NULL;
