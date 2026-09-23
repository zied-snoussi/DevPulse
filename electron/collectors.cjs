// System data collection for Windows: metrics, processes, ports, and killing.
const os = require('node:os');
const { execFile } = require('node:child_process');
const { PsHost } = require('./psHost.cjs');
const { detect, projectFromCmd, isCritical } = require('./detect.cjs');

const fast = new PsHost('fast'); // frequent cheap queries
const slow = new PsHost('slow'); // heavier perf counters (GPU) and enrichment

function run(file, args, timeout = 10000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code ?? 1 : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const psEscape = (s) => String(s).replace(/'/g, "''");

/* ------------------------------------------------------------------ CPU */

let prevCpu = os.cpus();
function sampleCpu() {
  const now = os.cpus();
  const cores = now.map((c, i) => {
    const p = prevCpu[i] || c;
    const idle = c.times.idle - p.times.idle;
    const total = Object.values(c.times).reduce((a, b) => a + b, 0) - Object.values(p.times).reduce((a, b) => a + b, 0);
    return total > 0 ? Math.max(0, Math.min(100, 100 * (1 - idle / total))) : 0;
  });
  prevCpu = now;
  const total = cores.reduce((a, b) => a + b, 0) / (cores.length || 1);
  return { total, cores };
}

/* --------------------------------------------------- Network + disk I/O */

let prevIo = null;
const IO_SCRIPT = `
$n = Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface -Property Name,BytesReceivedPersec,BytesSentPersec
$d = Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk -Filter "Name='_Total'" -Property DiskReadBytesPersec,DiskWriteBytesPersec,PercentIdleTime,Timestamp_Sys100NS
[pscustomobject]@{
  rx = [double](($n | Where-Object { $_.Name -notmatch 'isatap|Loopback|Teredo' } | Measure-Object BytesReceivedPersec -Sum).Sum)
  tx = [double](($n | Where-Object { $_.Name -notmatch 'isatap|Loopback|Teredo' } | Measure-Object BytesSentPersec -Sum).Sum)
  dr = [double]$d.DiskReadBytesPersec; dw = [double]$d.DiskWriteBytesPersec
  di = [double]$d.PercentIdleTime; dt = [double]$d.Timestamp_Sys100NS
} | ConvertTo-Json -Compress`;

async function sampleIo() {
  const cur = await fast.json(IO_SCRIPT);
  if (!cur) return null;
  cur.t = Date.now();
  const prev = prevIo;
  prevIo = cur;
  if (!prev) return { rxSec: 0, txSec: 0, readSec: 0, writeSec: 0, diskActive: 0, rxTotal: cur.rx, txTotal: cur.tx };
  const dt = Math.max(0.001, (cur.t - prev.t) / 1000);
  const rate = (a, b) => Math.max(0, (a - b) / dt);
  const idleDelta = cur.dt - prev.dt > 0 ? (cur.di - prev.di) / (cur.dt - prev.dt) : 1;
  return {
    rxSec: rate(cur.rx, prev.rx),
    txSec: rate(cur.tx, prev.tx),
    readSec: rate(cur.dr, prev.dr),
    writeSec: rate(cur.dw, prev.dw),
    diskActive: Math.max(0, Math.min(100, 100 - idleDelta * 100)),
    rxTotal: cur.rx,
    txTotal: cur.tx,
  };
}

/* ------------------------------------------------------------ GPU + misc */

const GPU_SCRIPT = `
$e = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Property Name,UtilizationPercentage
$eng = @{}; $proc = @{}
foreach ($x in $e) {
  if ($x.UtilizationPercentage -le 0) { continue }
  if ($x.Name -match 'pid_(\\d+)_.*(luid_\\w+_\\w+_phys_\\d+_eng_\\d+)_engtype_(\\w+)') {
    $k = $matches[2]; $eng[$k] = [double]$eng[$k] + $x.UtilizationPercentage
    $p = $matches[1]; $proc[$p] = [double]$proc[$p] + $x.UtilizationPercentage
  }
}
$m = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -Property DedicatedUsage,SharedUsage
$pi = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'" -Property PercentProcessorPerformance
$mem = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -Property CommittedBytes,CommitLimit,CacheBytes
[pscustomobject]@{
  gpu = [double](($eng.Values | Measure-Object -Maximum).Maximum)
  procs = $proc
  dedicated = [double](($m | Measure-Object DedicatedUsage -Sum).Sum)
  shared = [double](($m | Measure-Object SharedUsage -Sum).Sum)
  perf = [double]$pi.PercentProcessorPerformance
  committed = [double]$mem.CommittedBytes; commitLimit = [double]$mem.CommitLimit; cache = [double]$mem.CacheBytes
} | ConvertTo-Json -Compress -Depth 3`;

let lastGpu = { gpu: 0, procs: {}, dedicated: 0, shared: 0, perf: 0, committed: 0, commitLimit: 0, cache: 0 };
async function sampleGpu() {
  try {
    const r = await slow.json(GPU_SCRIPT, 20000);
    if (r) lastGpu = { ...r, gpu: Math.min(100, r.gpu || 0), procs: r.procs || {} };
  } catch {}
  return lastGpu;
}

/* -------------------------------------------------------------- Static */

let staticCache = null;
const STATIC_SCRIPT = `
$cs = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpu = Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name = $_.Name; ram = [double]$_.AdapterRAM; driver = $_.DriverVersion } }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{
  manufacturer = $cs.Manufacturer; model = $cs.Model
  os = $os.Caption; osVersion = $os.Version; build = $os.BuildNumber
  cpu = $cpu.Name.Trim(); cores = $cpu.NumberOfCores; threads = $cpu.NumberOfLogicalProcessors; maxClock = $cpu.MaxClockSpeed
  gpus = @($gpu); admin = $admin
} | ConvertTo-Json -Compress -Depth 3`;

async function getStatic() {
  if (staticCache) return staticCache;
  let r = {};
  try { r = (await fast.json(STATIC_SCRIPT, 30000)) || {}; } catch {}
  staticCache = {
    hostname: os.hostname(),
    user: os.userInfo().username,
    arch: os.arch(),
    totalMem: os.totalmem(),
    ...r,
    gpus: asArray(r.gpus),
    cpu: r.cpu || os.cpus()[0]?.model,
    threads: r.threads || os.cpus().length,
  };
  return staticCache;
}

const DRIVES_SCRIPT = `
$d = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { [pscustomobject]@{ id = $_.DeviceID; label = $_.VolumeName; fs = $_.FileSystem; size = [double]$_.Size; free = [double]$_.FreeSpace } }
$b = Get-CimInstance Win32_Battery | Select-Object -First 1
[pscustomobject]@{
  drives = @($d)
  battery = if ($b) { [pscustomobject]@{ percent = [int]$b.EstimatedChargeRemaining; charging = ($b.BatteryStatus -eq 2 -or $b.BatteryStatus -ge 6) } } else { $null }
} | ConvertTo-Json -Compress -Depth 3`;

let drivesCache = { drives: [], battery: null, t: 0 };
async function getDrives(force = false) {
  if (!force && Date.now() - drivesCache.t < 20000) return drivesCache;
  try {
    const r = await fast.json(DRIVES_SCRIPT);
    drivesCache = { drives: asArray(r?.drives), battery: r?.battery || null, t: Date.now() };
  } catch {}
  return drivesCache;
}

/* ----------------------------------------------------------- Processes */

const PROC_SCRIPT = `Get-Process | ForEach-Object { [pscustomobject]@{ i = $_.Id; n = $_.ProcessName; c = $_.CPU; m = $_.WorkingSet64; s = $_.SessionId } } | ConvertTo-Json -Compress`;
const detailCache = new Map(); // pid -> { name, path, desc, start }
let prevProc = new Map(); // pid -> cpu seconds
let prevProcT = 0;
let procCache = [];

async function fetchDetails(pids) {
  if (!pids.length) return;
  for (let i = 0; i < pids.length; i += 200) {
    const chunk = pids.slice(i, i + 200);
    try {
      const rows = asArray(await fast.json(
        `Get-Process -Id ${chunk.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ i = $_.Id; p = $_.Path; d = $_.Description; co = $_.Company; st = if ($_.StartTime) { $_.StartTime.ToUniversalTime().ToString('o') } else { $null } } } | ConvertTo-Json -Compress`,
        20000
      ));
      for (const r of rows) detailCache.set(r.i, { path: r.p || null, desc: r.d || null, company: r.co || null, start: r.st || null });
    } catch {}
    for (const pid of chunk) if (!detailCache.has(pid)) detailCache.set(pid, { path: null, desc: null, company: null, start: null });
  }
}

async function sampleProcesses() {
  const rows = asArray(await fast.json(PROC_SCRIPT));
  const now = Date.now();
  const dt = prevProcT ? (now - prevProcT) / 1000 : 0;
  const ncpu = os.cpus().length;
  const next = new Map();
  const alive = new Set();
  const missing = [];
  const out = [];
  for (const r of rows) {
    if (r.i === 0) continue; // Idle
    alive.add(r.i);
    const cpuSec = typeof r.c === 'number' ? r.c : null;
    if (cpuSec != null) next.set(r.i, cpuSec);
    const prev = prevProc.get(r.i);
    const cpu = dt > 0 && cpuSec != null && prev != null ? Math.max(0, Math.min(100, ((cpuSec - prev) / dt / ncpu) * 100)) : 0;
    if (!detailCache.has(r.i)) missing.push(r.i);
    out.push({ pid: r.i, name: r.n, cpu, mem: r.m || 0, session: r.s });
  }
  prevProc = next;
  prevProcT = now;
  for (const pid of detailCache.keys()) if (!alive.has(pid)) detailCache.delete(pid);
  await fetchDetails(missing);
  const gpuProcs = lastGpu.procs || {};
  procCache = out.map((p) => {
    const d = detailCache.get(p.pid) || {};
    return { ...p, path: d.path, desc: d.desc, company: d.company, start: d.start, gpu: Math.min(100, gpuProcs[p.pid] || 0), critical: isCritical(p.pid, p.name) };
  });
  return procCache;
}

/* --------------------------------------------------------------- Ports */

const cmdCache = new Map(); // `${pid}:${name}` -> { cmd, parent, created, service }

function splitAddr(s) {
  const i = s.lastIndexOf(':');
  return { addr: s.slice(0, i).replace(/^\[|\]$/g, ''), port: Number(s.slice(i + 1)) };
}

async function getPorts() {
  const { stdout } = await run('netstat', ['-ano']);
  const listen = new Map(); // key proto:port:pid
  const established = [];
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'TCP' && parts.length >= 5) {
      const [, local, remote, state, pid] = parts;
      const l = splitAddr(local);
      if (state === 'LISTENING') {
        const key = `TCP:${l.port}:${pid}`;
        const e = listen.get(key) || { proto: 'TCP', port: l.port, pid: Number(pid), addrs: [], conns: 0 };
        if (!e.addrs.includes(l.addr)) e.addrs.push(l.addr);
        listen.set(key, e);
      } else if (state === 'ESTABLISHED') {
        established.push({ port: l.port, pid: Number(pid), remote: splitAddr(remote) });
      }
    } else if (parts[0] === 'UDP' && parts.length >= 4) {
      const l = splitAddr(parts[1]);
      const pid = parts[parts.length - 1];
      const key = `UDP:${l.port}:${pid}`;
      const e = listen.get(key) || { proto: 'UDP', port: l.port, pid: Number(pid), addrs: [], conns: 0 };
      if (!e.addrs.includes(l.addr)) e.addrs.push(l.addr);
      listen.set(key, e);
    }
  }
  for (const c of established) {
    const e = listen.get(`TCP:${c.port}:${c.pid}`);
    if (e) e.conns++;
  }

  const entries = [...listen.values()];
  const procByPid = new Map(procCache.map((p) => [p.pid, p]));
  const pids = [...new Set(entries.map((e) => e.pid))];

  // Enrich with command lines / services for PIDs we have not seen yet.
  const need = pids.filter((pid) => {
    const name = procByPid.get(pid)?.name || '';
    return pid > 4 && !cmdCache.has(`${pid}:${name}`);
  });
  if (need.length) {
    const filter = need.map((p) => `ProcessId=${p}`).join(' OR ');
    try {
      const r = await slow.json(
        `$p = Get-CimInstance Win32_Process -Filter '${psEscape(filter)}' | ForEach-Object { [pscustomobject]@{ i = $_.ProcessId; n = $_.Name; c = $_.CommandLine; pp = $_.ParentProcessId; e = $_.ExecutablePath; t = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null } } }
$s = Get-CimInstance Win32_Service -Filter '${psEscape(filter)}' | ForEach-Object { [pscustomobject]@{ i = $_.ProcessId; n = $_.DisplayName } }
[pscustomobject]@{ p = @($p); s = @($s) } | ConvertTo-Json -Compress -Depth 3`,
        20000
      );
      const services = new Map();
      for (const s of asArray(r?.s)) services.set(s.i, [...(services.get(s.i) || []), s.n]);
      for (const p of asArray(r?.p)) {
        const name = procByPid.get(p.i)?.name || String(p.n || '').replace(/\.exe$/i, '');
        cmdCache.set(`${p.i}:${name}`, { cmd: p.c || '', parent: p.pp, exe: p.e, created: p.t, services: services.get(p.i) || [] });
      }
    } catch {}
    for (const pid of need) {
      const name = procByPid.get(pid)?.name || '';
      if (!cmdCache.has(`${pid}:${name}`)) cmdCache.set(`${pid}:${name}`, { cmd: '', services: [] });
    }
  }

  return entries
    .map((e) => {
      const p = procByPid.get(e.pid) || {};
      const name = e.pid === 4 ? 'System' : p.name || (e.pid === 0 ? 'System Idle' : `PID ${e.pid}`);
      const extra = cmdCache.get(`${e.pid}:${p.name || ''}`) || {};
      const service = extra.services?.length ? extra.services.join(', ') : '';
      const det = detect({ name, cmd: extra.cmd, port: e.port, service });
      const local = e.addrs.every((a) => a === '127.0.0.1' || a === '::1');
      return {
        id: `${e.proto}:${e.port}:${e.pid}`,
        ...e,
        name,
        title: p.desc || name,
        path: p.path || extra.exe || null,
        cmd: extra.cmd || '',
        service,
        project: projectFromCmd(extra.cmd),
        started: p.start || extra.created || null,
        mem: p.mem || 0,
        cpu: p.cpu || 0,
        tech: det,
        scope: local ? 'local' : 'network',
        critical: isCritical(e.pid, name),
      };
    })
    .sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto));
}

/* ---------------------------------------------------------------- Kill */

async function killPid(pid, { tree = true } = {}) {
  pid = Number(pid);
  const p = procCache.find((x) => x.pid === pid);
  if (!pid || isCritical(pid, p?.name)) {
    return { ok: false, pid, error: `${p?.name || 'This process'} is a critical Windows process and is protected.` };
  }
  const args = ['/PID', String(pid), '/F'];
  if (tree) args.push('/T');
  const r = await run('taskkill', args);
  const msg = (r.stderr || r.stdout).trim();
  if (r.code === 0) return { ok: true, pid, message: msg };
  const denied = /access is denied|accès refusé|acceso denegado/i.test(msg);
  const gone = /not found|introuvable|no se encontr/i.test(msg);
  if (gone) return { ok: true, pid, message: 'Process already exited.' };
  return { ok: false, pid, needsAdmin: denied, error: denied ? 'Access denied. Restart DevPulse as administrator to end this process.' : msg || 'taskkill failed' };
}

async function killPids(pids, opts) {
  const results = [];
  for (const pid of pids) results.push(await killPid(pid, opts));
  return results;
}

async function killPort(port) {
  port = Number(port);
  const ports = await getPorts();
  const targets = [...new Set(ports.filter((p) => p.port === port && p.pid > 0).map((p) => p.pid))];
  if (!targets.length) return { ok: false, port, error: `Nothing is listening on port ${port}.`, results: [] };
  const results = await killPids(targets, { tree: true });
  const ok = results.every((r) => r.ok);
  return {
    ok,
    port,
    results,
    needsAdmin: results.some((r) => r.needsAdmin),
    error: ok ? undefined : results.find((r) => !r.ok)?.error,
  };
}

async function getCommandLine(pid) {
  try {
    return (await slow.run(`(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`)) || '';
  } catch {
    return '';
  }
}

function sampleMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  return { total, free, used: total - free };
}

function shutdown() {
  fast.stop();
  slow.stop();
}

module.exports = {
  sampleCpu, sampleIo, sampleGpu, sampleMemory, sampleProcesses, getStatic, getDrives,
  getPorts, killPid, killPids, killPort, getCommandLine, shutdown,
  get processes() { return procCache; },
};
