import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import { useGroup } from '../lib/group';
import { useSignedUrls } from '../lib/hooks';
import { todayISO } from '../lib/format';
import { parseTags } from '../lib/normalize';
import { useToast } from '../lib/toast';
import { ItemPicker, type Picked } from '../components/ItemPicker';
import { PhotoPicker, type ExistingPhoto, type NewPhoto } from '../components/PhotoPicker';
import { RatingInput } from '../components/StarRating';
import { Chip, ErrorNote, Field, Loading } from '../components/ui';

export function ReviewEditor() {
  const { reviewId } = useParams();
  const [params] = useSearchParams();
  const { group, me } = useGroup();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const editing = Boolean(reviewId);
  const presetItem = params.get('item');
  const planId = params.get('plan');

  const [picked, setPicked] = useState<Picked>(null);
  const [rating, setRating] = useState(0);
  const [visited, setVisited] = useState(todayISO());
  const [body, setBody] = useState('');
  const [tagText, setTagText] = useState('');
  const [added, setAdded] = useState<NewPhoto[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const existing = useQuery({ queryKey: ['review', reviewId], queryFn: () => api.getReview(reviewId!), enabled: editing });
  const preset = useQuery({ queryKey: ['item', presetItem], queryFn: () => api.getItem(presetItem!), enabled: !!presetItem && !editing });
  const tagPool = useQuery({ queryKey: ['catalog', group.id, 'all'], queryFn: () => api.searchCatalog(group.id, { q: '', categoryId: '', minRating: 0, tags: [], memberId: '', status: 'all', favoritesOf: '', sort: 'recent' }) });
  const urls = useSignedUrls(existing.data?.photos.map((p) => p.storage_path) ?? []);

  useEffect(() => {
    const r = existing.data;
    if (!r) return;
    setRating(Number(r.rating)); setVisited(r.visited_on); setBody(r.body ?? ''); setTagText(r.tags.join(', '));
    if (r.item) setPicked({ kind: 'existing', item: { id: r.item.id, name: r.item.name, year: r.item.year, location: r.item.location, category_name: r.item.category?.name ?? '' } });
  }, [existing.data]);
  useEffect(() => {
    const it = preset.data;
    if (it) setPicked({ kind: 'existing', item: { id: it.id, name: it.name, year: it.year, location: it.location, category_name: it.category_name } });
  }, [preset.data]);

  if (editing && existing.isLoading) return <Loading />;
  if (editing && existing.data && existing.data.author_id !== me) return <div className="page narrow"><p className="error">You can only edit your own reviews.</p></div>;

  const tags = parseTags(tagText);
  const suggestions = [...new Set((tagPool.data ?? []).flatMap((i) => i.tags))].filter((t) => !tags.includes(t)).slice(0, 10);
  const photos: ExistingPhoto[] = (existing.data?.photos ?? []).map((p) => ({ ...p, url: urls[p.storage_path] }));
  const canSave = !!picked && rating > 0 && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked || rating <= 0) return;
    setBusy(true); setError('');
    const uploaded: string[] = [];
    try {
      for (const p of added) uploaded.push(await api.uploadPhoto(group.id, me, p.blob));
      let itemId: string;
      if (editing) {
        await api.updateReview(reviewId!, group.id, { rating, body, tags, visited_on: visited }, uploaded, removed);
        const gone = photos.filter((p) => removed.includes(p.id)).map((p) => p.storage_path);
        await api.removePhotos(gone);
        itemId = existing.data!.item_id;
        toast.show('Review updated');
      } else {
        const r = await api.createReview({
          groupId: group.id,
          itemId: picked.kind === 'existing' ? picked.item.id : null,
          newItem: picked.kind === 'new' ? picked.input : null,
          rating, body, tags, visitedOn: visited, photoPaths: uploaded,
        });
        itemId = r.item_id;
        if (planId) await api.updatePlan(planId, { status: 'completed' }).catch(() => undefined);
        toast.show(r.item_created ? 'Review saved. It is now in the shared catalog.' : 'Review saved');
      }
      await qc.invalidateQueries();
      nav(`/g/${group.id}/catalog/${itemId}`, { replace: true });
    } catch (err) {
      await api.removePhotos(uploaded); // don't leave orphaned uploads behind
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="page narrow editor" onSubmit={submit}>
      <header className="page-head"><h1 className="display hero sm">{editing ? 'Edit your review' : 'Write a review'}</h1></header>

      <section className="panel">
        <h2 className="display">What was it?</h2>
        <ItemPicker value={picked} onChange={setPicked} lockedItem={editing || !!presetItem} />
      </section>

      <section className="panel">
        <h2 className="display">Your rating</h2>
        <RatingInput value={rating} onChange={setRating} />
        <Field label="Visited on"><input type="date" value={visited} max={todayISO()} onChange={(e) => setVisited(e.target.value || todayISO())} required /></Field>
        <Field label="What did you think?" hint="Only your words, under your name. Others review separately.">
          <textarea rows={5} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} placeholder="The flat white, the rain on the window, who talked the whole time…" />
        </Field>
        <Field label="Tags" hint="Separate with commas.">
          <input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="date night, quiet, worth the queue" />
        </Field>
        {suggestions.length > 0 && (
          <div className="chips">
            {suggestions.map((t) => <Chip key={t} onClick={() => setTagText([...tags, t].join(', '))}>{t}</Chip>)}
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="display">Photos</h2>
        <PhotoPicker existing={photos} added={added} removedIds={removed}
          onAdd={(p) => setAdded((a) => [...a, ...p])}
          onRemoveNew={(k) => setAdded((a) => a.filter((x) => x.key !== k))}
          onToggleExisting={(id) => setRemoved((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]))} />
      </section>

      {error && <ErrorNote error={new Error(error)} />}
      <div className="sticky-actions">
        <button type="button" className="btn secondary" onClick={() => nav(-1)}>Cancel</button>
        <button className="btn" disabled={!canSave}>{busy ? 'Saving' : editing ? 'Save changes' : 'Save review'}</button>
      </div>
      {!picked && !editing && <p className="muted small-note">Choose an existing entry or finish describing a new one to continue.</p>}
    </form>
  );
}
