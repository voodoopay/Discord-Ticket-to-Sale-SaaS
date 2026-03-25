# Points & Rewards

## Scope

- Points are store-scoped by `tenant_id + guild_id`.
- Customer identity is normalized email (`trim + lowercase`).
- No points sharing across different merchants/servers.

## Merchant Setup

In the dashboard:

1. Open `/dashboard`, select the workspace and Discord server, then enter the server panel.
2. Open the **Points** page in the sidebar.
3. Use the internal Points menu to move between:

- `Reward Settings`
- `Earning Categories`
- `Redemption Categories`
- `Customer Points`

4. Enable the feature if needed, then configure:

- Set `Value of 1 point` (major currency input, stored as minor integer).
  - This controls redemption value (discount per point), not how many points are earned per 1.00 spent.
- Select categories that `earn` points.
- Select categories where points can be `redeemed`.
- Save settings.

## Customer Management

Inside the **Points** page, the **Customer Points** area supports:

- List customer emails with `balance`, `reserved`, and `available` points.
- Search by email.
- Manual `Add Points`.
- Manual `Edit Balance` (set an exact balance).
- Manual `Delete Balance` (clear back to zero).

## Checkout Behavior

1. Bot collects basket/coupon/answers/tip.
2. System checks points by email before link generation.
3. If eligible and available, customer gets a `Use Points` choice.
4. If chosen, points are reserved and checkout total is reduced.
5. Payment confirmation consumes reservation and then applies earned points.
6. Earned points are based on spend: `1 point per 1.00` in store currency on earn-eligible net lines.

## Reservation Lifecycle

- Created when checkout is generated with points.
- Released on order expiry.
- Released on cancellation.
- Consumed on first successful paid event only.
- Late payment after expired release is accepted; system logs anomaly and does not re-deduct released points.

## Commands

- `/points email:<address>`
  - Returns balance for this store.
  - Reply is ephemeral in the channel where command was run.
- `/refer`
  - Opens a modal asking for `your email` and `new customer email`.
  - First valid claim for a new customer email is locked (first-claim-wins).
  - Success reply is ephemeral and customizable by merchant (`referral_submission_template`).
  - Reply visibility is private to the submitter, even in public channels.

## Referral Rewards

- Referral rewards are configured per server in dashboard settings.
- Merchant sets:
  - categories eligible for referral rewards (`referral_reward_category_keys`)
  - `referral reward` fallback amount in GBP (`referral_reward_minor`)
  - `/refer` success reply template (`referral_submission_template`)
    - supported placeholders: `{submitter_mention}`, `{referrer_email}`, `{referred_email}`
  - `referral log channel` (optional, referral submissions and rewarded referral payouts)
  - `thank-you DM template`
    - supported placeholders: `{referrer_mention}`, `{referrer_email}`, `{referred_email}`, `{points}`, `{amount_gbp}`, `{order_session_id}`
- Product variants set `referral_reward_minor` per variant.
- Reward conversion uses snapshots from checkout creation:
  - `referral_reward_minor_snapshot`
  - `point_value_minor_snapshot`
- Points granted are:
  - `floor(referral_reward_minor_snapshot / point_value_minor_snapshot)`

### Referral Snapshot Rules

- Reward is computed at checkout creation and saved as `referral_reward_minor_snapshot`.
- If referral-eligible categories are configured, only purchased variants in those categories can contribute.
- If no referral categories are configured, all categories are eligible.
- Variant rewards are summed across eligible purchased variants.
- If summed variant reward is `0`, fallback `referral_reward_minor` is used once for the order (if at least one eligible item exists).

## Referral Lifecycle

1. Member submits `/refer` with two emails.
2. System validates email syntax and blocks self-referrals.
3. Claim is stored if no existing claim for that referred email in the same server.
4. On first successful paid order for that referred email:
   - first-paid gate is inserted (idempotent)
   - active claim is resolved (if any)
   - referrer receives points (if snapshot reward converts to >= 1 point)
5. Claim is marked rewarded and ledger event `referral_reward_first_paid_order` is recorded.
6. Referrer receives customizable thank-you DM (best effort; failures are logged and do not break payment finalization).
7. Thank-you DM template supports `{referrer_mention}`, `{referrer_email}`, `{referred_email}`, `{points}`, `{amount_gbp}`, and `{order_session_id}` and is delivered privately via DM.

## Post-Payment Message

- Ticket confirmation includes updated points balance after payment processing.
