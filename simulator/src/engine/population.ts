/**
 * 권역 인구 추세 실측 — `populationTrend` 주관 입력 옆에 놓는 신호.
 *
 * 창원 가중치가 **10** 으로 입지 지표 중 가장 높은데 지금까지 근거가
 * 없었습니다. 이제 실측이 옆에 섭니다.
 *
 * ## 시도 단위라는 한계가 결정적입니다
 *
 * 원 자료가 시도(경남·부산·경기)까지만 내려갑니다. 그래서 **같은 권역 안
 * 시군구는 전부 같은 값**을 받습니다 — 창원 성산구와 마산회원구가 구별되지
 * 않습니다. `futureSupply` 가 시군구별로 갈리는 것과 대비됩니다.
 *
 * 그래도 값어치가 있는 이유는 이 도구의 대상이 정확히 그 세 권역이고,
 * **권역 선택이 곧 대출 조건 선택**이라는 이 도구의 축과 같은 층위이기
 * 때문입니다. 물건을 고르는 데는 못 쓰고 권역을 고르는 데 씁니다.
 *
 * ## 전국 대비로 봅니다
 *
 * 전국이 함께 줄면 그건 그 지역의 문제가 아니라 인구 구조의 문제입니다.
 * 절대 증감률만 보면 모든 지역이 나쁘게 나와 변별이 사라지므로,
 * **전국 대비 초과분**을 같이 냅니다. 지역 수익률을 초과수익으로 바꿔
 * 보는 것과 같은 이유입니다.
 */

import data from '../data/population.json';
import type { RegionId } from './types';

export interface RegionPopulation {
  label: string;
  from: number;
  to: number;
  population: number;
  households: number;
  /** 전체 구간 복리 연증감률 */
  cagrAll: number;
  /** 최근 10년 복리 연증감률 — 판단에는 이쪽을 씁니다 */
  cagr10: number;
  /** 최근 10년 전국 대비 초과분 (%p) */
  excess10: number;
  byYear: [number, number][];
}

interface PopulationData {
  note: string;
  source: string;
  granularity: string;
  asOf: string;
  national: Omit<RegionPopulation, 'label' | 'excess10'>;
  regions: Record<RegionId, RegionPopulation>;
}

export const POPULATION = data as unknown as PopulationData;

export function regionPopulation(region: RegionId): RegionPopulation | null {
  return POPULATION.regions[region] ?? null;
}

/**
 * 실측을 1~5단계 점수로 환산합니다.
 *
 * `populationTrend` 는 `scale5` 지표라 주관 입력과 같은 자에 놓으려면
 * 단계로 바꿔야 합니다. 구간은 **전국 대비 초과분** 기준입니다 —
 * 절대 증감률로 자르면 전국이 감소세인 지금 모든 지역이 1~2단계로
 * 뭉개져 변별이 사라집니다.
 */
export function populationScale5(excess10: number): number {
  if (excess10 >= 0.008) return 5;
  if (excess10 >= 0.003) return 4;
  if (excess10 >= -0.002) return 3;
  if (excess10 >= -0.006) return 2;
  return 1;
}

export interface PopulationFeedback {
  region: RegionId;
  stat: RegionPopulation;
  nationalCagr10: number;
  suggested: number;
  /** 같은 권역 안 시군구가 전부 같은 값을 받는다는 사실 */
  sharedAcrossDistricts: boolean;
}

export function populationFeedback(region: RegionId): PopulationFeedback | null {
  const stat = regionPopulation(region);
  if (!stat) return null;
  return {
    region,
    stat,
    nationalCagr10: POPULATION.national.cagr10,
    suggested: populationScale5(stat.excess10),
    sharedAcrossDistricts: true,
  };
}

export const POPULATION_CAVEATS = [
  '시도 단위입니다 — 같은 권역 안 시군구는 전부 같은 값을 받습니다. 창원 성산구와 마산회원구를 가르지 못합니다.',
  '주민등록 인구라 실거주와 다릅니다. 외국인은 빠져 있습니다.',
  '전국이 함께 줄면 그 지역만의 문제가 아니므로 전국 대비 초과분으로 단계를 냅니다.',
  '과거 추세일 뿐 앞으로도 그렇다는 뜻이 아닙니다.',
];
