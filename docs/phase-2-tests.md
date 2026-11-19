# Phase 2 test cases

How each Phase 2 test case from the development plan is covered. "Auto" runs in `npm test` and CI. "SQL" runs with `supabase/tests/pools_check.sql` in the Supabase SQL editor. "Manual" needs a real Supabase project and browser.

| ID | Level | Test | How it's covered | Type |
| --- | --- | --- | --- | --- |
| T2.1 | Major | Search route + date + time window | Search validation, ±1 day range across month ends in `tests/pools.test.ts`. Manual: search DEL → PAT on 29 Oct 2027, evening; the seeded pool shows with seats and time left. | Auto + Manual |
| T2.2 | Major | Join a pool with several co-travellers | `join_pool` seats the whole party in one transaction: `pools_check.sql`. Manual: join with 3 travellers; the counter goes up by 3. | SQL + Manual |
| T2.3 | Major | Two users take the last seat at once | `join_pool` locks the pool row (`SELECT … FOR UPDATE`), so joins for one pool run one at a time; the second sees the pool full and is waitlisted. `pools_check.sql` checks a full pool waitlists the next party; `expectedJoinResult` tested. | SQL + Auto |
| T2.4 | Major | Join after the cut-off | Refused by `join_pool` (`CUT_OFF_PASSED`): `pools_check.sql`. The Join button is hidden when `canJoin` is false (tested). | SQL + Auto |
| T2.5 | Major | Leave before the cut-off | `leave_pool` frees seats and promotes waitlisted parties oldest first, whole party only, and notifies them: `pools_check.sql`. | SQL + Manual |
| T2.6 | Major | Private pool invite link | Without the code the pool is invisible and `join_pool` refuses; with the code (any case) it works: `pools_check.sql`. Manual: organiser creates a private pool, copies the invite link, a second user opens and joins. | SQL + Manual |
| T2.7 | Minor | Search with no results | Empty state offers "Email me when a pool opens" (saved to `pool_alerts`) and, for organisers, "Start a private pool". | Manual |
| T2.8 | Minor | Dates and times in IST | Flight times, cut-off times and travel dates formatted in Asia/Kolkata regardless of server zone; cut-off is 23:59 IST: `tests/pools.test.ts`. | Auto |
| T2.9 | Minor | Live counter updates on a second browser | Supabase Realtime on the `pools` row; falls back to polling every 5 s if the live channel fails. Manual: open the same pool in two browsers, join in one, watch the other update. | Manual |

## Manual run sheet

- [ ] Run `0002_pools.sql`, then `seed.sql` (adds 15 airports).
- [ ] /pools shows "Filling fast" with the 4 seeded pools.
- [ ] Search DEL → PAT, 29 Oct 2027, evening: the pool shows. Tick ±1 day and search 28 Oct: it still shows.
- [ ] Search a route with no pools, with a date: "Email me when a pool opens" saves and shows a confirmation.
- [ ] Join the DEL → PAT pool with 2 travellers; seats go 32 → 34 on a second browser without reload.
- [ ] Join again with the same traveller: refused.
- [ ] Leave the pool (confirm step); seats go back down.
- [ ] As admin, add a festival and an airport at /admin/catalogue; they appear in the search filters.
- [ ] Make a user an organiser; they create a private pool and get an invite link.
- [ ] A second user can't find the private pool in search, but can open and join it with the link.
- [ ] `pools_check.sql` prints PASS on every line.

## Known limits (by design for the demo)

- Joining doesn't need a subscription or deposit yet; that comes in Phase 3 (T3.2).
- Waitlist promotion is first-fit: if the oldest waitlisted party is too big for the freed seats, a smaller later party can move up first.
- Alerts are saved but not emailed yet; sending comes with notifications in Phase 5.
