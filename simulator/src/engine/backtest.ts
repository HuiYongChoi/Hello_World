/**
 * 롤링 백테스트 — **진입시점 축**에서 보는 수익률.
 *
 * `ranking.ts` 는 구간 하나(최근 N년)를 고정해 놓고 단지끼리 줄을 세웁니다.
 * 여기는 반대입니다. 모든 단지·평형을 **모든 진입분기**에서 같은 기간 들고
 * 있었다고 보고, 그 표본 전체를 봅니다.
 *
 * ## 왜 진입시점 축인가
 *
 * 지역이 3개(시군구로 쪼개도 10~15개)라 지역 축은 **통계적 특징 추출 표본이
 * 아닙니다.** 게다가 지역 수익률은 전국 금리·유동성에 함께 끌려다녀 서로
 * 독립이 아닙니다. 진입시점 축은 표본이 수만 개가 되고, 실제로 물건을 고를 때
 * 답을 알고 싶은 질문("지금 들어가면 어떤가")과도 맞습니다.
 *
 * ## 초과수익으로 변환하고 나서 봅니다
 *
 * 절대 수익률로 상위를 뽑으면 **"많이 오른 시기에 들어갔다"** 가 1등 공통점으로
 * 나옵니다. 발견이 아니라 동어반복입니다. 그래서 같은 구간의 지수 수익률을 빼서
 * 초과분으로 바꾼 뒤에 봅니다.
 *
 * ```
 * cohort    같은 진입분기 표본의 중위 — 시기 효과를 걷어 냅니다 (기본)
 * district  같은 진입분기 × 같은 시군구 중위 — 동네 효과까지 걷어 냅니다
 * market    수집 3권역 합산 연쇄지수 — 표본 밖의 기준선
 * none      변환하지 않음. 시기 효과가 그대로 남습니다
 * ```
 *
 * **기본이 지수가 아니라 같은 진입분기 표본 중위인 이유가 있습니다.** 연쇄
 * 지수는 분기 중위 변화율을 계속 곱해 이어 붙이는데, 이 과정에서 위쪽으로
 * 치우칩니다(연쇄 드리프트). 실제로 5년 보유 기준 시장지수 중위는 8.06% 인데
 * 같은 기간 단지·평형 표본의 중위는 4.13% 입니다 — 모든 진입분기에서 지수가
 * 2~4%p 위에 있습니다. 이 차이를 초과수익이라 부르면 표본의 81% 가
 * "시장에 못 미쳤다" 가 되는데, 그건 물건의 성적이 아니라 지수의 성질입니다.
 *
 * 같은 진입분기 표본의 중위를 기준선으로 쓰면 그 치우침이 애초에 없습니다.
 * 정의상 중위 초과수익이 0이라 **부호를 그대로 읽을 수 있습니다.**
 *
 * `market` 은 전국 지수도 아닙니다. 창원·부산·경기 수집분을 합친 것뿐입니다.
 *
 * ## 표본이 서로 독립이 아닙니다
 *
 * 한 단지의 2016Q1 진입과 2016Q2 진입은 보유기간 대부분이 겹칩니다. 표본 수가
 * 수만 개라도 **독립 관측은 그보다 훨씬 적습니다.** 그래서 여기서 나오는
 * 어떤 수치도 유의성 검정으로 쓰지 않고, 분포와 재현 여부만 봅니다.
 */

import { marketGrowthIndex } from './growth';
import { MARKET, quarterLabel, type MarketComplex, type MarketPoint } from './market';
import {
  TRAIT_LIFT_STRONG,
  TRAIT_MIN_BUCKET,
  computeTraits,
  type TraitBucket,
} from './ranking';
import { DISTRICTS } from './regions';
import type { RegionId } from './types';

/** 초과수익을 무엇에 견주나 */
export type BenchmarkMode = 'none' | 'cohort' | 'district' | 'market';

/** 양 끝 분기 거래가 이보다 적으면 표본에서 뺍니다 — 개별 물건 한 채 가격입니다. */
const MIN_DEALS = 3;

/** 진입분기가 이보다 적으면 시점 축이 성립하지 않습니다. */
export const MIN_ENTRY_QUARTERS = 8;

/** 이보다 적은 표본으로는 분위수도 재현 여부도 말할 수 없습니다. */
export const MIN_SAMPLES = 30;

export interface RollingSample {
  /** 단지·평형 (같은 칸의 여러 진입시점이 같은 값을 가집니다) */
  cellId: string;
  name: string;
  umd: string;
  districtCode: string;
  districtLabel: string;
  region: RegionId;
  buildYear: number;
  area: number;
  entryQ: number;
  exitQ: number;
  years: number;
  startPrice: number;
  endPrice: number;
  /** 복리 연환산 */
  cagr: number;
  /** 같은 구간 지수의 연환산. `none` 이면 0 */
  benchmarkCagr: number;
  /** cagr − benchmarkCagr (%p) */
  excess: number;
  minDeals: number;
}

export interface EntryQuarterStat {
  q: number;
  label: string;
  n: number;
  medianCagr: number;
  medianExcess: number;
  /**
   * 그 분기에 들어간 표본의 초과수익 사분위.
   *
   * 코호트 기준선을 쓰면 중위는 정의상 0이라 볼 것이 없습니다. 그때 남는
   * 질문이 이것입니다 — **같은 시기에 들어가도 물건에 따라 얼마나 갈렸나.**
   * 이 폭이 곧 "물건을 고르는 일" 로 벌 수 있었던 범위입니다.
   */
  p25Excess: number;
  p75Excess: number;
  /** p75 − p25 (%p) */
  spreadExcess: number;
  /** 손실로 끝난 비율 */
  lossRatio: number;
}

export interface RollingBacktest {
  holdYears: number;
  benchmark: BenchmarkMode;
  samples: RollingSample[];
  /** 표본에 기여한 단지·평형 칸 수 — 표본 수보다 이쪽이 독립성에 가깝습니다 */
  cells: number;
  entryQuarters: EntryQuarterStat[];
  medianCagr: number;
  medianExcess: number;
  /** 초과수익이 양수인 표본 비율 */
  beatShare: number;
  caveats: string[];
}

const districtLabel = (code: string) =>
  DISTRICTS.find((d) => d.code === code)?.label ?? code;

function nearest(points: MarketPoint[], q: number, tolerance = 1): MarketPoint | null {
  let best: MarketPoint | null = null;
  for (const p of points) {
    const d = Math.abs(p.q - q);
    if (d > tolerance) continue;
    if (!best || d < Math.abs(best.q - q)) best = p;
  }
  return best;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

/** 정렬된 배열의 분위수. 선형보간이라 표본이 적어도 두 값 사이에서 움직입니다. */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

const annualize = (from: number, to: number, years: number) =>
  Math.pow(to / from, 1 / years) - 1;

/**
 * 지수 위에서 같은 구간의 연환산을 냅니다.
 *
 * **표본과 같은 분기로 재야 합니다.** 진입·종료 분기가 ±1분기 밀린 표본에
 * 명목 보유기간의 지수 수익률을 빼면, 그 어긋남이 통째로 초과수익으로
 * 둔갑합니다.
 */
function benchmarkOf(
  points: MarketPoint[] | null,
  entryQ: number,
  exitQ: number,
  years: number
): number | null {
  if (!points) return null;
  const from = nearest(points, entryQ);
  const to = nearest(points, exitQ);
  if (!from || !to || from.price <= 0 || to.price <= 0 || to.q <= from.q) return null;
  return annualize(from.price, to.price, years);
}

export interface RollingInput {
  holdYears: number;
  benchmark: BenchmarkMode;
  /** 대상 법정동코드. 비우면 스냅샷 전체 */
  districtCodes?: string[];
}

/**
 * 모든 단지·평형 × 모든 진입분기.
 *
 * 종료 분기를 정확히 요구하면 거래 없는 분기 하나에 진입시점이 통째로
 * 날아가므로 ±1분기까지 허용하고 **실제 간격으로 환산**합니다
 * (`holdingDistribution` 과 같은 규칙입니다).
 */
export function rollingBacktest(input: RollingInput): RollingBacktest | null {
  const { holdYears, benchmark } = input;
  const span = Math.round(holdYears * 4);
  if (span < 4) return null;

  const codes = input.districtCodes?.length ? new Set(input.districtCodes) : null;
  const pool: MarketComplex[] = codes
    ? MARKET.complexes.filter((c) => codes.has(c.regionCode))
    : MARKET.complexes;

  // 지수는 한 번만 만듭니다 — 표본마다 다시 접으면 안 됩니다.
  const marketIdx = benchmark === 'market' ? marketGrowthIndex()?.points ?? null : null;

  const samples: RollingSample[] = [];
  const cells = new Set<string>();

  for (const c of pool) {
    const region = c.region as RegionId;
    for (const s of c.sizes) {
      const cellId = `${c.id}|${s.area}`;
      for (const start of s.points) {
        if (start.n < MIN_DEALS || start.price <= 0) continue;
        const end = nearest(s.points, start.q + span);
        if (!end || end.n < MIN_DEALS || end.price <= 0) continue;
        const years = (end.q - start.q) / 4;
        if (years < 1) continue;

        const cagr = annualize(start.price, end.price, years);
        // 지수 기준선은 여기서 바로 재고, 코호트 기준선은 표본이 다 모인 뒤
        // 2차로 뺍니다 — 같은 진입분기 표본의 중위가 필요하기 때문입니다.
        const bench =
          benchmark === 'market' ? benchmarkOf(marketIdx, start.q, end.q, years) : 0;
        // 지수를 못 재는 구간은 초과수익을 0으로 채우지 않고 표본에서 뺍니다.
        // 0으로 채우면 "지수와 똑같이 움직였다" 는 없는 관측이 생깁니다.
        if (bench === null) continue;

        cells.add(cellId);
        samples.push({
          cellId,
          name: c.name,
          umd: c.umd,
          districtCode: c.regionCode,
          districtLabel: districtLabel(c.regionCode),
          region,
          buildYear: c.buildYear,
          area: s.area,
          entryQ: start.q,
          exitQ: end.q,
          years,
          startPrice: start.price,
          endPrice: end.price,
          cagr,
          benchmarkCagr: bench,
          excess: cagr - bench,
          minDeals: Math.min(start.n, end.n),
        });
      }
    }
  }

  if (samples.length === 0) return null;

  /*
   * 코호트 기준선 — 같은 진입분기(그리고 `district` 면 같은 시군구) 표본의 중위.
   *
   * 표본 자신으로 기준선을 만들기 때문에 연쇄 지수의 드리프트가 없습니다.
   * 정의상 각 코호트의 중위 초과수익이 0이라, 남는 값은 **같은 시기에 들어간
   * 다른 물건보다 얼마나 나았나** 만 담습니다.
   */
  if (benchmark === 'cohort' || benchmark === 'district') {
    const cohortKey = (s: RollingSample) =>
      benchmark === 'district' ? `${s.entryQ}|${s.districtCode}` : String(s.entryQ);
    const groups = new Map<string, number[]>();
    for (const s of samples) {
      const k = cohortKey(s);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(s.cagr);
    }
    const medians = new Map([...groups].map(([k, xs]) => [k, median(xs)]));
    for (const s of samples) {
      s.benchmarkCagr = medians.get(cohortKey(s)) ?? 0;
      s.excess = s.cagr - s.benchmarkCagr;
    }
  }

  const byEntry = new Map<number, RollingSample[]>();
  for (const s of samples) {
    if (!byEntry.has(s.entryQ)) byEntry.set(s.entryQ, []);
    byEntry.get(s.entryQ)!.push(s);
  }

  const entryQuarters: EntryQuarterStat[] = [...byEntry.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([q, xs]) => {
      const ex = xs.map((x) => x.excess).sort((a, b) => a - b);
      const p25 = quantile(ex, 0.25);
      const p75 = quantile(ex, 0.75);
      return {
        q,
        label: quarterLabel(q),
        n: xs.length,
        medianCagr: median(xs.map((x) => x.cagr)),
        medianExcess: median(xs.map((x) => x.excess)),
        p25Excess: p25,
        p75Excess: p75,
        spreadExcess: p75 - p25,
        lossRatio: xs.filter((x) => x.cagr < 0).length / xs.length,
      };
    });

  return {
    holdYears,
    benchmark,
    samples,
    cells: cells.size,
    entryQuarters,
    medianCagr: median(samples.map((s) => s.cagr)),
    medianExcess: median(samples.map((s) => s.excess)),
    beatShare: samples.filter((s) => s.excess > 0).length / samples.length,
    caveats: [
      `보유 ${holdYears}년 · 진입분기 ${entryQuarters.length}개 · 표본 ${samples.length.toLocaleString('ko-KR')}건 (단지·평형 ${cells.size}칸).`,
      '같은 칸의 이웃 진입시점은 보유기간이 거의 겹칩니다 — 표본 수만큼 독립이지 않습니다.',
      benchmark === 'none'
        ? '초과수익 변환을 끄면 시기 효과가 그대로 남습니다. "많이 오른 시기에 들어갔다" 가 공통점으로 나오면 그건 발견이 아닙니다.'
        : benchmark === 'cohort'
          ? '기준선은 같은 진입분기 표본의 중위입니다. 정의상 중위 초과수익이 0이라 부호를 그대로 읽을 수 있고, 시기 효과는 빠져 있습니다.'
          : benchmark === 'district'
            ? '기준선은 같은 진입분기 · 같은 시군구 중위입니다. 시기와 동네 효과가 둘 다 빠져 있어, 시군구 공통점은 여기서 볼 수 없습니다.'
            : '기준선은 수집 3권역 합산 연쇄지수입니다. 지수는 분기 중위 변화율을 이어 붙이면서 위로 치우쳐(연쇄 드리프트) 표본 중위보다 2~4%p 높습니다 — 중위 초과수익이 음수인 것은 물건의 성적이 아니라 지수의 성질입니다.',
      '스냅샷이 2016년부터라 한 번의 큰 상승과 한 번의 조정만 들어 있습니다. 다른 국면은 표본에 없습니다.',
    ],
  };
}

/* ────────────────────────────────────────────────────────────────────────
   시점 분할 검증
   ──────────────────────────────────────────────────────────────────── */

export interface SplitBucket {
  key: string;
  /** 학습 구간에서 이 구간을 고르면 상위권에 들 확률 */
  trainHitRate: number;
  trainLift: number;
  trainTop: number;
  trainAll: number;
  /** 검증 구간에서 다시 잰 값 */
  testHitRate: number;
  testLift: number;
  testTop: number;
  testAll: number;
  /** 학습에서 강했는가 (lift ≥ 1.3 · 표본 충분) */
  strongInTrain: boolean;
  /** 검증 구간에서도 기준선 위였는가 */
  holds: boolean;
  /** 검증 표본이 얇아 판정을 못 하는가 */
  unmeasurable: boolean;
}

export interface SplitGroup {
  id: string;
  label: string;
  hint: string;
  buckets: SplitBucket[];
}

export type SplitVerdict = 'holds' | 'mixed' | 'fails' | 'thin';

export interface SplitValidation {
  /** 학습·검증을 가르는 진입분기 (이 분기부터 검증) */
  splitQ: number;
  splitLabel: string;
  trainRange: [number, number];
  testRange: [number, number];
  trainCount: number;
  testCount: number;
  topPercent: number;
  groups: SplitGroup[];
  /** 학습에서 강했던 구간 수 */
  strongCount: number;
  /** 그중 검증에서도 기준선 위였던 수 */
  heldCount: number;
  /** heldCount ÷ strongCount */
  reproducedShare: number;
  verdict: SplitVerdict;
  caveats: string[];
}

/** 연식은 진입 시점 기준입니다 — 같은 단지도 학습 때 20년, 검증 때 25년입니다. */
function ageBand(buildYear: number, entryQ: number): string {
  if (!buildYear) return '미상';
  const entryYear = MARKET.quarterBaseYear + Math.floor(entryQ / 4);
  const age = entryYear - buildYear;
  if (age < 0) return '미상';
  if (age < 5) return '5년 미만 (신축)';
  if (age < 10) return '5~10년';
  if (age < 20) return '10~20년';
  if (age < 30) return '20~30년';
  return '30년 이상 (재건축 기대)';
}

function areaBand(area: number): string {
  if (area < 60) return '소형 (60㎡ 미만)';
  if (area <= 85) return '중형 (60~85㎡)';
  if (area <= 135) return '대형 (85~135㎡)';
  return '초대형 (135㎡ 초과)';
}

function priceBand(price: number): string {
  const eok = price / 1e8;
  if (eok < 2) return '2억 미만';
  if (eok < 3) return '2~3억';
  if (eok < 4) return '3~4억';
  if (eok < 5) return '4~5억';
  if (eok < 7) return '5~7억';
  return '7억 이상';
}

const SPLIT_GROUPS: {
  id: string;
  label: string;
  hint: string;
  of: (s: RollingSample) => string;
}[] = [
  {
    id: 'age',
    label: '진입 시점 연식',
    hint: '재건축 기대 구간과 신축 구간이 갈리는지. 연식은 진입 연도 기준입니다',
    of: (s) => ageBand(s.buildYear, s.entryQ),
  },
  {
    id: 'area',
    label: '전용면적대',
    hint: '수요가 몰린 평형이 시기를 넘어 유지되는지',
    of: (s) => areaBand(s.area),
  },
  {
    id: 'entryPrice',
    label: '진입 가격대',
    hint: '싼 것이 더 올랐는지. 물가·시장 수준이 달라 시기를 넘으면 잘 안 남습니다',
    of: (s) => priceBand(s.startPrice),
  },
  {
    id: 'district',
    label: '시군구',
    hint: '초과수익 모드에서만 의미가 있습니다 — 절대 모드면 동어반복입니다',
    of: (s) => s.districtLabel,
  },
  {
    id: 'umd',
    label: '법정동 (생활권)',
    hint: '같은 구 안에서도 동별로 갈리는지',
    of: (s) => s.umd || '미상',
  },
];

/** 표본 수가 반씩 갈리는 진입분기를 찾습니다 — 분기 수가 아니라 표본 수 기준입니다. */
function splitQuarter(bt: RollingBacktest): number | null {
  const total = bt.samples.length;
  let acc = 0;
  for (const e of bt.entryQuarters) {
    acc += e.n;
    if (acc >= total / 2) {
      const next = bt.entryQuarters.find((x) => x.q > e.q);
      return next?.q ?? null;
    }
  }
  return null;
}

function bucketMap(buckets: TraitBucket[]): Map<string, TraitBucket> {
  return new Map(buckets.map((b) => [b.key, b]));
}

/**
 * **시점 분할 검증** — 학습 구간에서 찾은 공통점이 검증 구간에서도 남는가.
 *
 * 지역이 3개뿐이라 지역을 나눠 검증할 수는 없습니다. 대신 진입시점을
 * 앞뒤로 갈라, 앞 구간에서 상위권에 몰렸던 속성이 뒤 구간에서도 상위권에
 * 몰리는지 봅니다.
 *
 * ## 상위권은 구간 **안에서** 뽑습니다
 *
 * 학습 구간이 상승장이면 절대 기준으로는 그 구간 전체가 상위입니다. 그러면
 * 검증이 "시기 맞히기" 가 되어 버립니다. 각 구간 안에서 상위 N% 를 따로
 * 뽑아야 "같은 시기 안에서 남들보다 나았나" 를 묻는 것이 됩니다.
 *
 * ## 재현 판정
 *
 * ```
 * strongInTrain  학습에서 lift ≥ 1.3 이고 표본이 충분
 * holds          그 구간이 검증에서도 lift ≥ 1 (기준선 위)
 * unmeasurable   검증 구간에 그 속성 표본이 거의 없어 판정 불가
 * ```
 *
 * `reproducedShare` 가 이 화면의 결론입니다. 절반을 밑돌면 **학습 구간에서
 * 본 공통점은 그 시기의 성질**이었다는 뜻입니다.
 */
export function splitValidate(
  bt: RollingBacktest,
  topPercent = 20
): SplitValidation | null {
  if (bt.entryQuarters.length < MIN_ENTRY_QUARTERS) return null;
  const splitQ = splitQuarter(bt);
  if (splitQ === null) return null;

  const train = bt.samples.filter((s) => s.entryQ < splitQ);
  const test = bt.samples.filter((s) => s.entryQ >= splitQ);
  if (train.length < MIN_SAMPLES || test.length < MIN_SAMPLES) return null;

  // 상위권은 각 구간 안에서 따로 뽑습니다. 초과수익 변환을 껐으면 절대
  // 수익률로 뽑되, 그 경우 검증이 시기 맞히기가 된다는 경고를 답니다.
  const key = (s: RollingSample) => (bt.benchmark === 'none' ? s.cagr : s.excess);
  const topOf = (xs: RollingSample[]) => {
    const sorted = [...xs].sort((a, b) => key(b) - key(a));
    return sorted.slice(0, Math.max(1, Math.round((sorted.length * topPercent) / 100)));
  };

  const trainTraits = computeTraits(train, topOf(train), SPLIT_GROUPS);
  const testTraits = computeTraits(test, topOf(test), SPLIT_GROUPS);

  let strongCount = 0;
  let heldCount = 0;

  const groups: SplitGroup[] = SPLIT_GROUPS.map((g, gi) => {
    const trainBuckets = trainTraits[gi].buckets;
    const testBuckets = bucketMap(testTraits[gi].buckets);
    // 검증 구간의 전체 분포는 상위권에 한 번도 안 뽑힌 구간도 알아야 하므로
    // 따로 셉니다 — computeTraits 는 상위권에 있는 키만 버킷으로 냅니다.
    const testAllCount = new Map<string, number>();
    for (const s of test) {
      const k = g.of(s);
      testAllCount.set(k, (testAllCount.get(k) ?? 0) + 1);
    }
    const testTopTotal = Math.max(1, Math.round((test.length * topPercent) / 100));

    const buckets: SplitBucket[] = trainBuckets.map((tb) => {
      const vb = testBuckets.get(tb.key);
      const testAll = testAllCount.get(tb.key) ?? 0;
      const testTop = vb?.topCount ?? 0;
      const testHitRate = testAll > 0 ? testTop / testAll : 0;
      const baseline = testTopTotal / test.length;
      const testLift = testAll > 0 ? testHitRate / baseline : 0;

      const strongInTrain =
        tb.lift >= TRAIT_LIFT_STRONG && tb.topCount >= TRAIT_MIN_BUCKET;
      const unmeasurable = testAll < TRAIT_MIN_BUCKET;
      const holds = strongInTrain && !unmeasurable && testLift >= 1;

      if (strongInTrain && !unmeasurable) {
        strongCount++;
        if (holds) heldCount++;
      }

      return {
        key: tb.key,
        trainHitRate: tb.hitRate,
        trainLift: tb.lift,
        trainTop: tb.topCount,
        trainAll: tb.allCount,
        testHitRate,
        testLift,
        testTop,
        testAll,
        strongInTrain,
        holds,
        unmeasurable,
      };
    });

    return { id: g.id, label: g.label, hint: g.hint, buckets };
  });

  const reproducedShare = strongCount > 0 ? heldCount / strongCount : 0;
  const verdict: SplitVerdict =
    strongCount < 3
      ? 'thin'
      : reproducedShare >= 0.7
        ? 'holds'
        : reproducedShare >= 0.4
          ? 'mixed'
          : 'fails';

  const trainQs = train.map((s) => s.entryQ);
  const testQs = test.map((s) => s.entryQ);

  return {
    splitQ,
    splitLabel: quarterLabel(splitQ),
    trainRange: [Math.min(...trainQs), Math.max(...trainQs)],
    testRange: [Math.min(...testQs), Math.max(...testQs)],
    trainCount: train.length,
    testCount: test.length,
    topPercent,
    groups,
    strongCount,
    heldCount,
    reproducedShare,
    verdict,
    caveats: [
      `학습 ${quarterLabel(Math.min(...trainQs))}~${quarterLabel(Math.max(...trainQs))} 진입 ${train.length.toLocaleString('ko-KR')}건 / 검증 ${quarterLabel(Math.min(...testQs))}~${quarterLabel(Math.max(...testQs))} 진입 ${test.length.toLocaleString('ko-KR')}건.`,
      '상위권은 각 구간 안에서 따로 뽑습니다 — 안 그러면 검증이 시기 맞히기가 됩니다.',
      '검증 구간은 최근입니다. 보유기간이 필요하므로 가장 최근 진입은 애초에 표본에 없습니다.',
      bt.benchmark === 'none'
        ? '초과수익 변환이 꺼져 있습니다. 시기 효과가 남아 있어 재현 여부를 시장 국면으로 읽어야 합니다.'
        : '한 번의 분할일 뿐입니다. 경계를 다른 분기로 옮기면 결과가 달라질 수 있습니다.',
    ],
  };
}
