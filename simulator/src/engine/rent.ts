/**
 * 전세가율·전월세전환율 실측치.
 *
 * 이 둘은 3-way 비교의 **순위를 직접 뒤집는** 값입니다. 전세가율이 높으면 보증금이
 * 목돈을 다 먹어 투자로 갈 돈이 사라지고, 전환율이 높으면 월세가 비싸져 적립액이 줄죠.
 * 그래서 자리표시자로 두는 동안에는 그 화면의 절대 금액에 의미가 없었습니다.
 *
 * ## 시장 평균으로 나누지 않았습니다
 *
 * 전월세 자료에는 매매 자료와 같은 `aptSeq` 가 들어 있어서, **같은 단지 · 같은 평형 ·
 * 같은 분기**끼리 짝지어 비율을 냈습니다. 시장 전체 전세 평균 ÷ 시장 전체 매매 평균으로
 * 구하면 전세가 활발한 단지와 매매가 활발한 단지가 뒤섞여 실제로는 존재하지 않는
 * 비율이 나옵니다.
 *
 * ## 여전히 주의할 것
 *
 * 최근 3년 표본입니다. 전세가율은 금리와 함께 크게 움직이므로 **지금 값이지 상수가
 * 아닙니다.** 사분위(p25~p75)를 같이 담아 뒀으니 폭을 함께 보세요.
 */

import rentSnapshot from '../data/rent-2026-08.json';
import type { RegionId } from './types';

export interface RentStat {
  n: number;
  median: number;
  p25: number;
  p75: number;
}

export interface RentSnapshot {
  version: string;
  asOf: string;
  source: { name: string; endpoint: string; license: string; note: string };
  range: { from: string; to: string };
  stats: { deals: number; failedRequests: number };
  method: { jeonseRatio: string; conversionRate: string };
  byRegion: Record<RegionId, { jeonseRatio: RentStat | null; conversionRate: RentStat | null }>;
  byRegionCode: Record<
    string,
    {
      label: string;
      region: string;
      deals: number;
      jeonseRatio: RentStat | null;
      conversionRate: RentStat | null;
    }
  >;
}

export const RENT = rentSnapshot as unknown as RentSnapshot;

/** 실측값이 있으면 그것을, 없으면 null. 호출부가 자리표시자로 대체합니다. */
export function measuredJeonseRatio(region: RegionId): number | null {
  return RENT.byRegion[region]?.jeonseRatio?.median ?? null;
}

export function measuredConversionRate(region: RegionId): number | null {
  return RENT.byRegion[region]?.conversionRate?.median ?? null;
}

/** 그 지역 값이 실측인지 자리표시자인지 — UI에서 배지로 구분합니다. */
export function isMeasured(region: RegionId): boolean {
  return measuredJeonseRatio(region) !== null && measuredConversionRate(region) !== null;
}

/** 시군구 단위 분해 — 같은 권역 안에서도 크게 갈립니다 */
export function districtStats(region: RegionId) {
  return Object.entries(RENT.byRegionCode)
    .filter(([, v]) => v.region === region)
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => (b.jeonseRatio?.median ?? 0) - (a.jeonseRatio?.median ?? 0));
}
