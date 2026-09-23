import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Copy, FolderOpen, Layers, ListTree, Lock, Skull } from 'lucide-react';
import { groupProcesses, useStore, type ProcGroup } from '../store';
import { useFeedback, useKill } from '../components/feedback';
import { Bar } from '../components/charts';
import { PageHeader, SearchInput, Segmented } from '../components/ui';
import { AppIcon } from './Dashboard';
import { bytes, cx, pct, since } from '../lib/format';

type SortKey = 'name' | 'cpu' | 'mem' | 'gpu' | 'count';

export default function Processes({ focusSearch }: { focusSearch?: number }) {
  const { procs, tick } = useStore();
  const { killPids } = useKill();
  const { toast } = useFeedback();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'cpu', dir: -1 });
  const [grouped, setGrouped] = useState<'group' | 'flat'>('group');
  const [open, setOpen] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (focusSearch) searchRef.current?.focus(); }, [focusSearch]);

  const groups = useMemo<ProcGroup[]>(() => {
    if (grouped === 'group') return groupProcesses(procs);
    return procs.map((p) => ({
      key: String(p.pid), name: p.name, title: p.desc || p.name, company: p.company, path: p.path,
      count: 1, cpu: p.cpu, mem: p.mem, gpu: p.gpu, critical: p.critical, procs: [p],
    }));
  }, [procs, grouped]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? groups.filter((g) => [g.name, g.title, g.company, g.path, ...g.procs.map((p) => String(p.pid))].some((s) => s && s.toLowerCase().includes(needle)))
      : groups;
    const { key, dir } = sort;
    return [...list].sort((a, b) => {
      if (key === 'name') return a.title.localeCompare(b.title) * dir;
      return ((a[key] as number) - (b[key] as number)) * dir || b.mem - a.mem;
    });
  }, [groups, q, sort]);

  const totals = useMemo(() => ({
    cpu: tick?.cpu.total ?? 0,
    mem: procs.reduce((a, p) => a + p.mem, 0),
    apps: groupProcesses(procs).length,
  }), [procs, tick]);

  const maxCpu = Math.max(5, ...rows.slice(0, 50).map((r) => r.cpu));
  const maxMem = Math.max(1, ...rows.slice(0, 50).map((r) => r.mem));

  const th = (key: SortKey, label: string, cls?: string) => (
    <th className={cx('sortable', cls, sort.key === key && 'sorted')} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' ? 1 : -1 }))}>
      {label}
      {sort.key === key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </th>
  );

  const kill = (g: ProcGroup) => killPids(g.procs.map((p) => p.pid), g.title, { critical: g.critical, tree: g.count === 1 });

  return (
    <div className="page">
      <PageHeader
        title="Processes"
        subtitle={<>{procs.length} processes · {totals.apps} apps · {pct(totals.cpu)} CPU · {bytes(totals.mem)} RAM in working sets</>}
      />
      <div className="toolbar">
        <Segmented
          value={grouped}
          onChange={(v) => { setGrouped(v); setOpen(null); }}
          options={[
            { value: 'group', label: <><Layers size={14} /> Group by app</> },
            { value: 'flat', label: <><ListTree size={14} /> Every process</> },
          ]}
        />
        <div className="toolbar-right">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, PID, publisher…" inputRef={searchRef} />
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 28 }} />
              {th('name', 'Name')}
              {th('cpu', 'CPU', 'metric-col')}
              {th('mem', 'Memory', 'metric-col')}
              {th('gpu', 'GPU', 'num')}
              {th('count', grouped === 'group' ? 'Processes' : 'PID', 'num')}
              <th style={{ width: 110 }} />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 400).map((g) => {
              const expanded = open === g.key && grouped === 'group';
              const hot = g.cpu > 25 || (tick && g.mem / tick.mem.total > 0.15);
              return (
                <Fragment key={g.key}>
                  <tr className={cx('row-click', expanded && 'expanded', hot && 'hot')} onClick={() => grouped === 'group' && setOpen(expanded ? null : g.key)}>
                    <td>{grouped === 'group' && g.count > 1 && <ChevronRight size={14} className={cx('chev', expanded && 'open')} />}</td>
                    <td>
                      <div className="name-cell">
                        <AppIcon name={g.title} />
                        <div>
                          <div className="cell-title">
                            {g.title}
                            {g.critical && <Lock size={11} className="lock" aria-label="Protected" />}
                          </div>
                          <div className="cell-sub">{g.name}.exe{g.company ? ` · ${g.company}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="metric-col">
                      <div className="metric">
                        <span className="mono">{pct(g.cpu, 1)}</span>
                        <Bar value={(g.cpu / maxCpu) * 100} color="#8b5cf6" height={4} />
                      </div>
                    </td>
                    <td className="metric-col">
                      <div className="metric">
                        <span className="mono">{bytes(g.mem)}</span>
                        <Bar value={(g.mem / maxMem) * 100} color="#22d3ee" height={4} />
                      </div>
                    </td>
                    <td className="num mono">{g.gpu > 0.05 ? pct(g.gpu, 1) : '—'}</td>
                    <td className="num mono">{grouped === 'group' ? g.count : g.procs[0].pid}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      {g.path && <button className="icon-btn" title="Show in Explorer" onClick={() => window.devpulse.reveal(g.path!)}><FolderOpen size={15} /></button>}
                      <button className="btn btn-sm btn-danger-soft" disabled={g.critical} title={g.critical ? 'Protected Windows process' : g.count > 1 ? `End all ${g.count} processes` : 'End task'} onClick={() => kill(g)}>
                        <Skull size={13} /> {g.count > 1 ? 'End all' : 'End'}
                      </button>
                    </td>
                  </tr>
                  {expanded &&
                    g.procs.map((p) => (
                      <tr key={p.pid} className="sub-row">
                        <td />
                        <td>
                          <div className="sub-name mono">
                            PID {p.pid}
                            <span className="cell-sub"> · up {since(p.start)}{p.session === 0 ? ' · service' : ''}</span>
                          </div>
                        </td>
                        <td className="metric-col mono">{pct(p.cpu, 1)}</td>
                        <td className="metric-col mono">{bytes(p.mem)}</td>
                        <td className="num mono">{p.gpu > 0.05 ? pct(p.gpu, 1) : '—'}</td>
                        <td />
                        <td className="actions">
                          <button className="icon-btn" title="Copy command line" onClick={async () => {
                            const cmd = await window.devpulse.getCommandLine(p.pid);
                            if (cmd) { navigator.clipboard.writeText(cmd); toast({ kind: 'success', title: 'Command line copied' }); }
                            else toast({ kind: 'info', title: 'Command line not available' });
                          }}><Copy size={14} /></button>
                          <button className="btn btn-sm btn-danger-soft" disabled={p.critical} onClick={() => killPids([p.pid], `${g.title} (${p.pid})`, { critical: p.critical })}>End</button>
                        </td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!procs.length && <div className="loading-rows">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" style={{ height: 48 }} />)}</div>}
      </div>
    </div>
  );
}
