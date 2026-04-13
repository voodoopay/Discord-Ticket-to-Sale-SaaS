SET @schema_name = DATABASE();
--> statement-breakpoint
SET @rename_managed_category_sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = @schema_name
        AND table_name = 'sports_guild_configs'
        AND column_name = 'managed_category_channel_id_legacy'
    ) AND NOT EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = @schema_name
        AND table_name = 'sports_guild_configs'
        AND column_name = 'managed_category_channel_id'
    ),
    'ALTER TABLE `sports_guild_configs` CHANGE COLUMN `managed_category_channel_id_legacy` `managed_category_channel_id` varchar(32)',
    'SELECT 1'
  )
);
--> statement-breakpoint
PREPARE rename_managed_category_stmt FROM @rename_managed_category_sql;
--> statement-breakpoint
EXECUTE rename_managed_category_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE rename_managed_category_stmt;
--> statement-breakpoint
SET @rename_live_category_sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = @schema_name
        AND table_name = 'sports_guild_configs'
        AND column_name = 'live_category_channel_id_legacy'
    ) AND NOT EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = @schema_name
        AND table_name = 'sports_guild_configs'
        AND column_name = 'live_category_channel_id'
    ),
    'ALTER TABLE `sports_guild_configs` CHANGE COLUMN `live_category_channel_id_legacy` `live_category_channel_id` varchar(32)',
    'SELECT 1'
  )
);
--> statement-breakpoint
PREPARE rename_live_category_stmt FROM @rename_live_category_sql;
--> statement-breakpoint
EXECUTE rename_live_category_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE rename_live_category_stmt;
--> statement-breakpoint
SET @rename_broadcast_country_sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = @schema_name
        AND table_name = 'sports_guild_configs'
        AND column_name = 'broadcast_country_legacy'
    ) AND NOT EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = @schema_name
        AND table_name = 'sports_guild_configs'
        AND column_name = 'broadcast_country'
    ),
    'ALTER TABLE `sports_guild_configs` CHANGE COLUMN `broadcast_country_legacy` `broadcast_country` varchar(120) NOT NULL',
    'SELECT 1'
  )
);
--> statement-breakpoint
PREPARE rename_broadcast_country_stmt FROM @rename_broadcast_country_sql;
--> statement-breakpoint
EXECUTE rename_broadcast_country_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE rename_broadcast_country_stmt;
