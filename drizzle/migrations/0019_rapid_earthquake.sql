ALTER TABLE `guild_configs` ADD `coupons_enabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_configs` ADD `points_enabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_configs` ADD `referrals_enabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_configs` ADD `telegram_enabled` boolean DEFAULT false NOT NULL;