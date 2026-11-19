# Phase 1 test cases

How each Phase 1 test case from the development plan is covered. "Auto" runs in `npm test` and CI. "SQL" runs with `supabase/tests/rls_check.sql`. "Manual" needs a real Supabase project and browser.

| ID | Level | Test | How it's covered | Type |
| --- | --- | --- | --- | --- |
| T1.1 | Major | Sign up and log in with email code / Google | Email and code format rules in `tests/validation.test.ts`. Full flow: enter email on /login, enter the 6-digit code, land on /dashboard. Repeat with "Continue with Google". | Auto + Manual |
| T1.2 | Major | Expired or wrong code refused; retry with rate limit | Malformed codes rejected and error wording tested in `tests/`. Manual: enter a wrong code, see "wrong or has expired"; request codes twice within 60 s, see "Wait a minute". Supabase enforces the rate limit. | Auto + Manual |
| T1.3 | Major | Passenger opens an admin URL | `canAccessAdmin` and protected routes tested. /admin shows "403 · Admins only" for non-admins. Database refuses self-promotion to admin and audit-log reads: `rls_check.sql`. | Auto + SQL + Manual |
| T1.4 | Major | User A requests User B's profile or travellers | Row-level security: `rls_check.sql` confirms A cannot read, edit or add to B's rows. Manual: open `/travellers/<B's traveller id>` as A, see "Page not found". | SQL + Manual |
| T1.5 | Major | Add co-traveller with name, DOB, gender | Validation tested (future DOB, invalid dates, unknown gender). Manual: add, edit and remove a traveller on /travellers. | Auto + Manual |
| T1.6 | Minor | Names with special characters | O'Brien, José, Anne-Marie D'Souza, A. P. J. Kalam and Devanagari names accepted in tests. | Auto |
| T1.7 | Minor | Logout clears session; back button shows login | Signed-in pages send `Cache-Control: no-store`; middleware redirects to /login without a session. Manual: log out, press Back, see /login. | Auto + Manual |
| T1.8 | Minor | CI fails on a lint error | `.github/workflows/ci.yml` runs lint, typecheck, tests and build on every push and pull request. Turn on branch protection in GitHub so a failing check blocks merging. | Manual (GitHub setting) |

## Manual run sheet

- [ ] Sign up with a new email code; profile row appears in Supabase `profiles` with role `passenger`.
- [ ] Wrong code shows an error and does not log in.
- [ ] Google sign-in works (if configured).
- [ ] /admin as a passenger shows the 403 message.
- [ ] Add yourself as a traveller with "This traveller is me"; adding a second "me" shows an error.
- [ ] Edit and remove a traveller.
- [ ] Save profile with phone `+91 98765 43210`; it's stored as `+919876543210`.
- [ ] As admin, change another user's role; an `audit_log` row is written.
- [ ] Log out, press Back: you see the login page.
- [ ] `rls_check.sql` prints PASS on every line.
