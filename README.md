# Ticket-to-Sale SaaS

Multi-tenant Discord + Telegram bot stack with a web dashboard for ticket-based sales, referrals, points, and WooCommerce/Voodoo Pay payment confirmation.

## Stack

- Node.js `24.13.1`
- `discord.js@14.25.1`
- `next@16.1.6`
- MySQL + Drizzle ORM
- zod + neverthrow + pino + p-retry + p-queue + ulid

## Workspace Layout

- `apps/web-app`: Next.js dashboard + REST/webhook API routes.
- `apps/bot-worker`: Discord interaction worker with `/sale`, `/points`, and component/modal flows.
- `apps/telegram-worker`: Telegram group worker with `/connect`, `/sale`, `/points`, `/refer`, and paid-order fulfillment callbacks.
- `apps/join-gate-worker`: separate-token Discord worker for new-member verification, email matching, and private verification ticket creation.
- `apps/nuke-worker`: separate-token Discord worker for `/nuke` scheduling and channel nukes.
- `apps/sports-worker`: separate-token Discord worker for daily sports TV listings with shared UK+USA broadcaster coverage, managed sport + live event channels, `/sports live-status`, and public sports lookup commands.
- `apps/channel-copy-worker`: separate-token Discord worker for one-time channel backfills, including message text, embeds, and attachment/media reposting across servers.
- `apps/ai-web-app`: standalone Next.js control plane for the AI bot, with separate Discord OAuth, guild-scoped settings, website/custom-Q&A management, and diagnostics.
- `apps/ai-worker`: separate-token Discord worker for AI bot activation plus passive grounded replies in configured channels.
- `packages/core`: shared domain/config/security/services/repositories.
- `drizzle/migrations`: SQL migrations.

## Required Environment

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `JOIN_GATE_DISCORD_TOKEN`
- `JOIN_GATE_DISCORD_CLIENT_ID`
- `AI_DISCORD_TOKEN`
- `AI_DISCORD_CLIENT_ID`
- `AI_WEB_PUBLIC_URL`
- `AI_DISCORD_REDIRECT_URI`
- `OPENAI_API_KEY`
- `SPORTS_DISCORD_TOKEN`
- `SPORTS_DISCORD_CLIENT_ID`
- `CHANNEL_COPY_DISCORD_TOKEN`
- `CHANNEL_COPY_DISCORD_CLIENT_ID`
- `SPORTS_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `DATABASE_URL`

Recommended for production:

- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI`
- `OPENAI_MODEL`
- `TELEGRAM_BOT_USERNAME`
- `SESSION_SECRET`
- `ENCRYPTION_KEY`
- `CHECKOUT_SIGNING_SECRET`
- `SUPER_ADMIN_DISCORD_IDS`
- `BOT_PUBLIC_URL`
- `NUKE_DISCORD_TOKEN`
- `NUKE_DISCORD_CLIENT_ID`
- `CHANNEL_COPY_DISCORD_TOKEN`
- `CHANNEL_COPY_DISCORD_CLIENT_ID`
- `NUKE_POLL_INTERVAL_MS`
- `SALES_HISTORY_POLL_INTERVAL_MS`
- `SPORTS_POLL_INTERVAL_MS`
- `SPORTS_DEFAULT_TIMEZONE`
- `SPORTS_DEFAULT_PUBLISH_TIME`
- `SPORTS_BROADCAST_COUNTRY`

Copy `.env.example` to `.env` and fill values.

## Commands

- Install: `pnpm install`
- Bootstrap: `pnpm run setup`
- Dev: `pnpm dev`
- Lint: `pnpm lint --fix`
- Typecheck: `pnpm typecheck`
- Tests: `pnpm test --coverage`
- Build: `pnpm build`
- Migrate: `pnpm migrate`
- Deploy slash commands: `pnpm deploy:commands`
- Deploy AI bot slash commands: `pnpm deploy:commands:ai`
- Deploy sales bot slash commands only: `pnpm deploy:commands:bot`
- Deploy join-gate slash commands only: `pnpm deploy:commands:join-gate`
- Deploy nuke slash commands: `pnpm deploy:commands:nuke`
- Deploy sports slash commands: `pnpm deploy:commands:sports`
- Deploy channel-copy slash commands: `pnpm deploy:commands:channel-copy`
- Deploy all Discord command sets: `pnpm deploy:commands:all`

## Join Gate Verification

- `apps/join-gate-worker` is a separate Discord application/token dedicated to first-join verification.
- Enable the privileged Discord intents `Server Members Intent` and `Message Content Intent` for the join-gate application before deploying it.
- New members are prompted in DM first; if DMs are closed, they use the configured fallback verify channel panel instead.
- Join-gate setup is Discord-only. It is configured through `/join-gate` slash commands, not through the web dashboard.
- The join-gate worker indexes emails from the two configured lookup channels, opens a private staff/member ticket on a confirmed match, grants the verified role, and kicks after 3 failed email attempts.
- Run `/join-gate setup fallback_channel:#verify verified_role:@verified ticket_category:Verification current_lookup_channel:#current-customers new_lookup_channel:#new-customers` to configure join-gate for a server.
- Run `/join-gate staff-add role:@Staff` and `/join-gate staff-remove role:@Staff` to control which roles can see new verification tickets.
- Run `/join-gate staff-list` to review the current join-gate ticket visibility roles.
- Run `/join-gate panel title:"Welcome" message:"Custom welcome text"` to save a custom fallback embed title/message.
- Run `/join-gate panel-reset` to go back to the default fallback embed text.
- Run `/join-gate disable` to turn join-gate off and clear the stored Discord-side join-gate settings for that server.
- Run `/join-gate install` after configuring the fallback channel to post or refresh the verification panel. The fallback panel includes a `Resend DM` button for members whose DMs are closed or missed the first prompt.
- Run `/join-gate sync` after changing lookup channel history to rebuild the email index immediately.
- Run `/join-gate status` to confirm missing configuration, missing permissions, and current indexed email counts.
- `/join-gate authorized` lists the extra Discord user IDs allowed to use `/join-gate` in the current server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/join-gate grant user:<@user>` grants `/join-gate` access for the current server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/join-gate revoke user:<@user>` revokes `/join-gate` access for the current server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/activation grant guild_id:<server-id> user_id:<user-id>` can now remotely activate join-gate for another server without you joining that server first. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/activation revoke guild_id:<server-id> user_id:<user-id>` can now remotely revoke join-gate access for another server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/activation list guild_id:<server-id>` lists the remote join-gate activation entries for another server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/join-gate` is now default-deny for every server. Until a super admin grants at least one Discord user, regular members cannot use it and the automatic join verification flow stays inactive for that server.
- Restrict the rest of the server so `@everyone` only sees the fallback verify area, while the configured verified role and staff roles can see the normal channels.

## Sports Listings Worker

- Runs from separate worker/token (`apps/sports-worker`).
- Creates and manages persistent sport channels under a managed category, but only posts daily listings for sports that actually have televised events that day.
- Default schedule is `00:01` in `Europe/London`, and the worker clears the previous day’s managed posts before sending the new listings.
- Televised live events now get temporary event channels with live status updates, optional highlight auto-posting, retention of the final score/state until cleanup, and automatic deletion 30 minutes after the event finishes.
- Shared TV-lookup requests are now cached briefly across the sports worker so multiple guilds do not hammer TheSportsDB with duplicate `lookuptv.php` traffic during the same poll window.
- Highlights can post automatically inside managed live event channels when available, and the same highlight data can also be requested on demand.
- Uses TheSportsDB for sport, event, broadcaster, and image data. A paid API key is required for full daily coverage because the public `123` key is heavily truncated.
- Daily sport channels stay persistent. When a sport has no events that day, its channel is cleared and left empty instead of being deleted.
- `/sports setup [category_name] [live_category_name]` creates or refreshes the shared managed sports category, keeps the default shared UK+USA broadcaster coverage, optionally configures the dedicated live-event category, and publishes the current day’s listings immediately.
- `/sports sync [category_name] [live_category_name]` creates missing sport channels inside the shared UK+USA setup, optionally configures the dedicated live-event category, and refreshes the saved channel bindings without republishing.
- `/sports refresh` clears the managed sport channels and republishes today’s listings on demand.
- `/sports status` shows activation state, managed category, live event category, channel count, and the next scheduled run.
- `/sports live-status` shows tracked live events, pending cleanup counts, and current live-sync health.
- Listings and lookup commands use the server’s configured timezone plus its shared broadcaster-country list. By default the worker tracks both United Kingdom and United States coverage together, and `/search` plus `/match` merge event-detail broadcasters across that shared list instead of collapsing back to one country.
- New live-event channels are only created when a dedicated live event category has been configured. Until then, live-event channel creation is intentionally disabled.
- `/search query:"Rangers v Celtic"` or `/search query:"New York Rangers"` returns upcoming televised matches from today through the next 7 days, including configured-timezone kickoff times, channels, and artwork from the shared broadcaster coverage.
- `/live [sport] [league]` returns current live televised events aggregated across the server’s shared broadcaster countries, with optional sport/league filters, and explicitly flags partial coverage when one or more configured countries fail.
- `/highlights query:"Rangers v Celtic"` returns on-demand highlights for a finished or matching event when a video is available.
- `/match query:"Rangers v Celtic"` returns a richer match-centre view for a team or event, including highlights when available, while using the same shared setup context as the other lookup commands.
- `/standings league:"Scottish Premiership"` returns current league standings.
- `/fixtures query:"Rangers"` returns upcoming fixtures for a team or league.
- `/results query:"Rangers"` returns recent results for a team or league.
- `/team query:"Rangers"` returns a team profile summary.
- `/player query:"James Tavernier"` returns a player profile summary.
- `/activation grant guild_id:<server-id> user_id:<user-id>` activates the sports worker for another server without needing to run the command inside that server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/activation revoke guild_id:<server-id> user_id:<user-id>` remotely removes a sports worker activation entry. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/activation list guild_id:<server-id>` lists the current sports worker activation entries for a server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/sports` is default-deny for every server until a super admin grants at least one Discord user for that server.
- Public lookup commands (`/search`, `/live`, `/highlights`, `/match`, `/standings`, `/fixtures`, `/results`, `/team`, `/player`) stay locked for regular members until the sports worker is activated for that server.

## Channel Copy Worker

- Runs from separate worker/token (`apps/channel-copy-worker`).
- The channel-copy Discord application must have `Message Content Intent` enabled in Discord Developer Portal or source messages can arrive as empty payloads.
- `/channel-copy run source_channel_id:<id> destination_channel_id:<id> [confirm:<token>]` queues a one-time full source-channel backfill into the destination channel.
- `/channel-copy status job_id:<id>` shows the current queued, running, completed, or failed state for a copy job.
- Copy order is oldest-to-newest, and reposts include message text, embeds, and attachments/media files.
- The command must be run from the destination server, and activation is checked against the destination server only.
- The worker processes queued jobs in the background, so large channel histories do not depend on the original slash-command interaction staying open.
- If the destination channel already has messages, the bot replies with ephemeral `Confirm Copy` and `Cancel` buttons instead of appending immediately.
- Only the same Discord user who started the copy can press those confirmation buttons.
- Cross-server copies are supported as long as the channel-copy bot can read the source channel and post/upload in the destination channel.
- `/activation grant guild_id:<server-id> user_id:<user-id>` remotely activates the channel-copy worker for another server without requiring the super admin to join that server first.
- `/activation revoke guild_id:<server-id> user_id:<user-id>` remotely removes channel-copy access for another server.
- `/activation list guild_id:<server-id>` lists the current channel-copy activation entries for a server.
- Channel-copy activation is isolated from `/nuke`, `/sports`, `/join-gate`, and the sales bot.
- The channel-copy bot needs `View Channels` and `Read Message History` on the source channel, plus `View Channels`, `Send Messages`, `Embed Links`, and `Attach Files` on the destination channel.

## OAuth + Dashboard

- Login endpoint: `GET /api/auth/discord/login`
- Callback endpoint: `GET /api/auth/discord/callback`
- Dashboard page: `/dashboard`
- Discord OAuth callback failures now redirect back to `/dashboard` with a readable error banner instead of dumping raw JSON in the browser.
- Discord OAuth login now only requires the Discord profile fetch to succeed; temporary guild-list failures no longer block login and the server list reloads after session creation.
- Dashboard now uses a launchpad flow: login -> choose workspace -> choose Discord server -> open `/dashboard/<tenantId>/<guildId>`.
- Merchants can now create their first workspace directly from the launchpad after Discord login, so fresh accounts are no longer blocked on an empty workspace list.
- Dashboard loads Discord servers from OAuth (manage-server capable guilds), checks bot installation, and links the selected server to the chosen workspace on entry when needed.
- A Discord server is now bound to exactly one workspace at a time; reconnecting a server moves it to the current workspace mapping.
- Main panel navigation is now sidebar-based with dedicated pages for `Overview`, `Sales`, `Settings`, `Payments`, `Coupons`, `Points`, `Referrals`, and `Products`.
- Overview now exposes live cards for bot status, payment readiness, Telegram status, recent sales, and today’s total sales, with a direct jump into the full sales history page.
- The dashboard sales page now supports all-sales browsing with `day`, `week`, `month`, and custom date filters plus search by date, customer email, or TXID/payment reference.
- The dashboard sales page now also includes a manual `Clear sales history` action plus optional daily, weekly, or monthly auto-clear scheduling with saved time and timezone settings.
- The dashboard sidebar now keeps a Discord bot invite button visible so merchants can reinstall or add the bot again after redesign updates.
- Settings now uses an internal sidebar flow for default currency, staff roles, paid-log channel, tipping, and Telegram integration, including add/copy/regenerate Telegram actions when the Telegram feature is enabled.
- Payments now separates the Voodoo Pay wallet, fixed `checkout.voodoo-pay.uk` host, callback secret rotation, and hosted crypto wallet controls into a dedicated page.
- Payment saves now normalize empty/null crypto wallet fields and return field-specific validation errors instead of a generic `Validation failed` banner.
- Coupons, points, referrals, and Telegram now use persisted feature toggles in `guild_configs`; when disabled, the UI hides those controls and the backend rejects the related actions.
- Coupons now uses an internal step menu for `Coupon Settings`, `Create Coupon`, and `View Coupons` so coupon creation and deletion are separate, obvious actions.
- Product management now lives in a dedicated catalog page with an internal sidebar for `Categories & Questions` and `Products`, plus category selection in the product builder.
- Dashboard now includes a Telegram group link command generator for the selected workspace + Discord server.
- Telegram groups reuse the selected Discord server store configuration instead of duplicating catalog, coupon, points, or integration data.
- Telegram sales now hand off from the group into a private DM with the bot so product choices, customer answers, coupon codes, and checkout links are no longer exposed to the whole group.
- Telegram checkout buttons now use the exact provider checkout URLs from the sale session, with no Telegram-specific wrapper around the payment link.
- Server settings now use Discord channel/role selectors instead of manual ID fields.
- Dashboard header now supports branded light/dark logos from the repo `assets` folder.
- Dashboard header now includes a direct link to `https://voodoopay.online/` and uses a larger branded logo treatment.
- Server settings now include a `tip enabled` toggle (ask customer for optional GBP tip before checkout link generation).
- Server settings now include rewards configuration:
  - `point value` (minor currency based)
  - earn rate is fixed at `1 point per 1.00` spent (earn-enabled categories)
  - categories that `earn` points
  - categories where points can be `redeemed`
  - categories eligible for `referral rewards`
  - `referral reward` GBP fallback amount (used only when eligible purchased variants have no per-variant referral reward)
  - `referral submission reply template` (private `/refer` success response)
  - `referral log channel` (optional, referral submissions and payout events)
  - `referral thank-you template` for DM placeholders
- Product variants now support per-variant referral reward amounts in the product builder.
- Dashboard now includes customer points management (list balances, search, manual add, edit/set balance, and clear/delete balance).
- Workspace deletion is available from dashboard for owner/super-admin cleanup.
- Super-admin launchpad controls can now permanently delete a merchant workspace with a typed confirmation step.
- Overview now includes workspace member access controls so owners can search Discord server members, invite them as `admin` or `member`, and remove non-owner workers from a merchant workspace.
- Overview now includes connection controls to disconnect a linked Telegram chat or fully disconnect the current Discord server from the selected merchant workspace with confirmation prompts.
- Coupons can be created, edited, and deleted per server from dashboard (`code`, fixed discount amount, active flag, optional category/product/variation scope).
- Dashboard keeps the selected workspace/server context and links the selected server to that workspace automatically.

## AI Bot Panel

- Runs as a fully separate product surface:
  - `apps/ai-web-app` serves the standalone AI admin panel on its own domain.
  - `apps/ai-worker` runs the separate AI Discord application/token.
- The only slash-command surface for the AI bot is `/activation`.
- AI bot activation is isolated from sales, join-gate, nuke, sports, and channel-copy access.
- `SUPER_ADMIN_DISCORD_IDS` can remotely grant, revoke, and list AI bot activation entries for a target guild without joining that guild.
- Normal configuration happens only in the AI web app:
  - reply channels and per-channel inline/thread mode
  - allowlist/blocklist role rules
  - tone preset plus custom instructions
  - manual website sources with sync-on-save and manual re-sync
  - custom Q&A entries
  - activation state, bot presence, and diagnostics
- The Voodoo AI dashboard uses a black-and-white interactive Three.js control surface with Framer Motion transitions, persisted dark/light mode, and shadcn controls around live bot configuration.
- The AI runtime only answers in configured channels, only for roles allowed by the guild rule set, and only from grounded website/custom-Q&A evidence. If retrieval is weak, it refuses instead of falling back to general model knowledge.

## Ticket Sale Flow

- Staff runs `/sale` in any server channel where they have required permissions.
- Sale drafts stay active for 1 hour on Discord and refresh their expiry as staff move through the flow.
- Bot shows category -> product -> variant flow with Back buttons on selection steps.
- After variant selection, bot supports basket flow (`Add More Products` or continue), and add-more selection steps now include a `Done Adding` escape button so customers can move forward without picking another item.
- Coupon step is optional; entered code is validated against server coupon settings and selected basket item scope.
- Product description is shown in the bot flow when configured.
- Bot gathers custom form answers through modals.
- Optional tip prompt (yes/no) can be enabled per server; yes-path collects custom GBP tip amount.
- Email is now a mandatory system question (always first, always required) for all category form sets.
- Before checkout creation, bot checks customer points by email and prompts to use points when redeemable points are available.
- Members can submit referrals via `/refer` (referrer email + new customer email).
- Points are reserved at checkout creation and only deducted after successful payment confirmation.
- Paid confirmation message now includes updated points balance.
- Referral rewards are auto-granted on first paid order for claimed customer emails, using category eligibility + purchased variant reward snapshots.
- Bot creates `order_session` and posts payment buttons in the ticket (`Pay via Revolut/Visa/Mastercard/Bank`, and optionally `Pay with Crypto`).
- Checkout amount now reflects basket total minus coupon plus tip.
- Telegram `/sale` now starts in the linked group and immediately moves the sensitive sale flow into a private DM with the selected customer.
- Telegram `/sale` can target the customer by reply, `text_mention`, or plain `/sale @username`, and only the matching customer can continue the private DM flow.
- Telegram DM sale drafts now stay active for 6 hours and refresh their expiry as the customer moves through the private flow.
- Telegram `/points` now hands off from the linked group into a private DM before collecting the customer email or showing the balance.
- Telegram `/refer` now hands off from the linked group into a private DM before collecting either email address.
- Telegram paid confirmations are sent only to the customer in DM, and Telegram-origin paid logs stay in the configured Discord paid-log channel instead of being echoed into the linked Telegram group.
- Telegram orders now ignore internal placeholder checkout emails for points/referral tracking, so paid logs and payment-received messages still deliver even when no real customer email was captured.
- Dashboard Voodoo integration now supports Hosted Multi-Coin mode with enable/disable toggle and wallet inputs.
- Hosted Multi-Coin wallet mapping:
  - BTC -> `btc`
  - LTC -> `ltc`
  - ETH/EVM -> `evm`
  - BCH -> `bitcoincash`
  - DOGE -> `doge`
  - TRX -> `trc20`
  - SOL -> `solana`
- Checkout URL now always includes the `email` query parameter (from answers, or a safe fallback email when missing).
- Hosted Voodoo Pay checkout URLs now preserve provider-issued encoded wallet fields for both standard pay and hosted crypto links.
- Voodoo Pay callbacks accept query/form/json payloads, and paid logs fall back to the ticket channel if paid-log channel delivery fails.
- Woo webhook confirms payment (`processing`/`completed`).
- Voodoo Pay callback endpoint can also finalize paid orders.
- API verifies signature, dedupes, retries on failure, fetches Woo order notes.
- Bot posts paid-order details to configured paid-log channel (sensitive fields masked) with a fulfillment button so staff can mark an order handled.
- When staff clicks the paid-log fulfillment button in Discord, the bot now opens an optional message box so merchants can send delivery info back to the customer at the same time. Discord orders post that message into the original sale channel, while Telegram orders send it to the customer's DM.
- Paid logs now label each order as `Telegram Order` or `Discord Order` so merchants can see the source immediately.

## Points Command

- `/points email:<address>` returns store-scoped points balance for that email.
- Response is ephemeral so only the requester can see it, even in public channels.
- Points are scoped to the connected workspace + Discord server (no cross-merchant sharing).
- Telegram `/points` starts in the linked group but asks for the email and returns the balance only in the requester's DM with the bot.

## Referral Command

- `/refer` opens an ephemeral modal for:
  - your email
  - new customer email
- First valid referral claim for a customer email wins.
- Successful `/refer` reply is private (ephemeral) and customizable via server settings.
- Dashboard referral message editors now show the supported placeholder codes inline:
  - submission message: `{submitter_mention}`, `{referrer_email}`, `{referred_email}`
  - thank-you message: `{referrer_mention}`, `{referrer_email}`, `{referred_email}`, `{points}`, `{amount_gbp}`, `{order_session_id}`
- Owner/staff can monitor submission and payout outcomes via referral log channel.
- Telegram `/refer` starts in the linked group but collects both email addresses and returns the result only in the requester's DM with the bot.

## Nuke Command

- Runs from separate worker/token (`apps/nuke-worker`).
- `/nuke schedule time:<HH:mm> timezone:<IANA> [cadence:<daily|weekly|monthly>] [weekday:<Monday-Sunday>] [day_of_month:<1-31>]` saves a recurring nuke schedule for the current channel.
- `/nuke status` shows the current nuke schedule for the current channel.
- Creating a schedule during the target minute now queues that same minute immediately instead of rolling the first run to the next cadence window.
- The timezone field supports autocomplete, with `Europe/London` pinned to the top of the suggestions.
- `/nuke disable` disables the current nuke schedule for the channel.
- `/nuke now confirm:NUKE` clones current channel and deletes original channel immediately.
- `/nuke delete confirm:DELETE` permanently deletes the current channel without creating a replacement channel.
- `/nuke authorized` lists the extra Discord user IDs allowed to use `/nuke` in the current server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/nuke grant user:<@user>` grants `/nuke` access for the current server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/nuke revoke user:<@user>` revokes `/nuke` access for the current server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/activation grant guild_id:<server-id> user_id:<user-id>` can now remotely activate `/nuke` for another server without you joining that server first. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/activation revoke guild_id:<server-id> user_id:<user-id>` can now remotely revoke `/nuke` access for another server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/activation list guild_id:<server-id>` lists the remote `/nuke` activation entries for another server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- The nuke worker is fully standalone and always uses guild-scoped activation/schedule storage (no workspace/tenant lookup).
- `/nuke` is now default-deny for every server. Until a super admin grants at least one Discord user, regular members cannot use it even if they have `Manage Channels`.
- Super admins listed in `SUPER_ADMIN_DISCORD_IDS` can always run `/nuke authorized`, `/nuke grant`, and `/nuke revoke` to activate or manage a server.
- Once a server has granted `/nuke` users, only those granted users plus the configured `SUPER_ADMIN_DISCORD_IDS` can use `/nuke`.
- Manual `/nuke now` posts the final result into the replacement channel after a successful delete so the command does not fail when the original channel no longer exists.
- Manual `/nuke delete` no longer DMs the final result to the caller, and it still disables any saved nuke schedule for that deleted channel.
- The nuke worker now polls due schedules immediately on startup and retries channel creation without an explicit `position` if Discord rejects the first clone request.
- Nuke lock renewal now tolerates MySQL second-level timestamp precision so scheduled and manual nukes do not fail with `Nuke lock could not be renewed.` on otherwise healthy setups.
- Runtime permission checks require user `Manage Channels` or `Administrator`.
- Bot must have `View Channel` + `Manage Channels`.

## WordPress / WooCommerce Setup

See `docs/wordpress-setup.md` and `docs/wordpress-snippet.php`.

## Basket / Coupon / Tip Behavior

See `docs/coupons-basket-tip.md`.

## Points / Rewards Behavior

See `docs/points-rewards.md`.

## Production Deployment Guide

For full beginner-friendly DigitalOcean deployment (including private GitHub repo access, custom domain, SSL, Nginx, and PM2), see `SETUP_GUIDE.md`.

## Security Notes

- Secrets are encrypted at rest using AES-256-GCM.
- Super-admin can rotate global bot token from dashboard API.
- All tenant data is scoped by `tenant_id`.
- Webhook payload and audit events are persisted for operational review.
