// Windows tweaks grouped into profiles (gaming / development / battery).
// Every change is reversible: the original value is saved before the first apply.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const psStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

function run(file, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

/* Power-mode slider (works on modern-standby laptops that only expose the Balanced plan). */
const POWER_MODES = {
  efficiency: '961cc777-2547-4f9d-8174-7d86181b8a7a',
  balanced: '00000000-0000-0000-0000-000000000000',
  performance: 'ded574b5-45a0-4f42-8737-46345c09c238',
};
const HIGH_PERF_PLAN = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const BALANCED_PLAN = '381b4222-f694-41f0-9685-ff5bb260df2e';

/**
 * Registry toggles. `on` is the value when the tweak is ENABLED, `def` is Windows' default
 * when the value is missing. A tweak counts as enabled when every entry equals `on`.
 */
const REG_TWEAKS = {
  gameMode: {
    title: 'Game Mode',
    why: 'Windows prioritizes the game you are playing and pauses background updates and notifications.',
    entries: [{ key: 'HKCU:\\Software\\Microsoft\\GameBar', name: 'AutoGameModeEnabled', on: 1, off: 0, def: 1 }],
  },
  noGameDvr: {
    title: 'Turn off background game recording',
    why: 'Xbox Game Bar records gameplay in the background, which costs FPS and disk I/O.',
    entries: [
      { key: 'HKCU:\\System\\GameConfigStore', name: 'GameDVR_Enabled', on: 0, off: 1, def: 1 },
      { key: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', name: 'AppCaptureEnabled', on: 0, off: 1, def: 1 },
    ],
  },
  noTransparency: {
    title: 'Turn off transparency effects',
    why: 'Acrylic blur in the taskbar and Start menu uses GPU time and battery.',
    entries: [{ key: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', name: 'EnableTransparency', on: 0, off: 1, def: 1 }],
  },
  noAnimations: {
    title: 'Turn off window animations',
    why: 'Windows opens and minimizes instantly; saves a little GPU and battery.',
    entries: [{ key: 'HKCU:\\Control Panel\\Desktop\\WindowMetrics', name: 'MinAnimate', on: '0', off: '1', def: '1', type: 'String' }],
    restart: 'sign out',
  },
  noMouseAccel: {
    title: 'Turn off mouse acceleration',
    why: '"Enhance pointer precision" makes aim inconsistent; pros turn it off for 1:1 mouse movement.',
    entries: [
      { key: 'HKCU:\\Control Panel\\Mouse', name: 'MouseSpeed', on: '0', off: '1', def: '1', type: 'String' },
      { key: 'HKCU:\\Control Panel\\Mouse', name: 'MouseThreshold1', on: '0', off: '6', def: '6', type: 'String' },
      { key: 'HKCU:\\Control Panel\\Mouse', name: 'MouseThreshold2', on: '0', off: '10', def: '10', type: 'String' },
    ],
    restart: 'sign out',
  },
  noBackgroundApps: {
    title: 'Stop Store apps running in the background',
    why: 'Store apps stop syncing and refreshing when closed, saving CPU, RAM and battery.',
    entries: [{ key: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications', name: 'GlobalUserDisabled', on: 1, off: 0, def: 0 }],
  },
  longPaths: {
    title: 'Enable long file paths',
    why: 'Removes the 260-character path limit that breaks deep node_modules, Gradle and Flutter builds.',
    entries: [{ key: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', name: 'LongPathsEnabled', on: 1, off: 0, def: 0 }],
    admin: true,
  },
  devMode: {
    title: 'Developer Mode',
    why: 'Allows symlinks without admin (needed by pnpm, Flutter, some Git repos) and sideloading apps.',
    entries: [{ key: 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock', name: 'AllowDevelopmentWithoutDevLicense', on: 1, off: 0, def: 0 }],
    admin: true,
  },
  hags: {
    title: 'Hardware-accelerated GPU scheduling',
    why: 'The GPU manages its own memory scheduling: lower latency and a few more FPS on supported GPUs.',
    entries: [{ key: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', name: 'HwSchMode', on: 2, off: 1, def: 1 }],
    admin: true,
    restart: 'restart',
  },
};

/* ------------------------------------------------------------- backup */

let backupFile = null;
function setBackupDir(dir) { backupFile = path.join(dir, 'tweaks-backup.json'); }
function loadBackup() {
  try { return JSON.parse(fs.readFileSync(backupFile, 'utf8')); } catch { return {}; }
}
function saveBackup(b) {
  try { fs.mkdirSync(path.dirname(backupFile), { recursive: true }); fs.writeFileSync(backupFile, JSON.stringify(b, null, 2)); } catch {}
}

/* ------------------------------------------------------------- state */

function readScript() {
  const entries = Object.values(REG_TWEAKS).flatMap((t) => t.entries);
  const lines = entries.map((e) =>
    `$r[${psStr(`${e.key}|${e.name}`)}] = (Get-ItemProperty -LiteralPath ${psStr(e.key)} -Name ${psStr(e.name)} -ErrorAction SilentlyContinue).${e.name}`);
  return `
$r = @{}
${lines.join('\n')}
$pw = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes'
$b = Get-CimInstance Win32_Battery | Select-Object -First 1
$gpu = (Get-ItemProperty -LiteralPath 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -ErrorAction SilentlyContinue)
[pscustomobject]@{
  reg = $r
  overlayAc = (Get-ItemProperty -LiteralPath $pw -Name ActiveOverlayAcPowerScheme -ErrorAction SilentlyContinue).ActiveOverlayAcPowerScheme
  overlayDc = (Get-ItemProperty -LiteralPath $pw -Name ActiveOverlayDcPowerScheme -ErrorAction SilentlyContinue).ActiveOverlayDcPowerScheme
  battery = [bool]$b
  onAc = (-not $b) -or ($b.BatteryStatus -eq 2) -or ($b.BatteryStatus -ge 6)
  startupCount = @(Get-CimInstance Win32_StartupCommand).Count
  wsl = [bool](Get-Process -Name vmmem, vmmemWSL -ErrorAction SilentlyContinue)
} | ConvertTo-Json -Compress -Depth 3`;
}

async function tempSize() {
  const dir = os.tmpdir();
  let size = 0;
  let files = 0;
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const walk = (d, depth) => {
    if (depth > 6 || files > 200000) return;
    let items;
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = path.join(d, it.name);
      try {
        if (it.isDirectory()) walk(p, depth + 1);
        else {
          const st = fs.statSync(p);
          if (st.mtimeMs < cutoff) { size += st.size; files++; }
        }
      } catch {}
    }
  };
  walk(dir, 0);
  return { dir, size, files };
}

async function powerState(state) {
  const list = await run('powercfg', ['/list']);
  const plans = [...list.stdout.matchAll(/([0-9a-f-]{36})\s+\(([^)]+)\)(\s*\*)?/gi)].map((m) => ({ guid: m[1].toLowerCase(), name: m[2], active: !!m[3] }));
  const unique = [...new Map(plans.map((p) => [p.guid, p])).values()];
  const active = unique.find((p) => p.active) || plans.find((p) => p.active);
  const overlay = String((state.onAc ? state.overlayAc : state.overlayDc) || POWER_MODES.balanced).toLowerCase();
  let mode = Object.keys(POWER_MODES).find((k) => POWER_MODES[k] === overlay) || 'balanced';
  // Classic desktops: a High performance plan counts as "performance".
  if (active?.guid === HIGH_PERF_PLAN) mode = 'performance';
  return { plans: unique, activePlan: active || null, mode, hasHighPerfPlan: unique.some((p) => p.guid === HIGH_PERF_PLAN) };
}

async function gitLongPaths() {
  const r = await run('git', ['config', '--global', '--get', 'core.longpaths']);
  if (r.code !== 0 && !r.stdout && /not recognized|ENOENT/i.test(r.stderr)) return { installed: false, value: false };
  const v = await run('git', ['--version']);
  return { installed: v.code === 0, value: r.stdout.trim() === 'true' };
}

async function getState(ps) {
  const [raw, temp, git] = await Promise.all([ps.json(readScript(), 30000).catch(() => ({})), tempSize(), gitLongPaths()]);
  const reg = raw?.reg || {};
  const tweaks = {};
  for (const [id, t] of Object.entries(REG_TWEAKS)) {
    const values = t.entries.map((e) => {
      const v = reg[`${e.key}|${e.name}`];
      return v === undefined || v === null ? e.def : v;
    });
    // HAGS only exists on supported GPUs/drivers: hide it when the value was never written.
    const supported = id !== 'hags' || reg[`${t.entries[0].key}|${t.entries[0].name}`] != null;
    tweaks[id] = { enabled: t.entries.every((e, i) => String(values[i]) === String(e.on)), supported };
  }
  const power = await powerState(raw || {});
  const backup = loadBackup();
  return {
    tweaks,
    power,
    git,
    temp,
    battery: !!raw?.battery,
    onAc: raw?.onAc !== false,
    startupCount: raw?.startupCount || 0,
    wslRunning: !!raw?.wsl,
    backedUp: Object.keys(backup),
    meta: Object.fromEntries(Object.entries(REG_TWEAKS).map(([id, t]) => [id, { title: t.title, why: t.why, admin: !!t.admin, restart: t.restart || null }])),
  };
}

/* ------------------------------------------------------------- apply */

function setEntryScript(e, value) {
  const type = e.type || 'DWord';
  if (value === null || value === undefined) {
    return `Remove-ItemProperty -LiteralPath ${psStr(e.key)} -Name ${psStr(e.name)} -ErrorAction SilentlyContinue`;
  }
  return `if (-not (Test-Path -LiteralPath ${psStr(e.key)})) { New-Item -Path ${psStr(e.key)} -Force | Out-Null }; Set-ItemProperty -LiteralPath ${psStr(e.key)} -Name ${psStr(e.name)} -Value ${type === 'String' ? psStr(value) : Number(value)} -Type ${type}`;
}

/** Run a script elevated (one UAC prompt). Resolves true if it ran. */
function runElevated(script) {
  return new Promise((resolve) => {
    const enc = Buffer.from(`$ErrorActionPreference='Stop'; try { ${script}; exit 0 } catch { exit 1 }`, 'utf16le').toString('base64');
    const outer = `$p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-EncodedCommand','${enc}'; exit $p.ExitCode`;
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', outer], { windowsHide: true });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

async function readRaw(ps, entries) {
  const lines = entries.map((e, i) => `$r['${i}'] = (Get-ItemProperty -LiteralPath ${psStr(e.key)} -Name ${psStr(e.name)} -ErrorAction SilentlyContinue).${e.name}`);
  const r = await ps.json(`$r = @{}\n${lines.join('\n')}\n$r | ConvertTo-Json -Compress`).catch(() => ({}));
  return entries.map((_, i) => (r && r[String(i)] !== undefined ? r[String(i)] : null));
}

/**
 * Apply several changes at once. `changes` = [{ id, value }] where value is boolean for registry
 * tweaks, a mode name for 'power' and boolean for 'gitLongPaths'. Admin changes share one UAC prompt.
 */
async function apply(ps, changes) {
  const backup = loadBackup();
  const userScript = [];
  const adminScript = [];
  const results = [];

  for (const { id, value } of changes) {
    if (REG_TWEAKS[id]) {
      const t = REG_TWEAKS[id];
      if (!backup[id]) backup[id] = { raw: await readRaw(ps, t.entries), at: new Date().toISOString() };
      const script = t.entries.map((e) => setEntryScript(e, value ? e.on : e.off)).join('; ');
      (t.admin ? adminScript : userScript).push(script);
      results.push({ id, admin: !!t.admin });
    } else if (id === 'power') {
      const state = await powerState(await ps.json(readScript()).catch(() => ({})));
      if (!backup.power) backup.power = { mode: state.mode, plan: state.activePlan?.guid || BALANCED_PLAN, at: new Date().toISOString() };
      if (state.hasHighPerfPlan) {
        await run('powercfg', ['/setactive', value === 'performance' ? HIGH_PERF_PLAN : BALANCED_PLAN]);
      }
      const r = await run('powercfg', ['/overlaysetactive', POWER_MODES[value] || POWER_MODES.balanced]);
      results.push({ id, ok: r.code === 0 || state.hasHighPerfPlan, error: r.code === 0 ? undefined : (r.stdout + r.stderr).trim() });
    } else if (id === 'gitLongPaths') {
      if (!backup.gitLongPaths) backup.gitLongPaths = { value: (await gitLongPaths()).value, at: new Date().toISOString() };
      const r = value ? await run('git', ['config', '--global', 'core.longpaths', 'true']) : await run('git', ['config', '--global', '--unset', 'core.longpaths']);
      results.push({ id, ok: r.code === 0 || !value, error: r.code === 0 ? undefined : r.stderr.trim() });
    }
  }
  saveBackup(backup);

  let userOk = true;
  if (userScript.length) {
    const out = await ps.run(`try { ${userScript.join('; ')}; 'OK' } catch { 'ERR: ' + $_.Exception.Message }`).catch((e) => `ERR: ${e.message}`);
    userOk = out.trim().endsWith('OK');
  }
  let adminOk = true;
  if (adminScript.length) adminOk = await runElevated(adminScript.join('; '));

  return results.map((r) => ('ok' in r ? r : { ...r, ok: r.admin ? adminOk : userOk, error: r.admin && !adminOk ? 'Administrator permission was declined or failed.' : !userOk ? 'Could not write the setting.' : undefined }));
}

/** Put back the values saved before DevPulse first changed them. */
async function revert(ps, ids) {
  const backup = loadBackup();
  const userScript = [];
  const adminScript = [];
  const done = [];
  for (const id of ids) {
    const b = backup[id];
    if (!b) continue;
    if (REG_TWEAKS[id]) {
      const t = REG_TWEAKS[id];
      const s = t.entries.map((e, i) => setEntryScript(e, b.raw[i])).join('; ');
      (t.admin ? adminScript : userScript).push(s);
    } else if (id === 'power') {
      await run('powercfg', ['/setactive', b.plan || BALANCED_PLAN]);
      await run('powercfg', ['/overlaysetactive', POWER_MODES[b.mode] || POWER_MODES.balanced]);
    } else if (id === 'gitLongPaths') {
      if (b.value) await run('git', ['config', '--global', 'core.longpaths', 'true']);
      else await run('git', ['config', '--global', '--unset', 'core.longpaths']);
    }
    done.push(id);
  }
  let ok = true;
  if (userScript.length) ok = (await ps.run(`try { ${userScript.join('; ')}; 'OK' } catch { 'ERR' }`).catch(() => 'ERR')).trim() === 'OK';
  if (adminScript.length) ok = (await runElevated(adminScript.join('; '))) && ok;
  if (ok) {
    for (const id of done) delete backup[id];
    saveBackup(backup);
  }
  return { ok, reverted: done };
}

/** Delete temp files older than a day. Locked files are skipped. */
async function cleanTemp() {
  const dir = os.tmpdir();
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let freed = 0;
  let removed = 0;
  let skipped = 0;
  const walk = (d, depth) => {
    let items;
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = path.join(d, it.name);
      try {
        if (it.isDirectory()) {
          if (depth < 8) walk(p, depth + 1);
          try { fs.rmdirSync(p); } catch {}
        } else {
          const st = fs.statSync(p);
          if (st.mtimeMs >= cutoff) continue;
          fs.unlinkSync(p);
          freed += st.size;
          removed++;
        }
      } catch { skipped++; }
    }
  };
  walk(dir, 0);
  return { ok: true, freed, removed, skipped };
}

async function wslShutdown() {
  const r = await run('wsl.exe', ['--shutdown'], 60000);
  return { ok: r.code === 0, error: r.code ? (r.stdout + r.stderr).replace(/\0/g, '').trim() : undefined };
}

module.exports = { getState, apply, revert, cleanTemp, wslShutdown, setBackupDir };
