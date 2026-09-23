// Renders the DevPulse logo SVG to build/icon.png (512px) using Electron's offscreen renderer.
// Usage: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 512;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
<rect width="64" height="64" rx="15" fill="url(#g)"/>
<path d="M10 34h11l5-12 8 22 6-16 4 6h10" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  let last = null;
  win.webContents.on('paint', (_e, _dirty, image) => { last = image; });
  win.webContents.on('did-finish-load', () => {
    win.webContents.invalidate();
    setTimeout(() => {
      if (!last) return;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, last.resize({ width: SIZE, height: SIZE }).toPNG());
      console.log('wrote', out);
      app.quit();
    }, 800);
  });
  win.webContents.setFrameRate(30);
  win.loadURL(`data:text/html,<html><body style="margin:0;background:transparent;overflow:hidden">${encodeURIComponent(svg)}</body></html>`);
  setTimeout(() => { console.error('timeout'); app.exit(1); }, 15000);
});
