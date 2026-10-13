import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useGroup } from '../lib/group';
import { Icon } from './ui';

export function Wordmark() {
  return (
    <span className="wordmark display" aria-label="Stakeout">
      <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true"><path d="M10 46 32 12l22 34" fill="none" stroke="currentColor" strokeWidth="7" /><circle cx="32" cy="48" r="4.5" className="dot" /></svg>
      Stakeout
    </span>
  );
}

export function AppShell() {
  const { group, groups, me } = useGroup();
  const nav = useNavigate();
  const base = `/g/${group.id}`;
  const link = (to: string, icon: string, label: string) => (
    <NavLink to={`${base}/${to}`} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
      <Icon name={icon} size={22} /><span>{label}</span>
    </NavLink>
  );
  return (
    <div className="shell">
      <aside className="rail">
        <Wordmark />
        <div className="group-switch">
          <label className="sr" htmlFor="gsw">Group</label>
          <select id="gsw" value={group.id} onChange={(e) => e.target.value === '__all' ? nav('/groups') : nav(`/g/${e.target.value}/feed`)}>
            {groups.map((m) => <option key={m.group.id} value={m.group.id}>{m.group.name}</option>)}
            <option value="__all">All groups…</option>
          </select>
        </div>
        <nav aria-label="Primary">
          {link('feed', 'feed', 'Feed')}
          {link('catalog', 'catalog', 'Catalog')}
          {link('plans', 'plans', 'Plans')}
          {link('lists', 'list', 'Lists')}
          {link('crew', 'users', 'Crew')}
          {link(`people/${me}`, 'user', 'You')}
        </nav>
        <NavLink to={`${base}/review/new`} className="btn rail-add"><Icon name="plus" size={20} /> Write a review</NavLink>
      </aside>

      <header className="topbar">
        <Wordmark />
        <button type="button" className="group-pill" onClick={() => nav('/groups')} aria-label="Switch group">
          <span>{group.name}</span><Icon name="swap" size={16} />
        </button>
      </header>

      <main className="main" id="main"><Outlet /></main>

      <nav className="tabbar" aria-label="Primary">
        {link('feed', 'feed', 'Feed')}
        {link('catalog', 'catalog', 'Catalog')}
        <NavLink to={`${base}/review/new`} className="tab-add" aria-label="Write a review"><Icon name="plus" size={26} /></NavLink>
        {link('plans', 'plans', 'Plans')}
        {link(`people/${me}`, 'user', 'You')}
      </nav>
    </div>
  );
}
