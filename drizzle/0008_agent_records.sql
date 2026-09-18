CREATE TABLE `agent_records` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_address` text NOT NULL,
	`section` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`image_mime` text,
	`image_b64` text,
	`source_utterance` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_records_wallet` ON `agent_records` (`wallet_address`, `created_at`);
