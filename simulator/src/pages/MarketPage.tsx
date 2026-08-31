import { useMemo, useState } from 'react';
import {
  Badge,
  Card,
  Empty,
  Field,
  Foldable,
  NumberInput,
  SegmentedControl,
  Select,
  Stat,
  TextInput,
  TierBadge,
} from '../components/ui';
import { money, percent } from '../engine/format';
import {
  MARKET,
  cagrBetween,
  holdingDistribution,
  mainSize,
  quarterLabel,
  safetyMargin,
  searchComplexes,
  THIN_DEAL_COUNT,
  type MarketPoint,
} from '../engine/market';
import { useStore } from '../state/store';
import {
  rollingBacktest,
  splitValidate,
  type BenchmarkMode,
  type EntryQuarterStat,
  type SplitValidation,
} from '../engine/backtest';

/** 중위가 추이 스파크라인. 거래가 얇은 분기는 점을 비워 표시합니다. */
function Series({
  points,
  fromQ,
  toQ,
}: {
  points: MarketPoint[];
  fromQ: number;
  toQ: number;
}) {
  const w = 100;
  const h = 28;
  const qs = points.map((p) => p.q);
  const minQ = Math.min(...qs);
  const maxQ = Math.max(...qs);
  const prices = points.map((p) => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);

  const x = (q: number) => ((q - minQ) / Math.max(1, maxQ - minQ)) * w;
  const y = (p: number) => h - ((p - minP) / Math.max(1, maxP - minP)) * h;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.q).toFixed(2)},${y(p.price).toFixed(2)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-20 w-full">
      <rect
        x={x(fromQ)}
        y={0}
        width={Math.max(0.5, x(toQ) - x(fromQ))}
        height={h}
        className="fill-sky-500/10"
      />
      <path d={d} className="fill-none stroke-sky-400" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      {points
        .filter((p) => p.q === fromQ || p.q === toQ)
        .map((p) => (
          <circle key={p.q} cx={x(p.q)} cy={y(p.price)} r={1.4} className="fill-sky-300" />
        ))}
    </svg>
  );
}

/**
 * 분포를 띠 하나로 — 가이드 04.
 *
 * 예전에는 값을 축 라벨로 아래에 늘어놓고 판정을 배지로 옆에 뒀는데, 정작
 * 읽어야 할 것은 **판정 문장**이었습니다. 문장을 띠 위로 올리고, 값은 축이
 * 아니라 띠에 직접 붙입니다.
 *
 * 표본이 얇으면 띠 자체를 흐리게 죽입니다 — "읽지 말라"고 그림으로 말하는
 * 편이 경고 문구보다 강합니다. 진입시점이 하나뿐이면 분포라 부를 수 없으므로
 * 띠를 아예 그리지 않습니다.
 */
function DistributionRow({
  label,
  dist,
  reference,
}: {
  label: string;
  dist: ReturnType<typeof holdingDistribution>;
  reference: number;
}) {
  if (!dist) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-800/60 px-3 py-2">
        <span className="text-xs text-slate-500">{label}</span>
        <span className="text-[11px] text-slate-600">
          이 기간으로 짝지을 진입시점이 없습니다
        </span>
      </div>
    );
  }

  // 진입시점이 하나면 분포가 아닙니다 — 사분위가 전부 같은 값으로 뭉개집니다.
  if (dist.count < 2) {
    return (
      <div className="rounded-lg border border-slate-800/60 bg-slate-950/30 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400">{label}</span>
          <TierBadge tier="cond" label={`표본 ${dist.count}개 · 분포 아님`} />
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
          진입시점이 하나뿐이라 분포라 부를 수 없습니다.{' '}
          <span className="text-slate-300">{percent(dist.median, 1)}</span>는 한 사례의
          결과입니다.
        </p>
      </div>
    );
  }

  const margin = safetyMargin(dist, reference);
  const lo = Math.min(dist.worst, reference, 0) - 0.01;
  const hi = Math.max(dist.best, reference, 0) + 0.01;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const width = (a: number, b: number) => `${((b - a) / (hi - lo)) * 100}%`;

  /*
   * 판정 문장은 실제 비율에서 뽑습니다. "넷 중 하나꼴"처럼 고정 문구를 쓰면
   * 2건 중 2건이 못 미쳤는데 "절반 가까이"라고 적히는 일이 생깁니다.
   */
  const missCount = Math.round(dist.count * (1 - margin.beatRatio));
  const verdict =
    missCount === 0
      ? '어느 시점에 들어갔어도 기준선을 넘었습니다.'
      : missCount === dist.count
        ? `${dist.count}개 진입시점 전부가 기준선에 못 미쳤습니다.`
        : `진입시점 ${dist.count}개 중 ${missCount}개(${percent(
            1 - margin.beatRatio,
            0
          )})가 기준선에 못 미쳤습니다.`;

  return (
    <div
      className={`rounded-lg border px-3.5 py-3 ${
        dist.thin
          ? 'border-slate-800/60 bg-slate-950/20 opacity-55'
          : 'border-slate-800 bg-slate-950/40'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-300">{label}</span>
          {dist.thin && <TierBadge tier="warn" label={`표본 ${dist.count}개 — 얇음`} />}
        </div>
        <span className="text-[10px] text-slate-600">진입시점 {dist.count}개</span>
      </div>

      {/* 판정 문장이 주인공입니다 */}
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
        언제 들어갔느냐로 연{' '}
        <span className="text-slate-200">{percent(dist.worst, 1)}</span> ~{' '}
        <span className="text-slate-200">{percent(dist.best, 1)}</span> 까지 갈렸습니다.{' '}
        <span className={missCount > dist.count / 4 ? 'text-amber-300' : 'text-slate-400'}>
          {verdict}
        </span>
      </p>

      {/* 값은 축 라벨이 아니라 띠에 직접 붙습니다 */}
      <div className="relative mt-4 mb-5 h-8">
        {lo < 0 && (
          <div
            className="absolute inset-y-0 rounded-l bg-rose-500/10"
            style={{ left: 0, width: width(lo, Math.min(0, hi)) }}
          />
        )}
        <div
          className="absolute top-4 h-px bg-slate-700"
          style={{ left: x(dist.worst), width: width(dist.worst, dist.best) }}
        />
        <div
          className="absolute top-2 h-5 rounded bg-slate-600/40 ring-1 ring-slate-500/50"
          style={{ left: x(dist.p25), width: width(dist.p25, dist.p75) }}
        />
        <div className="absolute top-1.5 h-6 w-0.5 bg-slate-100" style={{ left: x(dist.median) }} />
        <div
          className="absolute inset-y-0 w-px border-l border-dashed border-amber-400"
          style={{ left: x(reference) }}
        />
        {[dist.worst, dist.best].map((v, i) => (
          <div key={i} className="absolute top-2.5 h-3 w-px bg-slate-500" style={{ left: x(v) }} />
        ))}

        {/* 띠에 직접 붙는 값 */}
        <span
          className="absolute top-full mt-0.5 -translate-x-1/2 text-[9px] tabular-nums text-slate-500"
          style={{ left: x(dist.worst) }}
        >
          {percent(dist.worst, 1)}
        </span>
        <span
          className="absolute top-full mt-0.5 -translate-x-1/2 text-[9px] font-semibold tabular-nums text-slate-200"
          style={{ left: x(dist.median) }}
        >
          중위 {percent(dist.median, 1)}
        </span>
        <span
          className="absolute top-full mt-0.5 -translate-x-1/2 text-[9px] tabular-nums text-slate-500"
          style={{ left: x(dist.best) }}
        >
          {percent(dist.best, 1)}
        </span>
        <span
          className="absolute -top-3.5 -translate-x-1/2 text-[9px] tabular-nums text-amber-400"
          style={{ left: x(reference) }}
        >
          기준 {percent(reference, 1)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-slate-800/70 pt-2">
        <div title="진입시점을 고를 수 없다면 하위 구간이 실질 기대치입니다. 이 값이 기준선을 넘는지가 실행 여부를 가릅니다.">
          <div className="text-[10px] text-slate-600">
            안전마진 (하위25% − 기준) <span className="text-slate-700">ⓘ</span>
          </div>
          <div
            className={`text-sm font-semibold tabular-nums ${
              margin.marginAtP25 >= 0 ? 'text-emerald-300' : 'text-rose-300'
            }`}
          >
            {margin.marginAtP25 >= 0 ? '+' : ''}
            {percent(margin.marginAtP25, 1)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-600">기준 넘긴 진입시점</div>
          <div className="text-sm font-semibold tabular-nums text-slate-100">
            {percent(margin.beatRatio, 0)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-600">손실로 끝난 비율</div>
          <div
            className={`text-sm font-semibold tabular-nums ${
              dist.lossRatio > 0 ? 'text-rose-300' : 'text-slate-100'
            }`}
          >
            {percent(dist.lossRatio, 0)}
          </div>
        </div>
      </div>
    </div>
  );
}

const BENCHMARKS: { value: BenchmarkMode; label: string; hint: string }[] = [
  {
    value: 'cohort',
    label: '같은 시기',
    hint: '같은 진입분기 표본의 중위를 뺍니다. 시기 효과가 빠지고, 정의상 중위가 0이라 부호를 그대로 읽습니다.',
  },
  {
    value: 'district',
    label: '같은 시기·동네',
    hint: '같은 진입분기 · 같은 시군구 중위를 뺍니다. 남는 것은 단지 고유분이라 시군구 공통점은 여기서 안 보입니다.',
  },
  {
    value: 'market',
    label: '시장지수',
    hint: '수집 3권역 합산 연쇄지수. 지수는 위로 치우쳐(연쇄 드리프트) 중위 초과수익이 음수로 나옵니다.',
  },
  {
    value: 'none',
    label: '변환 없음',
    hint: '절대 수익률. 시기 효과가 그대로 남아 "많이 오른 때 들어갔다" 가 1등 공통점이 됩니다.',
  },
];

const VERDICT: Record<SplitValidation['verdict'], { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; text: string }> = {
  holds: {
    label: '대체로 남았습니다',
    tone: 'good',
    text: '학습 구간에서 강했던 공통점이 검증 구간에서도 기준선 위였습니다. 그래도 한 번의 분할일 뿐입니다.',
  },
  mixed: {
    label: '절반쯤만 남았습니다',
    tone: 'warn',
    text: '찾은 공통점의 절반은 그 시기의 성질이었습니다. 남은 쪽만 이야기로 쓰세요.',
  },
  fails: {
    label: '거의 안 남았습니다',
    tone: 'bad',
    text: '학습 구간의 공통점이 검증 구간에서 대부분 깨졌습니다. 시기를 맞힌 것이지 물건을 고른 것이 아닙니다.',
  },
  thin: {
    label: '판정할 표본이 모자랍니다',
    tone: 'neutral',
    text: '학습 구간에서 강하게 몰린 구간 자체가 몇 개 없습니다.',
  },
};

/** 진입분기별 중위 — 막대 하나가 "그때 들어갔으면" 입니다. */
function EntryBars({ rows }: { rows: EntryQuarterStat[] }) {
  const span = Math.max(0.01, ...rows.map((r) => Math.abs(r.medianCagr)));
  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const v = r.medianCagr;
        const up = v >= 0;
        return (
          <div key={r.q} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[10px] text-slate-500 tabular-nums">
              {r.label}
            </span>
            <div className="relative h-3 flex-1 overflow-hidden rounded bg-slate-900/60">
              <div className="absolute inset-y-0 left-1/2 w-px bg-slate-700" />
              <div
                className={`absolute inset-y-0 rounded-sm ${up ? 'bg-sky-500/60' : 'bg-rose-500/60'}`}
                style={{
                  left: up ? '50%' : `${50 - (Math.abs(v) / span) * 50}%`,
                  width: `${(Math.abs(v) / span) * 50}%`,
                }}
              />
            </div>
            <span
              className={`w-14 shrink-0 text-right text-[11px] tabular-nums ${
                up ? 'text-slate-200' : 'text-rose-300'
              }`}
            >
              {percent(v, 1)}
            </span>
            <span className="w-11 shrink-0 text-right text-[10px] text-slate-600 tabular-nums">
              {r.n}건
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 같은 분기에 들어간 표본의 초과수익 **폭**.
 *
 * 코호트 기준선을 쓰면 중위는 정의상 0이라 볼 것이 없습니다. 볼 것은 폭입니다 —
 * 같은 시기에 들어가도 물건에 따라 얼마나 갈렸나. 이 폭이 곧 물건을 고르는
 * 일로 벌 수 있었던 범위이고, 시기 막대(왼쪽)와 견주면 **시기와 선택 중
 * 무엇이 더 컸는지**가 보입니다.
 */
function SpreadBars({ rows }: { rows: EntryQuarterStat[] }) {
  const lo = Math.min(0, ...rows.map((r) => r.p25Excess));
  const hi = Math.max(0, ...rows.map((r) => r.p75Excess));
  const span = Math.max(0.01, hi - lo);
  const pos = (v: number) => ((v - lo) / span) * 100;
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.q} className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[10px] text-slate-500 tabular-nums">
            {r.label}
          </span>
          <div className="relative h-3 flex-1 overflow-hidden rounded bg-slate-900/60">
            <div
              className="absolute inset-y-0 w-px bg-slate-700"
              style={{ left: `${pos(0)}%` }}
            />
            <div
              className="absolute inset-y-0 rounded-sm bg-slate-500/50"
              style={{
                left: `${pos(r.p25Excess)}%`,
                width: `${Math.max(1, pos(r.p75Excess) - pos(r.p25Excess))}%`,
              }}
            />
          </div>
          <span className="w-14 shrink-0 text-right text-[11px] text-slate-200 tabular-nums">
            {percent(r.spreadExcess, 1)}
          </span>
          <span className="w-11 shrink-0 text-right text-[10px] text-slate-600 tabular-nums">
            {percent(r.p25Excess, 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 롤링 백테스트 — **진입시점 축**.
 *
 * 위 카드들은 단지 하나를 골라 놓고 봅니다. 여기는 스냅샷 전체를 모든
 * 진입분기에서 굴려, "언제 들어갔느냐" 가 결과를 얼마나 가르는지와
 * **그때 찾은 공통점이 다음 시기에도 남는지**를 봅니다.
 */
function BacktestCard() {
  const [holdYears, setHoldYears] = useState<'3' | '5' | '10'>('5');
  const [benchmark, setBenchmark] = useState<BenchmarkMode>('cohort');

  const bt = useMemo(
    () => rollingBacktest({ holdYears: Number(holdYears), benchmark }),
    [holdYears, benchmark]
  );
  const sv = useMemo(() => (bt ? splitValidate(bt) : null), [bt]);

  if (!bt) {
    return (
      <Card title="롤링 백테스트 — 진입시점 축">
        <Empty>이 보유기간으로 만들 수 있는 표본이 없습니다.</Empty>
      </Card>
    );
  }

  const benchmarkHint = BENCHMARKS.find((b) => b.value === benchmark)!.hint;
  const converted = benchmark !== 'none';

  return (
    <Card
      title="롤링 백테스트 — 진입시점 축"
      subtitle="지역은 3개뿐이라 특징 추출 표본이 못 됩니다. 대신 모든 단지·평형을 모든 진입분기에서 굴려, 시점 축에서 봅니다."
      action={
        <SegmentedControl<'3' | '5' | '10'>
          value={holdYears}
          onChange={setHoldYears}
          options={[
            { value: '3', label: '3년' },
            { value: '5', label: '5년' },
            { value: '10', label: '10년' },
          ]}
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="표본"
          value={bt.samples.length.toLocaleString('ko-KR')}
          hint={`단지·평형 ${bt.cells.toLocaleString('ko-KR')}칸 × 진입분기 ${bt.entryQuarters.length}개`}
        />
        <Stat label="중위 수익률" value={percent(bt.medianCagr, 1)} hint="연환산, 명목" />
        <Stat
          label="중위 초과수익"
          value={percent(bt.medianExcess, 1)}
          tone={converted && Math.abs(bt.medianExcess) < 0.005 ? 'neutral' : undefined}
          hint={converted ? '기준선 대비 %p' : '변환하지 않음'}
        />
        <Stat
          label="기준선 위 비율"
          value={percent(bt.beatShare, 0)}
          hint={converted ? '초과수익이 양수인 표본' : '수익이 양수인 표본'}
        />
      </div>

      <div className="mt-4">
        <Field label="초과수익 기준선" hint={benchmarkHint}>
          <Select<BenchmarkMode>
            value={benchmark}
            onChange={setBenchmark}
            options={BENCHMARKS.map((b) => ({ value: b.value, label: b.label }))}
          />
        </Field>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-[11px] font-medium tracking-wide text-slate-500">
            진입분기별 중위 수익률 — 언제 들어갔느냐
          </h4>
          <EntryBars rows={bt.entryQuarters} />
        </div>
        <div>
          <h4 className="mb-2 text-[11px] font-medium tracking-wide text-slate-500">
            같은 분기에 들어간 것들끼리의 폭 — 하위25%~상위25%
          </h4>
          <SpreadBars rows={bt.entryQuarters} />
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            왼쪽 막대의 높낮이는 <b className="text-slate-300">시기</b>이고, 오른쪽 막대의 길이는{' '}
            <b className="text-slate-300">선택</b>입니다. 오른쪽 끝 숫자가 폭(%p), 그 옆이 하위
            25% 위치입니다. 폭이 시기 차이보다 크면 언제 들어가느냐보다 무엇을 고르느냐가 더
            갈랐다는 뜻입니다.
          </p>
        </div>
      </div>

      {sv && (
        <div className="mt-6 border-t border-slate-800 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-[11px] font-medium tracking-wide text-slate-500">
              시점 분할 검증 — {quarterLabel(sv.trainRange[0])}~{quarterLabel(sv.trainRange[1])} 진입에서
              찾은 공통점이 {quarterLabel(sv.testRange[0])}~{quarterLabel(sv.testRange[1])} 진입에도 남는가
            </h4>
            <Badge tone={VERDICT[sv.verdict].tone === 'neutral' ? 'neutral' : VERDICT[sv.verdict].tone}>
              재현 {sv.heldCount}/{sv.strongCount} · {percent(sv.reproducedShare, 0)}
            </Badge>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            <b className="text-slate-200">{VERDICT[sv.verdict].label}</b> —{' '}
            {VERDICT[sv.verdict].text}
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-[11px]">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-800">
                  <th className="py-1.5 pr-3 font-medium">학습에서 강했던 구간</th>
                  <th className="py-1.5 pr-3 text-right font-medium">학습 배수</th>
                  <th className="py-1.5 pr-3 text-right font-medium">검증 배수</th>
                  <th className="py-1.5 pr-3 text-right font-medium">검증 표본</th>
                  <th className="py-1.5 font-medium">판정</th>
                </tr>
              </thead>
              <tbody>
                {sv.groups.flatMap((g) =>
                  g.buckets
                    .filter((b) => b.strongInTrain)
                    .map((b) => (
                      <tr key={`${g.id}|${b.key}`} className="border-b border-slate-900">
                        <td className="py-1.5 pr-3 text-slate-300">
                          <span className="text-slate-600">{g.label}</span> · {b.key}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-slate-200 tabular-nums">
                          {b.trainLift.toFixed(2)}배
                          <span className="ml-1 text-slate-600">
                            ({b.trainTop}/{b.trainAll})
                          </span>
                        </td>
                        <td
                          className={`py-1.5 pr-3 text-right tabular-nums ${
                            b.unmeasurable
                              ? 'text-slate-600'
                              : b.holds
                                ? 'text-emerald-300'
                                : 'text-rose-300'
                          }`}
                        >
                          {b.unmeasurable ? '—' : `${b.testLift.toFixed(2)}배`}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-slate-500 tabular-nums">
                          {b.testTop}/{b.testAll}
                        </td>
                        <td className="py-1.5">
                          {b.unmeasurable ? (
                            <span className="text-slate-600">판정 불가</span>
                          ) : b.holds ? (
                            <span className="text-emerald-300">재현</span>
                          ) : (
                            <span className="text-rose-300">깨짐</span>
                          )}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            배수는 <b className="text-slate-300">그 구간을 고르면 상위 {sv.topPercent}%에 들 확률</b>이
            기준선의 몇 배인가입니다. 아무거나 골라도 {sv.topPercent}% 이므로 1배가 기준선입니다.
            상위권은 학습·검증 <b className="text-slate-300">각각 안에서</b> 따로 뽑습니다 — 안 그러면
            검증이 시기 맞히기가 됩니다.
          </p>

          <Foldable summary="이 검증이 못 하는 것" count={sv.caveats.length}>
            <ul className="space-y-1">
              {sv.caveats.map((c) => (
                <li key={c} className="text-[10px] leading-relaxed text-slate-500">
                  · {c}
                </li>
              ))}
            </ul>
          </Foldable>
        </div>
      )}

      <Foldable summary="이 표본이 못 하는 것" count={bt.caveats.length}>
        <ul className="space-y-1">
          {bt.caveats.map((c) => (
            <li key={c} className="text-[10px] leading-relaxed text-slate-500">
              · {c}
            </li>
          ))}
        </ul>
      </Foldable>
    </Card>
  );
}

export function MarketPage() {
  const { properties } = useStore();
  const [query, setQuery] = useState('');
  const [complexId, setComplexId] = useState('');
  const [areaKey, setAreaKey] = useState('');
  const [fromQ, setFromQ] = useState<number | null>(null);
  const [toQ, setToQ] = useState<number | null>(null);
  // 기준선 기본값은 은행 주담대 금리 수준 — "빌려서 사도 남는가"가 됩니다.
  const [reference, setReference] = useState(0.045);

  const results = useMemo(() => searchComplexes(query), [query]);
  const complex = results.find((c) => c.id === complexId) ?? results[0];
  const size =
    complex?.sizes.find((s) => String(s.area) === areaKey) ??
    (complex ? mainSize(complex) : null);

  const points = size?.points ?? [];
  const first = points[0]?.q ?? 0;
  const last = points[points.length - 1]?.q ?? 0;
  const start = fromQ !== null && points.some((p) => p.q === fromQ) ? fromQ : first;
  const end = toQ !== null && points.some((p) => p.q === toQ) ? toQ : last;

  const result = useMemo(() => cagrBetween(points, start, end), [points, start, end]);

  if (MARKET.complexes.length === 0) {
    return <Empty>실거래 스냅샷이 비어 있습니다. scripts/fetch-market.mjs 를 먼저 실행하세요.</Empty>;
  }

  return (
    <div className="space-y-5">
      <Card
        title="실거래 수익률"
        subtitle={`국토교통부 실거래가를 빌드 시점에 구워 넣은 스냅샷입니다. 가정값이 아니라 실제로 체결된 가격이고, 해제된 거래는 빼뒀습니다. ${MARKET.range.from.slice(0, 4)}년 ~ ${MARKET.range.to.slice(0, 4)}년 · 거래 ${MARKET.stats.deals.toLocaleString('ko-KR')}건 · 단지 ${MARKET.stats.complexes.toLocaleString('ko-KR')}개`}
        action={<Badge tone="info">기준일 {MARKET.asOf}</Badge>}
      >
        {/*
          등록한 물건과 이 화면이 이어져 있지 않으면, 여기서 아무 단지나 찾아보는
          취미 화면이 됩니다. 물건 이름·법정동으로 검색어를 채워 바로 잇습니다.
        */}
        {properties.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500">등록한 물건에서</span>
            {properties.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setQuery(p.name);
                  setComplexId('');
                  setAreaKey('');
                  setFromQ(null);
                  setToQ(null);
                }}
                className="rounded-lg bg-slate-800/70 px-2.5 py-1 text-[11px] text-slate-300 transition hover:bg-slate-700 hover:text-slate-100"
                title={`${p.sigungu} · ${p.name} 으로 검색어를 채웁니다`}
              >
                {p.name}
                <span className="ml-1 text-slate-500">{p.sigungu}</span>
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="단지 검색" hint="단지명 또는 법정동">
            <TextInput value={query} onChange={setQuery} placeholder="예: 토월성원, 가음동" />
          </Field>
          <Field label="단지" hint={`검색 결과 ${results.length}개`}>
            <Select
              value={complex?.id ?? ''}
              onChange={(v) => {
                setComplexId(v);
                setAreaKey('');
                setFromQ(null);
                setToQ(null);
              }}
              options={results.map((c) => ({
                value: c.id,
                label: `${c.name} · ${c.umd}${c.buildYear ? ` · ${c.buildYear}년` : ''}`,
              }))}
            />
          </Field>
          <Field label="평형" hint="전용면적 기준">
            <Select
              value={size ? String(size.area) : ''}
              onChange={(v) => {
                setAreaKey(v);
                setFromQ(null);
                setToQ(null);
              }}
              options={(complex?.sizes ?? []).map((s) => ({
                value: String(s.area),
                label: `${s.area}㎡ (${s.points.reduce((a, p) => a + p.n, 0)}건)`,
              }))}
            />
          </Field>
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-3">
            <div className="text-[11px] text-slate-500">연 복리 수익률</div>
            <div
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                result && result.cagr >= 0 ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {result ? percent(result.cagr, 2) : '—'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {result ? `${result.years.toFixed(2)}년 보유 기준` : '기간이 1년 미만입니다'}
            </div>
          </div>
        </div>

        {complex && size && points.length > 0 && (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="진입 시점">
                <Select
                  value={String(start)}
                  onChange={(v) => setFromQ(Number(v))}
                  options={points.map((p) => ({
                    value: String(p.q),
                    label: `${quarterLabel(p.q)} · ${money(p.price)} (${p.n}건)`,
                  }))}
                />
              </Field>
              <Field label="종료 시점">
                <Select
                  value={String(end)}
                  onChange={(v) => setToQ(Number(v))}
                  options={points.map((p) => ({
                    value: String(p.q),
                    label: `${quarterLabel(p.q)} · ${money(p.price)} (${p.n}건)`,
                  }))}
                />
              </Field>
            </div>

            <div className="mt-4">
              <Series points={points} fromQ={start} toQ={end} />
            </div>

            {/*
              신뢰도 경고는 카드 하단이 아니라 **그 숫자 옆에** 붙입니다 (가이드 05).
              4.18%의 신뢰도를 좌우하는 한 줄이 방법론 설명 아래에 묻혀 있었습니다.
            */}
            {result && (
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <Stat
                  label={`${quarterLabel(result.from.q)} 중위가`}
                  value={money(result.from.price)}
                  hint={
                    result.from.n < THIN_DEAL_COUNT
                      ? `거래 ${result.from.n}건 — 중위 아님`
                      : `거래 ${result.from.n}건`
                  }
                  tone={result.from.n < THIN_DEAL_COUNT ? 'warn' : undefined}
                />
                <Stat
                  label={`${quarterLabel(result.to.q)} 중위가`}
                  value={money(result.to.price)}
                  hint={
                    result.to.n < THIN_DEAL_COUNT
                      ? `거래 ${result.to.n}건 — 중위 아님`
                      : `거래 ${result.to.n}건`
                  }
                  tone={result.to.n < THIN_DEAL_COUNT ? 'warn' : undefined}
                />
                <Stat label="누적 변화" value={percent(result.totalReturn, 1)} />
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-3 print-plain">
                  <div className="text-[11px] text-slate-500">연 복리</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums text-slate-100">
                    {percent(result.cagr, 2)}
                  </div>
                  {result.thinData ? (
                    <div className="mt-1">
                      <TierBadge tier="warn" label="표본 얇음" />
                      <div className="mt-1 text-[10px] leading-relaxed text-amber-200/80">
                        개별 한 채에 가까움
                      </div>
                    </div>
                  ) : (
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      양 끝 분기 거래 {Math.min(result.from.n, result.to.n)}건 이상
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 방법론·정의는 개수만 보여주고 접습니다 — 인쇄에서는 전부 펼쳐집니다 */}
            <Foldable summary="이 숫자의 산출 조건" count={3}>
              <ul className="space-y-1">
                {[
                  '해제 신고된 거래는 제외했습니다 — 체결되지 않은 고점이 섞이면 왜곡됩니다.',
                  '층·향·수리 상태는 보정하지 않았습니다. 같은 평형도 편차가 큽니다.',
                  '과거 실현치이고 예측이 아닙니다. 진입시점을 언제로 잡느냐로 답이 갈립니다.',
                ].map((t) => (
                  <li key={t} className="text-[10px] leading-relaxed text-slate-500">
                    · {t}
                  </li>
                ))}
              </ul>
            </Foldable>
          </>
        )}
      </Card>

      {complex && size && (
        <Card
          title="진입시점을 바꿔 보면"
          subtitle="위 숫자는 진입시점 하나를 고른 결과입니다. 같은 단지도 언제 들어갔느냐로 결과가 갈리므로, 가능한 모든 진입시점의 분포를 같이 봐야 합니다."
          action={
            <div className="w-40">
              <Field label="기준 수익률" hint="이 선을 넘어야 남는 장사">
                <NumberInput
                  value={Number((reference * 100).toFixed(2))}
                  step={0.1}
                  suffix="%"
                  onChange={(v) => setReference(v / 100)}
                />
              </Field>
            </div>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-4 rounded bg-slate-600/40 ring-1 ring-slate-500/50" />
              사분위 (하위25%~상위25%)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-0.5 bg-slate-100" /> 중위
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-px border-l border-dashed border-amber-400" />{' '}
              기준선 {percent(reference, 1)}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-4 rounded bg-rose-500/10" /> 손실 구간
            </span>
          </div>
          <div className="space-y-2">
            {[3, 5, 10].map((y) => (
              <DistributionRow
                key={y}
                label={`${y}년 보유`}
                dist={holdingDistribution(points, y)}
                reference={reference}
              />
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
            “10년 보유하면 연 8%”보다 <span className="text-amber-300">하위 25%가 몇 %인지</span>가
            의사결정에 쓸모 있습니다. 진입시점을 골라서 들어갈 수 없다면 하위 구간이 실질
            기대치이고, 그게 기준선을 넘는지가 실행 여부를 가릅니다. 기준선은 대출금리
            수준으로 두면 “빌려서 사도 남는가”가 됩니다.
          </p>
        </Card>
      )}

      {/*
        방법론 세 줄은 위 카드의 접이식으로 옮겼습니다 (가이드 05 — 지우지 않고 위치만 이동).
        여기는 "이 수치로 무엇을 하면 안 되는가"만 남깁니다.
      */}
      <BacktestCard />

      <Card title="이 숫자가 아닌 것">
        <ul className="space-y-1.5">
          {[
            '물가·거래비용·보유세·양도세가 빠진 명목 가격 변화입니다. 실제로 손에 남는 돈은 3-way 비교 화면에서 보세요.',
            '한 단지의 과거 실현치입니다. 같은 동네 다른 단지에 그대로 옮겨 쓸 수 없습니다.',
          ].map((t) => (
            <li key={t} className="text-xs leading-relaxed text-slate-400">
              · {t}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-slate-600">
          출처 {MARKET.source.name} · {MARKET.source.license} · 수집 {MARKET.asOf}
        </p>
      </Card>
    </div>
  );
}
