-- Preserve the aggregate-only history contract while exposing the existing
-- per-poll average rank needed by the Keeper presentation.
create or replace function poll_private.ap_poll_get_history(p_league_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with published_polls as (
    select
      p.id,
      p.season,
      p.week,
      p.label,
      p.published_at,
      count(b.id)::integer as ballot_count
    from poll_private.polls p
    left join poll_private.ballots b on b.poll_id = p.id
    where p.league_slug = p_league_slug
      and p.status = 'published'
      and not p.is_demo
    group by p.id, p.season, p.week, p.label, p.published_at
  )
  select jsonb_build_object(
    'polls',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'season', p.season,
          'week', p.week,
          'label', p.label,
          'published_at', p.published_at,
          'ballot_count', p.ballot_count,
          'results', (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'rank', result.value->'rank',
                  'team_id', result.value->'team_id',
                  'display_name', result.value->'display_name',
                  'owner_label', result.value->'owner_label',
                  'ap_points', result.value->'ap_points',
                  'average_rank', result.value->'average_rank'
                ) order by (result.value->>'rank')::integer
              ),
              '[]'::jsonb
            )
            from jsonb_array_elements(poll_private.ap_poll_published_results(p.id)) as result(value)
          )
        )
        order by p.season, coalesce(p.week, -1), p.published_at, p.id
      ),
      '[]'::jsonb
    )
  )
  from published_polls p;
$function$;
