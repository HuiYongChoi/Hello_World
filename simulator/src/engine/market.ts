/**
 * 실거래 스냅샷 — "이 단지는 실제로 연 몇 %였나".
 *
 * 지금까지 이 도구의 모든 수익률은 **가정값**이었습니다. 가격상승률 슬라이더를 3%에
 * 두면 3%가 나오는 식이죠. 여기는 반대입니다 — 국토부 실거래가를 빌드 타임에 구워
 * 넣고, 실제로 일어난 값만 씁니다.
 *
 * ## 이 숫자를 어떻게 읽어야 하나
 *
 * - **과거 수익률이지 예측이 아닙니다.** 진입시점을 언제로 잡느냐로 답이 크게 갈리기
 *   때문에, 한 구간의 CAGR만 보지 말고 여러 진입시점을 같이 보세요.
 * - **분기 중위가 기준**입니다. 층·향·수리 상태가 섞여 있어 같은 평형도 편차가 큽니다.
 *   거래건수(`n`)가 1~2건인 분기는 사실상 개별 물건 한 채의 가격입니다.
 * - **해제된 거래는 빠져 있습니다.** 실제로 체결되지 않은 신고가 섞이면 고점이 왜곡됩니다.
 * - 물가·거래비용·보유세가 반영되지 않은 **명목 가격 변화**입니다.
 */

import snapshot from '../data/market-2026-08.json';

export interface MarketPoint {
  /** 분기 (스냅샷 기준연도부터의 인덱스) */
  q: number;
  /** 그 분기 거래건수 — 적으면 중위가를 믿을 수 없습니다 */
  n: number;
  /** 중위 거래가 (원) */
  price: number;
}

export interface MarketSize {
  /** 전용면적 (㎡, 정수 반올림) */
  area: number;
  points: MarketPoint[];
}

export interface MarketComplex {
  id: string;
  name: string;
  umd: string;
  regionCode: string;
  region: string;
  buildYear: number;
  sizes: MarketSize[];
}

export interface MarketSnapshot {
  version: string;
  asOf: string;
  quarterBaseYear: number;
  source: { name: string; endpoint: string; license: string; note: string };
  range: { from: string; to: string };
  stats: { deals: number; complexes: number; failedRequests: number };
  regions: { code: string; label: string; region: string }[];
  complexes: MarketComplex[];
}

interface RawSnapshot {
  version: string;
  asOf: string;
  quarterBaseYear: number;
  source: MarketSnapshot['source'];
  range: MarketSnapshot['range'];
  stats: MarketSnapshot['stats'];
  regions: MarketSnapshot['regions'];
  complexes: {
    id: string;
    name: string;
    umd: string;
    regionCode: string;
    region: string;
    buildYear: number;
    sizes: { area: number; points: number[][] }[];
  }[];
}

const raw = snapshot as unknown as RawSnapshot;

/** 만원 정수 → 원. 스냅샷은 크기를 줄이려고 만원 단위로 저장합니다. */
const toWon = (manwon: number) => manwon * 10000;

export const MARKET: MarketSnapshot = {
  version: raw.version,
  asOf: raw.asOf,
  quarterBaseYear: raw.quarterBaseYear,
  source: raw.source,
  range: raw.range,
  stats: raw.stats,
  regions: raw.regions,
  complexes: raw.complexes.map((c) => ({
    ...c,
    sizes: c.sizes.map((s) => ({
      area: s.area,
      points: s.points.map(([q, n, median]) => ({ q, n, price: toWon(median) })),
    })),
  })),
};

/** 분기 인덱스 → 2016Q1 표기 */
export function quarterLabel(q: number): string {
  const year = MARKET.quarterBaseYear + Math.floor(q / 4);
  return `${year}Q${(q % 4) + 1}`;
}

/** 분기 인덱스 사이의 햇수 */
export function yearsBetween(fromQ: number, toQ: number): number {
  return (toQ - fromQ) / 4;
}

export interface CagrResult {
  from: MarketPoint;
  to: MarketPoint;
  years: number;
  /** 누적 변화율 */
  totalReturn: number;
  /** 복리 연환산 */
  cagr: number;
  /** 중위가를 믿기 어려운 구간인가 — 양 끝 분기 거래가 손에 꼽힐 때 */
  thinData: boolean;
}

/** 거래건수가 이보다 적은 분기는 개별 물건 한 채로 봅니다. */
export const THIN_DEAL_COUNT = 3;

/**
 * 두 분기 사이의 복리 연환산 수익률.
 *
 * 기간이 1년도 안 되면 연환산이 폭주합니다 — 3개월에 5% 오른 걸 연 21.6%로 부르는 건
 * 숫자로는 맞지만 의사결정에는 해롭습니다. 그래서 1년 미만은 아예 내지 않습니다.
 */
export function cagrBetween(
  points: MarketPoint[],
  fromQ: number,
  toQ: number
): CagrResult | null {
  const from = points.find((p) => p.q === fromQ);
  const to = points.find((p) => p.q === toQ);
  if (!from || !to || from.price <= 0 || to.price <= 0) return null;

  const years = yearsBetween(from.q, to.q);
  if (years < 1) return null;

  return {
    from,
    to,
    years,
    totalReturn: to.price / from.price - 1,
    cagr: Math.pow(to.price / from.price, 1 / years) - 1,
    thinData: from.n < THIN_DEAL_COUNT || to.n < THIN_DEAL_COUNT,
  };
}

export interface HoldingDistribution {
  holdYears: number;
  /** 이 보유기간으로 가능한 모든 진입시점의 CAGR */
  samples: number[];
  count: number;
  median: number;
  p25: number;
  p75: number;
  worst: number;
  best: number;
  /** 손실로 끝난 진입시점의 비율 */
  lossRatio: number;
  /** 표본이 이보다 적으면 분위수가 의미를 잃습니다 */
  thin: boolean;
}

/** 진입시점이 이보다 적으면 중위·사분위가 같은 값으로 뭉개집니다. */
export const MIN_ENTRY_POINTS = 5;

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * **모든 진입시점 × 고정 보유기간**의 분포.
 *
 * "10년 보유하면 연 8%"는 위험한 요약입니다. 언제 들어갔느냐로 결과가 갈리는데
 * 평균 하나가 그걸 감춥니다. 하위 25%와 최악값을 같이 봐야 "운이 나빴을 때"를
 * 감당할 수 있는지 판단할 수 있습니다.
 */
export function holdingDistribution(
  points: MarketPoint[],
  holdYears: number
): HoldingDistribution | null {
  const span = Math.round(holdYears * 4);
  if (span < 4) return null;

  const samples: number[] = [];
  for (const p of points) {
    // 종료 분기를 **정확히** 요구하면 거래 없는 분기 하나에 진입시점이 통째로 날아갑니다.
    // 실제로 3년 표본이 0개인데 5년이 1개로 나오는 뒤집힌 결과가 나왔습니다.
    // ±1분기까지 허용하고, 실제 간격으로 환산합니다.
    const end = nearestPoint(points, p.q + span, 1);
    if (!end || p.price <= 0 || end.price <= 0) continue;
    const actualYears = (end.q - p.q) / 4;
    if (actualYears < 1) continue;
    samples.push(Math.pow(end.price / p.price, 1 / actualYears) - 1);
  }
  if (samples.length === 0) return null;

  const sorted = [...samples].sort((a, b) => a - b);
  return {
    holdYears,
    samples,
    count: samples.length,
    median: quantile(sorted, 0.5),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    worst: sorted[0],
    best: sorted[sorted.length - 1],
    lossRatio: samples.filter((s) => s < 0).length / samples.length,
    thin: samples.length < MIN_ENTRY_POINTS,
  };
}

/** 목표 분기에 가장 가까운 관측점. 거래 없는 분기를 건너뛰기 위한 허용오차입니다. */
function nearestPoint(
  points: MarketPoint[],
  q: number,
  tolerance: number
): MarketPoint | null {
  let best: MarketPoint | null = null;
  for (const p of points) {
    const d = Math.abs(p.q - q);
    if (d > tolerance) continue;
    if (!best || d < Math.abs(best.q - q)) best = p;
  }
  return best;
}

/* ────────────────────────────────────────────────────────────────────────
   단지·평형 단위 보유 표본 — 지수를 거치지 않고 재는 길
   ──────────────────────────────────────────────────────────────────── */

/** 양 끝 분기 거래가 이보다 적으면 표본에서 뺍니다 — 개별 물건 한 채 가격입니다. */
export const HOLDING_MIN_DEALS = 3;

/**
 * 진입분기가 이보다 적으면 시점 축이 성립하지 않습니다 — 특정 시기 한두 개를
 * 본 것에 가깝습니다. 상승률 앵커와 롤링 백테스트가 같은 기준을 씁니다.
 */
export const MIN_ENTRY_QUARTERS = 8;

export interface HoldingSample {
  complex: MarketComplex;
  /** 전용면적 (㎡) */
  area: number;
  entryQ: number;
  exitQ: number;
  /** 실제 간격 (명목 보유기간과 ±0.25년 다를 수 있습니다) */
  years: number;
  startPrice: number;
  endPrice: number;
  /** 복리 연환산 */
  cagr: number;
  /** 양 끝 분기 거래건수 중 작은 값 */
  minDeals: number;
}

/**
 * **모든 단지·평형 × 모든 진입분기**의 보유 결과.
 *
 * 연쇄 지수(`growth.ts`)를 거치지 않고 한 칸이 실제로 겪은 값을 그대로 씁니다.
 * 지수는 분기 중위 변화율을 곱해 이어 붙이면서 위로 치우치는데(연쇄 드리프트),
 * 여기에는 그 치우침이 없습니다 — **곱해서 잇지 않고 양 끝을 직접 재기**
 * 때문입니다.
 *
 * 규칙을 한 곳에 둡니다. 롤링 백테스트(`backtest.ts`)와 상승률 앵커
 * (`growth.ts`)가 같은 표본을 봐야 두 화면의 숫자가 어긋나지 않습니다.
 *
 * 종료 분기를 **정확히** 요구하면 거래 없는 분기 하나에 진입시점이 통째로
 * 날아가므로 ±1분기까지 허용하고 실제 간격으로 환산합니다.
 */
export function holdingSamples(
  holdYears: number,
  opts: { districtCodes?: string[]; regions?: string[] } = {}
): HoldingSample[] {
  const span = Math.round(holdYears * 4);
  if (span < 4) return [];

  const codes = opts.districtCodes?.length ? new Set(opts.districtCodes) : null;
  const regions = opts.regions?.length ? new Set(opts.regions) : null;

  const out: HoldingSample[] = [];
  for (const c of MARKET.complexes) {
    if (codes && !codes.has(c.regionCode)) continue;
    if (regions && !regions.has(c.region)) continue;
    for (const s of c.sizes) {
      for (const start of s.points) {
        if (start.n < HOLDING_MIN_DEALS || start.price <= 0) continue;
        const end = nearestPoint(s.points, start.q + span, 1);
        if (!end || end.n < HOLDING_MIN_DEALS || end.price <= 0) continue;
        const years = (end.q - start.q) / 4;
        if (years < 1) continue;
        out.push({
          complex: c,
          area: s.area,
          entryQ: start.q,
          exitQ: end.q,
          years,
          startPrice: start.price,
          endPrice: end.price,
          cagr: Math.pow(end.price / start.price, 1 / years) - 1,
          minDeals: Math.min(start.n, end.n),
        });
      }
    }
  }
  return out;
}

export interface SafetyMargin {
  /** 비교 기준선 (예: 대출금리, 손익분기 상승률) */
  reference: number;
  /** 하위 25% − 기준. 운이 나빴을 때도 남는 여유입니다. */
  marginAtP25: number;
  /** 최악 − 기준 */
  marginAtWorst: number;
  /** 기준을 넘긴 진입시점의 비율 */
  beatRatio: number;
  verdict: 'safe' | 'thin' | 'short';
}

/**
 * 안전마진 — "운이 나빴을 때도 기준을 넘는가".
 *
 * 중위값이 기준을 넘는 건 당연히 좋지만, 실행 여부를 가르는 건 **하위 구간**입니다.
 * 진입시점을 고를 수 없다면 하위 25%가 실질적인 기대치이기 때문입니다.
 */
export function safetyMargin(
  dist: HoldingDistribution,
  reference: number
): SafetyMargin {
  const marginAtP25 = dist.p25 - reference;
  const marginAtWorst = dist.worst - reference;
  return {
    reference,
    marginAtP25,
    marginAtWorst,
    beatRatio: dist.samples.filter((s) => s >= reference).length / dist.samples.length,
    verdict: marginAtWorst >= 0 ? 'safe' : marginAtP25 >= 0 ? 'thin' : 'short',
  };
}

/**
 * 이름·법정동으로 단지 찾기.
 *
 * 실거래 등록명이 **동네에서 부르는 이름과 다릅니다.** 창원 상남동 "성원"은
 * 토월지구에 있어 통칭 "토월성원"인데, 국토부에는 그냥 `성원`으로 올라옵니다.
 * 그래서 질의어가 등록명을 **포함하는** 경우도 잡습니다 — "토월성원" → "성원".
 * 두 글자짜리 등록명이 아무 질의어에나 걸리지 않도록 길이 조건을 답니다.
 */
export function searchComplexes(query: string, limit = 30): MarketComplex[] {
  const q = query.trim().replace(/\s+/g, '');
  if (!q) return MARKET.complexes.slice(0, limit);

  const scored = MARKET.complexes
    .map((c) => {
      const name = c.name.replace(/\s+/g, '');
      if (name === q) return { c, rank: 0 };
      if (name.includes(q)) return { c, rank: 1 };
      if (c.umd.includes(q)) return { c, rank: 2 };
      // 통칭이 등록명보다 긴 경우 (토월성원 ⊃ 성원)
      if (q.length >= 3 && name.length >= 2 && q.includes(name)) return { c, rank: 3 };
      return null;
    })
    .filter((x): x is { c: MarketComplex; rank: number } => x !== null)
    .sort((a, b) => a.rank - b.rank);

  return scored.slice(0, limit).map((x) => x.c);
}

/** 그 단지에서 거래가 가장 많은 평형 — 기본 선택값으로 씁니다. */
export function mainSize(complex: MarketComplex): MarketSize | null {
  if (complex.sizes.length === 0) return null;
  return complex.sizes.reduce((a, b) => {
    const na = a.points.reduce((s, p) => s + p.n, 0);
    const nb = b.points.reduce((s, p) => s + p.n, 0);
    return nb > na ? b : a;
  });
}
