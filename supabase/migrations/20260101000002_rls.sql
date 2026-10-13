-- Stakeout · migration 2 · Row Level Security
-- Principle: every group-scoped table is readable only by members of that group;
-- writes are scoped to the acting user. `anon` gets nothing.

-- Table privileges (RLS still applies on top of these).
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- Tables with no direct client writes:
revoke insert, update, delete on public.groups, public.group_members, public.activity from authenticated;
grant update on public.groups to authenticated;
grant update, delete on public.group_members to authenticated;
revoke insert, delete on public.profiles from authenticated;

alter table public.profiles          enable row level security;
alter table public.groups            enable row level security;
alter table public.group_members     enable row level security;
alter table public.group_invites     enable row level security;
alter table public.categories        enable row level security;
alter table public.catalog_items     enable row level security;
alter table public.reviews           enable row level security;
alter table public.review_photos     enable row level security;
alter table public.favorites         enable row level security;
alter table public.plans             enable row level security;
alter table public.plan_responses    enable row level security;
alter table public.plan_date_options enable row level security;
alter table public.plan_date_votes   enable row level security;
alter table public.lists             enable row level security;
alter table public.list_items        enable row level security;
alter table public.comments          enable row level security;
alter table public.activity          enable row level security;

-- profiles: yourself + people you share a group with
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- groups: members read; owners edit/delete. Creation goes through create_group().
create policy groups_select on public.groups for select to authenticated
  using (public.is_group_member(id));
create policy groups_update on public.groups for update to authenticated
  using (public.is_group_owner(id)) with check (public.is_group_owner(id));
create policy groups_delete on public.groups for delete to authenticated
  using (public.is_group_owner(id));
grant delete on public.groups to authenticated;

-- group_members: no INSERT policy → the only way in is join_group()/create_group().
create policy members_select on public.group_members for select to authenticated
  using (public.is_group_member(group_id));
create policy members_update on public.group_members for update to authenticated
  using (public.is_group_owner(group_id)) with check (public.is_group_owner(group_id));
create policy members_delete on public.group_members for delete to authenticated
  using (user_id = auth.uid() or public.is_group_owner(group_id));

-- invites: owners only
create policy invites_select on public.group_invites for select to authenticated
  using (public.is_group_owner(group_id));
create policy invites_insert on public.group_invites for insert to authenticated
  with check (public.is_group_owner(group_id) and created_by = auth.uid());
create policy invites_update on public.group_invites for update to authenticated
  using (public.is_group_owner(group_id)) with check (public.is_group_owner(group_id));
create policy invites_delete on public.group_invites for delete to authenticated
  using (public.is_group_owner(group_id));

-- categories: defaults (group_id NULL) are global-read; custom ones belong to a group
create policy categories_select on public.categories for select to authenticated
  using (group_id is null or public.is_group_member(group_id));
create policy categories_insert on public.categories for insert to authenticated
  with check (group_id is not null and public.is_group_member(group_id) and created_by = auth.uid());
create policy categories_update on public.categories for update to authenticated
  using (group_id is not null and (created_by = auth.uid() or public.is_group_owner(group_id)))
  with check (group_id is not null);
create policy categories_delete on public.categories for delete to authenticated
  using (group_id is not null and (created_by = auth.uid() or public.is_group_owner(group_id)));

-- catalog: shared by the whole group
create policy items_select on public.catalog_items for select to authenticated
  using (public.is_group_member(group_id));
create policy items_insert on public.catalog_items for insert to authenticated
  with check (public.is_group_member(group_id) and created_by = auth.uid());
create policy items_update on public.catalog_items for update to authenticated
  using (public.is_group_member(group_id) and (created_by = auth.uid() or public.is_group_owner(group_id)))
  with check (public.is_group_member(group_id));
create policy items_delete on public.catalog_items for delete to authenticated
  using (public.is_group_owner(group_id));

-- reviews: personal. Everyone in the group reads; only the author writes.
create policy reviews_select on public.reviews for select to authenticated
  using (public.is_group_member(group_id));
create policy reviews_insert on public.reviews for insert to authenticated
  with check (public.is_group_member(group_id) and author_id = auth.uid());
create policy reviews_update on public.reviews for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy reviews_delete on public.reviews for delete to authenticated
  using (author_id = auth.uid());

create policy photos_select on public.review_photos for select to authenticated
  using (public.is_group_member(group_id));
create policy photos_insert on public.review_photos for insert to authenticated
  with check (
    public.is_group_member(group_id)
    and exists (select 1 from public.reviews r where r.id = review_id and r.author_id = auth.uid())
  );
create policy photos_delete on public.review_photos for delete to authenticated
  using (exists (select 1 from public.reviews r where r.id = review_id and r.author_id = auth.uid()));

-- favourites
create policy favorites_select on public.favorites for select to authenticated
  using (public.is_group_member(group_id));
create policy favorites_insert on public.favorites for insert to authenticated
  with check (user_id = auth.uid() and public.is_group_member(group_id));
create policy favorites_delete on public.favorites for delete to authenticated
  using (user_id = auth.uid());

-- plans: collaborative. Any member can move a plan along; only creator/owner deletes.
create policy plans_select on public.plans for select to authenticated
  using (public.is_group_member(group_id));
create policy plans_insert on public.plans for insert to authenticated
  with check (public.is_group_member(group_id) and created_by = auth.uid());
create policy plans_update on public.plans for update to authenticated
  using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
create policy plans_delete on public.plans for delete to authenticated
  using (created_by = auth.uid() or public.is_group_owner(group_id));

create policy responses_select on public.plan_responses for select to authenticated
  using (public.is_group_member(group_id));
create policy responses_insert on public.plan_responses for insert to authenticated
  with check (user_id = auth.uid() and public.is_group_member(group_id));
create policy responses_update on public.plan_responses for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy responses_delete on public.plan_responses for delete to authenticated
  using (user_id = auth.uid());

create policy options_select on public.plan_date_options for select to authenticated
  using (public.is_group_member(group_id));
create policy options_insert on public.plan_date_options for insert to authenticated
  with check (suggested_by = auth.uid() and public.is_group_member(group_id));
create policy options_delete on public.plan_date_options for delete to authenticated
  using (suggested_by = auth.uid() or public.is_group_owner(group_id));

create policy votes_select on public.plan_date_votes for select to authenticated
  using (public.is_group_member(group_id));
create policy votes_insert on public.plan_date_votes for insert to authenticated
  with check (user_id = auth.uid() and public.is_group_member(group_id));
create policy votes_delete on public.plan_date_votes for delete to authenticated
  using (user_id = auth.uid());

-- lists
create policy lists_select on public.lists for select to authenticated
  using (public.is_group_member(group_id));
create policy lists_insert on public.lists for insert to authenticated
  with check (owner_id = auth.uid() and public.is_group_member(group_id));
create policy lists_update on public.lists for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy lists_delete on public.lists for delete to authenticated
  using (owner_id = auth.uid());

create policy list_items_select on public.list_items for select to authenticated
  using (public.is_group_member(group_id));
create policy list_items_insert on public.list_items for insert to authenticated
  with check (
    added_by = auth.uid()
    and public.is_group_member(group_id)
    and exists (
      select 1 from public.lists l
      where l.id = list_id and (l.owner_id = auth.uid() or l.is_collaborative)
    )
  );
create policy list_items_update on public.list_items for update to authenticated
  using (added_by = auth.uid() or exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid()))
  with check (public.is_group_member(group_id));
create policy list_items_delete on public.list_items for delete to authenticated
  using (
    added_by = auth.uid()
    or exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid())
  );

-- comments
create policy comments_select on public.comments for select to authenticated
  using (public.is_group_member(group_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_group_member(group_id));
create policy comments_update on public.comments for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = auth.uid() or public.is_group_owner(group_id));

-- activity: read-only for members (writes come from SECURITY DEFINER triggers)
create policy activity_select on public.activity for select to authenticated
  using (public.is_group_member(group_id));
