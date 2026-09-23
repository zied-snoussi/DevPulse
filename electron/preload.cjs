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
  onTick: (cb) => on('sys:tick', cb),
  onProcesses: (cb) => on('sys:procs', cb),
  onGpu: (cb) => on('sys:gpu', cb),
});
