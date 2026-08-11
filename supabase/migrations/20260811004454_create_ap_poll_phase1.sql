-- Migration 20260811004454: Super Beef 3-Way AP Poll Phase 1 foundation.
-- Raw ballots remain in a non-exposed schema. The browser receives access only
-- to the two public RPC wrappers defined at the end of this migration.

create schema if not exists poll_private;

revoke all on schema poll_private from public, anon, authenticated;

create table poll_private.voters (
  id text primary key,
  league_slug text not null,
  display_name text not null check (length(trim(display_name)) > 0),
  sleeper_user_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (league_slug, sleeper_user_id)
);

create table poll_private.teams (
  id text primary key,
  league_slug text not null,
  display_name text not null check (length(trim(display_name)) > 0),
  current_owner_voter_id text references poll_private.voters(id),
  sleeper_roster_id integer,
  sleeper_roster_owner_user_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (league_slug, sleeper_roster_id)
);

create table poll_private.polls (
  id text primary key,
  league_slug text not null,
  sleeper_league_id text,
  season integer not null check (season >= 2025),
  label text not null check (length(trim(label)) > 0),
  week integer check (week is null or week > 0),
  status text not null check (status in ('draft', 'open', 'closed', 'published')),
  is_demo boolean not null default false,
  opens_at timestamptz,
  closes_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at is null or opens_at is null or closes_at > opens_at),
  check (status <> 'published' or published_at is not null)
);

create unique index polls_one_open_per_league_idx
  on poll_private.polls (league_slug)
  where status = 'open';

create table poll_private.poll_voters (
  poll_id text not null references poll_private.polls(id) on delete cascade,
  voter_id text not null references poll_private.voters(id),
  display_name_snapshot text not null check (length(trim(display_name_snapshot)) > 0),
  primary key (poll_id, voter_id)
);

create table poll_private.poll_teams (
  poll_id text not null references poll_private.polls(id) on delete cascade,
  team_id text not null references poll_private.teams(id),
  display_name_snapshot text not null check (length(trim(display_name_snapshot)) > 0),
  owner_label_snapshot text not null check (length(trim(owner_label_snapshot)) > 0),
  primary key (poll_id, team_id)
);

create table poll_private.ballots (
  id bigint generated always as identity primary key,
  poll_id text not null,
  voter_id text not null,
  championship_team_id text not null,
  underrated_team_id text not null,
  overrated_team_id text not null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, poll_id),
  unique (poll_id, voter_id),
  foreign key (poll_id, voter_id)
    references poll_private.poll_voters(poll_id, voter_id),
  foreign key (poll_id, championship_team_id)
    references poll_private.poll_teams(poll_id, team_id),
  foreign key (poll_id, underrated_team_id)
    references poll_private.poll_teams(poll_id, team_id),
  foreign key (poll_id, overrated_team_id)
    references poll_private.poll_teams(poll_id, team_id)
);

create table poll_private.ballot_rankings (
  ballot_id bigint not null,
  poll_id text not null,
  team_id text not null,
  rank smallint not null check (rank between 1 and 14),
  primary key (ballot_id, team_id),
  unique (ballot_id, rank),
  foreign key (ballot_id, poll_id)
    references poll_private.ballots(id, poll_id) on delete cascade,
  foreign key (poll_id, team_id)
    references poll_private.poll_teams(poll_id, team_id)
);

-- PostgreSQL does not automatically index foreign-key columns.
create index teams_current_owner_voter_id_idx
  on poll_private.teams (current_owner_voter_id);
create index poll_voters_voter_id_idx
  on poll_private.poll_voters (voter_id);
create index poll_teams_team_id_idx
  on poll_private.poll_teams (team_id);
create index ballots_poll_id_idx
  on poll_private.ballots (poll_id);
create index ballots_championship_team_id_idx
  on poll_private.ballots (championship_team_id);
create index ballots_underrated_team_id_idx
  on poll_private.ballots (underrated_team_id);
create index ballots_overrated_team_id_idx
  on poll_private.ballots (overrated_team_id);
create index ballot_rankings_poll_team_idx
  on poll_private.ballot_rankings (poll_id, team_id);

-- Defense in depth: private tables have RLS enabled with no public policies.
alter table poll_private.voters enable row level security;
alter table poll_private.voters force row level security;
alter table poll_private.teams enable row level security;
alter table poll_private.teams force row level security;
alter table poll_private.polls enable row level security;
alter table poll_private.polls force row level security;
alter table poll_private.poll_voters enable row level security;
alter table poll_private.poll_voters force row level security;
alter table poll_private.poll_teams enable row level security;
alter table poll_private.poll_teams force row level security;
alter table poll_private.ballots enable row level security;
alter table poll_private.ballots force row level security;
alter table poll_private.ballot_rankings enable row level security;
alter table poll_private.ballot_rankings force row level security;

create or replace function poll_private.ap_poll_published_results(p_poll_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with ranking_stats as (
    select
      pt.team_id,
      pt.display_name_snapshot,
      pt.owner_label_snapshot,
      coalesce(sum(15 - br.rank), 0)::integer as ap_points,
      round(avg(br.rank)::numeric, 2) as average_rank,
      count(*) filter (where br.rank = 1)::integer as first_place_votes,
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
    where pt.poll_id = p_poll_id
    group by pt.team_id, pt.display_name_snapshot, pt.owner_label_snapshot
  ),
  scored as (
    select
      rs.*,
      (select count(*)::integer from poll_private.ballots b
        where b.poll_id = p_poll_id and b.championship_team_id = rs.team_id) as championship_votes,
      (select count(*)::integer from poll_private.ballots b
        where b.poll_id = p_poll_id and b.underrated_team_id = rs.team_id) as underrated_votes,
      (select count(*)::integer from poll_private.ballots b
        where b.poll_id = p_poll_id and b.overrated_team_id = rs.team_id) as overrated_votes
    from ranking_stats rs
  ),
  ranked as (
    select
      row_number() over (
        order by ap_points desc, placement_counts desc, team_id asc
      )::integer as official_rank,
      *
    from scored
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rank', official_rank,
        'team_id', team_id,
        'display_name', display_name_snapshot,
        'owner_label', owner_label_snapshot,
        'ap_points', ap_points,
        'average_rank', average_rank,
        'first_place_votes', first_place_votes,
        'championship_votes', championship_votes,
        'underrated_votes', underrated_votes,
        'overrated_votes', overrated_votes
      ) order by official_rank
    ),
    '[]'::jsonb
  )
  from ranked;
$function$;

create or replace function poll_private.ap_poll_get_state(p_league_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_poll poll_private.polls%rowtype;
  v_teams jsonb;
  v_voters jsonb;
  v_submission_count integer;
  v_voter_count integer;
  v_results jsonb;
begin
  select p.*
  into v_poll
  from poll_private.polls p
  where p.league_slug = p_league_slug
    and p.status in ('open', 'closed', 'published')
  order by
    case p.status when 'open' then 0 when 'closed' then 1 else 2 end,
    coalesce(p.published_at, p.closes_at, p.opens_at, p.created_at) desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'poll', null,
      'teams', '[]'::jsonb,
      'voters', '[]'::jsonb,
      'submission_count', 0,
      'eligible_voter_count', 0,
      'results', null
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', pt.team_id,
        'display_name', pt.display_name_snapshot,
        'owner_label', pt.owner_label_snapshot
      ) order by pt.display_name_snapshot, pt.team_id
    ),
    '[]'::jsonb
  )
  into v_teams
  from poll_private.poll_teams pt
  where pt.poll_id = v_poll.id;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', pv.voter_id,
          'display_name', pv.display_name_snapshot,
          'submitted', b.id is not null
        ) order by pv.display_name_snapshot, pv.voter_id
      ),
      '[]'::jsonb
    ),
    count(*)::integer,
    count(b.id)::integer
  into v_voters, v_voter_count, v_submission_count
  from poll_private.poll_voters pv
  left join poll_private.ballots b
    on b.poll_id = pv.poll_id and b.voter_id = pv.voter_id
  where pv.poll_id = v_poll.id;

  if v_poll.status = 'published' then
    v_results := poll_private.ap_poll_published_results(v_poll.id);
  else
    v_results := null;
  end if;

  return jsonb_build_object(
    'poll', jsonb_build_object(
      'id', v_poll.id,
      'season', v_poll.season,
      'label', v_poll.label,
      'week', v_poll.week,
      'status', v_poll.status,
      'is_demo', v_poll.is_demo,
      'opens_at', v_poll.opens_at,
      'closes_at', v_poll.closes_at,
      'published_at', v_poll.published_at
    ),
    'teams', v_teams,
    'voters', v_voters,
    'submission_count', v_submission_count,
    'eligible_voter_count', v_voter_count,
    'results', v_results
  );
end;
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
  select p.*
  into v_poll
  from poll_private.polls p
  where p.id = p_poll_id
  for share;

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

  select count(*)::integer
  into v_team_count
  from poll_private.poll_teams pt
  where pt.poll_id = p_poll_id;

  if v_team_count <> 14
    or coalesce(array_length(p_ranked_team_ids, 1), 0) <> 14
    or (select count(distinct team_id) from unnest(p_ranked_team_ids) as ranked(team_id)) <> 14
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

  if not exists (
      select 1 from poll_private.poll_teams
      where poll_id = p_poll_id and team_id = p_championship_team_id
    )
    or not exists (
      select 1 from poll_private.poll_teams
      where poll_id = p_poll_id and team_id = p_underrated_team_id
    )
    or not exists (
      select 1 from poll_private.poll_teams
      where poll_id = p_poll_id and team_id = p_overrated_team_id
    )
  then
    raise exception using errcode = 'P0001', message = 'All required team selections must be eligible for this poll.';
  end if;

  insert into poll_private.ballots (
    poll_id,
    voter_id,
    championship_team_id,
    underrated_team_id,
    overrated_team_id
  ) values (
    p_poll_id,
    p_voter_id,
    p_championship_team_id,
    p_underrated_team_id,
    p_overrated_team_id
  )
  returning id, submitted_at into v_ballot_id, v_submitted_at;

  insert into poll_private.ballot_rankings (ballot_id, poll_id, team_id, rank)
  select
    v_ballot_id,
    p_poll_id,
    ranked.team_id,
    ranked.ordinality::smallint
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

-- Public Data API wrappers. They are SECURITY INVOKER and delegate to private,
-- tightly validated helpers; raw tables are never granted to browser roles.
create or replace function public.ap_poll_get_state(p_league_slug text default 'sb3')
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select poll_private.ap_poll_get_state(p_league_slug);
$function$;

create or replace function public.ap_poll_submit_ballot(
  p_poll_id text,
  p_voter_id text,
  p_ranked_team_ids text[],
  p_championship_team_id text,
  p_underrated_team_id text,
  p_overrated_team_id text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $function$
  select poll_private.ap_poll_submit_ballot(
    p_poll_id,
    p_voter_id,
    p_ranked_team_ids,
    p_championship_team_id,
    p_underrated_team_id,
    p_overrated_team_id
  );
$function$;

revoke all on function poll_private.ap_poll_published_results(text) from public, anon, authenticated;
revoke all on function poll_private.ap_poll_get_state(text) from public, anon, authenticated;
revoke all on function poll_private.ap_poll_submit_ballot(text, text, text[], text, text, text) from public, anon, authenticated;
revoke all on function public.ap_poll_get_state(text) from public, anon, authenticated;
revoke all on function public.ap_poll_submit_ballot(text, text, text[], text, text, text) from public, anon, authenticated;

grant usage on schema poll_private to anon;
grant execute on function poll_private.ap_poll_get_state(text) to anon;
grant execute on function poll_private.ap_poll_submit_ballot(text, text, text[], text, text, text) to anon;
grant execute on function public.ap_poll_get_state(text) to anon;
grant execute on function public.ap_poll_submit_ballot(text, text, text[], text, text, text) to anon;

-- Current SB3 voter identities. Co-owned franchises use the site's existing
-- canonical primary Sleeper user ID and combined display label.
insert into poll_private.voters (id, league_slug, display_name, sleeper_user_id) values
  ('sb3_voter_608930747402739712', 'sb3', 'Will Dooling', '608930747402739712'),
  ('sb3_voter_734212975195480064', 'sb3', 'Andrew Johnstone', '734212975195480064'),
  ('sb3_voter_734217413658316800', 'sb3', 'Matt Manzo', '734217413658316800'),
  ('sb3_voter_340281844429778944', 'sb3', 'Kevin & Chris', '340281844429778944'),
  ('sb3_voter_857692118150393856', 'sb3', 'Patrick Gavin', '857692118150393856'),
  ('sb3_voter_461956667970416640', 'sb3', 'Matt Pitman', '461956667970416640'),
  ('sb3_voter_737771947097985024', 'sb3', 'Johnny Jones', '737771947097985024'),
  ('sb3_voter_734216844734550016', 'sb3', 'Malcolm Zeroka', '734216844734550016'),
  ('sb3_voter_735277065154207744', 'sb3', 'Adam Ellis', '735277065154207744'),
  ('sb3_voter_734209669215731712', 'sb3', 'Brian Harty', '734209669215731712'),
  ('sb3_voter_735641520723611648', 'sb3', 'Connor Cademartori', '735641520723611648'),
  ('sb3_voter_868214128286806016', 'sb3', 'Peter & Sean', '868214128286806016'),
  ('sb3_voter_463965031231385600', 'sb3', 'Sam Abate', '463965031231385600'),
  ('sb3_voter_1224359095889297408', 'sb3', 'Kevin Morency', '1224359095889297408');

-- Permanent franchise IDs are deliberately independent of mutable team names.
insert into poll_private.teams (
  id,
  league_slug,
  display_name,
  current_owner_voter_id,
  sleeper_roster_id,
  sleeper_roster_owner_user_id
) values
  ('sb3_franchise_01', 'sb3', 'The Beyond Beef', 'sb3_voter_608930747402739712', 1, '608930747402739712'),
  ('sb3_franchise_02', 'sb3', 'Zeno’s Roast Beef Llc.', 'sb3_voter_734212975195480064', 2, '734212975195480064'),
  ('sb3_franchise_03', 'sb3', 'The Impossible Beef', 'sb3_voter_734217413658316800', 3, '734217413658316800'),
  ('sb3_franchise_04', 'sb3', 'Gregs Taverns Beefs FC', 'sb3_voter_340281844429778944', 4, '340281844429778944'),
  ('sb3_franchise_05', 'sb3', 'A little mahomie', 'sb3_voter_857692118150393856', 5, '857692118150393856'),
  ('sb3_franchise_06', 'sb3', 'Large Beef 3-Maye', 'sb3_voter_461956667970416640', 6, '461956667970416640'),
  ('sb3_franchise_07', 'sb3', 'Johnny Jones', 'sb3_voter_737771947097985024', 7, '737771947097985024'),
  ('sb3_franchise_08', 'sb3', 'Malcolm Zeroka', 'sb3_voter_734216844734550016', 8, '734216844734550016'),
  ('sb3_franchise_09', 'sb3', 'Jayden’s Meat', 'sb3_voter_735277065154207744', 9, '735277065154207744'),
  ('sb3_franchise_10', 'sb3', 'Brockoli Bites', 'sb3_voter_734209669215731712', 10, '734209669215731712'),
  ('sb3_franchise_11', 'sb3', 'Connor Cademartori', 'sb3_voter_735641520723611648', 11, '735641520723611648'),
  ('sb3_franchise_12', 'sb3', 'BLL 2011 LLWS Champions', 'sb3_voter_868214128286806016', 12, '560589321712160768'),
  ('sb3_franchise_13', 'sb3', 'Mastro Titta', 'sb3_voter_463965031231385600', 13, '463965031231385600'),
  ('sb3_franchise_14', 'sb3', 'Extra Sauce, No Bread', 'sb3_voter_1224359095889297408', 14, '1224359095889297408');

insert into poll_private.polls (
  id,
  league_slug,
  sleeper_league_id,
  season,
  label,
  status,
  is_demo,
  opens_at,
  closes_at,
  published_at
) values (
  'sb3_2026_v1_demo',
  'sb3',
  '1180197099396288512',
  2026,
  'V1 Demo Poll',
  'published',
  true,
  '2026-08-01 12:00:00+00',
  '2026-08-08 12:00:00+00',
  '2026-08-09 12:00:00+00'
);

insert into poll_private.poll_voters (poll_id, voter_id, display_name_snapshot)
select 'sb3_2026_v1_demo', v.id, v.display_name
from poll_private.voters v
where v.league_slug = 'sb3' and v.active;

insert into poll_private.poll_teams (
  poll_id,
  team_id,
  display_name_snapshot,
  owner_label_snapshot
)
select
  'sb3_2026_v1_demo',
  t.id,
  t.display_name,
  v.display_name
from poll_private.teams t
join poll_private.voters v on v.id = t.current_owner_voter_id
where t.league_slug = 'sb3' and t.active;

-- Generate one stable synthetic ballot per voter. Ordering is randomized once
-- by a fixed hash and persisted, so demo results never change between requests.
with deterministic_orders as (
  select
    pv.voter_id,
    array_agg(
      pt.team_id
      order by md5(pv.voter_id || ':' || pt.team_id || ':sb3-v1-demo')
    ) as ranked_team_ids,
    row_number() over (order by pv.voter_id) as voter_number
  from poll_private.poll_voters pv
  cross join poll_private.poll_teams pt
  where pv.poll_id = 'sb3_2026_v1_demo'
    and pt.poll_id = 'sb3_2026_v1_demo'
  group by pv.voter_id
)
insert into poll_private.ballots (
  poll_id,
  voter_id,
  championship_team_id,
  underrated_team_id,
  overrated_team_id,
  submitted_at,
  updated_at
)
select
  'sb3_2026_v1_demo',
  voter_id,
  ranked_team_ids[1],
  ranked_team_ids[5],
  ranked_team_ids[10],
  '2026-08-07 18:00:00+00'::timestamptz + voter_number * interval '5 minutes',
  '2026-08-07 18:00:00+00'::timestamptz + voter_number * interval '5 minutes'
from deterministic_orders;

insert into poll_private.ballot_rankings (ballot_id, poll_id, team_id, rank)
select
  b.id,
  b.poll_id,
  ordered.team_id,
  ordered.rank::smallint
from poll_private.ballots b
cross join lateral (
  select
    pt.team_id,
    row_number() over (
      order by md5(b.voter_id || ':' || pt.team_id || ':sb3-v1-demo')
    ) as rank
  from poll_private.poll_teams pt
  where pt.poll_id = b.poll_id
) ordered
where b.poll_id = 'sb3_2026_v1_demo';
