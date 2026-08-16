/**
 * 수익률 상위 물건지의 **공통점** 추출.
 *
 * "어디가 많이 올랐나"는 실거래를 정렬하면 나옵니다. 쓸모 있는 질문은 그 다음입니다 —
 * **오른 것들끼리 무엇이 같았나.** 연식대인가, 평형인가, 생활권인가, 진입 가격대인가.
 *
 * ## 절대 수익률로 공통점을 찾으면 안 되는 이유
 *
 * 지역 수익률은 전국 금리·유동성에 함께 끌려다녀 서로 독립이 아닙니다. 절대
 * 수익률로 상위를 뽑으면 "많이 오른 시군구에 있었다"가 1등 공통점으로 나오는데,
 * 이건 발견이 아니라 동어반복입니다.
 *
 * 그래서 **지역 초과수익**(그 시군구 중위 대비) 모드를 기본으로 둡니다. 같은 동네
 * 안에서 남들보다 더 오른 단지의 공통점이라야 다음 물건을 고를 때 쓸 수 있습니다.
 *
 * ## 이건 예측이 아닙니다
 *
 * 속성이 여러 개면 그중 몇 개는 우연히 상위와 겹칩니다(다중비교). 표본이 작은
 * 구간일수록 심합니다. `lift` 가 커도 `topCount` 가 한 자리면 이야기로 만들지 마세요.
 * 그리고 여기서 나온 공통점은 **과거에 그랬다**일 뿐, 앞으로도 그렇다는 뜻이 아닙니다.
 */

import { MARKET, quarterLabel, type MarketComplex, type MarketPoint } from './market';
import { DISTRICTS } from './regions';

export type RankingMode = 'absolute' | 'excess';

export interface PerformerEntry {
  id: string;
  name: string;
  umd: string;
  districtCode: string;
  districtLabel: string;
  region: string;
  buildYear: number;
  area: number;
  fromQ: number;
  toQ: number;
  years: number;
  startPrice: number;
  endPrice: number;
  /** 복리 연환산 */
  cagr: number;
  /** 같은 시군구 중위 대비 초과분 (%p) */
  excess: number;
  /** 양 끝 분기 거래건수 중 작은 값 — 작으면 중위가를 믿기 어렵습니다 */
  minDeals: number;
}

export interface TraitBucket {
  key: string;
  topCount: number;
  topShare: number;
  allShare: number;
  /** topShare ÷ allShare. 1보다 크면 상위권에 더 몰려 있습니다. */
  lift: number;
}

export interface TraitGroup {
  id: string;
  label: string;
  hint: string;
  buckets: TraitBucket[];
}

export interface RankingResult {
  mode: RankingMode;
  years: number;
  topPercent: number;
  universe: number;
  topCount: number;
  entries: PerformerEntry[];
  traits: TraitGroup[];
  districtMedians: { code: string; label: string; median: number; n: number }[];
  caveats: string[];
}

/** 양 끝 분기 거래가 이보다 적으면 표본에서 뺍니다 — 개별 물건 한 채 가격입니다. */
const MIN_DEALS = 3;

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

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** 스냅샷 전체에서 가장 최근 분기 */
function latestQuarter(): number {
  let last = -Infinity;
  for (const c of MARKET.complexes) {
    for (const s of c.sizes) {
      for (const p of s.points) if (p.q > last) last = p.q;
    }
  }
  return last;
}

function buildEra(year: number): string {
  if (!year) return '미상';
  if (year >= 2020) return '2020년대';
  if (year >= 2010) return '2010년대';
  if (year >= 2000) return '2000년대';
  if (year >= 1990) return '1990년대';
  return '1980년대 이전';
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

function traitsOf(all: PerformerEntry[], top: PerformerEntry[]): TraitGroup[] {
  const groups: { id: string; label: string; hint: string; of: (e: PerformerEntry) => string }[] = [
    {
      id: 'buildEra',
      label: '준공 연대',
      hint: '재건축 기대가 붙는 구간과 신축 구간이 갈리는지 봅니다',
      of: (e) => buildEra(e.buildYear),
    },
    {
      id: 'area',
      label: '전용면적대',
      hint: '수요가 몰린 평형이 있는지',
      of: (e) => areaBand(e.area),
    },
    {
      id: 'entryPrice',
      label: '진입 가격대',
      hint: '시작 시점 중위가 기준. 싼 것이 더 올랐는지',
      of: (e) => priceBand(e.startPrice),
    },
    {
      id: 'district',
      label: '시군구',
      hint: '절대 수익률 모드에서는 동어반복이 됩니다 — 초과수익 모드로 보세요',
      of: (e) => e.districtLabel,
    },
    {
      id: 'umd',
      label: '법정동 (생활권)',
      hint: '같은 구 안에서도 동별로 갈리는지',
      of: (e) => e.umd || '미상',
    },
  ];

  return groups.map((g) => {
    const allCount = new Map<string, number>();
    const topCount = new Map<string, number>();
    for (const e of all) allCount.set(g.of(e), (allCount.get(g.of(e)) ?? 0) + 1);
    for (const e of top) topCount.set(g.of(e), (topCount.get(g.of(e)) ?? 0) + 1);

    const buckets: TraitBucket[] = [...topCount.entries()]
      .map(([key, n]) => {
        const topShare = n / Math.max(1, top.length);
        const allShare = (allCount.get(key) ?? 0) / Math.max(1, all.length);
        return { key, topCount: n, topShare, allShare, lift: allShare > 0 ? topShare / allShare : 0 };
      })
      .sort((a, b) => b.lift - a.lift || b.topCount - a.topCount);

    return { id: g.id, label: g.label, hint: g.hint, buckets };
  });
}

export interface RankingInput {
  /** 대상 법정동코드. 비우면 스냅샷 전체 */
  districtCodes?: string[];
  years: number;
  topPercent: number;
  mode: RankingMode;
}

export function rankPerformers(input: RankingInput): RankingResult {
  const { years, topPercent, mode } = input;
  const codes = input.districtCodes?.length ? new Set(input.districtCodes) : null;
  const toQ = latestQuarter();
  const fromQ = toQ - Math.round(years * 4);

  const raw: PerformerEntry[] = [];
  const pool: MarketComplex[] = codes
    ? MARKET.complexes.filter((c) => codes.has(c.regionCode))
    : MARKET.complexes;

  for (const c of pool) {
    for (const s of c.sizes) {
      const start = nearest(s.points, fromQ);
      const end = nearest(s.points, toQ);
      if (!start || !end || end.q - start.q < 4) continue;
      if (start.price <= 0 || end.price <= 0) continue;
      if (start.n < MIN_DEALS || end.n < MIN_DEALS) continue;

      const span = (end.q - start.q) / 4;
      raw.push({
        id: `${c.id}|${s.area}`,
        name: c.name,
        umd: c.umd,
        districtCode: c.regionCode,
        districtLabel: districtLabel(c.regionCode),
        region: c.region,
        buildYear: c.buildYear,
        area: s.area,
        fromQ: start.q,
        toQ: end.q,
        years: span,
        startPrice: start.price,
        endPrice: end.price,
        cagr: Math.pow(end.price / start.price, 1 / span) - 1,
        excess: 0,
        minDeals: Math.min(start.n, end.n),
      });
    }
  }

  // 시군구 중위 수익률 — 초과수익의 기준선
  const byDistrict = new Map<string, number[]>();
  for (const e of raw) {
    if (!byDistrict.has(e.districtCode)) byDistrict.set(e.districtCode, []);
    byDistrict.get(e.districtCode)!.push(e.cagr);
  }
  const medians = new Map([...byDistrict].map(([code, xs]) => [code, median(xs)]));
  for (const e of raw) e.excess = e.cagr - (medians.get(e.districtCode) ?? 0);

  const key = (e: PerformerEntry) => (mode === 'excess' ? e.excess : e.cagr);
  const sorted = [...raw].sort((a, b) => key(b) - key(a));
  const topCount = Math.max(1, Math.round((sorted.length * topPercent) / 100));
  const top = sorted.slice(0, topCount);

  const caveats = [
    `${quarterLabel(fromQ)} → ${quarterLabel(toQ)} 구간, 양 끝 분기 거래 ${MIN_DEALS}건 이상인 단지·평형만 봅니다.`,
    '과거에 그랬다는 것이지 앞으로도 그렇다는 뜻이 아닙니다.',
    '속성이 여러 개면 그중 몇 개는 우연히 상위와 겹칩니다. lift 가 커도 표본이 한 자리면 이야기로 만들지 마세요.',
    mode === 'excess'
      ? '지역 초과수익 모드 — 같은 시군구 중위 대비입니다. 시군구 자체가 오른 효과는 빠져 있습니다.'
      : '절대 수익률 모드 — 많이 오른 시군구가 상위를 채웁니다. 시군구 공통점은 동어반복이니 초과수익 모드와 같이 보세요.',
  ];

  return {
    mode,
    years,
    topPercent,
    universe: sorted.length,
    topCount: top.length,
    entries: top,
    traits: traitsOf(raw, top),
    districtMedians: [...medians.entries()]
      .map(([code, m]) => ({
        code,
        label: districtLabel(code),
        median: m,
        n: byDistrict.get(code)?.length ?? 0,
      }))
      .sort((a, b) => b.median - a.median),
    caveats,
  };
}

/** 리포트용 마크다운. 화면 밖으로 들고 나갈 수 있어야 논의에 쓸 수 있습니다. */
export function rankingReport(result: RankingResult, scopeLabel: string): string {
  const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;
  const eok = (v: number) => `${(v / 1e8).toFixed(2)}억`;

  const lines: string[] = [];
  lines.push(`# 수익률 상위권 공통점 — ${scopeLabel}`);
  lines.push('');
  lines.push(
    `- 기준: ${result.mode === 'excess' ? '지역 초과수익 (시군구 중위 대비)' : '절대 수익률'}` +
      ` · 최근 ${result.years}년 · 상위 ${result.topPercent}%`
  );
  lines.push(`- 표본: 단지·평형 ${result.universe.toLocaleString('ko-KR')}건 중 상위 ${result.topCount}건`);
  lines.push(`- 출처: ${MARKET.source.name} · 기준일 ${MARKET.asOf}`);
  lines.push('');

  lines.push('## 공통점');
  for (const g of result.traits) {
    const shown = g.buckets.filter((b) => b.topCount >= 3).slice(0, 5);
    if (shown.length === 0) continue;
    lines.push('');
    lines.push(`### ${g.label}`);
    lines.push(`> ${g.hint}`);
    lines.push('');
    lines.push('| 구분 | 상위권 | 상위 비중 | 전체 비중 | 배수 |');
    lines.push('|---|---|---|---|---|');
    for (const b of shown) {
      lines.push(
        `| ${b.key} | ${b.topCount}건 | ${pct(b.topShare, 1)} | ${pct(b.allShare, 1)} | ${b.lift.toFixed(2)}배 |`
      );
    }
  }

  lines.push('');
  lines.push('## 상위 단지');
  lines.push('');
  lines.push('| 단지 | 법정동 | 시군구 | 준공 | 전용 | 진입가 | 현재 | 연복리 | 지역초과 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const e of result.entries.slice(0, 40)) {
    lines.push(
      `| ${e.name} | ${e.umd} | ${e.districtLabel} | ${e.buildYear || '—'} | ${e.area}㎡ | ` +
        `${eok(e.startPrice)} | ${eok(e.endPrice)} | ${pct(e.cagr)} | ${pct(e.excess)} |`
    );
  }

  lines.push('');
  lines.push('## 시군구 중위 수익률');
  lines.push('');
  lines.push('| 시군구 | 중위 연복리 | 표본 |');
  lines.push('|---|---|---|');
  for (const d of result.districtMedians) {
    lines.push(`| ${d.label} | ${pct(d.median)} | ${d.n}건 |`);
  }

  lines.push('');
  lines.push('## 읽을 때 주의');
  for (const c of result.caveats) lines.push(`- ${c}`);

  return lines.join('\n');
}
