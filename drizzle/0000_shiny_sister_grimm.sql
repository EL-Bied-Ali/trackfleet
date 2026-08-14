CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`customer` text NOT NULL,
	`destination` text NOT NULL,
	`truck` text NOT NULL,
	`driver` text NOT NULL,
	`status` text NOT NULL,
	`eta` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`color` text DEFAULT '#916ed7' NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
