import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import { useGroup } from '../lib/group';
import { qk, useAction } from '../lib/hooks';
import { normalizeName } from '../lib/normalize';
import type { Category, CategoryKind, NewItemInput, SimilarItem } from '../lib/types';
import { Chip, Field, Icon } from './ui';

export type Picked =
  | { kind: 'existing'; item: Pick<SimilarItem, 'id' | 'name' | 'year' | 'location' | 'category_name'> }
  | { kind: 'new'; input: NewItemInput; category: Category }
  | null;

const ICONS = ['film', 'tv', 'cup', 'fork', 'tree', 'ball', 'compass', 'spark', 'pin', 'heart'];

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Pick something already in the shared catalog, or describe a new one.
 * Whatever is typed is checked against the catalog first (fuzzy, accent-insensitive); the
 * database performs the final exact-duplicate check again at save time.
 */
export function ItemPicker({ value, onChange, lockedItem }: {
  value: Picked;
  onChange(p: Picked): void;
  lockedItem?: boolean;
}) {
  const { group, categories, me } = useGroup();
  const qc = useQueryClient();

  const [categoryId, setCategoryId] = useState(categories.find((c) => c.slug === 'movie')?.id ?? categories[0]?.id ?? '');
  const [name, setName] = useState('');
  const [year, setYear] = useState('');
  const [location, setLocation] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [forceNew, setForceNew] = useState(false);
  const [addingCat, setAddingCat] = useState(false);
  const [catName, setCatName] = useState('');
  const [catKind, setCatKind] = useState<CategoryKind>('place');
  const [catIcon, setCatIcon] = useState('spark');

  const category = categories.find((c) => c.id === categoryId);
  const kind = category?.kind ?? 'place';
  const debounced = useDebounced(name);
  const similarQ = useQuery({
    queryKey: ['similar', group.id, debounced],
    queryFn: () => api.findSimilar(group.id, debounced),
    enabled: !lockedItem && value?.kind !== 'existing' && normalizeName(debounced).length >= 2,
    staleTime: 15_000,
  });
  const similar = similarQ.data ?? [];

  const yearNum = year ? Number(year) : null;
  const exact = useMemo(() => {
    const n = normalizeName(name);
    return similar.find(
      (s) => normalizeName(s.name) === n && s.category_id === categoryId &&
        (s.year ?? 0) === (yearNum ?? 0) && normalizeName(s.location ?? '') === normalizeName(location),
    );
  }, [similar, name, categoryId, yearNum, location]);

  // Report the "new item" draft upward. It stays null (so Save is disabled) while suggestions are
  // loading or unresolved: the person must pick a match or explicitly choose "add as new".
  const searching = normalizeName(name).length >= 2 && (debounced !== name || similarQ.isFetching);
  const blockedByMatches = similar.length > 0 && !forceNew && !exact;
  useEffect(() => {
    if (value?.kind === 'existing') return;
    if (!name.trim() || !category || searching || blockedByMatches) {
      if (value) onChange(null);
      return;
    }
    const input: NewItemInput = {
      category_id: category.id, name: name.trim(), year: yearNum, location: location.trim() || null,
      subtitle: subtitle.trim() || null, external_ref: externalRef.trim() || null,
    };
    onChange({ kind: 'new', input, category });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, categoryId, year, location, subtitle, externalRef, forceNew, searching, blockedByMatches]);

  const createCategory = useAction(
    () => api.createCategory(group.id, me, catName, catKind, catIcon),
    {
      success: 'Category added',
      onSuccess: async (c) => {
        await qc.invalidateQueries({ queryKey: qk.categories(group.id) });
        setCategoryId(c.id); setAddingCat(false); setCatName('');
      },
    },
  );

  if (value?.kind === 'existing') {
    const it = value.item;
    return (
      <div className="picked">
        <div>
          <p className="display picked-name">{it.name}{it.year ? <small> {it.year}</small> : null}</p>
          <p className="muted">{[it.category_name, it.location].filter(Boolean).join(' / ')} (already in your catalog)</p>
        </div>
        {!lockedItem && <button type="button" className="btn ghost small" onClick={() => { onChange(null); setName(''); setForceNew(false); }}>Change</button>}
      </div>
    );
  }

  return (
    <div className="picker">
      <div className="chips scroll" role="group" aria-label="Category">
        {categories.map((c) => (
          <Chip key={c.id} active={c.id === categoryId} onClick={() => setCategoryId(c.id)}>
            <Icon name={c.icon} size={15} /> {c.name}
          </Chip>
        ))}
        <Chip onClick={() => setAddingCat((v) => !v)} active={addingCat}><Icon name="plus" size={15} /> New category</Chip>
      </div>

      {addingCat && (
        <div className="inline-form">
          <Field label="Category name"><input value={catName} maxLength={40} onChange={(e) => setCatName(e.target.value)} placeholder="Board game cafés" /></Field>
          <div className="chips" role="group" aria-label="Fields to ask for">
            {([['place', 'A place'], ['screen', 'Film or show'], ['activity', 'An activity']] as const).map(([k, l]) => (
              <Chip key={k} active={catKind === k} onClick={() => setCatKind(k)}>{l}</Chip>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Icon">
            {ICONS.map((i) => <Chip key={i} active={catIcon === i} onClick={() => setCatIcon(i)}><Icon name={i} size={16} /></Chip>)}
          </div>
          <button type="button" className="btn small" disabled={!catName.trim() || createCategory.isPending} onClick={() => createCategory.mutate()}>Add category</button>
        </div>
      )}

      <Field label={kind === 'screen' ? 'Title' : 'Name'}>
        <input value={name} onChange={(e) => { setName(e.target.value); setForceNew(false); }} placeholder={kind === 'screen' ? 'The Batman' : 'Moda Kahve'}
          maxLength={160} autoComplete="off" autoCapitalize="words" />
      </Field>

      {!lockedItem && similar.length > 0 && !forceNew && (
        <div className="matches" role="list" aria-label="Matches already in your catalog">
          <p className="matches-title">{exact ? 'This is already in your catalog' : 'Already in your catalog'}</p>
          {similar.map((s) => (
            <button key={s.id} type="button" role="listitem" className="match" onClick={() => onChange({ kind: 'existing', item: s })}>
              <span className="match-name display">{s.name}{s.year ? <small> {s.year}</small> : null}</span>
              <span className="muted">{[s.category_name, s.location, s.subtitle].filter(Boolean).join(' / ')}</span>
              <span className="match-use">Use this</span>
            </button>
          ))}
          {!exact && <button type="button" className="link-btn" onClick={() => setForceNew(true)}>None of these. Add “{name.trim()}” as new</button>}
        </div>
      )}

      {(forceNew || similar.length === 0) && name.trim() && !exact && !searching && (
        <div className="new-fields">
          <p className="matches-title">New {category?.name.toLowerCase()} for the whole group</p>
          <div className="grid-2">
            {(kind === 'screen' || kind === 'activity') && (
              <Field label="Year"><input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="2022" /></Field>
            )}
            <Field label={kind === 'screen' ? 'Director or studio' : 'Short description'}>
              <input value={subtitle} maxLength={160} onChange={(e) => setSubtitle(e.target.value)} />
            </Field>
          </div>
          {kind !== 'screen' && (
            <Field label="Area or city" hint="Helps tell two branches with the same name apart.">
              <input value={location} maxLength={160} onChange={(e) => setLocation(e.target.value)} placeholder="Kadıköy" />
            </Field>
          )}
          <Field label={kind === 'screen' ? 'IMDb id or link (optional)' : 'Map link or place id (optional)'}
            hint="If two entries share this, they are treated as the same thing.">
            <input value={externalRef} maxLength={300} onChange={(e) => setExternalRef(e.target.value)} placeholder={kind === 'screen' ? 'imdb:tt1877830' : 'https://maps…'} />
          </Field>
        </div>
      )}
    </div>
  );
}
