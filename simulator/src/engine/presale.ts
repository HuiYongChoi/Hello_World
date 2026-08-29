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
import { computeTraits, TRAIT_MIN_BUCKET, type TraitGroup } from './ranking';
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

// ── 청약 공통점 ─────────────────────────────────────────────────

export type PremiumMode = 'total' | 'annualized';

export interface PremiumInsightResult {
  mode: PremiumMode;
  topPercent: number;
  universe: number;
  topCount: number;
  entries: PremiumRow[];
  /**
   * 짝지어진 **전체** 행.
   *
   * 구간 상세를 열면 상위권에 든 것뿐 아니라 **같은 구간인데 못 든 것**도
   * 봐야 합니다 — "왜 이건 되고 저건 안 됐나" 가 거기서 나옵니다.
   * `TraitBucket.allIndices` 가 이 배열을 가리킵니다.
   */
  allEntries: PremiumRow[];
  traits: TraitGroup[];
  summary: PremiumSummary;
  caveats: string[];
}

const areaBand = (a: number) =>
  a < 40 ? '초소형 (40㎡ 미만)'
  : a < 60 ? '소형 (40~60㎡)'
  : a <= 85 ? '중형 (60~85㎡)'
  : a <= 135 ? '대형 (85~135㎡)'
  : '초대형 (135㎡ 초과)';

const priceBand = (p: number) => {
  const eok = p / 1e8;
  return eok < 2 ? '2억 미만'
    : eok < 3 ? '2~3억'
    : eok < 4 ? '3~4억'
    : eok < 6 ? '4~6억'
    : eok < 9 ? '6~9억'
    : '9억 이상';
};

const yearOf = (q: number) => `${PRESALE.quarterBaseYear + Math.floor(q / 4)}년`;

const holdBand = (gap: number) => {
  const y = gap / 4;
  return y < 3 ? '3년 미만' : y < 5 ? '3~5년' : y < 8 ? '5~8년' : '8년 이상';
};

/** 연환산 프리미엄 — 시차가 다른 건들을 같은 자로 재려면 필요합니다. */
export const annualizedPremium = (r: PremiumRow) =>
  Math.pow(1 + r.premiumRatio, 1 / Math.max(0.25, r.quarterGap / 4)) - 1;

/**
 * 프리미엄이 많이 붙은 분양권의 **공통점**.
 *
 * 총 프리미엄으로 상위를 뽑으면 "오래 들고 있었다"가 1등 공통점이 됩니다 —
 * 시차 중위가 27분기라 그 기간 시장이 오른 몫이 통째로 섞이기 때문입니다.
 * 그래서 **연환산 모드를 기본**으로 둡니다. 같은 자로 재야 평형·지역·가격대의
 * 차이가 드러납니다.
 */
export function premiumInsights(
  districtCodes: string[] | undefined,
  mode: PremiumMode,
  topPercent = 20
): PremiumInsightResult | null {
  const all = premiumRows(districtCodes);
  const summary = summarizePremium(all);
  if (!summary) return null;

  const key = (r: PremiumRow) => (mode === 'annualized' ? annualizedPremium(r) : r.premiumRatio);
  const sorted = [...all].sort((a, b) => key(b) - key(a));
  const topCount = Math.max(1, Math.round((sorted.length * topPercent) / 100));
  const top = sorted.slice(0, topCount);

  const traits = computeTraits(all, top, [
    {
      id: 'area',
      label: '전용면적대',
      hint: '어느 평형에 프리미엄이 붙었는지 — 마이너스는 초소형에 몰립니다',
      of: (r) => areaBand(r.area),
    },
    {
      id: 'presalePrice',
      label: '분양권 매입가대',
      hint: '싸게 산 분양권이 더 올랐는지',
      of: (r) => priceBand(r.presalePrice),
    },
    {
      id: 'presaleYear',
      label: '분양권 매입 시기',
      hint: '언제 산 분양권이 더 올랐는지 — 시장 국면이 그대로 드러납니다',
      of: (r) => yearOf(r.presaleQ),
    },
    {
      id: 'hold',
      label: '보유 기간',
      hint: '총 프리미엄 모드에서는 동어반복이 됩니다 — 연환산으로 보세요',
      of: (r) => holdBand(r.quarterGap),
    },
    {
      id: 'district',
      label: '시군구',
      hint: '지역이 갈리는지',
      of: (r) => r.districtLabel,
    },
    {
      id: 'umd',
      label: '법정동 (생활권)',
      hint: '같은 구 안에서도 동별로 갈리는지',
      of: (r) => r.umd || '미상',
    },
  ]);

  const caveats = [
    `분양권 마지막 거래와 그 이후 매매를 짝지었습니다. 시차 중위 ${summary.medianQuarterGap}분기 — 그 기간 시장 전체가 오른 몫이 섞여 있습니다.`,
    '양 끝 거래가 2건 미만인 건은 제외했습니다. 개별 물건 한 채의 가격이라서요.',
    mode === 'annualized'
      ? '연환산 모드 — 시차로 나눠 같은 자로 쟀습니다. 보유 기간 공통점은 이 모드에서 의미가 약합니다.'
      : '총 프리미엄 모드 — 오래 들고 있을수록 커집니다. "보유 기간" 공통점은 동어반복이니 연환산과 같이 보세요.',
    '과거에 그랬다는 것이지 앞으로도 그렇다는 뜻이 아닙니다. 속성 여섯 개를 동시에 봤으므로 그중 몇은 우연히 겹칩니다.',
  ];

  return {
    mode,
    topPercent,
    universe: all.length,
    topCount: top.length,
    entries: top,
    allEntries: all,
    traits,
    summary,
    caveats,
  };
}

/** 인사이트 리포트 — 논의 자리에 그대로 올릴 수 있게 */
export function premiumReport(result: PremiumInsightResult, scopeLabel: string): string {
  const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
  const eok = (v: number) => `${(v / 1e8).toFixed(2)}억`;
  const L: string[] = [];

  L.push(`# 청약·분양권 프리미엄 공통점 — ${scopeLabel}`);
  L.push('');
  L.push(
    `- 기준: ${result.mode === 'annualized' ? '연환산 프리미엄' : '총 프리미엄'} 상위 ${result.topPercent}%` +
      ` (짝지어진 ${result.universe}건 중 ${result.topCount}건)`
  );
  L.push(
    `- 전체 프리미엄 중위 ${pct(result.summary.median)} · 사분위 ${pct(result.summary.p25)}~${pct(result.summary.p75)}`
  );
  L.push(`- 준공 후가 더 쌌던 비율 ${pct(result.summary.lossRatio, 0)}`);
  L.push(`- 출처: ${PRESALE.source.name} · 기준일 ${PRESALE.asOf}`);
  L.push('');

  L.push('## 공통점');
  for (const g of result.traits) {
    const shown = g.buckets.filter((b) => b.topCount >= TRAIT_MIN_BUCKET).slice(0, 5);
    if (!shown.length) continue;
    L.push('');
    L.push(`### ${g.label}`);
    L.push(`> ${g.hint}`);
    L.push('');
    L.push('| 구분 | 이 구간 전체 | 그중 상위권 | 상위권에 들 확률 | 기준선 대비 |');
    L.push('|---|---|---|---|---|');
    for (const b of shown) {
      L.push(`| ${b.key} | ${b.allCount}건 | ${b.topCount}건 | ${pct(b.hitRate, 0)} | ${b.lift.toFixed(2)}배 |`);
    }
  }

  L.push('');
  L.push('## 상위 물건');
  L.push('');
  L.push('| 단지 | 법정동 | 전용 | 분양권 | 매매 | 총 프리미엄 | 연환산 | 기간 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of result.entries.slice(0, 30)) {
    L.push(
      `| ${r.name} | ${r.umd} | ${r.area}㎡ | ${eok(r.presalePrice)} | ${eok(r.salePrice)} | ` +
        `${pct(r.premiumRatio)} | ${pct(annualizedPremium(r), 2)} | ${premiumPeriod(r)} |`
    );
  }

  L.push('');
  L.push('## 읽을 때 주의');
  for (const c of result.caveats) L.push(`- ${c}`);

  return L.join('\n');
}
