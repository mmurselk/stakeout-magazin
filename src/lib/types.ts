export type CategoryKind = 'screen' | 'place' | 'activity';
export type PlanStatus = 'wishlist' | 'proposed' | 'confirmed' | 'completed' | 'cancelled';
export type Response = 'in' | 'maybe' | 'out';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  bio?: string | null;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Membership {
  role: 'owner' | 'member';
  group: Group;
}

export interface Member {
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
  profile: Profile | null;
}

export interface Invite {
  id: string;
  code: string;
  created_at: string;
  expires_at: string;
  max_uses: number | null;
  uses: number;
  revoked_at: string | null;
}

export interface Category {
  id: string;
  group_id: string | null;
  slug: string;
  name: string;
  kind: CategoryKind;
  icon: string;
}

/** A row of the catalog_overview view: item + group aggregates. */
export interface CatalogItem {
  id: string;
  group_id: string;
  category_id: string;
  name: string;
  subtitle: string | null;
  year: number | null;
  location: string | null;
  address: string | null;
  external_ref: string | null;
  url: string | null;
  description: string | null;
  created_by: string;
  created_at: string;
  category_name: string;
  category_slug: string;
  category_kind: CategoryKind;
  category_icon: string;
  review_count: number;
  reviewer_count: number;
  avg_rating: number | null;
  last_visited_on: string | null;
  reviewer_ids: string[];
  tags: string[];
  open_plan_count: number;
  favorite_count: number;
  favorited_by: string[];
  cover_path: string | null;
}

export interface ItemRef {
  id: string;
  name: string;
  year: number | null;
  location: string | null;
  category: { name: string; kind: CategoryKind; icon: string } | null;
}

export interface Photo {
  id: string;
  storage_path: string;
}

export interface Review {
  id: string;
  group_id: string;
  item_id: string;
  author_id: string;
  rating: number;
  body: string | null;
  tags: string[];
  visited_on: string;
  created_at: string;
  author: Profile | null;
  photos: Photo[];
  item?: ItemRef | null;
}

export interface Comment {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: Profile | null;
}

export interface ActivityRow {
  id: string;
  verb: 'reviewed' | 'planned' | 'completed' | 'joined';
  created_at: string;
  actor: Profile | null;
  item: ItemRef | null;
  review: { id: string; rating: number; body: string | null; visited_on: string; tags: string[]; photos: Photo[] } | null;
  plan: { id: string; status: PlanStatus; proposed_for: string | null } | null;
}

export interface DateOption {
  id: string;
  starts_at: string;
  suggested_by: string;
  votes: { user_id: string }[];
}

export interface Plan {
  id: string;
  group_id: string;
  item_id: string;
  status: PlanStatus;
  notes: string | null;
  proposed_for: string | null;
  created_by: string;
  created_at: string;
  completed_at: string | null;
  item: ItemRef | null;
  creator: Profile | null;
  responses: { user_id: string; response: Response }[];
  options: DateOption[];
}

export interface ListRow {
  id: string;
  title: string;
  description: string | null;
  is_collaborative: boolean;
  owner_id: string;
  created_at: string;
  owner: Profile | null;
  list_items: { item_id: string }[];
}

export interface ListEntry {
  item_id: string;
  note: string | null;
  added_by: string;
  added_at: string;
  item: ItemRef | null;
}

/** What the picker hands to create_review / create_plan when nothing existing matches. */
export interface NewItemInput {
  category_id: string;
  name: string;
  year?: number | null;
  location?: string | null;
  subtitle?: string | null;
  address?: string | null;
  external_ref?: string | null;
  url?: string | null;
  description?: string | null;
}

export interface SimilarItem {
  id: string;
  name: string;
  year: number | null;
  location: string | null;
  subtitle: string | null;
  category_id: string;
  category_name: string;
  similarity: number;
}

export interface CatalogFilters {
  q: string;
  categoryId: string;
  minRating: number;
  tags: string[];
  memberId: string;
  status: 'all' | 'visited' | 'planned' | 'unvisited';
  favoritesOf: string; // user id; '' = off
  sort: 'recent' | 'rating' | 'name' | 'added';
}
