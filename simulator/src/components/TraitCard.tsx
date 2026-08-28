import { percent } from '../engine/format';
import {
  TRAIT_LIFT_STRONG,
  TRAIT_LIFT_WEAK,
  TRAIT_MIN_BUCKET,
  type TraitBucket,
  type TraitGroup,
} from '../engine/ranking';

/**
 * 공통점 카드 — **그 특성을 고르면 상위권에 들 확률**을 봅니다.
 *
 * ## 왜 방향을 뒤집었나
 *
 * 원래 지표는 "상위권 중 76%가 중동" 이었습니다. 그런데 사람은 그렇게 묻지
 * 않습니다 — "중동을 고르면 상위권에 들 확률이 얼마인가" 를 묻습니다.
 * 베이즈로 배수는 같지만 뒤집은 쪽이 세 가지를 얻습니다.
 *
 * 1. **기준선이 하나로 고정**됩니다. 상위 20% 를 뽑았으니 아무거나 골라도
 *    20% 입니다. 구간마다 다른 "전체 비중" 을 매번 읽을 필요가 없습니다.
 * 2. **배수를 안 써도 강도가 보입니다.** 20% → 62% 는 그 자체로 읽힙니다.
 *    "3.1배" 는 부동산 화면에서 거의 자동으로 가격 배수로 오독됩니다.
 * 3. **표본 크기가 분모로 드러납니다.** "8건 중 5건" 은 62% 가 8건짜리
 *    이야기라는 걸 숨길 수 없습니다. 이전 표기(`5/86 · 6%`)로는 8건이라는
 *    사실이 아예 안 보였습니다.
 */

/** 분모가 이보다 작으면 확률이 튑니다 — 숫자는 내되 흐리게 냅니다. */
const THIN_SAMPLE = 10;

function BucketRow({
  bucket: b,
  baseRate,
}: {
  bucket: TraitBucket;
  baseRate: number;
}) {
  const strong = b.lift >= TRAIT_LIFT_STRONG;
  const rare = b.lift <= TRAIT_LIFT_WEAK;
  const thin = b.allCount < THIN_SAMPLE;
  // 확률 막대는 0~100% 고정 축입니다. 최대값에 맞춰 늘이면 기준선이 흔들립니다.
  const w = `${Math.min(100, b.hitRate * 100)}%`;

  return (
    <div
      className="rounded-lg px-2 py-1.5 transition hover:bg-slate-900/50"
      title={
        `${b.key}\n` +
        `이 구간 ${b.allCount}건 중 ${b.topCount}건이 상위권 = ${percent(b.hitRate, 1)}\n` +
        `아무거나 골랐을 때 = ${percent(baseRate, 1)}\n` +
        `→ ${(b.hitRate / Math.max(1e-9, baseRate)).toFixed(2)}배\n\n` +
        (thin ? `표본이 ${b.allCount}건뿐이라 한두 건에 크게 흔들립니다.\n` : '')
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-200">{b.key}</span>
        <span
          className={`shrink-0 text-[10px] tabular-nums ${
            thin ? 'text-amber-500/70' : 'text-slate-500'
          }`}
        >
          {b.allCount}건 중 {b.topCount}건
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-800/70">
          {/*
            * 표본이 얇으면 강조보다 그쪽이 이깁니다. 8건 중 5건짜리 63% 를
            * 40건짜리 63% 와 같은 밝기로 그리면, 강조가 곧 신뢰로 읽힙니다.
            */}
          <div
            className={`h-full rounded-full ${
              thin ? 'bg-slate-500' : strong ? 'bg-slate-200' : rare ? 'bg-slate-700' : 'bg-slate-500'
            }`}
            style={{ width: w }}
          />
          {/* 고정 기준선 — 이 선을 넘었는지가 판단의 전부입니다. */}
          <div
            className="absolute inset-y-0 w-px bg-amber-400/70"
            style={{ left: `${Math.min(100, baseRate * 100)}%` }}
          />
        </div>
        <span
          className={`w-9 shrink-0 text-right text-[11px] tabular-nums ${
            thin ? 'text-slate-500' : strong ? 'font-semibold text-slate-100' : 'text-slate-300'
          }`}
        >
          {percent(b.hitRate, 0)}
        </span>
      </div>
    </div>
  );
}

export function TraitCard({
  group,
  topCount,
  universe,
  maxBuckets = 4,
}: {
  group: TraitGroup;
  topCount: number;
  universe: number;
  maxBuckets?: number;
}) {
  // 표본이 한 자리면 확률이 커도 우연입니다. 기준 미만은 아예 내지 않습니다.
  const shown = group.buckets.filter((b) => b.topCount >= TRAIT_MIN_BUCKET).slice(0, maxBuckets);
  if (shown.length === 0) return null;
  const baseRate = topCount / Math.max(1, universe);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3.5">
      <h4 className="text-xs font-semibold text-slate-200">{group.label}</h4>
      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-600">{group.hint}</p>
      <div className="mt-2 space-y-1">
        {shown.map((b) => (
          <BucketRow key={b.key} bucket={b} baseRate={baseRate} />
        ))}
      </div>
    </div>
  );
}

/**
 * 카드 격자 위에 한 번만 놓는 읽는 법.
 *
 * 기준선이 고정이라 설명도 한 문장이면 끝납니다 — 카드마다 반복할 이유가
 * 없습니다. 자세한 나눗셈은 각 줄의 호버에 둡니다.
 */
export function TraitLegend({ topCount, universe }: { topCount: number; universe: number }) {
  const baseRate = topCount / Math.max(1, universe);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-3.5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs font-semibold text-slate-200">읽는 법</span>
        <span className="text-[11px] leading-relaxed text-slate-400">
          막대는 <b className="text-slate-200">그 특성을 고르면 상위권에 들 확률</b>입니다.
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
        전체 {universe}건 중 상위 {topCount}건을 뽑았으니,{' '}
        <b className="text-slate-300">아무거나 골라도 {percent(baseRate, 0)}</b>는 상위권입니다.
        막대 위{' '}
        <span className="inline-block h-2.5 w-px translate-y-0.5 bg-amber-400/70 align-middle" />{' '}
        <span className="text-amber-300/80">노란 선</span>이 그 {percent(baseRate, 0)} 자리입니다
        — 선을 얼마나 넘었는지가 판단의 전부입니다. 외울 기준은 이 하나뿐입니다.
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-600">
        분모(&quot;○○건 중&quot;)를 같이 봐 주세요. {THIN_SAMPLE}건 미만이면 한두 건에 확률이
        크게 흔들려 흐리게 냈습니다. 상위권 {TRAIT_MIN_BUCKET}건 미만인 구간은 아예 표시하지
        않습니다. 구간을 여러 개로 쪼개면 그중 몇 개는 우연히 상위와 겹칩니다 — 확률 하나만
        보고 이야기를 만들지 마세요.
      </p>
    </div>
  );
}
