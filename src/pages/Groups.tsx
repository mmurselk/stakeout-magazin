import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import { useAuth } from '../lib/auth';
import { qk, useAction, useMyGroups } from '../lib/hooks';
import { parseInviteInput } from '../lib/normalize';
import { Empty, ErrorNote, Field, Loading } from '../components/ui';
import { Wordmark } from '../components/AppShell';

export function GroupsPage() {
  const { user, profile, signOut } = useAuth();
  const nav = useNavigate();
  const groups = useMyGroups(user?.id);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [code, setCode] = useState('');

  const create = useAction((n: string) => api.createGroup(n, desc), {
    invalidate: [qk.groups(user?.id ?? '')],
    success: 'Group created',
    onSuccess: (id) => nav(`/g/${id}/crew`),
  });
  const join = useAction((c: string) => api.joinGroup(c), {
    invalidate: [qk.groups(user?.id ?? '')],
    success: 'Welcome in',
    onSuccess: (id) => nav(`/g/${id}/feed`),
  });

  return (
    <div className="page narrow">
      <header className="page-head">
        <Wordmark />
        <button type="button" className="link-btn" onClick={() => signOut()}>Sign out {profile ? `(${profile.display_name})` : ''}</button>
      </header>
      <h1 className="display hero sm">Your groups</h1>
      {groups.isLoading && <Loading />}
      {groups.error && <ErrorNote error={groups.error} />}
      {groups.data?.length === 0 && (
        <Empty title="No group yet">Groups are private and invite-only. Start one for your crew, or join with a code someone sent you.</Empty>
      )}
      <ul className="group-list">
        {groups.data?.map((m) => (
          <li key={m.group.id}>
            <Link to={`/g/${m.group.id}/feed`} className="group-card">
              <span className="display">{m.group.name}</span>
              <span className="muted">{m.group.description || (m.role === 'owner' ? 'You own this group' : 'Member')}</span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="panel">
        <h2 className="display">Start a group</h2>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()); }}>
          <Field label="Group name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Friday regulars" required /></Field>
          <Field label="Description (optional)"><input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={280} /></Field>
          <button className="btn" disabled={create.isPending || !name.trim()}>Create group</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="display">Join with an invite</h2>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); const c = parseInviteInput(code); if (c) join.mutate(c); }}>
          <Field label="Invite code or link"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="a1b2c3d4e5f6" autoCapitalize="none" autoCorrect="off" /></Field>
          <button className="btn secondary" disabled={join.isPending || !code.trim()}>Join group</button>
        </form>
      </section>
    </div>
  );
}

export function JoinPage() {
  const { code = '' } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const clean = parseInviteInput(code);
  const preview = useQuery({ queryKey: ['invite', clean], queryFn: () => api.previewInvite(clean), retry: false });
  const mine = useMyGroups(user?.id);
  const join = useAction(() => api.joinGroup(clean), {
    invalidate: [qk.groups(user?.id ?? '')],
    success: 'Welcome in',
    onSuccess: (id) => nav(`/g/${id}/feed`, { replace: true }),
  });

  if (preview.isLoading || mine.isLoading) return <Loading />;
  const p = preview.data;
  const already = p && mine.data?.some((m) => m.group.id === p.group_id);
  if (already) return <Navigate to={`/g/${p.group_id}/feed`} replace />;

  return (
    <div className="page narrow">
      <Wordmark />
      {!p || !p.is_valid ? (
        <Empty title="This invite does not work" action={<Link className="btn" to="/groups">Go to your groups</Link>}>
          It may have expired, been revoked or reached its limit. Ask the group owner for a fresh link.
        </Empty>
      ) : (
        <div className="panel invite">
          <p className="muted">You have been invited to</p>
          <h1 className="display hero sm">{p.group_name}</h1>
          <p className="muted">{p.member_count} {p.member_count === 1 ? 'member' : 'members'}</p>
          <button className="btn block" disabled={join.isPending} onClick={() => join.mutate()}>Join {p.group_name}</button>
        </div>
      )}
    </div>
  );
}
