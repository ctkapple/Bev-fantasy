# Super Beef 3-Way AP Poll plan

This is the living roadmap for the AP Poll. It condenses the original V1
product/design/technical specification and records the production decisions
made during implementation and verification.

Continuation checklist:
[`ap-poll-dashboard-testing-handover.md`](./ap-poll-dashboard-testing-handover.md).

## Current production status (August 11, 2026)

V1 and the approved V2 results presentation are implemented and deployed. The
production poll `sb3_2026_preseason` is intentionally left **published with
fake test data** as the baseline for movement and historical-dashboard testing.

Current retained test state:

- 3 fake ballots from 3 unique voters.
- 42 ranking rows: 14 complete, unique ranks per ballot.
- 14 published aggregate result rows with ranks 1 through 14.
- 315 total AP points, which is the expected `3 * 105`.
- 3 championship, 3 underrated, and 3 overrated selections in aggregate.
- The separate `sb3_2026_v1_demo` remains published and unchanged with 14
  deterministic sample ballots.

Production verification passed for:

- One mobile submission and one desktop/web submission.
- Cross-browser submission-count and submitted-voter updates.
- A stale second-device duplicate attempt, which was rejected immediately.
- Closed-state presentation with results still hidden.
- The manual `Check for results` refresh path.
- Published results on mobile and desktop/web.
- All published result totals and rank integrity through direct database
  auditing.
- The live visual-card Top 10, top-three treatment, neutral no-history Trend,
  and winner-only/tie-aware superlative cards on mobile and desktop.
- The production build and GitHub Pages deployment for commit `33bdc38`.

Do not delete these three fake ballots or reset the poll. They are now the
required previous-poll fixture for the next controlled fake poll.

## Co-managed franchises (August 12, 2026)

Kevin & Chris and Peter & Sean each shared one voting identity. Migration
`20260812210500_split_ap_poll_co_manager_voters.sql` splits them into four
voters: Kevin Flaherty, Chris Cole, Peter Coluntino, and Sean Richardson. SB3
therefore has 16 eligible voters and 14 franchises.

Decisions made with the split:

- A franchise's public owner label moved to the new `poll_private.teams.owner_label`
  column. Team cards still read "Kevin & Chris" and "Peter & Sean" no matter
  which manager is recorded as `current_owner_voter_id`.
- Only draft and open polls take the new roster. Published and closed polls keep
  the combined voter snapshots their ballots were actually cast under.
- SB3's manager info names franchises, not people, so the four managers get
  their portraits from `CO_MANAGER_PORTRAITS` in `src/scripts/ap-poll.js`. Three
  reuse the photos `bb.json` already gives them. Peter Coluntino has no solo
  photo anywhere and keeps the shared `pete-and-richy.png` until he does.
- AP points are not normalized by ballot count, so a 16-ballot poll tops out at
  224 points against 196 for the 14-ballot polls already in history. Ranks stay
  comparable; raw AP-point totals in the history chart do not.

## Original roadmap

### V1 - Voting system

Status: **complete and production-verified**.

The original V1 called for the voter selector, submitted-voter state,
reorderable 1-14 ballot, three required final picks, validation, persistence,
duplicate prevention, hidden open/closed results, submission progress, and
manual poll administration. A minimal published-results table was optional.

The delivered V1 also includes the optional published-results table and later
ballot UX polish: touch dragging, movement feedback, responsive controls,
reduced-motion handling, and desktop/mobile team snapshots.

### V2 - Poll results

Status: **current presentation slice implemented; history and administration deferred**.

The original plan called for:

- Polished current-poll rankings.
- AP points.
- Average rank.
- First-place votes.
- Previous rank and movement.
- Championship vote totals.
- Underrated vote totals.
- Overrated vote totals.
- An individual-ballot viewer.
- An admin setting for aggregate-only versus aggregate-plus-public-ballot
  visibility.

The approved current presentation is:

- A visual-card Top 10, with the bottom four omitted from the ranking list.
- Rank, team portrait/name, Trend, and AP Points on every ranking card.
- A distinct gold/silver/bronze treatment for the top three.
- Red and green reserved for downward and upward Trend movement.
- An em dash for unchanged rank or when no legitimate prior poll exists.
- Winner-only cards for Championship Favorite, Most Underrated, and Most
  Overrated, including vote count and percentage.
- All tied winners displayed when an award finishes tied.
- Award winners drawn from all 14 teams, including teams omitted from the Top
  10 ranking list.
- The same published-results page and responsive card language as the ballot.

Trend is display-ready, but the current public results contract does not yet
return a legitimate previous rank. It therefore remains neutral until a
separately reviewed history contract is added; the deterministic demo will not
be used as synthetic prior-poll history.

Explicitly deferred from this slice:

- Individual-ballot viewing.
- Admin controls and the ballot-visibility setting.
- Average rank and first-place-vote detail in the public presentation.
- Historical charts, risers/fallers, polarization, consensus, and team poll
  profiles.

### V3 - Historical dashboard

Status: **not started**.

The original plan called for:

- A ranking-over-time graph with poll editions on the X-axis and rank 1-14 on
  an inverted Y-axis.
- Team highlighting and an optional official-rank versus average-rank view.
- Biggest risers and biggest fallers.
- Historical team metrics: preseason/current/peak/worst/average ranks, polls at
  number one, largest rise/fall, and total championship votes.
- Championship-vote trends.
- Polarization based on disagreement or variance in ballot ranks.
- Consensus based on the tightest clustering of ballot ranks.
- Team poll profile pages with rank and vote histories.

The proposed main dashboard modules were:

- Current Poll.
- Biggest Risers.
- Biggest Fallers.
- Championship Favorite.
- Most Overrated.
- Most Underrated.
- Most Polarizing.
- Strongest Consensus.

### V4 - Administration and historical data

Status: **not started and still optional**.

The original plan reserved this phase for a full admin UI, poll creation and
status controls, voter management, historical Google Forms import, and a
correction/recount workflow. Manual SQL administration remains acceptable
until it becomes burdensome.

## What the retained fake results can test now

The current fake poll remains the fixture for verifying the V2 results
presentation:

- Top 10 rankings and top-three emphasis.
- AP points and neutral no-history Trend presentation.
- Championship, underrated, and overrated winner cards, including ties.
- Published-state visual hierarchy and mobile layout.
- Empty/zero-value handling across teams that received no auxiliary votes.

The fake poll can also support polarization and consensus calculations, but the
current public RPC does not return rank distributions or those derived values.
Adding them would require an explicitly reviewed database/RPC change.

The current public RPC returns only the selected current poll and its aggregate
published results. It does not expose historical polls, previous ranks,
movement, individual ballots, or per-team rank distributions. Those features
need a new private calculation plus a deliberately limited public contract.

The deterministic demo must not be treated as genuine previous-poll history.
Meaningful movement charts and historical team profiles should wait for either
multiple real polls or an explicitly approved historical-data fixture/import.

## Current decision

V2 current-results polish is live and verified. The next proposed testing slice
is a second fake poll whose ballots deliberately reverse the preseason order.
That fixture can verify per-row movement, biggest risers/fallers, a two-point
team history, championship-vote movement, and initial
polarization/consensus calculations.

Before opening that poll, add and review a narrow aggregate history contract.
The public response should expose previous rank and only the derived historical
metrics required by the approved dashboard. It must not expose individual
ballots or raw private-table access. The permanent deterministic demo must be
excluded from real previous-poll selection.

The detailed ballot pattern and expected results are recorded in the handover.
This document approves the direction, not a production database mutation:
creating the new poll, applying a migration, publishing results, cleanup,
commit, push, and deployment each still require an explicit execution request.

## Deferred cleanup

After the second-poll dashboard verification, clean up both temporary real-flow
fixtures in one reviewed operation. The exact final choice is still open:

- Delete only the second test poll and retain the fake preseason baseline for
  further dashboard work; or
- Delete both fake poll histories, then recreate/reopen the real preseason poll
  with an explicitly approved deadline.

Any deletion must preview and assert the exact poll IDs and dependent row
counts first. Preserve the permanent voter/team registries and
`sb3_2026_v1_demo` unless separately approved.
