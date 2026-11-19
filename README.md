# GroupFly

Festival group flight booking demo. Travellers pool into groups of 30–40 on the same route and date, and GroupFly negotiates a group fare with the airline.

Built so far:

- **Phase 1 — Foundation and accounts**: sign-up and login (email code or Google), roles, profiles, co-travellers, the v1 database schema with row-level security, seed data, tests and CI.
- **Phase 2 — Festival search and pools**: search by route, date (±1 day), time window and festival; pool pages with fare savings, cut-off countdown and a live seat counter; join and leave with an automatic waitlist; private pools with invite links for organisers; admin festival and airport catalogue.

Stack: Next.js 15 (App Router, TypeScript) · Tailwind CSS · Supabase (Postgres, Auth) · Zod · Vitest · GitHub Actions.

## Run it locally

You need Node.js 20 or newer and a free Supabase account.

1. **Create a Supabase project** at https://supabase.com (free tier).
2. **Create the database.** In the project's *SQL Editor*, run these in order: [`0001_init.sql`](supabase/migrations/0001_init.sql), [`0002_pools.sql`](supabase/migrations/0002_pools.sql), then [`seed.sql`](supabase/seed.sql). For the live seat counter, check that *Database → Publications → supabase_realtime* includes the `pools` table (0002 adds it).
3. **Turn on 6-digit email codes.** *Authentication → Email Templates → Magic Link*: put `{{ .Token }}` in the body, for example `Your GroupFly code is {{ .Token }}`. Without this, Supabase emails a link instead of a code.
4. **Set redirect URLs.** *Authentication → URL Configuration*: Site URL `http://localhost:3000`; add `http://localhost:3000/auth/callback` to Redirect URLs (and your Vercel URL later).
5. **(Optional) Google sign-in.** *Authentication → Providers → Google*: add a Google OAuth client ID and secret from Google Cloud Console. Its authorised redirect URI is the callback URL Supabase shows on that screen.
6. **Add your keys.** Copy `.env.example` to `.env.local` and paste the Project URL and anon public key from *Project Settings → API*.
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

## Test cases

- Phase 1: [docs/phase-1-tests.md](docs/phase-1-tests.md)
- Phase 2: [docs/phase-2-tests.md](docs/phase-2-tests.md)

## Deploy (free)

1. Push this folder to a GitHub repository.
2. Import it in Vercel (Hobby plan). Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as environment variables.
3. Add the Vercel URL and `<vercel-url>/auth/callback` to Supabase's URL Configuration.

Free Supabase projects pause after about a week without activity; open the dashboard to resume.
