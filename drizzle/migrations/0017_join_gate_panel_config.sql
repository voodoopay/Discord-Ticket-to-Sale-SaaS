ALTER TABLE `guild_configs` ADD COLUMN `join_gate_staff_role_ids` json DEFAULT ('[]') NOT NULL;
--> statement-breakpoint
ALTER TABLE `guild_configs` ADD COLUMN `join_gate_panel_title` varchar(120);
--> statement-breakpoint
ALTER TABLE `guild_configs` ADD COLUMN `join_gate_panel_message` text;
