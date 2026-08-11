-- Repair two labels that were double-encoded when the Phase 1 seed was
-- deployed. Match both the stable franchise ID and the exact bad UTF-8 bytes
-- so this migration cannot overwrite a later intentional rename.
update poll_private.teams
set display_name = U&'Zeno\2019s Roast Beef Llc.'
where id = 'sb3_franchise_02'
  and display_name = convert_from(
    decode('5a656e6fc3a2e282ace284a27320526f6173742042656566204c6c632e', 'hex'),
    'UTF8'
  );

update poll_private.teams
set display_name = U&'Jayden\2019s Meat'
where id = 'sb3_franchise_09'
  and display_name = convert_from(
    decode('4a617964656ec3a2e282ace284a273204d656174', 'hex'),
    'UTF8'
  );

update poll_private.poll_teams
set display_name_snapshot = U&'Zeno\2019s Roast Beef Llc.'
where team_id = 'sb3_franchise_02'
  and display_name_snapshot = convert_from(
    decode('5a656e6fc3a2e282ace284a27320526f6173742042656566204c6c632e', 'hex'),
    'UTF8'
  );

update poll_private.poll_teams
set display_name_snapshot = U&'Jayden\2019s Meat'
where team_id = 'sb3_franchise_09'
  and display_name_snapshot = convert_from(
    decode('4a617964656ec3a2e282ace284a273204d656174', 'hex'),
    'UTF8'
  );
