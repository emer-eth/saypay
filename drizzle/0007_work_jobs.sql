CREATE TABLE `work_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`worker_wallet` text NOT NULL,
	`client_wallet` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_job_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`title` text NOT NULL,
	`amount_lunas` integer NOT NULL,
	`due_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`invoice_id` text,
	`escrow_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `work_jobs_worker` ON `work_jobs` (`worker_wallet`);
--> statement-breakpoint
CREATE INDEX `work_jobs_client` ON `work_jobs` (`client_wallet`);
--> statement-breakpoint
CREATE INDEX `work_job_stages_job` ON `work_job_stages` (`job_id`);
