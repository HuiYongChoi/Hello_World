/**
 * 동네 시세판 — **"어느 동네에서 찾나"** 를 동별 한 표로.
 *
 * 마산 생활권 전월세 스냅샷(`masan-rent-*.json`)과 매매 스냅샷(`market-*.json`)을
 * 같은 `regionCode + umd` 로 붙입니다. 두 스냅샷 모두 법정동을 같은 표기
 * (`내서읍 상곡리`)로 들고 있어 이름으로 붙여도 어긋나지 않습니다.
 *
 * ```
 * ㎡당 전세     최근 4분기(전세 창) 분기 중위 보증금 ÷ 전용면적 을 거래 건수로 가중한 중위
 * ㎡당 매매     최근 4분기(매매 창) 분기 중위가 ÷ 전용면적 을 거래 건수로 가중한 중위
 * 전세가율      칸마다 (전세 창 전세 가중중위 ÷ 매매 창 매매 가중중위) → 칸들의 중위 (칸 3개↑)
 * 1년 변화      같은 칸 마지막 완결 분기 ÷ 4분기 전 → 칸들의 중위 − 1 (칸 5개↑)
 * 거래량 변화    최근 4분기 ÷ 그 앞 4분기 − 1 (앞 창 10건↑)
 * 신축 비중     전월세 2년 거래 중 준공 5년 이내 단지 거래 비중
 * ```
 *
 * **㎡당 중위를 쓰는 이유** — 동마다 평형 구성이 달라 보증금 중위를 그대로 견주면
 * "큰 집이 많은 동이 비싼 동" 이 됩니다. 평형대(59·84) 열은 두지 않습니다 — 동 × 평형대면
 * 칸 대부분이 3건 미만이라 없는 정확도를 만듭니다. 대신 동을 펼쳐 단지별로 봅니다.
 *
 * **창이 한 분기 어긋납니다.** 매매는 202608 수집이라 2026Q2 까지, 전세는 202609 수집이라
 * 2026Q3 까지가 완결입니다. 같은 분기로 억지로 맞추면 매매 쪽에 두 달짜리 분기가 섞이므로,
 * 각자의 마지막 완결 분기를 쓰고 창 라벨을 늘 같이 적습니다.
 *
 * 화면을 모릅니다. 매매 쪽 거래량·1년 변화는 `engine/temperature.ts` 를 그대로 부릅니다.
 */

import { MIN_LINKED_PAIRS } from '../engine/growth';
import { MARKET, type MarketComplex, type MarketSize } from '../engine/market';
import {
  NEW_BUILD_YEARS,
  SALE_AS_OF_Q,
  changeOfCells,
  dealsChange,
  inWindow,
  lastCompleteQ,
  median,
  qLabel,
  qYear,
  quarterWindow,
  saleTemperature,
  weightedMedian,
  type DealsChange,
} from '../engine/temperature';
import { COMPLEXES, RENT_REGIONS, RENT_SNAPSHOT, type RentComplex, type RentSize } from './data';
import { recentJeonse } from './boardRow';
import { jeonseSafety } from './safety';

/** 얇은 표본 기준 — 한 곳에 모아 테스트로 고정합니다 (설계서 §1.4). */
export const TOWN_MIN = {
  /** 동 단위 전세가율: 짝지은 칸이 이보다 적으면 그 동의 값은 한두 단지 값입니다 */
  ratioCells: 3,
  /** 구 단위 전세가율 추세 한 분기: growth.ts 의 연결 기준을 그대로 씁니다 */
  seriesCells: MIN_LINKED_PAIRS,
} as const;

/** 평형이 이만큼 벌어지면 다른 평형으로 봅니다 — safety.ts 와 같은 기준 */
const AREA_TOLERANCE = 2;

export const RENT_BASE_YEAR = RENT_SNAPSHOT.quarterBaseYear;
export const RENT_AS_OF_Q = lastCompleteQ(RENT_SNAPSHOT.range.to, RENT_BASE_YEAR);
const RENT_WINDOW = quarterWindow(RENT_AS_OF_Q, RENT_BASE_YEAR);
const SALE_WINDOW = quarterWindow(SALE_AS_OF_Q, MARKET.quarterBaseYear);
const RENT_NEW_SINCE = Number(RENT_SNAPSHOT.asOf.slice(0, 4)) - NEW_BUILD_YEARS;

const marketById = new Map<string, MarketComplex>(MARKET.complexes.map((c) => [c.id, c]));

/** 같은 단지의 매매 평형 중 ±2㎡ 안에서 가장 가까운 것 */
export function pairedSaleSize(cx: string, area: number, byId: Map<string, MarketComplex> = marketById): MarketSize | null {
  const mk = byId.get(cx);
  if (!mk) return null;
  return (
    mk.sizes
      .filter((s) => Math.abs(s.area - area) <= AREA_TOLERANCE)
      .sort((a, b) => Math.abs(a.area - area) - Math.abs(b.area - area))[0] ?? null
  );
}

export interface TownRow {
  key: string;
  label: string;
  regionCode: string;
  /** level='sgg' 면 null */
  umd: string | null;
  /** 두 스냅샷 단지의 합집합 */
  complexes: number;
  jeonseDeals2y: number;
  wolseDeals2y: number;
  jeonsePerSqm: { v: number; n: number } | null;
  salePerSqm: { v: number; n: number } | null;
  ratio: { v: number; cells: number } | null;
  jeonseDealsChange: DealsChange;
  saleDealsChange: DealsChange;
  salePrice1y: { v: number; cells: number } | null;
  jeonse1y: { v: number; cells: number } | null;
  newShare: { v: number; deals: number } | null;
  windows: { sale: string; rent: string };
}

/** 한 동(또는 한 구)에 묶이는 단지들 */
interface TownGroup {
  key: string;
  label: string;
  regionCode: string;
  umd: string | null;
  rent: RentComplex[];
  sale: MarketComplex[];
}

const regionLabel = (code: string) => RENT_REGIONS.find((r) => r.code === code)?.short ?? code;

function groups(regionCodes: string[], level: 'umd' | 'sgg', rent: RentComplex[], sale: MarketComplex[]): TownGroup[] {
  const map = new Map<string, TownGroup>();
  const get = (code: string, umd: string) => {
    const key = level === 'sgg' ? code : `${code}|${umd}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        label: level === 'sgg' ? regionLabel(code) : umd,
        regionCode: code,
        umd: level === 'sgg' ? null : umd,
        rent: [],
        sale: [],
      };
      map.set(key, g);
    }
    return g;
  };
  for (const c of rent) if (regionCodes.includes(c.regionCode)) get(c.regionCode, c.umd).rent.push(c);
  for (const c of sale) if (regionCodes.includes(c.regionCode)) get(c.regionCode, c.umd).sale.push(c);
  return [...map.values()];
}

/** 전세 창 안의 전세 분기 점들을 건수로 가중한 중위 — 칸 하나의 "최근 전세" */
function recentJeonseInWindow(s: RentSize): { v: number; n: number } | null {
  return weightedMedian(s.trend.filter((t) => inWindow(t.q, RENT_WINDOW.recent)).map((t) => ({ n: t.n, v: t.deposit })));
}

/** 매매 창 안의 매매 분기 점들을 건수로 가중한 중위 — 칸 하나의 "최근 4분기 매매" */
function recentSaleInWindow(s: MarketSize): { v: number; n: number } | null {
  return weightedMedian(s.points.filter((p) => inWindow(p.q, SALE_WINDOW.recent)).map((p) => ({ n: p.n, v: p.price })));
}

function rowOf(g: TownGroup, saleById: Map<string, MarketComplex>): TownRow {
  let jeonseDeals2y = 0;
  let wolseDeals2y = 0;
  let rentDeals = 0;
  let rentNew = 0;
  let jRecent = 0;
  let jPrior = 0;
  const jPerSqm: { n: number; v: number }[] = [];
  const ratios: number[] = [];
  const jPairs: [number, number][] = [];

  for (const c of g.rent) {
    const isNew = c.buildYear > 0 && c.buildYear >= RENT_NEW_SINCE;
    for (const s of c.sizes) {
      jeonseDeals2y += s.jeonse?.n ?? 0;
      wolseDeals2y += s.wolse?.n ?? 0;
      rentDeals += s.n;
      if (isNew) rentNew += s.n;
      let now: number | null = null;
      let ago: number | null = null;
      for (const t of s.trend) {
        if (inWindow(t.q, RENT_WINDOW.recent)) {
          jRecent += t.n;
          if (s.area > 0) jPerSqm.push({ n: t.n, v: t.deposit / s.area });
        } else if (inWindow(t.q, RENT_WINDOW.prior)) jPrior += t.n;
        if (t.q === RENT_AS_OF_Q) now = t.deposit;
        if (t.q === RENT_AS_OF_Q - 4) ago = t.deposit;
      }
      if (now !== null && ago !== null) jPairs.push([now, ago]);

      const rj = recentJeonseInWindow(s);
      const ss = rj ? pairedSaleSize(c.id, s.area, saleById) : null;
      const sp = ss ? recentSaleInWindow(ss) : null;
      if (rj && sp && sp.v > 0) ratios.push(rj.v / sp.v);
    }
  }

  const sPerSqm: { n: number; v: number }[] = [];
  for (const c of g.sale) {
    for (const s of c.sizes) {
      if (s.area <= 0) continue;
      for (const p of s.points) if (inWindow(p.q, SALE_WINDOW.recent)) sPerSqm.push({ n: p.n, v: p.price / s.area });
    }
  }

  const st = saleTemperature(g.sale);
  const ids = new Set([...g.rent.map((c) => c.id), ...g.sale.map((c) => c.id)]);

  return {
    key: g.key,
    label: g.label,
    regionCode: g.regionCode,
    umd: g.umd,
    complexes: ids.size,
    jeonseDeals2y,
    wolseDeals2y,
    jeonsePerSqm: weightedMedian(jPerSqm),
    salePerSqm: weightedMedian(sPerSqm),
    ratio: ratios.length >= TOWN_MIN.ratioCells ? { v: median(ratios), cells: ratios.length } : null,
    jeonseDealsChange: dealsChange(jRecent, jPrior),
    saleDealsChange: { recent: st.deals.recent, prior: st.deals.prior, change: st.deals.change },
    salePrice1y: st.price1y,
    jeonse1y: changeOfCells(jPairs),
    newShare: rentDeals > 0 ? { v: rentNew / rentDeals, deals: rentDeals } : null,
    windows: { sale: SALE_WINDOW.label, rent: RENT_WINDOW.label },
  };
}

/** 동별(또는 구별) 시세판. 기본 정렬은 전세 2년 거래 수 내림차순 */
export function townRows(opts: { regionCodes: string[]; level: 'umd' | 'sgg' }): TownRow[] {
  return townRowsFrom(opts, COMPLEXES, MARKET.complexes);
}

/** 테스트에서 작은 동을 만들어 넣을 수 있게 단지 목록을 받는 판 */
export function townRowsFrom(
  opts: { regionCodes: string[]; level: 'umd' | 'sgg' },
  rent: RentComplex[],
  sale: MarketComplex[]
): TownRow[] {
  const saleById = sale === MARKET.complexes ? marketById : new Map(sale.map((c) => [c.id, c]));
  return groups(opts.regionCodes, opts.level, rent, sale)
    .map((g) => rowOf(g, saleById))
    .sort((a, b) => b.jeonseDeals2y - a.jeonseDeals2y || b.complexes - a.complexes || a.label.localeCompare(b.label, 'ko'));
}

export interface TownComplexSize {
  area: number;
  /** 후보판과 같은 규칙의 최근 전세 (`recentJeonse`) */
  jeonse: { deposit: number | null; n: number; basis: string; split: boolean } | null;
  wolse: { deposit: number; rent: number; n: number } | null;
  /** 같은 평형 매매 최근 1년 가중중위 (`jeonseSafety` 와 같은 값) */
  sale: { price: number; n: number } | null;
  /** 후보판과 같은 계산의 전세가율 */
  ratio: number | null;
}

export interface TownComplex {
  cx: string;
  name: string;
  built: number;
  /** 전월세 2년 거래 수 — 펼침 목록의 정렬 기준 */
  rentDeals2y: number;
  sizes: TownComplexSize[];
}

/**
 * 동 펼침 — 그 동의 단지별 평형 목록.
 *
 * 숫자는 후보판·단지 상세와 **같은 함수**(`recentJeonse`·`jeonseSafety`)로 냅니다.
 * 셋이 다른 계산을 쓰면 "어느 쪽이 맞나" 가 됩니다.
 */
export function townComplexes(regionCode: string, umd: string): TownComplex[] {
  const out = new Map<string, TownComplex>();
  for (const c of COMPLEXES) {
    if (c.regionCode !== regionCode || c.umd !== umd) continue;
    const sizes: TownComplexSize[] = c.sizes.map((s) => {
      const rj = s.jeonse ? recentJeonse(s) : null;
      const saf = jeonseSafety(c.id, s.area, rj?.value ?? 1);
      const sale = saf.salePrice ? { price: saf.salePrice, n: saf.saleDeals } : null;
      return {
        area: s.area,
        jeonse: rj ? { deposit: rj.value, n: rj.n, basis: rj.basis, split: rj.split } : null,
        wolse: s.wolse ? { deposit: s.wolse.deposit, rent: s.wolse.rent, n: s.wolse.n } : null,
        sale,
        ratio: rj?.value && sale ? rj.value / sale.price : null,
      };
    });
    out.set(c.id, { cx: c.id, name: c.name, built: c.buildYear, rentDeals2y: c.sizes.reduce((a, s) => a + s.n, 0), sizes });
  }
  // 매매에만 있는 단지도 남깁니다 — 전세 칸이 비어 있을 뿐 그 동의 단지입니다.
  for (const c of MARKET.complexes) {
    if (c.regionCode !== regionCode || c.umd !== umd || out.has(c.id)) continue;
    const sizes: TownComplexSize[] = c.sizes
      .map((s) => {
        const saf = jeonseSafety(c.id, s.area, 1);
        return {
          area: s.area,
          jeonse: null,
          wolse: null,
          sale: saf.salePrice ? { price: saf.salePrice, n: saf.saleDeals } : null,
          ratio: null,
        };
      })
      .filter((s) => s.sale);
    out.set(c.id, { cx: c.id, name: c.name, built: c.buildYear, rentDeals2y: 0, sizes });
  }
  return [...out.values()]
    .map((c) => ({ ...c, sizes: [...c.sizes].sort((a, b) => a.area - b.area) }))
    .sort((a, b) => b.rentDeals2y - a.rentDeals2y || a.name.localeCompare(b.name, 'ko'));
}

/* ─────────────────────── 시장 온도 — 전세 축 ─────────────────────── */

export interface RatioPoint {
  q: number;
  /** 칸이 `TOWN_MIN.seriesCells` 미만이거나 매매 분기가 미완결이면 null */
  ratio: number | null;
  cells: number;
}

/**
 * 구 단위 전세가율 추세 — 분기마다 같은 칸의 (전세 분기 중위 ÷ 매매 분기 중위) 의 중위.
 *
 * 매매 스냅샷의 마지막 완결 분기 뒤(2026Q3)는 매매가 두 달짜리라 비웁니다. 거기를
 * 채우면 매매 쪽 표본만 얇아진 분기가 전세가율 변화처럼 보입니다.
 */
export function jeonseRatioSeries(regionCodes: string[]): RatioPoint[] {
  const qs: number[] = [];
  for (let q = RENT_AS_OF_Q - 7; q <= RENT_AS_OF_Q; q++) qs.push(q);
  const byQ = new Map<number, number[]>(qs.map((q) => [q, []]));
  for (const c of COMPLEXES) {
    if (!regionCodes.includes(c.regionCode)) continue;
    for (const s of c.sizes) {
      if (!s.trend.length) continue;
      const ss = pairedSaleSize(c.id, s.area);
      if (!ss) continue;
      const sale = new Map(ss.points.map((p) => [p.q, p.price]));
      for (const t of s.trend) {
        const arr = byQ.get(t.q);
        const p = sale.get(t.q);
        if (!arr || !p || p <= 0 || t.q > SALE_AS_OF_Q) continue;
        arr.push(t.deposit / p);
      }
    }
  }
  return qs.map((q) => {
    const r = byQ.get(q)!;
    return { q, ratio: r.length >= TOWN_MIN.seriesCells ? median(r) : null, cells: r.length };
  });
}

export interface JeonseTemperature {
  deals: DealsChange & { series: { q: number; n: number }[] };
  jeonse1y: { v: number; cells: number } | null;
  /** 값이 있는 마지막 분기와 그 4분기 전 */
  ratioLatest: { q: number; v: number; cells: number; prevQ: number; prev: number | null } | null;
  series: RatioPoint[];
  window: string;
}

/** 전세 쪽 시장 온도 — 창원 5구·함안·의령만 (전월세 스냅샷이 마산권뿐) */
export function jeonseTemperature(regionCodes: string[]): JeonseTemperature {
  let recent = 0;
  let prior = 0;
  const byQ = new Map<number, number>();
  const pairs: [number, number][] = [];
  for (const c of COMPLEXES) {
    if (!regionCodes.includes(c.regionCode)) continue;
    for (const s of c.sizes) {
      let now: number | null = null;
      let ago: number | null = null;
      for (const t of s.trend) {
        if (t.q > RENT_AS_OF_Q) continue;
        byQ.set(t.q, (byQ.get(t.q) ?? 0) + t.n);
        if (inWindow(t.q, RENT_WINDOW.recent)) recent += t.n;
        else if (inWindow(t.q, RENT_WINDOW.prior)) prior += t.n;
        if (t.q === RENT_AS_OF_Q) now = t.deposit;
        if (t.q === RENT_AS_OF_Q - 4) ago = t.deposit;
      }
      if (now !== null && ago !== null) pairs.push([now, ago]);
    }
  }
  const series = jeonseRatioSeries(regionCodes);
  const last = [...series].reverse().find((p) => p.ratio !== null);
  const prevQ = last ? last.q - 4 : 0;
  const prev = last ? (series.find((p) => p.q === prevQ)?.ratio ?? null) : null;
  const dealSeries: { q: number; n: number }[] = [];
  for (let q = RENT_AS_OF_Q - 7; q <= RENT_AS_OF_Q; q++) dealSeries.push({ q, n: byQ.get(q) ?? 0 });
  return {
    deals: { ...dealsChange(recent, prior), series: dealSeries },
    jeonse1y: changeOfCells(pairs),
    ratioLatest: last && last.ratio !== null ? { q: last.q, v: last.ratio, cells: last.cells, prevQ, prev } : null,
    series,
    window: RENT_WINDOW.label,
  };
}

/** 분기 라벨 — 전월세 스냅샷 기준 */
export const rentQLabel = (q: number) => qLabel(q, RENT_BASE_YEAR);
/** 전월세 스냅샷 신축 기준 연도 (이 해 이후 준공이면 신축) */
export const TOWN_NEW_SINCE = RENT_NEW_SINCE;
export const TOWN_ASOF_YEAR = qYear(RENT_AS_OF_Q, RENT_BASE_YEAR);

/** 이 자료가 못 하는 것 — 동네 시세판·시장 온도 하단에 붙습니다. */
export const TOWN_CAVEATS = [
  '매물 아님 — 국토부에 신고된 체결 계약입니다. 지금 나와 있는 집과 호가는 이 표에 없습니다.',
  '월세 추이 없음 — 월세는 2년 중위 하나뿐이라 오르는지 내리는지 말하지 못합니다. 추이·1년 변화는 전세만입니다.',
  '전세 축은 창원 5구·함안·의령의 2년치(2024Q4~)뿐입니다 — 추세라기엔 짧습니다. 부산·경기는 동별 전월세가 없어 매매만 봅니다.',
  '창이 한 분기 어긋납니다 — 매매는 202608 수집이라 2026Q2 까지, 전세는 2026Q3 까지가 완결 분기입니다.',
  '공급면적은 전용률로 되짚은 추정치입니다. ㎡당 값은 전부 전용면적 기준입니다.',
  '학군·교통·상권은 자료가 없어 넣지 않았습니다. 후보판의 인프라 축(OSM 시설 수)을 보세요.',
  '분기 중위라 층·향·수리 상태가 섞입니다. 금리 국면이 바뀌면 전세가율은 상수가 아닙니다.',
];
