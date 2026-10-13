import { useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api';
import { useGroup } from '../lib/group';
import { qk, useAction } from '../lib/hooks';
import { formatDateTime, fromLocalInput } from '../lib/format';
import type { Plan, Response } from '../lib/types';
import { Comments } from './Comments';
import { RefPoster } from './Poster';
import { Avatar, Chip, Icon } from './ui';

const STATUS_LABEL: Record<Plan['status'], string> = {
  wishlist: 'Someday', proposed: 'Date proposed', confirmed: 'Confirmed', completed: 'Done', cancelled: 'Cancelled',
};

export function PlanCard({ plan }: { plan: Plan }) {
  const { group, me, isOwner, people, nameOf } = useGroup();
  const [open, setOpen] = useState(false);
  const [newDate, setNewDate] = useState('');
  const keys = [qk.plans(group.id), qk.feed(group.id), qk.catalog(group.id), ['itemPlans']];
  const mine = plan.responses.find((r) => r.user_id === me)?.response ?? null;
  const active = plan.status !== 'completed' && plan.status !== 'cancelled';
  const canDelete = plan.created_by === me || isOwner;

  const respond = useAction((r: Response | null) => api.respondToPlan(group.id, plan.id, me, r), { invalidate: keys });
  const setStatus = useAction((s: Plan['status']) => api.updatePlan(plan.id, { status: s }), { invalidate: keys });
  const del = useAction(() => api.deletePlan(plan.id), { invalidate: keys, success: 'Plan removed' });
  const addOpt = useAction((iso: string) => api.addDateOption(group.id, plan.id, me, iso), { invalidate: keys, onSuccess: () => setNewDate('') });
  const rmOpt = useAction((id: string) => api.removeDateOption(id), { invalidate: keys });
  const vote = useAction((a: { id: string; on: boolean }) => api.voteDate(group.id, a.id, me, a.on), { invalidate: keys });
  const lock = useAction((iso: string) => api.updatePlan(plan.id, { status: 'confirmed', proposed_for: iso }), { invalidate: keys, success: 'Date locked in' });

  const options = [...plan.options].sort((a, b) => b.votes.length - a.votes.length || a.starts_at.localeCompare(b.starts_at));
  const going = plan.responses.filter((r) => r.response === 'in');

  return (
    <article className={`plan status-${plan.status}`}>
      <div className="plan-main">
        {plan.item && <Link to={`/g/${group.id}/catalog/${plan.item.id}`} aria-label={plan.item.name}><RefPoster item={plan.item} /></Link>}
        <div className="plan-body">
          <div className="chips">
            <Chip tone={active ? 'green' : undefined}>{STATUS_LABEL[plan.status]}</Chip>
            {plan.proposed_for && <Chip>{formatDateTime(plan.proposed_for)}</Chip>}
          </div>
          <h3 className="display plan-title">{plan.item ? <Link to={`/g/${group.id}/catalog/${plan.item.id}`}>{plan.item.name}</Link> : 'Plan'}</h3>
          <p className="muted">{[plan.item?.category?.name, plan.item?.location].filter(Boolean).join(' / ')}</p>
          {plan.notes && <p className="plan-notes">{plan.notes}</p>}
          <p className="muted small-note">Suggested by {plan.created_by === me ? 'you' : nameOf(plan.created_by)}</p>
        </div>
      </div>

      <div className="going">
        <div className="avatars" aria-label={`${going.length} going`}>
          {going.slice(0, 6).map((r) => <Avatar key={r.user_id} profile={people[r.user_id] ?? null} size={26} />)}
          {going.length === 0 && <span className="muted">Nobody is in yet</span>}
        </div>
        {active && (
          <div className="rsvp" role="group" aria-label="Your answer">
            {(['in', 'maybe', 'out'] as const).map((r) => (
              <button key={r} type="button" className={mine === r ? 'on' : ''} aria-pressed={mine === r} onClick={() => respond.mutate(mine === r ? null : r)}>
                {r === 'in' ? "I'm in" : r === 'maybe' ? 'Maybe' : "Can't"}
              </button>
            ))}
          </div>
        )}
      </div>

      {active && (options.length > 0 || open) && (
        <div className="dates">
          <h4 className="display">Dates people suggested</h4>
          {options.map((o) => {
            const voted = o.votes.some((v) => v.user_id === me);
            const top = o.votes.length === Math.max(...options.map((x) => x.votes.length)) && o.votes.length > 0;
            return (
              <div key={o.id} className={`date-opt${top ? ' lead' : ''}`}>
                <button type="button" className={`vote${voted ? ' on' : ''}`} aria-pressed={voted} onClick={() => vote.mutate({ id: o.id, on: !voted })}>
                  <Icon name="check" size={16} /> {o.votes.length}
                </button>
                <span>{formatDateTime(o.starts_at)}</span>
                <span className="row-gap">
                  <button type="button" className="link-btn" onClick={() => lock.mutate(o.starts_at)}>Lock this date</button>
                  {(o.suggested_by === me || isOwner) && <button type="button" className="icon-btn subtle" aria-label="Remove date" onClick={() => rmOpt.mutate(o.id)}><Icon name="x" size={16} /></button>}
                </span>
              </div>
            );
          })}
          <div className="comment-form">
            <input type="datetime-local" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="Suggest a date" />
            <button type="button" className="btn small" disabled={!newDate || addOpt.isPending} onClick={() => { const iso = fromLocalInput(newDate); if (iso) addOpt.mutate(iso); }}>Suggest</button>
          </div>
        </div>
      )}

      <footer className="plan-actions">
        {active && (
          <>
            <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)}><Icon name="plans" size={16} /> Suggest a date</button>
            <button type="button" className="btn small" onClick={() => setStatus.mutate('completed')}><Icon name="check" size={16} /> Mark done</button>
            <button type="button" className="link-btn" onClick={() => setStatus.mutate('cancelled')}>Cancel plan</button>
          </>
        )}
        {plan.status === 'completed' && plan.item && (
          <Link className="btn small" to={`/g/${group.id}/review/new?item=${plan.item.id}&plan=${plan.id}`}>Write your review</Link>
        )}
        {plan.status === 'cancelled' && <button type="button" className="link-btn" onClick={() => setStatus.mutate('wishlist')}>Bring it back</button>}
        {canDelete && <button type="button" className="link-btn danger" onClick={() => confirm('Delete this plan?') && del.mutate(undefined)}><Icon name="trash" size={16} /> Delete</button>}
      </footer>
      <details className="plan-comments"><summary>Discussion</summary><Comments target={{ plan_id: plan.id }} placeholder="Add a thought" /></details>
    </article>
  );
}
