CREATE TABLE `team_match_feedback` (
	`owner_id` text NOT NULL,
	`match_id` text NOT NULL,
	`owner_member_id` text,
	`match_context` text NOT NULL,
	`good_points` text DEFAULT '' NOT NULL,
	`improvements` text DEFAULT '' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `match_id`)
);
