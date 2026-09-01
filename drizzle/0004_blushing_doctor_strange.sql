CREATE TABLE `almadina_session_devices` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_name` text NOT NULL,
	`device_type` text NOT NULL,
	`browser_name` text NOT NULL,
	`created_at` text NOT NULL,
	`last_active_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `almadina_session_devices_user_id_idx` ON `almadina_session_devices` (`user_id`);