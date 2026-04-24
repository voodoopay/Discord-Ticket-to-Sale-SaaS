CREATE TABLE `ai_reply_channel_categories` (
	`id` varchar(26) NOT NULL,
	`guild_id` varchar(32) NOT NULL,
	`category_id` varchar(32) NOT NULL,
	`reply_mode` enum('inline','thread') NOT NULL DEFAULT 'inline',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_reply_channel_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_reply_channel_categories_guild_category_uq` UNIQUE(`guild_id`,`category_id`)
);
--> statement-breakpoint
CREATE INDEX `ai_reply_channel_categories_guild_idx` ON `ai_reply_channel_categories` (`guild_id`);
--> statement-breakpoint
CREATE TABLE `ai_discord_channel_category_sources` (
	`id` varchar(26) NOT NULL,
	`guild_id` varchar(32) NOT NULL,
	`category_id` varchar(32) NOT NULL,
	`created_by_discord_user_id` varchar(32),
	`updated_by_discord_user_id` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_discord_channel_category_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_discord_channel_category_sources_guild_category_uq` UNIQUE(`guild_id`,`category_id`)
);
--> statement-breakpoint
CREATE INDEX `ai_discord_channel_category_sources_guild_idx` ON `ai_discord_channel_category_sources` (`guild_id`);
