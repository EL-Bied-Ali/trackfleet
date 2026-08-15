ALTER TABLE `deliveries` ADD `sendatrack_vehicle_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `latitude` real;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `longitude` real;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `speed` real;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `last_position_at` integer;--> statement-breakpoint
ALTER TABLE `deliveries` ADD `gps_source` text DEFAULT 'simulation' NOT NULL;