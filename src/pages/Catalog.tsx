import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import { useGroup } from '../lib/group';
import { qk, useSignedUrls } from '../lib/hooks';
import type { CatalogFilters } from '../lib/types';
import { PosterTile } from '../components/Poster';
import { Chip, Empty, ErrorNote, Icon, Loading, Segmented, Sheet } from '../components/ui';

export const DEFAULT_FILTERS: CatalogFilters = {
  q: '', categoryId: '', minRating: 0, tags: [], memberId: '', status: 'all', favoritesOf: '', sort: 'recent',
};

export function CatalogPage() {
  const { group, categories, members, me } = useGroup();
  const [f, setF] = useState<CatalogFilters>(DEFAULT_FILTERS);
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<CatalogFilters>) => setF((x) => ({ ...x, ...patch }));

  const activeCount = [f.categoryId, f.minRating > 0, f.tags.length, f.memberId, f.status !== 'all', f.favoritesOf].filter(Boolean).length;
  const isDefault = activeCount === 0 && !f.q.trim() && f.sort === 'recent';

  const all = useQuery({ queryKey: [...qk.catalog(group.id), 'all'], queryFn: () => api.searchCatalog(group.id, DEFAULT_FILTERS) });
  const filtered = useQuery({
    queryKey: [...qk.catalog(group.id), JSON.stringify(f)],
    queryFn: () => api.searchCatalog(group.id, f),
    enabled: !isDefault,
    placeholderData: keepPreviousData,
  });
  const items = (isDefault ? all.data : filtered.data) ?? [];
  const loading = isDefault ? all.isLoading : filtered.isLoading;
  const covers = useSignedUrls(items.map((i) => i.cover_path));
  const allTags = useMemo(() => [...new Set((all.data ?? []).flatMap((i) => i.tags))].sort(), [all.data]);

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="display hero sm">Catalog</h1>
        <span className="muted">{all.data ? `${all.data.length} in ${group.name}` : ''}</span>
      </header>

      <div className="searchbar">
        <Icon name="search" size={20} />
        <input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search names, places, directors" aria-label="Search the catalog" />
        <button type="button" className={`btn ghost small${activeCount ? ' has-filters' : ''}`} onClick={() => setOpen(true)}>
          <Icon name="filter" size={18} /> Filters{activeCount ? ` (${activeCount})` : ''}
        </button>
      </div>

      <div className="chips scroll" role="group" aria-label="Category">
        <Chip active={!f.categoryId} onClick={() => set({ categoryId: '' })}>All</Chip>
        {categories.map((c) => (
          <Chip key={c.id} active={f.categoryId === c.id} onClick={() => set({ categoryId: f.categoryId === c.id ? '' : c.id })}>
            <Icon name={c.icon} size={15} /> {c.name}
          </Chip>
        ))}
      </div>

      {loading && <Loading />}
      {(all.error || filtered.error) && <ErrorNote error={all.error ?? filtered.error} />}
      {!loading && items.length === 0 && (
        isDefault ? (
          <Empty title="The catalog is empty" action={<Link className="btn" to={`/g/${group.id}/review/new`}>Add the first one</Link>}>
            Every review or plan adds its film, café or court here automatically, for everyone to reuse.
          </Empty>
        ) : (
          <Empty title="Nothing matches" action={<button className="btn secondary" onClick={() => setF(DEFAULT_FILTERS)}>Clear filters</button>}>
            Try fewer filters, or add it with a review.
          </Empty>
        )
      )}

      <div className="poster-grid">
        {items.map((it) => (
          <PosterTile key={it.id} item={it} coverUrl={it.cover_path ? covers[it.cover_path] : undefined} to={`/g/${group.id}/catalog/${it.id}`} />
        ))}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Filters">
        <div className="filters">
          <section>
            <h3 className="display">Status</h3>
            <Segmented label="Status" value={f.status} onChange={(v) => set({ status: v })}
              options={[{ value: 'all', label: 'All' }, { value: 'visited', label: 'Visited' }, { value: 'planned', label: 'Planned' }, { value: 'unvisited', label: 'Not yet' }]} />
          </section>
          <section>
            <h3 className="display">Minimum group rating</h3>
            <div className="chips">
              {[0, 3, 3.5, 4, 4.5].map((r) => <Chip key={r} active={f.minRating === r} onClick={() => set({ minRating: r })}>{r === 0 ? 'Any' : `${r}+`}</Chip>)}
            </div>
          </section>
          <section>
            <h3 className="display">Reviewed by</h3>
            <div className="chips">
              <Chip active={!f.memberId} onClick={() => set({ memberId: '' })}>Anyone</Chip>
              {members.map((m) => (
                <Chip key={m.user_id} active={f.memberId === m.user_id} onClick={() => set({ memberId: f.memberId === m.user_id ? '' : m.user_id })}>
                  {m.user_id === me ? 'You' : m.profile?.display_name ?? 'Member'}
                </Chip>
              ))}
            </div>
          </section>
          {allTags.length > 0 && (
            <section>
              <h3 className="display">Tags</h3>
              <div className="chips">
                {allTags.map((t) => (
                  <Chip key={t} active={f.tags.includes(t)} onClick={() => set({ tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t] })}>{t}</Chip>
                ))}
              </div>
            </section>
          )}
          <section>
            <h3 className="display">Favourites</h3>
            <div className="chips">
              <Chip active={f.favoritesOf === me} onClick={() => set({ favoritesOf: f.favoritesOf === me ? '' : me })}><Icon name="heart" size={15} /> Mine</Chip>
            </div>
          </section>
          <section>
            <h3 className="display">Sort by</h3>
            <Segmented label="Sort" value={f.sort} onChange={(v) => set({ sort: v })}
              options={[{ value: 'recent', label: 'Last visited' }, { value: 'rating', label: 'Rating' }, { value: 'name', label: 'Name' }, { value: 'added', label: 'Newest' }]} />
          </section>
          <div className="sheet-actions">
            <button className="btn secondary" onClick={() => setF({ ...DEFAULT_FILTERS, q: f.q })}>Reset</button>
            <button className="btn" onClick={() => setOpen(false)}>Show {items.length} {items.length === 1 ? 'result' : 'results'}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
