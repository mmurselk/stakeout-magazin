-- Stakeout · migration 3 · RPCs and views

-- ---------------------------------------------------------------------------
-- Groups & invites
-- ---------------------------------------------------------------------------

create or replace function public.create_group(p_name text, p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  gid uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.groups (name, description, created_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), uid)
  returning id into gid;
  insert into public.group_members (group_id, user_id, role) values (gid, uid, 'owner');
  insert into public.group_invites (group_id, created_by) values (gid, uid);
  return gid;
end
$$;

-- Lets someone holding a code see which group it is for before joining.
create or replace function public.preview_invite(p_code text)
returns table (group_id uuid, group_name text, member_count int, is_valid boolean)
language sql
stable
security definer
set search_path = public
as $$
  select g.id,
         g.name,
         (select count(*)::int from public.group_members m where m.group_id = g.id),
         (i.revoked_at is null and i.expires_at > now() and (i.max_uses is null or i.uses < i.max_uses))
  from public.group_invites i
  join public.groups g on g.id = i.group_id
  where i.code = lower(btrim(p_code)) and auth.uid() is not null
$$;

create or replace function public.join_group(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  inv public.group_invites%rowtype;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into inv from public.group_invites where code = lower(btrim(p_code)) for update;

  if not found
     or inv.revoked_at is not null
     or inv.expires_at <= now()
     or (inv.max_uses is not null and inv.uses >= inv.max_uses) then
    raise exception 'this invite is invalid, expired or used up' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.group_members where group_id = inv.group_id and user_id = uid) then
    return inv.group_id;
  end if;

  insert into public.group_members (group_id, user_id, role) values (inv.group_id, uid, 'member');
  update public.group_invites set uses = uses + 1 where id = inv.id;
  return inv.group_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Catalog: fuzzy suggestions + single write path with deduplication
-- ---------------------------------------------------------------------------

-- "Did you mean…" candidates for the picker. SECURITY INVOKER → RLS limits it to your groups.
create or replace function public.find_similar_items(
  p_group_id uuid,
  p_name text,
  p_category_id uuid default null,
  p_limit int default 6
)
returns table (
  id uuid, name text, year int, location text, subtitle text,
  category_id uuid, category_name text, similarity real
)
language sql
stable
set search_path = public, extensions
as $$
  with q as (
    select coalesce(nullif(public.normalize_name(p_name), ''), lower(btrim(p_name))) as n
  )
  select i.id, i.name, i.year, i.location, i.subtitle, i.category_id, c.name,
         similarity(i.normalized_name, q.n) as sim
  from public.catalog_items i
  join public.categories c on c.id = i.category_id
  cross join q
  where i.group_id = p_group_id
    and q.n <> ''
    and (p_category_id is null or i.category_id = p_category_id)
    and (similarity(i.normalized_name, q.n) >= 0.3
         or i.normalized_name like '%' || q.n || '%'
         or (char_length(q.n) >= 3 and q.n like '%' || i.normalized_name || '%'))
  order by sim desc, i.name
  limit greatest(1, least(p_limit, 20))
$$;

-- Link to an existing item or create one. Returns {id, created}.
-- p_item keys: category_id, name, year, location, subtitle, address, external_ref, url, description
create or replace function public.resolve_catalog_item(p_group_id uuid, p_item jsonb)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  uid      uuid := auth.uid();
  cat      uuid := nullif(p_item ->> 'category_id', '')::uuid;
  nm       text := btrim(coalesce(p_item ->> 'name', ''));
  yr       int  := nullif(p_item ->> 'year', '')::int;
  loc      text := nullif(btrim(coalesce(p_item ->> 'location', '')), '');
  ext      text := nullif(lower(btrim(coalesce(p_item ->> 'external_ref', ''))), '');
  nn       text;
  nl       text;
  found_id uuid;
  new_id   uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_group_member(p_group_id) then
    raise exception 'you are not a member of this group' using errcode = '42501';
  end if;
  if nm = '' then
    raise exception 'a name is required' using errcode = '22023';
  end if;
  if cat is null then
    raise exception 'a category is required' using errcode = '22023';
  end if;

  nn := coalesce(nullif(public.normalize_name(nm), ''), lower(nm));
  nl := coalesce(public.normalize_name(loc), '');

  -- 1. strong identifier
  if ext is not null then
    select id into found_id from public.catalog_items
    where group_id = p_group_id and external_ref = ext;
  end if;

  -- 2. identity: category + normalised name + year + normalised location
  if found_id is null then
    select id into found_id from public.catalog_items
    where group_id = p_group_id and category_id = cat and normalized_name = nn
      and coalesce(year, 0) = coalesce(yr, 0) and normalized_location = nl;
  end if;

  if found_id is not null then
    return jsonb_build_object('id', found_id, 'created', false);
  end if;

  insert into public.catalog_items
    (group_id, category_id, name, subtitle, year, location, address, external_ref, url, description, created_by)
  values
    (p_group_id, cat, nm, p_item ->> 'subtitle', yr, loc, p_item ->> 'address', ext,
     p_item ->> 'url', p_item ->> 'description', uid)
  on conflict do nothing
  returning id into new_id;

  if new_id is null then
    -- lost a race with someone adding the same thing at the same moment
    select id into found_id from public.catalog_items
    where group_id = p_group_id
      and (external_ref = ext
           or (category_id = cat and normalized_name = nn
               and coalesce(year, 0) = coalesce(yr, 0) and normalized_location = nl))
    limit 1;
    return jsonb_build_object('id', found_id, 'created', false);
  end if;

  return jsonb_build_object('id', new_id, 'created', true);
end
$$;

-- ---------------------------------------------------------------------------
-- Atomic "review something": resolves/creates the catalog item AND inserts the review
-- in one transaction. A review can never exist without a catalog item.
-- ---------------------------------------------------------------------------

create or replace function public.create_review(
  p_group_id    uuid,
  p_item_id     uuid,
  p_new_item    jsonb,
  p_rating      numeric,
  p_body        text default null,
  p_tags        text[] default '{}',
  p_visited_on  date default current_date,
  p_photo_paths text[] default '{}'
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  uid        uuid := auth.uid();
  item       uuid := p_item_id;
  was_new    boolean := false;
  resolved   jsonb;
  rid        uuid;
  path       text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if item is null then
    if p_new_item is null then
      raise exception 'choose a catalog item or describe a new one' using errcode = '22023';
    end if;
    resolved := public.resolve_catalog_item(p_group_id, p_new_item);
    item     := (resolved ->> 'id')::uuid;
    was_new  := (resolved ->> 'created')::boolean;
  end if;

  insert into public.reviews (group_id, item_id, author_id, rating, body, tags, visited_on)
  values (p_group_id, item, uid, p_rating, p_body, coalesce(p_tags, '{}'), coalesce(p_visited_on, current_date))
  returning id into rid;

  foreach path in array coalesce(p_photo_paths, '{}') loop
    insert into public.review_photos (group_id, review_id, storage_path) values (p_group_id, rid, path);
  end loop;

  return jsonb_build_object('review_id', rid, 'item_id', item, 'item_created', was_new);
end
$$;

create or replace function public.create_plan(
  p_group_id     uuid,
  p_item_id      uuid,
  p_new_item     jsonb,
  p_status       text default 'wishlist',
  p_notes        text default null,
  p_proposed_for timestamptz default null
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  uid      uuid := auth.uid();
  item     uuid := p_item_id;
  was_new  boolean := false;
  resolved jsonb;
  pid      uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if item is null then
    if p_new_item is null then
      raise exception 'choose a catalog item or describe a new one' using errcode = '22023';
    end if;
    resolved := public.resolve_catalog_item(p_group_id, p_new_item);
    item     := (resolved ->> 'id')::uuid;
    was_new  := (resolved ->> 'created')::boolean;
  end if;

  insert into public.plans (group_id, item_id, status, notes, proposed_for, created_by)
  values (p_group_id, item, coalesce(p_status, 'wishlist'), p_notes, p_proposed_for, uid)
  returning id into pid;

  insert into public.plan_responses (plan_id, group_id, user_id, response)
  values (pid, p_group_id, uid, 'in');

  return jsonb_build_object('plan_id', pid, 'item_id', item, 'item_created', was_new);
end
$$;

-- ---------------------------------------------------------------------------
-- Group view of the catalog.
-- Group rating = mean of each member's most recent review (one voice per member).
-- security_invoker → the caller's RLS applies to every underlying table.
-- ---------------------------------------------------------------------------

create or replace view public.catalog_overview with (security_invoker = true) as
with latest as (
  select distinct on (r.item_id, r.author_id)
         r.item_id, r.author_id, r.rating, r.visited_on
  from public.reviews r
  order by r.item_id, r.author_id, r.visited_on desc, r.created_at desc
), agg as (
  select item_id,
         count(*)::int                  as reviewer_count,
         round(avg(rating), 2)          as avg_rating,
         max(visited_on)                as last_visited_on,
         array_agg(author_id)           as reviewer_ids
  from latest group by item_id
), rc as (
  select item_id, count(*)::int as review_count from public.reviews group by item_id
), tg as (
  select r.item_id, array_agg(distinct t) as tags
  from public.reviews r cross join lateral unnest(r.tags) as t
  group by r.item_id
), pl as (
  select item_id, count(*)::int as open_plan_count
  from public.plans where status in ('wishlist', 'proposed', 'confirmed')
  group by item_id
), fv as (
  select item_id, count(*)::int as favorite_count, array_agg(user_id) as favorited_by
  from public.favorites group by item_id
), cv as (
  select distinct on (r.item_id) r.item_id, p.storage_path as cover_path
  from public.review_photos p join public.reviews r on r.id = p.review_id
  order by r.item_id, p.created_at desc
)
select i.id, i.group_id, i.category_id, i.name, i.normalized_name, i.subtitle, i.year,
       i.location, i.address, i.external_ref, i.url, i.description, i.created_by, i.created_at,
       c.name  as category_name,
       c.slug  as category_slug,
       c.kind  as category_kind,
       c.icon  as category_icon,
       coalesce(rc.review_count, 0)            as review_count,
       coalesce(agg.reviewer_count, 0)         as reviewer_count,
       agg.avg_rating,
       agg.last_visited_on,
       coalesce(agg.reviewer_ids, '{}'::uuid[]) as reviewer_ids,
       coalesce(tg.tags, '{}'::text[])         as tags,
       coalesce(pl.open_plan_count, 0)         as open_plan_count,
       coalesce(fv.favorite_count, 0)          as favorite_count,
       coalesce(fv.favorited_by, '{}'::uuid[]) as favorited_by,
       cv.cover_path,
       -- accent- and case-insensitive text for the catalog search box
       btrim(i.normalized_name || ' ' || i.normalized_location || ' '
             || coalesce(public.normalize_name(i.subtitle), '')) as search_text
from public.catalog_items i
join public.categories c on c.id = i.category_id
left join agg on agg.item_id = i.id
left join rc  on rc.item_id  = i.id
left join tg  on tg.item_id  = i.id
left join pl  on pl.item_id  = i.id
left join fv  on fv.item_id  = i.id
left join cv  on cv.item_id  = i.id;

-- ---------------------------------------------------------------------------
-- Privileges for functions and views
-- ---------------------------------------------------------------------------
revoke all on public.catalog_overview from anon;
grant select on public.catalog_overview to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
