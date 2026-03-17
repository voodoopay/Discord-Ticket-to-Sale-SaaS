# Ticket-to-Sale SaaS

Multi-tenant Discord + Telegram bot stack with a web dashboard for ticket-based sales, referrals, points, and WooCommerce/Voodoo Pay payment confirmation.

## Stack

- Node.js `24.13.0`
- `discord.js@14.25.1`
- `next@16.1.6`
- MySQL + Drizzle ORM
- zod + neverthrow + pino + p-retry + p-queue + ulid

## Workspace Layout

- `apps/web-app`: Next.js dashboard + REST/webhook API routes.
- `apps/bot-worker`: Discord interaction worker with `/sale`, `/points`, and component/modal flows.
- `apps/telegram-worker`: Telegram group worker with `/connect`, `/sale`, `/points`, `/refer`, and paid-order fulfillment callbacks.
- `apps/nuke-worker`: separate-token Discord worker for `/nuke` scheduling and channel nukes.
- `packages/core`: shared domain/config/security/services/repositories.
- `drizzle/migrations`: SQL migrations.

## Required Environment

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
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
- Deploy nuke slash commands: `pnpm deploy:commands:nuke`
- Deploy both command sets: `pnpm deploy:commands:all`

## OAuth + Dashboard

- Login endpoint: `GET /api/auth/discord/login`
- Callback endpoint: `GET /api/auth/discord/callback`
- Dashboard page: `/dashboard`
- Dashboard now loads Discord servers from OAuth (manage-server capable guilds), auto-checks bot installation, and auto-links selected server to workspace.
- A Discord server is now bound to exactly one workspace at a time; reconnecting a server moves it to the current workspace mapping.
- Dashboard now includes a Telegram group link command generator for the selected workspace + Discord server.
- Telegram groups reuse the selected Discord server store configuration instead of duplicating catalog, coupon, points, or integration data.
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
- Server settings now include a `tip enabled` toggle (ask customer for optional GBP tip before checkout link generation).
- Server settings now include rewards configuration:
  - `point value` (minor currency based)
  - earn rate is fixed at `1 point per 1.00` spent (earn-enabled categories)
  - categories that `earn` points
  - categories where points can be `redeemed`
  - categories eligible for `referral rewards`
  - `referral reward` GBP fallback amount (used only when eligible purchased variants have no per-variant referral reward)
  - `referral submission reply template` (private `/refer` success response)
  - `referral log channel` (optional, payout events only)
  - `referral thank-you template` for DM placeholders
- Product variants now support per-variant referral reward amounts in the product builder.
- Dashboard now includes customer points management (list balances, manual add/remove, search).
- Workspace deletion is available from dashboard for owner/super-admin cleanup.
- Coupons can be created, edited, and deleted per server from dashboard (`code`, fixed discount amount, active flag, optional product/variation scope).
- Dashboard keeps the selected workspace/server context and links the selected server to that workspace automatically.

## Ticket Sale Flow

- Staff runs `/sale` in any server channel where they have required permissions.
- Sale drafts stay active for 1 hour and refresh their expiry as staff move through the flow.
- Bot shows category -> product -> variant flow with Back buttons on selection steps.
- After variant selection, bot supports basket flow (`Add More Products` or continue).
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
- Voodoo Pay callbacks accept query/form/json payloads, and paid logs fall back to the ticket channel if paid-log channel delivery fails.
- Woo webhook confirms payment (`processing`/`completed`).
- Voodoo Pay callback endpoint can also finalize paid orders.
- API verifies signature, dedupes, retries on failure, fetches Woo order notes.
- Bot posts paid-order details to configured paid-log channel (sensitive fields masked) with a fulfillment button so staff can mark an order handled.

## Points Command

- `/points email:<address>` returns store-scoped points balance for that email.
- Response is ephemeral so only the requester can see it, even in public channels.
- Points are scoped to the connected workspace + Discord server (no cross-merchant sharing).

## Referral Command

- `/refer` opens an ephemeral modal for:
  - your email
  - new customer email
- First valid referral claim for a customer email wins.
- Successful `/refer` reply is private (ephemeral) and customizable via server settings.
- Owner/staff can monitor submission and payout outcomes via referral log channel.

## Nuke Command

- Runs from separate worker/token (`apps/nuke-worker`).
- `/nuke schedule time:<HH:mm> timezone:<IANA>` sets daily nuke for the current channel.
- Creating a schedule during the target minute now queues that same minute immediately instead of rolling the first run to the next day.
- The timezone field supports autocomplete, with `Europe/London` pinned to the top of the suggestions.
- `/nuke disable` disables daily nuke for the current channel.
- `/nuke now confirm:NUKE` clones current channel and deletes original channel immediately.
- Manual `/nuke now` posts the final result into the replacement channel after a successful delete so the command does not fail when the original channel no longer exists.
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
