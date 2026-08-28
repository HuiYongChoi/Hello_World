import { percent } from '../engine/format';
import { TRAIT_LIFT_STRONG, TRAIT_LIFT_WEAK, TRAIT_MIN_BUCKET, type TraitBucket, type TraitGroup } from '../engine/ranking';

/**
 * 공통점 카드 — 상위권과 전체의 **구성비**를 비교합니다.
 *
 * ## 왜 "배" 를 그대로 쓰면 안 되나
 *
 * 부동산 화면에서 "2.77배" 는 거의 자동으로 **가격이 2.77배 올랐다**로 읽힙니다.
 * 실제 뜻은 전혀 다릅니다 — "이 특성이 상위권에 2.77배 자주 나타난다" 입니다.
 * 수익률과 빈도가 같은 단위로 보이면 숫자가 클수록 좋은 것처럼 오독됩니다.
 * 그래서 이 화면에서는 배수를 단독으로 두지 않고 **항상 "잦음" 을 붙이고**,
 * 그 근거인 두 비율(상위 76% vs 전체 28%)을 **같은 축 위에 아래위로** 놓습니다.
 * 좌우로 나란히 두면 두 막대가 서로 다른 자로 그려진 것처럼 보입니다.
 */

function liftLabel(lift: number): { text: string; strong: boolean; rare: boolean } {
  if (lift >= TRAIT_LIFT_STRONG) return { text: `${lift.toFixed(1)}배 자주`, strong: true, rare: false };
  if (lift <= TRAIT_LIFT_WEAK) return { text: `${lift.toFixed(1)}배 — 오히려 드묾`, strong: false, rare: true };
  return { text: '차이 없음', strong: false, rare: false };
}

function BucketRow({
  bucket: b,
  topCount,
  universe,
}: {
  bucket: TraitBucket;
  topCount: number;
  universe: number;
}) {
  const lift = liftLabel(b.lift);
  const allCount = Math.round(b.allShare * universe);
  // 두 막대를 같은 자로 그립니다 — 큰 쪽을 100%로 잡으면 축이 흔들려서 비교가 안 됩니다.
  const w = (share: number) => `${Math.min(100, share * 100)}%`;

  return (
    <div
      className="rounded-lg px-2 py-1.5 transition hover:bg-slate-900/50"
      title={
        `${b.key}\n` +
        `상위권 ${topCount}건 중 ${b.topCount}건 = ${percent(b.topShare, 1)}\n` +
        `전체 ${universe}건 중 ${allCount}건 = ${percent(b.allShare, 1)}\n` +
        // 표시용 반올림이라 나눗셈이 딱 떨어지지 않습니다 — ≈ 로 그 사실을 드러냅니다.
        `${percent(b.topShare, 1)} ÷ ${percent(b.allShare, 1)} ≈ ${b.lift.toFixed(2)}배 자주\n\n` +
        '가격 배수가 아니라 "얼마나 자주 나타나는가"의 배수입니다.'
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-200">{b.key}</span>
        <span
          className={`shrink-0 text-[10px] tabular-nums ${
            lift.strong ? 'font-semibold text-slate-100' : 'text-slate-500'
          }`}
        >
          {lift.rare && <span className="mr-0.5">↓</span>}
          {lift.text}
        </span>
      </div>

      <div className="mt-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-[9px] text-slate-400">상위권</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800/70">
            <div className="h-full rounded-full bg-slate-200" style={{ width: w(b.topShare) }} />
          </div>
          <span className="w-[68px] shrink-0 text-right text-[9px] tabular-nums text-slate-300">
            {b.topCount}/{topCount} · {percent(b.topShare, 0)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-[9px] text-slate-500">전체</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800/70">
            <div className="h-full rounded-full bg-slate-600" style={{ width: w(b.allShare) }} />
          </div>
          <span className="w-[68px] shrink-0 text-right text-[9px] tabular-nums text-slate-500">
            {allCount}/{universe} · {percent(b.allShare, 0)}
          </span>
        </div>
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
  // 표본이 한 자리면 배수가 커도 우연입니다. 기준 미만은 아예 내지 않습니다.
  const shown = group.buckets.filter((b) => b.topCount >= TRAIT_MIN_BUCKET).slice(0, maxBuckets);
  if (shown.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3.5">
      <h4 className="text-xs font-semibold text-slate-200">{group.label}</h4>
      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-600">{group.hint}</p>
      <div className="mt-2 space-y-1">
        {shown.map((b) => (
          <BucketRow key={b.key} bucket={b} topCount={topCount} universe={universe} />
        ))}
      </div>
    </div>
  );
}

/**
 * 카드 격자 위에 한 번만 놓는 읽는 법.
 *
 * 카드마다 반복하면 여섯 번 같은 문장을 읽게 됩니다 — 한 번만 말하고,
 * 자세한 계산은 각 줄의 호버에 둡니다.
 */
export function TraitLegend({ topCount, universe }: { topCount: number; universe: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-3.5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs font-semibold text-slate-200">읽는 법</span>
        <span className="text-[11px] leading-relaxed text-slate-400">
          <span className="inline-block h-2 w-2 translate-y-px rounded-full bg-slate-200" />{' '}
          <b className="text-slate-200">상위권</b> {topCount}건과{' '}
          <span className="inline-block h-2 w-2 translate-y-px rounded-full bg-slate-600" />{' '}
          <b className="text-slate-300">전체</b> {universe}건에서 그 특성이 차지하는 비율을
          같은 자로 겹쳐 봅니다.
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
        <b className="text-slate-300">“2.8배 자주”</b> 는 값이 2.8배 올랐다는 뜻이{' '}
        <b className="text-slate-300">아닙니다</b>. 상위권에서 그 특성이 나타나는 비율이 전체보다
        2.8배 높다는 뜻입니다 (상위 비율 ÷ 전체 비율). 각 줄에 마우스를 올리면 나눗셈이 그대로
        나옵니다.
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-600">
        상위권 {TRAIT_MIN_BUCKET}건 미만인 구간은 배수가 커도 우연이라 표시하지 않습니다.
        구간을 여러 개로 쪼개면 그중 몇 개는 우연히 상위와 겹칩니다 — 배수 하나만 보고 이야기를
        만들지 마세요.
      </p>
    </div>
  );
}
