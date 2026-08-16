/**
 * 수집 대상 시군구와 후보군.
 *
 * 무엇을 왜 받는지(그리고 왜 안 받는지)를 코드가 아니라 데이터로 둡니다.
 * 후보 분류의 근거인 `medianPrice` 는 전용 70~100㎡ 최근 3개월 실거래 중위가입니다.
 *
 * 법정동코드는 행정구역 개편으로 바뀝니다. 화성시 41590 은 폐지되고 동탄·병점·
 * 만세·효행으로 갈렸고, 26260 을 수영구로 적어 뒀다가 실제로는 동래구였던 적도
 * 있습니다. 라벨은 API 의 `estateAgentSggNm` 로 대조해서 넣었습니다.
 */

import regionsData from '../data/regions.json';
import type { RegionId } from './types';

export type RegionTier = 'core' | 'candidate' | 'stretch' | 'out-of-budget';

export interface DistrictEntry {
  code: string;
  label: string;
  region: RegionId;
  collect: boolean;
  tier: RegionTier;
  /** 전용 70~100㎡ 최근 3개월 실거래 중위가 (원) */
  medianPrice: number;
  reason: string;
}

interface RawRegions {
  note: string;
  asOf: string;
  affordability: {
    note: string;
    comfortable: number;
    comfortableNote: string;
    ceiling: number;
    ceilingNote: string;
  };
  tiers: Record<RegionTier, string>;
  regions: DistrictEntry[];
}

const raw = regionsData as unknown as RawRegions;

export const DISTRICTS: DistrictEntry[] = raw.regions;
export const DISTRICT_TIERS = raw.tiers;
export const AFFORDABILITY_LINES = raw.affordability;
export const DISTRICTS_AS_OF = raw.asOf;

export const collectedDistricts = (): DistrictEntry[] => DISTRICTS.filter((d) => d.collect);

export function districtsByTier(tier: RegionTier): DistrictEntry[] {
  return DISTRICTS.filter((d) => d.tier === tier).sort((a, b) => a.medianPrice - b.medianPrice);
}

/** '부산 해운대구' / '경기 평택시' 처럼 붙은 시도 접두어와 공백을 떼어 냅니다. */
function normalize(name: string): string {
  return name.replace(/\s+/g, '').replace(/^(부산|경기|경남|서울|인천)/, '');
}

/**
 * 물건의 시군구 문자열로 법정동코드를 찾습니다.
 *
 * 사용자가 '창원시 성산구' 라고 쓸 수도, '성산구' 라고만 쓸 수도 있어 양방향 부분일치로
 * 봅니다. 못 찾으면 null 이고, 호출부는 권역 단위 값으로 물러섭니다.
 */
export function findDistrict(sigungu: string): DistrictEntry | null {
  const q = normalize(sigungu ?? '');
  if (q.length < 2) return null;

  let best: DistrictEntry | null = null;
  for (const d of DISTRICTS) {
    const label = normalize(d.label);
    if (label === q) return d;
    if (label.includes(q) || q.includes(label)) {
      // 더 긴 라벨이 더 구체적입니다 ('창원시성산구' > '성산구')
      if (!best || normalize(best.label).length < label.length) best = d;
    }
  }
  return best;
}
