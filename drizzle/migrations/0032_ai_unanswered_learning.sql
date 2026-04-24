ALTER TABLE `ai_guild_configs`
  ADD COLUMN `reply_frequency` enum('low','mid','max') NOT NULL DEFAULT 'mid',
  ADD COLUMN `unanswered_logging_enabled` boolean NOT NULL DEFAULT false,
  ADD COLUMN `unanswered_log_channel_id` varchar(32);
