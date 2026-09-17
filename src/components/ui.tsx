import React, { useEffect, useState } from 'react';

// ─── tiny shared UI primitives (keep views lean) ───────────────────────────

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'subtle';

export function Button({
  children, onClick, variant = 'ghost', type = 'button', disabled, title, className = '',
}: {
  children: React.ReactNode; onClick?: () => void; variant?: BtnVariant;
  type?: 'button' | 'submit'; disabled?: boolean; title?: string; className?: string;
}) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-medium px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const variants: Record<BtnVariant, string> = {
    primary: 'bg-blue-600 text-white hover:bg-blue-500 shadow-sm',
    ghost: 'border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800',
    danger: 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 border border-transparent',
    subtle: 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 ${className}`}>
      {children}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return (
    <input
      {...rest}
      className={`w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs
        text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none
        focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 ${className}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return (
    <textarea
      {...rest}
      className={`w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs
        font-mono text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none resize-y
        focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 ${className}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', ...rest } = props;
  return (
    <select
      {...rest}
      className={`rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs
        text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-blue-500/40 ${className}`}
    />
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">{children}</label>;
}

export function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${className}`}>{children}</span>;
}

export function EmptyState({ icon, title, hint, action }: { icon?: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-3 text-zinc-300 dark:text-zinc-600">{icon}</div>}
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{title}</p>
      {hint && <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500 max-w-xs">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Input that lets the user type freely (invalid/partial values never revert
 * the text). Commits on every change and on blur; parent decides validity.
 * Use `key` per entity so it remounts with fresh content.
 */
export function LazyInput({ value, onCommit, ...rest }: {
  value: string; onCommit: (text: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(value); }, [value, focused]);
  return (
    <Input
      {...rest}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); onCommit(text); }}
      onChange={(e) => { setText(e.target.value); onCommit(e.target.value); }}
    />
  );
}

export function LazyTextarea({ value, onCommit, ...rest }: {
  value: string; onCommit: (text: string) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(value); }, [value, focused]);
  return (
    <Textarea
      {...rest}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); onCommit(text); }}
      onChange={(e) => { setText(e.target.value); onCommit(e.target.value); }}
    />
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-xs text-zinc-400">
      <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      {label && <span>{label}</span>}
    </div>
  );
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  POST: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  PUT: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  PATCH: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  DELETE: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  HEAD: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  OPTIONS: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
};

export function MethodBadge({ method }: { method: string }) {
  return <span className={`method-badge ${METHOD_COLORS[method] || METHOD_COLORS.HEAD}`}>{method}</span>;
}

export function StatusDot({ status }: { status: 'passed' | 'failed' | 'skipped' | 'running' }) {
  const colors = {
    passed: 'bg-emerald-500',
    failed: 'bg-red-500',
    skipped: 'bg-zinc-300 dark:bg-zinc-600',
    running: 'bg-blue-500 animate-pulse',
  } as const;
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors[status]}`} />;
}
