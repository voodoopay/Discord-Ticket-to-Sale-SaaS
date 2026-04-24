# Architecture

## Processes

1. `web-app`
- Hosts dashboard pages and API/webhook routes.
- Handles Discord OAuth and session cookie auth.
- Manages workspace member invites/removals plus Discord/Telegram connection controls from the dashboard.
- Exposes filtered sales-history views, manual clear controls, scheduled auto-clear settings, and bot invite actions inside the dashboard shell.
- Normalizes Voodoo Pay crypto wallet form values and returns field-specific validation feedback for dashboard saves.
- Runs Woo webhook receiver and enqueue/retry logic.

2. `bot-worker`
- Handles Discord interactions.
- Enforces sale permissions and ticket metadata checks.
- Executes `/sale` component+modal workflow.
- Also polls due sales-history auto-clear schedules and advances the next run for each configured guild.

3. `join-gate-worker`
- Runs as a separate Discord application/token for first-join verification.
- Sends DM-first verification prompts, maintains the fallback verify panel, and indexes lookup-channel emails.
- Opens private verification tickets, flags them as sale tickets, grants the verified role, and removes members after 3 failed email attempts.

4. `nuke-worker`
- Runs as a separate Discord application/token for `/nuke`.
- Manages daily, weekly, and monthly channel nuke scheduling, execution, and safety checks independently from sales traffic.
- Uses only guild-scoped nuke activation/schedule state and does not depend on workspace/panel tenant mapping.

5. `sports-worker`
- Runs as a separate Discord application/token for daily sports listings, live event channels, `/sports live-status`, and public sports lookup commands.
- Maintains managed sport channels for sports with events that day, republishes the shared UK+USA TV schedule daily, creates temporary live event channels, auto-posts highlights when available, deletes finished live event channels 30 minutes after full time, expires stale live channels that have not received a live heartbeat for 12 hours, merges event-detail broadcasters across the guild’s shared country list for lookup commands, and exposes degraded live coverage when one of the configured countries fails.

6. `telegram-worker`
- Handles Telegram workspace linking, sales handoff, points, referrals, and paid-order callbacks.

7. `ai-web-app`
- Runs as a separate Next.js product surface on its own domain.
- Handles Discord OAuth on the AI panel domain, guild access filtering for owners/admins, and all AI bot configuration flows.
- Exposes guild-scoped API routes for AI settings, website sources, custom Q&A entries, bot resource discovery, and diagnostics snapshots.
- Supports category-level reply and Discord knowledge source rules so newly created channels can be picked up without reconfiguring the panel.
- Lets admins configure reply frequency and an unanswered-question log channel for turning missed answers into Custom Q&A.

8. `ai-worker`
- Runs as a separate Discord application/token dedicated to the AI bot.
- Keeps `/activation` as the only slash-command surface.
- Processes passive message replies in configured channels, enforces role allowlist/blocklist rules, retrieves grounded evidence, and posts inline or thread replies.
- Logs unanswered qualifying questions to the configured admin channel and handles the Discord Add Q&A button/modal flow for members with Administrator permission.

## Data Layer

- Shared MySQL schema in `packages/core/src/infra/db/schema/tables.ts`.
- Drizzle migrations in `drizzle/migrations`.
- Repository layer returns domain-shaped objects.
- Join-gate state is persisted in:
  - `guild_configs` join-gate columns for per-server configuration
  - `join_gate_members` for each joining member's verification progress
  - `join_gate_email_index` for normalized email matches extracted from lookup channels
- Sales-history visibility state is persisted in:
  - `guild_configs` cutoff + auto-clear schedule columns for per-server dashboard history retention
- Sports worker state is persisted in:
  - `sports_guild_configs` for per-server schedule, timezone, primary broadcaster country, shared broadcaster-country list, and managed category
  - `sports_channel_bindings` for the one-channel-per-sport mapping inside each server
  - `sports_live_event_channels` for temporary event-channel lifecycle state, cleanup timing, and highlight delivery tracking
  - `sports_authorized_users` for server-specific activation and `/sports` management access
- AI bot state is persisted in:
  - `ai_authorized_users` for isolated activation access managed by `SUPER_ADMIN_DISCORD_IDS`
  - `ai_guild_configs` for tone, enablement, role mode, and default reply behavior
  - `ai_reply_channels` for active AI reply lanes and per-channel inline/thread mode
  - `ai_reply_channel_categories` for active AI reply lanes that follow every current/future channel in a Discord category
  - `ai_role_rules` for allowlist/blocklist role filtering
  - `ai_website_sources` for manual approved URLs and sync state
  - `ai_knowledge_documents` for normalized synced website content
  - `ai_discord_channel_sources` and `ai_discord_channel_category_sources` for synced Discord knowledge channels and category auto-select rules
  - `ai_custom_qas` for admin-authored grounded Q&A pairs

## Security and Reliability

- Secrets encrypted with `ENCRYPTION_KEY`.
- Checkout tokens signed with `CHECKOUT_SIGNING_SECRET`.
- Webhook signatures verified from raw body (`X-WC-Webhook-Signature`).
- Idempotent processing (`tenant_id + delivery_id`) and duplicate paid-order guard (`order_session_id`).
- Retry strategy: exponential backoff via `p-retry`, queue control via `p-queue`.
- Join-gate requires Discord `Server Members Intent` and `Message Content Intent` on its dedicated application to detect new joins and index lookup-channel emails.
- AI passive replies require Discord `GuildMessages` and `MessageContent` intents on the dedicated AI application, plus the runtime permissions needed to reply inline or create/send in threads.

## Retention Defaults

- Webhook event records: 180 days (operational policy).
- Audit logs: 180 days (operational policy).
