const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('devpulse', {
  getStatic: () => ipcRenderer.invoke('sys:static'),
  getDrives: (force) => ipcRenderer.invoke('sys:drives', force),
  listPorts: () => ipcRenderer.invoke('ports:list'),
  killPort: (port) => ipcRenderer.invoke('ports:kill', port),
  killPid: (pid, tree) => ipcRenderer.invoke('proc:kill', pid, tree),
  killPids: (pids) => ipcRenderer.invoke('proc:killMany', pids),
  getCommandLine: (pid) => ipcRenderer.invoke('proc:cmdline', pid),
  openUrl: (url) => ipcRenderer.invoke('shell:open', url),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  setInterval: (ms) => ipcRenderer.invoke('app:setInterval', ms),
  setTheme: (t) => ipcRenderer.invoke('app:setTheme', t),
  setAlwaysOnTop: (on) => ipcRenderer.invoke('app:setAlwaysOnTop', on),
  systemTheme: () => ipcRenderer.invoke('app:systemTheme'),
  relaunchAsAdmin: () => ipcRenderer.invoke('app:relaunchAdmin'),
  securityScan: () => ipcRenderer.invoke('sec:scan'),
  defenderScanFile: (file) => ipcRenderer.invoke('sec:defenderFile', file),
  defenderQuickScan: () => ipcRenderer.invoke('sec:quickScan'),
  fileHash: (file) => ipcRenderer.invoke('sec:hash', file),
  onScanProgress: (cb) => on('sec:progress', cb),
  optimizerState: () => ipcRenderer.invoke('opt:state'),
  applyTweaks: (changes) => ipcRenderer.invoke('opt:apply', changes),
  revertTweaks: (ids) => ipcRenderer.invoke('opt:revert', ids),
  cleanTemp: () => ipcRenderer.invoke('opt:cleanTemp'),
  wslShutdown: () => ipcRenderer.invoke('opt:wslShutdown'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  onUpdateStatus: (cb) => on('update:status', cb),
  onTick: (cb) => on('sys:tick', cb),
  onProcesses: (cb) => on('sys:procs', cb),
  onGpu: (cb) => on('sys:gpu', cb),
});
