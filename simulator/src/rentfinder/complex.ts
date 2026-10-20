/**
 * 단지 상세 — **"이 줄 하나를 믿어도 되나."**
 *
 * 후보판·찾기·시세판의 한 줄은 숫자 하나(최근 전세·전세가율)로 접혀 있습니다.
 * 그 숫자 뒤에 있는 같은 단지·평형의 분기 추이를 화면을 떠나지 않고 펴 보는
 * 자리입니다. 화면을 모르는 순수 함수만 둡니다.
 *
 * ```
 * 매매   market-*.json   같은 id, 평형 ±2㎡ 중 가장 가까운 것 — 2016~ 분기 중위 전부
 * 전세   masan-rent-*.json 같은 id·평형의 trend — 최근 8분기 분기 중위
 * 비율   분기마다 전세 중위 ÷ 매매 중위 — 두 점이 다 있는 분기만, 어느 쪽이든 3건 미만이면 thin
 * 머리   recentJeonse() · jeonseSafety() 를 그대로 부릅니다 — 후보판 줄과 같은 숫자
 * ```
 *
 * **머리 숫자를 여기서 다시 계산하지 않습니다.** 후보판과 어긋나면 "어느 쪽이
 * 맞나" 가 되고, 그 질문은 이 패널이 답하려던 것보다 큽니다.
 *
 * **개별 거래는 없습니다.** 두 스냅샷 모두 분기 중위로 접혀 있어, "최근 거래"
 * 가 아니라 "최근 분기" 로 부릅니다.
 */

import { lastCompleteQ } from '../engine/temperature';
import { MARKET, THIN_DEAL_COUNT, mainSize, quarterLabel, type MarketComplex, type MarketSize } from '../engine/market';
import type { BoardSignals } from './board/boardDoc';
import { recentJeonse, type RecentJeonse } from './boardRow';
import { COMPLEXES, regionOf, type RentComplex, type RentSize } from './data';
import { jeonseSafety, type JeonseSafety } from './safety';

/** 전용면적이 이만큼 벌어지면 다른 평형으로 봅니다 — safety.ts 와 같은 기준 */
const AREA_TOLERANCE = 2;
/** "최근 분기" 로 보여 줄 분기 수 — 후보판 jh·sh 와 같은 6분기 */
const RECENT_QUARTERS = 6;
/** 평형별 표의 매매 묶음 — 최근 4분기 */
const POOL_QUARTERS = 4;

export interface SizeRow {
  /** 전용면적 (㎡) */
  area: number;
  /** 매매 최근 4분기(완결 분기 기준) 거래건수 가중 중위 */
  sale: { price: number; n: number } | null;
  /** 전세 2년 중위 */
  jeonse: { deposit: number; n: number } | null;
  /** 월세 2년 중위 */
  wolse: { deposit: number; rent: number; n: number } | null;
  /** 후보판과 같은 규칙의 전세가율 (최근 전세 ÷ 최근 1년 매매) */
  ratio: number | null;
  renewalShare: number | null;
  lastYm: string | null;
}

/** 전세 만기 하나 — signals.json 의 upcoming 그대로 */
export type MaturityItem = BoardSignals['rows'][string]['upcoming'][number];

export interface RecentQuarter {
  q: number;
  label: string;
  sale?: { n: number; price: number };
  jeonse?: { n: number; deposit: number };
  /** 매매 스냅샷 수집이 그 분기 도중에 끝나 덜 잡힌 분기 */
  salePartial: boolean;
}

export interface ComplexDetail {
  cx: string;
  name: string;
  umd: string;
  region: string;
  built: number;
  /** 고른 평형 (없으면 전월세 거래 최다 평형) */
  area: number;
  /** 같은 칸 매매 분기 중위 — 2016~ 전부 */
  sale: { q: number; n: number; price: number }[];
  /** 같은 칸 전세 분기 중위 — 8분기 */
  jeonse: { q: number; n: number; deposit: number }[];
  /** 두 점이 다 있는 분기만 */
  ratioSeries: { q: number; ratio: number; thin: boolean }[];
  /** 후보판과 같은 규칙 */
  headline: { recent: RecentJeonse; safety: JeonseSafety | null; ratio: number | null };
  /** 두 스냅샷 평형의 합집합, 면적 오름차순 */
  sizes: SizeRow[];
  /** 최근 6분기 */
  recentQuarters: RecentQuarter[];
  /** null = 감시 밖이거나 서버 신호가 없음(모름), [] = 감시 중인데 6개월 안 만기 없음 */
  signals: MaturityItem[] | null;
  /** 한쪽 스냅샷에 이 단지·평형이 없을 때 */
  missing: ('sale' | 'rent')[];
  /** 매매 평형별 최근 4분기 창 라벨 */
  saleWindow: string;
}

const marketById = new Map<string, MarketComplex>(MARKET.complexes.map((c) => [c.id, c]));
const rentById = new Map<string, RentComplex>(COMPLEXES.map((c) => [c.id, c]));

/**
 * 매매 스냅샷의 마지막 **완결** 분기 — 수집이 분기 도중(8월)에 끝나면 그 분기는 덜
 * 잡혀 있어 직전 분기까지만 묶습니다. 시장 온도·동네 시세판과 같은 함수입니다.
 */
const SALE_LAST_Q = lastCompleteQ(MARKET.range.to, MARKET.quarterBaseYear);

/** 두 스냅샷 중 늦은 쪽의 마지막 분기 */
const SNAPSHOT_END_Q = (() => {
  let q = -Infinity;
  for (const c of MARKET.complexes) for (const s of c.sizes) for (const p of s.points) if (p.q > q) q = p.q;
  for (const c of COMPLEXES) for (const s of c.sizes) for (const t of s.trend) if (t.q > q) q = t.q;
  return q;
})();

const sumN = (pts: { n: number }[]) => pts.reduce((s, p) => s + p.n, 0);

/** 분기 중위들을 거래건수로 가중한 중위 — safety.ts 의 묶음과 같은 방식 */
function pooled(points: { n: number; price: number }[]): { price: number; n: number } | null {
  const sorted = [...points].filter((p) => p.price > 0).sort((a, b) => a.price - b.price);
  const total = sumN(sorted);
  let acc = 0;
  for (const p of sorted) {
    acc += p.n;
    if (acc * 2 >= total) return { price: p.price, n: total };
  }
  return null;
}

function nearestSize<T extends { area: number }>(sizes: T[], area: number): T | null {
  return (
    sizes
      .filter((s) => Math.abs(s.area - area) <= AREA_TOLERANCE)
      .sort((a, b) => Math.abs(a.area - area) - Math.abs(b.area - area))[0] ?? null
  );
}

/** 후보판 줄과 같은 규칙의 최근 전세 · 전세가율 */
function headlineOf(cx: string, rs: RentSize | null): ComplexDetail['headline'] {
  const recent: RecentJeonse = rs
    ? recentJeonse(rs)
    : { value: null, n: 0, basis: '거래 없음', split: false, dropped: [] };
  const safety = recent.value ? jeonseSafety(cx, rs!.area, recent.value) : null;
  const ratio = recent.value && safety?.salePrice ? recent.value / safety.salePrice : null;
  return { recent, safety, ratio };
}

/** 전월세 거래가 가장 많은 평형, 전월세가 없으면 매매 거래가 가장 많은 평형 */
export function pickArea(cx: string): number | null {
  const rc = rentById.get(cx);
  if (rc && rc.sizes.length) return rc.sizes.reduce((a, b) => (b.n > a.n ? b : a)).area;
  const mk = marketById.get(cx);
  return mk ? (mainSize(mk)?.area ?? null) : null;
}

/** 평형별 표 — 전월세 평형에 가장 가까운 매매 평형(±2㎡)을 붙이고, 남은 매매 평형은 따로 줄 */
function sizeRows(cx: string, rc: RentComplex | undefined, mk: MarketComplex | undefined): SizeRow[] {
  const salePool = (s: MarketSize) =>
    pooled(s.points.filter((p) => p.q > SALE_LAST_Q - POOL_QUARTERS && p.q <= SALE_LAST_Q));
  const used = new Set<MarketSize>();
  const pairs: { rent: RentSize; sale: MarketSize | null }[] = (rc?.sizes ?? []).map((r) => ({ rent: r, sale: null }));
  // 가까운 짝부터 붙입니다 — 매매 평형 하나가 두 전월세 평형에 붙지 않게.
  const cand = pairs
    .flatMap((p) => (mk?.sizes ?? []).map((s) => ({ p, s, d: Math.abs(s.area - p.rent.area) })))
    .filter((x) => x.d <= AREA_TOLERANCE)
    .sort((a, b) => a.d - b.d);
  for (const { p, s } of cand) {
    if (p.sale || used.has(s)) continue;
    p.sale = s;
    used.add(s);
  }
  const rows: SizeRow[] = pairs.map(({ rent, sale }) => ({
    area: rent.area,
    sale: sale ? salePool(sale) : null,
    jeonse: rent.jeonse ? { deposit: rent.jeonse.deposit, n: rent.jeonse.n } : null,
    wolse: rent.wolse ? { deposit: rent.wolse.deposit, rent: rent.wolse.rent, n: rent.wolse.n } : null,
    ratio: headlineOf(cx, rent).ratio,
    renewalShare: rent.renewalShare,
    lastYm: rent.lastYm,
  }));
  for (const s of mk?.sizes ?? []) {
    if (used.has(s)) continue;
    const last = s.points.reduce<number | null>((a, p) => (a == null || p.q > a ? p.q : a), null);
    rows.push({
      area: s.area,
      sale: salePool(s),
      jeonse: null,
      wolse: null,
      ratio: null,
      renewalShare: null,
      lastYm: last == null ? null : quarterLabel(last),
    });
  }
  return rows.sort((a, b) => a.area - b.area);
}

/**
 * 단지 하나 · 평형 하나의 상세.
 *
 * `signals` 는 서버의 signals.json — 안 넘기면(또는 null) 만기 칸은 `null`(모름),
 * 넘겼는데 이 줄이 감시 목록에 없으면 `[]`(6개월 안 만기 없음)입니다.
 */
export function complexDetail(cx: string, area?: number, signals?: BoardSignals | null): ComplexDetail | null {
  const rc = rentById.get(cx);
  const mk = marketById.get(cx);
  if (!rc && !mk) return null;
  const picked = area ?? pickArea(cx);
  if (picked == null) return null;

  const rs = rc ? (rc.sizes.find((s) => s.area === picked) ?? nearestSize(rc.sizes, picked)) : null;
  const ms = mk ? nearestSize(mk.sizes, picked) : null;

  const sale = ms ? ms.points.map((p) => ({ q: p.q, n: p.n, price: p.price })) : [];
  const jeonse = rs ? rs.trend.map((t) => ({ q: t.q, n: t.n, deposit: t.deposit })) : [];
  const saleByQ = new Map(sale.map((p) => [p.q, p]));

  const ratioSeries = jeonse
    .map((j) => {
      const s = saleByQ.get(j.q);
      if (!s || s.n < 1 || j.n < 1 || s.price <= 0) return null;
      return { q: j.q, ratio: j.deposit / s.price, thin: s.n < THIN_DEAL_COUNT || j.n < THIN_DEAL_COUNT };
    })
    .filter((x): x is { q: number; ratio: number; thin: boolean } => !!x);

  const jeonseByQ = new Map(jeonse.map((p) => [p.q, p]));
  // 두 스냅샷의 마지막 분기에서 끊습니다 — 거래가 없던 분기도 빈 줄로 남겨 "끊겼다" 를 보입니다.
  const endQ = SNAPSHOT_END_Q;
  const recentQuarters: RecentQuarter[] = [];
  for (let q = endQ - RECENT_QUARTERS + 1; q <= endQ; q++) {
    const s = saleByQ.get(q);
    const j = jeonseByQ.get(q);
    recentQuarters.push({
      q,
      label: quarterLabel(q),
      ...(s ? { sale: { n: s.n, price: s.price } } : {}),
      ...(j ? { jeonse: { n: j.n, deposit: j.deposit } } : {}),
      salePartial: q > SALE_LAST_Q,
    });
  }

  const area0 = rs?.area ?? ms?.area ?? picked;
  const sig: MaturityItem[] | null = signals
    ? [...(signals.rows[`${cx}_${area0}`]?.upcoming ?? [])].sort((a, b) => a.end.localeCompare(b.end))
    : null;

  const missing: ('sale' | 'rent')[] = [];
  if (!ms) missing.push('sale');
  if (!rs) missing.push('rent');

  const regionCode = rc?.regionCode ?? mk!.regionCode;
  const region =
    regionOf(regionCode)?.short ?? MARKET.regions.find((r) => r.code === regionCode)?.label ?? regionCode;

  return {
    cx,
    name: rc?.name ?? mk!.name,
    umd: rc?.umd ?? mk!.umd,
    region,
    built: rc?.buildYear || mk?.buildYear || 0,
    area: area0,
    sale,
    jeonse,
    ratioSeries,
    headline: headlineOf(cx, rs),
    sizes: sizeRows(cx, rc, mk),
    recentQuarters,
    signals: sig,
    missing,
    saleWindow: `${quarterLabel(SALE_LAST_Q - POOL_QUARTERS + 1)}~${quarterLabel(SALE_LAST_Q)}`,
  };
}

/** 이 패널이 못 말하는 것 — 화면 하단에 늘 붙습니다 */
export const COMPLEX_CAVEATS = [
  '동·호수가 자료에 없습니다 — 층까지만 압니다. 같은 층·같은 만기가 두 줄이면 두 세대인지 중복 신고인지 가릴 수 없습니다.',
  '근저당(융자)은 어느 공개 자료에도 없습니다. 전세가율이 낮아도 등기부등본 을구를 직접 봐야 합니다.',
  '매물이 아니라 체결된 계약입니다. 지금 빈 집이 있는지는 이 자료로 알 수 없습니다.',
  '분기 중위라 층·향·수리 상태가 한 숫자에 섞입니다. 거래가 1~2건인 분기는 사실상 그 집 한 채의 가격입니다.',
  '실거래는 체결 뒤 30일 안에 신고되므로 가장 최근 분기는 늘 적게 잡힙니다.',
];
