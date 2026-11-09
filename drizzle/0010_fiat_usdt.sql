-- Invoices priced in a fiat currency (paid in NIM at the live rate, or in USDT on Polygon),
-- and the payee's Polygon address for USDT. Amounts stay integers: cents, lunas, micro-USDT.
ALTER TABLE `profiles` ADD `evm_address` text;
--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `price_currency` text;
--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `price_cents` integer;
--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `accepts_usdt` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `quote_lunas` integer;
--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `quote_usdt_micro` integer;
--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `quote_expires_at` text;
--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `paid_asset` text;
