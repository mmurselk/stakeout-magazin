import type { PostgrestError } from '@supabase/supabase-js';
import { supabase, PHOTO_BUCKET } from './supabase';
import { normalizeName } from './normalize';
import type {
  ActivityRow, CatalogFilters, CatalogItem, Category, Comment, Invite, ListEntry, ListRow,
  Member, Membership, NewItemInput, Plan, PlanStatus, Profile, Response, Review, SimilarItem,
} from './types';

const PROFILE = 'id, username, display_name, bio';
const ITEM_REF = 'id, name, year, location, category:categories(name, kind, icon)';

/** Turn Postgres / PostgREST errors into sentences a person can act on. */
export function explain(err: unknown): string {
  const e = err as Partial<PostgrestError> & { message?: string };
  const code = e?.code;
  const msg = e?.message ?? 'Something went wrong.';
  if (code === '23505') {
    if (/reviews_item_id_author_id_visited_on/.test(msg) || /visited_on/.test(msg))
      return 'You already logged a visit on that date. Edit that review or pick another date.';
    if (/categories/.test(msg)) return 'A category with that name already exists.';
    if (/username/.test(msg)) return 'That username is taken.';
    return 'That already exists.';
  }
  if (code === '23514' && /owner/.test(msg)) return 'A group needs at least one owner. Promote someone else first.';
  if (code === '23514') return 'One of the values is out of range.';
  if (code === '42501') return 'You do not have permission to do that.';
  if (code === 'P0001') return msg;
  if (code === '23503' && /categor/.test(msg)) return 'That category is still used by catalog entries.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Cannot reach the server. Check your connection and try again.';
  return msg;
}

function ok<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) throw new Error(explain(res.error));
  return res.data as T;
}

// ---------------------------------------------------------------- profile
export async function getProfile(id: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select(PROFILE).eq('id', id).maybeSingle();
  if (error) throw new Error(explain(error));
  return data as Profile | null;
}

export async function updateProfile(id: string, patch: { display_name?: string; bio?: string | null; username?: string }) {
  ok(await supabase.from('profiles').update(patch).eq('id', id));
}

// ---------------------------------------------------------------- groups
export async function listMyGroups(userId: string): Promise<Membership[]> {
  const data = ok(
    await supabase
      .from('group_members')
      .select('role, group:groups(id, name, description, created_at)')
      .eq('user_id', userId),
  );
  return (data as unknown as Membership[]).filter((m) => m.group).sort((a, b) => a.group.name.localeCompare(b.group.name));
}

export async function createGroup(name: string, description?: string): Promise<string> {
  return ok(await supabase.rpc('create_group', { p_name: name, p_description: description ?? null })) as string;
}

export async function updateGroup(id: string, patch: { name?: string; description?: string | null }) {
  ok(await supabase.from('groups').update(patch).eq('id', id));
}

export async function deleteGroup(id: string) {
  ok(await supabase.from('groups').delete().eq('id', id));
}

export async function previewInvite(code: string) {
  const rows = ok(await supabase.rpc('preview_invite', { p_code: code })) as {
    group_id: string; group_name: string; member_count: number; is_valid: boolean;
  }[];
  return rows?.[0] ?? null;
}

export async function joinGroup(code: string): Promise<string> {
  return ok(await supabase.rpc('join_group', { p_code: code })) as string;
}

export async function listMembers(groupId: string): Promise<Member[]> {
  const data = ok(
    await supabase
      .from('group_members')
      .select(`user_id, role, joined_at, profile:profiles(${PROFILE})`)
      .eq('group_id', groupId)
      .order('joined_at'),
  );
  return data as unknown as Member[];
}

export async function setMemberRole(groupId: string, userId: string, role: 'owner' | 'member') {
  ok(await supabase.from('group_members').update({ role }).eq('group_id', groupId).eq('user_id', userId));
}

export async function removeMember(groupId: string, userId: string) {
  ok(await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId));
}

export async function listInvites(groupId: string): Promise<Invite[]> {
  return ok(
    await supabase.from('group_invites').select('id, code, created_at, expires_at, max_uses, uses, revoked_at')
      .eq('group_id', groupId).order('created_at', { ascending: false }),
  ) as Invite[];
}

export async function createInvite(groupId: string, userId: string, days: number, maxUses: number | null) {
  ok(
    await supabase.from('group_invites').insert({
      group_id: groupId,
      created_by: userId,
      expires_at: new Date(Date.now() + days * 86400_000).toISOString(),
      max_uses: maxUses,
    }),
  );
}

export async function revokeInvite(id: string) {
  ok(await supabase.from('group_invites').update({ revoked_at: new Date().toISOString() }).eq('id', id));
}

// ---------------------------------------------------------------- categories
export async function listCategories(groupId: string): Promise<Category[]> {
  return ok(
    await supabase.from('categories').select('id, group_id, slug, name, kind, icon')
      .or(`group_id.is.null,group_id.eq.${groupId}`).order('name'),
  ) as Category[];
}

export async function createCategory(groupId: string, userId: string, name: string, kind: Category['kind'], icon: string) {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'custom';
  return ok(
    await supabase.from('categories').insert({ group_id: groupId, slug, name: name.trim(), kind, icon, created_by: userId })
      .select('id, group_id, slug, name, kind, icon').single(),
  ) as Category;
}

// ---------------------------------------------------------------- catalog
export async function searchCatalog(groupId: string, f: CatalogFilters): Promise<CatalogItem[]> {
  let q = supabase.from('catalog_overview').select('*').eq('group_id', groupId);
  const term = f.q.trim();
  if (term) {
    const n = normalizeName(term).replace(/[%,()]/g, ' ');
    const raw = term.replace(/[%,()]/g, ' ');
    q = q.or(`search_text.ilike.%${n}%,name.ilike.%${raw}%`);
  }
  if (f.categoryId) q = q.eq('category_id', f.categoryId);
  if (f.minRating > 0) q = q.gte('avg_rating', f.minRating);
  if (f.tags.length) q = q.overlaps('tags', f.tags);
  if (f.memberId) q = q.contains('reviewer_ids', [f.memberId]);
  if (f.favoritesOf) q = q.contains('favorited_by', [f.favoritesOf]);
  if (f.status === 'visited') q = q.gt('review_count', 0);
  if (f.status === 'unvisited') q = q.eq('review_count', 0);
  if (f.status === 'planned') q = q.gt('open_plan_count', 0);
  if (f.sort === 'rating') q = q.order('avg_rating', { ascending: false, nullsFirst: false }).order('name');
  else if (f.sort === 'name') q = q.order('normalized_name');
  else if (f.sort === 'added') q = q.order('created_at', { ascending: false });
  else q = q.order('last_visited_on', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
  return ok(await q.limit(200)) as CatalogItem[];
}

export async function getItem(id: string): Promise<CatalogItem | null> {
  const { data, error } = await supabase.from('catalog_overview').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(explain(error));
  return data as CatalogItem | null;
}

export async function findSimilar(groupId: string, name: string, categoryId?: string): Promise<SimilarItem[]> {
  if (normalizeName(name).length < 2) return [];
  return ok(
    await supabase.rpc('find_similar_items', {
      p_group_id: groupId, p_name: name, p_category_id: categoryId || null, p_limit: 6,
    }),
  ) as SimilarItem[];
}

export async function updateItem(id: string, patch: Partial<NewItemInput>) {
  ok(await supabase.from('catalog_items').update(patch).eq('id', id));
}

export async function deleteItem(id: string) {
  ok(await supabase.from('catalog_items').delete().eq('id', id));
}

// ---------------------------------------------------------------- reviews
const REVIEW_SELECT = `id, group_id, item_id, author_id, rating, body, tags, visited_on, created_at,
  author:profiles(${PROFILE}), photos:review_photos(id, storage_path), item:catalog_items(${ITEM_REF})`;

export interface ReviewInput {
  groupId: string;
  itemId: string | null;
  newItem: NewItemInput | null;
  rating: number;
  body: string;
  tags: string[];
  visitedOn: string;
  photoPaths: string[];
}

export async function createReview(i: ReviewInput) {
  return ok(
    await supabase.rpc('create_review', {
      p_group_id: i.groupId, p_item_id: i.itemId, p_new_item: i.newItem, p_rating: i.rating,
      p_body: i.body || null, p_tags: i.tags, p_visited_on: i.visitedOn, p_photo_paths: i.photoPaths,
    }),
  ) as { review_id: string; item_id: string; item_created: boolean };
}

export async function updateReview(
  id: string, groupId: string,
  patch: { rating: number; body: string; tags: string[]; visited_on: string },
  addPaths: string[], removePhotoIds: string[],
) {
  ok(await supabase.from('reviews').update({ ...patch, body: patch.body || null }).eq('id', id));
  if (removePhotoIds.length) ok(await supabase.from('review_photos').delete().in('id', removePhotoIds));
  if (addPaths.length)
    ok(await supabase.from('review_photos').insert(addPaths.map((p) => ({ group_id: groupId, review_id: id, storage_path: p }))));
}

export async function deleteReview(id: string) {
  ok(await supabase.from('reviews').delete().eq('id', id));
}

export async function getReview(id: string): Promise<Review | null> {
  const { data, error } = await supabase.from('reviews').select(REVIEW_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(explain(error));
  return data as unknown as Review | null;
}

export async function listItemReviews(itemId: string): Promise<Review[]> {
  return ok(
    await supabase.from('reviews').select(REVIEW_SELECT).eq('item_id', itemId)
      .order('visited_on', { ascending: false }).order('created_at', { ascending: false }),
  ) as unknown as Review[];
}

export async function listUserReviews(groupId: string, userId: string): Promise<Review[]> {
  return ok(
    await supabase.from('reviews').select(REVIEW_SELECT).eq('group_id', groupId).eq('author_id', userId)
      .order('visited_on', { ascending: false }).limit(200),
  ) as unknown as Review[];
}

// ---------------------------------------------------------------- favourites
export async function setFavorite(groupId: string, itemId: string, userId: string, on: boolean) {
  if (on) ok(await supabase.from('favorites').upsert({ user_id: userId, item_id: itemId, group_id: groupId }, { onConflict: 'user_id,item_id', ignoreDuplicates: true }));
  else ok(await supabase.from('favorites').delete().eq('user_id', userId).eq('item_id', itemId));
}

// ---------------------------------------------------------------- feed
export async function listActivity(groupId: string, page: number, size = 20): Promise<ActivityRow[]> {
  return ok(
    await supabase
      .from('activity')
      .select(`id, verb, created_at, actor:profiles(id, username, display_name),
        item:catalog_items(${ITEM_REF}),
        review:reviews(id, rating, body, visited_on, tags, photos:review_photos(id, storage_path)),
        plan:plans(id, status, proposed_for)`)
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .range(page * size, page * size + size - 1),
  ) as unknown as ActivityRow[];
}

// ---------------------------------------------------------------- comments
type Target = { review_id?: string; plan_id?: string; item_id?: string };

export async function listComments(target: Target): Promise<Comment[]> {
  const [col, val] = Object.entries(target)[0];
  return ok(
    await supabase.from('comments').select(`id, author_id, body, created_at, author:profiles(${PROFILE})`)
      .eq(col, val).order('created_at'),
  ) as unknown as Comment[];
}

export async function addComment(groupId: string, userId: string, target: Target, body: string) {
  ok(await supabase.from('comments').insert({ group_id: groupId, author_id: userId, body: body.trim(), ...target }));
}

export async function deleteComment(id: string) {
  ok(await supabase.from('comments').delete().eq('id', id));
}

export async function commentCounts(groupId: string, column: 'review_id' | 'plan_id', ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  const rows = ok(await supabase.from('comments').select(column).eq('group_id', groupId).in(column, ids)) as unknown as Record<string, string>[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r[column]] = (out[r[column]] ?? 0) + 1;
  return out;
}

// ---------------------------------------------------------------- plans
const PLAN_SELECT = `id, group_id, item_id, status, notes, proposed_for, created_by, created_at, completed_at,
  item:catalog_items(${ITEM_REF}), creator:profiles(${PROFILE}),
  responses:plan_responses(user_id, response),
  options:plan_date_options(id, starts_at, suggested_by, votes:plan_date_votes(user_id))`;

export async function listPlans(groupId: string): Promise<Plan[]> {
  return ok(
    await supabase.from('plans').select(PLAN_SELECT).eq('group_id', groupId)
      .order('proposed_for', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }),
  ) as unknown as Plan[];
}

export async function listItemPlans(itemId: string): Promise<Plan[]> {
  return ok(await supabase.from('plans').select(PLAN_SELECT).eq('item_id', itemId).order('created_at', { ascending: false })) as unknown as Plan[];
}

export async function createPlan(i: {
  groupId: string; itemId: string | null; newItem: NewItemInput | null;
  status: PlanStatus; notes: string; proposedFor: string | null;
}) {
  return ok(
    await supabase.rpc('create_plan', {
      p_group_id: i.groupId, p_item_id: i.itemId, p_new_item: i.newItem,
      p_status: i.status, p_notes: i.notes || null, p_proposed_for: i.proposedFor,
    }),
  ) as { plan_id: string; item_id: string; item_created: boolean };
}

export async function updatePlan(id: string, patch: { status?: PlanStatus; notes?: string | null; proposed_for?: string | null }) {
  ok(await supabase.from('plans').update(patch).eq('id', id));
}

export async function deletePlan(id: string) {
  ok(await supabase.from('plans').delete().eq('id', id));
}

export async function respondToPlan(groupId: string, planId: string, userId: string, response: Response | null) {
  if (response === null) ok(await supabase.from('plan_responses').delete().eq('plan_id', planId).eq('user_id', userId));
  else
    ok(await supabase.from('plan_responses').upsert(
      { plan_id: planId, group_id: groupId, user_id: userId, response, updated_at: new Date().toISOString() },
      { onConflict: 'plan_id,user_id' },
    ));
}

export async function addDateOption(groupId: string, planId: string, userId: string, startsAt: string) {
  const row = ok(
    await supabase.from('plan_date_options').insert({ plan_id: planId, group_id: groupId, starts_at: startsAt, suggested_by: userId })
      .select('id').single(),
  ) as { id: string };
  // suggesting a date implies you can make it
  ok(await supabase.from('plan_date_votes').insert({ option_id: row.id, group_id: groupId, user_id: userId }));
}

export async function removeDateOption(id: string) {
  ok(await supabase.from('plan_date_options').delete().eq('id', id));
}

export async function voteDate(groupId: string, optionId: string, userId: string, on: boolean) {
  if (on) ok(await supabase.from('plan_date_votes').upsert({ option_id: optionId, group_id: groupId, user_id: userId }, { onConflict: 'option_id,user_id', ignoreDuplicates: true }));
  else ok(await supabase.from('plan_date_votes').delete().eq('option_id', optionId).eq('user_id', userId));
}

// ---------------------------------------------------------------- lists
export async function listLists(groupId: string): Promise<ListRow[]> {
  return ok(
    await supabase.from('lists')
      .select(`id, title, description, is_collaborative, owner_id, created_at, owner:profiles(${PROFILE}), list_items(item_id)`)
      .eq('group_id', groupId).order('created_at', { ascending: false }),
  ) as unknown as ListRow[];
}

export async function getList(id: string): Promise<ListRow | null> {
  const { data, error } = await supabase.from('lists')
    .select(`id, title, description, is_collaborative, owner_id, created_at, owner:profiles(${PROFILE}), list_items(item_id)`)
    .eq('id', id).maybeSingle();
  if (error) throw new Error(explain(error));
  return data as unknown as ListRow | null;
}

export async function createList(groupId: string, ownerId: string, title: string, description: string, collaborative: boolean) {
  return ok(
    await supabase.from('lists').insert({ group_id: groupId, owner_id: ownerId, title: title.trim(), description: description.trim() || null, is_collaborative: collaborative })
      .select('id').single(),
  ) as { id: string };
}

export async function deleteList(id: string) {
  ok(await supabase.from('lists').delete().eq('id', id));
}

export async function listEntries(listId: string): Promise<ListEntry[]> {
  return ok(
    await supabase.from('list_items').select(`item_id, note, added_by, added_at, item:catalog_items(${ITEM_REF})`)
      .eq('list_id', listId).order('added_at', { ascending: false }),
  ) as unknown as ListEntry[];
}

export async function addToList(groupId: string, listId: string, itemId: string, userId: string) {
  ok(await supabase.from('list_items').upsert({ list_id: listId, item_id: itemId, group_id: groupId, added_by: userId }, { onConflict: 'list_id,item_id', ignoreDuplicates: true }));
}

export async function removeFromList(listId: string, itemId: string) {
  ok(await supabase.from('list_items').delete().eq('list_id', listId).eq('item_id', itemId));
}

// ---------------------------------------------------------------- photos
export async function uploadPhoto(groupId: string, userId: string, blob: Blob): Promise<string> {
  const path = `${groupId}/${userId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(explain(error));
  return path;
}

export async function removePhotos(paths: string[]) {
  if (paths.length) await supabase.storage.from(PHOTO_BUCKET).remove(paths);
}

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw new Error(explain(error));
  const out: Record<string, string> = {};
  for (const r of data ?? []) if (r.path && r.signedUrl) out[r.path] = r.signedUrl;
  return out;
}
