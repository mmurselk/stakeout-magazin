import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate } from '../lib/format';
import { useGroup } from '../lib/group';
import { useSignedUrls } from '../lib/hooks';
import type { Review } from '../lib/types';
import { Comments } from './Comments';
import { Stars } from './StarRating';
import { Avatar, Chip, Icon } from './ui';

export function ReviewCard({ review, showItem, onDelete, commentCount }: {
  review: Review; showItem?: boolean; onDelete?(id: string): void; commentCount?: number;
}) {
  const { group, me, people } = useGroup();
  const [open, setOpen] = useState(false);
  const urls = useSignedUrls(review.photos.map((p) => p.storage_path));
  const author = review.author ?? people[review.author_id] ?? null;
  const mine = review.author_id === me;
  return (
    <article className="review">
      <header className="review-head">
        <Link to={`/g/${group.id}/people/${review.author_id}`} className="who">
          <Avatar profile={author} size={34} />
          <span><strong>{author?.display_name ?? 'Former member'}</strong><small className="muted">visited {formatDate(review.visited_on)}</small></span>
        </Link>
        <Stars value={review.rating} size={15} />
      </header>
      {showItem && review.item && (
        <Link className="review-item display" to={`/g/${group.id}/catalog/${review.item.id}`}>
          {review.item.name}{review.item.year ? <small> {review.item.year}</small> : null}
        </Link>
      )}
      {review.body && <p className="review-body">{review.body}</p>}
      {review.photos.length > 0 && (
        <div className="photo-strip">
          {review.photos.map((p) => urls[p.storage_path] ? <img key={p.id} src={urls[p.storage_path]} alt="" loading="lazy" /> : <span key={p.id} className="thumb-ph" />)}
        </div>
      )}
      {review.tags.length > 0 && <div className="chips">{review.tags.map((t) => <Chip key={t}>{t}</Chip>)}</div>}
      <footer className="review-foot">
        <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Icon name="comment" size={16} /> {open ? 'Hide comments' : commentCount ? `${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}` : 'Comment'}
        </button>
        {mine && (
          <span className="row-gap">
            <Link className="link-btn" to={`/g/${group.id}/review/${review.id}/edit`}><Icon name="edit" size={16} /> Edit</Link>
            {onDelete && <button type="button" className="link-btn danger" onClick={() => onDelete(review.id)}><Icon name="trash" size={16} /> Delete</button>}
          </span>
        )}
      </footer>
      {open && <Comments target={{ review_id: review.id }} />}
    </article>
  );
}
