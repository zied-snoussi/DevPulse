export interface Tick {
  t: number;
  cpu: { total: number; cores: number[] };
  mem: { total: number; free: number; used: number };
  io: {
    rxSec: number; txSec: number; readSec: number; writeSec: number;
    diskActive: number; rxTotal: number; txTotal: number;
  } | null;
}

export interface GpuSample {
  gpu: number;
  procs: Record<string, number>;
  dedicated: number;
  shared: number;
  perf: number;
  committed: number;
  commitLimit: number;
  cache: number;
}

export interface Proc {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
  gpu: number;
  session: number;
  path: string | null;
  desc: string | null;
  company: string | null;
  start: string | null;
  critical: boolean;
}

export type TechKind = 'dev' | 'db' | 'infra' | 'app' | 'system';

export interface Port {
  id: string;
  proto: 'TCP' | 'UDP';
  port: number;
  pid: number;
  addrs: string[];
  conns: number;
  name: string;
  title: string;
  path: string | null;
  cmd: string;
  service: string;
  project: string | null;
  started: string | null;
  mem: number;
  cpu: number;
  tech: { label: string; kind: TechKind; color: string };
  scope: 'local' | 'network';
  critical: boolean;
}

export interface StaticInfo {
  hostname: string;
  user: string;
  arch: string;
  totalMem: number;
  manufacturer?: string;
  model?: string;
  os?: string;
  osVersion?: string;
  build?: string;
  cpu: string;
  cores?: number;
  threads: number;
  maxClock?: number;
  gpus: { name: string; ram: number; driver: string }[];
  admin?: boolean;
}

export interface Drive { id: string; label: string; fs: string; size: number; free: number }
export interface DrivesInfo { drives: Drive[]; battery: { percent: number; charging: boolean } | null }

export interface KillResult { ok: boolean; pid: number; error?: string; needsAdmin?: boolean; message?: string }
export interface KillPortResult { ok: boolean; port: number; error?: string; needsAdmin?: boolean; results: KillResult[] }

export interface DevPulseApi {
  getStatic(): Promise<StaticInfo>;
  getDrives(force?: boolean): Promise<DrivesInfo>;
  listPorts(): Promise<Port[]>;
  killPort(port: number): Promise<KillPortResult>;
  killPid(pid: number, tree?: boolean): Promise<KillResult>;
  killPids(pids: number[]): Promise<KillResult[]>;
  getCommandLine(pid: number): Promise<string>;
  openUrl(url: string): Promise<void>;
  reveal(path: string): Promise<void>;
  setInterval(ms: number): Promise<void>;
  setTheme(theme: 'dark' | 'light'): Promise<void>;
  setAlwaysOnTop(on: boolean): Promise<void>;
  systemTheme(): Promise<'dark' | 'light'>;
  relaunchAsAdmin(): Promise<boolean>;
  onTick(cb: (t: Tick) => void): () => void;
  onProcesses(cb: (p: Proc[]) => void): () => void;
  onGpu(cb: (g: GpuSample) => void): () => void;
}

declare global {
  interface Window { devpulse: DevPulseApi }
}
