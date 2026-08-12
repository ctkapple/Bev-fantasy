# AP Poll historical dashboard testing handover

## Purpose

Continue from the verified V2 results page by creating one controlled fake
follow-up poll. The follow-up data is designed to test:

- Per-team Trend values.
- Biggest Risers and Biggest Fallers.
- Championship Favorite movement.
- A two-poll ranking history.
- Polarization and consensus calculations.
- Existing open, closed, and published behavior with a new poll.

This is a handover and test design. It does not authorize a migration, poll
creation, status change, submission, deletion, commit, push, or deployment.

## Current live state

- Live page: <https://www.bevfantasy.com/sb3/poll/>
- Deployed dashboard commit: `33bdc38`.
- Current baseline poll: `sb3_2026_preseason`.
- Baseline status: `published`.
- Baseline data: 3 fake ballots, 42 ranking rows, 14 result rows, and 315 AP
  points.
- The permanent deterministic `sb3_2026_v1_demo` remains published and must
  not be used as previous-poll history.
- The public browser contract remains limited to
  `public.ap_poll_get_state` and `public.ap_poll_submit_ballot`. Raw
  `poll_private` tables remain private.
- Individual-ballot viewing and admin controls remain out of scope.

Do not clear the baseline poll before completing the follow-up test. It is the
only meaningful previous-poll fixture.

## Important current limitation

The results UI understands a `previous_rank` field, but the current public RPC
does not return one. It also does not return a historical series or rank
dispersion. A second poll can be submitted with the existing system, but Trend,
risers/fallers, history charts, polarization, and consensus cannot be verified
until a reviewed aggregate-only RPC change is deployed.

The current poll selector prioritizes `open`, then `closed`, then the most
recently published poll. Opening the follow-up poll will therefore make it the
public AP Poll page immediately. Closing it keeps the closed state public, and
publishing it makes its results current.

## Recommended implementation order

### 1. Add the smallest aggregate history contract

Start with a reviewed migration that extends the private calculation and
public RPC response without exposing ballots.

Recommended current-result fields:

- `previous_rank`: official rank in the immediately preceding published poll.
- `rank_change`: `previous_rank - rank`; positive means a rise.
- `rank_range`: highest ballot rank minus lowest ballot rank for the current
  poll.
- `rank_stddev`: population standard deviation of current ballot ranks.

The client can derive Biggest Risers and Biggest Fallers from the complete
14-team result array. Do not derive those modules from the displayed Top 10,
because the largest fallers in this fixture finish outside it.

Recommended previous-poll rule:

- Same league.
- Published before the current poll.
- `is_demo = false`.
- Most recent by season, week, publication time, and a deterministic final
  tie-break.
- Never use `sb3_2026_v1_demo` as genuine history.

For the first pass, `previous_rank` plus the current poll's dispersion metrics
is enough. Add a full aggregate historical series only when implementing the
multi-poll graph. Keep raw ballots and voter choices private.

### 2. Verify the contract before creating data

- Run the database/security advisors.
- Confirm anonymous callers still receive aggregates only.
- Confirm the existing published preseason poll returns `previous_rank = null`.
- Confirm the current page continues to show an em dash when no prior poll
  exists.
- Run the normal site, CSS, JavaScript, validation, and diff checks.
- Obtain explicit approval before applying the migration or deploying it.

### 3. Create the controlled follow-up poll

Suggested values:

| Field | Value |
| --- | --- |
| ID | `sb3_2026_week_1_test` |
| Label | `TEST - 2026 Week 1 AP Poll` |
| League | `sb3` |
| Season | `2026` |
| Week | `1` |
| Initial status | `draft` |
| `is_demo` | `false` |

`is_demo = false` is deliberate: the test should exercise the same previous
non-demo poll path that real weekly polls will use. The visible `TEST` label
makes its temporary nature clear. Delete it after testing unless another
dashboard iteration still needs it.

Use the existing administration transaction in `supabase/README.md` to snapshot
the currently active 14 voters and 14 teams. Before opening, assert exactly 14
voter snapshots, 14 team snapshots, zero ballots, and zero ranking rows. Only
one SB3 poll may be open.

## Three-ballot fixture

Use three distinct eligible voters. Device coverage is optional because the
submission flow has already passed desktop/mobile testing, but one mobile and
two desktop browsers would give a useful regression pass.

### Ballots A and B: reverse the baseline

Submit this exact order for two voters:

1. BLL 2011 LLWS Champions
2. Connor Cademartori
3. Zeno's Roast Beef Llc.
4. Gregs Taverns Beefs FC
5. Malcolm Zeroka
6. Johnny Jones
7. A little mahomie
8. The Impossible Beef
9. The Beyond Beef
10. Mastro Titta
11. Brockoli Bites
12. Large Beef 3-Maye
13. Jayden's Meat
14. Extra Sauce, No Bread

### Ballot C: repeat the baseline order

Submit this exact order for the third voter:

1. Extra Sauce, No Bread
2. Jayden's Meat
3. Large Beef 3-Maye
4. Brockoli Bites
5. Mastro Titta
6. The Beyond Beef
7. The Impossible Beef
8. A little mahomie
9. Johnny Jones
10. Malcolm Zeroka
11. Gregs Taverns Beefs FC
12. Zeno's Roast Beef Llc.
13. Connor Cademartori
14. BLL 2011 LLWS Champions

### Final-pick fixture

| Ballot | Championship | Underrated | Overrated |
| --- | --- | --- | --- |
| A | BLL 2011 LLWS Champions | Connor Cademartori | Extra Sauce, No Bread |
| B | BLL 2011 LLWS Champions | Zeno's Roast Beef Llc. | Extra Sauce, No Bread |
| C | Connor Cademartori | Connor Cademartori | Jayden's Meat |

Expected winner cards:

- Championship Favorite: BLL 2011 LLWS Champions, 2 votes, 67%.
- Most Underrated: Connor Cademartori, 2 votes, 67%.
- Most Overrated: Extra Sauce, No Bread, 2 votes, 67%.

The existing preseason fixture already verifies three-way award ties. This
follow-up verifies clear single winners and changed winners.

## Exact expected rankings

The two reverse ballots outweigh the one baseline ballot while retaining
useful disagreement. Total AP points must still equal `3 * 105 = 315`.

| New rank | Team | AP points | Previous rank | Trend |
| ---: | --- | ---: | ---: | ---: |
| 1 | BLL 2011 LLWS Champions | 29 | 14 | up 13 |
| 2 | Connor Cademartori | 28 | 13 | up 11 |
| 3 | Zeno's Roast Beef Llc. | 27 | 12 | up 9 |
| 4 | Gregs Taverns Beefs FC | 26 | 11 | up 7 |
| 5 | Malcolm Zeroka | 25 | 10 | up 5 |
| 6 | Johnny Jones | 24 | 9 | up 3 |
| 7 | A little mahomie | 23 | 8 | up 1 |
| 8 | The Impossible Beef | 22 | 7 | down 1 |
| 9 | The Beyond Beef | 21 | 6 | down 3 |
| 10 | Mastro Titta | 20 | 5 | down 5 |
| 11 | Brockoli Bites | 19 | 4 | down 7 |
| 12 | Large Beef 3-Maye | 18 | 3 | down 9 |
| 13 | Jayden's Meat | 17 | 2 | down 11 |
| 14 | Extra Sauce, No Bread | 16 | 1 | down 13 |

The public ranking list should show only ranks 1-10. The complete 14-team
aggregate remains necessary for the movement modules.

## Expected dashboard results

### Trend column

- Ranks 1-7 show green upward movement.
- Ranks 8-10 show red downward movement.
- The four teams outside the Top 10 remain absent from the ranking list.
- No row should show an em dash after the history contract identifies the
  preseason baseline.

### Biggest movement

Biggest Risers:

1. BLL 2011 LLWS Champions: up 13.
2. Connor Cademartori: up 11.
3. Zeno's Roast Beef Llc.: up 9.

Biggest Fallers, calculated across all 14 teams:

1. Extra Sauce, No Bread: down 13.
2. Jayden's Meat: down 11.
3. Large Beef 3-Maye: down 9.

This proves that Biggest Fallers cannot be calculated from Top 10 rows alone.

### Polarization and consensus

If rank range is used as the simple display metric:

- Most Polarizing is a tie between BLL 2011 LLWS Champions and Extra Sauce,
  No Bread. Each has a 13-place range.
- Strongest Consensus is a tie between A little mahomie and The Impossible
  Beef. Each has a 1-place range.

Use population standard deviation for stable sorting if desired, but show a
plain-English value such as `13-place spread` in the UI. Require at least three
ballots before presenting polarization or consensus as meaningful.

### History presentation

Two published polls are enough to verify data plumbing, labels, ordering, team
selection, inverted rank axes, and movement direction. They are not enough to
judge a meaningful trend line. A third controlled poll or eventual real Week 2
poll is required before approving the full historical chart visually.

Recommended dashboard sequence:

1. Add Trend to the existing Top 10.
2. Add compact Biggest Risers and Biggest Fallers cards.
3. Add Championship Favorite movement/summary.
4. Add Polarizing and Consensus cards after their metric is approved.
5. Add the full history graph and team profiles only after a third poll exists.

## End-to-end execution checklist

### Before opening

- Confirm the history migration and frontend are deployed.
- Confirm the preseason baseline remains published and unchanged.
- Confirm the new poll is a draft with 14 voters and 14 teams.
- Confirm the new poll label visibly says `TEST`.

### While open

- Confirm the page selects the new open poll.
- Submit Ballots A, B, and C from three distinct voters.
- Confirm the submission count progresses to 3 of 14.
- Confirm submitted-voter state updates in another browser.
- Recheck one stale-device duplicate attempt if desired.
- Confirm no result aggregate or movement is public while open.

### While closed

- Confirm new submissions are rejected.
- Confirm results and historical movement remain hidden.
- Confirm `Check for results` performs a read-only refresh.

### After publishing

- Confirm the exact 14-team ranking table above through a private database
  audit.
- Confirm 3 ballots, 42 ranking rows, 14 results, and 315 AP points.
- Confirm the live Top 10, Trends, movement cards, winner cards, and any approved
  dispersion modules on desktop and mobile.
- Confirm the public RPC returns aggregates only and no individual ballots.
- Confirm the permanent deterministic demo did not become previous history.

## Cleanup boundary

Do not clean up automatically after the test. Stop and ask which fixture should
remain:

1. Delete only `sb3_2026_week_1_test`, retaining the preseason baseline; or
2. Delete both fake real-flow polls and recreate/reopen the true preseason poll.

Before deleting, preview exact counts for poll snapshots, ballots, ranking rows,
and any stored result/history rows. Deletion may cascade only through the named
polls. Preserve permanent voter/team registries and `sb3_2026_v1_demo`.

## Suggested continuation prompt

> Review `docs/ap-poll-plan.md` and
> `docs/ap-poll-dashboard-testing-handover.md`. Inspect the current Supabase
> migrations and live state. Propose the smallest aggregate-only history RPC
> change needed for previous rank, risers/fallers, and rank dispersion. Do not
> change production until I approve the migration and test-poll creation.
