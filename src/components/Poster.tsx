import { Link } from 'react-router-dom';
import { hashTo, formatRating } from '../lib/format';
import type { CatalogItem, ItemRef } from '../lib/types';
import { Icon } from './ui';

type PosterSource = Pick<CatalogItem, 'id' | 'name' | 'year' | 'location' | 'category_icon' | 'avg_rating' | 'open_plan_count' | 'favorite_count'>;

/**
 * Generated typographic poster. No artwork is used or copied: the composition is derived from the
 * title, and the red light bleeding in from below gets stronger the higher the group rates it.
 * With a photo (from a review) the photo is used instead, under the same lighting.
 */
export function PosterTile({ item, coverUrl, compact, to }: {
  item: PosterSource; coverUrl?: string; compact?: boolean; to?: string;
}) {
  const variant = hashTo(item.id + item.name, 4);
  const heat = item.avg_rating == null ? 0.08 : 0.14 + (item.avg_rating / 5) * 0.5;
  const len = item.name.length;
  const size = len <= 8 ? 'xl' : len <= 16 ? 'l' : len <= 28 ? 'm' : 's';
  const body = (
    <div className={`poster v${variant}${compact ? ' poster-compact' : ''}${coverUrl ? ' has-cover' : ''}`} style={{ ['--heat' as string]: heat }}>
      {coverUrl && <img src={coverUrl} alt="" loading="lazy" />}
      <span className="poster-glow" aria-hidden="true" />
      <span className="poster-cat"><Icon name={item.category_icon} size={compact ? 14 : 16} /></span>
      {item.open_plan_count > 0 && <span className="poster-plan" title="Planned">planned</span>}
      <span className={`poster-title t-${size}`}>{item.name}</span>
      <span className="poster-foot">
        <span className="poster-sub">{[item.year, item.location].filter(Boolean).join(' / ') || '\u00a0'}</span>
        {item.avg_rating != null && <span className="poster-score">{formatRating(item.avg_rating)}</span>}
      </span>
    </div>
  );
  return to ? <Link to={to} className="poster-link" aria-label={item.name}>{body}</Link> : body;
}

/** Poster for an ItemRef (feed, plans) where no aggregates are loaded. */
export function RefPoster({ item, coverUrl }: { item: ItemRef; coverUrl?: string }) {
  return (
    <PosterTile
      compact
      coverUrl={coverUrl}
      item={{
        id: item.id, name: item.name, year: item.year, location: item.location,
        category_icon: item.category?.icon ?? 'spark', avg_rating: null, open_plan_count: 0, favorite_count: 0,
      }}
    />
  );
}
