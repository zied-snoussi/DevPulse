import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BatteryCharging, CheckCircle2, Code2, Gamepad2, Loader2, Power, RefreshCw, RotateCcw, ShieldAlert, Skull,
  Sparkles, Trash2, Undo2, Zap,
} from 'lucide-react';
import { groupProcesses, useStore } from '../store';
import { useFeedback, useKill } from '../components/feedback';
import { Card, PageHeader } from '../components/ui';
import { AppIcon } from './Dashboard';
import { bytes, cx } from '../lib/format';
import type { Change, OptimizerState, PowerMode, TweakId } from '../types';

type Profile = 'gaming' | 'dev' | 'battery';

interface Rec {
  id: TweakId | 'power' | 'gitLongPaths';
  title: string;
  why: string;
  target: boolean | PowerMode;
  current: boolean | PowerMode;
  admin?: boolean;
  restart?: string | null;
}

const PROFILES: Record<Profile, {
  name: string; tagline: string; icon: typeof Gamepad2; color: string;
  power: PowerMode; tweaks: TweakId[]; git?: boolean;
  close: { re: RegExp; why: string }[];
}> = {
  gaming: {
    name: 'Gaming',
    tagline: 'Max FPS and low input lag',
    icon: Gamepad2,
    color: '#f472b6',
    power: 'performance',
    tweaks: ['gameMode', 'noGameDvr', 'noMouseAccel', 'hags', 'noTransparency', 'noBackgroundApps'],
    close: [
      { re: /^(com\.docker|docker desktop|dockerd)/i, why: 'Docker reserves RAM and CPU' },
      { re: /^(node|java|javaw|gradle|python|pythonw|dotnet)$/i, why: 'Dev servers and build daemons' },
      { re: /^(code|cursor|studio64|idea64|webstorm64|rider64)$/i, why: 'IDEs index files in the background' },
      { re: /^(ms-teams|teams|slack|zoom)$/i, why: 'Chat apps wake up for notifications' },
      { re: /^(onedrive|dropbox|googledrivefs)$/i, why: 'Cloud sync uses disk and network' },
    ],
  },
  dev: {
    name: 'Development',
    tagline: 'Faster builds, fewer tooling errors',
    icon: Code2,
    color: '#8b5cf6',
    power: 'performance',
    tweaks: ['longPaths', 'devMode'],
    git: true,
    close: [
      { re: /^(epicgameslauncher|epicwebhelper|eosoverlayrenderer.*|steam|steamwebhelper|battle\.net|riotclient.*|eadesktop|galaxyclient|ubisoftconnect|xboxpcapp)$/i, why: 'Game launchers run overlays and updaters' },
      { re: /^(spotify)$/i, why: 'Music player keeps a web runtime alive' },
      { re: /^(discord)$/i, why: 'Uses a full Chromium runtime' },
    ],
  },
  battery: {
    name: 'Battery saver',
    tagline: 'Longer unplugged, cooler and quieter',
    icon: BatteryCharging,
    color: '#34d399',
    power: 'efficiency',
    tweaks: ['noTransparency', 'noAnimations', 'noBackgroundApps', 'noGameDvr'],
    close: [
      { re: /^(com\.docker|docker desktop)/i, why: 'Docker keeps a VM running' },
      { re: /^(epicgameslauncher|steam|steamwebhelper|battle\.net|riotclient.*|eadesktop)$/i, why: 'Launchers poll for updates' },
      { re: /^(onedrive|dropbox|googledrivefs)$/i, why: 'Sync drains battery' },
      { re: /^(spotify|discord)$/i, why: 'Background media and chat apps' },
    ],
  },
};

const POWER_LABEL: Record<PowerMode, string> = { performance: 'Best performance', balanced: 'Balanced', efficiency: 'Best power efficiency' };

export default function Optimize() {
  const { procs } = useStore();
  const { toast, confirm } = useFeedback();
  const { killPids } = useKill();
  const [state, setState] = useState<OptimizerState | null>(null);
  const [profile, setProfile] = useState<Profile>(() => (localStorage.getItem('devpulse.profile') as Profile) || 'dev');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setState(await window.devpulse.optimizerState()); } catch (e) { toast({ kind: 'error', title: 'Could not read settings', body: String(e) }); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { try { localStorage.setItem('devpulse.profile', profile); } catch {} }, [profile]);

  const recsFor = useCallback((p: Profile): Rec[] => {
    if (!state) return [];
    const def = PROFILES[p];
    const out: Rec[] = [{
      id: 'power',
      title: `Power mode: ${POWER_LABEL[def.power]}`,
      why: def.power === 'performance' ? 'Lets the CPU boost to full clock speed instead of saving power.' : 'Caps CPU boost and dims background activity to stretch battery life.',
      target: def.power,
      current: state.power.mode,
    }];
    for (const id of def.tweaks) {
      const t = state.tweaks[id];
      if (!t?.supported) continue;
      out.push({ id, title: state.meta[id].title, why: state.meta[id].why, target: true, current: t.enabled, admin: state.meta[id].admin, restart: state.meta[id].restart });
    }
    if (def.git && state.git.installed) {
      out.push({ id: 'gitLongPaths', title: 'Git: allow long paths', why: 'Stops "Filename too long" errors when cloning or checking out deep repos.', target: true, current: state.git.value });
    }
    return out;
  }, [state]);

  const recs = recsFor(profile);
  const pending = recs.filter((r) => r.current !== r.target);

  const closeList = useMemo(() => {
    const groups = groupProcesses(procs);
    return PROFILES[profile].close.flatMap(({ re, why }) =>
      groups.filter((g) => re.test(g.name) && !g.critical && g.mem > 30 * 1024 * 1024).map((g) => ({ g, why })))
      .sort((a, b) => b.g.mem - a.g.mem);
  }, [procs, profile]);

  const apply = async (changes: Change[], label: string) => {
    setBusy(label);
    try {
      const res = await window.devpulse.applyTweaks(changes);
      const failed = res.filter((r) => !r.ok);
      const restart = recs.filter((r) => changes.some((c) => c.id === r.id) && r.restart).map((r) => r.restart);
      if (!failed.length) {
        toast({
          kind: 'success',
          title: changes.length > 1 ? `${changes.length} optimizations applied` : 'Applied',
          body: restart.length ? `Some changes take effect after you ${restart.includes('restart') ? 'restart' : 'sign out'}.` : undefined,
        });
      } else {
        toast({ kind: 'warn', title: `${res.length - failed.length} of ${res.length} applied`, body: failed[0].error });
      }
    } finally {
      setBusy(null);
      load();
    }
  };

  const applyAll = async () => {
    const needsAdmin = pending.some((r) => r.admin);
    const ok = await confirm({
      title: `Apply the ${PROFILES[profile].name} profile?`,
      body: (
        <div className="confirm-list">
          {pending.map((r) => <div key={r.id}>• {r.title}{r.admin ? ' (admin)' : ''}</div>)}
          <div className="muted" style={{ marginTop: 8 }}>
            {needsAdmin ? 'Windows will ask once for administrator permission. ' : ''}Every change can be reverted from this page.
          </div>
        </div>
      ),
      confirmLabel: 'Apply all',
    });
    if (ok) apply(pending.map((r) => ({ id: r.id, value: r.target })), 'all');
  };

  const revert = async (ids: string[], label: string) => {
    setBusy(label);
    const r = await window.devpulse.revertTweaks(ids);
    setBusy(null);
    toast(r.ok ? { kind: 'success', title: 'Restored your previous settings', body: `${r.reverted.length} setting${r.reverted.length > 1 ? 's' : ''} reverted.` } : { kind: 'error', title: 'Could not revert everything' });
    load();
  };

  const cleanTemp = async () => {
    if (!state) return;
    const ok = await confirm({ title: 'Clean temporary files?', body: `Deletes ${state.temp.files.toLocaleString()} temp files older than 24 hours (${bytes(state.temp.size)}). Files in use are skipped.`, confirmLabel: 'Clean', danger: true });
    if (!ok) return;
    setBusy('temp');
    const r = await window.devpulse.cleanTemp();
    setBusy(null);
    toast({ kind: 'success', title: `Freed ${bytes(r.freed)}`, body: `${r.removed.toLocaleString()} files removed${r.skipped ? `, ${r.skipped} in use skipped` : ''}.` });
    load();
  };

  const wsl = async () => {
    setBusy('wsl');
    const r = await window.devpulse.wslShutdown();
    setBusy(null);
    toast(r.ok ? { kind: 'success', title: 'WSL shut down', body: 'Its memory has been returned to Windows.' } : { kind: 'error', title: 'Could not stop WSL', body: r.error });
    load();
  };

  const P = PROFILES[profile];
  const revertable = state?.backedUp || [];

  return (
    <div className="page">
      <PageHeader
        title="Optimize"
        subtitle="Pick what you're doing and DevPulse tunes Windows for it. Your original settings are saved, so every change can be undone."
        actions={<button className="btn btn-ghost" onClick={load}><RefreshCw size={15} /> Re-check</button>}
      />

      <div className="profiles">
        {(Object.keys(PROFILES) as Profile[]).map((id) => {
          const def = PROFILES[id];
          const r = recsFor(id);
          const done = r.filter((x) => x.current === x.target).length;
          const pctDone = r.length ? (done / r.length) * 100 : 0;
          return (
            <button key={id} className={cx('profile', profile === id && 'active')} style={{ ['--pc' as string]: def.color }} onClick={() => setProfile(id)}>
              <div className="profile-icon"><def.icon size={22} /></div>
              <div className="profile-text">
                <div className="profile-name">{def.name}</div>
                <div className="profile-tag">{def.tagline}</div>
              </div>
              <div className="profile-progress">
                <div className="bar" style={{ height: 5 }}><div className="bar-fill" style={{ width: `${pctDone}%`, background: def.color }} /></div>
                <span>{state ? `${done}/${r.length} optimized` : '…'}</span>
              </div>
            </button>
          );
        })}
      </div>

      <Card
        title={<>{P.name} settings</>}
        icon={<Sparkles size={16} />}
        actions={
          pending.length ? (
            <button className="btn btn-primary" disabled={!!busy} onClick={applyAll}>
              {busy === 'all' ? <Loader2 size={15} className="spin" /> : <Zap size={15} />} Apply {pending.length} recommendation{pending.length > 1 ? 's' : ''}
            </button>
          ) : state ? (
            <span className="pill pill-green"><CheckCircle2 size={14} /> Fully optimized</span>
          ) : null
        }
        pad={false}
      >
        {!state ? (
          <div className="loading-rows">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 58 }} />)}</div>
        ) : (
          <div className="tweaks">
            {recs.map((r) => {
              const ok = r.current === r.target;
              const canRevert = revertable.includes(r.id);
              return (
                <div key={r.id} className={cx('tweak', ok && 'done')}>
                  <div className={cx('tweak-status', ok ? 'ok' : 'todo')}>{ok ? <CheckCircle2 size={18} /> : <Sparkles size={18} />}</div>
                  <div className="tweak-main">
                    <div className="tweak-title">
                      {r.title}
                      {r.admin && <span className="tag"><ShieldAlert size={11} /> Admin</span>}
                      {r.restart && <span className="tag">Needs {r.restart}</span>}
                    </div>
                    <div className="tweak-why">{r.why}</div>
                    {r.id === 'power' && !ok && <div className="tweak-now">Currently: {POWER_LABEL[r.current as PowerMode]}</div>}
                  </div>
                  <div className="tweak-actions">
                    {canRevert && (
                      <button className="btn btn-sm btn-ghost" disabled={!!busy} title="Restore the value you had before DevPulse changed it" onClick={() => revert([r.id], r.id)}>
                        <Undo2 size={13} /> Revert
                      </button>
                    )}
                    {ok ? (
                      <span className="applied">Applied</span>
                    ) : (
                      <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => apply([{ id: r.id, value: r.target }], r.id)}>
                        {busy === r.id ? <Loader2 size={13} className="spin" /> : null} Apply
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid-2">
        <Card title={`Close for ${P.name.toLowerCase()}`} icon={<Skull size={16} />} pad={false}>
          {closeList.length === 0 ? (
            <div className="mini-empty"><CheckCircle2 size={22} /><div>Nothing is slowing this profile down</div><small>No background apps from the {P.name.toLowerCase()} blocklist are running.</small></div>
          ) : (
            <div className="list">
              {closeList.map(({ g, why }) => (
                <div key={g.key} className="list-row">
                  <AppIcon name={g.title} />
                  <div className="list-main">
                    <div className="row between"><span className="list-title">{g.title}</span><b className="mono">{bytes(g.mem)}</b></div>
                    <div className="list-sub">{why}{g.count > 1 ? ` · ${g.count} processes` : ''}</div>
                  </div>
                  <button className="btn btn-sm btn-danger-soft" onClick={() => killPids(g.procs.map((p) => p.pid), g.title)}>Close</button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Quick fixes" icon={<Zap size={16} />} pad={false}>
          <div className="list">
            <div className="list-row">
              <div className="qf-icon"><Trash2 size={16} /></div>
              <div className="list-main">
                <span className="list-title">Clean temporary files</span>
                <span className="list-sub">{state ? `${bytes(state.temp.size)} in ${state.temp.files.toLocaleString()} files older than a day` : 'Measuring…'}</span>
              </div>
              <button className="btn btn-sm btn-ghost" disabled={!state || !state.temp.files || !!busy} onClick={cleanTemp}>
                {busy === 'temp' ? <Loader2 size={13} className="spin" /> : null} Clean
              </button>
            </div>
            {state?.wslRunning && (
              <div className="list-row">
                <div className="qf-icon"><Power size={16} /></div>
                <div className="list-main">
                  <span className="list-title">Shut down WSL</span>
                  <span className="list-sub">The WSL VM (vmmem) keeps RAM even when idle. Stops Docker too.</span>
                </div>
                <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={wsl}>{busy === 'wsl' ? <Loader2 size={13} className="spin" /> : null} Shut down</button>
              </div>
            )}
            <div className="list-row">
              <div className="qf-icon"><Power size={16} /></div>
              <div className="list-main">
                <span className="list-title">Review startup apps</span>
                <span className="list-sub">{state ? `${state.startupCount} programs launch with Windows. Fewer means faster boot.` : '…'}</span>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => window.devpulse.openUrl('ms-settings:startupapps')}>Open</button>
            </div>
            <div className="list-row">
              <div className="qf-icon"><Trash2 size={16} /></div>
              <div className="list-main">
                <span className="list-title">Storage Sense</span>
                <span className="list-sub">Let Windows empty the Recycle Bin and old downloads automatically.</span>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => window.devpulse.openUrl('ms-settings:storagesense')}>Open</button>
            </div>
            {revertable.length > 0 && (
              <div className="list-row">
                <div className="qf-icon"><RotateCcw size={16} /></div>
                <div className="list-main">
                  <span className="list-title">Undo everything DevPulse changed</span>
                  <span className="list-sub">{revertable.length} setting{revertable.length > 1 ? 's' : ''} can be restored to their original values.</span>
                </div>
                <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => revert(revertable, 'all-revert')}>
                  {busy === 'all-revert' ? <Loader2 size={13} className="spin" /> : null} Restore all
                </button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
