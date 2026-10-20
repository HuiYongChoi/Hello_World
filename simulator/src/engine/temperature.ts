/**
 * 시장 온도 — 매매 축. **"지금 전세로 버티나, 매수 쪽으로 기우나" 의 방향만.**
 *
 * 부동산원 매매수급·심리지수는 호가·설문이라 이 저장소에서 재현할 수 없습니다.
 * 우리가 가진 실거래로 되는 축만 **나란히** 둡니다 — 합산하지 않습니다.
 *
 * ```
 * 거래량      최근 4분기 거래 수 ÷ 그 앞 4분기 − 1   (앞 창이 10건 미만이면 null)
 * 1년 변화    같은 칸(단지·평형) q 가격 ÷ q−4 가격 의 중위 − 1   (칸 5개 미만이면 null)
 * 신축 비중    최근 4분기 거래 중 준공 5년 이내 단지 거래의 비중
 * ```
 *
 * **마지막 완결 분기까지만 씁니다.** 실거래는 체결 뒤 30일 안에 신고하므로 수집
 * 시점이 분기 중간이면 그 분기는 늘 적게 잡힙니다 — 202608 수집이면 2026Q3 은
 * 두 달짜리라 거래량이 ‑30% 처럼 보입니다. 그 분기를 넣으면 "거래가 식었다" 를
 * 우리가 만들어 내는 셈입니다.
 *
 * 1년 변화는 **수준이 아니라 같은 칸의 비율**입니다. 분기마다 거래된 단지가 달라
 * 평균가끼리 나누면 구성 변화가 가격 변화로 둔갑합니다(`growth.ts` 와 같은 이유).
 *
 * 점수·종합 온도를 내보내지 않습니다. 거래량 ↓ 와 전세가율 ↑ 는 해야 할 일이
 * 반대인데 한 숫자가 되면 둘 다 지워집니다 — 테스트가 그런 필드의 부재를 고정합니다.
 */

import { MARKET, type MarketComplex } from './market';
import type { RegionId } from './types';

/** 얇은 표본 기준 — 한 곳에 모아 테스트로 고정합니다 (설계서 §1.4). */
export const TEMPERATURE_MIN = {
  /** 1년 변화율을 내려면 짝지어진 칸이 이만큼 있어야 합니다 */
  changeCells: 5,
  /** 거래량 변화율의 분모(이전 창)가 이보다 적으면 비율이 한두 건에 흔들립니다 */
  priorDeals: 10,
} as const;

/** 준공 몇 년 이내를 신축으로 보나 */
export const NEW_BUILD_YEARS = 5;

/** 거래량 스파크에 그리는 분기 수 */
export const DEAL_SERIES_QUARTERS = 12;

/**
 * 스냅샷의 마지막 **완결** 분기.
 *
 * `rangeTo` 의 월이 3·6·9·12 면 그 분기가 다 찼고, 아니면 직전 분기까지만 믿습니다.
 * ```
 * 202608 → 2026Q2 (105)   202609 → 2026Q3 (106)   202612 → 2026Q4 (107)
 * ```
 */
export function lastCompleteQ(rangeTo: string, baseYear: number): number {
  const y = Number(rangeTo.slice(0, 4));
  const m = Number(rangeTo.slice(4, 6));
  const q = (y - baseYear) * 4 + Math.floor((m - 1) / 3);
  return m % 3 === 0 ? q : q - 1;
}

/** 분기 인덱스 → `2026Q2` — 스냅샷마다 기준연도를 받습니다 */
export function qLabel(q: number, baseYear: number): string {
  return `${baseYear + Math.floor(q / 4)}Q${(q % 4) + 1}`;
}

/** 분기 인덱스 → 연도 */
export function qYear(q: number, baseYear: number): number {
  return baseYear + Math.floor(q / 4);
}

export interface QuarterWindow {
  recent: [number, number];
  prior: [number, number];
  /** `2025Q3~2026Q2 대 2024Q3~2025Q2` */
  label: string;
}

/** 최근 4분기와 그 앞 4분기 */
export function quarterWindow(asOfQ: number, baseYear: number): QuarterWindow {
  const recent: [number, number] = [asOfQ - 3, asOfQ];
  const prior: [number, number] = [asOfQ - 7, asOfQ - 4];
  const l = (w: [number, number]) => `${qLabel(w[0], baseYear)}~${qLabel(w[1], baseYear)}`;
  return { recent, prior, label: `${l(recent)} 대 ${l(prior)}` };
}

export const inWindow = (q: number, w: [number, number]) => q >= w[0] && q <= w[1];

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 분기 중위들을 거래 건수로 가중한 중위 — 한 분기 1건이 대표값이 되지 않게 */
export function weightedMedian(points: { n: number; v: number }[]): { v: number; n: number } | null {
  const s = points.filter((p) => p.n > 0 && Number.isFinite(p.v)).sort((a, b) => a.v - b.v);
  const total = s.reduce((acc, p) => acc + p.n, 0);
  if (total === 0) return null;
  let acc = 0;
  for (const p of s) {
    acc += p.n;
    if (acc * 2 >= total) return { v: p.v, n: total };
  }
  return null;
}

export interface DealsChange {
  recent: number;
  prior: number;
  /** recent/prior − 1. 이전 창이 `TEMPERATURE_MIN.priorDeals` 미만이면 null */
  change: number | null;
}

export function dealsChange(recent: number, prior: number): DealsChange {
  return { recent, prior, change: prior >= TEMPERATURE_MIN.priorDeals ? recent / prior - 1 : null };
}

/**
 * 같은 칸 안에서 q 대 q−4 비율의 중위 − 1.
 *
 * 칸마다 `[이번 값, 1년 전 값]` 을 받습니다. 둘 중 하나라도 없는 칸은 버립니다.
 * 비율의 중위라 모든 칸 가격을 두 배 해도 값이 그대로입니다.
 */
export function changeOfCells(pairs: [number, number][]): { v: number; cells: number } | null {
  const ratios = pairs.filter(([a, b]) => a > 0 && b > 0).map(([a, b]) => a / b);
  if (ratios.length < TEMPERATURE_MIN.changeCells) return null;
  return { v: median(ratios) - 1, cells: ratios.length };
}

export interface SaleTemperature {
  deals: DealsChange & { series: { q: number; n: number }[] };
  price1y: { v: number; cells: number } | null;
  newShare: { v: number; deals: number } | null;
  window: QuarterWindow;
}

export const SALE_AS_OF_Q = lastCompleteQ(MARKET.range.to, MARKET.quarterBaseYear);

/**
 * 단지 묶음의 매매 온도. 시군구·동·권역 어느 단위든 단지 목록만 바꿔 넣습니다.
 */
export function saleTemperature(
  complexes: MarketComplex[],
  opts: { asOfQ?: number; baseYear?: number } = {}
): SaleTemperature {
  const baseYear = opts.baseYear ?? MARKET.quarterBaseYear;
  const asOfQ = opts.asOfQ ?? SALE_AS_OF_Q;
  const window = quarterWindow(asOfQ, baseYear);
  const newSince = qYear(asOfQ, baseYear) - NEW_BUILD_YEARS;

  const byQ = new Map<number, number>();
  let recent = 0;
  let prior = 0;
  let recentNew = 0;
  const pairs: [number, number][] = [];

  for (const c of complexes) {
    const isNew = c.buildYear > 0 && c.buildYear >= newSince;
    for (const s of c.sizes) {
      let now: number | null = null;
      let ago: number | null = null;
      for (const p of s.points) {
        if (p.q > asOfQ) continue;
        if (p.q > asOfQ - DEAL_SERIES_QUARTERS) byQ.set(p.q, (byQ.get(p.q) ?? 0) + p.n);
        if (inWindow(p.q, window.recent)) {
          recent += p.n;
          if (isNew) recentNew += p.n;
        } else if (inWindow(p.q, window.prior)) prior += p.n;
        if (p.q === asOfQ) now = p.price;
        if (p.q === asOfQ - 4) ago = p.price;
      }
      if (now !== null && ago !== null) pairs.push([now, ago]);
    }
  }

  const series: { q: number; n: number }[] = [];
  for (let q = asOfQ - DEAL_SERIES_QUARTERS + 1; q <= asOfQ; q++) series.push({ q, n: byQ.get(q) ?? 0 });

  return {
    deals: { ...dealsChange(recent, prior), series },
    price1y: changeOfCells(pairs),
    newShare: recent > 0 ? { v: recentNew / recent, deals: recent } : null,
    window,
  };
}

/** 수집 15개 시군구 중 하나 */
export function districtTemperature(code: string): SaleTemperature {
  return saleTemperature(MARKET.complexes.filter((c) => c.regionCode === code));
}

/** 권역 전체 (창원·부산·경기) */
export function regionTemperature(region: RegionId): SaleTemperature {
  return saleTemperature(MARKET.complexes.filter((c) => c.region === region));
}

/** 이 축이 못 하는 것 — 화면 하단에 늘 붙습니다. */
export const TEMPERATURE_CAVEATS = [
  '호가 없음 · 매물 없음 · 심리 없음 — 체결된 실거래만 봅니다. 부동산원 매매수급·심리지수는 호가·설문이라 재현할 수 없습니다.',
  '신고 지연 — 실거래는 체결 뒤 30일 안에 신고해 최근 분기는 늘 적게 잡힙니다. 그래서 마지막 완결 분기까지만 씁니다.',
  '미분양·입주 물량이 없습니다. 분양권 거래로 잰 공급 대리지표(supply.ts)는 성격이 달라 여기 섞지 않았습니다.',
  '분기 중위라 층·향·수리 상태가 섞입니다. 지수가 아니어서 연쇄 드리프트는 없지만, 칸 구성이 분기마다 다른 편차가 남습니다.',
  '축마다 따로 읽습니다. 합친 점수나 종합 온도는 일부러 두지 않았습니다 — 거래량 ↓ 와 전세가율 ↑ 는 해야 할 일이 반대입니다.',
];
