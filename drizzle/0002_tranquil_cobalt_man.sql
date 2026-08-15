CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`account_label` text NOT NULL,
	`user_label` text NOT NULL,
	`credentials_ciphertext` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_company_id` ON `sessions` (`company_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `deliveries` ADD `company_id` text DEFAULT 'demo' NOT NULL;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `tracking_token` text;--> statement-breakpoint
CREATE INDEX `idx_deliveries_company_id` ON `deliveries` (`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_deliveries_tracking_token` ON `deliveries` (`tracking_token`);