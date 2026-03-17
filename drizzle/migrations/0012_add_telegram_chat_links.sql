CREATE TABLE `telegram_chat_links` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`guild_id` varchar(32) NOT NULL,
	`chat_id` varchar(32) NOT NULL,
	`chat_title` varchar(120) NOT NULL,
	`linked_by_discord_user_id` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telegram_chat_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `telegram_chat_links_chat_id_uq` UNIQUE(`chat_id`),
	CONSTRAINT `telegram_chat_links_tenant_guild_uq` UNIQUE(`tenant_id`,`guild_id`)
);
--> statement-breakpoint
CREATE INDEX `telegram_chat_links_tenant_guild_idx` ON `telegram_chat_links` (`tenant_id`,`guild_id`);--> statement-breakpoint
CREATE INDEX `telegram_chat_links_tenant_created_idx` ON `telegram_chat_links` (`tenant_id`,`created_at`);