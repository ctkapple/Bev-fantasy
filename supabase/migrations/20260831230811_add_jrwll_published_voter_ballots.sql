-- Published JRWLL ballots are exposed only through this deliberate, narrow
-- read model. Raw poll_private tables remain unavailable to browser roles.
create or replace function poll_private.ap_poll_get_published_voter_history(
  p_league_slug text,
  p_voter_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with published_ballots as (
    select
      p.id,
      p.season,
      p.week,
      p.label,
      p.published_at,
      pv.voter_id,
      pv.display_name_snapshot,
      b.championship_team_id,
      b.underrated_team_id,
      b.overrated_team_id
    from poll_private.polls p
    join poll_private.poll_voters pv
      on pv.poll_id = p.id
      and pv.voter_id = p_voter_id
    join poll_private.ballots b
      on b.poll_id = p.id
      and b.voter_id = pv.voter_id
    where p.league_slug = p_league_slug
      and p_league_slug = 'jrwll'
      and p.status = 'published'
      and not p.is_demo
  )
  select jsonb_build_object(
    'voter', (
      select jsonb_build_object(
        'id', pb.voter_id,
        'display_name', pb.display_name_snapshot
      )
      from published_ballots pb
      order by pb.season desc, coalesce(pb.week, -1) desc, pb.published_at desc, pb.id desc
      limit 1
    ),
    'polls', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', pb.id,
          'season', pb.season,
          'week', pb.week,
          'label', pb.label,
          'published_at', pb.published_at,
          'voter', jsonb_build_object(
            'id', pb.voter_id,
            'display_name', pb.display_name_snapshot
          ),
          'rankings', (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'rank', br.rank,
                  'team_id', pt.team_id,
                  'display_name', pt.display_name_snapshot,
                  'owner_label', pt.owner_label_snapshot
                ) order by br.rank
              ),
              '[]'::jsonb
            )
            from poll_private.ballot_rankings br
            join poll_private.poll_teams pt
              on pt.poll_id = br.poll_id
              and pt.team_id = br.team_id
            where br.poll_id = pb.id
              and br.ballot_id = (
                select ballot.id
                from poll_private.ballots ballot
                where ballot.poll_id = pb.id
                  and ballot.voter_id = pb.voter_id
              )
          ),
          'final_picks', jsonb_build_object(
            'championship', (
              select jsonb_build_object(
                'team_id', pt.team_id,
                'display_name', pt.display_name_snapshot,
                'owner_label', pt.owner_label_snapshot
              )
              from poll_private.poll_teams pt
              where pt.poll_id = pb.id
                and pt.team_id = pb.championship_team_id
            ),
            'underrated', (
              select jsonb_build_object(
                'team_id', pt.team_id,
                'display_name', pt.display_name_snapshot,
                'owner_label', pt.owner_label_snapshot
              )
              from poll_private.poll_teams pt
              where pt.poll_id = pb.id
                and pt.team_id = pb.underrated_team_id
            ),
            'overrated', (
              select jsonb_build_object(
                'team_id', pt.team_id,
                'display_name', pt.display_name_snapshot,
                'owner_label', pt.owner_label_snapshot
              )
              from poll_private.poll_teams pt
              where pt.poll_id = pb.id
                and pt.team_id = pb.overrated_team_id
            )
          )
        )
        order by pb.season, coalesce(pb.week, -1), pb.published_at, pb.id
      ),
      '[]'::jsonb
    )
  )
  from published_ballots pb;
$function$;

create or replace function public.ap_poll_get_published_voter_history(
  p_league_slug text,
  p_voter_id text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select poll_private.ap_poll_get_published_voter_history(p_league_slug, p_voter_id);
$function$;

revoke all on function poll_private.ap_poll_get_published_voter_history(text, text) from public, anon, authenticated;
revoke all on function public.ap_poll_get_published_voter_history(text, text) from public, anon, authenticated;

grant execute on function poll_private.ap_poll_get_published_voter_history(text, text) to anon;
grant execute on function public.ap_poll_get_published_voter_history(text, text) to anon;
