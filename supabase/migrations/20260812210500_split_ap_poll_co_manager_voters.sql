-- Migration 20260812210500: one ballot per manager on co-managed franchises.
--
-- Kevin & Chris and Peter & Sean each shared a single voting identity. Both
-- managers now vote separately, while the franchise keeps its combined public
-- owner label. Closed and published polls keep the labels their ballots were
-- cast under; only draft and open polls pick up the split.

begin;

-- A franchise's public owner label is now independent of whichever voter is
-- recorded as its primary owner, so renaming that voter cannot rename the team.
alter table poll_private.teams
  add column if not exists owner_label text;

update poll_private.teams t
set owner_label = v.display_name
from poll_private.voters v
where v.id = t.current_owner_voter_id
  and t.owner_label is null;

alter table poll_private.teams
  alter column owner_label set not null;

alter table poll_private.teams
  add constraint teams_owner_label_not_blank
  check (length(trim(owner_label)) > 0);

-- The two shared voters become their franchise's primary manager. Reusing the
-- rows preserves the ballots they already cast in published polls.
update poll_private.voters
set display_name = 'Kevin Flaherty'
where id = 'sb3_voter_340281844429778944';

update poll_private.voters
set display_name = 'Peter Coluntino'
where id = 'sb3_voter_868214128286806016';

insert into poll_private.voters (id, league_slug, display_name, sleeper_user_id) values
  ('sb3_voter_868213541231026176', 'sb3', 'Chris Cole', '868213541231026176'),
  ('sb3_voter_560589321712160768', 'sb3', 'Sean Richardson', '560589321712160768')
on conflict (id) do nothing;

-- Refresh the voter roster of every poll that is still accepting ballots.
update poll_private.poll_voters pv
set display_name_snapshot = v.display_name
from poll_private.polls p,
     poll_private.voters v
where p.id = pv.poll_id
  and p.league_slug = 'sb3'
  and p.status in ('draft', 'open')
  and v.id = pv.voter_id;

insert into poll_private.poll_voters (poll_id, voter_id, display_name_snapshot)
select p.id, v.id, v.display_name
from poll_private.polls p
join poll_private.voters v
  on v.league_slug = p.league_slug
  and v.active
where p.league_slug = 'sb3'
  and p.status in ('draft', 'open')
on conflict (poll_id, voter_id) do nothing;

commit;
