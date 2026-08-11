-- Published results remain aggregate-only. Previous-poll comparisons exclude
-- deterministic demo polls and never return any individual ballot data.
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
          or (
            p.season = cp.season
            and coalesce(p.week, -1) < coalesce(cp.week, -1)
          )
          or (
            p.season = cp.season
            and coalesce(p.week, -1) = coalesce(cp.week, -1)
          )
        )
      order by
        p.season desc,
        coalesce(p.week, -1) desc,
        p.published_at desc,
        p.id desc
      limit 1
    ) candidate on true
  ),
  included_polls as (
    select id from current_poll
    union
    select id from previous_poll
  ),
  ranking_stats as (
    select
      pt.poll_id,
      pt.team_id,
      pt.display_name_snapshot,
      pt.owner_label_snapshot,
      coalesce(sum(15 - br.rank), 0)::integer as ap_points,
      round(avg(br.rank)::numeric, 2) as average_rank,
      count(*) filter (where br.rank = 1)::integer as first_place_votes,
      (max(br.rank) - min(br.rank))::integer as rank_range,
      round(stddev_pop(br.rank)::numeric, 2) as rank_stddev,
      array[
        count(*) filter (where br.rank = 1),
        count(*) filter (where br.rank = 2),
        count(*) filter (where br.rank = 3),
        count(*) filter (where br.rank = 4),
        count(*) filter (where br.rank = 5),
        count(*) filter (where br.rank = 6),
        count(*) filter (where br.rank = 7),
        count(*) filter (where br.rank = 8),
        count(*) filter (where br.rank = 9),
        count(*) filter (where br.rank = 10),
        count(*) filter (where br.rank = 11),
        count(*) filter (where br.rank = 12),
        count(*) filter (where br.rank = 13),
        count(*) filter (where br.rank = 14)
      ] as placement_counts
    from poll_private.poll_teams pt
    left join poll_private.ballot_rankings br
      on br.poll_id = pt.poll_id and br.team_id = pt.team_id
    where pt.poll_id in (select id from included_polls)
    group by pt.poll_id, pt.team_id, pt.display_name_snapshot, pt.owner_label_snapshot
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
    select r.*
    from ranked r
    join current_poll cp on cp.id = r.poll_id
  ),
  previous_results as (
    select r.team_id, r.official_rank
    from ranked r
    join previous_poll pp on pp.id = r.poll_id
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
