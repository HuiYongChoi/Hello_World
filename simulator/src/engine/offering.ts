/**
 * 청약 공고 안전마진 — **분양가가 싼가**를 네 자로 잽니다.
 *
 * 새 공고가 뜰 때 5분 안에 거르는 것이 목적입니다. 이미 정한 물건을 다른
 * 선택지와 비교하는 4-way(`tenure.ts`)와는 묻는 것이 다릅니다.
 *
 * ## 왜 기준이 넷인가
 *
 * 하나로는 항상 틀립니다.
 *
 * ```
 * 주변 실거래      그 동네에 신축이 없으면 구축과 비교하게 돼 분양가가 늘 비싸 보입니다
 * 신축 하한 p25    "신축치고도 비싼가" 를 가릅니다. 다만 지역 전체 통계라 동네가 섞입니다
 * 입주 시점 예상가  지금이 아니라 살 때의 시세와 비교합니다. 다만 CAGR 을 곱하는 순간
 *                  예측이 되므로 분포(하위25%·최악)를 반드시 같이 냅니다
 * 주변 분양권      가장 비슷한 물건입니다. 다만 표본이 얇습니다
 * ```
 *
 * **점수로 합치지 않습니다.** 넷을 나란히 놓고 어긋나는 지점을 보여줍니다 —
 * 셋이 싸다는데 하나가 비싸다면 그 하나의 이유를 봐야 합니다.
 *
 * ## 부호 약속
 *
 * `margin` 은 **양수면 분양가가 그만큼 싸다**는 뜻입니다.
 * `(기준가 − 분양가) ÷ 기준가`. 음수면 기준보다 비쌉니다.
 */

import { growthSuggestion } from './growth';
import { MARKET } from './market';
import { PRESALE } from './presale';
import { findDistrict } from './regions';
import { RULES } from './rules';
import type { RegionId } from './types';

/** 전용면적이 이만큼 벌어지면 다른 평형으로 봅니다. */
const AREA_TOLERANCE = 10;

/** 이보다 표본이 적으면 중위가가 한두 건에 흔들립니다. */
export const OFFERING_THIN = 5;

/** 최근 이 분기 수 안의 거래만 "지금 시세" 로 봅니다. */
const RECENT_QUARTERS = 6;

export type BenchmarkId = 'nearby' | 'newBuildFloor' | 'atMoveIn' | 'presale';

export interface Benchmark {
  id: BenchmarkId;
  label: string;
  /** 비교 기준가 (원). 표본이 없으면 null */
  value: number | null;
  /** 기준가를 만든 표본 수 */
  n: number;
  /** (기준가 − 분양가) ÷ 기준가. 양수면 분양가가 쌉니다 */
  margin: number | null;
  /** 이 기준이 무엇을 말하고 무엇을 못 말하는지 */
  note: string;
  /** 표본이 얇아 숫자를 세게 읽으면 안 되는가 */
  thin: boolean;
  /** 범위가 있는 기준(입주 시점 예상가)의 하한·상한 */
  low?: number;
  high?: number;
}

export interface OfferingInput {
  region: RegionId;
  sigungu: string;
  /** 법정동 — 있으면 같은 동네끼리 비교합니다 */
  umd?: string;
  /** 분양가 (원) */
  price: number;
  /** 전용면적 (㎡) */
  areaSqm: number;
  /** 입주까지 남은 기간 (년) */
  waitYears: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};

const norm = (s: string) => s.replace(/\s+/g, '');

/** 스냅샷의 마지막 분기 */
function lastQuarter(): number {
  let q = 0;
  for (const c of MARKET.complexes)
    for (const s of c.sizes)
      for (const p of s.points) if (p.q > q) q = p.q;
  return q;
}

/**
 * 같은 동네·같은 평형의 최근 실거래 중위가.
 *
 * 법정동이 있으면 그 동네만, 없거나 표본이 모자라면 시군구로 넓힙니다.
 * 넓혔다는 사실을 `note` 에 적어야 합니다 — 조용히 넓히면 "우리 동네 시세"
 * 라고 읽힙니다.
 */
function nearbyBenchmark(input: OfferingInput): Benchmark {
  const district = findDistrict(input.sigungu);
  const cutoff = lastQuarter() - RECENT_QUARTERS;

  const collect = (sameUmd: boolean) => {
    const prices: number[] = [];
    for (const c of MARKET.complexes) {
      if (c.region !== input.region) continue;
      if (district && c.regionCode !== district.code) continue;
      if (sameUmd && input.umd && norm(c.umd) !== norm(input.umd)) continue;
      for (const s of c.sizes) {
        if (Math.abs(s.area - input.areaSqm) > AREA_TOLERANCE) continue;
        for (const p of s.points) {
          if (p.q >= cutoff && p.price > 0) prices.push(p.price);
        }
      }
    }
    return prices;
  };

  let prices = input.umd ? collect(true) : [];
  let scope = '같은 법정동';
  if (prices.length < OFFERING_THIN) {
    prices = collect(false);
    scope = district ? `${district.label} 전체` : '권역 전체';
  }

  if (prices.length === 0) {
    return {
      id: 'nearby',
      label: '주변 실거래',
      value: null,
      n: 0,
      margin: null,
      thin: true,
      note: '같은 평형의 최근 실거래를 찾지 못했습니다.',
    };
  }

  const value = median(prices);
  return {
    id: 'nearby',
    label: '주변 실거래',
    value,
    n: prices.length,
    margin: (value - input.price) / value,
    thin: prices.length < OFFERING_THIN,
    note:
      `${scope} · 전용 ${Math.round(input.areaSqm)}㎡ 안팎 · 최근 ${RECENT_QUARTERS}분기 중위가. ` +
      '그 동네에 신축이 없으면 구축과 비교하게 되어 분양가가 늘 비싸 보입니다.',
  };
}

/** 그 지역 신축 가격 하한 — "신축치고도 비싼가" 를 가릅니다. */
function newBuildBenchmark(input: OfferingInput): Benchmark {
  const cfg = RULES.appraisal;
  const district = findDistrict(input.sigungu);
  const stat = (district && cfg.newBuildMinPriceByDistrict[district.code]) || cfg.newBuildMinPrice[input.region];

  if (!stat) {
    return {
      id: 'newBuildFloor',
      label: '신축 하한',
      value: null,
      n: 0,
      margin: null,
      thin: true,
      note: '이 지역의 신축 통계가 없습니다.',
    };
  }

  return {
    id: 'newBuildFloor',
    label: '신축 하한',
    value: stat.p25,
    n: stat.n,
    margin: (stat.p25 - input.price) / stat.p25,
    thin: stat.n < 30,
    note:
      `${district ? district.label : '권역'} 신축 하위 25% ${cfg.newBuildMinPriceAsOf} 기준 ` +
      `(중위 ${Math.round(stat.median / 1e8 * 100) / 100}억 · 최저 ${Math.round(stat.lowest / 1e8 * 100) / 100}억). ` +
      '전용 70~100㎡ 전체 통계라 평형과 동네가 섞여 있습니다.',
  };
}

/**
 * 입주 시점 예상가.
 *
 * **CAGR 을 곱하는 순간 예측이 됩니다.** 그래서 단일값만 내지 않고 같은
 * 보유기간 분포의 하위 25%·최악을 같이 냅니다. 실측 상승률이 낮은 지역에서
 * 이 기준만 보고 "기다리면 오른다" 고 읽으면 안 됩니다.
 */
function moveInBenchmark(input: OfferingInput, base: Benchmark): Benchmark {
  const g = growthSuggestion(input.region, Math.max(1, Math.round(input.waitYears)));
  if (!g || base.value === null) {
    return {
      id: 'atMoveIn',
      label: '입주 시점 예상가',
      value: null,
      n: 0,
      margin: null,
      thin: true,
      note: '주변 실거래나 실측 상승률이 없어 환산할 수 없습니다.',
    };
  }

  const grow = (rate: number) => base.value! * Math.pow(1 + rate, input.waitYears);
  const value = grow(g.cagr);
  const d = g.distribution;

  return {
    id: 'atMoveIn',
    label: '입주 시점 예상가',
    value,
    low: d ? grow(d.worst) : undefined,
    high: d ? grow(d.p75) : undefined,
    n: g.cells,
    margin: (value - input.price) / value,
    thin: d?.thin ?? true,
    note:
      `주변 실거래에 실측 상승률 ${(g.cagr * 100).toFixed(2)}%/년을 ${input.waitYears}년 적용했습니다` +
      (d ? ` (진입시점 ${d.count}개 분포: 최악 ${(d.worst * 100).toFixed(1)}% ~ 상위25% ${(d.p75 * 100).toFixed(1)}%)` : '') +
      '. 과거 실측일 뿐 예측이 아닙니다 — 곱하는 순간 가정이 됩니다.',
  };
}

/** 주변 분양권 최근 거래가 — 가장 비슷한 물건이지만 표본이 얇습니다. */
function presaleBenchmark(input: OfferingInput): Benchmark {
  const district = findDistrict(input.sigungu);
  const prices: number[] = [];
  let maxQ = 0;
  for (const c of PRESALE.complexes)
    for (const s of c.sizes) for (const p of s.points) if (p.q > maxQ) maxQ = p.q;
  const cutoff = maxQ - RECENT_QUARTERS;

  for (const c of PRESALE.complexes) {
    if (c.region !== input.region) continue;
    if (district && c.regionCode !== district.code) continue;
    for (const s of c.sizes) {
      if (Math.abs(s.area - input.areaSqm) > AREA_TOLERANCE) continue;
      for (const p of s.points) if (p.q >= cutoff && p.price > 0) prices.push(p.price);
    }
  }

  if (prices.length === 0) {
    return {
      id: 'presale',
      label: '주변 분양권',
      value: null,
      n: 0,
      margin: null,
      thin: true,
      note: '같은 지역·평형의 최근 분양권 거래를 찾지 못했습니다. 전매제한 중이면 아예 안 잡힙니다.',
    };
  }

  const value = median(prices);
  return {
    id: 'presale',
    label: '주변 분양권',
    value,
    n: prices.length,
    margin: (value - input.price) / value,
    thin: prices.length < OFFERING_THIN,
    note:
      `${district ? district.label : '권역'} · 전용 ${Math.round(input.areaSqm)}㎡ 안팎 · ` +
      `최근 ${RECENT_QUARTERS}분기 분양권 거래 중위가. 가장 비슷한 물건이지만 ` +
      '전매제한 단지는 거래가 없어 안 잡힙니다.',
  };
}

export interface OfferingAppraisal {
  input: OfferingInput;
  benchmarks: Benchmark[];
  /** 값이 나온 기준들의 마진 중위 — 요약일 뿐 결론이 아닙니다 */
  medianMargin: number | null;
  /** 기준끼리 어긋나는가 — 한쪽은 싸다는데 다른 쪽은 비싸다면 */
  conflicted: boolean;
  caveats: string[];
}

export function appraiseOffering(input: OfferingInput): OfferingAppraisal | null {
  if (!(input.price > 0) || !(input.areaSqm > 0)) return null;

  const nearby = nearbyBenchmark(input);
  const benchmarks: Benchmark[] = [
    nearby,
    newBuildBenchmark(input),
    moveInBenchmark(input, nearby),
    presaleBenchmark(input),
  ];

  const margins = benchmarks.map((b) => b.margin).filter((m): m is number => m !== null);
  const positive = margins.filter((m) => m > 0.02).length;
  const negative = margins.filter((m) => m < -0.02).length;

  return {
    input,
    benchmarks,
    medianMargin: margins.length ? median(margins) : null,
    conflicted: positive > 0 && negative > 0,
    caveats: OFFERING_CAVEATS,
  };
}

export const OFFERING_CAVEATS = [
  '분양가가 싼지만 봅니다 — 당첨 가능성, 단지 품질, 시공사 신용은 들어 있지 않습니다.',
  '네 기준을 점수로 합치지 않습니다. 어긋나는 지점이 곧 봐야 할 곳입니다.',
  '실거래는 이미 지어진 집의 가격입니다. 분양가는 몇 년 뒤 지어질 집의 값이라 애초에 완전히 대등한 비교가 아닙니다.',
  '발코니 확장·유상옵션은 분양가에 안 들어 있는 경우가 많습니다 — 공고문을 확인하세요.',
];
