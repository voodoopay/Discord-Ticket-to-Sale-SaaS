CREATE TABLE `join_gate_authorized_users` (
	`id` varchar(26) NOT NULL,
	`tenant_id` varchar(26) NOT NULL,
	`guild_id` varchar(32) NOT NULL,
	`discord_user_id` varchar(32) NOT NULL,
	`granted_by_discord_user_id` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `join_gate_authorized_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `join_gate_authorized_users_tenant_guild_user_uq` UNIQUE(`tenant_id`,`guild_id`,`discord_user_id`)
);
--> statement-breakpoint
CREATE INDEX `join_gate_authorized_users_tenant_guild_idx` ON `join_gate_authorized_users` (`tenant_id`,`guild_id`);
