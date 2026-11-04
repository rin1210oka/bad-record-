CREATE INDEX `access_limits_expiry` ON `access_limits` (`expires_at`);--> statement-breakpoint
CREATE INDEX `access_sessions_expiry` ON `access_sessions` (`expires_at`);