import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import { useGroup } from '../lib/group';
import { qk } from '../lib/hooks';
import { PlanCard } from '../components/PlanCard';
import { PlanFormSheet } from '../components/PlanForm';
import { Empty, ErrorNote, Icon, Loading, Segmented } from '../components/ui';

type Tab = 'upcoming' | 'wishlist' | 'done';

export function PlansPage() {
  const { group } = useGroup();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: qk.plans(group.id), queryFn: () => api.listPlans(group.id) });
  const plans = q.data ?? [];

  const groups: Record<Tab, typeof plans> = {
    upcoming: plans.filter((p) => p.status === 'confirmed' || p.status === 'proposed')
      .sort((a, b) => (a.proposed_for ?? '9').localeCompare(b.proposed_for ?? '9')),
    wishlist: plans.filter((p) => p.status === 'wishlist'),
    done: plans.filter((p) => p.status === 'completed' || p.status === 'cancelled')
      .sort((a, b) => (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at)),
  };
  const shown = groups[tab];

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="display hero sm">Plans</h1>
        <button className="btn" onClick={() => setOpen(true)}><Icon name="plus" size={18} /> Plan something</button>
      </header>
      <Segmented<Tab> label="Plan list" value={tab} onChange={setTab} options={[
        { value: 'upcoming', label: `Dates (${groups.upcoming.length})` },
        { value: 'wishlist', label: `Wishlist (${groups.wishlist.length})` },
        { value: 'done', label: `History (${groups.done.length})` },
      ]} />
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {!q.isLoading && shown.length === 0 && (
        <Empty title={tab === 'upcoming' ? 'No dates on the calendar' : tab === 'wishlist' ? 'The wishlist is empty' : 'No past plans yet'}
          action={tab !== 'done' ? <button className="btn" onClick={() => setOpen(true)}>Plan something</button> : undefined}>
          {tab === 'upcoming' ? 'Propose a date and let everyone vote on what works.' : tab === 'wishlist' ? 'Drop in the places and films you all keep saying you will get to.' : 'Finished plans land here, ready for reviews.'}
        </Empty>
      )}
      <div className="stack">{shown.map((p) => <PlanCard key={p.id} plan={p} />)}</div>
      <PlanFormSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
