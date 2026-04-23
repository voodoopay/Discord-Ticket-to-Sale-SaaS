CREATE TABLE `ai_discord_channel_sources` (
	`id` varchar(26) NOT NULL,
	`guild_id` varchar(32) NOT NULL,
	`channel_id` varchar(32) NOT NULL,
	`status` enum('pending','syncing','ready','failed') NOT NULL DEFAULT 'pending',
	`last_synced_at` timestamp,
	`last_sync_started_at` timestamp,
	`last_sync_error` text,
	`last_message_id` varchar(32),
	`message_count` int NOT NULL DEFAULT 0,
	`created_by_discord_user_id` varchar(32),
	`updated_by_discord_user_id` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_discord_channel_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_discord_channel_sources_guild_channel_uq` UNIQUE(`guild_id`,`channel_id`)
);
--> statement-breakpoint
CREATE INDEX `ai_discord_channel_sources_guild_status_idx` ON `ai_discord_channel_sources` (`guild_id`,`status`);
--> statement-breakpoint
CREATE TABLE `ai_discord_channel_messages` (
	`id` varchar(26) NOT NULL,
	`guild_id` varchar(32) NOT NULL,
	`source_id` varchar(26) NOT NULL,
	`channel_id` varchar(32) NOT NULL,
	`message_id` varchar(32) NOT NULL,
	`author_id` varchar(32),
	`content_text` text NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`message_created_at` timestamp,
	`message_edited_at` timestamp,
	`metadata_json` json NOT NULL DEFAULT ('{}'),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_discord_channel_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_discord_channel_messages_guild_channel_message_uq` UNIQUE(`guild_id`,`channel_id`,`message_id`),
	CONSTRAINT `ai_discord_channel_messages_source_fk` FOREIGN KEY (`source_id`) REFERENCES `ai_discord_channel_sources`(`id`) ON DELETE cascade ON UPDATE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_discord_channel_messages_guild_idx` ON `ai_discord_channel_messages` (`guild_id`);
--> statement-breakpoint
CREATE INDEX `ai_discord_channel_messages_source_idx` ON `ai_discord_channel_messages` (`source_id`);
