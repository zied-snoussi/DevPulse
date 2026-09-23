import { useEffect, useState } from 'react';
import { ArrowUpCircle, CheckCircle2, Download, Loader2, RefreshCw, RotateCw } from 'lucide-react';
import { rate, since } from '../lib/format';
import type { UpdateStatus } from '../types';

export function useUpdate() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    window.devpulse.updateStatus().then(setStatus, () => {});
    return window.devpulse.onUpdateStatus(setStatus);
  }, []);
  return status;
}

/** Sidebar card shown only when a new version exists. */
export function UpdateCard() {
  const s = useUpdate();
  if (!s || !['available', 'downloading', 'ready'].includes(s.state)) return null;
  return (
    <div className="update-card">
      <div className="update-head">
        <ArrowUpCircle size={16} />
        <span>{s.state === 'ready' ? 'Restarting…' : `Version ${s.available} is out`}</span>
      </div>
      {s.state === 'available' && (
        <button className="btn btn-primary btn-sm update-btn" onClick={() => window.devpulse.downloadUpdate()}>
          <Download size={14} /> Update now
        </button>
      )}
      {s.state === 'downloading' && (
        <>
          <div className="bar" style={{ height: 5 }}>
            <div className="bar-fill" style={{ width: `${s.percent ?? 0}%`, background: 'linear-gradient(90deg, var(--accent), var(--accent-2))' }} />
          </div>
          <div className="update-sub">Downloading {Math.round(s.percent ?? 0)}%{s.bytesPerSecond ? ` · ${rate(s.bytesPerSecond)}` : ''}</div>
        </>
      )}
      {s.state === 'ready' && <div className="update-sub"><Loader2 size={12} className="spin" /> Installing, DevPulse will reopen</div>}
    </div>
  );
}

/** Settings section: current version and a manual check. */
export function UpdateSettings() {
  const s = useUpdate();
  if (!s) return null;
  const busy = s.state === 'checking' || s.state === 'downloading' || s.state === 'ready';
  return (
    <div className="setting">
      <div>
        <div className="setting-label">DevPulse {s.version}</div>
        <div className="setting-hint">
          {s.state === 'dev' && 'Updates are disabled in development mode.'}
          {s.state === 'idle' && 'Checks for updates automatically a few seconds after launch.'}
          {s.state === 'checking' && 'Checking for updates…'}
          {s.state === 'latest' && <><CheckCircle2 size={12} color="var(--green)" style={{ verticalAlign: -2 }} /> You're on the latest version{s.checkedAt ? ` · checked ${since(s.checkedAt)} ago` : ''}.</>}
          {s.state === 'available' && `Version ${s.available} is available.`}
          {s.state === 'downloading' && `Downloading ${s.available}: ${Math.round(s.percent ?? 0)}%`}
          {s.state === 'ready' && 'Installing the update, DevPulse will restart.'}
          {s.state === 'error' && `Update check failed: ${s.error}`}
        </div>
      </div>
      <div>
        {s.state === 'available' ? (
          <button className="btn btn-primary" onClick={() => window.devpulse.downloadUpdate()}><Download size={15} /> Update to {s.available}</button>
        ) : (
          <button className="btn btn-ghost" disabled={busy || s.state === 'dev'} onClick={() => window.devpulse.checkForUpdate()}>
            {busy ? <Loader2 size={15} className="spin" /> : s.state === 'error' ? <RotateCw size={15} /> : <RefreshCw size={15} />} Check for updates
          </button>
        )}
      </div>
    </div>
  );
}
