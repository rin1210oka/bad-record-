CREATE TABLE `access_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text,
	`name` text NOT NULL,
	`login_id` text NOT NULL,
	`login_key` text NOT NULL,
	`role` text NOT NULL,
	`pin_hash` text NOT NULL,
	`pin_salt` text NOT NULL,
	`recovery_hash` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`attempt_version` integer DEFAULT 0 NOT NULL,
	`credential_version` integer DEFAULT 1 NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_accounts_member_id_unique` ON `access_accounts` (`member_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `access_accounts_login_key_unique` ON `access_accounts` (`login_key`);--> statement-breakpoint
CREATE TABLE `access_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`role` text NOT NULL,
	`login_id` text NOT NULL,
	`login_key` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`redeemed_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_invites_token_hash_unique` ON `access_invites` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `access_invites_active_member` ON `access_invites` (`member_id`) WHERE "access_invites"."redeemed_at" IS NULL AND "access_invites"."revoked_at" IS NULL;--> statement-breakpoint
CREATE TABLE `access_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `access_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`credential_version` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `access_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`phrase_hash` text NOT NULL,
	`phrase_salt` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
