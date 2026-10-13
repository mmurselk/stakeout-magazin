# Stakeout: architecture

A private, invite-only app for a friend group to log, rate, remember and plan shared
experiences (films, cafés, restaurants, parks, courts, hobby spots, anything custom).

## 1. System shape

```
Browser (React + TS, Vite SPA)             Supabase (managed)
┌──────────────────────────────┐   HTTPS   ┌──────────────────────────────────┐
│ HashRouter  (Pages-safe)     │──────────▶│ Auth (email + password, PKCE)    │
│ TanStack Query cache         │           │ PostgREST  ← Row Level Security  │
│ supabase-js (anon key only)  │           │ Postgres: tables, views, RPCs    │
│ client-side image resize     │           │ Storage: private `review-photos` │
└──────────────────────────────┘           └──────────────────────────────────┘
        ▲ static files
GitHub Pages  ◀── GitHub Actions (build + deploy)
```

* **No custom server.** All authorization is enforced in Postgres via RLS. The browser
  only ever holds the public `anon` key plus the signed-in user's JWT.
* **The service-role key is never used.** It does not appear in the source, the build
  environment, or the workflow. See the README security notes.
* **Routing** uses `HashRouter`, so deep links work on GitHub Pages without server
  rewrites. Vite `base` is `./`, so the same build works at `/<repo>/` or on a custom domain.
* **Auth redirects** use the PKCE flow (`?code=` in the query string) so Supabase email
  links do not collide with hash routing.
* **Persistence** is Postgres only. `localStorage` is used for exactly one UI preference
  (the last-opened group id) and for the Supabase session token, which supabase-js
  manages itself.

## 2. Data model

All user references point at `profiles(id)` (which mirrors `auth.users`), so PostgREST
can embed author information in one request.

```
profiles ─┐
          ├─< group_members >─ groups ─< group_invites
          │                      │
          │                      ├─< categories (custom; defaults have group_id NULL)
          │                      ├─< catalog_items ──< reviews ──< review_photos
          │                      │        │              └──< comments
          │                      │        ├──< favorites
          │                      │        ├──< plans ──< plan_responses
          │                      │        │        ├──< plan_date_options ──< plan_date_votes
          │                      │        │        └──< comments
          │                      │        └──< list_items >── lists
          │                      └─< activity (written by triggers only)
```

### Tenant isolation by composite foreign keys

Every group-scoped row carries `group_id`. Child tables reference their parent with a
composite key, e.g. `reviews (item_id, group_id) → catalog_items (id, group_id)`. A
review therefore *cannot* point at an item from another group, even if a policy is
mis-written. RLS checks `is_group_member(group_id)` without any joins.

### Catalog and deduplication

* `catalog_items.normalized_name` is computed by a trigger from `normalize_name()`:
  lowercase, accent-stripped, `&`→`and`, punctuation collapsed, leading *the/a/an* removed.
* Hard uniqueness (DB-enforced, race-safe):
  1. `(group_id, category_id, normalized_name, coalesce(year,0), normalized_location)`
  2. `(group_id, external_ref)` where `external_ref` is set (IMDb id, map URL, …)
* Soft matching (UI): `find_similar_items()` uses `pg_trgm` similarity so the picker
  offers "Did you mean…" before a new entry is created.
* `resolve_catalog_item()` is the single write path: external id → exact identity →
  insert, with `ON CONFLICT DO NOTHING` + re-select so two people adding the same
  place at once end up with one row.
* `create_review()` and `create_plan()` call the resolver **in the same transaction** as
  the review/plan insert. A review can never exist without a catalog item, and a new item
  is immediately visible to the whole group.

### Shared but personal reviews

`reviews` is unique on `(item_id, author_id, visited_on)`: you can revisit and log a new
visit, but nobody can overwrite another member's opinion (RLS: update/delete only by the
author). The `catalog_overview` view computes the **group rating as the mean of each
member's most recent review** so one enthusiastic reviewer cannot dominate by logging
many visits.

### Planning

`plans.status`: `wishlist → proposed → confirmed → completed` (or `cancelled`).
Members answer in / maybe / out (`plan_responses`), suggest alternative dates
(`plan_date_options`) and vote on them (`plan_date_votes`). Locking a date copies it to
`plans.proposed_for` and confirms the plan. Completing a plan stamps `completed_at`,
posts to the feed, and offers to write the review.

## 3. Security model

| Concern | Mechanism |
| --- | --- |
| Only members read group data | RLS on every table; `is_group_member()` (SECURITY DEFINER, avoids policy recursion) |
| Invite-only | No INSERT policy on `group_members`; joining is only through `join_group(code)` which validates expiry, revocation and max uses under a row lock |
| Group creation | `create_group()` RPC creates group + owner membership atomically |
| Authors own their words | Update/delete policies on `reviews`, `comments`, `favorites` require `author_id = auth.uid()` |
| Immutable ownership | `forbid_column_change` triggers freeze `group_id`, `author_id`, `created_by`, `item_id` |
| Feed integrity | `activity` has no write policies; SECURITY DEFINER triggers are the only writer |
| Photos | Private bucket; object path `{group_id}/{user_id}/{file}`; storage RLS checks group membership (read) and own folder (write/delete); app uses short-lived signed URLs |
| Profiles | Visible only to yourself and people who share a group with you |
| Anonymous access | All privileges revoked from `anon` |

## 4. Frontend structure

```
src/
  lib/        supabase client, typed API layer, React Query hooks, normalisation, images
  components/ AppShell, StarRating, PosterTile, ItemPicker (dedupe), Sheet, Comments…
  pages/      Login, Groups, Join, Feed, Catalog, ItemDetail, ReviewEditor, Plans,
              Lists, Members, Profile
  styles/     tokens + base + components (plain CSS, no framework)
```

Mobile-first: bottom tab bar under 900 px, side rail above. Server-side filtering (category,
min rating, tags, reviewer, visited/planned) runs against the `catalog_overview` view
through PostgREST, so filters scale with the data.

## 5. Visual direction

Near-black ink with cold steel and desaturated blue for surfaces and text, blood red
reserved for ratings and the primary brand moments, and Riddler acid green for
focus, interactive states and anything about *planning*. Rain and film grain are
CSS-only, static-friendly and disabled under `prefers-reduced-motion`. Catalog entries get
generated typographic "poster tiles" (no copyrighted artwork), or the latest review photo
when one exists. Fonts are self-hosted via Fontsource (no third-party requests).

## 6. Milestones

1. **Foundation**: schema, RLS, RPCs, storage policies, SQL test suite against real Postgres.
2. **Access**: auth, onboarding, group creation, invite codes, join flow, member management.
3. **Catalog + reviews**: picker with dedupe, review editor with photos, item detail with group view.
4. **Planning**: wishlist/plans, date options + votes, completion → review.
5. **Social**: feed, comments, favorites, lists, profiles, history.
6. **Ship**: Pages workflow, base-path handling, production build verification, README.
