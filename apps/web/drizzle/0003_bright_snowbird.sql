CREATE TABLE `almadina_rate_limits` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `almadina_rate_limits_reset_at_idx` ON `almadina_rate_limits` (`reset_at`);