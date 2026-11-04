ALTER TABLE `team_members` ADD `affiliation` text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE `team_members` ADD `stage_mode` text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE `team_members` ADD `cohort_year` integer;--> statement-breakpoint
ALTER TABLE `team_members` ADD `internal_history` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `team_members` ADD `grade_overrides` text DEFAULT '{}' NOT NULL;