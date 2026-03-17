# Telegram Bot

## What It Does

The Telegram worker mirrors the commerce flow from `apps/bot-worker` for Telegram groups:

- `/connect <token>` links a Telegram group to an existing workspace + Discord server store.
- `/sale` runs the multi-step sale flow with category, product, variant, coupon, customer answers, tip, and points redemption.
- `/points` checks points balances for the linked store.
- `/refer` submits referral claims for the linked store.
- Paid-order fulfillment buttons are rendered in Telegram paid logs and update inline after fulfillment.

## Linking Model

Telegram does not create a second catalog or second server config.

Instead:

1. Select the workspace and Discord server in the dashboard.
2. Generate the Telegram link command in `Workspace & Server`.
3. Add the Telegram bot to the target group.
4. Run `/connect <token>` in that group as a Telegram admin.

The linked Telegram chat then reuses the selected Discord server store data:

- products
- coupons
- points settings
- referral settings
- WooCommerce integration
- Voodoo Pay integration

## Required Environment

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`

## Runtime Notes

- Telegram sales and referrals are group-chat based.
- Telegram uses inline keyboards and next-message prompts where Discord uses components/modals.
- Staff enforcement on Telegram is based on Telegram group admins.
