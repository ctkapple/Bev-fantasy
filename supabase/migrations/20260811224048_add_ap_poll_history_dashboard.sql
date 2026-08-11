-- The dashboard receives only published, non-demo aggregate results. It never
-- exposes ballots, voter selections, or rank distributions.
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
                  'ap_points', result.value->'ap_points'
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

create or replace function public.ap_poll_get_history(p_league_slug text default 'sb3')
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select poll_private.ap_poll_get_history(p_league_slug);
$function$;

revoke all on function poll_private.ap_poll_get_history(text) from public, anon, authenticated;
revoke all on function public.ap_poll_get_history(text) from public, anon, authenticated;

grant execute on function poll_private.ap_poll_get_history(text) to anon;
grant execute on function public.ap_poll_get_history(text) to anon;
