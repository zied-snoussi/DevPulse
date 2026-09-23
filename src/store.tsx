import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DrivesInfo, GpuSample, Port, Proc, StaticInfo, Tick } from './types';

export const HISTORY = 120;

export interface Settings {
  interval: number;
  theme: 'dark' | 'light' | 'system';
  alwaysOnTop: boolean;
  confirmKill: boolean;
  showUdp: boolean;
}

const DEFAULT_SETTINGS: Settings = { interval: 1000, theme: 'dark', alwaysOnTop: false, confirmKill: true, showUdp: false };

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('devpulse.settings') || '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export interface History {
  t: number[];
  cpu: number[];
  mem: number[];
  gpu: number[];
  rx: number[];
  tx: number[];
  read: number[];
  write: number[];
  disk: number[];
}

const emptyHistory = (): History => ({ t: [], cpu: [], mem: [], gpu: [], rx: [], tx: [], read: [], write: [], disk: [] });

interface Store {
  info: StaticInfo | null;
  drives: DrivesInfo | null;
  tick: Tick | null;
  gpu: GpuSample | null;
  procs: Proc[];
  ports: Port[];
  portsLoaded: boolean;
  history: History;
  settings: Settings;
  resolvedTheme: 'dark' | 'light';
  setSettings(patch: Partial<Settings>): void;
  refreshPorts(): Promise<void>;
}

const Ctx = createContext<Store | null>(null);

const push = (arr: number[], v: number) => {
  const next = arr.length >= HISTORY ? arr.slice(1) : arr.slice();
  next.push(v);
  return next;
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const api = window.devpulse;
  const [info, setInfo] = useState<StaticInfo | null>(null);
  const [drives, setDrives] = useState<DrivesInfo | null>(null);
  const [tick, setTick] = useState<Tick | null>(null);
  const [gpu, setGpu] = useState<GpuSample | null>(null);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [ports, setPorts] = useState<Port[]>([]);
  const [portsLoaded, setPortsLoaded] = useState(false);
  const [history, setHistory] = useState<History>(emptyHistory);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(
    window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  );
  const gpuRef = useRef(0);

  const resolvedTheme = settings.theme === 'system' ? systemTheme : settings.theme;

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((s) => {
      const next = { ...s, ...patch };
      try { localStorage.setItem('devpulse.settings', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const fn = () => setSystemTheme(mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    api.setTheme(resolvedTheme).catch(() => {});
  }, [resolvedTheme, api]);

  useEffect(() => { api.setInterval(settings.interval).catch(() => {}); }, [settings.interval, api]);
  useEffect(() => { api.setAlwaysOnTop(settings.alwaysOnTop).catch(() => {}); }, [settings.alwaysOnTop, api]);

  useEffect(() => {
    api.getStatic().then(setInfo, (e) => console.warn('getStatic failed', e));
    const loadDrives = () => api.getDrives().then(setDrives, () => {});
    loadDrives();
    const id = window.setInterval(loadDrives, 30000);

    const offTick = api.onTick((t) => {
      setTick(t);
      setHistory((h) => ({
        t: push(h.t, t.t),
        cpu: push(h.cpu, t.cpu.total),
        mem: push(h.mem, (t.mem.used / t.mem.total) * 100),
        gpu: push(h.gpu, gpuRef.current),
        rx: push(h.rx, t.io?.rxSec ?? 0),
        tx: push(h.tx, t.io?.txSec ?? 0),
        read: push(h.read, t.io?.readSec ?? 0),
        write: push(h.write, t.io?.writeSec ?? 0),
        disk: push(h.disk, t.io?.diskActive ?? 0),
      }));
    });
    const offProcs = api.onProcesses(setProcs);
    const offGpu = api.onGpu((g) => {
      gpuRef.current = g.gpu;
      setGpu(g);
    });
    return () => { offTick(); offProcs(); offGpu(); window.clearInterval(id); };
  }, [api]);

  const refreshPorts = useCallback(async () => {
    try {
      setPorts(await api.listPorts());
    } catch (e) {
      console.warn('listPorts failed', e);
    } finally {
      setPortsLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    refreshPorts();
    const id = window.setInterval(() => { if (!document.hidden) refreshPorts(); }, 3000);
    return () => window.clearInterval(id);
  }, [refreshPorts]);

  const value = useMemo<Store>(
    () => ({ info, drives, tick, gpu, procs, ports, portsLoaded, history, settings, resolvedTheme, setSettings, refreshPorts }),
    [info, drives, tick, gpu, procs, ports, portsLoaded, history, settings, resolvedTheme, setSettings, refreshPorts]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

/* ------------------------------------------------------ process groups */

export interface ProcGroup {
  key: string;
  name: string;
  title: string;
  company: string | null;
  path: string | null;
  count: number;
  cpu: number;
  mem: number;
  gpu: number;
  critical: boolean;
  procs: Proc[];
}

export function groupProcesses(procs: Proc[]): ProcGroup[] {
  const map = new Map<string, ProcGroup>();
  for (const p of procs) {
    const key = p.name.toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = { key, name: p.name, title: p.desc || p.name, company: p.company, path: p.path, count: 0, cpu: 0, mem: 0, gpu: 0, critical: false, procs: [] };
      map.set(key, g);
    }
    g.count++;
    g.cpu += p.cpu;
    g.mem += p.mem;
    g.gpu += p.gpu;
    g.critical ||= p.critical;
    if (!g.path && p.path) g.path = p.path;
    if (g.title === g.name && p.desc) g.title = p.desc;
    if (!g.company && p.company) g.company = p.company;
    g.procs.push(p);
  }
  for (const g of map.values()) {
    g.cpu = Math.min(100, g.cpu);
    g.procs.sort((a, b) => b.cpu - a.cpu || b.mem - a.mem);
  }
  return [...map.values()];
}

/** Unique dev-ish TCP ports, one entry per port+pid (IPv4/IPv6 merged by backend). */
export function devPorts(ports: Port[]) {
  return ports.filter((p) => p.proto === 'TCP' && (p.tech.kind === 'dev' || p.tech.kind === 'db' || p.tech.kind === 'infra'));
}
