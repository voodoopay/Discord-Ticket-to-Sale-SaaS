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
- `apps/sports-worker`: separate-token Discord worker for daily UK sports TV listings, managed sport channels, and `/search`.
- `packages/core`: shared domain/config/security/services/repositories.
- `drizzle/migrations`: SQL migrations.

## Required Environment

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `JOIN_GATE_DISCORD_TOKEN`
- `JOIN_GATE_DISCORD_CLIENT_ID`
- `SPORTS_DISCORD_TOKEN`
- `SPORTS_DISCORD_CLIENT_ID`
- `SPORTS_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `DATABASE_URL`

Recommended for production:

- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI`
- `TELEGRAM_BOT_USERNAME`
- `SESSION_SECRET`
- `ENCRYPTION_KEY`
- `CHECKOUT_SIGNING_SECRET`
- `SUPER_ADMIN_DISCORD_IDS`
- `BOT_PUBLIC_URL`
- `NUKE_DISCORD_TOKEN`
- `NUKE_DISCORD_CLIENT_ID`
- `NUKE_POLL_INTERVAL_MS`
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
- Deploy sales bot slash commands only: `pnpm deploy:commands:bot`
- Deploy join-gate slash commands only: `pnpm deploy:commands:join-gate`
- Deploy nuke slash commands: `pnpm deploy:commands:nuke`
- Deploy sports slash commands: `pnpm deploy:commands:sports`
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
- Creates and manages one text channel per sport under a managed category, then republishes that day’s UK TV listings on the daily schedule.
- Default schedule is `01:00` in `Europe/London`, and the worker clears the previous day’s managed posts before sending the new listings.
- Uses TheSportsDB for sport, event, broadcaster, and image data. A paid API key is required for full daily coverage because the public `123` key is heavily truncated.
- `/sports setup` creates or refreshes the managed sports category and publishes the current day’s listings immediately.
- `/sports sync` creates missing sport channels and refreshes the saved channel bindings without republishing.
- `/sports refresh` clears the managed sport channels and republishes today’s listings on demand.
- `/sports status` shows activation state, managed category, channel count, and the next scheduled run.
- `/search query:"Rangers v Celtic"` finds the best matching event and returns the UK kickoff time, channels, and artwork.
- `/activation grant guild_id:<server-id> user_id:<user-id>` activates the sports worker for another server without needing to run the command inside that server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/activation revoke guild_id:<server-id> user_id:<user-id>` remotely removes a sports worker activation entry. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/activation list guild_id:<server-id>` lists the current sports worker activation entries for a server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/sports` is default-deny for every server until a super admin grants at least one Discord user for that server.
- `/search` stays locked for regular members until the sports worker is activated for that server.

## OAuth + Dashboard

- Login endpoint: `GET /api/auth/discord/login`
- Callback endpoint: `GET /api/auth/discord/callback`
- Dashboard page: `/dashboard`
- Dashboard now loads Discord servers from OAuth (manage-server capable guilds), auto-checks bot installation, and auto-links selected server to workspace.
- A Discord server is now bound to exactly one workspace at a time; reconnecting a server moves it to the current workspace mapping.
- Dashboard now includes a Telegram group link command generator for the selected workspace + Discord server.
- Telegram groups reuse the selected Discord server store configuration instead of duplicating catalog, coupon, points, or integration data.
- Telegram sales now hand off from the group into a private DM with the bot so product choices, customer answers, coupon codes, and checkout links are no longer exposed to the whole group.
- Telegram checkout buttons now use the exact provider checkout URLs from the sale session, with no Telegram-specific wrapper around the payment link.
- Server settings now use Discord channel/role selectors instead of manual ID fields.
- Dashboard now includes a first-launch interactive tutorial prompt with explicit `Run Tutorial` and `Skip Tutorial` actions.
- Tutorial completion/skip state is persisted using a long-lived marker cookie plus local storage fallback.
- Tutorial can be rerun at any time from the header `Run Tutorial` action in the dashboard.
- Tutorial walkthrough is role-aware and includes Super Admin-only steps only for super-admin sessions.
- Tutorial popover now includes a `Jump to section` control for direct navigation to major dashboard parts.
- Each major dashboard section now includes an `(i)` info action that starts the tutorial at that section.
- Dashboard header now supports branded light/dark logos from the repo `assets` folder.
- Dashboard header now includes a direct link to `https://voodoopay.online/` and uses a larger branded logo treatment.
- Dashboard navigation now keeps regular merchant work in a one-section-at-a-time flow so mobile setup feels less crowded.
- Dashboard now opens with a mobile-first setup flow strip and compact current-context card so merchants can jump straight to Workspace, Sales, Payments, Coupons, or Catalog without scanning the whole page.
- Dashboard navigation now uses collapsible section cards, and catalog management uses four guided step panels so merchants can review products, manage category questions, edit product details, and handle variations without keeping the full builder open at once.
- Category question loading now prefers the most complete template already used in that category, and the dashboard explains when the pay bot must be added before those question changes can be saved.
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
- Dashboard now includes customer points management (list balances, manual add/remove, search).
- Workspace deletion is available from dashboard for owner/super-admin cleanup.
- Coupons can be created, edited, and deleted per server from dashboard (`code`, fixed discount amount, active flag, optional product/variation scope).
- Dashboard keeps the selected workspace/server context and links the selected server to that workspace automatically.

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
- Bot creates `order_session` and posts payment buttons in the ticket (`Pay`, and optionally `Pay with Crypto`).
- Checkout amount now reflects basket total minus coupon plus tip.
- Telegram `/sale` now starts in the linked group and immediately moves the sensitive sale flow into a private DM with the selected customer.
- Telegram `/sale` can target the customer by reply, `text_mention`, or plain `/sale @username`, and only the matching customer can continue the private DM flow.
- Telegram DM sale drafts now stay active for 6 hours and refresh their expiry as the customer moves through the private flow.
- Telegram `/points` now hands off from the linked group into a private DM before collecting the customer email or showing the balance.
- Telegram `/refer` now hands off from the linked group into a private DM before collecting either email address.
- Telegram paid confirmations are sent to the customer in DM, while Telegram-origin paid logs and payment-received status updates are also posted back into the linked Telegram group even when a Discord paid-log channel is configured.
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
- Owner/staff can monitor submission and payout outcomes via referral log channel.
- Telegram `/refer` starts in the linked group but collects both email addresses and returns the result only in the requester's DM with the bot.

## Nuke Command

- Runs from separate worker/token (`apps/nuke-worker`).
- `/nuke schedule time:<HH:mm> timezone:<IANA>` sets daily nuke for the current channel.
- `/nuke status` shows the current daily nuke schedule for the current channel.
- Creating a schedule during the target minute now queues that same minute immediately instead of rolling the first run to the next day.
- The timezone field supports autocomplete, with `Europe/London` pinned to the top of the suggestions.
- `/nuke disable` disables daily nuke for the current channel.
- `/nuke now confirm:NUKE` clones current channel and deletes original channel immediately.
- `/nuke delete confirm:DELETE` permanently deletes the current channel without creating a replacement channel.
- `/nuke authorized` lists the extra Discord user IDs allowed to use `/nuke` in the current server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/nuke grant user:<@user>` grants `/nuke` access for the current server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/nuke revoke user:<@user>` revokes `/nuke` access for the current server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/activation grant guild_id:<server-id> user_id:<user-id>` can now remotely activate `/nuke` for another server without you joining that server first. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/activation revoke guild_id:<server-id> user_id:<user-id>` can now remotely revoke `/nuke` access for another server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/activation list guild_id:<server-id>` lists the remote `/nuke` activation entries for another server. Only `SUPER_ADMIN_DISCORD_IDS` can use it.
- `/nuke` is now default-deny for every server. Until a super admin grants at least one Discord user, regular members cannot use it even if they have `Manage Channels`.
- Super admins listed in `SUPER_ADMIN_DISCORD_IDS` can always run `/nuke authorized`, `/nuke grant`, and `/nuke revoke` to activate or manage a server.
- Once a server has granted `/nuke` users, only those granted users plus the configured `SUPER_ADMIN_DISCORD_IDS` can use `/nuke`.
- Manual `/nuke now` posts the final result into the replacement channel after a successful delete so the command does not fail when the original channel no longer exists.
- Manual `/nuke delete` DMs the final result to the caller because the channel is gone, and it disables any saved daily nuke schedule for that deleted channel.
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
