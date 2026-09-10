CREATE TABLE `almadina_app_locks` (
	`user_id` text PRIMARY KEY NOT NULL,
	`pin_hash` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`biometric_enabled` integer DEFAULT 0 NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `almadina_webauthn_challenges` (
	`session_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`challenge` text NOT NULL,
	`origin` text NOT NULL,
	`rp_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`session_hash`, `kind`)
);
--> statement-breakpoint
CREATE TABLE `almadina_webauthn_credentials` (
	`credential_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `almadina_webauthn_credentials_user_id_idx` ON `almadina_webauthn_credentials` (`user_id`);