// A long-lived PowerShell process that runs commands sequentially.
// Spawning powershell.exe costs ~300ms, so we keep one alive and feed it scripts.
const { spawn } = require('node:child_process');

class PsHost {
  constructor(name = 'ps') {
    this.name = name;
    this.queue = [];
    this.busy = false;
    this.buffer = '';
    this.current = null;
    this.seq = 0;
    this.proc = null;
  }

  start() {
    if (this.proc) return;
    this.proc = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
    this.proc.stderr.on('data', () => {});
    this.proc.on('exit', () => {
      this.proc = null;
      if (this.current) {
        this.current.reject(new Error('PowerShell exited'));
        this.current = null;
      }
      this.busy = false;
      this.buffer = '';
      if (this.queue.length) this.next();
    });
    this.proc.stdin.write('[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ProgressPreference = "SilentlyContinue"\n');
  }

  onData(chunk) {
    this.buffer += chunk;
    if (!this.current) return;
    const marker = this.current.marker;
    const idx = this.buffer.indexOf(marker);
    if (idx === -1) return;
    const out = this.buffer.slice(0, idx);
    this.buffer = this.buffer.slice(idx + marker.length).replace(/^\r?\n/, '');
    const { resolve, timer } = this.current;
    clearTimeout(timer);
    this.current = null;
    this.busy = false;
    resolve(out.trim());
    this.next();
  }

  /** Run a script and resolve with its stdout (trimmed). */
  run(script, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      this.queue.push({ script, resolve, reject, timeoutMs });
      this.next();
    });
  }

  /** Run a script whose output is JSON. Empty output resolves to null. */
  async json(script, timeoutMs) {
    const out = await this.run(script, timeoutMs);
    if (!out) return null;
    return JSON.parse(out);
  }

  next() {
    if (this.busy || !this.queue.length) return;
    this.start();
    const job = this.queue.shift();
    this.busy = true;
    const marker = `__DEVPULSE_END_${this.name}_${++this.seq}__`;
    const encoded = Buffer.from(job.script, 'utf8').toString('base64');
    const timer = setTimeout(() => {
      // A hung command: kill the host, the exit handler rejects and restarts.
      if (this.current && this.current.marker === marker) this.proc?.kill();
    }, job.timeoutMs);
    this.current = { marker, resolve: job.resolve, reject: job.reject, timer };
    this.buffer = '';
    // Single line so the interactive "-Command -" reader executes it at once.
    this.proc.stdin.write(
      `try { Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))) } catch { }; [Console]::Out.WriteLine('${marker}')\n`
    );
  }

  stop() {
    this.queue = [];
    this.proc?.kill();
    this.proc = null;
  }
}

module.exports = { PsHost };
