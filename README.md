# GroupFly

Festival group flight booking demo. Travellers pool into groups of 30–40 on the same route and date, and GroupFly negotiates a group fare with the airline.

Built so far:

- **Phase 1 — Foundation and accounts**: sign-up and login (email code or Google), roles, profiles, co-travellers, the v1 database schema with row-level security, seed data, tests and CI.
- **Phase 2 — Festival search and pools**: search by route, date (±1 day), time window and festival; pool pages with fare savings, cut-off countdown and a live seat counter; join and leave with an automatic waitlist; private pools with invite links for organisers; admin festival and airport catalogue.
- **Phase 3 — Subscriptions and payments (test mode)**: plans (monthly, festival season pass); joining needs a plan; seats are held 15 minutes for a refundable deposit; payment confirmation by checkout and webhook, safe against duplicates; refunds when leaving or when a pool is closed; PDF receipts and payment history.

Stack: Next.js 15 (App Router, TypeScript) · Tailwind CSS · Supabase (Postgres, Auth) · Zod · Vitest · GitHub Actions.

## Run it locally

You need Node.js 20 or newer and a free Supabase account.

1. **Create a Supabase project** at https://supabase.com (free tier).
2. **Create the database.** In the project's *SQL Editor*, run these in order: [`0001_init.sql`](supabase/migrations/0001_init.sql), [`0002_pools.sql`](supabase/migrations/0002_pools.sql), [`0003_payments.sql`](supabase/migrations/0003_payments.sql), then [`seed.sql`](supabase/seed.sql). For the live seat counter, check that *Database → Publications → supabase_realtime* includes the `pools` table (0002 adds it). For releasing unpaid seat holds every minute, check *Database → Extensions → pg_cron* is on (0003 turns it on and schedules the jobs when available).
3. **Turn on 6-digit email codes.** *Authentication → Email Templates → Magic Link*: put `{{ .Token }}` in the body, for example `Your GroupFly code is {{ .Token }}`. Without this, Supabase emails a link instead of a code.
4. **Set redirect URLs.** *Authentication → URL Configuration*: Site URL `http://localhost:3000`; add `http://localhost:3000/auth/callback` to Redirect URLs (and your Vercel URL later).
5. **(Optional) Google sign-in.** *Authentication → Providers → Google*: add a Google OAuth client ID and secret from Google Cloud Console. Its authorised redirect URI is the callback URL Supabase shows on that screen.
6. **Add your keys.** Copy `.env.example` to `.env.local` and paste the Project URL, the anon public key and the **service role key** from *Project Settings → API*. The service role key is server-only (payments and refunds); never share it or prefix it with `NEXT_PUBLIC_`.
7. **Start the app.**

   ```bash
   npm install
   npm run dev
   ```

   Open http://localhost:3000.

8. **Make yourself admin.** Sign up once, then in the SQL editor run:

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

Supabase's free email sender allows only a few emails per hour. For real testing, add custom SMTP (for example Resend or Brevo free tier) under *Authentication → SMTP Settings*.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server on port 3000 |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (Vitest) |
| `npm run check` | All three above |
| `npm run build` | Production build |

## What's in Phase 1

| Area | Where |
| --- | --- |
| Email code + Google sign-in, logout | `src/app/login`, `src/app/auth/callback` |
| Route protection and session refresh | `src/middleware.ts`, `src/lib/supabase/middleware.ts` |
| Roles: passenger, subscriber, organiser, admin | `src/lib/roles.ts`, `profiles.role` |
| Profile (name, phone) | `src/app/(app)/profile` |
| Co-travellers (name as on ID, DOB, gender) | `src/app/(app)/travellers` |
| Admin: users and role changes (audit-logged) | `src/app/(app)/admin` |
| Schema v1 for all 12 tables + RLS | `supabase/migrations/0001_init.sql` |
| Demo data (festivals, flights, pools) | `supabase/seed.sql` |
| Unit tests | `tests/` |
| Database security check | `supabase/tests/rls_check.sql` |
| CI | `.github/workflows/ci.yml` |

## What's in Phase 2

| Area | Where |
| --- | --- |
| Pool search (route, date ±1 day, time window, festival) and "Filling fast" | `src/app/pools/page.tsx` |
| Empty-search alerts ("email me when a pool opens") | `pool_alerts` table, `createAlert` |
| Pool page: savings, cut-off countdown, live seat counter | `src/app/pools/[id]` |
| Join / leave / waitlist with no overbooking (row lock) | `join_pool`, `leave_pool` in `0002_pools.sql` |
| Private pools with invite link (organisers) | `create_pool`, `get_invited_pool`, `/pools/new` |
| Admin festival calendar and airport list | `/admin/catalogue` |
| Pool logic database check | `supabase/tests/pools_check.sql` |

To try private pools, make a user an organiser from the admin page, then use **Create a pool**.

## What's in Phase 3

| Area | Where |
| --- | --- |
| Plans page and subscription checkout | `/plans`, `plans` table |
| Built-in test gateway (no account needed) | `/pay/mock/[id]`, `PAYMENT_GATEWAY=mock` |
| Razorpay test mode: Checkout + signature check | `CheckoutButton`, `src/lib/payments` |
| Webhook (`payment.captured`, `payment.failed`, `order.paid`) | `/api/webhooks/razorpay` |
| Join needs a plan; 15-minute seat hold; deposit confirms seats | `join_pool`, `complete_payment` in `0003_payments.sql` |
| Unpaid holds released every minute; waitlist moves up | `release_expired_holds` (pg_cron) |
| Refunds on leaving and on closing a pool | `leave_pool`, `dissolve_pool`, `/admin/pools` |
| Plan expiry and 3-day reminders | `expire_subscriptions` (pg_cron, daily) |
| PDF receipts with GST line; payment history | `/api/receipts/[id]`, `/payments` |
| Payment rules database check | `supabase/tests/payments_check.sql` |

### Payments: test gateway or Razorpay

- **Default (`PAYMENT_GATEWAY=mock`)**: paying opens GroupFly's own test payment page with "Pay" and "Simulate a declined card". No account or keys needed.
- **Razorpay test mode**: create a free Razorpay account, switch the dashboard to *Test Mode*, generate test API keys and set `PAYMENT_GATEWAY=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`. For webhooks, add `https://<your-site>/api/webhooks/razorpay` under *Settings → Webhooks* with events `payment.captured`, `payment.failed`, `order.paid`, and put its secret in `RAZORPAY_WEBHOOK_SECRET`. Live keys (`rzp_live_…`) are refused by the app.

## Test cases

- Phase 1: [docs/phase-1-tests.md](docs/phase-1-tests.md)
- Phase 2: [docs/phase-2-tests.md](docs/phase-2-tests.md)
- Phase 3: [docs/phase-3-tests.md](docs/phase-3-tests.md)

## Deploy (free)

1. Push this folder to a GitHub repository.
2. Import it in Vercel (Hobby plan). Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as environment variables.
3. Add the Vercel URL and `<vercel-url>/auth/callback` to Supabase's URL Configuration.

Free Supabase projects pause after about a week without activity; open the dashboard to resume.
