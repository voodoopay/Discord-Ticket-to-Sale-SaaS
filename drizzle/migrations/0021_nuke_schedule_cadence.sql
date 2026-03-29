ALTER TABLE `channel_nuke_schedules` ADD `cadence` enum('daily','weekly','monthly') DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE `channel_nuke_schedules` ADD `weekly_day_of_week` int;--> statement-breakpoint
ALTER TABLE `channel_nuke_schedules` ADD `monthly_day_of_month` int;--> statement-breakpoint
ALTER TABLE `guild_configs` ADD `sales_history_cleared_at` timestamp;--> statement-breakpoint
ALTER TABLE `guild_configs` ADD `sales_history_auto_clear_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_configs` ADD `sales_history_auto_clear_frequency` enum('daily','weekly','monthly') DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_configs` ADD `sales_history_auto_clear_local_time_hhmm` varchar(5) DEFAULT '00:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_configs` ADD `sales_history_auto_clear_timezone` varchar(64) DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_configs` ADD `sales_history_auto_clear_day_of_week` int;--> statement-breakpoint
ALTER TABLE `guild_configs` ADD `sales_history_auto_clear_day_of_month` int;--> statement-breakpoint
ALTER TABLE `guild_configs` ADD `sales_history_auto_clear_next_run_at_utc` timestamp;--> statement-breakpoint
ALTER TABLE `guild_configs` ADD `sales_history_auto_clear_last_run_at_utc` timestamp;--> statement-breakpoint
ALTER TABLE `guild_configs` ADD `sales_history_auto_clear_last_local_run_date` varchar(10);--> statement-breakpoint
CREATE INDEX `guild_configs_sales_history_auto_clear_next_run_idx` ON `guild_configs` (`sales_history_auto_clear_enabled`,`sales_history_auto_clear_next_run_at_utc`);