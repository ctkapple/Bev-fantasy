# Super Beef 3-Way AP Poll database

Living product roadmap and verification status:
[`docs/ap-poll-plan.md`](../docs/ap-poll-plan.md).
Historical dashboard testing handover:
[`docs/ap-poll-dashboard-testing-handover.md`](../docs/ap-poll-dashboard-testing-handover.md).

Phase 1 is deployed to the free-tier Supabase project `gkxpwopjmfdxymhsbnyh` at
`https://gkxpwopjmfdxymhsbnyh.supabase.co`.

The browser must use the project's active modern publishable key. Never put a
secret key, service-role key, database password, or personal access token in the
site source.

## Design

- `poll_private` owns voters, permanent franchise identities, polls, poll
  snapshots, ballots, and ballot rankings.
- Raw private tables have forced RLS and no browser-facing policies or grants.
- `public.ap_poll_get_state('sb3')` returns the current open, closed, or
  published poll. Rankings and auxiliary results appear only after publishing.
- `public.ap_poll_submit_ballot(...)` validates and atomically stores one ballot
  per eligible voter. V1 does not allow ballot edits after submission.
- Every ballot must rank all 14 eligible franchises exactly once. A rank earns
  `15 - rank` AP points (14 points for first through 1 point for fourteenth).
- Ties are ordered by AP points, then counts of first-place votes through
  fourteenth-place votes, then permanent franchise ID.
- Franchise IDs such as `sb3_franchise_01` are stable even when a team name or
  owner changes. Poll snapshots preserve the labels shown for that poll.
- One voter is one person, not one franchise. Co-managed franchises have a voter
  per manager and therefore submit more than one ballot. `teams.owner_label`
  holds the combined public label ("Kevin & Chris"), independent of the voter
  named in `teams.current_owner_voter_id`.

The initial poll `sb3_2026_v1_demo` is explicitly marked `is_demo = true`. Its
14 complete ballots are deterministic sample data, not real votes.

## Browser RPCs

Read the current poll:

```js
const { data, error } = await supabase.rpc("ap_poll_get_state", {
  p_league_slug: "sb3",
});
```

Submit an open-poll ballot:

```js
const { data, error } = await supabase.rpc("ap_poll_submit_ballot", {
  p_poll_id: "sb3_2026_preseason",
  p_voter_id: "sb3_voter_<sleeper-user-id>",
  p_ranked_team_ids: [/* all 14 permanent franchise IDs, best to worst */],
  p_championship_team_id: "sb3_franchise_01",
  p_underrated_team_id: "sb3_franchise_02",
  p_overrated_team_id: "sb3_franchise_03",
});
```

Treat all RPC errors as user-facing validation failures. A duplicate ballot,
ineligible voter, malformed ranking, or non-open poll is rejected by the
database.

## Poll administration

Run administration SQL in the Supabase SQL editor, not in browser code. Replace
the example IDs, label, dates, and season before executing.

Create a draft and snapshot the currently active SB3 voters and franchises:

```sql
begin;

insert into poll_private.polls (
  id, league_slug, sleeper_league_id, season, label, week, status, is_demo
) values (
  'sb3_2026_preseason',
  'sb3',
  '1180197099396288512',
  2026,
  '2026 Preseason AP Poll',
  0,
  'draft',
  false
);

insert into poll_private.poll_voters (
  poll_id, voter_id, display_name_snapshot
)
select 'sb3_2026_preseason', id, display_name
from poll_private.voters
where league_slug = 'sb3' and active
order by id;

insert into poll_private.poll_teams (
  poll_id, team_id, display_name_snapshot, owner_label_snapshot
)
select
  'sb3_2026_preseason',
  t.id,
  t.display_name,
  t.owner_label
from poll_private.teams t
where t.league_slug = 'sb3' and t.active
order by t.id;

commit;
```

Week `0` denotes the preseason; positive values denote regular-season weeks.

Confirm that the new poll has exactly 16 voters and 14 teams before opening it:

```sql
select
  p.id,
  p.status,
  (select count(*) from poll_private.poll_voters where poll_id = p.id) as voters,
  (select count(*) from poll_private.poll_teams where poll_id = p.id) as teams
from poll_private.polls p
where p.id = 'sb3_2026_preseason';
```

Open the draft. Only one poll per league can be open at a time:

```sql
update poll_private.polls
set status = 'open',
    opens_at = now(),
    closes_at = '2026-09-01 23:59:59-04',
    updated_at = now()
where id = 'sb3_2026_preseason' and status = 'draft';
```

Close submissions without showing results:

```sql
update poll_private.polls
set status = 'closed', updated_at = now()
where id = 'sb3_2026_preseason' and status = 'open';
```

Publish the results:

```sql
update poll_private.polls
set status = 'published', published_at = now(), updated_at = now()
where id = 'sb3_2026_preseason' and status = 'closed';
```

Remove the V1 sample poll immediately before loading the supplied real results:

```sql
delete from poll_private.polls
where id = 'sb3_2026_v1_demo' and is_demo;
```

Migration `20260811022729_add_ap_poll_poll_delete_cascades.sql` makes this delete
cascade only through that poll's snapshots, ballots, and rankings; it does not
delete the permanent SB3 voter or franchise registry.

## Updating league membership

Update the permanent registry before creating the next poll. Preserve existing
franchise IDs. Mark departed voters or franchises inactive instead of deleting
history, and assign a new permanent voter ID when ownership changes. Snapshot
queries above freeze the current labels for the new poll.

To add a manager to a co-managed franchise, insert a voter for them and leave
`teams.owner_label` alone. Do not point a second `teams.current_owner_voter_id`
at the same franchise; that column names the primary owner only.

## Expected advisor notices

Supabase's security advisor reports `rls_enabled_no_policy` informational notices
for all seven `poll_private` tables. This is intentional: the schema is not
exposed, raw table privileges are revoked, and its forced RLS has no public
policies. Browser access is limited to the two validated RPC wrappers.
