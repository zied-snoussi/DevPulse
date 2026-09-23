// In-app updates from GitHub releases. The user clicks "Update": we download the new
// installer in the background, then quit and run it silently, and DevPulse relaunches.
const { app } = require('electron');

let autoUpdater = null;
let status = { state: 'idle', version: app.getVersion() };
let notify = () => {};
let timer = null;

function set(patch) {
  status = { ...status, ...patch };
  notify(status);
}

function init(onStatus) {
  notify = onStatus;
  if (!app.isPackaged) {
    status = { state: 'dev', version: app.getVersion() };
    return;
  }
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = false; // wait for the user to click "Update"
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: undefined }));
  autoUpdater.on('update-not-available', () => set({ state: 'latest', checkedAt: new Date().toISOString() }));
  autoUpdater.on('update-available', (info) =>
    set({ state: 'available', available: info.version, notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null, checkedAt: new Date().toISOString() }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: p.percent, bytesPerSecond: p.bytesPerSecond }));
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', available: info.version, percent: 100 });
    // Give the UI a moment to show "Restarting…", then install silently and relaunch.
    setTimeout(() => install(), 1200);
  });
  autoUpdater.on('error', (e) => set({ state: 'error', error: String(e?.message || e).split('\n')[0] }));

  setTimeout(check, 8000);
  timer = setInterval(check, 4 * 60 * 60 * 1000);
}

async function check() {
  if (!autoUpdater) return status;
  try { await autoUpdater.checkForUpdates(); } catch (e) { set({ state: 'error', error: String(e?.message || e).split('\n')[0] }); }
  return status;
}

async function download() {
  if (!autoUpdater || status.state !== 'available') return status;
  set({ state: 'downloading', percent: 0 });
  try { await autoUpdater.downloadUpdate(); } catch (e) { set({ state: 'error', error: String(e?.message || e).split('\n')[0] }); }
  return status;
}

let beforeInstall = () => {};
function onBeforeInstall(fn) { beforeInstall = fn; }

function install() {
  if (!autoUpdater || status.state !== 'ready') return;
  beforeInstall();
  // isSilent = true (no installer wizard), isForceRunAfter = true (relaunch DevPulse).
  autoUpdater.quitAndInstall(true, true);
}

function getStatus() { return status; }
function stop() { if (timer) clearInterval(timer); }

module.exports = { init, check, download, install, getStatus, onBeforeInstall, stop };
