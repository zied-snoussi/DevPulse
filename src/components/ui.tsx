import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { cx } from '../lib/format';
import type { Port } from '../types';

export function Card({ title, icon, actions, children, className, pad = true }: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="card-head">
          <div className="card-title">{icon}{title}</div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-body' : undefined}>{children}</div>
    </section>
  );
}

export function TechBadge({ tech }: { tech: Port['tech'] }) {
  return (
    <span className="tech" style={{ ['--tc' as string]: tech.color }}>
      <span className="tech-dot" />
      {tech.label}
    </span>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, size }: {
  value: T;
  options: { value: T; label: ReactNode; count?: number }[];
  onChange: (v: T) => void;
  size?: 'sm';
}) {
  return (
    <div className={cx('seg', size === 'sm' && 'seg-sm')} role="tablist">
      {options.map((o) => (
        <button key={String(o.value)} role="tab" aria-selected={o.value === value} className={cx('seg-item', o.value === value && 'active')} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count != null && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, inputRef }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <label className="search">
      <Search size={15} />
      <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} />
      {value && (
        <button className="icon-btn icon-btn-sm" onClick={() => onChange('')} aria-label="Clear">
          <X size={13} />
        </button>
      )}
    </label>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {body && <div className="empty-body">{body}</div>}
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} />;
}
