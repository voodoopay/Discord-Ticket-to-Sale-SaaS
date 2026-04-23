CREATE TABLE `ai_authorized_users` (
	`id` varchar(26) NOT NULL,
	`guild_id` varchar(32) NOT NULL,
	`discord_user_id` varchar(32) NOT NULL,
	`granted_by_discord_user_id` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_authorized_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_authorized_users_guild_user_uq` UNIQUE(`guild_id`,`discord_user_id`)
);
--> statement-breakpoint
CREATE INDEX `ai_authorized_users_guild_idx` ON `ai_authorized_users` (`guild_id`);
--> statement-breakpoint
CREATE TABLE `ai_guild_configs` (
	`id` varchar(26) NOT NULL,
	`guild_id` varchar(32) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`tone_preset` enum('professional','standard','witty','cheeky') NOT NULL DEFAULT 'standard',
	`tone_instructions` text NOT NULL,
	`role_mode` enum('allowlist','blocklist') NOT NULL DEFAULT 'allowlist',
	`default_reply_mode` enum('inline','thread') NOT NULL DEFAULT 'inline',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_guild_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_guild_configs_guild_uq` UNIQUE(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `ai_reply_channels` (
	`id` varchar(26) NOT NULL,
	`guild_id` varchar(32) NOT NULL,
	`channel_id` varchar(32) NOT NULL,
	`reply_mode` enum('inline','thread') NOT NULL DEFAULT 'inline',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_reply_channels_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_reply_channels_guild_channel_uq` UNIQUE(`guild_id`,`channel_id`)
);
--> statement-breakpoint
CREATE INDEX `ai_reply_channels_guild_idx` ON `ai_reply_channels` (`guild_id`);
--> statement-breakpoint
CREATE TABLE `ai_role_rules` (
	`id` varchar(26) NOT NULL,
	`guild_id` varchar(32) NOT NULL,
	`role_id` varchar(32) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_role_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_role_rules_guild_role_uq` UNIQUE(`guild_id`,`role_id`)
);
--> statement-breakpoint
CREATE INDEX `ai_role_rules_guild_idx` ON `ai_role_rules` (`guild_id`);
--> statement-breakpoint
CREATE TABLE `ai_website_sources` (
	`id` varchar(26) NOT NULL,
	`guild_id` varchar(32) NOT NULL,
	`url` varchar(512) NOT NULL,
	`status` enum('pending','syncing','ready','failed') NOT NULL DEFAULT 'pending',
	`last_synced_at` timestamp,
	`last_sync_started_at` timestamp,
	`last_sync_error` text,
	`http_status` int,
	`content_hash` varchar(64),
	`page_title` varchar(255),
	`created_by_discord_user_id` varchar(32),
	`updated_by_discord_user_id` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_website_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_website_sources_guild_url_uq` UNIQUE(`guild_id`,`url`)
);
--> statement-breakpoint
CREATE INDEX `ai_website_sources_guild_status_idx` ON `ai_website_sources` (`guild_id`,`status`);
--> statement-breakpoint
CREATE TABLE `ai_knowledge_documents` (
	`id` varchar(26) NOT NULL,
	`guild_id` varchar(32) NOT NULL,
	`source_id` varchar(26) NOT NULL,
	`document_type` varchar(80) NOT NULL DEFAULT 'website_page',
	`content_text` text NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`metadata_json` json NOT NULL DEFAULT ('{}'),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_knowledge_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_knowledge_documents_source_content_hash_uq` UNIQUE(`source_id`,`content_hash`),
	CONSTRAINT `ai_knowledge_documents_source_fk` FOREIGN KEY (`source_id`) REFERENCES `ai_website_sources`(`id`) ON DELETE cascade ON UPDATE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_knowledge_documents_guild_idx` ON `ai_knowledge_documents` (`guild_id`);
--> statement-breakpoint
CREATE INDEX `ai_knowledge_documents_source_idx` ON `ai_knowledge_documents` (`source_id`);
--> statement-breakpoint
CREATE TABLE `ai_custom_qas` (
	`id` varchar(26) NOT NULL,
	`guild_id` varchar(32) NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`created_by_discord_user_id` varchar(32),
	`updated_by_discord_user_id` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_custom_qas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ai_custom_qas_guild_idx` ON `ai_custom_qas` (`guild_id`);
