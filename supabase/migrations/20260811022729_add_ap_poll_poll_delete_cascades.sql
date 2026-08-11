-- Poll snapshots already cascade from poll_private.polls, but ballots were
-- reachable only through restrictive snapshot foreign keys. A direct poll FK
-- makes the documented poll cleanup cascade through ballots and rankings.
alter table poll_private.ballots
  add constraint ballots_poll_id_fkey
  foreign key (poll_id)
  references poll_private.polls(id)
  on delete cascade;
