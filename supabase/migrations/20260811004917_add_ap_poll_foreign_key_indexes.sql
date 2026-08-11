-- Add the composite indexes PostgreSQL needs to enforce the Phase 1 foreign
-- keys efficiently as ballots and rankings accumulate.

create index ballot_rankings_ballot_poll_idx
  on poll_private.ballot_rankings (ballot_id, poll_id);

create index ballots_poll_championship_team_idx
  on poll_private.ballots (poll_id, championship_team_id);

create index ballots_poll_underrated_team_idx
  on poll_private.ballots (poll_id, underrated_team_id);

create index ballots_poll_overrated_team_idx
  on poll_private.ballots (poll_id, overrated_team_id);
