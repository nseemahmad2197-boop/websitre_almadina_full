CREATE TABLE `almadina_registration_locations` (
	`request_hash` text PRIMARY KEY NOT NULL,
	`governorate` text NOT NULL,
	`city` text NOT NULL,
	`address` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`created_at` text NOT NULL
);
