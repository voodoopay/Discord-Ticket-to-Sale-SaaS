ALTER TABLE `orders_paid` ADD `fulfillment_status` enum('needs_action','fulfilled') DEFAULT 'needs_action' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders_paid` ADD `fulfilled_at` timestamp;--> statement-breakpoint
ALTER TABLE `orders_paid` ADD `fulfilled_by_discord_user_id` varchar(32);--> statement-breakpoint
ALTER TABLE `orders_paid` ADD `updated_at` timestamp DEFAULT (now()) NOT NULL;