/**
 * 시중 물건 고르기 — 실거래 스냅샷의 단지·평형에서 `Property` 초안을 만듭니다.
 *
 * 물건을 손으로만 만들면 실거래 탭·가격 위치와 이을 고리가 없습니다. 여기서
 * 만든 초안에는 `link`(단지 id·평형)가 달려, 같은 물건을 축으로 화면들이 이어집니다.
 *
 * ```
 * 이름·법정동·준공  스냅샷 그대로                         (단지 단위 실측)
 * 지역군·시군구     스냅샷 regions[code] 의 region·label
 * 전용면적         스냅샷 정수 ㎡ — 반올림된 값이라 85㎡ 경계는 등기부로 확인
 * 매매가           최근 4분기(마지막 완결 분기까지) 거래건수 가중 중위
 * 세대수           0 — 국토부 자료에 없습니다. 화면이 "직접 입력" 을 요구합니다
 * ```
 *
 * **세대수를 지어내지 않습니다.** 0 은 "모름" 이고, 점수 계산은 0 이면 그 지표를
 * 가중치에서 뺍니다(`scoring.ts`). 100세대 미만으로 읽히면 시중 물건이 전부 손해를 봅니다.
 */

import {
  MARKET,
  THIN_DEAL_COUNT,
  findComplex,
  pooledMedian,
  pooledWindowLabel,
  searchComplexes,
  type MarketComplex,
  type MarketSize,
} from './market';
import { SALE_AS_OF_Q } from './temperature';
import type { PriceBasis, PropertyLink, RegionId } from './types';

/** 가격을 묶는 분기 수 — 단지 상세 평형별 표와 같은 4분기 */
export const PICK_POOL_QUARTERS = 4;

/** 디딤돌 85㎡ 판정이 걸리는 반올림 구간 — 스냅샷 84·85·86 은 실제로 84.5~86.49 입니다 */
export const AREA_BOUNDARY_CHECK: [number, number] = [84, 86];

export interface PickDraft {
  name: string;
  region: RegionId;
  sigungu: string;
  /** 스냅샷 정수 ㎡ (반올림된 값임을 화면에 적습니다) */
  areaSqm: number;
  builtYear: number;
  /** 자료 없음 — 0 으로 두고 화면이 "직접 입력" 을 요구합니다 */
  householdCount: 0;
  /** 최근 4분기 거래 가중 중위. 거래가 없으면 null → 사용자가 넣어야 합니다 */
  price: number | null;
  priceBasis: PriceBasis | null;
  link: PropertyLink;
  autoFill: true;
}

export interface PickSizeOption {
  area: number;
  /** 스냅샷 전체 거래건수 */
  deals: number;
  /** 최근 4분기 묶음 */
  recent: { price: number; n: number } | null;
  /** 85㎡ 경계 근처 — 등기부 전용면적으로 확인 */
  boundary: boolean;
}

const regionByCode = new Map(MARKET.regions.map((r) => [r.code, r]));

/** 시군구 코드 → 지역군·라벨. 수집 대상이 아니면 null */
export function districtOf(code: string): { code: string; label: string; region: RegionId } | null {
  const r = regionByCode.get(code);
  return r ? { code: r.code, label: r.label, region: r.region as RegionId } : null;
}

/** 지역군별 시군구 목록 (스냅샷 순서) */
export function pickDistricts(region?: RegionId): { code: string; label: string; region: RegionId }[] {
  return MARKET.regions
    .filter((r) => !region || r.region === region)
    .map((r) => ({ code: r.code, label: r.label, region: r.region as RegionId }));
}

const dealsOf = (s: MarketSize) => s.points.reduce((a, p) => a + p.n, 0);
const complexDeals = (c: MarketComplex) => c.sizes.reduce((a, s) => a + dealsOf(s), 0);

/** 평형 하나의 최근 묶음 — 고르기와 가격 위치가 같은 규칙을 씁니다 */
export function recentPool(size: MarketSize): { price: number; n: number } | null {
  return pooledMedian(size.points, SALE_AS_OF_Q, PICK_POOL_QUARTERS);
}

/** 묶음 구간 라벨 (예: 2025Q3~2026Q2) */
export const PICK_WINDOW = pooledWindowLabel(SALE_AS_OF_Q, PICK_POOL_QUARTERS);

/**
 * 단지 후보. 검색어가 비면 그 지역에서 거래가 많은 순, 있으면 `searchComplexes` 순위 그대로.
 * 지역군·시군구 필터는 검색 **뒤에** 겁니다 — 앞에서 자르면 순위가 다른 권역 단지에 밀립니다.
 */
export function pickCandidates(
  query: string,
  opts: { region?: RegionId; districtCode?: string; limit?: number } = {}
): MarketComplex[] {
  const limit = opts.limit ?? 30;
  const keep = (c: MarketComplex) =>
    (!opts.districtCode || c.regionCode === opts.districtCode) && (!opts.region || c.region === opts.region);
  const pool = query.trim()
    ? searchComplexes(query, MARKET.complexes.length).filter(keep)
    : MARKET.complexes.filter(keep).sort((a, b) => complexDeals(b) - complexDeals(a));
  return pool.slice(0, limit);
}

/** 단지의 평형 선택지 — 거래 많은 순 */
export function pickSizes(complexId: string): PickSizeOption[] {
  const c = findComplex(complexId);
  if (!c) return [];
  return c.sizes
    .map((s) => ({
      area: s.area,
      deals: dealsOf(s),
      recent: recentPool(s),
      boundary: areaNeedsCheck(s.area),
    }))
    .sort((a, b) => b.deals - a.deals);
}

/** 단지·평형 → 물건 초안. 단지나 평형이 스냅샷에 없으면 null */
export function pickFromMarket(complexId: string, area: number): PickDraft | null {
  const c = findComplex(complexId);
  const d = c ? districtOf(c.regionCode) : null;
  const size = c?.sizes.find((s) => s.area === area);
  if (!c || !d || !size) return null;

  const pooled = recentPool(size);
  const priceBasis: PriceBasis | null = pooled
    ? { price: pooled.price, window: PICK_WINDOW, n: pooled.n, thin: pooled.n < THIN_DEAL_COUNT }
    : null;

  return {
    name: c.name,
    region: d.region,
    sigungu: d.label,
    areaSqm: size.area,
    builtYear: c.buildYear,
    householdCount: 0,
    price: pooled?.price ?? null,
    priceBasis,
    link: { complexId: c.id, area: size.area },
    autoFill: true,
  };
}

/**
 * 초안 → `addProperty` 에 넘길 값. 가격이 없으면(최근 4분기 거래 0건) 가격 칸을 비워
 * 빈 물건의 기본 가격이 남지 않도록 0 으로 둡니다 — 화면이 "직접 입력" 을 띄웁니다.
 */
export function draftToProperty(d: PickDraft) {
  return {
    name: d.name,
    region: d.region,
    sigungu: d.sigungu,
    areaSqm: d.areaSqm,
    builtYear: d.builtYear,
    householdCount: d.householdCount,
    price: d.price ?? 0,
    priceBasis: d.priceBasis ?? undefined,
    link: d.link,
    autoFill: d.autoFill,
  };
}

/** 85㎡ 경계 안내 — 반올림된 스냅샷 면적이 디딤돌 판정을 가를 수 있는 구간 */
export function areaNeedsCheck(area: number): boolean {
  return area >= AREA_BOUNDARY_CHECK[0] && area <= AREA_BOUNDARY_CHECK[1];
}
