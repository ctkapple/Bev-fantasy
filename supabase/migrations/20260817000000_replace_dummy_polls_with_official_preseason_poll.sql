-- Remove the two documented dummy poll histories and open a clean official
-- preseason poll. Keep the permanent voter and franchise registries intact.
--
-- The assertions intentionally make this migration fail closed if production
-- no longer matches the audited dummy-data state recorded in the poll plan.
do $migration$
declare
  v_unexpected_poll_ids text[];
  v_demo_ballots integer;
  v_demo_rankings integer;
  v_preseason_ballots integer;
  v_preseason_rankings integer;
  v_voter_count integer;
  v_team_count integer;
begin
  select array_agg(p.id order by p.id)
  into v_unexpected_poll_ids
  from poll_private.polls p
  where p.league_slug = 'sb3'
    and p.id not in ('sb3_2026_v1_demo', 'sb3_2026_preseason');

  if v_unexpected_poll_ids is not null then
    raise exception
      'AP Poll reset aborted: unexpected SB3 poll IDs: %',
      v_unexpected_poll_ids;
  end if;

  if not exists (
    select 1
    from poll_private.polls
    where id = 'sb3_2026_v1_demo'
      and league_slug = 'sb3'
      and status = 'published'
      and is_demo
  ) then
    raise exception 'AP Poll reset aborted: documented V1 demo poll was not found in its expected state';
  end if;

  if not exists (
    select 1
    from poll_private.polls
    where id = 'sb3_2026_preseason'
      and league_slug = 'sb3'
      and status = 'published'
      and not is_demo
  ) then
    raise exception 'AP Poll reset aborted: documented fake preseason poll was not found in its expected state';
  end if;

  select count(*)
  into v_demo_ballots
  from poll_private.ballots
  where poll_id = 'sb3_2026_v1_demo';

  select count(*)
  into v_demo_rankings
  from poll_private.ballot_rankings
  where poll_id = 'sb3_2026_v1_demo';

  select count(*)
  into v_preseason_ballots
  from poll_private.ballots
  where poll_id = 'sb3_2026_preseason';

  select count(*)
  into v_preseason_rankings
  from poll_private.ballot_rankings
  where poll_id = 'sb3_2026_preseason';

  if (v_demo_ballots, v_demo_rankings) <> (14, 196) then
    raise exception
      'AP Poll reset aborted: V1 demo has % ballots and % rankings; expected 14 and 196',
      v_demo_ballots,
      v_demo_rankings;
  end if;

  if (v_preseason_ballots, v_preseason_rankings) <> (3, 42) then
    raise exception
      'AP Poll reset aborted: fake preseason poll has % ballots and % rankings; expected 3 and 42',
      v_preseason_ballots,
      v_preseason_rankings;
  end if;

  -- Cascading foreign keys remove only these polls' snapshots, ballots, and
  -- rankings. Permanent poll_private.voters and poll_private.teams survive.
  delete from poll_private.polls
  where id in ('sb3_2026_v1_demo', 'sb3_2026_preseason');

  insert into poll_private.polls (
    id,
    league_slug,
    sleeper_league_id,
    season,
    label,
    week,
    status,
    is_demo,
    opens_at
  ) values (
    'sb3_2026_preseason',
    'sb3',
    '1180197099396288512',
    2026,
    '2026 Preseason AP Poll',
    0,
    'open',
    false,
    now()
  );

  insert into poll_private.poll_voters (
    poll_id,
    voter_id,
    display_name_snapshot
  )
  select
    'sb3_2026_preseason',
    v.id,
    v.display_name
  from poll_private.voters v
  where v.league_slug = 'sb3'
    and v.active
  order by v.id;

  insert into poll_private.poll_teams (
    poll_id,
    team_id,
    display_name_snapshot,
    owner_label_snapshot
  )
  select
    'sb3_2026_preseason',
    t.id,
    t.display_name,
    t.owner_label
  from poll_private.teams t
  where t.league_slug = 'sb3'
    and t.active
  order by t.id;

  select count(*)
  into v_voter_count
  from poll_private.poll_voters
  where poll_id = 'sb3_2026_preseason';

  select count(*)
  into v_team_count
  from poll_private.poll_teams
  where poll_id = 'sb3_2026_preseason';

  if (v_voter_count, v_team_count) <> (16, 14) then
    raise exception
      'AP Poll creation aborted: official poll has % voters and % teams; expected 16 and 14',
      v_voter_count,
      v_team_count;
  end if;
end
$migration$;
