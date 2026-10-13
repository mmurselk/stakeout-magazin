import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import { useAuth } from '../lib/auth';
import { useGroup } from '../lib/group';
import { qk, useAction, useSignedUrls } from '../lib/hooks';
import { formatRating } from '../lib/format';
import { PosterTile } from '../components/Poster';
import { ReviewCard } from '../components/ReviewCard';
import { Avatar, Empty, Field, Icon, Loading, Segmented } from '../components/ui';
import type { CatalogFilters } from '../lib/types';

export function ProfilePage() {
  const { userId = '' } = useParams();
  const { group, me, people } = useGroup();
  const { profile: myProfile, signOut, refreshProfile } = useAuth();
  const isMe = userId === me;
  const person = isMe ? (myProfile ?? people[me]) : people[userId];
  const [tab, setTab] = useState<'history' | 'favorites'>('history');
  const [editing, setEditing] = useState(false);
  const [dn, setDn] = useState(myProfile?.display_name ?? '');
  const [bio, setBio] = useState(myProfile?.bio ?? '');

  const reviews = useQuery({ queryKey: qk.userReviews(group.id, userId), queryFn: () => api.listUserReviews(group.id, userId) });
  const favFilters: CatalogFilters = { q: '', categoryId: '', minRating: 0, tags: [], memberId: '', status: 'all', favoritesOf: userId, sort: 'name' };
  const favs = useQuery({ queryKey: [...qk.catalog(group.id), 'fav', userId], queryFn: () => api.searchCatalog(group.id, favFilters), enabled: tab === 'favorites' });
  const covers = useSignedUrls(favs.data?.map((i) => i.cover_path) ?? []);
  const save = useAction(() => api.updateProfile(me, { display_name: dn.trim(), bio: bio.trim() || null }), {
    success: 'Profile saved', invalidate: [qk.members(group.id)], onSuccess: async () => { await refreshProfile(); setEditing(false); },
  });
  const del = useAction((id: string) => api.deleteReview(id), { invalidate: [qk.userReviews(group.id, userId), qk.catalog(group.id), qk.feed(group.id)], success: 'Review deleted' });

  const stats = useMemo(() => {
    const r = reviews.data ?? [];
    const avg = r.length ? r.reduce((s, x) => s + Number(x.rating), 0) / r.length : null;
    return { count: r.length, avg, places: new Set(r.map((x) => x.item_id)).size };
  }, [reviews.data]);

  // History grouped by month, newest first.
  const byMonth = useMemo(() => {
    const m = new Map<string, NonNullable<typeof reviews.data>>();
    for (const r of reviews.data ?? []) {
      const k = new Date(r.visited_on + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [reviews.data]);

  if (!person) return <div className="page narrow"><Empty title="Not in this group" action={<Link className="btn" to={`/g/${group.id}/crew`}>See the crew</Link>}>That person is not a member of {group.name}.</Empty></div>;

  return (
    <div className="page">
      <header className="profile-head">
        <Avatar profile={person} size={72} />
        <div>
          <h1 className="display hero sm">{person.display_name}</h1>
          <p className="muted">@{person.username}</p>
          {person.bio && !editing && <p className="bio">{person.bio}</p>}
        </div>
      </header>

      <dl className="stats">
        <div><dt>Reviews</dt><dd className="display">{stats.count}</dd></div>
        <div><dt>Places and films</dt><dd className="display">{stats.places}</dd></div>
        <div><dt>Average rating</dt><dd className="display">{formatRating(stats.avg)}</dd></div>
      </dl>

      {isMe && (
        <div className="action-row">
          <button className="btn secondary" onClick={() => { setDn(person.display_name); setBio(person.bio ?? ''); setEditing((v) => !v); }}><Icon name="edit" size={18} /> Edit profile</button>
          <Link className="btn ghost" to={`/g/${group.id}/lists`}><Icon name="list" size={18} /> Lists</Link>
          <Link className="btn ghost" to={`/g/${group.id}/crew`}><Icon name="users" size={18} /> Crew</Link>
          <button className="btn ghost" onClick={() => signOut()}><Icon name="logout" size={18} /> Sign out</button>
        </div>
      )}
      {isMe && editing && (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); if (dn.trim()) save.mutate(undefined); }}>
          <Field label="Display name"><input value={dn} onChange={(e) => setDn(e.target.value)} maxLength={60} required /></Field>
          <Field label="Bio"><textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} /></Field>
          <button className="btn" disabled={save.isPending}>Save</button>
        </form>
      )}

      <Segmented<'history' | 'favorites'> label="Profile section" value={tab} onChange={setTab} options={[{ value: 'history', label: 'History' }, { value: 'favorites', label: 'Favourites' }]} />

      {tab === 'history' && (
        <>
          {reviews.isLoading && <Loading />}
          {reviews.data?.length === 0 && <Empty title="No visits logged yet">{isMe ? 'Your reviews build a timeline of everywhere you have been.' : 'Nothing here yet.'}</Empty>}
          {byMonth.map(([month, list]) => (
            <section key={month} className="month">
              <h2 className="display month-title">{month}</h2>
              <div className="stack">
                {list.map((r) => <ReviewCard key={r.id} review={{ ...r, author: r.author ?? person }} showItem onDelete={(id) => confirm('Delete this review?') && del.mutate(id)} />)}
              </div>
            </section>
          ))}
        </>
      )}
      {tab === 'favorites' && (
        <>
          {favs.isLoading && <Loading />}
          {favs.data?.length === 0 && <Empty title="No favourites yet">Tap “Favourite it” on any catalog entry.</Empty>}
          <div className="poster-grid">
            {favs.data?.map((i) => <PosterTile key={i.id} item={i} coverUrl={i.cover_path ? covers[i.cover_path] : undefined} to={`/g/${group.id}/catalog/${i.id}`} />)}
          </div>
        </>
      )}
    </div>
  );
}
