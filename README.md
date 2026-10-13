# Stakeout

A private, invite-only logbook for you and your people. Review and rate films, cafés, restaurants,
parks, courts, hobby spots and anything custom; remember what you thought; plan what's next.
Think Letterboxd for a friend group, with a cold, rainy, noir look.

* **Frontend:** React 18 + TypeScript + Vite, hash routing
* **Backend:** Supabase only (Postgres, Auth, Storage). **No custom server.**
* **Hosting:** GitHub Pages (static) deployed by GitHub Actions
* Design notes and the data model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## What it does

| Area | Details |
| --- | --- |
| Accounts & groups | Email + password auth. Groups are invite-only: owners create expiring, use-limited invite links; nobody can add themselves. |
| Shared catalog | One catalog per group. Reviewing or planning something **links to an existing entry or creates one in the same transaction**, so every new item is instantly reusable by everyone. |
| Deduplication | Normalised names (case, accents, punctuation, leading *the/a/an*), year, location and external ids (IMDb id, map link). The picker shows fuzzy "already in your catalog" matches first; the database enforces exact uniqueness, race-safe. |
| Reviews | Each member's review is their own (RLS: only the author edits/deletes). Rating in half-stars, visit date, tags, notes, up to 6 photos. Revisits are kept. |
| Group view | Per-member ratings plus a combined score (mean of each member's *latest* review). |
| Planning | Wishlist, proposed dates, RSVP (in / maybe / can't), alternative date suggestions with voting, lock a date, mark done → write the review. |
| Social | Activity feed, comments (on reviews, plans, items), favourites, custom lists (optionally collaborative), profiles with a visit history. |
| Filters | Category, minimum group rating, tags, reviewed-by member, visited / planned / not-yet, favourites, sort. Accent-insensitive search. |

## Set up Supabase (about 10 minutes)

1. Create a project at <https://supabase.com> (free tier is fine).
2. **Run the migrations, in order.** Either paste each file into *SQL Editor → New query* and run it, or use the CLI (`supabase link` then `supabase db push`):
   1. `supabase/migrations/20260101000001_core_schema.sql`
   2. `supabase/migrations/20260101000002_rls.sql`
   3. `supabase/migrations/20260101000003_functions_views.sql`
   4. `supabase/migrations/20260101000004_storage.sql` (creates the private `review-photos` bucket and its policies)
3. **Authentication → URL Configuration**
   * *Site URL:* your deployed URL, e.g. `https://<user>.github.io/<repo>/`
   * *Redirect URLs:* add the same URL plus `http://localhost:5173/` for local development.
4. **Authentication → Providers → Email:** keep it enabled. For a small friend group you may turn
   *Confirm email* off so people can sign in immediately. If it stays on, note that Supabase's built-in
   mailer is heavily rate-limited; configure custom SMTP if you invite many people.
5. **Project Settings → API:** copy the *Project URL* and the **anon / publishable** key.

> The anon key is public by design. Your data is protected by Row Level Security, not by hiding that key.
> **Never** put the `service_role` / `sb_secret_…` key in this project. The app detects such a key and
> refuses to run with it.

## Run locally

```bash
npm install
cp .env.example .env.local        # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                       # http://localhost:5173
```

Sign up, create a group (you become its owner), copy the invite link from **Crew**, and open it in a
second browser profile with another account to try the shared flows.

## Deploy to GitHub Pages

1. Push this repository to GitHub (default branch `main`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions → Variables** → add repository *variables*
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Push to `main` (or run the workflow manually). [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs the unit tests,
   builds, and publishes `dist/`.
5. Make sure the deployed URL is in Supabase's redirect URLs (step 3 above).

Routing and paths: the app uses `HashRouter` and Vite `base: './'`, so it works unchanged at
`/<repo>/`, on a custom domain, or in a sub-folder, with no server rewrites. The build also emits
`404.html` and `.nojekyll`.

## Security model (short version)

* Every table has RLS; `anon` has no privileges at all.
* Membership checks use `SECURITY DEFINER` helpers (`is_group_member`, `is_group_owner`) to avoid policy recursion.
* There is no INSERT policy on `group_members`; people only get in through `join_group(code)` (validates expiry, revocation, max uses under a row lock) or `create_group()`.
* Child rows reference parents with composite keys `(id, group_id)`, so a row cannot point across groups even if a policy were wrong.
* Ownership columns (`author_id`, `created_by`, `group_id`, `item_id`) are frozen by triggers.
* The activity feed is written only by `SECURITY DEFINER` triggers.
* Photos live in a **private** bucket under `{group_id}/{user_id}/…`; storage policies check membership; the app uses 1-hour signed URLs.
* Profiles are visible only to yourself and people you share a group with.
* Plans are intentionally collaborative: any member can change a plan's status, date or RSVP list; only the creator or an owner can delete it. Tighten `plans_update` if you want otherwise.

## Testing

```bash
npm test            # unit tests (normalisation, parsing, key guard, formatting)
npm run test:db     # applies the migrations to a throwaway local Postgres and runs 66 RLS/dedupe/flow assertions
npm run test:e2e    # runs the app's real data layer against local Postgres + PostgREST (needs the PostgREST binary)
npm run build       # type-check + production build (+ 404.html, .nojekyll)
```

`test:db` and `test:e2e` use a tiny stand-in for Supabase's `auth`/`storage` schemas
(`supabase/tests/00_supabase_stub.sql`, local use only). They need PostgreSQL 15+ and, for e2e, the
[PostgREST](https://github.com/PostgREST/postgrest/releases) binary (`POSTGREST=/path/to/postgrest npm run test:e2e`).

## Project layout

```
supabase/migrations/   the four SQL migrations (schema, RLS, RPCs + views, storage)
supabase/tests/        SQL test suite + local Supabase stub
src/lib/               supabase client, typed API layer, hooks, normalisation, images
src/components/        poster tiles, item picker (dedupe), ratings, plans, comments, sheet…
src/pages/             auth, groups, feed, catalog, item, review editor, plans, lists, crew, profile
scripts/               postbuild (404.html), local e2e harness
```

## Known limitations and things to check in your own project

These are honest gaps rather than bugs I know of:

* **Not exercised against a live Supabase project or in a real browser.** The SQL (66 assertions), the data layer
  (real queries through PostgREST) and the build were verified; the React UI, Supabase Auth emails/PKCE redirects,
  and Storage uploads/signed URLs were not. Do a quick smoke test after deploying: sign up → create group →
  invite a second account → review a new item → upload a photo → plan something.
* The default Supabase mailer is rate-limited (a few emails per hour). Use custom SMTP, or disable email confirmation for a closed group.
* No movie/place lookup API (TMDB, Google Places) is integrated: items are entered by hand, with an optional external id/link used for dedupe. Adding a lookup would be a client-side call into the picker.
* No realtime subscriptions; data refreshes on navigation and window focus.
* `catalog_overview` computes aggregates with CTEs over the whole group. That is fine for friend-group scale (thousands of rows); materialise it if a group ever grows far beyond that.
* Photos are not deleted from Storage if a review is deleted by cascade (the rows go, the objects remain). A scheduled cleanup or a Storage-delete trigger via Edge Function would fix that.
* Fonts are self-hosted (Fontsource), so there are no third-party requests; the bundle is ~420 kB JS (120 kB gzipped).
