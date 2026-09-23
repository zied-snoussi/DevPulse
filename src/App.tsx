import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Cpu, Gauge, Plug, Search, Settings as Cog, ShieldCheck } from 'lucide-react';
import { useStore, devPorts } from './store';
import { AdminBadge } from './components/feedback';
import { CommandPalette } from './components/CommandPalette';
import Dashboard from './pages/Dashboard';
import Ports from './pages/Ports';
import Processes from './pages/Processes';
import Settings from './pages/Settings';
import Security from './pages/Security';
import Optimize from './pages/Optimize';
import { cx, loadColor, pct } from './lib/format';

export type Page = 'dashboard' | 'ports' | 'processes' | 'security' | 'optimize' | 'settings';

const NAV: { id: Page; label: string; icon: typeof Activity; key: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity, key: '1' },
  { id: 'ports', label: 'Ports', icon: Plug, key: '2' },
  { id: 'processes', label: 'Processes', icon: Cpu, key: '3' },
  { id: 'security', label: 'Security', icon: ShieldCheck, key: '4' },
  { id: 'optimize', label: 'Optimize', icon: Gauge, key: '5' },
];

export default function App() {
  const { tick, ports, procs } = useStore();
  const [page, setPage] = useState<Page>(() => (localStorage.getItem('devpulse.page') as Page) || 'dashboard');
  const [palette, setPalette] = useState(false);
  const [focusSearch, setFocusSearch] = useState(0);

  const go = useCallback((p: Page) => {
    setPage(p);
    try { localStorage.setItem('devpulse.page', p); } catch {}
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); setPalette((v) => !v); }
      else if (k === '1') go('dashboard');
      else if (k === '2') go('ports');
      else if (k === '3') go('processes');
      else if (k === '4') go('security');
      else if (k === '5') go('optimize');
      else if (k === ',') go('settings');
      else if (k === 'f') {
        e.preventDefault();
        setPage((p) => (p === 'ports' || p === 'processes' ? p : 'ports'));
        setFocusSearch((n) => n + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const devCount = useMemo(() => new Set(devPorts(ports).filter((p) => p.tech.kind === 'dev').map((p) => p.port)).size, [ports]);
  const cpu = tick?.cpu.total ?? 0;
  const mem = tick ? (tick.mem.used / tick.mem.total) * 100 : 0;
  const title = page === 'settings' ? 'Settings' : NAV.find((n) => n.id === page)?.label;

  return (
    <div className="app">
      <div className="titlebar">
        <div className="brand">
          <Logo />
          <span>DevPulse</span>
        </div>
        <div className="titlebar-crumb">{title}</div>
        <button className="palette-trigger" onClick={() => setPalette(true)}>
          <Search size={14} />
          <span>Kill a port, find a process…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="titlebar-spacer" />
      </div>

      <aside className="sidebar">
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={cx('nav-item', page === n.id && 'active')} onClick={() => go(n.id)} title={`Ctrl+${n.key}`}>
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.id === 'ports' && devCount > 0 && <span className="nav-badge">{devCount}</span>}
              {n.id === 'processes' && procs.length > 0 && <span className="nav-count">{procs.length}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="mini-meters">
            <MiniMeter label="CPU" value={cpu} />
            <MiniMeter label="RAM" value={mem} />
          </div>
          <AdminBadge />
          <button className={cx('nav-item', page === 'settings' && 'active')} onClick={() => go('settings')} title="Ctrl+,">
            <Cog size={18} />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      <main className="content" key={page}>
        {page === 'dashboard' && <Dashboard go={go} />}
        {page === 'ports' && <Ports focusSearch={focusSearch} />}
        {page === 'processes' && <Processes focusSearch={focusSearch} />}
        {page === 'security' && <Security />}
        {page === 'optimize' && <Optimize />}
        {page === 'settings' && <Settings />}
      </main>

      {palette && <CommandPalette onClose={() => setPalette(false)} go={go} />}
    </div>
  );
}

function MiniMeter({ label, value }: { label: string; value: number }) {
  return (
    <div className="mini-meter">
      <div className="mini-meter-head">
        <span>{label}</span>
        <b style={{ color: loadColor(value) }}>{pct(value)}</b>
      </div>
      <div className="bar" style={{ height: 4 }}>
        <div className="bar-fill" style={{ width: `${value}%`, background: loadColor(value) }} />
      </div>
    </div>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#lg)" />
      <path d="M10 34h11l5-12 8 22 6-16 4 6h10" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
