import { useRef, useState } from 'react';
import { resizeImage } from '../lib/images';
import { useToast } from '../lib/toast';
import { Icon } from './ui';

export interface NewPhoto { key: string; blob: Blob; preview: string }
export interface ExistingPhoto { id: string; storage_path: string; url?: string }

const MAX = 6;

export function PhotoPicker({ existing, added, removedIds, onAdd, onRemoveNew, onToggleExisting }: {
  existing: ExistingPhoto[];
  added: NewPhoto[];
  removedIds: string[];
  onAdd(p: NewPhoto[]): void;
  onRemoveNew(key: string): void;
  onToggleExisting(id: string): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const count = existing.filter((p) => !removedIds.includes(p.id)).length + added.length;

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const room = MAX - count;
      const out: NewPhoto[] = [];
      for (const f of Array.from(files).slice(0, Math.max(0, room))) {
        if (!f.type.startsWith('image/')) continue;
        const blob = await resizeImage(f);
        out.push({ key: crypto.randomUUID(), blob, preview: URL.createObjectURL(blob) });
      }
      if (files.length > room) toast.show(`Up to ${MAX} photos per review.`, 'error');
      onAdd(out);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="photo-picker">
      {existing.map((p) => (
        <div key={p.id} className={`thumb${removedIds.includes(p.id) ? ' removed' : ''}`}>
          {p.url ? <img src={p.url} alt="" /> : <span className="thumb-ph" />}
          <button type="button" className="thumb-x" onClick={() => onToggleExisting(p.id)}
            aria-label={removedIds.includes(p.id) ? 'Keep photo' : 'Remove photo'}>
            <Icon name={removedIds.includes(p.id) ? 'plus' : 'x'} size={16} />
          </button>
        </div>
      ))}
      {added.map((p) => (
        <div key={p.key} className="thumb">
          <img src={p.preview} alt="" />
          <button type="button" className="thumb-x" onClick={() => onRemoveNew(p.key)} aria-label="Remove photo"><Icon name="x" size={16} /></button>
        </div>
      ))}
      {count < MAX && (
        <button type="button" className="thumb thumb-add" onClick={() => input.current?.click()} disabled={busy}>
          <Icon name="camera" /><span>{busy ? 'Preparing' : 'Add photo'}</span>
        </button>
      )}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => pick(e.target.files)} />
    </div>
  );
}
