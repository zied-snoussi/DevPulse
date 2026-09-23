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

export type RiskLevel = 'high' | 'medium' | 'low' | 'ok';
export interface Reason { text: string; kind?: string; pts: number }

export interface Finding {
  pid: number;
  pids: number[];
  name: string;
  path: string | null;
  cmd: string;
  ppid: number;
  parent: string | null;
  signer: string | null;
  signature: string;
  cpu: number;
  mem: number;
  connections: { ip: string; port: number }[];
  score: number;
  level: Exclude<RiskLevel, 'ok'>;
  reasons: Reason[];
}

export interface StartupItem {
  name: string;
  command: string;
  location: string;
  user: string;
  path: string | null;
  signer: string | null;
  signature: string;
  score: number;
  level: RiskLevel;
  reasons: Reason[];
}

export interface DefenderInfo {
  available: boolean;
  mode?: string;
  realtime?: boolean;
  antivirus?: boolean;
  tamper?: boolean;
  sigUpdated?: string | null;
  quickScan?: string | null;
  threats?: { name: string | null; time: string; process: string | null; resources: string[]; resolved: boolean }[];
}

export interface SecurityReport {
  at: string;
  ms: number;
  scanned: number;
  files: number;
  unsigned: number;
  externalConnections: number;
  findings: Finding[];
  startup: StartupItem[];
  defender: DefenderInfo;
}

export interface ScanProgress { step: string; pct: number }
export interface DefenderResult { ok: boolean; clean?: boolean; threat?: string; error?: string; output?: string }

export type TweakId = 'gameMode' | 'noGameDvr' | 'noTransparency' | 'noAnimations' | 'noMouseAccel' | 'noBackgroundApps' | 'longPaths' | 'devMode' | 'hags';
export type PowerMode = 'efficiency' | 'balanced' | 'performance';

export interface OptimizerState {
  tweaks: Record<TweakId, { enabled: boolean; supported: boolean }>;
  meta: Record<TweakId, { title: string; why: string; admin: boolean; restart: string | null }>;
  power: { mode: PowerMode; activePlan: { guid: string; name: string } | null; hasHighPerfPlan: boolean };
  git: { installed: boolean; value: boolean };
  temp: { dir: string; size: number; files: number };
  battery: boolean;
  onAc: boolean;
  startupCount: number;
  wslRunning: boolean;
  backedUp: string[];
}

export type Change = { id: TweakId | 'power' | 'gitLongPaths'; value: boolean | PowerMode };
export interface ChangeResult { id: string; ok: boolean; error?: string }

export interface UpdateStatus {
  state: 'dev' | 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error';
  version: string;
  available?: string;
  notes?: string | null;
  percent?: number;
  bytesPerSecond?: number;
  checkedAt?: string;
  error?: string;
}

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
  securityScan(): Promise<SecurityReport>;
  defenderScanFile(file: string): Promise<DefenderResult>;
  defenderQuickScan(): Promise<DefenderResult>;
  fileHash(file: string): Promise<string | null>;
  onScanProgress(cb: (p: ScanProgress) => void): () => void;
  optimizerState(): Promise<OptimizerState>;
  applyTweaks(changes: Change[]): Promise<ChangeResult[]>;
  revertTweaks(ids: string[]): Promise<{ ok: boolean; reverted: string[] }>;
  cleanTemp(): Promise<{ ok: boolean; freed: number; removed: number; skipped: number }>;
  wslShutdown(): Promise<{ ok: boolean; error?: string }>;
  appVersion(): Promise<string>;
  updateStatus(): Promise<UpdateStatus>;
  checkForUpdate(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
  onTick(cb: (t: Tick) => void): () => void;
  onProcesses(cb: (p: Proc[]) => void): () => void;
  onGpu(cb: (g: GpuSample) => void): () => void;
}

declare global {
  interface Window { devpulse: DevPulseApi }
}
