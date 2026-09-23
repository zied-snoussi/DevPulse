import { useMemo } from 'react';
import {
  Activity, ArrowDown, ArrowUp, BatteryCharging, BatteryMedium, Cpu, ExternalLink, Gauge, HardDrive,
  Lightbulb, MemoryStick, MonitorSmartphone, Network, Plug, Skull, Zap,
} from 'lucide-react';
import { useStore, groupProcesses, devPorts, type ProcGroup } from '../store';
import { AreaChart, Bar, Ring, Sparkline } from '../components/charts';
import { Card, TechBadge, Skeleton } from '../components/ui';
import { useKill } from '../components/feedback';
import { bytes, loadColor, pct, rate, shortPath } from '../lib/format';
import type { Page } from '../App';

const C = {
  cpu: '#8b5cf6',
  mem: '#22d3ee',
  gpu: '#f472b6',
  disk: '#f59e0b',
  rx: '#34d399',
  tx: '#60a5fa',
};

export default function Dashboard({ go }: { go: (p: Page) => void }) {
  const { info, tick, gpu, history, procs, ports, drives, settings } = useStore();
  const { killPort, killPids } = useKill();

  const groups = useMemo(() => groupProcesses(procs), [procs]);
  const topCpu = useMemo(() => [...groups].filter((g) => g.key !== 'idle').sort((a, b) => b.cpu - a.cpu).slice(0, 6), [groups]);
  const topMem = useMemo(() => [...groups].sort((a, b) => b.mem - a.mem).slice(0, 6), [groups]);
  const dev = useMemo(() => {
    const seen = new Set<number>();
    return devPorts(ports).filter((p) => p.tech.kind === 'dev' && !seen.has(p.port) && seen.add(p.port));
  }, [ports]);

  const cpu = tick?.cpu.total ?? 0;
  const memPct = tick ? (tick.mem.used / tick.mem.total) * 100 : 0;
  const sysDrive = drives?.drives.find((d) => d.id === 'C:') || drives?.drives[0];
  const diskPct = sysDrive ? ((sysDrive.size - sysDrive.free) / sysDrive.size) * 100 : 0;
  const clock = info?.maxClock && gpu?.perf ? (info.maxClock * gpu.perf) / 100000 : null;

  const insights = useMemo(() => buildInsights({ cpu, memPct, diskPct, topCpu, topMem, devCount: dev.length, total: tick?.mem.total ?? 0 }), [cpu, memPct, diskPct, topCpu, topMem, dev.length, tick?.mem.total]);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <div className="hero">
        <div>
          <div className="hero-kicker"><span className="live-dot" /> Live · refreshing every {settings.interval / 1000}s</div>
          <h1>{greet}, {info?.user || 'dev'} 👋</h1>
          <p className="page-sub">
            {info ? <>{info.model || info.hostname} · {info.os} · {info.cpu}</> : <Skeleton w={380} />}
          </p>
        </div>
        <div className="hero-stats">
          <HeroStat label="Processes" value={procs.length || '—'} />
          <HeroStat label="Dev servers" value={dev.length} onClick={() => go('ports')} />
          <HeroStat label="Listening ports" value={new Set(ports.filter((p) => p.proto === 'TCP').map((p) => p.port)).size} onClick={() => go('ports')} />
          {drives?.battery && (
            <HeroStat
              label={drives.battery.charging ? 'Charging' : 'Battery'}
              value={<span className="row gap-4">{drives.battery.charging ? <BatteryCharging size={18} color="var(--green)" /> : <BatteryMedium size={18} />}{drives.battery.percent}%</span>}
            />
          )}
        </div>
      </div>

      <div className="grid-4">
        <StatCard icon={<Cpu size={16} />} label="CPU" color={C.cpu} value={cpu} data={history.cpu}
          detail={<>{info?.threads ?? '—'} threads{clock ? ` · ${clock.toFixed(2)} GHz` : ''}</>} />
        <StatCard icon={<MemoryStick size={16} />} label="Memory" color={C.mem} value={memPct} data={history.mem}
          detail={tick ? <>{bytes(tick.mem.used)} / {bytes(tick.mem.total, 0)}</> : '—'} />
        <StatCard icon={<MonitorSmartphone size={16} />} label="GPU" color={C.gpu} value={gpu?.gpu ?? 0} data={history.gpu}
          detail={gpu ? <>{bytes(gpu.shared + gpu.dedicated)} VRAM in use</> : 'Sampling…'} />
        <StatCard icon={<HardDrive size={16} />} label="Disk activity" color={C.disk} value={tick?.io?.diskActive ?? 0} data={history.disk}
          detail={tick?.io ? <>R {rate(tick.io.readSec)} · W {rate(tick.io.writeSec)}</> : '—'} />
      </div>

      <div className="grid-main">
        <Card title="CPU usage" icon={<Activity size={16} />} className="span-2"
          actions={<span className="big-num" style={{ color: C.cpu }}>{pct(cpu, 1)}</span>}>
          <AreaChart series={[{ label: 'CPU', data: history.cpu, color: C.cpu, format: (v) => pct(v, 1) }]} max={100} height={190} yFormat={(v) => `${v}%`} interval={settings.interval} />
          {tick && (
            <div className="cores">
              {tick.cpu.cores.map((c, i) => (
                <div key={i} className="core" title={`Core ${i}: ${pct(c, 1)}`}>
                  <div className="core-fill" style={{ height: `${Math.max(2, c)}%`, background: loadColor(c) }} />
                  <span>{i}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Memory" icon={<MemoryStick size={16} />}>
          <div className="mem-ring">
            <Ring value={memPct} size={132} stroke={12} color={C.mem}>
              <div className="ring-num">{pct(memPct)}</div>
              <div className="ring-sub">used</div>
            </Ring>
            <div className="kv-list">
              <KV label="In use" value={tick ? bytes(tick.mem.used) : '—'} dot={C.mem} />
              <KV label="Available" value={tick ? bytes(tick.mem.free) : '—'} />
              <KV label="Committed" value={gpu?.commitLimit ? `${(gpu.committed / 1024 ** 3).toFixed(0)} / ${bytes(gpu.commitLimit, 0)}` : '—'} />
              <KV label="Cached" value={gpu ? bytes(gpu.cache) : '—'} />
            </div>
          </div>
          <AreaChart series={[{ label: 'Memory', data: history.mem, color: C.mem, format: (v) => pct(v, 1) }]} max={100} height={86} axis={false} interval={settings.interval} />
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Network" icon={<Network size={16} />}
          actions={
            <div className="legend">
              <span><ArrowDown size={13} color={C.rx} /> {rate(tick?.io?.rxSec ?? 0)}</span>
              <span><ArrowUp size={13} color={C.tx} /> {rate(tick?.io?.txSec ?? 0)}</span>
            </div>
          }>
          <AreaChart
            series={[
              { label: 'Download', data: history.rx, color: C.rx, format: rate },
              { label: 'Upload', data: history.tx, color: C.tx, format: rate },
            ]}
            height={170}
            yFormat={(v) => bytes(v, 0)}
            interval={settings.interval}
          />
        </Card>
        <Card title="Disk I/O" icon={<HardDrive size={16} />}
          actions={
            <div className="legend">
              <span><i className="dot" style={{ background: C.disk }} /> Read {rate(tick?.io?.readSec ?? 0)}</span>
              <span><i className="dot" style={{ background: C.gpu }} /> Write {rate(tick?.io?.writeSec ?? 0)}</span>
            </div>
          }>
          <AreaChart
            series={[
              { label: 'Read', data: history.read, color: C.disk, format: rate },
              { label: 'Write', data: history.write, color: C.gpu, format: rate },
            ]}
            height={170}
            yFormat={(v) => bytes(v, 0)}
            interval={settings.interval}
          />
        </Card>
      </div>

      <div className="grid-3">
        <Card title="Top CPU consumers" icon={<Zap size={16} />} actions={<button className="link" onClick={() => go('processes')}>View all</button>} pad={false}>
          <HogList groups={topCpu} metric="cpu" onKill={(g) => killPids(g.procs.map((p) => p.pid), g.title, { critical: g.critical })} />
        </Card>
        <Card title="Top memory consumers" icon={<MemoryStick size={16} />} actions={<button className="link" onClick={() => go('processes')}>View all</button>} pad={false}>
          <HogList groups={topMem} metric="mem" total={tick?.mem.total} onKill={(g) => killPids(g.procs.map((p) => p.pid), g.title, { critical: g.critical })} />
        </Card>
        <Card title="Running dev servers" icon={<Plug size={16} />} actions={<button className="link" onClick={() => go('ports')}>Manage ports</button>} pad={false}>
          {dev.length === 0 ? (
            <div className="mini-empty">
              <Plug size={22} />
              <div>No dev servers running</div>
              <small>Start <code>ng serve</code>, <code>npm run dev</code>… and they'll show up here.</small>
            </div>
          ) : (
            <div className="list">
              {dev.slice(0, 7).map((p) => (
                <div key={p.id} className="list-row">
                  <div className="port-pill">:{p.port}</div>
                  <div className="list-main">
                    <div className="row gap-6"><TechBadge tech={p.tech} /></div>
                    <div className="list-sub" title={p.project || p.path || ''}>{p.project ? shortPath(p.project, 34) : `${p.name} · PID ${p.pid}`}</div>
                  </div>
                  <button className="icon-btn" title={`Open http://localhost:${p.port}`} onClick={() => window.devpulse.openUrl(`http://localhost:${p.port}`)}><ExternalLink size={15} /></button>
                  <button className="icon-btn danger" title={`Kill port ${p.port}`} onClick={() => killPort(p.port, `${p.tech.label} (${p.name} · PID ${p.pid})`)}><Skull size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Insights" icon={<Lightbulb size={16} />} pad={false}>
          <div className="insights">
            {insights.map((i, k) => (
              <div key={k} className={`insight insight-${i.level}`}>
                <span className="insight-dot" />
                <div>
                  <div className="insight-title">{i.title}</div>
                  <div className="insight-body">{i.body}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Storage" icon={<HardDrive size={16} />}>
          <div className="drives">
            {drives?.drives.map((d) => {
              const used = d.size - d.free;
              const p = (used / d.size) * 100;
              return (
                <div key={d.id} className="drive">
                  <div className="drive-head">
                    <b>{d.id}</b> <span className="muted">{d.label || 'Local Disk'} · {d.fs}</span>
                    <span className="drive-right">{bytes(d.free)} free of {bytes(d.size, 0)}</span>
                  </div>
                  <Bar value={p} color={p > 90 ? 'var(--red)' : p > 75 ? 'var(--amber)' : 'linear-gradient(90deg, #f59e0b, #f97316)'} height={10} />
                </div>
              );
            }) ?? <Skeleton h={40} />}
          </div>
          <div className="spec-grid">
            <Spec icon={<Cpu size={14} />} label="Processor" value={info?.cpu} />
            <Spec icon={<MonitorSmartphone size={14} />} label="Graphics" value={info?.gpus.map((g) => g.name).join(', ')} />
            <Spec icon={<MemoryStick size={14} />} label="Installed RAM" value={info ? bytes(info.totalMem, 0) : undefined} />
            <Spec icon={<Gauge size={14} />} label="Windows" value={info ? `${info.os?.replace('Microsoft ', '')} · build ${info.build}` : undefined} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function HeroStat({ label, value, onClick }: { label: string; value: React.ReactNode; onClick?: () => void }) {
  return (
    <button className="hero-stat" onClick={onClick} disabled={!onClick}>
      <div className="hero-stat-value">{value}</div>
      <div className="hero-stat-label">{label}</div>
    </button>
  );
}

function StatCard({ icon, label, value, data, color, detail }: {
  icon: React.ReactNode; label: string; value: number; data: number[]; color: string; detail: React.ReactNode;
}) {
  return (
    <div className="stat" style={{ ['--c' as string]: color }}>
      <div className="stat-top">
        <div className="stat-label"><span className="stat-icon">{icon}</span>{label}</div>
        <div className="stat-value">{pct(value)}</div>
      </div>
      <div className="stat-detail">{detail}</div>
      <div className="stat-spark"><Sparkline data={data.slice(-60)} color={color} max={100} height={46} /></div>
    </div>
  );
}

function KV({ label, value, dot }: { label: string; value: React.ReactNode; dot?: string }) {
  return (
    <div className="kv">
      <span>{dot && <i className="dot" style={{ background: dot }} />}{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Spec({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }) {
  return (
    <div className="spec">
      <div className="spec-label">{icon}{label}</div>
      <div className="spec-value" title={value}>{value || '—'}</div>
    </div>
  );
}

function HogList({ groups, metric, total, onKill }: { groups: ProcGroup[]; metric: 'cpu' | 'mem'; total?: number; onKill: (g: ProcGroup) => void }) {
  if (!groups.length) return <div className="card-body"><Skeleton h={180} /></div>;
  const max = Math.max(...groups.map((g) => (metric === 'cpu' ? g.cpu : g.mem)), metric === 'cpu' ? 5 : 1);
  return (
    <div className="list">
      {groups.map((g) => {
        const v = metric === 'cpu' ? g.cpu : g.mem;
        return (
          <div key={g.key} className="list-row hog">
            <AppIcon name={g.title} />
            <div className="list-main">
              <div className="row between">
                <span className="list-title" title={g.path || g.name}>{g.title}</span>
                <b className="mono">{metric === 'cpu' ? pct(v, 1) : bytes(v)}</b>
              </div>
              <div className="row between gap-8">
                <Bar value={(v / max) * 100} color={metric === 'cpu' ? C.cpu : C.mem} height={4} />
                <span className="list-sub nowrap">{g.count > 1 ? `${g.count} procs` : `PID ${g.procs[0].pid}`}{metric === 'mem' && total ? ` · ${pct((v / total) * 100)}` : ''}</span>
              </div>
            </div>
            <button className="icon-btn danger hover-only" title={g.critical ? 'Protected system process' : `End ${g.title}`} disabled={g.critical} onClick={() => onKill(g)}>
              <Skull size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function AppIcon({ name }: { name: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <div className="app-icon" style={{ background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 70% 45%))` }}>
      {name.replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || '?'}
    </div>
  );
}

function buildInsights({ cpu, memPct, diskPct, topCpu, topMem, devCount, total }: {
  cpu: number; memPct: number; diskPct: number; topCpu: ProcGroup[]; topMem: ProcGroup[]; devCount: number; total: number;
}) {
  const out: { level: 'good' | 'warn' | 'bad' | 'info'; title: string; body: string }[] = [];
  if (cpu > 85) out.push({ level: 'bad', title: `CPU is under heavy load (${pct(cpu)})`, body: topCpu[0] ? `${topCpu[0].title} is the biggest consumer at ${pct(topCpu[0].cpu, 1)}.` : 'Check the processes list.' });
  else if (cpu > 60) out.push({ level: 'warn', title: `CPU is busy (${pct(cpu)})`, body: topCpu[0] ? `${topCpu[0].title} uses ${pct(topCpu[0].cpu, 1)}.` : '' });
  if (memPct > 85) out.push({ level: 'bad', title: `Memory is almost full (${pct(memPct)})`, body: `Close ${topMem[0]?.title ?? 'heavy apps'} to free ${bytes(topMem[0]?.mem ?? 0)}.` });
  else if (memPct > 70) out.push({ level: 'warn', title: `Memory pressure is rising (${pct(memPct)})`, body: `${topMem[0]?.title ?? 'Top app'} holds ${bytes(topMem[0]?.mem ?? 0)}.` });
  const heavy = topMem.find((g) => g.count >= 10 && total && g.mem / total > 0.08);
  if (heavy) out.push({ level: 'info', title: `${heavy.title} runs ${heavy.count} processes`, body: `Together they use ${bytes(heavy.mem)} of RAM (${pct((heavy.mem / total) * 100)}).` });
  if (diskPct > 90) out.push({ level: 'bad', title: `System drive is ${pct(diskPct)} full`, body: 'Clear node_modules, build caches or Docker images to reclaim space.' });
  if (devCount >= 4) out.push({ level: 'info', title: `${devCount} dev servers are running`, body: 'Forgotten servers eat RAM. Kill the ones you are not using from the Ports page.' });
  if (!out.length) out.push({ level: 'good', title: 'Everything looks healthy', body: `CPU ${pct(cpu)}, memory ${pct(memPct)}, no heavy hogs detected.` });
  return out;
}

