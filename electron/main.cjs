const { app, BrowserWindow, ipcMain, shell, nativeTheme, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const sys = require('./collectors.cjs');
const security = require('./security.cjs');
const optimizer = require('./optimizer.cjs');
const { PsHost } = require('./psHost.cjs');

// Separate PowerShell for on-demand scans/tweaks so they never stall the live metrics.
const tools = new PsHost('tools');

const devUrlArg = process.argv.find((a) => a.startsWith('--dev-url='));
const DEV_URL = process.env.VITE_DEV_SERVER_URL || (devUrlArg && devUrlArg.slice('--dev-url='.length));
const ICON = path.join(__dirname, '..', 'build', 'icon.png');

const THEMES = {
  dark: { color: '#0b0d12', symbolColor: '#9aa3b2' },
  light: { color: '#f4f5f8', symbolColor: '#4b5563' },
};

let win = null;
let tray = null;
let intervalMs = 1000;
let timers = [];
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function isActive() {
  return win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
}

/** setTimeout-based loop that never overlaps itself and idles while hidden. */
function loop(fn, getDelay) {
  let stopped = false;
  let handle;
  const tick = async () => {
    if (stopped) return;
    if (isActive()) {
      try { await fn(); } catch (e) { console.error(e); }
    }
    if (!stopped) handle = setTimeout(tick, isActive() ? getDelay() : 2000);
  };
  handle = setTimeout(tick, 50);
  return () => { stopped = true; clearTimeout(handle); };
}

function startSampling() {
  timers.forEach((stop) => stop());
  timers = [
    loop(async () => {
      const [io] = await Promise.all([sys.sampleIo()]);
      send('sys:tick', { t: Date.now(), cpu: sys.sampleCpu(), mem: sys.sampleMemory(), io });
    }, () => intervalMs),
    loop(async () => send('sys:procs', await sys.sampleProcesses()), () => Math.max(2000, intervalMs * 2)),
    loop(async () => send('sys:gpu', await sys.sampleGpu()), () => Math.max(3000, intervalMs * 3)),
  ];
}

function createWindow() {
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: 'DevPulse',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    backgroundColor: THEMES[theme].color,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...THEMES[theme], height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => {
    if (!quitting && tray) {
      e.preventDefault();
      win.hide();
    }
  });

  // Links open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function buildTrayMenu() {
  if (!tray) return;
  let devPorts = [];
  try {
    devPorts = (await sys.getPorts()).filter((p) => p.proto === 'TCP' && p.tech.kind === 'dev');
  } catch {}
  const seen = new Set();
  const portItems = devPorts
    .filter((p) => !seen.has(p.port) && seen.add(p.port))
    .slice(0, 12)
    .map((p) => ({
      label: `:${p.port}  ${p.tech.label}  (${p.name} · ${p.pid})`,
      submenu: [
        { label: `Open http://localhost:${p.port}`, click: () => shell.openExternal(`http://localhost:${p.port}`) },
        { label: `Kill port ${p.port}`, click: async () => { await sys.killPort(p.port); buildTrayMenu(); } },
      ],
    }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open DevPulse', click: showWindow },
    { type: 'separator' },
    { label: portItems.length ? 'Dev servers' : 'No dev servers running', enabled: false },
    ...portItems,
    { type: 'separator' },
    { label: 'Refresh', click: buildTrayMenu },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  if (!fs.existsSync(ICON)) return;
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('DevPulse');
  tray.on('click', showWindow);
  tray.on('right-click', () => buildTrayMenu().then(() => tray.popUpContextMenu()));
  buildTrayMenu();
}

/* ---------------------------------------------------------------- IPC */

ipcMain.handle('sys:static', () => sys.getStatic());
ipcMain.handle('sys:drives', (_e, force) => sys.getDrives(force));
ipcMain.handle('ports:list', () => sys.getPorts());
ipcMain.handle('ports:kill', (_e, port) => sys.killPort(port));
ipcMain.handle('proc:kill', (_e, pid, tree = true) => sys.killPid(pid, { tree }));
ipcMain.handle('proc:killMany', (_e, pids) => sys.killPids(pids, { tree: false }));
ipcMain.handle('proc:cmdline', (_e, pid) => sys.getCommandLine(pid));

ipcMain.handle('shell:open', (_e, url) => {
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(url)) return shell.openExternal(url);
  if (/^https:\/\/www\.virustotal\.com\/gui\/file\/[a-f0-9]{64}$/.test(url)) return shell.openExternal(url);
  if (/^(ms-settings:(startupapps|storagesense|windowsdefender|powersleep|gaming-gamemode|developers)|windowsdefender:\/\/threat)$/.test(url)) return shell.openExternal(url);
});

let scanning = null;
ipcMain.handle('sec:scan', () => {
  // Coalesce double clicks into the scan already running.
  scanning ||= security
    .scan(tools, sys.processes, (p) => send('sec:progress', p))
    .finally(() => { scanning = null; });
  return scanning;
});
ipcMain.handle('sec:defenderFile', (_e, file) => security.defenderScanFile(file));
ipcMain.handle('sec:quickScan', () => security.defenderQuickScan());
ipcMain.handle('sec:hash', (_e, file) => security.sha256(tools, file));

ipcMain.handle('opt:state', () => optimizer.getState(tools));
ipcMain.handle('opt:apply', (_e, changes) => optimizer.apply(tools, Array.isArray(changes) ? changes : []));
ipcMain.handle('opt:revert', (_e, ids) => optimizer.revert(tools, Array.isArray(ids) ? ids : []));
ipcMain.handle('opt:cleanTemp', () => optimizer.cleanTemp());
ipcMain.handle('opt:wslShutdown', () => optimizer.wslShutdown());
ipcMain.handle('shell:reveal', (_e, p) => {
  if (typeof p === 'string' && fs.existsSync(p)) {
    if (fs.statSync(p).isDirectory()) shell.openPath(p);
    else shell.showItemInFolder(p);
  }
});

ipcMain.handle('app:setInterval', (_e, ms) => {
  intervalMs = Math.max(500, Math.min(10000, Number(ms) || 1000));
});
ipcMain.handle('app:setTheme', (_e, theme) => {
  const t = THEMES[theme] || THEMES.dark;
  if (win) {
    win.setTitleBarOverlay({ ...t, height: 40 });
    win.setBackgroundColor(t.color);
  }
});
ipcMain.handle('app:setAlwaysOnTop', (_e, on) => win?.setAlwaysOnTop(!!on));
ipcMain.handle('app:systemTheme', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
ipcMain.handle('app:relaunchAdmin', () => {
  const args = app.isPackaged ? [] : [path.join(__dirname, '..')];
  if (DEV_URL) args.push(`--dev-url=${DEV_URL}`);
  const quoted = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',');
  const cmd = `Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}' ${quoted ? `-ArgumentList ${quoted}` : ''} -Verb RunAs`;
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true });
  child.on('exit', (code) => {
    // Code 0 means the UAC prompt was accepted and the elevated copy is starting.
    if (code === 0) {
      quitting = true;
      app.releaseSingleInstanceLock();
      app.quit();
    }
  });
  return true;
});

app.whenReady().then(() => {
  app.setAppUserModelId('com.zied.devpulse');
  optimizer.setBackupDir(app.getPath('userData'));
  createWindow();
  createTray();
  startSampling();
});

app.on('before-quit', () => {
  quitting = true;
  timers.forEach((stop) => stop());
  sys.shutdown();
  tools.stop();
});
app.on('window-all-closed', () => app.quit());
