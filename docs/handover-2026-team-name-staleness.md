# Handover: stale 2026 team names on Power Rankings / My Team / other sections

**Reported by:** user, 2026-09-22
**Symptom:** Team names shown for each manager in the "current power rankings"
tab, the "my team" section, and possibly other sections have not updated to
reflect this year's (2026) team names. Looks like a stale-data problem, not
necessarily a UI bug.

## Root cause (confirmed, high confidence)

`poll_private.teams` and its per-poll snapshot table `poll_private.poll_teams`
in Supabase (project `gkxpwopjmfdxymhsbnyh`) are **populated once by hand, via
migration, and never refreshed** from Sleeper afterward.

- The JRWLL registry was seeded by
  [`supabase/migrations/20260831000000_add_jrwll_preseason_ap_poll.sql`](../supabase/migrations/20260831000000_add_jrwll_preseason_ap_poll.sql)
  with `display_name`/`owner_label` values current as of **Aug 31, 2026**.
- The Power Rankings tab ([`src/scripts/ap-poll.js`](../src/scripts/ap-poll.js))
  reads team names from the `public.ap_poll_get_state` RPC, which returns
  `poll_private.poll_teams.display_name_snapshot` / `owner_label_snapshot` —
  a snapshot frozen at poll-creation time, not a live read of
  `poll_private.teams`, and not a live read of Sleeper.
- Confirmed by diffing the migration's seeded names against live Sleeper data
  (`GET /league/1312102228491780096/users`, the current 2026 JRWLL league):
  - Franchise 01 (Will Dooling, roster 1): registry says **"Sea Shanties w/
    Jeanty"**; Sleeper currently says **"The Longshots"**.
  - Franchise 09 (Kevin Flaherty, roster 9): registry says **"Hi Naber!"**;
    Sleeper currently says **"Shakir-a Shakir-a"**.
  - Several other franchises still match (no rename since Aug 31), which is
    why the problem reads as partial/inconsistent rather than universal.

Every poll created since then (`jrwll_2026_week2`, and the SB3-side
`sb3_2026_preseason` / `sb3_2026_week4`) inherited names by copying from
`poll_private.teams` at creation time, so **any manager who renamed their
team after their registry row was last written stays stale in every poll
created after that rename**, not just the oldest one.

## Not the cause (ruled out)

- **Wrong/last-year Sleeper league ID.** `src/leagues/jrwll.json`'s
  `currentLeagueId` (`1312102228491780096`) was checked live against Sleeper
  and is correctly the in-season 2026 league. This was already fixed in a
  prior commit (`203dd8d`) that replaced the old id
  (`1180633944818466816`).
- **"My Team" / dashboard data path.** `src/scripts/dashboard.js` →
  `src/scripts/sleeper-client.js` → `src/scripts/season-processor.mjs` fetches
  team names live from Sleeper client-side each visit (team name =
  `user.metadata?.team_name || user.display_name`,
  `season-processor.mjs:380`), pointed at the correct current league id. This
  path is structurally correct and returns live 2026 names when queried now.
  If a user is still seeing an old name specifically on "My Team", the most
  likely explanation is the 1‑hour `localStorage` cache
  (`sleeper-client.js:18-23`, key `bf:{slug}:current:{leagueId}:v2`) simply
  hasn't expired — worth confirming with the reporter whether this was seen
  after a hard refresh, or whether they were actually looking at the Power
  Rankings tab (item above) and attributing it to "my team."
- **Build/deploy pipeline.** `.github/workflows/build-deploy.yml` runs
  `npm run build` → `data-build/fetch-sleeper.js` daily and on push, but that
  script deliberately **excludes the current in-progress season** from the
  generated `historical.json` / `aggregates.json` (only seasons with Sleeper
  `status === "complete"` are included). It has no connection to
  `poll_private.teams` either way, so it's neither the cause nor a fix.

## Full diff (2026-09-22): all 26 franchises vs. live Sleeper

Queried `poll_private.teams` directly (not just the migration file) and
compared every row against live Sleeper `users`+`rosters` for both leagues
(`GET /league/{id}/users`, `GET /league/{id}/rosters`, current 2026 league
ids). Live "team name" = `user.metadata.team_name` if set, else
`user.display_name` (same rule the "My Team" page uses).

**JRWLL — 7 of 12 franchises are stale**, not just the 2 called out
originally:

| Franchise | Registry (`display_name`) | Live Sleeper | Status |
|---|---|---|---|
| 01 (Will Dooling) | Sea Shanties w/ Jeanty | The Longshots | **stale** |
| 02 (Brian Harty) | Breece Mode | Dartio Party | **stale** |
| 03 (Andrew Johnstone) | Leader of Men: Saquonto | Jerry's Toy Barn | **stale** |
| 04 (Malcolm Zeroka) | Toilet Bowl Bound | Captain Jahmerica | **stale** |
| 05 (Matt Manzo) | The Holdouts | The Holdouts | match |
| 06 (Matt Pitman) | Wait, this isnt dynasty?? | Air Raid Merchants | **stale** |
| 07 (Adam Ellis) | Koorapika | Koorapika | match |
| 08 (Connor Cademartori) | Pitts Revenge Tour pt 2 | Pitts Revenge Tour pt 3 | **stale** |
| 09 (Kevin Flaherty) | Hi Naber! | Shakir-a Shakir-a | **stale** |
| 10 (Johnny Jones) | The Dallas Unicycles | The Dallas Unicycles | match |
| 11 (Sean Richardson) | Sean Richardson | seanrich3 | see note below |
| 12 (Patrick Gavin) | Dark times | Dark times | match |

**SB3 — 0 franchises have a genuine rename**; the only mismatches are the
same "no custom name on Sleeper" case as JRWLL franchise 11:

| Franchise | Registry (`display_name`) | Live Sleeper | Status |
|---|---|---|---|
| 07 (Johnny Jones) | Johnny Jones | jonesj83 | see note below |
| 08 (Malcolm Zeroka) | Malcolm Zeroka | mzeroka | see note below |
| 11 (Connor Cademartori) | Connor Cademartori | cademarc | see note below |
| 12 (Peter & Sean) | BLL 2011 LLWS Champions | seanrich3 | see note below |

All other SB3 franchises (01–06, 09, 10, 13, 14) match live Sleeper exactly.

**Note on the "no custom name" rows (JRWLL 11; SB3 07, 08, 11, 12):** these
managers have never set `metadata.team_name` in Sleeper for that league, so
the live "team name" falls back to their raw Sleeper username
(`seanrich3`, `jonesj83`, `mzeroka`, `cademarc`). The registry instead has a
manually-curated nicer label (their real name, or in SB3 franchise 12's case
a name that may have been set on Sleeper previously and later cleared). This
is **not the same bug** as the confirmed staleness above — a naive "sync
from Sleeper" would make these *worse* by replacing a real name with a raw
username. Any sync fix (option 1/2 below) should only overwrite the registry
when Sleeper has a non-null `metadata.team_name`, and leave these as-is.

(A handful of exact-string matches above hide a trailing-space difference in
Sleeper's own data, e.g. `"Dartio Party "` — cosmetic only, not counted as a
mismatch beyond what's shown.)

## Secondary issue found in passing — broader than first reported

`poll_private.polls.sleeper_league_id` is stale on **all four** polls, not
just `jrwll_2026_preseason`:

| Poll | Stored `sleeper_league_id` | Correct (current) league id |
|---|---|---|
| `jrwll_2026_preseason` | `1180633944818466816` | `1312102228491780096` |
| `jrwll_2026_week2` | `1180633944818466816` | `1312102228491780096` |
| `sb3_2026_preseason` | `1180197099396288512` | `1312102288294162432` |
| `sb3_2026_week4` | `1180197099396288512` | `1312102288294162432` |

`label`/`week`/snapshot data are unaffected, and confirmed nothing in the
app currently reads this column, but all four should be corrected for
consistency if anything ever does.

## Fix options (not yet implemented — needs a decision before touching prod)

1. **Add a manual/scheduled sync step** that pulls `users[].metadata.team_name`
   (and owner label, if derived from the same source) from Sleeper for each
   league and updates `poll_private.teams.display_name` / `owner_label`. This
   keeps the permanent registry current. Still need a decision on whether
   *already-created* poll snapshots (`poll_teams`) should be backfilled too,
   or whether only future polls should pick up the refreshed names — existing
   closed/published polls arguably should keep their historical snapshot by
   design (that's the whole point of a snapshot).
2. **Make `ap_poll_get_state` join live against `poll_private.teams`** instead
   of the frozen `poll_teams.display_name_snapshot` for currently open/draft
   polls (keep the frozen snapshot behavior for closed/published polls, so
   historical results still show the name as of that poll). More invasive —
   touches the RPC others may depend on.
3. Do a one-off manual `update poll_private.teams set display_name = ...`
   pass right now to fix the currently-known-stale rows (confirmed above:
   franchise 01 and franchise 09 at minimum — a full diff against live
   Sleeper data for all 12 JRWLL franchises, and the 14 SB3 franchises, has
   not been done yet and should happen before any fix ships).

None of these have been applied. This document is the investigation +
diagnosis only.

## 2026-09-22 investigation session — resolved for now

Ran the full 26-franchise diff above and confirmed the `sleeper_league_id`
issue affects all 4 polls (see tables above).

**Applied (2026-09-22):**
- One-off correction (fix option 3) to `poll_private.teams.display_name`
  for the 7 stale JRWLL rows (franchises 01, 02, 03, 04, 06, 08, 09), now
  matching live Sleeper. `poll_teams` snapshots were left untouched, so
  already-published poll results are unaffected.
- `sleeper_league_id` corrected on all 4 polls to the current 2026 league
  ids for both leagues.

**Not yet done:** no standing sync mechanism (fix option 1) exists, so
`poll_private.teams` will drift again the next time someone renames their
team on Sleeper. Recommended next step, whenever it's prioritized: a small
script that pulls `users[].metadata.team_name` from Sleeper per league and
updates `poll_private.teams` — but only when Sleeper has a non-null
`metadata.team_name` set, since ~5 franchises (JRWLL 11; SB3 07, 08, 11, 12)
have no custom Sleeper team name and rely on a manually curated name in the
registry instead (see table above) that a naive sync would clobber with a
raw username.
