CREATE TABLE `auth_challenges` (
	`nonce` text PRIMARY KEY NOT NULL,
	`wallet_address` text NOT NULL,
	`handle` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`wallet_address` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`public_key` text NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_handle_unique` ON `profiles` (`handle`);