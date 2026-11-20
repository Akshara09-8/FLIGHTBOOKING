# Phase 4 test cases

How each Phase 4 test case from the development plan is covered. "Auto" runs in `npm test` and CI. "SQL" runs with `supabase/tests/ops_check.sql` in the Supabase SQL editor. "Manual" needs a real Supabase project and browser.

| ID | Level | Test | How it's covered | Type |
| --- | --- | --- | --- | --- |
| T4.1 | Major | Pool reaches minimum | Status shows "Ready for fare request" in Operations and every admin gets a notification: `ops_check.sql`. | SQL + Manual |
| T4.2 | Major | Generate the fare request | Email text and PDF state route, date, preferred flight or time, seats, adult/child/infant mix and target fare: `tests/ops.test.ts`. Sending logs the request with its seat count: `ops_check.sql`. | Auto + SQL |
| T4.3 | Major | Enter and accept a quote | Accepting sets the final fare, moves the pool to Payment due and notifies each booking; balance per seat = fare − deposit (`balanceDue` tested); members see "Pay balance" with the exact amount. | SQL + Auto + Manual |
| T4.4 | Major | Export manifest | CSV: one row per confirmed passenger, names upper-cased exactly as on ID, title, gender, DDMMMYYYY date of birth, ADT/CHD/INF by age on the travel date, PNR; safe against spreadsheet formulas: `tests/ops.test.ts`. Export is audit-logged. | Auto + Manual |
| T4.5 | Major | Upload PNR / e-ticket per passenger | `set_ticket` stores one ticket per passenger and marks the pool Ticketed when all have one; passengers see only their own tickets (row-level security): `ops_check.sql`. Files sit in a private bucket and download only after the ticket row check. | SQL + Manual |
| T4.6 | Major | Every admin action audited | send_rfq, record_quote, reject_quote, accept_quote, submit_names, set_ticket, ticketed, mark_completed, export_manifest, close pool and role changes write `audit_log`; the pool's Activity log shows them: `ops_check.sql`. | SQL + Manual |
| T4.7 | Minor | Dashboard filters | Counts by status, ready-for-request, closing within 7 days and average fill: `tests/ops.test.ts`. Filters by status, festival and route on /admin/pools. | Auto + Manual |
| T4.8 | Minor | Reject quote and re-request | Rejecting returns the pool to "Fare requested"; a new request and quote are logged; both quotes stay in history with the rejection reason: `ops_check.sql`. | SQL + Manual |

## Manual run sheet

- [ ] Run `0004_ops.sql`; check *Storage* has a private `tickets` bucket.
- [ ] Get a pool to its minimum with deposits paid (lower `min_seats` on a test pool in the table editor if needed). Admin dashboard shows it as "Ready for fare request".
- [ ] Open the pool in Operations → Send fare request. Confirm. Copy the email; download the PDF and check route, date, seats and target fare.
- [ ] Record a quote above the target; reject it with a reason. Log another fare request, record a lower quote, accept it with a balance date.
- [ ] As the member: the pool page shows the confirmed fare, the trip timeline and "Pay balance" with fare − deposit per seat. Pay on the test page; the balance receipt PDF says "Fare balance".
- [ ] As admin: Submit names → download the manifest CSV and open it in a spreadsheet.
- [ ] Add a PNR and upload a PDF for each passenger; after the last one the pool shows Ticketed.
- [ ] As the member: "Your e-tickets" lists the PNR and downloads the file. A second account can't open the ticket link.
- [ ] Activity log on the pool lists every step with the admin's email.
- [ ] `ops_check.sql` prints PASS on every line.

## Known limits

- Fare request emails are copied or opened in your email app; automatic sending comes in Phase 5.
- The manifest uses a common group-booking layout. Airlines that want their own template need a column mapping added.
- Unpaid balances after the deadline release the seats and keep the deposit, as the quote terms say; this policy should be in the published terms (Phase 5).
