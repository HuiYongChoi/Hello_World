import type { ChangeEvent, ReactNode } from 'react';

export function Card({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-800 bg-slate-900/50 p-5 print-plain ${className}`}
    >
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs leading-relaxed text-slate-400">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-slate-800 text-slate-300 border-slate-700',
  good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  bad: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
};

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/40';

export function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      className={inputClass}
      value={value}
      placeholder={placeholder}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}

/**
 * 금액 입력. 내부 상태는 원 단위, 표시는 만원 단위입니다.
 * 부동산 금액을 원 단위로 입력하면 0을 세게 되므로 만원으로 받습니다.
 */
export function MoneyInput({
  value,
  onChange,
  unit = '만원',
}: {
  value: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  const divisor = unit === '만원' ? 10000 : 1;
  return (
    <div className="relative">
      <input
        type="number"
        className={`${inputClass} pr-14`}
        value={Number.isFinite(value) ? Math.round(value / divisor) : 0}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n * divisor : 0);
        }}
      />
      <span className="pointer-events-none absolute right-3 bottom-2.5 text-xs text-slate-500">
        {unit}
      </span>
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  step = 1,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        step={step}
        className={`${inputClass} ${suffix ? 'pr-12' : ''}`}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 bottom-2.5 text-xs text-slate-500">
          {suffix}
        </span>
      )}
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      className={inputClass}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-slate-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2.5 text-left transition hover:border-slate-600"
    >
      <span
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${
          checked ? 'bg-sky-500' : 'bg-slate-700'
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white transition ${checked ? 'translate-x-4' : ''}`}
        />
      </span>
      <span>
        <span className="block text-xs font-medium text-slate-200">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span>}
      </span>
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}) {
  const variants = {
    default: 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700',
    primary: 'border-sky-500 bg-sky-500/90 text-white hover:bg-sky-500',
    danger: 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20',
    ghost: 'border-transparent bg-transparent text-slate-400 hover:text-slate-200',
  };
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm' };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border font-medium transition ${variants[variant]} ${sizes[size]}`}
    >
      {children}
    </button>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            value === o.value
              ? 'bg-sky-500 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: string;
}) {
  const color =
    tone === 'good'
      ? 'text-emerald-300'
      : tone === 'bad'
        ? 'text-rose-300'
        : tone === 'warn'
          ? 'text-amber-300'
          : 'text-slate-100';
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-3 print-plain">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-700 px-6 py-10 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}
