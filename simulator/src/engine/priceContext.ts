/**
 * 왜 그 가격인지 — 같은 구 · 같은 평형대 · 같은 연식대 안에서 이 가격이 어디쯤인가.
 *
 * 입지 점수 항목은 대부분 주관 입력이라 가격을 **설명**하지 못합니다. 실측으로 가격을
 * 가를 수 있는 축은 구 · 평형대 · 연식 셋뿐이고, 그 셋 안의 위치를 재서 점수와
 * **대조**하는 것이 이 자료로 할 수 있는 정직한 답입니다.
 *
 * ```
 * 이웃      같은 구 · 전용 ±10㎡ · 최근 4분기 거래 3건↑ 단지·평형 (자기 단지 제외)
 * 백분위    이웃 중 ㎡당 가격이 이 물건보다 싼 비율 (0 = 가장 쌈). 이웃 8개 미만이면 null
 * 연식대    신축(룰셋 newBuildMaxAge 이내) · 8~20년 · 20년↑ — 같은 연식대 이웃 안에서 다시
 * 전세가율  단지 단위(마산 생활권 전월세 스냅샷)가 있으면 그것, 없으면 구 중위
 * ```
 *
 * 백분위는 가격 **예측이 아닙니다.** "비싸다" 는 같은 구·평형대 거래 대비 위치이고,
 * 그 차이를 무엇이 설명하는지(위치·브랜드·층)는 이 자료에 없습니다.
 */

import { complexDetail } from '../rentfinder/complex';
import { MARKET, THIN_DEAL_COUNT, findComplex } from './market';
import { PICK_POOL_QUARTERS, PICK_WINDOW, districtOf, recentPool } from './pick';
import { RENT } from './rent';
import { RULES } from './rules';
import { scoreProperty } from './scoring';
import { propertyThesis, type PropertyThesis, type ThesisKind } from './thesis';
import type { Property } from './types';

/** 이웃이 이보다 적으면 백분위를 내지 않습니다 — 한두 단지에 위치가 통째로 흔들립니다 */
export const MIN_PEERS = 8;
/** 평형대 폭 (전용 ±㎡) — 화면에서 넓혀 볼 수 있습니다 */
export const BAND_DEFAULT = 10;
export const BAND_WIDE = 20;
/** 연식대 경계 — 신축은 룰셋, 그 위 한 칸은 여기 */
const MID_AGE_MAX = 20;

export type AgeBand = '신축≤7년' | '8~20년' | '20년↑';

export interface PeerRow {
  complexId: string;
  name: string;
  umd: string;
  area: number;
  buildYear: number;
  /** 최근 4분기 거래 가중 중위 */
  price: number;
  n: number;
  perSqm: number;
  ageBand: AgeBand;
}

export interface PriceContext {
  /** 이 물건 ㎡당 가격 (지금 입력된 매매가 ÷ 전용면적) */
  perSqm: number;
  district: { code: string; label: string };
  band: { areaFrom: number; areaTo: number };
  /** 같은 구·평형대 이웃 (자기 단지 제외) */
  peers: PeerRow[];
  /** 이웃 중 ㎡당 가격 백분위 (0 = 가장 쌈). 이웃 < 8 이면 null */
  percentile: number | null;
  byAge: { band: AgeBand; percentile: number | null; n: number };
  jeonseRatio: { value: number; scope: '단지' | '시군구'; n: number } | null;
  /** 이 단지·평형의 최근 4분기 거래 건수 (유동성) */
  deals4q: number;
  /** 이 단지·평형의 최근 4분기 중위 — 입력 매매가와 견줄 값 */
  self: { price: number; n: number; window: string; thin: boolean } | null;
  thesis: PropertyThesis;
  /** 어긋남 문장 */
  gaps: string[];
}

const currentYear = () => new Date().getFullYear();

/** 연식 → 연식대. 경계: 신축 이내(기본 7년)까지 신축, 20년까지 중간 */
export function ageBand(age: number): AgeBand {
  if (age <= RULES.appraisal.newBuildMaxAge) return '신축≤7년';
  if (age <= MID_AGE_MAX) return '8~20년';
  return '20년↑';
}

/** 비교 대상 중 값이 더 작은 비율 — 0~1. 대상이 MIN_PEERS 미만이면 null */
export function percentileOf(value: number, others: number[]): number | null {
  if (others.length < MIN_PEERS || !(value > 0)) return null;
  return others.filter((v) => v < value).length / others.length;
}

/* ── 어긋남 문장 — 문장은 상수, 조건만 코드 ────────────────────────── */

export const PRICE_GAPS = {
  pricierThanAge:
    '같은 연식대에선 중간인데 구 전체에선 비싼 편 — 평형·연식이 아닌 다른 이유(위치·브랜드)를 점수에 넣었는지 봐야 합니다',
  cheapButUngrounded: '싸게 보이지만 입지 점수의 절반이 미입력 중간값입니다 — 싼 이유를 먼저 채워 보세요',
  ambiguousNotCheap: '애매 구간(신축도 재건축도 아님)인데 싸지도 않습니다',
} as const;

export function priceGaps(input: {
  percentile: number | null;
  agePercentile: number | null;
  groundedShare: number;
  thesisKind: ThesisKind;
}): string[] {
  const { percentile: p, agePercentile: a, groundedShare, thesisKind } = input;
  const out: string[] = [];
  if (p != null && a != null && p >= 0.75 && a < 0.5) out.push(PRICE_GAPS.pricierThanAge);
  if (p != null && p <= 0.25 && groundedShare < 0.5) out.push(PRICE_GAPS.cheapButUngrounded);
  if (p != null && thesisKind === 'ambiguous' && p >= 0.5) out.push(PRICE_GAPS.ambiguousNotCheap);
  return out;
}

/* ── 본체 ───────────────────────────────────────────────────────────── */

function districtPeers(code: string, selfId: string, from: number, to: number, year: number): PeerRow[] {
  const out: PeerRow[] = [];
  for (const c of MARKET.complexes) {
    if (c.regionCode !== code || c.id === selfId) continue;
    for (const s of c.sizes) {
      if (s.area < from || s.area > to) continue;
      const pooled = recentPool(s);
      if (!pooled || pooled.n < THIN_DEAL_COUNT) continue;
      out.push({
        complexId: c.id,
        name: c.name,
        umd: c.umd,
        area: s.area,
        buildYear: c.buildYear,
        price: pooled.price,
        n: pooled.n,
        perSqm: pooled.price / s.area,
        ageBand: ageBand(year - c.buildYear),
      });
    }
  }
  return out;
}

function jeonseRatioFor(complexId: string, area: number, code: string): PriceContext['jeonseRatio'] {
  // 마산 생활권 전월세 스냅샷이 있는 단지는 단지 상세와 같은 머리 숫자를 그대로 씁니다
  const d = complexDetail(complexId, area);
  if (d?.headline.ratio != null && d.headline.ratio > 0) {
    return { value: d.headline.ratio, scope: '단지', n: d.headline.recent.n };
  }
  const r = RENT.byRegionCode[code]?.jeonseRatio;
  return r ? { value: r.median, scope: '시군구', n: r.n } : null;
}

/**
 * 물건 하나의 가격 위치. `link` 가 없거나 단지·구를 못 찾으면 null — 손 입력 물건은
 * "실거래 단지와 잇기" 를 해야 이 질문에 답할 수 있습니다.
 */
export function priceContext(
  property: Property,
  opts: { bandWidth?: number; groundedShare?: number } = {}
): PriceContext | null {
  const link = property.link;
  const c = link ? findComplex(link.complexId) : null;
  const d = c ? districtOf(c.regionCode) : null;
  if (!link || !c || !d) return null;

  const width = opts.bandWidth ?? BAND_DEFAULT;
  const band = { areaFrom: link.area - width, areaTo: link.area + width };
  const year = currentYear();
  const peers = districtPeers(d.code, c.id, band.areaFrom, band.areaTo, year);

  const perSqm = property.areaSqm > 0 ? property.price / property.areaSqm : 0;
  const percentile = percentileOf(perSqm, peers.map((p) => p.perSqm));

  const myBand = ageBand(year - property.builtYear);
  const agePeers = peers.filter((p) => p.ageBand === myBand);
  const agePercentile = percentileOf(perSqm, agePeers.map((p) => p.perSqm));

  const size = c.sizes.find((s) => s.area === link.area);
  const pooled = size ? recentPool(size) : null;

  const thesis = propertyThesis(property);
  const groundedShare = opts.groundedShare ?? scoreProperty(property).coverage.groundedShare;

  return {
    perSqm,
    district: { code: d.code, label: d.label },
    band,
    peers,
    percentile,
    byAge: { band: myBand, percentile: agePercentile, n: agePeers.length },
    jeonseRatio: jeonseRatioFor(c.id, link.area, d.code),
    deals4q: pooled?.n ?? 0,
    self: pooled
      ? { price: pooled.price, n: pooled.n, window: PICK_WINDOW, thin: pooled.n < THIN_DEAL_COUNT }
      : null,
    thesis,
    gaps: priceGaps({ percentile, agePercentile, groundedShare, thesisKind: thesis.kind }),
  };
}

/** ㎡당 가격이 가장 가까운 이웃 k개 — 화면의 이웃 표 */
export function nearestPeers(ctx: PriceContext, k = 5): PeerRow[] {
  return [...ctx.peers].sort((a, b) => Math.abs(a.perSqm - ctx.perSqm) - Math.abs(b.perSqm - ctx.perSqm)).slice(0, k);
}

/** 묶음 분기 수 — 화면 문구용 */
export const PRICE_POOL_QUARTERS = PICK_POOL_QUARTERS;
