import { useState } from 'react';
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
      className={`min-w-0 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 xl:p-6 print-plain ${className}`}
    >
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-1 max-w-[72ch] text-sm leading-relaxed text-slate-400">{subtitle}</p>}
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
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * 배지 3등급 — 가이드 01.
 *
 * 19종이 같은 형태·같은 무게라 읽는 순서가 없었습니다. 종류를 줄이는 대신
 * **무게를 재배분**합니다.
 *
 * - `block` 차단: 실행 자체가 불가능한 사유. 채워진 rose. **셀당 하나, 첫 줄.**
 * - `warn`  경고: 실행은 되지만 돈을 잃는 구조. 채워진 amber + 이유 문장.
 *   레버리지 역효과가 여기이고, 등급이 올라가 오히려 강해집니다.
 * - `cond`  조건: 한도·부담·현금 같은 수치. 테두리만, 무채색, 라벨+값.
 *
 * "밀림" 같은 절차 사유는 배지가 아니라 회색 문장으로 강등합니다.
 */
export type BadgeTier = 'block' | 'warn' | 'cond';

const TIER_CLASS: Record<BadgeTier, string> = {
  block: 'bg-rose-500/85 text-white border-rose-400/60 font-semibold',
  warn: 'bg-amber-500/85 text-slate-950 border-amber-400/60 font-semibold',
  cond: 'bg-transparent text-slate-300 border-slate-700',
};

export function TierBadge({
  tier,
  label,
  value,
  title,
}: {
  tier: BadgeTier;
  label: string;
  /** 조건 등급에서 라벨 옆에 붙는 값 */
  value?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap print-plain ${TIER_CLASS[tier]}`}
    >
      <span className={tier === 'cond' ? 'text-slate-400' : undefined}>{label}</span>
      {value && <span className="tabular-nums">{value}</span>}
    </span>
  );
}

/**
 * 가정값 표기 — 가이드 02.
 *
 * 실측과 자리표시자가 시각적으로 같으면, 인용되는 순간 구분이 사라집니다.
 * **색이 아니라 획과 밑줄로** 가릅니다 — 흑백 인쇄에서도 색각 이상에서도
 * 유지되는 유일한 신호이기 때문입니다. 가정값은 점선 밑줄 + 굵기·명도를 한 단
 * 낮추고, 출처는 값 바로 아래 고정합니다.
 */
export function ProvenanceValue({
  label,
  value,
  assumed,
  source,
  size = 'md',
}: {
  label: string;
  value: ReactNode;
  /** true 면 우리가 정한 값 (자리표시자) */
  assumed: boolean;
  /** 실측이면 출처, 가정이면 근거 없음을 적습니다 */
  source: string;
  size?: 'sm' | 'md';
}) {
  const valueSize = size === 'sm' ? 'text-base' : 'text-xl';
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xs text-slate-400">{label}</span>
        {assumed && (
          <span className="rounded border border-slate-700 px-1 text-2xs text-slate-400 print-plain">
            가정
          </span>
        )}
      </div>
      <div
        className={`mt-0.5 tabular-nums ${valueSize} ${
          assumed
            ? 'font-normal text-slate-400 underline decoration-slate-600 decoration-dotted underline-offset-4'
            : 'font-semibold text-slate-100'
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs leading-relaxed text-slate-400">{source}</div>
    </div>
  );
}

/**
 * 근거 칩 — 가이드 03.
 *
 * "3.64억"에서 "왜 3.64억인가"로 가는 길을 툴팁에 두면 인쇄에서 통째로 빠지고
 * 누를 수 있다는 신호도 없습니다. 화면에는 **상시 노출 칩**, 종이에는 각주 —
 * 같은 데이터를 쓰고 표현만 갈립니다.
 */
export function ProvenanceChip({
  children,
  footnote,
  onOpen,
  openLabel,
}: {
  children: ReactNode;
  /** 각주 번호. 인쇄본 각주 목록과 짝을 맞춥니다 */
  footnote?: number;
  onOpen?: () => void;
  openLabel?: string;
}) {
  return (
    <div className="mt-1 space-y-0.5">
      <div className="flex items-start gap-1 text-xs leading-relaxed text-slate-400">
        {footnote !== undefined && (
          <sup className="text-2xs text-slate-400 tabular-nums">{footnote}</sup>
        )}
        <span>{children}</span>
      </div>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="text-xs text-sky-400 transition hover:text-sky-300 no-print"
        >
          ▸ {openLabel}
        </button>
      )}
    </div>
  );
}

/**
 * 접히는 방법론 — 가이드 05.
 *
 * 한 줄도 지우지 않고 위치만 옮깁니다. 신뢰도 경고는 숫자에 붙고, 방법론·정의는
 * 개수를 보여주며 접힙니다. **인쇄할 때는 전부 펼쳐집니다** — 종이에서 접힘은
 * 정보 손실이기 때문입니다.
 */
export function Foldable({
  summary,
  count,
  children,
}: {
  summary: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="mt-3 print-open">
      <summary className="cursor-pointer list-none text-xs text-slate-300 transition hover:text-sky-300">
        ▸ {summary} {count}건
      </summary>
      <div className="mt-1.5 text-xs leading-relaxed text-slate-400">{children}</div>
    </details>
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
      <span className="block text-sm font-medium text-slate-200">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-base text-slate-100 outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/40';

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
      <span className="pointer-events-none absolute right-3 bottom-3 text-sm text-slate-400">
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
        <span className="pointer-events-none absolute right-3 bottom-3 text-sm text-slate-400">
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
        <span className="block text-sm font-medium text-slate-200">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
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
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-base' };
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
          className={`rounded-md px-3.5 py-2 text-sm font-medium transition ${
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
  size = 'md',
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: ReactNode;
  /** lg 는 화면의 머리 숫자 — 단지 상세의 최근 전세처럼 그 화면이 답하는 값 */
  size?: 'md' | 'lg';
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
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3.5 print-plain">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 font-semibold tabular-nums ${size === 'lg' ? 'text-2xl' : 'text-xl'} ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs leading-relaxed text-slate-400">{hint}</div>}
    </div>
  );
}

/**
 * 넓은 화면의 고정 열 — 입력·요약을 옆에 붙여 두고 결과만 스크롤합니다.
 *
 * 머리줄(탭)이 sticky 라 그 높이(App 이 재는 --header-h)만큼 내려 붙입니다. 화면보다 길면 레일 안에서만
 * 스크롤합니다 — 안 그러면 아래쪽이 본문 끝까지 가려집니다. xl 미만에서는 그냥
 * 블록이라 입력 → 결과 순서로 쌓입니다.
 */
export function Rail({
  children,
  className = '',
  split = false,
}: {
  children: ReactNode;
  className?: string;
  /**
   * true 면 레일 전체가 아니라 **첫 칸만** 스크롤하고 나머지는 아래에 붙여 둡니다.
   * 입력(위) + 결과 숫자(아래) 레일에서, 입력을 내려 고쳐도 결과가 안 가려지게.
   */
  split?: boolean;
}) {
  const scroll = split
    ? 'xl:flex xl:flex-col xl:[&>*:first-child]:min-h-0 xl:[&>*:first-child]:flex-1 xl:[&>*:first-child]:overflow-y-auto xl:[&>*:not(:first-child)]:shrink-0'
    : 'xl:overflow-y-auto';
  return (
    <aside
      className={`min-w-0 space-y-4 xl:sticky xl:top-[calc(var(--header-h,7.5rem)_+_1rem)] xl:max-h-[calc(100vh_-_var(--header-h,7.5rem)_-_2rem)] xl:self-start xl:overscroll-contain ${scroll} ${className}`}
    >
      {children}
    </aside>
  );
}

/**
 * 2단 배치 — 화면마다 임의 그리드를 적지 않게 묶습니다.
 *
 * `rail="left"` 는 왼쪽 22rem 고정 열(입력) + 오른쪽 결과, `"right"` 는 반대입니다.
 * 자식은 소스 순서 그대로 놓이므로 `left` 면 레일을 먼저, `right` 면 본문을 먼저 넣습니다.
 */
export function TwoCol({
  rail = 'right',
  children,
  className = '',
}: {
  rail?: 'left' | 'right';
  children: ReactNode;
  className?: string;
}) {
  const cols = rail === 'left' ? 'xl:grid-cols-[22rem_minmax(0,1fr)]' : 'xl:grid-cols-[minmax(0,1fr)_22rem]';
  return <div className={`grid gap-5 ${cols} ${className}`}>{children}</div>;
}

/**
 * 작은 설명 팝오버.
 *
 * `title` 속성에 기대면 **브라우저가 안 띄우는 경우가 있고**, 여러 줄·표를 담을
 * 수도 없습니다. 별점 기준처럼 "구간표" 를 보여줘야 하는 자리에는 직접 그린
 * 패널이 필요합니다.
 *
 * 마우스를 올리면 열리고 클릭으로 고정합니다 — 터치 기기에서는 hover 가
 * 없으므로 클릭이 유일한 길입니다.
 */
export function InfoPopover({
  icon,
  label,
  children,
  align = 'right',
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;

  return (
    <span
      className="relative inline-block no-print"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((v) => !v);
        }}
        className={`flex h-5 w-5 items-center justify-center rounded-full border text-2xs leading-none transition ${
          open
            ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
            : 'border-slate-700 text-slate-400 hover:border-sky-500/60 hover:text-sky-300'
        }`}
      >
        {icon}
      </button>
      {open && (
        <span
          className={`absolute top-6 z-30 block w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-left text-sm shadow-xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <span className="mb-1.5 block text-xs font-medium tracking-wide text-slate-400">
            {label}
          </span>
          {children}
        </span>
      )}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-700 px-6 py-10 text-center text-base text-slate-400">
      {children}
    </div>
  );
}
