import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useParams } from 'react-router-dom';
import { useAuth } from './auth';
import { useCategories, useMembers, useMyGroups } from './hooks';
import type { Category, Group, Member, Profile } from './types';
import { Loading } from '../components/ui';

interface GroupState {
  group: Group;
  role: 'owner' | 'member';
  isOwner: boolean;
  me: string;
  groups: { role: string; group: Group }[];
  members: Member[];
  people: Record<string, Profile>;
  categories: Category[];
  nameOf(id: string | null | undefined): string;
}

const Ctx = createContext<GroupState | null>(null);
export const LAST_GROUP_KEY = 'stakeout.lastGroup'; // UI preference only, never data

export function GroupLayout({ children }: { children?: ReactNode }) {
  const { gid = '' } = useParams();
  const { user } = useAuth();
  const groups = useMyGroups(user?.id);
  const members = useMembers(gid);
  const categories = useCategories(gid);

  const current = groups.data?.find((m) => m.group.id === gid);
  useEffect(() => {
    if (current) try { localStorage.setItem(LAST_GROUP_KEY, gid); } catch { /* private mode */ }
  }, [current, gid]);

  const people = useMemo(() => {
    const out: Record<string, Profile> = {};
    for (const m of members.data ?? []) if (m.profile) out[m.user_id] = m.profile;
    return out;
  }, [members.data]);

  if (groups.isLoading || members.isLoading || categories.isLoading) return <Loading />;
  if (!current || !user) {
    return (
      <div className="page narrow">
        <h1 className="display">That group is not available</h1>
        <p className="muted">It may not exist, or you may not be a member. <Link to="/groups">Back to your groups</Link></p>
      </div>
    );
  }

  const value: GroupState = {
    group: current.group,
    role: current.role as 'owner' | 'member',
    isOwner: current.role === 'owner',
    me: user.id,
    groups: groups.data ?? [],
    members: members.data ?? [],
    people,
    categories: categories.data ?? [],
    nameOf: (id) => (id && people[id]?.display_name) || 'Former member',
  };
  return <Ctx.Provider value={value}>{children ?? <Outlet />}</Ctx.Provider>;
}

export function useGroup(): GroupState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGroup outside GroupLayout');
  return v;
}

export function RedirectToLastGroup() {
  const { user } = useAuth();
  const groups = useMyGroups(user?.id);
  if (groups.isLoading) return <Loading />;
  const list = groups.data ?? [];
  if (!list.length) return <Navigate to="/groups" replace />;
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_GROUP_KEY); } catch { /* ignore */ }
  const target = list.find((m) => m.group.id === last) ?? (list.length === 1 ? list[0] : null);
  return <Navigate to={target ? `/g/${target.group.id}/feed` : '/groups'} replace />;
}
