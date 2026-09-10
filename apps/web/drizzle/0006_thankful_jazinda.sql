CREATE TABLE `almadina_registration_requests` (
	`request_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`store` text NOT NULL,
	`password_hash` text NOT NULL,
	`code_hash` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `almadina_registration_requests_email_idx` ON `almadina_registration_requests` (`email`);--> statement-breakpoint
CREATE INDEX `almadina_registration_requests_phone_idx` ON `almadina_registration_requests` (`phone`);--> statement-breakpoint
CREATE INDEX `almadina_registration_requests_expires_at_idx` ON `almadina_registration_requests` (`expires_at`);