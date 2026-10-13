import { useState } from 'react';
import * as api from '../lib/api';
import { useGroup } from '../lib/group';
import { qk, useAction } from '../lib/hooks';
import { fromLocalInput } from '../lib/format';
import type { PlanStatus } from '../lib/types';
import { ItemPicker, type Picked } from './ItemPicker';
import { Field, Segmented, Sheet } from './ui';

/** Add something to the wishlist or propose a date. New places are added to the shared catalog. */
export function PlanFormSheet({ open, onClose, preset }: { open: boolean; onClose(): void; preset?: Picked }) {
  const { group } = useGroup();
  const [picked, setPicked] = useState<Picked>(preset ?? null);
  const [mode, setMode] = useState<'wishlist' | 'proposed'>('wishlist');
  const [when, setWhen] = useState('');
  const [notes, setNotes] = useState('');

  const save = useAction(
    () => api.createPlan({
      groupId: group.id,
      itemId: picked?.kind === 'existing' ? picked.item.id : null,
      newItem: picked?.kind === 'new' ? picked.input : null,
      status: (mode === 'proposed' && when ? 'proposed' : 'wishlist') as PlanStatus,
      notes, proposedFor: mode === 'proposed' ? fromLocalInput(when) : null,
    }),
    {
      invalidate: [qk.plans(group.id), qk.catalog(group.id), qk.feed(group.id), ['item'], ['itemPlans']],
      onSuccess: (r) => {
        setPicked(preset ?? null); setNotes(''); setWhen(''); onClose();
        void r;
      },
      success: 'Plan added',
    },
  );

  return (
    <Sheet open={open} onClose={onClose} title="Plan something">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (picked) save.mutate(undefined); }}>
        <ItemPicker value={picked} onChange={setPicked} lockedItem={!!preset} />
        <Segmented<'wishlist' | 'proposed'> label="Plan type" value={mode} onChange={setMode}
          options={[{ value: 'wishlist', label: 'Someday' }, { value: 'proposed', label: 'Propose a date' }]} />
        {mode === 'proposed' && (
          <Field label="When"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required /></Field>
        )}
        <Field label="Notes (optional)"><textarea rows={3} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="Book ahead? Bring cash? Who suggested it?" /></Field>
        <button className="btn block" disabled={!picked || save.isPending || (mode === 'proposed' && !when)}>Add to plans</button>
      </form>
    </Sheet>
  );
}
