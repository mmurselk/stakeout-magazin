import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import { useGroup } from '../lib/group';
import { qk, useAction, useSignedUrls } from '../lib/hooks';
import { formatDate } from '../lib/format';
import { Comments } from '../components/Comments';
import { PlanCard } from '../components/PlanCard';
import { PlanFormSheet } from '../components/PlanForm';
import { PosterTile } from '../components/Poster';
import { ReviewCard } from '../components/ReviewCard';
import { Score, Stars } from '../components/StarRating';
import { Avatar, Chip, Empty, ErrorNote, Field, Icon, Loading, Sheet } from '../components/ui';

export function ItemPage() {
  const { itemId = '' } = useParams();
  const { group, me, isOwner, members, people } = useGroup();
  const nav = useNavigate();
  const [planOpen, setPlanOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const item = useQuery({ queryKey: qk.item(itemId), queryFn: () => api.getItem(itemId) });
  const reviews = useQuery({ queryKey: qk.itemReviews(itemId), queryFn: () => api.listItemReviews(itemId) });
  const plans = useQuery({ queryKey: qk.itemPlans(itemId), queryFn: () => api.listItemPlans(itemId) });
  const lists = useQuery({ queryKey: qk.lists(group.id), queryFn: () => api.listLists(group.id), enabled: listOpen });
  const cover = useSignedUrls([item.data?.cover_path]);

  const refresh = [qk.item(itemId), qk.catalog(group.id)];
  const fav = useAction((on: boolean) => api.setFavorite(group.id, itemId, me, on), { invalidate: refresh });
  const delReview = useAction((id: string) => api.deleteReview(id), { invalidate: [...refresh, qk.itemReviews(itemId), qk.feed(group.id)], success: 'Review deleted' });
  const addList = useAction((listId: string) => api.addToList(group.id, listId, itemId, me), { invalidate: [qk.lists(group.id), ['listEntries']], success: 'Added to list', onSuccess: () => setListOpen(false) });
  const delItem = useAction(() => api.deleteItem(itemId), {
    invalidate: [qk.catalog(group.id), qk.feed(group.id), qk.plans(group.id)], success: 'Removed from the catalog',
    onSuccess: () => nav(`/g/${group.id}/catalog`, { replace: true }),
  });

  if (item.isLoading) return <Loading />;
  if (item.error) return <div className="page"><ErrorNote error={item.error} /></div>;
  const it = item.data;
  if (!it) return <div className="page narrow"><Empty title="Not found" action={<Link className="btn" to={`/g/${group.id}/catalog`}>Back to the catalog</Link>}>This entry does not exist in {group.name}.</Empty></div>;

  const isFav = it.favorited_by.includes(me);
  const canEdit = it.created_by === me || isOwner;
  // each member's most recent review is their current opinion
  const latest = new Map<string, NonNullable<typeof reviews.data>[number]>();
  for (const r of reviews.data ?? []) if (!latest.has(r.author_id)) latest.set(r.author_id, r);
  const hasReviewed = latest.has(me);
  const openPlans = (plans.data ?? []).filter((p) => p.status !== 'cancelled');

  return (
    <div className="page item-page">
      <section className="item-hero">
        <div className="item-poster"><PosterTile item={it} coverUrl={it.cover_path ? cover[it.cover_path] : undefined} /></div>
        <div className="item-info">
          <p className="muted"><Icon name={it.category_icon} size={16} /> {it.category_name}</p>
          <h1 className="display hero sm">{it.name}</h1>
          <p className="muted">{[it.year, it.subtitle, it.location].filter(Boolean).join(' / ')}</p>
          {it.address && <p className="muted"><Icon name="pin" size={15} /> {it.address}</p>}
          {it.url && /^https?:\/\//i.test(it.url) && <a className="link-btn" href={it.url} target="_blank" rel="noopener noreferrer"><Icon name="link" size={15} /> Website</a>}
          {it.description && <p className="item-desc">{it.description}</p>}
          <div className="chips">{it.tags.slice(0, 8).map((t) => <Chip key={t}>{t}</Chip>)}</div>
        </div>
      </section>

      <div className="action-row">
        <Link className="btn" to={`/g/${group.id}/review/new?item=${it.id}`}>{hasReviewed ? 'Log another visit' : 'Write a review'}</Link>
        <button className="btn secondary" onClick={() => setPlanOpen(true)}><Icon name="plans" size={18} /> Plan it</button>
        <button className={`btn ghost${isFav ? ' on' : ''}`} aria-pressed={isFav} onClick={() => fav.mutate(!isFav)}><Icon name="heart" size={18} /> {isFav ? 'Favourite' : 'Favourite it'}</button>
        <button className="btn ghost" onClick={() => setListOpen(true)}><Icon name="list" size={18} /> Add to list</button>
      </div>

      <section className="panel group-view">
        <h2 className="display">The group’s verdict</h2>
        <Score value={it.avg_rating} count={it.reviewer_count} big />
        <ul className="voices">
          {members.map((m) => {
            const r = latest.get(m.user_id);
            return (
              <li key={m.user_id} className={r ? '' : 'pending'}>
                <Avatar profile={m.profile} size={28} />
                <span className="voice-name">{m.user_id === me ? 'You' : m.profile?.display_name}</span>
                {r ? (
                  <>
                    <span className="voice-bar" aria-hidden="true"><i style={{ width: `${(Number(r.rating) / 5) * 100}%` }} /></span>
                    <Stars value={Number(r.rating)} size={14} />
                  </>
                ) : <span className="muted">Not yet</span>}
              </li>
            );
          })}
        </ul>
        {it.last_visited_on && <p className="muted small-note">Last visited {formatDate(it.last_visited_on)}</p>}
      </section>

      {openPlans.length > 0 && (
        <section>
          <h2 className="display">Plans</h2>
          <div className="stack">{openPlans.map((p) => <PlanCard key={p.id} plan={p} />)}</div>
        </section>
      )}

      <section>
        <h2 className="display">Reviews</h2>
        {reviews.isLoading && <Loading />}
        {reviews.data?.length === 0 && <Empty title="No one has reviewed this yet">Be the first to put a rating on it.</Empty>}
        <div className="stack">
          {reviews.data?.map((r) => <ReviewCard key={r.id} review={{ ...r, author: r.author ?? people[r.author_id] ?? null }} onDelete={(id) => confirm('Delete this review?') && delReview.mutate(id)} />)}
        </div>
      </section>

      <section>
        <h2 className="display">Discussion</h2>
        <Comments target={{ item_id: it.id }} placeholder="Say something about this one" />
      </section>

      {canEdit && (
        <div className="action-row subtle-row">
          <button className="link-btn" onClick={() => setEditOpen(true)}><Icon name="edit" size={16} /> Edit details</button>
          {isOwner && <button className="link-btn danger" onClick={() => confirm('Delete this entry and everyone’s reviews of it?') && delItem.mutate(undefined)}><Icon name="trash" size={16} /> Delete entry</button>}
        </div>
      )}

      <PlanFormSheet key={`plan-${planOpen}`} open={planOpen} onClose={() => setPlanOpen(false)}
        preset={{ kind: 'existing', item: { id: it.id, name: it.name, year: it.year, location: it.location, category_name: it.category_name } }} />

      <Sheet open={listOpen} onClose={() => setListOpen(false)} title="Add to a list">
        {lists.isLoading && <Loading />}
        {lists.data?.length === 0 && <p className="muted">No lists yet. <Link to={`/g/${group.id}/lists`}>Create one</Link>.</p>}
        <div className="stack">
          {lists.data?.filter((l) => l.owner_id === me || l.is_collaborative).map((l) => (
            <button key={l.id} className="match" onClick={() => addList.mutate(l.id)} disabled={l.list_items.some((x) => x.item_id === it.id)}>
              <span className="match-name display">{l.title}</span>
              <span className="muted">{l.list_items.some((x) => x.item_id === it.id) ? 'Already on this list' : `${l.list_items.length} items`}</span>
            </button>
          ))}
        </div>
      </Sheet>

      <EditItemSheet key={editOpen ? 'open' : 'closed'} open={editOpen} onClose={() => setEditOpen(false)} item={it} />
    </div>
  );
}

function EditItemSheet({ open, onClose, item }: { open: boolean; onClose(): void; item: NonNullable<Awaited<ReturnType<typeof api.getItem>>> }) {
  const { group } = useGroup();
  const [v, setV] = useState({
    name: item.name, subtitle: item.subtitle ?? '', year: item.year ? String(item.year) : '', location: item.location ?? '',
    address: item.address ?? '', url: item.url ?? '', description: item.description ?? '',
  });
  const save = useAction(
    () => api.updateItem(item.id, {
      name: v.name, subtitle: v.subtitle || null, year: v.year ? Number(v.year) : null, location: v.location || null,
      address: v.address || null, url: v.url || null, description: v.description || null,
    }),
    { invalidate: [qk.item(item.id), qk.catalog(group.id), qk.feed(group.id), qk.plans(group.id)], success: 'Details saved', onSuccess: onClose },
  );
  const f = (k: keyof typeof v) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value }) });
  return (
    <Sheet open={open} onClose={onClose} title="Edit details">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <Field label="Name"><input {...f('name')} required maxLength={160} /></Field>
        <div className="grid-2">
          <Field label="Year"><input {...f('year')} inputMode="numeric" /></Field>
          <Field label="Area or city"><input {...f('location')} /></Field>
        </div>
        <Field label="Director, cuisine or tagline"><input {...f('subtitle')} /></Field>
        <Field label="Address"><input {...f('address')} /></Field>
        <Field label="Website"><input {...f('url')} type="url" placeholder="https://" /></Field>
        <Field label="Description"><textarea {...f('description')} rows={3} maxLength={1000} /></Field>
        <button className="btn block" disabled={save.isPending || !v.name.trim()}>Save details</button>
      </form>
    </Sheet>
  );
}
