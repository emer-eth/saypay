ALTER TABLE `agent_records` ADD `due_at` text;
--> statement-breakpoint
ALTER TABLE `agent_records` ADD `status` text DEFAULT 'open' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agent_records` ADD `updated_at` text;
--> statement-breakpoint
CREATE TABLE `chat_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`from_wallet` text NOT NULL,
	`to_wallet` text NOT NULL,
	`draft` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`conversation_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_requests_to_status` ON `chat_requests` (`to_wallet`, `status`);
--> statement-breakpoint
CREATE INDEX `chat_requests_from_status` ON `chat_requests` (`from_wallet`, `status`);
