import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, FileSearch, FolderOpen, Info, Loader2, Power, Radar,
  ShieldAlert, ShieldCheck, ShieldX, Skull, ThumbsUp,
} from 'lucide-react';
import { useFeedback, useKill } from '../components/feedback';
import { Ring } from '../components/charts';
import { Card, Empty, PageHeader } from '../components/ui';
import { bytes, cx, shortPath, since } from '../lib/format';
import type { DefenderResult, Finding, ScanProgress, SecurityReport } from '../types';

// Kept outside the component so the last report survives page switches.
let lastReport: SecurityReport | null = null;

const TRUST_KEY = 'devpulse.trusted';
const loadTrusted = (): string[] => {
  try { return JSON.parse(localStorage.getItem(TRUST_KEY) || '[]'); } catch { return []; }
};

const LEVEL = {
  high: { label: 'High risk', color: 'var(--red)', icon: ShieldX },
  medium: { label: 'Suspicious', color: 'var(--amber)', icon: ShieldAlert },
  low: { label: 'Worth a look', color: 'var(--accent-2)', icon: Info },
  ok: { label: 'OK', color: 'var(--green)', icon: ShieldCheck },
} as const;

function securityScore(r: SecurityReport, findings: Finding[]) {
  let score = 100;
  const d = r.defender;
  if (d.available && !d.realtime) score -= 40;
  if (d.available && d.sigUpdated && Date.now() - new Date(d.sigUpdated).getTime() > 3 * 86400000) score -= 15;
  if (!d.available) score -= 10;
  const active = (d.threats || []).filter((t) => !t.resolved).length;
  score -= Math.min(30, active * 30);
  score -= Math.min(50, findings.filter((f) => f.level === 'high').length * 25);
  score -= Math.min(20, findings.filter((f) => f.level === 'medium').length * 8);
  score -= Math.min(10, r.startup.filter((s) => s.level === 'high' || s.level === 'medium').length * 5);
  return Math.max(0, Math.min(100, score));
}

export default function Security() {
  const { toast, confirm } = useFeedback();
  const { killPids } = useKill();
  const [report, setReport] = useState<SecurityReport | null>(lastReport);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [trusted, setTrusted] = useState<string[]>(loadTrusted);
  const [showLow, setShowLow] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [fileScans, setFileScans] = useState<Record<string, DefenderResult | 'running'>>({});
  const [quickScan, setQuickScan] = useState<'idle' | 'running'>('idle');

  const scanning = progress !== null;

  const scan = async () => {
    setProgress({ step: 'Starting', pct: 0 });
    const off = window.devpulse.onScanProgress(setProgress);
    try {
      const r = await window.devpulse.securityScan();
      lastReport = r;
      setReport(r);
    } catch (e) {
      toast({ kind: 'error', title: 'Scan failed', body: String(e) });
    } finally {
      off();
      setProgress(null);
    }
  };

  useEffect(() => { if (!lastReport) scan(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const findings = useMemo(
    () => (report?.findings || []).filter((f) => !f.path || !trusted.includes(f.path.toLowerCase())),
    [report, trusted]
  );
  const counts = {
    high: findings.filter((f) => f.level === 'high').length,
    medium: findings.filter((f) => f.level === 'medium').length,
    low: findings.filter((f) => f.level === 'low').length,
  };
  const visible = findings.filter((f) => showLow || f.level !== 'low');
  const score = report ? securityScore(report, findings) : 0;
  const scoreColor = score >= 85 ? 'var(--green)' : score >= 60 ? 'var(--amber)' : 'var(--red)';

  const trust = (f: Finding) => {
    if (!f.path) return;
    const next = [...new Set([...trusted, f.path.toLowerCase()])];
    setTrusted(next);
    try { localStorage.setItem(TRUST_KEY, JSON.stringify(next)); } catch {}
    toast({ kind: 'info', title: `${f.name} marked as trusted`, body: 'It will be hidden from future scans.' });
  };

  const resetTrusted = () => {
    setTrusted([]);
    try { localStorage.removeItem(TRUST_KEY); } catch {}
  };

  const scanFile = async (file: string) => {
    setFileScans((s) => ({ ...s, [file]: 'running' }));
    const r = await window.devpulse.defenderScanFile(file);
    setFileScans((s) => ({ ...s, [file]: r }));
    if (!r.ok) toast({ kind: 'error', title: 'Defender scan failed', body: r.error });
    else if (r.clean) toast({ kind: 'success', title: 'Defender: no threat found', body: shortPath(file, 60) });
    else toast({ kind: 'error', title: `Defender found: ${r.threat}`, body: 'Kill the process, then remove it from Windows Security → Protection history.' });
  };

  const virusTotal = async (file: string) => {
    const hash = await window.devpulse.fileHash(file);
    if (!hash) return toast({ kind: 'error', title: 'Could not read the file to hash it' });
    window.devpulse.openUrl(`https://www.virustotal.com/gui/file/${hash}`);
    toast({ kind: 'info', title: 'Opened VirusTotal', body: 'Only the file fingerprint (SHA-256) was used; the file was not uploaded.' });
  };

  const runQuickScan = async () => {
    const ok = await confirm({
      title: 'Run a Windows Defender quick scan?',
      body: 'Checks the places malware usually hides. Takes a few minutes; you can keep using your PC.',
      confirmLabel: 'Start scan',
    });
    if (!ok) return;
    setQuickScan('running');
    toast({ kind: 'info', title: 'Defender quick scan started', body: 'You will be notified when it finishes.' });
    const r = await window.devpulse.defenderQuickScan();
    setQuickScan('idle');
    if (!r.ok) toast({ kind: 'error', title: 'Quick scan failed', body: r.error });
    else if (r.clean) toast({ kind: 'success', title: 'Quick scan complete: no threats found' });
    else toast({ kind: 'error', title: 'Defender found threats', body: 'Open Windows Security to review and remove them.', action: { label: 'Open Windows Security', run: () => window.devpulse.openUrl('windowsdefender://threat') } });
    scan();
  };

  const d = report?.defender;

  return (
    <div className="page">
      <PageHeader
        title="Security"
        subtitle="Spots processes that behave like malware and tells you why. Final verdicts come from Windows Defender and VirusTotal."
        actions={
          <>
            <button className="btn btn-ghost" disabled={quickScan === 'running'} onClick={runQuickScan}>
              {quickScan === 'running' ? <Loader2 size={15} className="spin" /> : <Radar size={15} />}
              {quickScan === 'running' ? 'Defender scanning…' : 'Defender quick scan'}
            </button>
            <button className="btn btn-primary" disabled={scanning} onClick={scan}>
              {scanning ? <Loader2 size={15} className="spin" /> : <FileSearch size={15} />} {scanning ? 'Scanning…' : 'Scan now'}
            </button>
          </>
        }
      />

      <div className="sec-hero">
        <div className="sec-score">
          <Ring value={report ? score : 0} size={128} stroke={11} color={report ? scoreColor : 'var(--panel-3)'}>
            <div className="ring-num">{report ? score : '—'}</div>
            <div className="ring-sub">security score</div>
          </Ring>
          <div>
            <div className="sec-verdict" style={{ color: report ? scoreColor : undefined }}>
              {!report ? 'Scanning your PC…' : counts.high ? `${counts.high} high-risk process${counts.high > 1 ? 'es' : ''} found` : counts.medium ? `${counts.medium} suspicious item${counts.medium > 1 ? 's' : ''} to review` : 'No threats detected'}
            </div>
            <div className="page-sub">
              {report ? <>Checked {report.scanned} processes and {report.files} programs · {report.externalConnections} internet connections · scanned {since(report.at)} ago</> : 'Checking signatures, locations, command lines and network activity'}
            </div>
            {scanning && progress && (
              <div className="scan-progress">
                <div className="bar" style={{ height: 6 }}><div className="bar-fill" style={{ width: `${progress.pct}%`, background: 'linear-gradient(90deg, var(--accent), var(--accent-2))' }} /></div>
                <span>{progress.step}…</span>
              </div>
            )}
          </div>
        </div>
        <div className="sec-checks">
          <Check ok={!!d?.realtime} loading={!d} label="Real-time protection" detail={d ? (d.available ? (d.realtime ? 'Windows Defender is on' : 'Turned off: your PC is exposed') : 'Another antivirus manages protection') : ''} />
          <Check ok={!!d?.sigUpdated && Date.now() - new Date(d.sigUpdated).getTime() < 3 * 86400000} loading={!d} label="Virus definitions" detail={d?.sigUpdated ? `Updated ${since(d.sigUpdated)} ago` : '—'} />
          <Check ok={!!d?.tamper} loading={!d} label="Tamper protection" detail={d?.tamper ? 'Malware cannot switch Defender off' : 'Off: consider enabling it'} />
          <Check ok={!(d?.threats || []).some((t) => !t.resolved)} loading={!d} label="Threat history" detail={d?.threats?.length ? `${d.threats.length} past detection${d.threats.length > 1 ? 's' : ''}` : 'Nothing detected recently'} />
          <Check ok={!!d?.quickScan && Date.now() - new Date(d.quickScan).getTime() < 7 * 86400000} loading={!d} label="Last quick scan" detail={d?.quickScan ? `${since(d.quickScan)} ago` : 'Never'} />
          {d && (!d.realtime || !d.tamper) && (
            <button className="btn btn-sm btn-ghost" onClick={() => window.devpulse.openUrl('ms-settings:windowsdefender')}><ExternalLink size={13} /> Open Windows Security</button>
          )}
        </div>
      </div>

      <Card
        title={<>Suspicious processes {report && <span className="count-pill">{counts.high + counts.medium}</span>}</>}
        icon={<ShieldAlert size={16} />}
        actions={
          <>
            {trusted.length > 0 && <button className="link" onClick={resetTrusted}>Reset {trusted.length} trusted</button>}
            {counts.low > 0 && (
              <label className="switch-label">
                <input type="checkbox" className="switch" checked={showLow} onChange={(e) => setShowLow(e.target.checked)} />
                Show {counts.low} low-risk notes
              </label>
            )}
          </>
        }
        pad={false}
      >
        {!report ? (
          <div className="loading-rows">{Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" style={{ height: 64 }} />)}</div>
        ) : visible.length === 0 ? (
          <Empty
            icon={<ShieldCheck size={26} />}
            title="Nothing suspicious running"
            body={counts.low ? `${counts.low} low-risk note${counts.low > 1 ? 's' : ''} hidden (unsigned apps in normal places).` : 'Every running program looks legitimate.'}
          />
        ) : (
          <div className="findings">
            {visible.map((f) => {
              const key = `${f.path || f.name}:${f.pid}`;
              const L = LEVEL[f.level];
              const expanded = open === key;
              const fs = f.path ? fileScans[f.path] : undefined;
              return (
                <div key={key} className={cx('finding', `finding-${f.level}`, expanded && 'open')}>
                  <button className="finding-head" onClick={() => setOpen(expanded ? null : key)}>
                    <span className="finding-icon" style={{ color: L.color }}><L.icon size={18} /></span>
                    <div className="finding-main">
                      <div className="finding-title">
                        {f.name}
                        <span className="risk" style={{ ['--rc' as string]: L.color }}>{L.label} · {f.score}</span>
                        {fs && fs !== 'running' && fs.ok && (
                          <span className={cx('risk', !fs.clean && 'risk-solid')} style={{ ['--rc' as string]: fs.clean ? 'var(--green)' : 'var(--red)' }}>
                            Defender: {fs.clean ? 'clean' : fs.threat}
                          </span>
                        )}
                      </div>
                      <div className="finding-reason">{f.reasons[0]?.text}{f.reasons.length > 1 && <span className="muted"> · +{f.reasons.length - 1} more</span>}</div>
                    </div>
                    <div className="finding-meta mono">{f.pids.length > 1 ? `${f.pids.length} processes` : `PID ${f.pid}`}</div>
                    <ChevronDown size={16} className={cx('chev-down', expanded && 'open')} />
                  </button>
                  {expanded && (
                    <div className="finding-body">
                      <ul className="reasons">
                        {f.reasons.map((r, i) => (
                          <li key={i}><AlertTriangle size={13} /> <span>{r.text}</span> <b className="mono">+{r.pts}</b></li>
                        ))}
                      </ul>
                      <div className="detail-grid">
                        <Kv label="Location" value={f.path || 'Unknown (protected process)'} mono />
                        <Kv label="Publisher" value={f.signer ? `${f.signer} (${f.signature === 'Valid' ? 'verified' : f.signature})` : f.signature === 'NotSigned' ? 'Unsigned: unknown publisher' : f.signature} />
                        <Kv label="Started by" value={f.parent ? `${f.parent} (PID ${f.ppid})` : `PID ${f.ppid}`} />
                        <Kv label="Resources" value={`${f.cpu.toFixed(1)}% CPU · ${bytes(f.mem)}${f.connections.length ? ` · ${f.connections.length} internet connection${f.connections.length > 1 ? 's' : ''}` : ''}`} />
                      </div>
                      {f.cmd && (
                        <div className="cmd">
                          <div className="cmd-head"><span>Command line</span></div>
                          <code>{f.cmd}</code>
                        </div>
                      )}
                      <div className="detail-actions">
                        <button className="btn btn-sm btn-ghost" onClick={() => trust(f)} disabled={!f.path}><ThumbsUp size={13} /> I trust this</button>
                        {f.path && <button className="btn btn-sm btn-ghost" onClick={() => window.devpulse.reveal(f.path!)}><FolderOpen size={13} /> Show file</button>}
                        {f.path && <button className="btn btn-sm btn-ghost" onClick={() => virusTotal(f.path!)}><ExternalLink size={13} /> Check on VirusTotal</button>}
                        {f.path && (
                          <button className="btn btn-sm btn-ghost" disabled={fs === 'running'} onClick={() => scanFile(f.path!)}>
                            {fs === 'running' ? <Loader2 size={13} className="spin" /> : <Radar size={13} />} Scan with Defender
                          </button>
                        )}
                        <button className="btn btn-sm btn-danger" onClick={() => killPids(f.pids, f.name, { tree: true })}>
                          <Skull size={13} /> Kill {f.pids.length > 1 ? `all ${f.pids.length}` : 'process'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid-2">
        <Card
          title="Programs that start with Windows"
          icon={<Power size={16} />}
          actions={<button className="link" onClick={() => window.devpulse.openUrl('ms-settings:startupapps')}>Manage startup apps</button>}
          pad={false}
        >
          <div className="list">
            {(report?.startup || []).map((s) => {
              const L = LEVEL[s.level];
              return (
                <div key={s.name + s.command} className="list-row" title={s.command}>
                  <span className="finding-icon sm" style={{ color: L.color }}><L.icon size={16} /></span>
                  <div className="list-main">
                    <div className="row between gap-8">
                      <span className="list-title">{s.name}</span>
                      <span className="risk" style={{ ['--rc' as string]: L.color }}>{s.level === 'ok' ? (s.signer ? 'Verified' : 'OK') : L.label}</span>
                    </div>
                    <div className="list-sub">{s.reasons[0]?.text || s.signer || shortPath(s.path || s.command, 60)}</div>
                  </div>
                  {s.path && <button className="icon-btn" title="Show file" onClick={() => window.devpulse.reveal(s.path!)}><FolderOpen size={15} /></button>}
                </div>
              );
            })}
            {report && !report.startup.length && <div className="mini-empty"><CheckCircle2 size={22} /><div>No startup programs</div></div>}
          </div>
        </Card>

        <Card title="How the scanner decides" icon={<Info size={16} />}>
          <ul className="howto">
            <li><b>Identity:</b> a program named like a Windows process (svchost, lsass…) running from the wrong folder, or a lookalike name (scvhost).</li>
            <li><b>Signature:</b> unsigned or tampered files outside Program Files and Windows.</li>
            <li><b>Location:</b> executables running from Temp, Downloads, the Recycle Bin or Public folders.</li>
            <li><b>Behaviour:</b> hidden encoded PowerShell, download-and-run commands, Office spawning shells, backup deletion, crypto-miner patterns.</li>
            <li><b>Network:</b> unsigned programs talking to the internet or to mining-pool ports.</li>
          </ul>
          <p className="muted small">A flag is not proof of malware. Before killing something you don't recognize, use <b>Scan with Defender</b> or <b>VirusTotal</b>.</p>
          {d?.threats && d.threats.length > 0 && (
            <>
              <div className="subhead">Recent Defender detections</div>
              {d.threats.map((t, i) => (
                <div key={i} className="kv">
                  <span>{t.name || 'Threat'}</span>
                  <b className={t.resolved ? 'ok-text' : 'danger-text'}>{t.resolved ? 'Removed' : 'Action needed'} · {since(t.time)} ago</b>
                </div>
              ))}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Check({ ok, label, detail, loading }: { ok: boolean; label: string; detail: string; loading?: boolean }) {
  return (
    <div className="check">
      {loading ? <Loader2 size={16} className="spin muted" /> : ok ? <CheckCircle2 size={16} color="var(--green)" /> : <AlertTriangle size={16} color="var(--amber)" />}
      <div>
        <div className="check-label">{label}</div>
        <div className="check-detail">{loading ? 'Checking…' : detail}</div>
      </div>
    </div>
  );
}

function Kv({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="detail-item">
      <div className="detail-label">{label}</div>
      <div className={cx('detail-value', mono && 'mono')}><span title={value}>{value}</span></div>
    </div>
  );
}
