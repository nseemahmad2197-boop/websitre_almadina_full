CREATE TABLE `almadina_passkey_login_credentials` (
	`credential_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `almadina_passkey_login_credentials_user_id_idx` ON `almadina_passkey_login_credentials` (`user_id`);