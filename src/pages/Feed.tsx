import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import { useGroup } from '../lib/group';
import { qk, useAction } from '../lib/hooks';
import { formatDateTime, timeAgo } from '../lib/format';
import type { ActivityRow, Review } from '../lib/types';
import { ReviewCard } from '../components/ReviewCard';
import { RefPoster } from '../components/Poster';
import { Avatar, Chip, Empty, ErrorNote, Loading } from '../components/ui';

const PAGE = 20;

function asReview(a: ActivityRow): Review | null {
  if (!a.review || !a.actor || !a.item) return null;
  return {
    id: a.review.id, group_id: '', item_id: a.item.id, author_id: a.actor.id, rating: Number(a.review.rating),
    body: a.review.body, tags: a.review.tags ?? [], visited_on: a.review.visited_on, created_at: a.created_at,
    author: { ...a.actor, bio: null }, photos: a.review.photos ?? [], item: a.item,
  };
}

export function FeedPage() {
  const { group, me } = useGroup();
  const feed = useInfiniteQuery({
    queryKey: qk.feed(group.id),
    queryFn: ({ pageParam }) => api.listActivity(group.id, pageParam, PAGE),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length : undefined),
  });
  const rows = feed.data?.pages.flat() ?? [];
  const reviewIds = rows.filter((r) => r.review).map((r) => r.review!.id);
  const counts = useQuery({
    queryKey: ['feed', 'counts', group.id, reviewIds.join(',')],
    queryFn: () => api.commentCounts(group.id, 'review_id', reviewIds),
    enabled: reviewIds.length > 0,
  });
  const delReview = useAction((id: string) => api.deleteReview(id), {
    invalidate: [qk.feed(group.id), qk.catalog(group.id)], success: 'Review deleted',
  });

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="display hero sm">What the crew has been up to</h1>
      </header>
      {feed.isLoading && <Loading />}
      {feed.error && <ErrorNote error={feed.error} />}
      {!feed.isLoading && rows.length <= 1 && rows.every((r) => r.verb === 'joined') && (
        <Empty title="Nothing logged yet" action={<Link className="btn" to={`/g/${group.id}/review/new`}>Write the first review</Link>}>
          Reviews, plans and new members show up here for everyone in {group.name}.
        </Empty>
      )}
      <div className="feed">
        {rows.map((a) => {
          const who = a.actor?.id === me ? 'You' : (a.actor?.display_name ?? 'Someone');
          if (a.verb === 'reviewed') {
            const r = asReview(a);
            if (!r) return null;
            return (
              <div key={a.id} className="feed-item">
                <p className="feed-meta"><span>{who} reviewed</span><time>{timeAgo(a.created_at)}</time></p>
                <ReviewCard review={{ ...r, group_id: group.id }} showItem commentCount={counts.data?.[r.id]} onDelete={(id) => confirm('Delete this review?') && delReview.mutate(id)} />
              </div>
            );
          }
          if (a.verb === 'joined') {
            return (
              <div key={a.id} className="feed-item feed-note">
                <Avatar profile={a.actor} size={28} />
                <p><strong>{who === 'You' ? 'You' : who}</strong> {who === 'You' ? 'are' : 'is'} in the group <time className="muted">{timeAgo(a.created_at)}</time></p>
              </div>
            );
          }
          return (
            <div key={a.id} className="feed-item">
              <p className="feed-meta">
                <span>{a.verb === 'completed' ? `${who} did it` : `${who} added a plan`}</span>
                <time>{timeAgo(a.created_at)}</time>
              </p>
              {a.item && (
                <Link to={a.verb === 'completed' ? `/g/${group.id}/catalog/${a.item.id}` : `/g/${group.id}/plans`} className="plan-note">
                  <RefPoster item={a.item} />
                  <div>
                    <p className="display">{a.item.name}</p>
                    <p className="muted">{[a.item.category?.name, a.item.location].filter(Boolean).join(' / ')}</p>
                    {a.verb === 'completed' ? <Chip tone="green">Done. Share what you thought</Chip>
                      : <Chip tone="green">{a.plan?.proposed_for ? formatDateTime(a.plan.proposed_for) : 'Someday'}</Chip>}
                  </div>
                </Link>
              )}
            </div>
          );
        })}
      </div>
      {feed.hasNextPage && (
        <button className="btn secondary block" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
          {feed.isFetchingNextPage ? 'Loading' : 'Show older'}
        </button>
      )}
      <p className="muted small-note">Only members of {group.name} can see this.</p>
    </div>
  );
}
