CREATE TABLE `almadina_password_reset_requests` (
	`request_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`code_hash` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`verified_at` integer,
	`reset_token_hash` text,
	`reset_expires_at` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `almadina_password_reset_requests_user_id_idx` ON `almadina_password_reset_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `almadina_password_reset_requests_expires_at_idx` ON `almadina_password_reset_requests` (`expires_at`);--> statement-breakpoint
CREATE INDEX `almadina_password_reset_requests_reset_token_hash_idx` ON `almadina_password_reset_requests` (`reset_token_hash`);