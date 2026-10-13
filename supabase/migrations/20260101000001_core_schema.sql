-- Stakeout · migration 1 · core schema
-- Run order: 1 core_schema → 2 rls → 3 functions_views → 4 storage

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Canonical form used for duplicate detection.
-- "The Batman", "batman", "BATMAN!" and "Bátman" all normalise to "batman".
create or replace function public.normalize_name(t text)
returns text
language sql
stable
set search_path = public, extensions
as $$
  with s as (
    select regexp_replace(lower(extensions.unaccent(coalesce(t, ''))), '&', ' and ', 'g') as v
  ), p as (
    select btrim(regexp_replace(v, '[^[:alnum:]]+', ' ', 'g')) as v from s
  )
  select case
           when v = '' then ''
           else btrim(regexp_replace(v, '^(the|a|an) +(.+)$', '\2'))
         end
  from p
$$;

create or replace function public.try_uuid(t text)
returns uuid
language plpgsql
immutable
as $$
begin
  return t::uuid;
exception when others then
  return null;
end
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Raises if any listed column changes. Used to freeze ownership columns.
create or replace function public.forbid_column_change()
returns trigger
language plpgsql
as $$
declare
  col text;
begin
  foreach col in array tg_argv loop
    if (to_jsonb(new) -> col) is distinct from (to_jsonb(old) -> col) then
      raise exception 'column % of %.% is immutable', col, tg_table_schema, tg_table_name
        using errcode = '42501';
    end if;
  end loop;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 60),
  bio          text check (char_length(bio) <= 280),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base  text;
  uname text;
  n     int := 0;
begin
  base := regexp_replace(
            lower(coalesce(nullif(new.raw_user_meta_data ->> 'username', ''),
                           split_part(coalesce(new.email, 'user'), '@', 1))),
            '[^a-z0-9_]', '', 'g');
  if char_length(base) < 3 then base := base || 'user'; end if;
  base  := left(base, 18);
  uname := base;
  while exists (select 1 from public.profiles where username = uname) loop
    n := n + 1;
    uname := base || floor(random() * 9000 + 1000)::int::text;
    exit when n > 25;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (new.id,
          uname,
          left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), base), 60));
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Groups, memberships, invites
-- ---------------------------------------------------------------------------

create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (char_length(description) <= 280),
  created_by  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

create table public.group_invites (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  code       text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  max_uses   int check (max_uses is null or max_uses > 0) default 10,
  uses       int not null default 0,
  revoked_at timestamptz
);
create index group_invites_group_idx on public.group_invites (group_id);

-- Membership helpers. SECURITY DEFINER so RLS policies can call them without recursion.
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = auth.uid()
  )
$$;

create or replace function public.is_group_owner(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = auth.uid() and m.role = 'owner'
  )
$$;

create or replace function public.shares_group_with(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members a
    join public.group_members b on b.group_id = a.group_id
    where a.user_id = auth.uid() and b.user_id = uid
  )
$$;

-- A group must always keep at least one owner (unless the group itself is being deleted).
create or replace function public.ensure_owner_remains()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from public.groups g where g.id = old.group_id)
     and not exists (
       select 1 from public.group_members m
       where m.group_id = old.group_id and m.role = 'owner' and m.user_id <> old.user_id
     )
  then
    raise exception 'a group needs at least one owner; promote someone else first'
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end
$$;

create trigger group_members_keep_owner
  before update or delete on public.group_members
  for each row execute function public.ensure_owner_remains();

create trigger group_members_freeze before update on public.group_members
  for each row execute function public.forbid_column_change('group_id', 'user_id');

-- ---------------------------------------------------------------------------
-- Categories (defaults have group_id NULL; groups add their own)
-- ---------------------------------------------------------------------------

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid references public.groups (id) on delete cascade,
  slug       text not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  kind       text not null default 'place' check (kind in ('screen', 'place', 'activity')),
  icon       text not null default 'spark',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create unique index categories_slug_uniq
  on public.categories (coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
create unique index categories_name_uniq
  on public.categories (coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

insert into public.categories (slug, name, kind, icon) values
  ('movie',       'Movie',        'screen',   'film'),
  ('series',      'Series',       'screen',   'tv'),
  ('cafe',        'Café',         'place',    'cup'),
  ('restaurant',  'Restaurant',   'place',    'fork'),
  ('park',        'Park',         'place',    'tree'),
  ('sports-court','Sports court', 'place',    'ball'),
  ('hobby-spot',  'Hobby spot',   'place',    'compass'),
  ('event',       'Event',        'activity', 'spark');

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table public.catalog_items (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references public.groups (id) on delete cascade,
  category_id         uuid not null references public.categories (id) on delete restrict,
  name                text not null check (char_length(btrim(name)) between 1 and 160),
  normalized_name     text not null,
  subtitle            text check (char_length(subtitle) <= 160),   -- director, cuisine, neighbourhood tagline…
  year                int  check (year between 1850 and 2200),
  location            text check (char_length(location) <= 160),   -- city / district
  normalized_location text not null default '',
  address             text check (char_length(address) <= 240),
  external_ref        text check (char_length(external_ref) <= 300), -- e.g. imdb:tt1877830, a map URL, a place id
  url                 text check (char_length(url) <= 500),
  description         text check (char_length(description) <= 1000),
  created_by          uuid not null references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, group_id)
);

-- Hard duplicate guards (soft/fuzzy matching is offered in the UI via find_similar_items).
create unique index catalog_items_identity_uniq
  on public.catalog_items (group_id, category_id, normalized_name, coalesce(year, 0), normalized_location);
create unique index catalog_items_external_ref_uniq
  on public.catalog_items (group_id, external_ref) where external_ref is not null;
create index catalog_items_group_idx on public.catalog_items (group_id, created_at desc);
create index catalog_items_name_trgm on public.catalog_items using gin (normalized_name extensions.gin_trgm_ops);

create or replace function public.catalog_items_prepare()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  cat_group uuid;
begin
  new.name := btrim(new.name);
  new.normalized_name := coalesce(nullif(public.normalize_name(new.name), ''), lower(new.name));
  new.location := nullif(btrim(coalesce(new.location, '')), '');
  new.normalized_location := coalesce(public.normalize_name(new.location), '');
  new.external_ref := nullif(lower(btrim(coalesce(new.external_ref, ''))), '');
  new.subtitle := nullif(btrim(coalesce(new.subtitle, '')), '');
  new.address := nullif(btrim(coalesce(new.address, '')), '');
  new.url := nullif(btrim(coalesce(new.url, '')), '');
  new.description := nullif(btrim(coalesce(new.description, '')), '');

  select c.group_id into cat_group from public.categories c where c.id = new.category_id;
  if not found then
    raise exception 'unknown category' using errcode = '23503';
  end if;
  if cat_group is not null and cat_group <> new.group_id then
    raise exception 'category belongs to another group' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end
$$;

create trigger catalog_items_prepare_trg
  before insert or update on public.catalog_items
  for each row execute function public.catalog_items_prepare();
create trigger catalog_items_freeze before update on public.catalog_items
  for each row execute function public.forbid_column_change('group_id', 'created_by');

-- ---------------------------------------------------------------------------
-- Reviews (personal) + photos + favourites
-- ---------------------------------------------------------------------------

create table public.reviews (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null,
  item_id    uuid not null,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  rating     numeric(2, 1) not null check (rating between 0.5 and 5 and (rating * 2) = floor(rating * 2)),
  body       text check (char_length(body) <= 4000),
  tags       text[] not null default '{}' check (cardinality(tags) <= 12),
  visited_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, group_id),
  unique (item_id, author_id, visited_on),
  foreign key (item_id, group_id) references public.catalog_items (id, group_id) on delete cascade
);
create index reviews_item_idx on public.reviews (item_id);
create index reviews_author_idx on public.reviews (author_id, visited_on desc);
create index reviews_group_idx on public.reviews (group_id, created_at desc);

create or replace function public.reviews_prepare()
returns trigger
language plpgsql
as $$
begin
  new.tags := coalesce(
    (select array_agg(distinct t) from (
       select left(lower(btrim(x)), 24) as t from unnest(new.tags) x
     ) s where t <> ''),
    '{}');
  new.body := nullif(btrim(coalesce(new.body, '')), '');
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end
$$;
create trigger reviews_prepare_trg before insert or update on public.reviews
  for each row execute function public.reviews_prepare();
create trigger reviews_freeze before update on public.reviews
  for each row execute function public.forbid_column_change('group_id', 'item_id', 'author_id');

create table public.review_photos (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null,
  review_id    uuid not null,
  storage_path text not null unique,
  created_at   timestamptz not null default now(),
  foreign key (review_id, group_id) references public.reviews (id, group_id) on delete cascade
);
create index review_photos_review_idx on public.review_photos (review_id);

create table public.favorites (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  item_id    uuid not null,
  group_id   uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id),
  foreign key (item_id, group_id) references public.catalog_items (id, group_id) on delete cascade
);
create index favorites_item_idx on public.favorites (item_id);

-- ---------------------------------------------------------------------------
-- Plans (wishlist → proposed → confirmed → completed)
-- ---------------------------------------------------------------------------

create table public.plans (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null,
  item_id      uuid not null,
  status       text not null default 'wishlist'
               check (status in ('wishlist', 'proposed', 'confirmed', 'completed', 'cancelled')),
  notes        text check (char_length(notes) <= 1000),
  proposed_for timestamptz,
  created_by   uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, group_id),
  foreign key (item_id, group_id) references public.catalog_items (id, group_id) on delete cascade
);
create index plans_group_status_idx on public.plans (group_id, status);
create index plans_item_idx on public.plans (item_id);

create or replace function public.plans_prepare()
returns trigger
language plpgsql
as $$
begin
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status = 'completed' and old.status <> 'completed' then
      new.completed_at := now();
    elsif new.status <> 'completed' then
      new.completed_at := null;
    end if;
  elsif new.status = 'completed' then
    new.completed_at := now();
  end if;
  return new;
end
$$;
create trigger plans_prepare_trg before insert or update on public.plans
  for each row execute function public.plans_prepare();
create trigger plans_freeze before update on public.plans
  for each row execute function public.forbid_column_change('group_id', 'item_id', 'created_by');

create table public.plan_responses (
  plan_id    uuid not null,
  group_id   uuid not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  response   text not null check (response in ('in', 'maybe', 'out')),
  updated_at timestamptz not null default now(),
  primary key (plan_id, user_id),
  foreign key (plan_id, group_id) references public.plans (id, group_id) on delete cascade
);

create table public.plan_date_options (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null,
  group_id     uuid not null,
  starts_at    timestamptz not null,
  suggested_by uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (id, group_id),
  unique (plan_id, starts_at),
  foreign key (plan_id, group_id) references public.plans (id, group_id) on delete cascade
);

create table public.plan_date_votes (
  option_id  uuid not null,
  group_id   uuid not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (option_id, user_id),
  foreign key (option_id, group_id) references public.plan_date_options (id, group_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Lists
-- ---------------------------------------------------------------------------

create table public.lists (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references public.groups (id) on delete cascade,
  owner_id         uuid not null references public.profiles (id) on delete cascade,
  title            text not null check (char_length(btrim(title)) between 1 and 80),
  description      text check (char_length(description) <= 500),
  is_collaborative boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (id, group_id)
);
create index lists_group_idx on public.lists (group_id, created_at desc);
create trigger lists_freeze before update on public.lists
  for each row execute function public.forbid_column_change('group_id', 'owner_id');

create table public.list_items (
  list_id  uuid not null,
  item_id  uuid not null,
  group_id uuid not null,
  note     text check (char_length(note) <= 300),
  added_by uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, item_id),
  foreign key (list_id, group_id) references public.lists (id, group_id) on delete cascade,
  foreign key (item_id, group_id) references public.catalog_items (id, group_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Comments (on a review, a plan or a catalog item)
-- ---------------------------------------------------------------------------

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  review_id  uuid,
  plan_id    uuid,
  item_id    uuid,
  created_at timestamptz not null default now(),
  check (num_nonnulls(review_id, plan_id, item_id) = 1),
  foreign key (review_id, group_id) references public.reviews (id, group_id) on delete cascade,
  foreign key (plan_id, group_id)   references public.plans (id, group_id) on delete cascade,
  foreign key (item_id, group_id)   references public.catalog_items (id, group_id) on delete cascade
);
create index comments_review_idx on public.comments (review_id) where review_id is not null;
create index comments_plan_idx   on public.comments (plan_id)   where plan_id is not null;
create index comments_item_idx   on public.comments (item_id)   where item_id is not null;
create trigger comments_freeze before update on public.comments
  for each row execute function public.forbid_column_change('group_id', 'author_id', 'review_id', 'plan_id', 'item_id');

-- ---------------------------------------------------------------------------
-- Activity feed (written only by SECURITY DEFINER triggers)
-- ---------------------------------------------------------------------------

create table public.activity (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  actor_id   uuid not null references public.profiles (id) on delete cascade,
  verb       text not null check (verb in ('reviewed', 'planned', 'completed', 'joined')),
  item_id    uuid,
  review_id  uuid references public.reviews (id) on delete cascade,
  plan_id    uuid references public.plans (id) on delete cascade,
  created_at timestamptz not null default now(),
  foreign key (item_id, group_id) references public.catalog_items (id, group_id) on delete cascade
);
create index activity_group_idx on public.activity (group_id, created_at desc);

create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'reviews' then
    insert into public.activity (group_id, actor_id, verb, item_id, review_id)
    values (new.group_id, new.author_id, 'reviewed', new.item_id, new.id);
  elsif tg_table_name = 'plans' then
    if tg_op = 'INSERT' and new.status <> 'completed' then
      insert into public.activity (group_id, actor_id, verb, item_id, plan_id)
      values (new.group_id, new.created_by, 'planned', new.item_id, new.id);
    elsif tg_op = 'UPDATE' and new.status = 'completed' and old.status <> 'completed' then
      insert into public.activity (group_id, actor_id, verb, item_id, plan_id)
      values (new.group_id, coalesce(auth.uid(), new.created_by), 'completed', new.item_id, new.id);
    end if;
  elsif tg_table_name = 'group_members' then
    insert into public.activity (group_id, actor_id, verb) values (new.group_id, new.user_id, 'joined');
  end if;
  return new;
end
$$;

create trigger reviews_activity after insert on public.reviews
  for each row execute function public.log_activity();
create trigger plans_activity after insert or update on public.plans
  for each row execute function public.log_activity();
create trigger members_activity after insert on public.group_members
  for each row execute function public.log_activity();
