DROP INDEX `team_members_name_key`;--> statement-breakpoint
ALTER TABLE `team_members` ADD `deleted_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_name_key` ON `team_members` (`name_key`) WHERE "team_members"."deleted_at" IS NULL;