# Telegram Bot

## What It Does

The Telegram worker mirrors the commerce flow from `apps/bot-worker` for Telegram groups:

- `/connect <token>` links a Telegram group to an existing workspace + Discord server store.
- `/sale` starts in the group, then moves the sensitive sale flow into the customer's DM with the bot.
- `/points` starts in the group, then asks for the customer email in DM only.
- `/refer` starts in the group, then asks for both referral emails in DM only.
- Paid-order fulfillment buttons are rendered in Telegram paid logs and update inline after fulfillment.

## Linking Model

Telegram does not create a second catalog or second server config.

Instead:

1. Open `/dashboard` and select the workspace + Discord server from the launchpad.
2. Enter the server panel and open `Settings`.
3. Enable Telegram integration, save, then generate the Telegram link command or invite link.
4. Add the Telegram bot to the target group.
5. Run `/connect <token>` in that group as a Telegram admin.

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

- Telegram uses the group for lightweight handoff/status messaging, then moves sensitive flows into DM.
- Telegram payment confirmation messages are sent to the customer in DM instead of the linked group.
- Referral submissions from Telegram are mirrored into the configured Discord referral log channel.
- Telegram uses inline keyboards and next-message prompts where Discord uses components/modals.
- Staff enforcement on Telegram is based on Telegram group admins.
