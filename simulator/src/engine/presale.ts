/**
 * 분양권 프리미엄 — "분양권으로 사면 준공 후보다 싼가".
 *
 * 청약에 당첨되면 분양가에 들어가지만, 떨어지면 분양권을 사서 들어가야 합니다.
 * 그때 지불하는 프리미엄이 얼마인지, 그리고 그게 **준공 후 실제 매매가 대비**
 * 어땠는지가 이 모듈의 질문입니다.
 *
 * ## 같은 단지·평형끼리만 비교합니다
 *
 * 분양권 시장 평균과 매매 시장 평균을 나누면, 분양권이 활발한 신축 단지와
 * 매매가 활발한 구축이 뒤섞여 실제로 없는 비율이 나옵니다. 전세가율에서 겪은
 * 것과 같은 함정입니다. 분양권 자료에는 `aptSeq` 가 없어 **단지명·법정동·
 * 평형**으로 짝을 짓습니다.
 *
 * ## 시차가 핵심입니다
 *
 * 분양권 거래는 준공 전, 매매는 준공 후입니다. 그 사이 시장 전체가 움직이므로
 * 차이를 전부 "프리미엄"이라 부르면 안 됩니다. 몇 분기 벌어진 비교인지를
 * 결과에 같이 담아, 시차가 길수록 덜 믿도록 합니다.
 */

import presaleSnapshot from '../data/presale-2026-08.json';
import { MARKET, quarterLabel, type MarketPoint } from './market';
import { DISTRICTS } from './regions';

export interface PresaleComplex {
  id: string;
  name: string;
  umd: string;
  regionCode: string;
  region: string;
  buildYear: number;
  sizes: { area: number; points: MarketPoint[] }[];
}

interface RawPresale {
  version: string;
  asOf: string;
  quarterBaseYear: number;
  source: { name: string; endpoint: string; license: string; note: string };
  range: { from: string; to: string };
  stats: { deals: number; complexes: number; failedRequests: number };
  regions: { code: string; label: string; region: string }[];
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

const raw = presaleSnapshot as unknown as RawPresale;

export const PRESALE = {
  ...raw,
  complexes: raw.complexes.map((c) => ({
    ...c,
    sizes: c.sizes.map((s) => ({
      area: s.area,
      points: s.points.map(([q, n, median]) => ({ q, n, price: median * 10000 })),
    })),
  })) as PresaleComplex[],
};

const norm = (s: string) => s.replace(/\s+/g, '');
const districtLabel = (code: string) =>
  DISTRICTS.find((d) => d.code === code)?.label ?? code;

export interface PremiumRow {
  key: string;
  name: string;
  umd: string;
  districtLabel: string;
  region: string;
  area: number;
  /** 마지막 분양권 거래 */
  presaleQ: number;
  presalePrice: number;
  presaleDeals: number;
  /** 준공 후 최근 매매 */
  saleQ: number;
  salePrice: number;
  saleDeals: number;
  /** 분양권 대비 매매가 차이 (양수면 준공 후 더 비쌈) */
  premium: number;
  premiumRatio: number;
  /** 두 거래 사이 분기 수 — 길수록 시장 전체 변동이 섞입니다 */
  quarterGap: number;
}

/** 양 끝 거래가 이보다 적으면 개별 물건 한 채의 가격입니다. */
const MIN_DEALS = 2;

/**
 * 분양권 최종 거래가와 그 이후 매매가를 짝지어 프리미엄을 냅니다.
 *
 * 분양권 거래 **이후**의 매매만 씁니다 — 순서가 뒤집히면 "준공 후가 더 싸다"가
 * 아니라 그냥 다른 시점 두 개를 비교한 것이 됩니다.
 */
export function premiumRows(districtCodes?: string[]): PremiumRow[] {
  const codes = districtCodes?.length ? new Set(districtCodes) : null;
  const saleIndex = new Map<string, { area: number; points: MarketPoint[] }>();
  for (const c of MARKET.complexes) {
    for (const s of c.sizes) {
      saleIndex.set(`${norm(c.name)}|${c.umd}|${s.area}`, s);
    }
  }

  const rows: PremiumRow[] = [];
  for (const c of PRESALE.complexes) {
    if (codes && !codes.has(c.regionCode)) continue;
    for (const s of c.sizes) {
      const sale = saleIndex.get(`${norm(c.name)}|${c.umd}|${s.area}`);
      if (!sale) continue;

      const lastPresale = s.points[s.points.length - 1];
      if (!lastPresale || lastPresale.n < MIN_DEALS) continue;

      // 분양권 거래 이후의 매매만 — 시간 순서가 맞아야 비교가 성립합니다.
      const after = sale.points.filter((p) => p.q > lastPresale.q && p.n >= MIN_DEALS);
      const latestSale = after[after.length - 1];
      if (!latestSale) continue;

      rows.push({
        key: `${c.id}|${s.area}`,
        name: c.name,
        umd: c.umd,
        districtLabel: districtLabel(c.regionCode),
        region: c.region,
        area: s.area,
        presaleQ: lastPresale.q,
        presalePrice: lastPresale.price,
        presaleDeals: lastPresale.n,
        saleQ: latestSale.q,
        salePrice: latestSale.price,
        saleDeals: latestSale.n,
        premium: latestSale.price - lastPresale.price,
        premiumRatio: latestSale.price / lastPresale.price - 1,
        quarterGap: latestSale.q - lastPresale.q,
      });
    }
  }
  return rows.sort((a, b) => b.premiumRatio - a.premiumRatio);
}

export interface PremiumSummary {
  count: number;
  median: number;
  p25: number;
  p75: number;
  /** 준공 후가 더 쌌던 비율 — 분양권을 비싸게 산 경우 */
  lossRatio: number;
  medianQuarterGap: number;
}

const quantile = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};

export function summarizePremium(rows: PremiumRow[]): PremiumSummary | null {
  if (rows.length === 0) return null;
  const ratios = rows.map((r) => r.premiumRatio);
  return {
    count: rows.length,
    median: quantile(ratios, 0.5),
    p25: quantile(ratios, 0.25),
    p75: quantile(ratios, 0.75),
    lossRatio: ratios.filter((r) => r < 0).length / ratios.length,
    medianQuarterGap: quantile(rows.map((r) => r.quarterGap), 0.5),
  };
}

/** 화면에서 쓰는 기간 표기 */
export const premiumPeriod = (r: PremiumRow) =>
  `${quarterLabel(r.presaleQ)} → ${quarterLabel(r.saleQ)}`;
