-- Add the Keeper league to the established AP Poll system. The poll snapshot
-- deliberately permits only Will and Andrew to cast ballots, while all 12
-- current JRWLL franchises remain rankable.

create or replace function poll_private.ap_poll_published_results(p_poll_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with current_poll as (
    select p.id, p.league_slug, p.season, p.week, p.published_at
    from poll_private.polls p
    where p.id = p_poll_id
  ),
  previous_poll as (
    select candidate.id
    from current_poll cp
    join lateral (
      select p.id
      from poll_private.polls p
      where p.league_slug = cp.league_slug
        and p.status = 'published'
        and not p.is_demo
        and p.id <> cp.id
        and p.published_at < cp.published_at
        and (
          p.season < cp.season
          or (p.season = cp.season and coalesce(p.week, -1) <= coalesce(cp.week, -1))
        )
      order by p.season desc, coalesce(p.week, -1) desc, p.published_at desc, p.id desc
      limit 1
    ) candidate on true
  ),
  included_polls as (
    select id from current_poll
    union
    select id from previous_poll
  ),
  team_counts as (
    select pt.poll_id, count(*)::integer as team_count
    from poll_private.poll_teams pt
    where pt.poll_id in (select id from included_polls)
    group by pt.poll_id
  ),
  ranking_stats as (
    select
      pt.poll_id,
      pt.team_id,
      pt.display_name_snapshot,
      pt.owner_label_snapshot,
      coalesce(sum(tc.team_count + 1 - br.rank), 0)::integer as ap_points,
      round(avg(br.rank)::numeric, 2) as average_rank,
      count(*) filter (where br.rank = 1)::integer as first_place_votes,
      (max(br.rank) - min(br.rank))::integer as rank_range,
      round(stddev_pop(br.rank)::numeric, 2) as rank_stddev,
      array(
        select count(*)::integer
        from generate_series(1, tc.team_count) as placement(rank)
        left join poll_private.ballot_rankings placement_ranking
          on placement_ranking.poll_id = pt.poll_id
          and placement_ranking.team_id = pt.team_id
          and placement_ranking.rank = placement.rank
        group by placement.rank
        order by placement.rank
      ) as placement_counts
    from poll_private.poll_teams pt
    join team_counts tc on tc.poll_id = pt.poll_id
    left join poll_private.ballot_rankings br
      on br.poll_id = pt.poll_id and br.team_id = pt.team_id
    where pt.poll_id in (select id from included_polls)
    group by pt.poll_id, pt.team_id, pt.display_name_snapshot, pt.owner_label_snapshot, tc.team_count
  ),
  scored as (
    select
      rs.*,
      (select count(*)::integer from poll_private.ballots b
        where b.poll_id = rs.poll_id and b.championship_team_id = rs.team_id) as championship_votes,
      (select count(*)::integer from poll_private.ballots b
        where b.poll_id = rs.poll_id and b.underrated_team_id = rs.team_id) as underrated_votes,
      (select count(*)::integer from poll_private.ballots b
        where b.poll_id = rs.poll_id and b.overrated_team_id = rs.team_id) as overrated_votes
    from ranking_stats rs
  ),
  ranked as (
    select
      row_number() over (
        partition by poll_id
        order by ap_points desc, placement_counts desc, team_id asc
      )::integer as official_rank,
      *
    from scored
  ),
  current_results as (
    select r.* from ranked r join current_poll cp on cp.id = r.poll_id
  ),
  previous_results as (
    select r.team_id, r.official_rank from ranked r join previous_poll pp on pp.id = r.poll_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rank', current_results.official_rank,
        'team_id', current_results.team_id,
        'display_name', current_results.display_name_snapshot,
        'owner_label', current_results.owner_label_snapshot,
        'ap_points', current_results.ap_points,
        'average_rank', current_results.average_rank,
        'first_place_votes', current_results.first_place_votes,
        'championship_votes', current_results.championship_votes,
        'underrated_votes', current_results.underrated_votes,
        'overrated_votes', current_results.overrated_votes,
        'previous_rank', previous_results.official_rank,
        'rank_change', previous_results.official_rank - current_results.official_rank,
        'rank_range', current_results.rank_range,
        'rank_stddev', current_results.rank_stddev
      ) order by current_results.official_rank
    ),
    '[]'::jsonb
  )
  from current_results
  left join previous_results using (team_id);
$function$;

create or replace function poll_private.ap_poll_submit_ballot(
  p_poll_id text,
  p_voter_id text,
  p_ranked_team_ids text[],
  p_championship_team_id text,
  p_underrated_team_id text,
  p_overrated_team_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_poll poll_private.polls%rowtype;
  v_ballot_id bigint;
  v_submitted_at timestamptz;
  v_team_count integer;
begin
  select p.* into v_poll from poll_private.polls p where p.id = p_poll_id for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'Poll not found.';
  end if;
  if v_poll.status <> 'open'
    or (v_poll.opens_at is not null and now() < v_poll.opens_at)
    or (v_poll.closes_at is not null and now() >= v_poll.closes_at)
  then
    raise exception using errcode = 'P0001', message = 'This poll is not accepting ballots.';
  end if;
  if not exists (
    select 1 from poll_private.poll_voters pv
    where pv.poll_id = p_poll_id and pv.voter_id = p_voter_id
  ) then
    raise exception using errcode = 'P0001', message = 'This voter is not eligible for the poll.';
  end if;
  select count(*)::integer into v_team_count
  from poll_private.poll_teams pt where pt.poll_id = p_poll_id;
  if v_team_count = 0
    or coalesce(array_length(p_ranked_team_ids, 1), 0) <> v_team_count
    or (select count(distinct team_id) from unnest(p_ranked_team_ids) as ranked(team_id)) <> v_team_count
    or exists (
      select 1
      from unnest(p_ranked_team_ids) as ranked(team_id)
      left join poll_private.poll_teams pt
        on pt.poll_id = p_poll_id and pt.team_id = ranked.team_id
      where pt.team_id is null
    )
  then
    raise exception using errcode = 'P0001', message = 'A ballot must rank every eligible team exactly once.';
  end if;
  if not exists (select 1 from poll_private.poll_teams where poll_id = p_poll_id and team_id = p_championship_team_id)
    or not exists (select 1 from poll_private.poll_teams where poll_id = p_poll_id and team_id = p_underrated_team_id)
    or not exists (select 1 from poll_private.poll_teams where poll_id = p_poll_id and team_id = p_overrated_team_id)
  then
    raise exception using errcode = 'P0001', message = 'All required team selections must be eligible for this poll.';
  end if;
  insert into poll_private.ballots (
    poll_id, voter_id, championship_team_id, underrated_team_id, overrated_team_id
  ) values (
    p_poll_id, p_voter_id, p_championship_team_id, p_underrated_team_id, p_overrated_team_id
  ) returning id, submitted_at into v_ballot_id, v_submitted_at;
  insert into poll_private.ballot_rankings (ballot_id, poll_id, team_id, rank)
  select v_ballot_id, p_poll_id, ranked.team_id, ranked.ordinality::smallint
  from unnest(p_ranked_team_ids) with ordinality as ranked(team_id, ordinality);
  return jsonb_build_object(
    'ballot_id', v_ballot_id,
    'poll_id', p_poll_id,
    'voter_id', p_voter_id,
    'submitted_at', v_submitted_at
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'This voter has already submitted a ballot for this poll.';
end;
$function$;

insert into poll_private.voters (id, league_slug, display_name, sleeper_user_id) values
  ('jrwll_voter_340281844429778944', 'jrwll', 'Kevin Flaherty', '340281844429778944'),
  ('jrwll_voter_461956667970416640', 'jrwll', 'Matt Pitman', '461956667970416640'),
  ('jrwll_voter_560589321712160768', 'jrwll', 'Sean Richardson', '560589321712160768'),
  ('jrwll_voter_608930747402739712', 'jrwll', 'Will Dooling', '608930747402739712'),
  ('jrwll_voter_734209669215731712', 'jrwll', 'Brian Harty', '734209669215731712'),
  ('jrwll_voter_734212975195480064', 'jrwll', 'Andrew Johnstone', '734212975195480064'),
  ('jrwll_voter_734216844734550016', 'jrwll', 'Malcolm Zeroka', '734216844734550016'),
  ('jrwll_voter_734217413658316800', 'jrwll', 'Matt Manzo', '734217413658316800'),
  ('jrwll_voter_735277065154207744', 'jrwll', 'Adam Ellis', '735277065154207744'),
  ('jrwll_voter_735641520723611648', 'jrwll', 'Connor Cademartori', '735641520723611648'),
  ('jrwll_voter_737771947097985024', 'jrwll', 'Johnny Jones', '737771947097985024'),
  ('jrwll_voter_857692118150393856', 'jrwll', 'Patrick Gavin', '857692118150393856');

insert into poll_private.teams (
  id, league_slug, display_name, owner_label, current_owner_voter_id, sleeper_roster_id, sleeper_roster_owner_user_id
) values
  ('jrwll_franchise_01', 'jrwll', 'Sea Shanties w/ Jeanty', 'Will Dooling', 'jrwll_voter_608930747402739712', 1, '608930747402739712'),
  ('jrwll_franchise_02', 'jrwll', 'Breece Mode', 'Brian Harty', 'jrwll_voter_734209669215731712', 2, '734209669215731712'),
  ('jrwll_franchise_03', 'jrwll', 'Leader of Men: Saquonto', 'Andrew Johnstone', 'jrwll_voter_734212975195480064', 3, '734212975195480064'),
  ('jrwll_franchise_04', 'jrwll', 'Toilet Bowl Bound', 'Malcolm Zeroka', 'jrwll_voter_734216844734550016', 4, '734216844734550016'),
  ('jrwll_franchise_05', 'jrwll', 'The Holdouts', 'Matt Manzo', 'jrwll_voter_734217413658316800', 5, '734217413658316800'),
  ('jrwll_franchise_06', 'jrwll', 'Wait, this isnt dynasty??', 'Matt Pitman', 'jrwll_voter_461956667970416640', 6, '461956667970416640'),
  ('jrwll_franchise_07', 'jrwll', 'Koorapika', 'Adam Ellis', 'jrwll_voter_735277065154207744', 7, '735277065154207744'),
  ('jrwll_franchise_08', 'jrwll', 'Pitts Revenge Tour pt 2', 'Connor Cademartori', 'jrwll_voter_735641520723611648', 8, '735641520723611648'),
  ('jrwll_franchise_09', 'jrwll', 'Hi Naber!', 'Kevin Flaherty', 'jrwll_voter_340281844429778944', 9, '340281844429778944'),
  ('jrwll_franchise_10', 'jrwll', 'The Dallas Unicycles', 'Johnny Jones', 'jrwll_voter_737771947097985024', 10, '737771947097985024'),
  ('jrwll_franchise_11', 'jrwll', 'Sean Richardson', 'Sean Richardson', 'jrwll_voter_560589321712160768', 11, '560589321712160768'),
  ('jrwll_franchise_12', 'jrwll', 'Dark times', 'Patrick Gavin', 'jrwll_voter_857692118150393856', 12, '857692118150393856');

insert into poll_private.polls (
  id, league_slug, sleeper_league_id, season, label, week, status, is_demo, opens_at
) values (
  'jrwll_2026_preseason', 'jrwll', '1180633944818466816', 2026, '2026 Preseason Keeper Power Ranking', 0, 'open', false, now()
);

insert into poll_private.poll_voters (poll_id, voter_id, display_name_snapshot) values
  ('jrwll_2026_preseason', 'jrwll_voter_608930747402739712', 'Will Dooling'),
  ('jrwll_2026_preseason', 'jrwll_voter_734212975195480064', 'Andrew Johnstone');

insert into poll_private.poll_teams (poll_id, team_id, display_name_snapshot, owner_label_snapshot)
select 'jrwll_2026_preseason', t.id, t.display_name, t.owner_label
from poll_private.teams t
where t.league_slug = 'jrwll' and t.active
order by t.id;
