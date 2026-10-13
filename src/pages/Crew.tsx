import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import { useAuth } from '../lib/auth';
import { useGroup } from '../lib/group';
import { qk, useAction } from '../lib/hooks';
import { formatDate } from '../lib/format';
import { useToast } from '../lib/toast';
import { Avatar, Chip, ErrorNote, Field, Icon, Loading } from '../components/ui';

export function CrewPage() {
  const { group, me, isOwner, members } = useGroup();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(group.name);
  const [days, setDays] = useState(7);
  const [maxUses, setMaxUses] = useState<number | null>(10);
  const owners = members.filter((m) => m.role === 'owner').length;

  const invites = useQuery({ queryKey: qk.invites(group.id), queryFn: () => api.listInvites(group.id), enabled: isOwner });
  const refresh = [qk.members(group.id), qk.invites(group.id), qk.groups(user?.id ?? '')];
  const role = useAction((a: { id: string; role: 'owner' | 'member' }) => api.setMemberRole(group.id, a.id, a.role), { invalidate: refresh, success: 'Role updated' });
  const kick = useAction((id: string) => api.removeMember(group.id, id), {
    invalidate: refresh, success: 'Done',
    onSuccess: (_r, id) => { if (id === me) nav('/groups', { replace: true }); },
  });
  const make = useAction(() => api.createInvite(group.id, me, days, maxUses), { invalidate: refresh, success: 'Invite created' });
  const revoke = useAction((id: string) => api.revokeInvite(id), { invalidate: refresh });
  const rename = useAction(() => api.updateGroup(group.id, { name }), { invalidate: refresh, success: 'Group renamed' });
  const destroy = useAction(() => api.deleteGroup(group.id), {
    invalidate: [qk.groups(user?.id ?? '')], success: 'Group deleted', onSuccess: () => nav('/groups', { replace: true }),
  });

  const link = (code: string) => `${window.location.origin}${window.location.pathname}#/join/${code}`;
  async function copy(code: string) {
    try { await navigator.clipboard.writeText(link(code)); toast.show('Invite link copied'); }
    catch { toast.show(link(code)); }
  }
  const live = (i: NonNullable<typeof invites.data>[number]) =>
    !i.revoked_at && new Date(i.expires_at) > new Date() && (i.max_uses === null || i.uses < i.max_uses);

  return (
    <div className="page narrow">
      <header className="page-head"><h1 className="display hero sm">The crew</h1></header>

      <section className="panel">
        <h2 className="display">Members ({members.length})</h2>
        <ul className="members">
          {members.map((m) => (
            <li key={m.user_id}>
              <Avatar profile={m.profile} size={36} />
              <span className="member-name"><strong>{m.profile?.display_name ?? 'Member'}{m.user_id === me ? ' (you)' : ''}</strong><small className="muted">@{m.profile?.username} · joined {formatDate(m.joined_at)}</small></span>
              <Chip tone={m.role === 'owner' ? 'red' : undefined}>{m.role === 'owner' ? 'Owner' : 'Member'}</Chip>
              {isOwner && m.user_id !== me && (
                <span className="row-gap">
                  <button className="link-btn" onClick={() => role.mutate({ id: m.user_id, role: m.role === 'owner' ? 'member' : 'owner' })}>{m.role === 'owner' ? 'Make member' : 'Make owner'}</button>
                  <button className="link-btn danger" onClick={() => confirm(`Remove ${m.profile?.display_name ?? 'this member'}?`) && kick.mutate(m.user_id)}>Remove</button>
                </span>
              )}
            </li>
          ))}
        </ul>
        <button className="link-btn danger" onClick={() => {
          if (owners === 1 && isOwner && members.length > 1) { toast.show('Promote another owner before leaving.', 'error'); return; }
          if (confirm(`Leave ${group.name}? Your reviews stay in the catalog.`)) kick.mutate(me);
        }}><Icon name="logout" size={16} /> Leave group</button>
      </section>

      {isOwner ? (
        <section className="panel">
          <h2 className="display">Invite people</h2>
          <p className="muted">Nobody can join without a code. Share a link only with people you trust.</p>
          <div className="grid-2">
            <Field label="Valid for">
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option>
              </select>
            </Field>
            <Field label="Uses">
              <select value={maxUses ?? 0} onChange={(e) => setMaxUses(Number(e.target.value) || null)}>
                <option value={1}>1 person</option><option value={5}>5 people</option><option value={10}>10 people</option><option value={0}>Unlimited</option>
              </select>
            </Field>
          </div>
          <button className="btn" onClick={() => make.mutate(undefined)} disabled={make.isPending}>Create invite link</button>
          {invites.isLoading && <Loading />}
          {invites.error && <ErrorNote error={invites.error} />}
          <ul className="invites">
            {invites.data?.map((i) => (
              <li key={i.id} className={live(i) ? '' : 'dead'}>
                <code>{i.code}</code>
                <span className="muted">{live(i) ? `${i.uses}${i.max_uses ? `/${i.max_uses}` : ''} used, until ${formatDate(i.expires_at)}` : i.revoked_at ? 'Revoked' : 'Expired or used up'}</span>
                {live(i) && (
                  <span className="row-gap">
                    <button className="link-btn" onClick={() => copy(i.code)}><Icon name="link" size={15} /> Copy link</button>
                    <button className="link-btn danger" onClick={() => revoke.mutate(i.id)}>Revoke</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : <p className="muted">Only owners can create invites.</p>}

      {isOwner && (
        <section className="panel">
          <h2 className="display">Group settings</h2>
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) rename.mutate(undefined); }}>
            <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
            <button className="btn secondary" disabled={!name.trim() || name === group.name}>Rename</button>
          </form>
          <button className="link-btn danger" onClick={() => confirm(`Delete ${group.name} and everything in it? This cannot be undone.`) && destroy.mutate(undefined)}>
            <Icon name="trash" size={16} /> Delete this group
          </button>
        </section>
      )}
    </div>
  );
}
