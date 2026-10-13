-- Stakeout · SQL integration tests (RLS, deduplication, invites, planning, storage).
-- Everything runs inside one transaction that is rolled back at the end.
begin;

create schema test;
create table test.kv (k text primary key, v uuid);
grant usage on schema test to authenticated, anon;
grant select, insert, update on test.kv to authenticated;

create function test.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $$;

create function test.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
end $$;

create function test.as_super() returns void language plpgsql as $$
begin execute 'reset role'; end $$;

create function test.expect_error(q text, state text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlstate = state then return; end if;
    raise exception 'expected SQLSTATE % but got % (%) for: %', state, sqlstate, sqlerrm, q;
  end;
  raise exception 'expected SQLSTATE % but statement succeeded: %', state, q;
end $$;

create function test.assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok   %', msg;
end $$;

grant execute on all functions in schema test to authenticated, anon;

-- Fixed identities ----------------------------------------------------------
-- alice owns group 1, bob joins it, carol owns group 2, dave belongs nowhere.
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com', '{"username":"Alice","display_name":"Alice A"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com',   '{"username":"bob","display_name":"Bob"}'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com', '{}'),
  ('dddddddd-0000-0000-0000-000000000004', 'dave@example.com',  '{"username":"alice"}');

do $$
declare n int; u text;
begin
  select count(*) into n from public.profiles;
  perform test.assert(n = 4, 'a profile row is created for every auth user');
  select username into u from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  perform test.assert(u = 'alice', 'username is lower-cased');
  select username into u from public.profiles where id = 'cccccccc-0000-0000-0000-000000000003';
  perform test.assert(u = 'carol', 'username falls back to the email local part');
  select username into u from public.profiles where id = 'dddddddd-0000-0000-0000-000000000004';
  perform test.assert(u <> 'alice' and u like 'alice%', 'colliding usernames are made unique');
end $$;

-- normalisation ------------------------------------------------------------
do $$
begin
  perform test.assert(public.normalize_name('The Batman') = 'batman', 'normalize: leading article removed');
  perform test.assert(public.normalize_name('  BATMAN!! ') = 'batman', 'normalize: case + punctuation');
  perform test.assert(public.normalize_name('Café Müller & Sons') = 'cafe muller and sons', 'normalize: accents and ampersand');
  perform test.assert(public.normalize_name('Kadıköy') = public.normalize_name('kadikoy'), 'normalize: Turkish dotless i');
  perform test.assert(public.normalize_name('Şişli') = 'sisli', 'normalize: Turkish ş');
  perform test.assert(public.normalize_name('千と千尋の神隠し') <> '', 'normalize: non-latin names survive');
end $$;

-- groups & invites ---------------------------------------------------------
do $$
declare g1 uuid; g2 uuid; v_code text; n int; v_uses int; res uuid;
begin
  perform test.as_user('aaaaaaaa-0000-0000-0000-000000000001');
  g1 := public.create_group('Gotham Nights', 'us lot');
  insert into test.kv values ('g1', g1);
  select count(*) into n from public.group_members where group_id = g1 and role = 'owner';
  perform test.assert(n = 1, 'create_group makes the creator an owner');
  select i.code into v_code from public.group_invites i where i.group_id = g1;
  perform test.assert(v_code is not null and char_length(v_code) = 12, 'create_group issues a first invite code');

  perform test.as_user('cccccccc-0000-0000-0000-000000000003');
  g2 := public.create_group('Other crew');
  insert into test.kv values ('g2', g2);
  select count(*) into n from public.groups;
  perform test.assert(n = 1, 'carol sees only her own group');
  perform test.expect_error(format($f$insert into public.group_members (group_id, user_id) values (%L, %L)$f$, g1, 'cccccccc-0000-0000-0000-000000000003'), '42501');
  perform test.expect_error($f$select public.join_group('nonsense')$f$, 'P0001');
  perform test.expect_error(format($f$insert into public.groups (name, created_by) values ('x', %L)$f$, 'cccccccc-0000-0000-0000-000000000003'), '42501');

  perform test.as_user('dddddddd-0000-0000-0000-000000000004');
  select count(*) into n from public.groups;
  perform test.assert(n = 0, 'a non-member sees no groups');
  perform test.assert((select is_valid from public.preview_invite(v_code)), 'invite preview works before joining');

  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  res := public.join_group(v_code);
  perform test.assert(res = g1, 'bob joins with a valid invite');
  res := public.join_group(v_code);
  perform test.as_super();
  select i.uses into v_uses from public.group_invites i where i.code = v_code;
  perform test.assert(v_uses = 1, 'joining twice does not burn another invite use');

  -- invite controls are owner-only
  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  select count(*) into n from public.group_invites;
  perform test.assert(n = 0, 'members cannot read invite codes');
  perform test.expect_error(format($f$insert into public.group_invites (group_id, created_by) values (%L, %L)$f$, g1, 'bbbbbbbb-0000-0000-0000-000000000002'), '42501');

  -- expiry / revocation / max uses
  perform test.as_super();
  update public.group_invites set expires_at = now() - interval '1 minute' where code = v_code;
  perform test.as_user('dddddddd-0000-0000-0000-000000000004');
  perform test.expect_error(format($f$select public.join_group(%L)$f$, v_code), 'P0001');
  perform test.as_super();
  update public.group_invites set expires_at = now() + interval '1 day', revoked_at = now() where code = v_code;
  perform test.as_user('dddddddd-0000-0000-0000-000000000004');
  perform test.expect_error(format($f$select public.join_group(%L)$f$, v_code), 'P0001');
  perform test.as_super();
  update public.group_invites set revoked_at = null, max_uses = 1, uses = 1 where code = v_code;
  perform test.as_user('dddddddd-0000-0000-0000-000000000004');
  perform test.expect_error(format($f$select public.join_group(%L)$f$, v_code), 'P0001');
  perform test.as_super();
  perform test.assert(true, 'expired, revoked and used-up invites are rejected');

  -- profile visibility
  perform test.as_user('cccccccc-0000-0000-0000-000000000003');
  select count(*) into n from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  perform test.assert(n = 0, 'profiles of people outside your groups are hidden');
  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  select count(*) into n from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  perform test.assert(n = 1, 'profiles of groupmates are visible');
  perform test.as_super();
end $$;

-- catalog deduplication -----------------------------------------------------
do $$
declare
  g1 uuid := (select v from test.kv where k = 'g1');
  g2 uuid := (select v from test.kv where k = 'g2');
  movie uuid := (select id from public.categories where slug = 'movie');
  cafe  uuid := (select id from public.categories where slug = 'cafe');
  a jsonb; b jsonb; n int;
begin
  perform test.as_user('aaaaaaaa-0000-0000-0000-000000000001');
  a := public.resolve_catalog_item(g1, jsonb_build_object('category_id', movie, 'name', 'The Batman', 'year', 2022));
  perform test.assert((a ->> 'created')::boolean, 'first add creates a catalog item');
  insert into test.kv values ('batman', (a ->> 'id')::uuid);

  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  b := public.resolve_catalog_item(g1, jsonb_build_object('category_id', movie, 'name', 'batman!', 'year', 2022));
  perform test.assert(not (b ->> 'created')::boolean and b ->> 'id' = a ->> 'id', 'same title in different case/punctuation is linked, not duplicated');
  b := public.resolve_catalog_item(g1, jsonb_build_object('category_id', movie, 'name', 'Batman', 'year', 1989));
  perform test.assert((b ->> 'created')::boolean, 'same title with a different year is a different item');

  b := public.resolve_catalog_item(g1, jsonb_build_object('category_id', movie, 'name', 'Matrix, The', 'year', 1999, 'external_ref', 'IMDB:tt0133093'));
  a := public.resolve_catalog_item(g1, jsonb_build_object('category_id', movie, 'name', 'The Matrix (remastered)', 'year', 1999, 'external_ref', ' imdb:tt0133093 '));
  perform test.assert(not (a ->> 'created')::boolean and a ->> 'id' = b ->> 'id', 'an external identifier links entries even when names differ');

  a := public.resolve_catalog_item(g1, jsonb_build_object('category_id', cafe, 'name', 'Moda Kahve', 'location', 'Kadıköy'));
  b := public.resolve_catalog_item(g1, jsonb_build_object('category_id', cafe, 'name', 'MODA KAHVE', 'location', 'kadikoy'));
  perform test.assert(not (b ->> 'created')::boolean and a ->> 'id' = b ->> 'id', 'place dedupe ignores case and accents in name and location');
  b := public.resolve_catalog_item(g1, jsonb_build_object('category_id', cafe, 'name', 'Moda Kahve', 'location', 'Beşiktaş'));
  perform test.assert((b ->> 'created')::boolean, 'same name in another location is a separate place');

  -- fuzzy suggestions
  select count(*) into n from public.find_similar_items(g1, 'batmen');
  perform test.assert(n >= 1, 'find_similar_items offers near matches ("batmen" → Batman)');
  select count(*) into n from public.find_similar_items(g1, 'zzzzqx');
  perform test.assert(n = 0, 'find_similar_items returns nothing for unrelated text');

  -- isolation
  perform test.as_user('cccccccc-0000-0000-0000-000000000003');
  perform test.expect_error(format($f$select public.resolve_catalog_item(%L, '{"name":"Spy","category_id":"%s"}')$f$, g1, movie), '42501');
  select count(*) into n from public.catalog_items;
  perform test.assert(n = 0, 'carol cannot see items from a group she is not in');
  select count(*) into n from public.catalog_overview;
  perform test.assert(n = 0, 'catalog_overview also respects group membership');
  a := public.resolve_catalog_item(g2, jsonb_build_object('category_id', movie, 'name', 'The Batman', 'year', 2022));
  perform test.assert((a ->> 'created')::boolean, 'the same title can exist independently in another group');

  -- a custom category belongs to one group
  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  insert into public.categories (group_id, slug, name, kind, icon, created_by)
  values (g1, 'board-games', 'Board games', 'activity', 'spark', 'bbbbbbbb-0000-0000-0000-000000000002');
  perform test.as_user('cccccccc-0000-0000-0000-000000000003');
  perform test.expect_error(format($f$insert into public.catalog_items (group_id, category_id, name, created_by) values (%L, (select id from public.categories where slug='board-games'), 'Catan', %L)$f$, g2, 'cccccccc-0000-0000-0000-000000000003'), '23503');
  perform test.assert(true, 'carol cannot see or use another group''s custom category');
  perform test.as_super();
end $$;

-- reviews -------------------------------------------------------------------
do $$
declare
  g1 uuid := (select v from test.kv where k = 'g1');
  batman uuid := (select v from test.kv where k = 'batman');
  movie uuid := (select id from public.categories where slug = 'movie');
  r jsonb; n int; avg_r numeric; rid uuid; cnt int; items_before int; items_after int;
begin
  perform test.as_user('aaaaaaaa-0000-0000-0000-000000000001');
  r := public.create_review(g1, batman, null, 4.5, 'Rain, jazz, dread.', array['Noir ', 'noir', 'rain'], date '2026-03-01');
  perform test.assert((r ->> 'review_id') is not null, 'alice reviews an existing item');
  insert into test.kv values ('alice_review', (r ->> 'review_id')::uuid);

  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  r := public.create_review(g1, batman, null, 3.0, 'Too long.', array['long'], date '2026-03-05');
  insert into test.kv values ('bob_review', (r ->> 'review_id')::uuid);
  select avg_rating into avg_r from public.catalog_overview where id = batman;
  perform test.assert(avg_r = 3.75, 'group rating averages individual ratings (4.5 and 3.0 → 3.75)');

  -- tags normalised
  perform test.as_super();
  perform test.assert((select tags from public.reviews where id = (select v from test.kv where k = 'alice_review')) @> array['noir', 'rain']
                      and cardinality((select tags from public.reviews where id = (select v from test.kv where k = 'alice_review'))) = 2,
                      'tags are trimmed, lower-cased and de-duplicated');

  -- creating a review for a brand-new thing creates the catalog item in the same call
  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  select count(*) into items_before from public.catalog_items;
  r := public.create_review(g1, null, jsonb_build_object('category_id', movie, 'name', 'Heat', 'year', 1995), 5, 'Perfect.', '{}', null);
  select count(*) into items_after from public.catalog_items;
  perform test.assert((r ->> 'item_created')::boolean and items_after = items_before + 1, 'create_review creates a missing catalog item atomically');
  perform test.as_user('aaaaaaaa-0000-0000-0000-000000000001');
  perform test.assert((select count(*) from public.catalog_overview where name = 'Heat') = 1, 'the new item is instantly visible to the rest of the group');
  r := public.create_review(g1, null, jsonb_build_object('category_id', movie, 'name', 'heat', 'year', 1995), 4, null, '{}', null);
  perform test.assert(not (r ->> 'item_created')::boolean, 'a second reviewer is linked to the same item, not a duplicate');
  perform test.assert((select count(*) from public.catalog_items where normalized_name = 'heat') = 1, 'still exactly one "Heat"');
  perform test.assert((select reviewer_count from public.catalog_overview where name = 'Heat') = 2, 'both independent reviews count');

  -- a failing review rolls back the item it would have created
  select count(*) into items_before from public.catalog_items;
  perform test.expect_error(format($f$select public.create_review(%L, null, %L::jsonb, 9, null, '{}', null)$f$, g1, jsonb_build_object('category_id', movie, 'name', 'Never Saved')), '23514');
  select count(*) into items_after from public.catalog_items;
  perform test.assert(items_before = items_after, 'an invalid review does not leave an orphan catalog item behind');

  -- one review per author per item per day
  perform test.expect_error(format($f$select public.create_review(%L, %L, null, 2, null, '{}', date '2026-03-01')$f$, g1, batman), '23505');

  -- revisit: another day is allowed and the group view uses each person's latest visit
  r := public.create_review(g1, batman, null, 2.0, 'Second look: less magic.', '{}', date '2026-06-01');
  select avg_rating, review_count into avg_r, cnt from public.catalog_overview where id = batman;
  perform test.assert(avg_r = 2.5 and cnt = 3, 'revisits are kept; group rating uses each member''s latest review (2.0 and 3.0 → 2.5)');

  -- nobody can touch someone else's opinion
  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  rid := (select v from test.kv where k = 'alice_review');
  update public.reviews set rating = 1 where id = rid;
  get diagnostics n = row_count;
  perform test.assert(n = 0, 'bob cannot edit alice''s review');
  delete from public.reviews where id = rid;
  get diagnostics n = row_count;
  perform test.assert(n = 0, 'bob cannot delete alice''s review');
  perform test.expect_error(format($f$insert into public.reviews (group_id, item_id, author_id, rating) values (%L, %L, %L, 1)$f$, g1, batman, 'aaaaaaaa-0000-0000-0000-000000000001'), '42501');
  perform test.expect_error(format($f$update public.reviews set item_id = (select id from public.catalog_items where name='Heat' limit 1) where id = %L$f$, (select v from test.kv where k = 'bob_review')), '42501');
  update public.reviews set rating = 3.5 where id = (select v from test.kv where k = 'bob_review');
  get diagnostics n = row_count;
  perform test.assert(n = 1, 'bob can edit his own review');
  perform test.expect_error(format($f$update public.reviews set rating = 3.3 where id = %L$f$, (select v from test.kv where k = 'bob_review')), '23514');

  -- composite FK stops cross-group references even without RLS
  perform test.as_super();
  perform test.expect_error(format($f$insert into public.reviews (group_id, item_id, author_id, rating) values (%L, (select id from public.catalog_items where group_id = %L limit 1), %L, 3)$f$,
    g1, (select v from test.kv where k = 'g2'), 'aaaaaaaa-0000-0000-0000-000000000001'), '23503');
  perform test.assert(true, 'a review cannot reference an item from another group (composite FK)');
end $$;

-- favourites, comments, activity, lists -------------------------------------
do $$
declare
  g1 uuid := (select v from test.kv where k = 'g1');
  batman uuid := (select v from test.kv where k = 'batman');
  alice_review uuid := (select v from test.kv where k = 'alice_review');
  n int;
begin
  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  insert into public.favorites (user_id, item_id, group_id) values ('bbbbbbbb-0000-0000-0000-000000000002', batman, g1);
  perform test.expect_error(format($f$insert into public.favorites (user_id, item_id, group_id) values (%L, %L, %L)$f$, 'aaaaaaaa-0000-0000-0000-000000000001', batman, g1), '42501');
  perform test.assert((select favorite_count from public.catalog_overview where id = batman) = 1, 'favourites show up in the overview');

  insert into public.comments (group_id, author_id, body, review_id) values (g1, 'bbbbbbbb-0000-0000-0000-000000000002', 'Disagree!', alice_review);
  perform test.expect_error(format($f$insert into public.comments (group_id, author_id, body, review_id, item_id) values (%L, %L, 'x', %L, %L)$f$, g1, 'bbbbbbbb-0000-0000-0000-000000000002', alice_review, batman), '23514');
  perform test.as_user('cccccccc-0000-0000-0000-000000000003');
  perform test.expect_error(format($f$insert into public.comments (group_id, author_id, body, review_id) values (%L, %L, 'hi', %L)$f$, g1, 'cccccccc-0000-0000-0000-000000000003', alice_review), '42501');
  select count(*) into n from public.comments;
  perform test.assert(n = 0, 'outsiders can neither read nor write comments');

  -- activity feed is trigger-only
  perform test.as_user('aaaaaaaa-0000-0000-0000-000000000001');
  select count(*) into n from public.activity where verb = 'reviewed';
  perform test.assert(n >= 3, 'reviews appear in the group activity feed automatically');
  perform test.expect_error(format($f$insert into public.activity (group_id, actor_id, verb) values (%L, %L, 'reviewed')$f$, g1, 'aaaaaaaa-0000-0000-0000-000000000001'), '42501');

  -- lists
  insert into public.lists (id, group_id, owner_id, title) values ('11111111-1111-1111-1111-111111111111', g1, 'aaaaaaaa-0000-0000-0000-000000000001', 'Rainy day');
  insert into public.list_items (list_id, item_id, group_id, added_by) values ('11111111-1111-1111-1111-111111111111', batman, g1, 'aaaaaaaa-0000-0000-0000-000000000001');
  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  perform test.expect_error(format($f$insert into public.list_items (list_id, item_id, group_id, added_by) values ('11111111-1111-1111-1111-111111111111', (select id from public.catalog_items where name='Heat'), %L, %L)$f$, g1, 'bbbbbbbb-0000-0000-0000-000000000002'), '42501');
  perform test.as_user('aaaaaaaa-0000-0000-0000-000000000001');
  update public.lists set is_collaborative = true where id = '11111111-1111-1111-1111-111111111111';
  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  insert into public.list_items (list_id, item_id, group_id, added_by) values ('11111111-1111-1111-1111-111111111111', (select id from public.catalog_items where name='Heat'), g1, 'bbbbbbbb-0000-0000-0000-000000000002');
  perform test.assert(true, 'only collaborative lists accept items from non-owners');
  perform test.as_super();
end $$;

-- planning ------------------------------------------------------------------
do $$
declare
  g1 uuid := (select v from test.kv where k = 'g1');
  cafe uuid := (select id from public.categories where slug = 'cafe');
  r jsonb; pid uuid; oid uuid; n int; st text; done_at timestamptz;
begin
  perform test.as_user('aaaaaaaa-0000-0000-0000-000000000001');
  r := public.create_plan(g1, null, jsonb_build_object('category_id', cafe, 'name', 'Karaköy Roasters', 'location', 'Karaköy'), 'wishlist', 'Try the flat white');
  pid := (r ->> 'plan_id')::uuid;
  perform test.assert((r ->> 'item_created')::boolean, 'planning a new place adds it to the shared catalog');
  perform test.assert((select open_plan_count from public.catalog_overview where id = (r ->> 'item_id')::uuid) = 1, 'the catalog shows the open plan');

  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  insert into public.plan_responses (plan_id, group_id, user_id, response) values (pid, g1, 'bbbbbbbb-0000-0000-0000-000000000002', 'maybe');
  update public.plan_responses set response = 'in' where plan_id = pid and user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  perform test.expect_error(format($f$insert into public.plan_responses (plan_id, group_id, user_id, response) values (%L, %L, %L, 'in')$f$, pid, g1, 'aaaaaaaa-0000-0000-0000-000000000001'), '42501');

  insert into public.plan_date_options (plan_id, group_id, starts_at, suggested_by)
  values (pid, g1, now() + interval '3 days', 'bbbbbbbb-0000-0000-0000-000000000002') returning id into oid;
  insert into public.plan_date_votes (option_id, group_id, user_id) values (oid, g1, 'bbbbbbbb-0000-0000-0000-000000000002');

  perform test.as_user('cccccccc-0000-0000-0000-000000000003');
  select count(*) into n from public.plans;
  perform test.assert(n = 0, 'carol cannot see group 1''s plans');
  perform test.expect_error(format($f$insert into public.plan_date_votes (option_id, group_id, user_id) values (%L, %L, %L)$f$, oid, g1, 'cccccccc-0000-0000-0000-000000000003'), '42501');

  -- any member can confirm and complete; ownership columns are frozen
  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  update public.plans set status = 'confirmed', proposed_for = now() + interval '3 days' where id = pid;
  perform test.expect_error(format($f$update public.plans set created_by = %L where id = %L$f$, 'bbbbbbbb-0000-0000-0000-000000000002', pid), '42501');
  update public.plans set status = 'completed' where id = pid;
  select status, completed_at into st, done_at from public.plans where id = pid;
  perform test.assert(st = 'completed' and done_at is not null, 'completing a plan stamps completed_at');
  perform test.assert((select count(*) from public.activity where plan_id = pid and verb = 'completed') = 1, 'completion is posted to the feed');
  perform test.assert((select open_plan_count from public.catalog_overview where id = (r ->> 'item_id')::uuid) = 0, 'a completed plan no longer counts as open');

  -- only creator or owner deletes
  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  delete from public.plans where id = pid;
  get diagnostics n = row_count;
  perform test.assert(n = 0, 'a non-creator member cannot delete a plan');
  perform test.as_super();
end $$;

-- storage -------------------------------------------------------------------
do $$
declare
  g1 uuid := (select v from test.kv where k = 'g1');
  n int;
begin
  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  insert into storage.objects (bucket_id, name) values ('review-photos', g1 || '/bbbbbbbb-0000-0000-0000-000000000002/a.jpg');
  perform test.expect_error(format($f$insert into storage.objects (bucket_id, name) values ('review-photos', %L)$f$, g1 || '/aaaaaaaa-0000-0000-0000-000000000001/b.jpg'), '42501');
  perform test.as_user('cccccccc-0000-0000-0000-000000000003');
  perform test.expect_error(format($f$insert into storage.objects (bucket_id, name) values ('review-photos', %L)$f$, g1 || '/cccccccc-0000-0000-0000-000000000003/c.jpg'), '42501');
  perform test.expect_error($f$insert into storage.objects (bucket_id, name) values ('review-photos', 'not-a-uuid/cccccccc-0000-0000-0000-000000000003/c.jpg')$f$, '42501');
  select count(*) into n from storage.objects;
  perform test.assert(n = 0, 'non-members cannot list or read group photos');
  perform test.as_user('aaaaaaaa-0000-0000-0000-000000000001');
  select count(*) into n from storage.objects;
  perform test.assert(n = 1, 'group members can read group photos');
  delete from storage.objects;
  get diagnostics n = row_count;
  perform test.assert(n = 0, 'members cannot delete a photo someone else uploaded');
  perform test.as_super();
end $$;

-- anonymous access ----------------------------------------------------------
do $$
begin
  perform test.as_anon();
  perform test.expect_error('select * from public.reviews', '42501');
  perform test.expect_error('select * from public.catalog_overview', '42501');
  perform test.expect_error($f$select public.create_group('x')$f$, '42501');
  perform test.assert(true, 'the anon role has no access to tables, views or RPCs');
  perform test.as_super();
end $$;

-- membership lifecycle ------------------------------------------------------
do $$
declare
  g1 uuid := (select v from test.kv where k = 'g1');
  n int;
begin
  perform test.as_user('aaaaaaaa-0000-0000-0000-000000000001');
  perform test.expect_error(format($f$delete from public.group_members where group_id = %L and user_id = %L$f$, g1, 'aaaaaaaa-0000-0000-0000-000000000001'), '23514');
  perform test.expect_error(format($f$update public.group_members set role = 'member' where group_id = %L and user_id = %L$f$, g1, 'aaaaaaaa-0000-0000-0000-000000000001'), '23514');

  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  update public.group_members set role = 'owner' where group_id = g1 and user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  perform test.assert(n = 0, 'members cannot promote themselves');

  perform test.as_user('aaaaaaaa-0000-0000-0000-000000000001');
  update public.group_members set role = 'owner' where group_id = g1 and user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  delete from public.group_members where group_id = g1 and user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  perform test.assert(true, 'an owner can leave once another owner exists');

  perform test.as_user('bbbbbbbb-0000-0000-0000-000000000002');
  delete from public.groups where id = g1;
  get diagnostics n = row_count;
  perform test.assert(n = 1, 'an owner can delete the group');
  perform test.as_super();
  perform test.assert((select count(*) from public.reviews where group_id = g1) = 0
                      and (select count(*) from public.catalog_items where group_id = g1) = 0, 'deleting a group cascades to all of its data');
end $$;

rollback;
\echo 'ALL SQL TESTS PASSED'
