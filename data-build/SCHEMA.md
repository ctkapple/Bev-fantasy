# Data schema quick reference

Full field-by-field detail lives as JSDoc in `src/scripts/season-processor.mjs`
(`SeasonData`, `AggregateData` typedefs, and the file-header porting notes).
This is just an index: which UI tab reads which top-level field.

## Where the data comes from

- `src/leagues/<slug>/data/historical.json` — `SeasonData[]`, one per completed
  season, oldest first. Built by `data-build/fetch-sleeper.js`. Ships statically;
  templates render it directly at build time (zero client fetch).
- `src/leagues/<slug>/data/aggregates.json` — one `AggregateData`, "through"
  the last completed season. Same build script.
- Live current season — fetched client-side by `src/scripts/sleeper-client.js`
  (`SeasonData` shape, single season) and layered onto `aggregates.json` via
  `src/scripts/merge.js`'s `mergeAggregates()`.
- `src/leagues/<slug>/data/drafts.json` — keeper-league-only (gated on config
  `rulesContent.keeperRules`), `{ seasons: SeasonDraftData[], upcomingAdp:
  UpcomingAdp|null, upcomingPicks: {season, rounds, byOwner}|null }`.
  `upcomingPicks.byOwner` is `ownerId -> {round: pickCount}` for the next
  draft, derived from `/traded_picks` (baseline of one pick per round, then
  trades applied) so the tab can warn when a keeper's round is one the manager
  no longer holds. NB: in `/traded_picks` both `roster_id` and `owner_id` are
  ROSTER ids, unlike `/rosters` where `owner_id` is a user id.
  `seasons` holds one entry per season with a completed
  draft, INCLUDING the current one (unlike `historical.json`, which
  deliberately excludes it) — each carries that draft's `picks` plus
  `playersByOwner`, the end-of-season rosters the engine uses to tell a keeper
  apart from a re-draft. `upcomingAdp` is ADP for the NEXT draft (current
  market value, which is what rule 6 needs) and is deliberately decoupled from
  the season records, since the upcoming season has no draft to hang it off.
  Recorded seasons are append-only; `upcomingAdp` is always re-fetched. Built
  by `data-build/fetch-sleeper.js`'s `buildKeeperDraftHistory()`. Fetched
  directly by the browser (`fetch("/leagues/<slug>/data/drafts.json")`), not
  embedded via `leagueStats`. If the current season's draft isn't on file yet
  (season-rollover gap), `src/scripts/keeper-assistant.js` does a small live
  top-up. See JSDoc typedefs in `src/scripts/keeper-engine.mjs`, including the
  ROUND DIRECTION note explaining why keeper cost counts *down*.
- `src/leagues/<slug>/data/poll-snapshot.json` — optional AP Poll sidebar data
  for leagues with `pollTeamRosterMap`. Built once from the current Sleeper
  rosters and regular-season half-PPR projections, keyed by the poll's stable
  franchise ids. The browser fetches this compact artifact once and never
  downloads the full projection/player datasets. Projection failure writes a
  valid unavailable state so this decorative feature cannot block deployment.

## Tab → data field map

| Tab | Template | Reads |
|---|---|---|
| Rankings (Dashboard) | `dashboard.njk` | `AggregateData.standings`, `.trophyCase` |
| Records | `records.njk` | `AggregateData.records.*` (10 lists, each pre-sorted/capped at 5) |
| My Team | `myteam.njk` | `AggregateData.managers[userId]` (career stats, `yearlyStandings`, `teamNameHistory`, `rival`, `franchiseLegends`, `archNemeses`, `cornerstones`, `highlights`) |
| H2H | `h2h.njk` | `AggregateData.matchupsByManagerPair[pairKey]` |
| Championships | `championships.njk` | `SeasonData[].championship` across `historical.json` |
| Legends (Legacies) | `legends.njk` | `AggregateData.legacies.ringChasers` / `.loyaltyClub` |
| Trades | `trades.njk` | `SeasonData[].trades` across `historical.json` |
| FAAB | `faab.njk` | `SeasonData[].faabBids` across `historical.json` |
| Toilet Bowl (jrwll only) | `toilet-bowl.njk` | `SeasonData[].toiletBowl` + league config `toiletBowlLedger`/`punishmentGalleries` (hand-curated, not from Sleeper) |
| Draft Odds (sb3 only) | `draft-odds.njk` | `SeasonData[].rosterSnapshots` (most recent season) |
| Earnings | `earnings.njk` | League config `earnings` object (100% hand-curated $ figures, not derivable from Sleeper — see porting note #6 in season-processor.mjs) joined to `lib/people.js` by `lib/earnings-model.js`; seasons-played (and therefore cost basis) still comes from `AggregateData.managers[].yearlyStandings` |
| Rules (jrwll only) | `rules.njk` | League config `rulesContent` (static text) |
| Keeper Assistant (jrwll only) | `keeper-assistant.njk` | `drafts.json` (build-time, per-season draft picks + ADP) + live `SeasonData.rosterSnapshots`/`.playerInfoLookup` (client-time) + league config `keeperOverrides`, run through `src/scripts/keeper-engine.mjs` |
| AP Poll Team Snapshot (sb3 only) | `poll.njk` / `ap-poll.js` | `poll-snapshot.json` (build-time top-five half-PPR projections keyed by permanent poll team id) |

## The `earnings` config contract

Each league that pays out money carries an `earnings` object:

```jsonc
{
  "buyIn": 100,                  // per manager, per season — drives cost basis
  "propsLabel": "Dynasty Props", // optional; defaults to "Weekly Props"
  "payoutStructure": { "champion": 850, "runnerUp": 200, "thirdPlace": 50,
                       "weeklyHighScore": 10, "weeklyProp": 15 },
  "note": "…",                   // rendered as the Disclosure line
  "ledger": {                    // keyed by *this league's* name for the entity
    "Kevin & Chris": { "byYear": { "2025": 10 }, "props": 0.5, "highs": 0 }
  }
}
```

Any key in `payoutStructure` may be omitted (SB3 has no weekly high score) and
its value may be a string when it isn't a fixed figure (BestBall's champion
takes `"the full pot"`). A league with no `ledger` falls back to the older
`payoutsByYear` + `championshipEarnings` layout.

Ledger keys are joined to people by `lib/people.js`, which is what makes the
All Leagues toggle possible: SB3 pays *franchises* (two of them co-owned) while
JRWLL and BestBall pay *people*, so each person declares their name in each
league and, for a co-owned team, their `share` of it. `validate-build.js` fails
the build if a ledger name resolves to nobody or a franchise's shares don't sum
to 1 — both are silent money bugs otherwise.

## Known gaps / TODOs left for the commissioner to fill in
- `mergeAggregates()` has one documented precision limitation for the Legends
  tab when merging a live season (see the comment block atop `merge.js`) —
  self-corrects on the next full rebuild.
