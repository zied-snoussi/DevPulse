const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function bytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(digits)} ${UNITS[i]}`;
}

export function rate(n: number): string {
  return `${bytes(n)}/s`;
}

export function pct(n: number, digits = 0): string {
  return `${(Number.isFinite(n) ? n : 0).toFixed(digits)}%`;
}

export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

export function since(iso: string | null | undefined): string {
  if (!iso) return '—';
  return duration(Date.now() - new Date(iso).getTime());
}

export function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

/** Traffic-light color for a 0–100 load value. */
export function loadColor(v: number): string {
  if (v >= 85) return 'var(--red)';
  if (v >= 60) return 'var(--amber)';
  return 'var(--green)';
}

export function shortPath(p: string | null | undefined, max = 48): string {
  if (!p) return '';
  if (p.length <= max) return p;
  const parts = p.split('\\');
  if (parts.length <= 3) return `…${p.slice(-max)}`;
  return `${parts[0]}\\…\\${parts.slice(-2).join('\\')}`;
}

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}
