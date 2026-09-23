import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { HISTORY } from '../store';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Smooth path through points using a Catmull-Rom → cubic Bézier conversion (clamped vertically). */
function smoothPath(pts: [number, number][], minY: number, maxY: number) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  const clampY = (y: number) => Math.max(minY, Math.min(maxY, y));
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.18;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = clampY(p1[1] + (p2[1] - p0[1]) * t);
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = clampY(p2[1] - (p3[1] - p1[1]) * t);
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export interface Series {
  label: string;
  data: number[];
  color: string;
  format?: (v: number) => string;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export function AreaChart({
  series,
  height = 160,
  max,
  yFormat = (v) => `${Math.round(v)}`,
  axis = true,
  hover = true,
  capacity = HISTORY,
  interval = 1000,
}: {
  series: Series[];
  height?: number;
  max?: number;
  yFormat?: (v: number) => string;
  axis?: boolean;
  hover?: boolean;
  capacity?: number;
  interval?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const uid = useId().replace(/:/g, '');
  const [hi, setHi] = useState<number | null>(null);
  const padTop = 8;
  const padBottom = axis ? 18 : 2;
  const padRight = axis ? 44 : 0;
  const w = Math.max(0, width - padRight);
  const h = height - padTop - padBottom;
  const peak = Math.max(0, ...series.flatMap((s) => s.data));
  const top = max ?? niceMax(peak * 1.15);
  const step = w / Math.max(1, capacity - 1);
  const n = Math.max(0, ...series.map((s) => s.data.length));
  const xAt = (i: number, len: number) => w - (len - 1 - i) * step;
  const yAt = (v: number) => padTop + h - (Math.max(0, Math.min(top, v)) / top) * h;

  const onMove = (e: React.MouseEvent) => {
    if (!hover || !n) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.round(n - 1 - (w - x) / step);
    setHi(idx >= 0 && idx < n ? idx : null);
  };

  const grid = [0.25, 0.5, 0.75, 1];

  return (
    <div ref={ref} className="chart" style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
      {width > 0 && (
        <svg width={width} height={height}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={i} id={`g${uid}${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.32} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {axis &&
            grid.map((g) => (
              <g key={g}>
                <line x1={0} x2={w} y1={yAt(top * g)} y2={yAt(top * g)} className="chart-grid" />
                <text x={w + 8} y={yAt(top * g) + 4} className="chart-label">{yFormat(top * g)}</text>
              </g>
            ))}
          {axis && (
            <>
              <line x1={0} x2={w} y1={padTop + h} y2={padTop + h} className="chart-grid chart-base" />
              <text x={0} y={height - 4} className="chart-label">{Math.round(((capacity - 1) * interval) / 1000)}s ago</text>
              <text x={w} y={height - 4} className="chart-label" textAnchor="end">now</text>
            </>
          )}
          {series.map((s, i) => {
            const len = s.data.length;
            if (!len) return null;
            const pts = s.data.map((v, j) => [xAt(j, len), yAt(v)] as [number, number]);
            const line = smoothPath(pts, padTop, padTop + h);
            const area = `${line} L${pts[pts.length - 1][0]},${padTop + h} L${pts[0][0]},${padTop + h} Z`;
            return (
              <g key={i}>
                <path d={area} fill={`url(#g${uid}${i})`} />
                <path d={line} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={3} fill={s.color} className="chart-head" />
              </g>
            );
          })}
          {hi != null && (
            <g>
              <line x1={xAt(hi, n)} x2={xAt(hi, n)} y1={padTop} y2={padTop + h} className="chart-cursor" />
              {series.map((s, i) => {
                const j = hi - (n - s.data.length);
                if (j < 0) return null;
                return <circle key={i} cx={xAt(hi, n)} cy={yAt(s.data[j])} r={4} fill="var(--panel)" stroke={s.color} strokeWidth={2} />;
              })}
            </g>
          )}
        </svg>
      )}
      {hi != null && width > 0 && (
        <div
          className="chart-tip"
          style={{ left: Math.min(Math.max(xAt(hi, n), 70), w - 70), top: 0 }}
        >
          <div className="chart-tip-time">{Math.round(((n - 1 - hi) * interval) / 1000)}s ago</div>
          {series.map((s, i) => {
            const j = hi - (n - s.data.length);
            if (j < 0) return null;
            return (
              <div key={i} className="chart-tip-row">
                <span className="dot" style={{ background: s.color }} />
                <span>{s.label}</span>
                <b>{(s.format || yFormat)(s.data[j])}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ data, color, height = 40, max }: { data: number[]; color: string; height?: number; max?: number }) {
  return <AreaChart series={[{ label: '', data, color }]} height={height} max={max} axis={false} hover={false} capacity={60} />;
}

export function Ring({
  value,
  size = 88,
  stroke = 8,
  color,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="ring-value"
          style={{ filter: `drop-shadow(0 0 6px ${color}55)` }}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

export function Bar({ value, color, height = 6 }: { value: number; color?: string; height?: number }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="bar" style={{ height }}>
      <div className="bar-fill" style={{ width: `${v}%`, background: color || 'var(--accent)' }} />
    </div>
  );
}
