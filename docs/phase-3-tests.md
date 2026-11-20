# Phase 3 test cases

How each Phase 3 test case from the development plan is covered. "Auto" runs in `npm test` and CI. "SQL" runs with `supabase/tests/payments_check.sql` in the Supabase SQL editor. "Manual" needs a real Supabase project and browser.

| ID | Level | Test | How it's covered | Type |
| --- | --- | --- | --- | --- |
| T3.1 | Major | Buy a plan with a test card / UPI | Plan activates for its days and the role becomes Subscriber: `payments_check.sql`. Checkout signatures verified and tampering rejected: `tests/payments.test.ts`. Manual: /plans → Get Monthly → pay on the test page (or Razorpay test card) → plan shows on the dashboard. | SQL + Auto + Manual |
| T3.2 | Major | Non-subscriber tries to join | `join_pool` refuses with `SUBSCRIPTION_REQUIRED`: `payments_check.sql`. The pool page shows "Get a plan to join" instead of the form. | SQL + Manual |
| T3.3 | Major | Payment succeeds but the browser closes before the redirect | The webhook (`payment.captured` / `order.paid`) confirms the payment on its own; the payment page also re-checks every 3 s. `complete_payment` confirms deposit seats: `payments_check.sql`; webhook parsing: unit tests. | SQL + Auto + Manual |
| T3.4 | Major | Same webhook delivered twice | Event ids are stored (`webhook_events`), and `complete_payment` returns `already_completed` the second time with no extra plan row: `payments_check.sql`. | SQL |
| T3.5 | Major | Payment fails or is cancelled | Payment marked failed; seats stay held until the 15-minute deadline, then `release_expired_holds` (every minute) frees them and moves the waitlist up: `payments_check.sql`. Money that arrives after release is refunded automatically. Manual: "Simulate a declined card". | SQL + Manual |
| T3.6 | Major | Pool closed | `/admin/pools` → Close pool: every member released, pool `dissolved`, all paid deposits refunded once (repeat calls ignored): `payments_check.sql`. Failed refunds appear under "Refunds waiting for a retry". | SQL + Manual |
| T3.7 | Minor | Plan renewal and expiry | Early renewal extends from the current end date; daily `expire_subscriptions` expires plans, drops the Subscriber role and queues a reminder 3 days before the end: `payments_check.sql`. | SQL |
| T3.8 | Minor | Receipt PDF content | Receipt number, billed-to name and email, IST date, item, GST 18% split for plans, "not applicable" for deposits, refund notes; PDF opens with one page: `tests/payments.test.ts`. | Auto |
| T3.9 | Minor | Amounts in paise | All money is whole paise; GST split always adds up; deposit totals are exact; a payment confirmed with a different amount fails: unit tests + `payments_check.sql`. | Auto + SQL |

## Manual run sheet (test gateway)

- [ ] Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local`; keep `PAYMENT_GATEWAY=mock`.
- [ ] Run `0003_payments.sql`; check pg_cron jobs exist (*Database → Cron Jobs*).
- [ ] Open a pool without a plan: it says "Get a plan to join".
- [ ] /plans → Get Monthly → test page → Pay. Payment page says "Your plan is active"; dashboard shows the plan.
- [ ] Download the receipt PDF: ₹199 split into ₹168.64 + ₹30.36 GST.
- [ ] Join a pool with 2 travellers → "held for 15 minutes" → Pay deposit now → Pay. Members show "Seat confirmed".
- [ ] Join with another traveller, then "Simulate a declined card": payment shows Failed, the seat still shows "Deposit due" with a deadline; wait 15 minutes: the seat is released.
- [ ] Leave the pool: message says the deposit was refunded; Payments shows a Refund row and the deposit as Refunded.
- [ ] As admin, /admin/pools → Close pool on a pool with deposits → refunds issued.
- [ ] `payments_check.sql` and `pools_check.sql` print PASS on every line.

## Razorpay test mode (optional)

- [ ] Set `PAYMENT_GATEWAY=razorpay` with test keys; restart.
- [ ] Pay with a Razorpay test card or test UPI id from Razorpay's test-mode docs; the payment confirms.
- [ ] Expose the dev server with a tunnel, add the webhook URL and secret, pay, then close the tab before the redirect: the payment still confirms.

## Known limits

- The fare balance payment (after the airline quote) arrives with the quote flow in Phase 4.
- Notification rows are created (plan reminders, refunds, seat confirmations) but emails are sent in Phase 5.
- Receipts are demo receipts, not GST tax invoices (no GSTIN until a business is registered).
