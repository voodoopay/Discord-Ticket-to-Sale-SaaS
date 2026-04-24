SET @schema_name = DATABASE();
--> statement-breakpoint
SET @dedupe_terminal_live_events_sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = @schema_name
        AND table_name = 'sports_live_event_channels'
    ),
    'DELETE duplicate_event
     FROM `sports_live_event_channels` duplicate_event
     INNER JOIN (
       SELECT id
       FROM (
         SELECT
           id,
           status,
           ROW_NUMBER() OVER (
             PARTITION BY guild_id, event_id
             ORDER BY
               CASE WHEN status IN (''live'', ''cleanup_due'') THEN 0 ELSE 1 END,
               updated_at DESC,
               created_at DESC,
               id ASC
           ) AS row_num
         FROM `sports_live_event_channels`
       ) ranked_events
       WHERE ranked_events.row_num > 1
         AND ranked_events.status IN (''deleted'', ''failed'')
     ) duplicates ON duplicates.id = duplicate_event.id',
    'SELECT 1'
  )
);
--> statement-breakpoint
PREPARE dedupe_terminal_live_events_stmt FROM @dedupe_terminal_live_events_sql;
--> statement-breakpoint
EXECUTE dedupe_terminal_live_events_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE dedupe_terminal_live_events_stmt;
--> statement-breakpoint
SET @drop_profile_event_unique_sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = @schema_name
        AND table_name = 'sports_live_event_channels'
        AND index_name = 'sports_live_event_channels_profile_event_uq'
    ),
    'ALTER TABLE `sports_live_event_channels` DROP INDEX `sports_live_event_channels_profile_event_uq`',
    'SELECT 1'
  )
);
--> statement-breakpoint
PREPARE drop_profile_event_unique_stmt FROM @drop_profile_event_unique_sql;
--> statement-breakpoint
EXECUTE drop_profile_event_unique_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE drop_profile_event_unique_stmt;
--> statement-breakpoint
SET @drop_profile_idx_sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = @schema_name
        AND table_name = 'sports_live_event_channels'
        AND index_name = 'sports_live_event_channels_profile_idx'
    ),
    'ALTER TABLE `sports_live_event_channels` DROP INDEX `sports_live_event_channels_profile_idx`',
    'SELECT 1'
  )
);
--> statement-breakpoint
PREPARE drop_profile_idx_stmt FROM @drop_profile_idx_sql;
--> statement-breakpoint
EXECUTE drop_profile_idx_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE drop_profile_idx_stmt;
--> statement-breakpoint
SET @drop_profile_id_column_sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = @schema_name
        AND table_name = 'sports_live_event_channels'
        AND column_name = 'profile_id'
    ),
    'ALTER TABLE `sports_live_event_channels` DROP COLUMN `profile_id`',
    'SELECT 1'
  )
);
--> statement-breakpoint
PREPARE drop_profile_id_column_stmt FROM @drop_profile_id_column_sql;
--> statement-breakpoint
EXECUTE drop_profile_id_column_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE drop_profile_id_column_stmt;
--> statement-breakpoint
SET @add_guild_event_unique_sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = @schema_name
        AND table_name = 'sports_live_event_channels'
    ) AND NOT EXISTS(
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = @schema_name
        AND table_name = 'sports_live_event_channels'
        AND index_name = 'sports_live_event_channels_guild_event_uq'
    ) AND NOT EXISTS(
      SELECT 1
      FROM (
        SELECT guild_id, event_id
        FROM `sports_live_event_channels`
        GROUP BY guild_id, event_id
        HAVING COUNT(*) > 1
      ) duplicate_events
    ),
    'ALTER TABLE `sports_live_event_channels` ADD CONSTRAINT `sports_live_event_channels_guild_event_uq` UNIQUE(`guild_id`,`event_id`)',
    'SELECT 1'
  )
);
--> statement-breakpoint
PREPARE add_guild_event_unique_stmt FROM @add_guild_event_unique_sql;
--> statement-breakpoint
EXECUTE add_guild_event_unique_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE add_guild_event_unique_stmt;
