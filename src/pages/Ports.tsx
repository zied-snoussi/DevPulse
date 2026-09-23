import { Fragment, useMemo, useRef, useState, useEffect } from 'react';
import {
  CheckCircle2, ChevronRight, Copy, ExternalLink, FolderOpen, Globe, Laptop, Plug, RefreshCw, Skull, Trash2, Zap,
} from 'lucide-react';
import { useStore } from '../store';
import { useFeedback, useKill } from '../components/feedback';
import { Empty, PageHeader, SearchInput, Segmented, TechBadge } from '../components/ui';
import { bytes, cx, shortPath, since } from '../lib/format';
import type { Port } from '../types';

type Filter = 'all' | 'dev' | 'data' | 'system';

const filterOf = (p: Port): Filter =>
  p.tech.kind === 'dev' ? 'dev' : p.tech.kind === 'db' || p.tech.kind === 'infra' ? 'data' : 'system';

export default function Ports({ focusSearch }: { focusSearch?: number }) {
  const { ports, portsLoaded, refreshPorts, settings, setSettings } = useStore();
  const { killPort, killPids } = useKill();
  const { toast, confirm } = useFeedback();
  const [filter, setFilter] = useState<Filter>(() => (localStorage.getItem('devpulse.portFilter') as Filter) || 'dev');
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (focusSearch) searchRef.current?.focus(); }, [focusSearch]);
  useEffect(() => { try { localStorage.setItem('devpulse.portFilter', filter); } catch {} }, [filter]);

  const visibleProto = useMemo(() => ports.filter((p) => settings.showUdp || p.proto === 'TCP'), [ports, settings.showUdp]);

  const counts = useMemo(() => {
    const c = { all: visibleProto.length, dev: 0, data: 0, system: 0 };
    for (const p of visibleProto) c[filterOf(p)]++;
    return c;
  }, [visibleProto]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return visibleProto.filter((p) => {
      if (filter !== 'all' && filterOf(p) !== filter) return false;
      if (!needle) return true;
      return [String(p.port), p.name, p.title, p.tech.label, p.cmd, p.project, String(p.pid), p.service]
        .some((s) => s && s.toLowerCase().includes(needle));
    });
  }, [visibleProto, filter, q]);

  const quickPort = Number(quick);
  const quickValid = Number.isInteger(quickPort) && quickPort > 0 && quickPort < 65536;
  const quickMatch = quickValid ? ports.filter((p) => p.port === quickPort && p.proto === 'TCP') : [];

  const devServers = useMemo(() => ports.filter((p) => p.proto === 'TCP' && p.tech.kind === 'dev' && !p.critical), [ports]);

  const doQuickKill = async () => {
    if (!quickValid) return;
    if (!quickMatch.length) {
      toast({ kind: 'info', title: `Port ${quickPort} is already free`, body: 'Nothing is listening on it.' });
      return;
    }
    if (quickMatch.some((p) => p.critical)) {
      toast({ kind: 'warn', title: `Port ${quickPort} belongs to Windows`, body: `${quickMatch[0].tech.label} is a protected system process.` });
      return;
    }
    const m = quickMatch[0];
    if (await killPort(quickPort, `${m.tech.label} (${m.name} · PID ${m.pid})`)) setQuick('');
  };

  const killAllDev = async () => {
    const pids = [...new Set(devServers.map((p) => p.pid))];
    const ok = await confirm({
      title: `Stop all ${pids.length} dev servers?`,
      body: (
        <div className="confirm-list">
          {devServers.slice(0, 8).map((p) => <div key={p.id}><b>:{p.port}</b> {p.tech.label} <span className="muted">· {p.name} {p.pid}</span></div>)}
          {devServers.length > 8 && <div className="muted">and {devServers.length - 8} more…</div>}
        </div>
      ),
      confirmLabel: 'Stop all',
      danger: true,
    });
    if (!ok) return;
    const res = await window.devpulse.killPids(pids);
    const failed = res.filter((r) => !r.ok).length;
    toast({ kind: failed ? 'warn' : 'success', title: failed ? `${pids.length - failed} of ${pids.length} stopped` : 'All dev servers stopped', body: failed ? res.find((r) => !r.ok)?.error : undefined });
    refreshPorts();
  };

  const refresh = async () => {
    setSpinning(true);
    await refreshPorts();
    window.setTimeout(() => setSpinning(false), 400);
  };

  const copy = (text: string, what: string) => {
    navigator.clipboard.writeText(text);
    toast({ kind: 'success', title: `${what} copied` });
  };

  return (
    <div className="page">
      <PageHeader
        title="Ports"
        subtitle="Everything listening on your machine, who owns it, and a one-click way to free it."
        actions={
          <>
            {devServers.length > 1 && (
              <button className="btn btn-ghost danger-text" onClick={killAllDev}><Trash2 size={15} /> Stop all dev servers</button>
            )}
            <button className="btn btn-ghost" onClick={refresh}><RefreshCw size={15} className={cx(spinning && 'spin')} /> Refresh</button>
          </>
        }
      />

      <div className="quick-kill">
        <div className="quick-kill-icon"><Zap size={20} /></div>
        <div className="quick-kill-main">
          <div className="quick-kill-title">Free a port</div>
          <div className="quick-kill-status">
            {!quick ? (
              <span className="muted">Type a port number, e.g. 3000, 4200, 8080</span>
            ) : !quickValid ? (
              <span className="muted">Enter a number between 1 and 65535</span>
            ) : quickMatch.length ? (
              <span>
                In use by <TechBadge tech={quickMatch[0].tech} /> <b>{quickMatch[0].name}</b> <span className="muted">PID {quickMatch[0].pid}</span>
              </span>
            ) : (
              <span className="ok-text"><CheckCircle2 size={14} /> Port {quickPort} is free</span>
            )}
          </div>
        </div>
        <div className="quick-kill-input">
          <span>:</span>
          <input
            value={quick}
            onChange={(e) => setQuick(e.target.value.replace(/\D/g, '').slice(0, 5))}
            onKeyDown={(e) => e.key === 'Enter' && doQuickKill()}
            placeholder="3000"
            inputMode="numeric"
          />
        </div>
        <button className="btn btn-danger btn-lg" disabled={!quickValid || !quickMatch.length} onClick={doQuickKill}>
          <Skull size={16} /> Kill
        </button>
      </div>

      {devServers.length > 0 && (
        <div className="chips">
          {[...new Map(devServers.map((p) => [p.port, p])).values()].map((p) => (
            <div key={p.id} className="chip" style={{ ['--tc' as string]: p.tech.color }}>
              <span className="tech-dot" />
              <b>:{p.port}</b>
              <span>{p.tech.label}</span>
              <button className="icon-btn icon-btn-sm" title="Open in browser" onClick={() => window.devpulse.openUrl(`http://localhost:${p.port}`)}><ExternalLink size={13} /></button>
              <button className="icon-btn icon-btn-sm danger" title={`Kill :${p.port}`} onClick={() => killPort(p.port, `${p.tech.label} (${p.name} · PID ${p.pid})`)}><Skull size={13} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="toolbar">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'dev', label: 'Dev servers', count: counts.dev },
            { value: 'data', label: 'Databases & infra', count: counts.data },
            { value: 'system', label: 'Apps & system', count: counts.system },
            { value: 'all', label: 'All', count: counts.all },
          ]}
        />
        <div className="toolbar-right">
          <label className="switch-label">
            <input type="checkbox" className="switch" checked={settings.showUdp} onChange={(e) => setSettings({ showUdp: e.target.checked })} />
            Show UDP
          </label>
          <SearchInput value={q} onChange={setQ} placeholder="Search port, process, framework…" inputRef={searchRef} />
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 28 }} />
              <th style={{ width: 96 }}>Port</th>
              <th>Server</th>
              <th>Process</th>
              <th>Project / location</th>
              <th style={{ width: 120 }}>Address</th>
              <th style={{ width: 70 }} className="num">Conns</th>
              <th style={{ width: 90 }} className="num">Memory</th>
              <th style={{ width: 80 }} className="num">Uptime</th>
              <th style={{ width: 120 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const expanded = open === p.id;
              const httpable = p.proto === 'TCP' && p.tech.kind !== 'system' && p.tech.kind !== 'db';
              return (
                <Fragment key={p.id}>
                  <tr className={cx('row-click', expanded && 'expanded', p.critical && 'is-system')} onClick={() => setOpen(expanded ? null : p.id)}>
                    <td><ChevronRight size={14} className={cx('chev', expanded && 'open')} /></td>
                    <td>
                      <span className="port-num">{p.port}</span>
                      <span className="proto">{p.proto}</span>
                    </td>
                    <td><TechBadge tech={p.tech} /></td>
                    <td>
                      <div className="cell-title" title={p.path || ''}>{p.title}</div>
                      <div className="cell-sub mono">{p.name} · {p.pid}</div>
                    </td>
                    <td>
                      {p.project ? (
                        <span className="cell-path" title={p.project}><FolderOpen size={13} /> {shortPath(p.project, 40)}</span>
                      ) : p.service ? (
                        <span className="cell-sub">{p.service}</span>
                      ) : (
                        <span className="cell-sub" title={p.path || ''}>{shortPath(p.path, 40) || '—'}</span>
                      )}
                    </td>
                    <td>
                      <span className={cx('scope', p.scope)} title={p.addrs.join(', ')}>
                        {p.scope === 'local' ? <Laptop size={12} /> : <Globe size={12} />}
                        {p.scope === 'local' ? 'localhost' : 'network'}
                      </span>
                    </td>
                    <td className="num mono">{p.proto === 'TCP' ? p.conns : '—'}</td>
                    <td className="num mono">{p.mem ? bytes(p.mem) : '—'}</td>
                    <td className="num mono">{since(p.started)}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      {httpable && (
                        <button className="icon-btn" title={`Open http://localhost:${p.port}`} onClick={() => window.devpulse.openUrl(`http://localhost:${p.port}`)}>
                          <ExternalLink size={15} />
                        </button>
                      )}
                      <button className="icon-btn" title="Copy URL" onClick={() => copy(`http://localhost:${p.port}`, 'URL')}><Copy size={15} /></button>
                      <button
                        className="btn btn-sm btn-danger-soft"
                        disabled={p.critical}
                        title={p.critical ? 'Protected Windows process' : `Kill the process on port ${p.port}`}
                        onClick={() => killPort(p.port, `${p.tech.label} (${p.name} · PID ${p.pid})`)}
                      >
                        <Skull size={13} /> Kill
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="detail-row">
                      <td />
                      <td colSpan={9}>
                        <div className="detail">
                          <div className="detail-grid">
                            <Detail label="Listening on" value={p.addrs.map((a) => `${a.includes(':') ? `[${a}]` : a}:${p.port}`).join('   ')} mono />
                            <Detail label="Started" value={p.started ? new Date(p.started).toLocaleString() : '—'} />
                            <Detail label="Executable" value={p.path || '—'} mono action={p.path ? <button className="icon-btn icon-btn-sm" title="Show in Explorer" onClick={() => window.devpulse.reveal(p.path!)}><FolderOpen size={13} /></button> : undefined} />
                            {p.project && <Detail label="Project" value={p.project} mono action={<button className="icon-btn icon-btn-sm" title="Open folder" onClick={() => window.devpulse.reveal(p.project!)}><FolderOpen size={13} /></button>} />}
                            {p.service && <Detail label="Windows service" value={p.service} />}
                          </div>
                          <div className="cmd">
                            <div className="cmd-head">
                              <span>Command line</span>
                              {p.cmd && <button className="icon-btn icon-btn-sm" title="Copy command" onClick={() => copy(p.cmd, 'Command')}><Copy size={13} /></button>}
                            </div>
                            <code>{p.cmd || (p.critical ? 'Hidden — system process' : 'Not available (run as administrator to see it)')}</code>
                          </div>
                          <div className="detail-actions">
                            <button className="btn btn-sm btn-ghost" onClick={() => copy(String(p.pid), 'PID')}><Copy size={13} /> Copy PID</button>
                            <button className="btn btn-sm btn-ghost" disabled={p.critical} onClick={() => killPids([p.pid], p.title, { critical: p.critical, tree: false })}>
                              End only this process
                            </button>
                            <button className="btn btn-sm btn-danger" disabled={p.critical} onClick={() => killPort(p.port, `${p.tech.label} (${p.name} · PID ${p.pid})`)}>
                              <Skull size={13} /> Kill process tree
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {portsLoaded && rows.length === 0 && (
          <Empty
            icon={<Plug size={26} />}
            title={q ? `No ports match "${q}"` : filter === 'dev' ? 'No dev servers running' : 'Nothing here'}
            body={filter === 'dev' && !q ? 'Start a project (npm run dev, ng serve, uvicorn…) and it will appear instantly.' : undefined}
            action={filter !== 'all' ? <button className="btn btn-ghost" onClick={() => setFilter('all')}>Show all ports</button> : undefined}
          />
        )}
        {!portsLoaded && <div className="loading-rows">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 44 }} />)}</div>}
      </div>
    </div>
  );
}

function Detail({ label, value, mono, action }: { label: string; value: string; mono?: boolean; action?: React.ReactNode }) {
  return (
    <div className="detail-item">
      <div className="detail-label">{label}</div>
      <div className={cx('detail-value', mono && 'mono')}>
        <span title={value}>{value}</span>
        {action}
      </div>
    </div>
  );
}
