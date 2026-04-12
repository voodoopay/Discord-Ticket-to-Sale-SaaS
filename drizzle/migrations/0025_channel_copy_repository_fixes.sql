ALTER TABLE `channel_copy_authorized_users` MODIFY COLUMN `granted_by_discord_user_id` varchar(32);
--> statement-breakpoint
ALTER TABLE `channel_copy_jobs` MODIFY COLUMN `confirm_token` varchar(64);
--> statement-breakpoint
CREATE INDEX `channel_copy_jobs_incomplete_lookup_idx` ON `channel_copy_jobs` (`requested_by_discord_user_id`,`source_channel_id`,`destination_channel_id`,`status`,`updated_at`,`created_at`);
