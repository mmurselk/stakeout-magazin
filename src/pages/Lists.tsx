import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import { useGroup } from '../lib/group';
import { qk, useAction } from '../lib/hooks';
import { Chip, Empty, ErrorNote, Field, Icon, Loading, Sheet } from '../components/ui';
import { RefPoster } from '../components/Poster';

export function ListsPage() {
  const { group, me } = useGroup();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [collab, setCollab] = useState(false);
  const q = useQuery({ queryKey: qk.lists(group.id), queryFn: () => api.listLists(group.id) });
  const create = useAction(() => api.createList(group.id, me, title, desc, collab), {
    invalidate: [qk.lists(group.id)], success: 'List created',
    onSuccess: (r) => { setOpen(false); setTitle(''); setDesc(''); nav(`/g/${group.id}/lists/${r.id}`); },
  });
  return (
    <div className="page">
      <header className="page-head">
        <h1 className="display hero sm">Lists</h1>
        <button className="btn" onClick={() => setOpen(true)}><Icon name="plus" size={18} /> New list</button>
      </header>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data?.length === 0 && <Empty title="No lists yet">Collect favourites, a rainy-day shortlist or the places for your next trip.</Empty>}
      <ul className="group-list">
        {q.data?.map((l) => (
          <li key={l.id}>
            <Link to={`/g/${group.id}/lists/${l.id}`} className="group-card">
              <span className="display">{l.title}</span>
              <span className="muted">{l.list_items.length} {l.list_items.length === 1 ? 'item' : 'items'} by {l.owner_id === me ? 'you' : l.owner?.display_name ?? 'a former member'}{l.is_collaborative ? ', everyone can add' : ''}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Sheet open={open} onClose={() => setOpen(false)} title="New list">
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (title.trim()) create.mutate(undefined); }}>
          <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required placeholder="Rainy Sunday" /></Field>
          <Field label="Description (optional)"><input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} /></Field>
          <Chip active={collab} onClick={() => setCollab(!collab)}>{collab ? 'Everyone can add items' : 'Only I can add items'}</Chip>
          <button className="btn block" disabled={!title.trim() || create.isPending}>Create list</button>
        </form>
      </Sheet>
    </div>
  );
}

export function ListPage() {
  const { listId = '' } = useParams();
  const { group, me } = useGroup();
  const nav = useNavigate();
  const [term, setTerm] = useState('');
  const list = useQuery({ queryKey: qk.list(listId), queryFn: () => api.getList(listId) });
  const entries = useQuery({ queryKey: qk.listEntries(listId), queryFn: () => api.listEntries(listId) });
  const found = useQuery({
    queryKey: ['listSearch', group.id, term],
    queryFn: () => api.searchCatalog(group.id, { q: term, categoryId: '', minRating: 0, tags: [], memberId: '', status: 'all', favoritesOf: '', sort: 'name' }),
    enabled: term.trim().length >= 2,
  });
  const l = list.data;
  const canAdd = !!l && (l.owner_id === me || l.is_collaborative);
  const inList = new Set(entries.data?.map((e) => e.item_id));
  const keys = [qk.listEntries(listId), qk.list(listId), qk.lists(group.id)];
  const add = useAction((id: string) => api.addToList(group.id, listId, id, me), { invalidate: keys });
  const remove = useAction((id: string) => api.removeFromList(listId, id), { invalidate: keys });
  const del = useAction(() => api.deleteList(listId), { invalidate: [qk.lists(group.id)], success: 'List deleted', onSuccess: () => nav(`/g/${group.id}/lists`, { replace: true }) });

  if (list.isLoading) return <Loading />;
  if (!l) return <div className="page narrow"><Empty title="List not found" action={<Link className="btn" to={`/g/${group.id}/lists`}>All lists</Link>}>It may have been deleted.</Empty></div>;
  return (
    <div className="page">
      <header className="page-head">
        <div><h1 className="display hero sm">{l.title}</h1>{l.description && <p className="muted">{l.description}</p>}</div>
        {l.owner_id === me && <button className="link-btn danger" onClick={() => confirm('Delete this list?') && del.mutate(undefined)}><Icon name="trash" size={16} /> Delete</button>}
      </header>
      {canAdd && (
        <div className="panel">
          <Field label="Add from the catalog"><input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name" /></Field>
          {found.data?.slice(0, 6).map((i) => (
            <button key={i.id} className="match" disabled={inList.has(i.id)} onClick={() => add.mutate(i.id)}>
              <span className="match-name display">{i.name}{i.year ? <small> {i.year}</small> : null}</span>
              <span className="muted">{inList.has(i.id) ? 'Already here' : i.category_name}</span>
            </button>
          ))}
        </div>
      )}
      {entries.isLoading && <Loading />}
      {entries.data?.length === 0 && <Empty title="Nothing on this list yet">Search the catalog above, or add items from their pages.</Empty>}
      <div className="stack">
        {entries.data?.map((e) => e.item && (
          <div key={e.item_id} className="list-row">
            <Link to={`/g/${group.id}/catalog/${e.item.id}`}><RefPoster item={e.item} /></Link>
            <div>
              <Link className="display" to={`/g/${group.id}/catalog/${e.item.id}`}>{e.item.name}</Link>
              <p className="muted">{[e.item.category?.name, e.item.year, e.item.location].filter(Boolean).join(' / ')}</p>
            </div>
            {(e.added_by === me || l.owner_id === me) && <button className="icon-btn subtle" aria-label={`Remove ${e.item.name}`} onClick={() => remove.mutate(e.item_id)}><Icon name="x" size={18} /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}
