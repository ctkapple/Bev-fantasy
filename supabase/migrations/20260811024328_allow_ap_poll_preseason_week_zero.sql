-- Week zero represents the preseason poll; positive values remain regular-season weeks.
alter table poll_private.polls
  drop constraint polls_week_check,
  add constraint polls_week_check check (week is null or week >= 0);
