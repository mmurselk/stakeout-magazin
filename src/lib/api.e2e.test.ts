/**
 * End-to-end API test. Runs the app's real data layer (src/lib/api.ts, via supabase-js) against a
 * PostgREST + Postgres stack with the real migrations applied. Skipped unless E2E_URL is set.
 * See README → "Testing".
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CatalogFilters } from './types';

const E2E = process.env.E2E_URL;
const SECRET = process.env.E2E_JWT_SECRET ?? '';

const ids = {
  alice: 'aaaaaaaa-0000-0000-0000-000000000001',
  bob: 'bbbbbbbb-0000-0000-0000-000000000002',
  carol: 'cccccccc-0000-0000-0000-000000000003',
};

function mint(sub: string): string {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b({ alg: 'HS256', typ: 'JWT' });
  const body = b({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const defaults: CatalogFilters = { q: '', categoryId: '', minRating: 0, tags: [], memberId: '', status: 'all', favoritesOf: '', sort: 'recent' };

describe.skipIf(!E2E)('app data layer against Postgres + PostgREST + RLS', () => {
  it('runs the main user flows', async () => {
    const { supabase } = await import('./supabase');
    const api = await import('./api');
    const as = async (who: keyof typeof ids) => {
      await supabase.auth.setSession({ access_token: mint(ids[who]), refresh_token: 'x' });
    };

    // ---- groups & invites
    await as('alice');
    const gid = await api.createGroup('Gotham Nights', 'test crew');
    const mine = await api.listMyGroups(ids.alice);
    expect(mine.map((m) => m.group.name)).toEqual(['Gotham Nights']);
    expect(mine[0].role).toBe('owner');
    const invites = await api.listInvites(gid);
    expect(invites).toHaveLength(1);

    await as('bob');
    const prev = await api.previewInvite(invites[0].code);
    expect(prev).toMatchObject({ group_name: 'Gotham Nights', is_valid: true, member_count: 1 });
    expect(await api.joinGroup(invites[0].code)).toBe(gid);
    await expect(api.joinGroup('doesnotexist')).rejects.toThrow(/invalid, expired or used up/);
    expect(await api.listInvites(gid)).toHaveLength(0); // members cannot see codes

    await as('alice');
    const members = await api.listMembers(gid);
    expect(members.map((m) => m.profile?.display_name).sort()).toEqual(['Alice', 'Bob']);

    // ---- categories & review creation with automatic catalog entry
    const cats = await api.listCategories(gid);
    const movie = cats.find((c) => c.slug === 'movie')!;
    const cafe = cats.find((c) => c.slug === 'cafe')!;
    expect(cats.length).toBeGreaterThanOrEqual(8);
    const custom = await api.createCategory(gid, ids.alice, 'Board game cafés', 'place', 'spark');
    expect(custom.group_id).toBe(gid);

    const r1 = await api.createReview({
      groupId: gid, itemId: null, newItem: { category_id: movie.id, name: 'The Batman', year: 2022, external_ref: 'imdb:tt1877830' },
      rating: 4.5, body: 'Rain, jazz, dread.', tags: ['Noir', 'rain'], visitedOn: '2026-03-01', photoPaths: [],
    });
    expect(r1.item_created).toBe(true);

    // ---- dedupe: suggestions, then a second person reviews the same thing
    await as('bob');
    const similar = await api.findSimilar(gid, 'batmen');
    expect(similar.map((s) => s.name)).toContain('The Batman');
    const r2 = await api.createReview({
      groupId: gid, itemId: null, newItem: { category_id: movie.id, name: 'batman', year: 2022 },
      rating: 3, body: 'Too long.', tags: ['long'], visitedOn: '2026-03-05', photoPaths: [],
    });
    expect(r2.item_created).toBe(false);
    expect(r2.item_id).toBe(r1.item_id);
    const r2b = await api.createReview({
      groupId: gid, itemId: null, newItem: { category_id: movie.id, name: 'Different title', year: 1999, external_ref: ' IMDB:tt1877830 ' },
      rating: 4, body: '', tags: [], visitedOn: '2026-03-09', photoPaths: [],
    });
    expect(r2b.item_id).toBe(r1.item_id); // linked by external identifier
    await expect(api.createReview({
      groupId: gid, itemId: r1.item_id, newItem: null, rating: 2, body: '', tags: [], visitedOn: '2026-03-05', photoPaths: [],
    })).rejects.toThrow(/already logged a visit/);

    // ---- catalog overview, embeds and every filter
    const item = await api.getItem(r1.item_id);
    expect(item).toMatchObject({ name: 'The Batman', reviewer_count: 2, category_slug: 'movie' });
    expect(Number(item!.avg_rating)).toBe(4.25); // latest review per member: alice 4.5, bob 4

    const reviews = await api.listItemReviews(r1.item_id);
    expect(reviews).toHaveLength(3);
    expect(reviews[0].author?.display_name).toBeTruthy();
    expect(reviews[0].item?.name).toBe('The Batman');
    expect(reviews.find((r) => r.author_id === ids.alice)!.tags.sort()).toEqual(['noir', 'rain']);

    const f = (patch: Partial<typeof defaults>) => api.searchCatalog(gid, { ...defaults, ...patch });
    await as('alice');
    const heat = await api.createReview({ groupId: gid, itemId: null, newItem: { category_id: cafe.id, name: 'Moda Kahve', location: 'Kadıköy' }, rating: 5, body: 'Best flat white.', tags: ['coffee'], visitedOn: '2026-04-01', photoPaths: [] });
    expect((await f({})).length).toBe(2);
    expect((await f({ q: 'batman' })).map((i) => i.name)).toEqual(['The Batman']);
    expect((await f({ q: 'kadikoy' })).map((i) => i.name)).toEqual(['Moda Kahve']);
    expect((await f({ categoryId: cafe.id })).map((i) => i.name)).toEqual(['Moda Kahve']);
    expect((await f({ minRating: 4.5 })).map((i) => i.name)).toEqual(['Moda Kahve']);
    expect((await f({ tags: ['noir'] })).map((i) => i.name)).toEqual(['The Batman']);
    expect((await f({ memberId: ids.bob })).map((i) => i.name)).toEqual(['The Batman']);
    expect((await f({ status: 'visited' })).length).toBe(2);
    expect((await f({ status: 'unvisited' })).length).toBe(0);
    expect((await f({ sort: 'rating' }))[0].name).toBe('Moda Kahve');

    // ---- favourites, comments, activity feed, history
    await api.setFavorite(gid, heat.item_id, ids.alice, true);
    await api.setFavorite(gid, heat.item_id, ids.alice, true); // idempotent
    expect((await f({ favoritesOf: ids.alice })).map((i) => i.name)).toEqual(['Moda Kahve']);
    await api.setFavorite(gid, heat.item_id, ids.alice, false);
    expect((await f({ favoritesOf: ids.alice })).length).toBe(0);

    const aliceReview = reviews.find((r) => r.author_id === ids.alice)!;
    await as('bob');
    await api.addComment(gid, ids.bob, { review_id: aliceReview.id }, 'Disagree!');
    const comments = await api.listComments({ review_id: aliceReview.id });
    expect(comments).toHaveLength(1);
    expect(comments[0].author?.display_name).toBe('Bob');
    expect(await api.commentCounts(gid, 'review_id', [aliceReview.id])).toEqual({ [aliceReview.id]: 1 });

    const feed = await api.listActivity(gid, 0);
    expect(feed.filter((a) => a.verb === 'reviewed').length).toBe(4);
    expect(feed.find((a) => a.verb === 'reviewed')!.item?.name).toBeTruthy();
    expect(feed.some((a) => a.verb === 'joined')).toBe(true);
    expect((await api.listUserReviews(gid, ids.bob)).length).toBe(2);

    // ---- editing is author-only
    await as('bob');
    await api.updateReview(aliceReview.id, gid, { rating: 1, body: 'hacked', tags: [], visited_on: '2026-03-01' }, [], []);
    expect((await api.getReview(aliceReview.id))!.rating).toBe(4.5); // RLS silently filtered the write
    const bobReview = (await api.listUserReviews(gid, ids.bob))[0];
    await api.updateReview(bobReview.id, gid, { rating: 2.5, body: 'Reconsidered.', tags: ['edited'], visited_on: bobReview.visited_on }, [], []);
    expect(Number((await api.getReview(bobReview.id))!.rating)).toBe(2.5);

    // ---- planning
    await as('alice');
    const plan = await api.createPlan({ groupId: gid, itemId: null, newItem: { category_id: cafe.id, name: 'Karaköy Roasters', location: 'Karaköy' }, status: 'wishlist', notes: 'flat white', proposedFor: null });
    expect(plan.item_created).toBe(true);
    expect((await f({ status: 'planned' })).map((i) => i.name)).toEqual(['Karaköy Roasters']);
    await as('bob');
    await api.respondToPlan(gid, plan.plan_id, ids.bob, 'maybe');
    await api.respondToPlan(gid, plan.plan_id, ids.bob, 'in');
    const when = new Date(Date.now() + 3 * 86400_000).toISOString();
    await api.addDateOption(gid, plan.plan_id, ids.bob, when);
    await as('alice');
    let plans = await api.listPlans(gid);
    let p = plans.find((x) => x.id === plan.plan_id)!;
    expect(p.item?.name).toBe('Karaköy Roasters');
    expect(p.responses.map((r) => `${r.user_id === ids.bob ? 'bob' : 'alice'}:${r.response}`).sort()).toEqual(['alice:in', 'bob:in']);
    expect(p.options).toHaveLength(1);
    expect(p.options[0].votes).toHaveLength(1);
    await api.voteDate(gid, p.options[0].id, ids.alice, true);
    await api.updatePlan(plan.plan_id, { status: 'confirmed', proposed_for: p.options[0].starts_at });
    plans = await api.listPlans(gid);
    p = plans.find((x) => x.id === plan.plan_id)!;
    expect(p.options[0].votes).toHaveLength(2);
    expect(p.status).toBe('confirmed');
    await api.updatePlan(plan.plan_id, { status: 'completed' });
    p = (await api.listPlans(gid)).find((x) => x.id === plan.plan_id)!;
    expect(p.completed_at).toBeTruthy();
    expect((await api.listActivity(gid, 0)).some((a) => a.verb === 'completed')).toBe(true);
    expect((await api.listItemPlans(p.item_id)).length).toBe(1);

    // ---- lists
    const list = await api.createList(gid, ids.alice, 'Rainy Sunday', 'cosy', false);
    await api.addToList(gid, list.id, r1.item_id, ids.alice);
    await api.addToList(gid, list.id, r1.item_id, ids.alice); // idempotent
    const entries = await api.listEntries(list.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].item?.name).toBe('The Batman');
    expect((await api.getList(list.id))!.list_items).toHaveLength(1);
    await as('bob');
    await expect(api.addToList(gid, list.id, heat.item_id, ids.bob)).rejects.toThrow(/permission/);

    // ---- outsider sees nothing
    await as('carol');
    expect(await api.listMyGroups(ids.carol)).toEqual([]);
    expect(await api.searchCatalog(gid, defaults)).toEqual([]);
    expect(await api.getItem(r1.item_id)).toBeNull();
    expect(await api.listPlans(gid)).toEqual([]);
    expect(await api.listActivity(gid, 0)).toEqual([]);
    await expect(api.createReview({ groupId: gid, itemId: r1.item_id, newItem: null, rating: 1, body: '', tags: [], visitedOn: '2026-05-01', photoPaths: [] })).rejects.toThrow();
    expect(await api.previewInvite(invites[0].code)).toMatchObject({ group_name: 'Gotham Nights' }); // preview only exposes name and size

    // ---- owner controls
    await as('alice');
    await api.setMemberRole(gid, ids.bob, 'owner');
    await api.removeMember(gid, ids.alice); // allowed: another owner exists
    await as('bob');
    await api.deleteGroup(gid);
    expect(await api.listMyGroups(ids.bob)).toEqual([]);
  }, 60_000);
});
