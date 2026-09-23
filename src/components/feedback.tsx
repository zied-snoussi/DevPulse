import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, X, XCircle, Info } from 'lucide-react';
import { useStore } from '../store';

type ToastKind = 'success' | 'error' | 'info' | 'warn';
interface Toast { id: number; kind: ToastKind; title: string; body?: string; action?: { label: string; run: () => void } }

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface Feedback {
  toast(t: Omit<Toast, 'id'>): void;
  confirm(o: ConfirmOptions): Promise<boolean>;
}

const Ctx = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const seq = useRef(0);

  const dismiss = (id: number) => setToasts((ts) => ts.filter((t) => t.id !== id));

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    window.setTimeout(() => dismiss(id), t.action ? 9000 : 4500);
  }, []);

  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })),
    []
  );

  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const icons = { success: CheckCircle2, error: XCircle, info: Info, warn: AlertTriangle };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts">
        {toasts.map((t) => {
          const Icon = icons[t.kind];
          return (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              <Icon size={18} className="toast-icon" />
              <div className="toast-text">
                <div className="toast-title">{t.title}</div>
                {t.body && <div className="toast-body">{t.body}</div>}
                {t.action && (
                  <button className="btn btn-sm btn-ghost toast-action" onClick={() => { t.action!.run(); dismiss(t.id); }}>
                    {t.action.label}
                  </button>
                )}
              </div>
              <button className="icon-btn icon-btn-sm" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {dialog && (
        <div className="overlay" onMouseDown={() => close(false)}>
          <div className="dialog" onMouseDown={(e) => e.stopPropagation()} role="alertdialog">
            <div className={`dialog-icon ${dialog.danger ? 'danger' : ''}`}>
              <AlertTriangle size={20} />
            </div>
            <div className="dialog-title">{dialog.title}</div>
            {dialog.body && <div className="dialog-body">{dialog.body}</div>}
            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => close(false)}>Cancel <kbd>Esc</kbd></button>
              <button className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>
                {dialog.confirmLabel || 'Confirm'} <kbd>↵</kbd>
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useFeedback() {
  const f = useContext(Ctx);
  if (!f) throw new Error('useFeedback outside FeedbackProvider');
  return f;
}

/** Kill actions with confirmation, toasts and the "restart as admin" escape hatch. */
export function useKill() {
  const { toast, confirm } = useFeedback();
  const { settings, refreshPorts, info } = useStore();

  const adminAction = info?.admin
    ? undefined
    : { label: 'Restart as administrator', run: () => window.devpulse.relaunchAsAdmin() };

  const killPort = useCallback(
    async (port: number, what?: string) => {
      if (settings.confirmKill) {
        const ok = await confirm({
          title: `Kill port ${port}?`,
          body: <>This ends <b>{what || 'the process'}</b> and its child processes. Unsaved work in that process will be lost.</>,
          confirmLabel: 'Kill port',
          danger: true,
        });
        if (!ok) return false;
      }
      const r = await window.devpulse.killPort(port);
      if (r.ok) toast({ kind: 'success', title: `Port ${port} is free`, body: what ? `${what} was stopped.` : undefined });
      else toast({ kind: r.needsAdmin ? 'warn' : 'error', title: `Couldn't kill port ${port}`, body: r.error, action: r.needsAdmin ? adminAction : undefined });
      refreshPorts();
      return r.ok;
    },
    [settings.confirmKill, confirm, toast, refreshPorts, adminAction]
  );

  const killPids = useCallback(
    async (pids: number[], label: string, opts: { critical?: boolean; tree?: boolean } = {}) => {
      if (opts.critical) {
        toast({ kind: 'warn', title: 'Protected process', body: `${label} is a critical Windows process. Ending it could crash or lock your PC.` });
        return false;
      }
      if (settings.confirmKill) {
        const ok = await confirm({
          title: pids.length > 1 ? `End ${pids.length} "${label}" processes?` : `End "${label}"?`,
          body: <>Unsaved work in {pids.length > 1 ? 'these processes' : 'this process'} will be lost.</>,
          confirmLabel: 'End task',
          danger: true,
        });
        if (!ok) return false;
      }
      const results = pids.length === 1
        ? [await window.devpulse.killPid(pids[0], opts.tree ?? true)]
        : await window.devpulse.killPids(pids);
      const failed = results.filter((r) => !r.ok);
      if (!failed.length) toast({ kind: 'success', title: `${label} ended`, body: pids.length > 1 ? `${pids.length} processes stopped.` : `PID ${pids[0]} stopped.` });
      else {
        const needsAdmin = failed.some((r) => r.needsAdmin);
        toast({
          kind: needsAdmin ? 'warn' : 'error',
          title: failed.length === results.length ? `Couldn't end ${label}` : `${results.length - failed.length} of ${results.length} ended`,
          body: failed[0].error,
          action: needsAdmin ? adminAction : undefined,
        });
      }
      refreshPorts();
      return !failed.length;
    },
    [settings.confirmKill, confirm, toast, refreshPorts, adminAction]
  );

  return { killPort, killPids };
}

export function AdminBadge() {
  const { info } = useStore();
  if (!info || info.admin) return null;
  return (
    <button className="admin-hint" onClick={() => window.devpulse.relaunchAsAdmin()} title="Some system processes can only be ended with admin rights">
      <ShieldAlert size={14} /> Run as admin
    </button>
  );
}
