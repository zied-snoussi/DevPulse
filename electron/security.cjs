// Heuristic threat scanner. It is NOT an antivirus: it flags processes that *look* suspicious
// (unsigned binaries in odd places, system-name impersonation, attack-style command lines,
// miner-like behaviour) and hands the real verdict to Windows Defender / VirusTotal.
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const b64json = (v) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64');

const WIN = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();

/** Windows binaries that malware loves to impersonate, with the folder they must live in. */
const SYSTEM_NAMES = {
  'svchost.exe': 'system32', 'lsass.exe': 'system32', 'csrss.exe': 'system32', 'winlogon.exe': 'system32',
  'services.exe': 'system32', 'smss.exe': 'system32', 'wininit.exe': 'system32', 'spoolsv.exe': 'system32',
  'dllhost.exe': 'system32', 'rundll32.exe': 'system32', 'taskhostw.exe': 'system32', 'conhost.exe': 'system32',
  'dwm.exe': 'system32', 'ctfmon.exe': 'system32', 'sihost.exe': 'system32', 'runtimebroker.exe': 'system32',
  'searchindexer.exe': 'system32', 'wmiprvse.exe': 'system32\\wbem', 'explorer.exe': 'windows',
};

const OFFICE = /^(winword|excel|powerpnt|outlook|msaccess|mspub|onenote)\.exe$/i;
const SHELLS = /^(cmd|powershell|pwsh|wscript|cscript|mshta|rundll32|regsvr32|certutil|bitsadmin)\.exe$/i;
const MINER_PORTS = new Set([3333, 4444, 5555, 7777, 8888, 9999, 14444, 14433, 45560, 45700]);

const CMD_RULES = [
  [/-e(nc|ncodedcommand)?\s+[A-Za-z0-9+/=]{40,}/i, 'Runs a hidden, base64-encoded PowerShell command'],
  [/-w(indowstyle)?\s+hidden/i, 'Starts with a hidden window'],
  [/(iex|invoke-expression)\s*\(|downloadstring|downloadfile|invoke-webrequest.+\|\s*iex/i, 'Downloads and executes code from the internet'],
  [/mshta(\.exe)?\s+["']?(https?:|javascript:|vbscript:)/i, 'Uses mshta to run remote script'],
  [/rundll32(\.exe)?\s+["']?javascript:/i, 'Abuses rundll32 to run JavaScript'],
  [/certutil(\.exe)?.+-(urlcache|decode)/i, 'Abuses certutil to download or decode files'],
  [/bitsadmin(\.exe)?.+\/transfer/i, 'Uses bitsadmin to download files'],
  [/regsvr32(\.exe)?.+\/i:\s*https?:/i, 'Uses regsvr32 to run a remote script (Squiblydoo)'],
  [/vssadmin(\.exe)?.+delete\s+shadows|wbadmin.+delete\s+catalog|bcdedit.+recoveryenabled\s+no/i, 'Deletes backups / shadow copies (ransomware behaviour)'],
  [/(xmrig|minerd|cpuminer|nicehash|stratum\+tcp|--donate-level|cryptonight|randomx)/i, 'Crypto-miner command line'],
  [/-nop\b.*-exec(utionpolicy)?\s+bypass|-executionpolicy\s+bypass.+-noprofile.+-w/i, 'PowerShell launched with defensive flags disabled'],
];

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function suspiciousLocation(p) {
  const s = p.toLowerCase();
  if (/\\appdata\\local\\temp\\|\\windows\\temp\\/.test(s)) return 'a temporary folder';
  if (/\\downloads\\/.test(s)) return 'the Downloads folder';
  if (/\\\$recycle\.bin\\/.test(s)) return 'the Recycle Bin';
  if (/^c:\\users\\public\\/.test(s)) return 'the Public user folder';
  if (/^c:\\perflogs\\|^c:\\intel\\|^c:\\programdata\\[^\\]+\.exe$/.test(s)) return 'an unusual system folder';
  if (/\\appdata\\(roaming|local)\\[^\\]+\.exe$/.test(s)) return 'the root of AppData';
  return null;
}

function normalizePath(p) {
  if (!p) return null;
  return path.normalize(String(p).replace(/^\\\\\?\\/, ''));
}

/** Folders a normal (non-admin) program cannot write to: an unsigned file there was put by an installer. */
function protectedFolder(p) {
  const s = p.toLowerCase();
  return s.startsWith(`${WIN}\\`) || /^[a-z]:\\program files( \(x86\))?\\/.test(s);
}

function isPrivateIp(ip) {
  return /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|::1$|::$|fe80:|f[cd][0-9a-f]{2}:)/i.test(ip) || ip === '*';
}

function run(file, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

/* ---------------------------------------------------------- collection */

const sigCache = new Map(); // `${path}|${mtime}` -> { status, signer }

async function signatures(ps, paths, onProgress) {
  const todo = [];
  const keyOf = (p) => {
    try { return `${p}|${fs.statSync(p).mtimeMs}`; } catch { return `${p}|?`; }
  };
  for (const p of paths) if (!sigCache.has(keyOf(p))) todo.push(p);
  const CHUNK = 12;
  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    onProgress?.(i, todo.length);
    const rows = asArray(await ps.json(`
$paths = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64json(chunk)}')) | ConvertFrom-Json
$out = foreach ($p in $paths) {
  try {
    $s = Get-AuthenticodeSignature -LiteralPath $p -ErrorAction Stop
    $cn = if ($s.SignerCertificate) { ($s.SignerCertificate.Subject -split ',')[0] -replace '^CN=','' -replace '"','' } else { $null }
    [pscustomobject]@{ p = $p; s = [string]$s.Status; c = $cn; t = [string]$s.SignatureType }
  } catch { [pscustomobject]@{ p = $p; s = 'AccessDenied'; c = $null; t = $null } }
}
@($out) | ConvertTo-Json -Compress`, 60000).catch(() => []));
    for (const r of rows) sigCache.set(keyOf(r.p), { status: r.s, signer: r.c, type: r.t });
  }
  onProgress?.(todo.length, todo.length);
  const out = new Map();
  for (const p of paths) out.set(p, sigCache.get(keyOf(p)) || { status: 'Unknown', signer: null });
  return out;
}

async function connectionsByPid() {
  const { stdout } = await run('netstat', ['-ano', '-p', 'TCP']);
  const map = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== 'TCP' || parts[3] !== 'ESTABLISHED') continue;
    const remote = parts[2];
    const i = remote.lastIndexOf(':');
    const ip = remote.slice(0, i).replace(/^\[|\]$/g, '');
    const port = Number(remote.slice(i + 1));
    const pid = Number(parts[4]);
    if (isPrivateIp(ip)) continue;
    const list = map.get(pid) || [];
    list.push({ ip, port });
    map.set(pid, list);
  }
  return map;
}

async function defenderStatus(ps) {
  try {
    return await ps.json(`
$s = Get-MpComputerStatus -ErrorAction Stop
$t = @(Get-MpThreatDetection -ErrorAction SilentlyContinue | Sort-Object InitialDetectionTime -Descending | Select-Object -First 8)
$names = @{}; Get-MpThreat -ErrorAction SilentlyContinue | ForEach-Object { $names[[string]$_.ThreatID] = $_.ThreatName }
[pscustomobject]@{
  available = $true
  mode = [string]$s.AMRunningMode
  realtime = [bool]$s.RealTimeProtectionEnabled
  antivirus = [bool]$s.AntivirusEnabled
  tamper = [bool]$s.IsTamperProtected
  sigUpdated = if ($s.AntivirusSignatureLastUpdated) { $s.AntivirusSignatureLastUpdated.ToUniversalTime().ToString('o') } else { $null }
  quickScan = if ($s.QuickScanEndTime) { $s.QuickScanEndTime.ToUniversalTime().ToString('o') } else { $null }
  threats = @($t | ForEach-Object { [pscustomobject]@{ name = $names[[string]$_.ThreatID]; time = $_.InitialDetectionTime.ToUniversalTime().ToString('o'); process = $_.ProcessName; resources = @($_.Resources); resolved = [bool]$_.ActionSuccess } })
} | ConvertTo-Json -Compress -Depth 4`, 30000);
  } catch {
    return { available: false };
  }
}

/* ------------------------------------------------------------ analysis */

function analyzeProcess(p, ctx) {
  const reasons = [];
  let score = 0;
  const add = (pts, text, kind) => { score += pts; reasons.push({ text, kind, pts }); };
  const exe = (p.path || '').toLowerCase();
  const name = (p.name || '').toLowerCase();
  const sig = p.path ? ctx.sigs.get(p.path) : null;
  const signed = sig?.status === 'Valid';
  const protectedApp = exe.includes('\\windowsapps\\');

  // 1. Impersonating a Windows process from the wrong folder.
  const home = SYSTEM_NAMES[name];
  if (home && exe) {
    const expected = home === 'windows' ? `${WIN}\\${name}` : `${WIN}\\${home}\\${name}`;
    const alt = expected.replace('\\system32\\', '\\syswow64\\');
    if (exe !== expected && exe !== alt) add(60, `Named like the Windows process "${p.name}" but runs from ${path.dirname(p.path)}`, 'impersonation');
  }
  // 2. Typosquatting a system name (scvhost.exe, lsas.exe, expl0rer.exe…).
  if (!home && p.path && !signed && !protectedApp) {
    for (const sys of Object.keys(SYSTEM_NAMES)) {
      const d = levenshtein(name, sys);
      if (d > 0 && d <= 1 && name.length >= 7) { add(50, `Name "${p.name}" imitates the Windows process "${sys}"`, 'impersonation'); break; }
    }
  }
  // 3. Signature.
  if (sig && !protectedApp && p.path) {
    if (sig.status === 'HashMismatch') add(55, 'Digital signature is broken: the file was modified after signing', 'signature');
    else if (sig.status === 'NotTrusted' || sig.status === 'NotSupportedFileFormat') add(30, `Signature is not trusted (${sig.status})`, 'signature');
    else if (sig.status === 'NotSigned' && !protectedFolder(p.path)) add(15, 'Not digitally signed: the publisher is unknown', 'signature');
  }
  // 4. Location (only matters when the binary is not validly signed).
  if (p.path && !signed && !protectedApp) {
    const loc = suspiciousLocation(p.path);
    if (loc) add(25, `Runs from ${loc}, a common hiding place for malware`, 'location');
  }
  // 5. File name tricks.
  if (/\.(pdf|docx?|xlsx?|jpg|png|txt|zip)\.exe$/i.test(name)) add(45, 'Uses a double extension to disguise an executable', 'name');
  if (!signed && /^[a-f0-9]{12,}\.exe$|^[a-z]{1,2}\d{4,}\.exe$|^[bcdfghjklmnpqrstvwxz]{7,}\.exe$/i.test(name)) add(15, 'Random-looking file name', 'name');
  // 6. Command line.
  let cmdHits = 0;
  for (const [re, text] of CMD_RULES) {
    if (p.cmd && re.test(p.cmd) && cmdHits < 3) { add(cmdHits ? 20 : 45, text, 'command'); cmdHits++; }
  }
  // 7. Office document spawning a shell (macro malware).
  const parent = ctx.byPid.get(p.ppid);
  if (parent && OFFICE.test(parent.name) && SHELLS.test(p.name)) add(50, `Started by ${parent.name}: Office documents launching a shell is a classic macro attack`, 'parent');
  // 8. Behaviour: CPU + network.
  const live = ctx.live.get(p.pid);
  const conns = ctx.conns.get(p.pid) || [];
  if (conns.some((c) => MINER_PORTS.has(c.port))) add(35, `Connected to port ${conns.find((c) => MINER_PORTS.has(c.port)).port}, often used by mining pools / remote shells`, 'network');
  if (!signed && !protectedApp && live && live.cpu > 40) add(20, `Unsigned and using ${live.cpu.toFixed(0)}% CPU: possible crypto-miner`, 'behaviour');
  if (!signed && !protectedApp && conns.length && score > 0) add(10, `Talking to ${conns.length} internet address${conns.length > 1 ? 'es' : ''} (${[...new Set(conns.map((c) => c.ip))].slice(0, 2).join(', ')})`, 'network');

  if (!reasons.length) return null;
  const level = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  return {
    pid: p.pid, name: p.name, path: p.path, cmd: p.cmd, ppid: p.ppid, parent: parent?.name || null,
    signer: sig?.signer || null, signature: sig?.status || 'Unknown',
    cpu: live?.cpu || 0, mem: live?.mem || 0, connections: conns.slice(0, 6),
    score: Math.min(100, score), level, reasons,
  };
}

function analyzeStartup(item, sigs) {
  const reasons = [];
  let score = 0;
  const add = (pts, text) => { score += pts; reasons.push({ text, pts }); };
  const sig = item.path ? sigs.get(item.path) : null;
  const signed = sig?.status === 'Valid';
  if (item.path && !signed) {
    const loc = suspiciousLocation(item.path);
    if (loc) add(35, `Starts automatically from ${loc}`);
    if (sig?.status === 'NotSigned') add(15, 'Not digitally signed');
    if (sig?.status === 'HashMismatch') add(50, 'Broken digital signature');
  }
  if (item.path && !fs.existsSync(item.path)) add(10, 'Points to a file that no longer exists (leftover entry)');
  for (const [re, text] of CMD_RULES) if (re.test(item.command)) { add(45, text); break; }
  return { ...item, signer: sig?.signer || null, signature: sig?.status || 'Unknown', score: Math.min(100, score), level: score >= 60 ? 'high' : score >= 30 ? 'medium' : score > 0 ? 'low' : 'ok', reasons };
}

/** Pull the executable path out of a command line like `"C:\x\app.exe" --flag` or `C:\x\app.exe -a`. */
function exeFromCommand(cmd = '') {
  const expanded = cmd.replace(/%([^%]+)%/g, (_, v) => process.env[v] || `%${v}%`);
  const q = expanded.match(/^\s*"([^"]+\.exe)"/i);
  if (q) return q[1];
  const m = expanded.match(/^\s*([A-Za-z]:\\.*?\.exe)\b/i);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------ entry */

async function scan(ps, liveProcs, onProgress) {
  const started = Date.now();
  onProgress?.({ step: 'Reading processes', pct: 5 });
  const [procRows, startupRows, conns] = await Promise.all([
    ps.json(`Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ i = $_.ProcessId; n = $_.Name; p = $_.ExecutablePath; c = $_.CommandLine; pp = $_.ParentProcessId } } | ConvertTo-Json -Compress`, 30000).catch(() => []),
    ps.json(`Get-CimInstance Win32_StartupCommand | ForEach-Object { [pscustomobject]@{ n = $_.Name; c = $_.Command; l = $_.Location; u = $_.User } } | ConvertTo-Json -Compress`, 30000).catch(() => []),
    connectionsByPid(),
  ]);
  const self = process.execPath.toLowerCase();
  const procs = asArray(procRows)
    .filter((r) => r.i > 4)
    .map((r) => ({ pid: r.i, name: r.n, path: normalizePath(r.p), cmd: r.c || '', ppid: r.pp }))
    .filter((p) => (p.path || '').toLowerCase() !== self);
  const startup = asArray(startupRows).map((r) => ({ name: r.n, command: r.c || '', location: r.l, user: r.u, path: exeFromCommand(r.c || '') }));

  const paths = [...new Set([...procs.map((p) => p.path), ...startup.map((s) => s.path)].filter(Boolean))];
  onProgress?.({ step: `Verifying ${paths.length} digital signatures`, pct: 15 });
  const sigs = await signatures(ps, paths, (done, total) =>
    onProgress?.({ step: `Verifying digital signatures (${done}/${total})`, pct: 15 + Math.round((done / Math.max(1, total)) * 70) }));

  onProgress?.({ step: 'Checking Windows Defender', pct: 88 });
  const defender = await defenderStatus(ps);

  onProgress?.({ step: 'Analyzing behaviour', pct: 96 });
  const ctx = {
    sigs,
    conns,
    byPid: new Map(procs.map((p) => [p.pid, p])),
    live: new Map(liveProcs.map((p) => [p.pid, p])),
  };
  const grouped = new Map();
  for (const f of procs.map((p) => analyzeProcess(p, ctx)).filter(Boolean)) {
    const key = `${f.path || f.name}|${f.reasons.map((r) => r.text).join('|')}`;
    const g = grouped.get(key);
    if (g) { g.pids.push(f.pid); g.cpu += f.cpu; g.mem += f.mem; }
    else grouped.set(key, { ...f, pids: [f.pid] });
  }
  const findings = [...grouped.values()].sort((a, b) => b.score - a.score);
  const startupItems = startup.map((s) => analyzeStartup(s, sigs)).sort((a, b) => b.score - a.score);
  const unsigned = new Set(procs.filter((p) => p.path && sigs.get(p.path)?.status === 'NotSigned' && !protectedFolder(p.path) && !p.path.toLowerCase().includes('\\windowsapps\\')).map((p) => p.path)).size;

  return {
    at: new Date().toISOString(),
    ms: Date.now() - started,
    scanned: procs.length,
    files: paths.length,
    unsigned,
    externalConnections: [...conns.values()].reduce((a, l) => a + l.length, 0),
    findings,
    startup: startupItems,
    defender,
  };
}

/** Scan one file with Windows Defender without letting it auto-quarantine. */
async function defenderScanFile(file) {
  const mp = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe');
  if (!fs.existsSync(mp)) return { ok: false, error: 'Windows Defender command-line tool not found.' };
  if (!file || !fs.existsSync(file)) return { ok: false, error: 'File not found.' };
  const r = await run(mp, ['-Scan', '-ScanType', '3', '-File', file, '-DisableRemediation'], 5 * 60 * 1000);
  const out = (r.stdout + r.stderr).trim();
  if (r.code === 0) return { ok: true, clean: true, output: out };
  if (r.code === 2) {
    const threat = out.match(/Threat\s*:\s*(.+)/i)?.[1]?.trim();
    return { ok: true, clean: false, threat: threat || 'Threat detected', output: out };
  }
  return { ok: false, error: out.split(/\r?\n/).pop() || `MpCmdRun exited with ${r.code}` };
}

/** Full Defender quick scan (can take several minutes). */
async function defenderQuickScan() {
  const mp = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe');
  if (!fs.existsSync(mp)) return { ok: false, error: 'Windows Defender command-line tool not found.' };
  const r = await run(mp, ['-Scan', '-ScanType', '1'], 60 * 60 * 1000);
  const out = (r.stdout + r.stderr).trim();
  if (r.code === 0) return { ok: true, clean: true, output: out };
  if (r.code === 2) return { ok: true, clean: false, output: out };
  return { ok: false, error: out.split(/\r?\n/).pop() || `MpCmdRun exited with ${r.code}` };
}

async function sha256(ps, file) {
  if (!file || !fs.existsSync(file)) return null;
  const h = await ps.run(`(Get-FileHash -LiteralPath ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(file, 'utf8').toString('base64')}'))) -Algorithm SHA256).Hash`, 120000).catch(() => '');
  return /^[A-F0-9]{64}$/i.test(h) ? h.toLowerCase() : null;
}

module.exports = { scan, defenderScanFile, defenderQuickScan, sha256 };
