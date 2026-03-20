# Coupons, Basket, Tip, and Points Flow

## Server Settings

- Open dashboard and select workspace + Discord server.
- Expand the **Sales Settings** panel.
- In **Sales Settings**, enable or disable:
  - `Ask customer for optional tip before checkout link generation`.

## Coupon Management

- Expand the **Coupons** panel.
- Create coupon:
  - `Code` (e.g. `SAVE10`).
  - `Discount Amount (GBP)` (fixed amount).
  - `Active` toggle.
  - Optional `Product Scope` and `Variation Scope`.
- Coupons are scoped per server.
- Coupons can be edited or deleted at any time.
- If both scope lists are empty, the coupon applies to all basket items.
- If scope is set, coupon only applies when at least one selected basket item matches scope.

## Bot Sale Flow

1. Staff starts `/sale`.
2. Customer/staff selects `Category -> Product -> Price option`.
3. Bot asks whether to add more products to basket.
4. If customer opens `Add More` and changes their mind, the selection screens now include `Done Adding` so they can continue to checkout without choosing another item.
5. Bot shows optional coupon step.
6. Bot collects customer answers (category question set).
7. If tip is enabled, bot asks tip `Yes/No`.
8. If `Yes`, customer enters custom GBP tip amount.
9. Bot checks points (by customer email) and offers `Use Points` when eligible.
10. Bot generates checkout link.

## Telegram Targeting

- Telegram `/sale` supports the selected customer via reply, `text_mention`, or `/sale @username`.
- The group handoff message is still visible in the group, but only the selected customer can continue the private DM sale.

## Total Calculation

`total = basket subtotal - coupon discount + tip`

- Coupon is capped so total never goes below zero from discount alone.
- For scoped coupons, cap is based on subtotal of matching scoped basket items.
- Tip is added as minor currency amount (pence).

## Points Ordering and Formula

1. Basket subtotal is calculated from all basket lines.
2. Coupon discount is allocated proportionally across all lines (deterministic remainder by basket index).
3. Redeemable pool is calculated only from categories configured as redeemable.
4. Max redeemable points = `floor(redeemablePoolMinor / pointValueMinor)`.
5. If customer opts in, reserved points = `min(availablePoints, maxRedeemablePoints)`.
6. Points discount is allocated proportionally across redeemable lines only.
7. Earn pool is calculated from net line amounts in earn-enabled categories only.
8. Earned points = `floor(earnPoolMinor / 100)` (1 point per 1.00 in store currency).
9. Final total = `subtotal - coupon - points + tip`.

Rules:

- Tip is excluded from earn/redeem calculations.
- Points are reserved when checkout is created.
- Points are deducted only after payment confirmation.
