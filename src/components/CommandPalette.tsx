import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Cpu, ExternalLink, Plug, Settings as Cog, Skull, Search } from 'lucide-react';
import { groupProcesses, useStore } from '../store';
import { useKill } from './feedback';
import { cx, bytes, pct } from '../lib/format';
import type { Page } from '../App';

interface Item {
  id: string;
  icon: React.ReactNode;
  label: React.ReactNode;
  hint?: string;
  danger?: boolean;
  run: () => void;
}

export function CommandPalette({ onClose, go }: { onClose: () => void; go: (p: Page) => void }) {
  const { ports, procs } = useStore();
  const { killPort, killPids } = useKill();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    const t = q.trim().toLowerCase().replace(/^:/, '');
    const out: Item[] = [];
    const num = Number(t);
    if (t && Number.isInteger(num) && num > 0 && num < 65536) {
      const hit = ports.find((p) => p.port === num && p.proto === 'TCP');
      if (hit) {
        out.push({
          id: 'kill', icon: <Skull size={16} />, danger: true,
          label: <>Kill port <b>{num}</b></>,
          hint: `${hit.tech.label} · ${hit.name} · PID ${hit.pid}`,
          run: () => killPort(num, `${hit.tech.label} (${hit.name} · PID ${hit.pid})`),
        });
        out.push({ id: 'open', icon: <ExternalLink size={16} />, label: <>Open http://localhost:{num}</>, run: () => window.devpulse.openUrl(`http://localhost:${num}`) });
      } else {
        out.push({ id: 'free', icon: <Plug size={16} />, label: <>Port <b>{num}</b> is free</>, hint: 'Nothing is listening', run: () => {} });
      }
    }
    const pages: [Page, string, React.ReactNode][] = [
      ['dashboard', 'Go to Dashboard', <Activity size={16} />],
      ['ports', 'Go to Ports', <Plug size={16} />],
      ['processes', 'Go to Processes', <Cpu size={16} />],
      ['settings', 'Go to Settings', <Cog size={16} />],
    ];
    for (const [p, label, icon] of pages) if (!t || label.toLowerCase().includes(t)) out.push({ id: `go-${p}`, icon, label, run: () => go(p) });

    if (t && Number.isNaN(num)) {
      const seen = new Set<number>();
      for (const p of ports) {
        if (p.proto !== 'TCP' || p.critical || seen.has(p.port)) continue;
        if (![p.tech.label, p.name, p.project ?? ''].some((s) => s.toLowerCase().includes(t))) continue;
        seen.add(p.port);
        out.push({
          id: `port-${p.id}`, icon: <Skull size={16} />, danger: true,
          label: <>Kill <b>:{p.port}</b> · {p.tech.label}</>, hint: `${p.name} · PID ${p.pid}`,
          run: () => killPort(p.port, `${p.tech.label} (${p.name} · PID ${p.pid})`),
        });
      }
      for (const g of groupProcesses(procs)) {
        if (g.critical || ![g.title, g.name].some((s) => s.toLowerCase().includes(t))) continue;
        out.push({
          id: `proc-${g.key}`, icon: <Skull size={16} />, danger: true,
          label: <>End <b>{g.title}</b></>, hint: `${g.count} proc · ${pct(g.cpu, 1)} CPU · ${bytes(g.mem)}`,
          run: () => killPids(g.procs.map((p) => p.pid), g.title),
        });
        if (out.length > 14) break;
      }
    }
    return out.slice(0, 14);
  }, [q, ports, procs, go, killPort, killPids]);

  useEffect(() => setSel(0), [q]);

  const exec = (i: Item) => {
    onClose();
    i.run();
  };

  return (
    <div className="overlay overlay-top" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={18} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a port (3000), an app name, or a page…"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === 'Enter' && items[sel]) exec(items[sel]);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list">
          {items.map((i, k) => (
            <button key={i.id} className={cx('palette-item', k === sel && 'active', i.danger && 'danger')} onMouseEnter={() => setSel(k)} onClick={() => exec(i)}>
              <span className="palette-icon">{i.icon}</span>
              <span className="palette-label">{i.label}</span>
              {i.hint && <span className="palette-hint">{i.hint}</span>}
            </button>
          ))}
          {!items.length && <div className="palette-empty">No matches</div>}
        </div>
      </div>
    </div>
  );
}
