import { describe, expect, it } from 'vitest';
import { POPULATION, POPULATION_CAVEATS, populationFeedback, populationScale5, regionPopulation } from '../population';
import type { RegionId } from '../types';

const REGIONS: RegionId[] = ['changwon', 'busan', 'gyeonggi'];

describe('권역 인구 추세 실측', () => {
  it('세 권역 모두 값이 있습니다', () => {
    for (const r of REGIONS) expect(regionPopulation(r)).not.toBeNull();
  });

  it('창원은 경남, 부산은 부산, 경기는 경기에 붙습니다', () => {
    expect(regionPopulation('changwon')!.label).toBe('경남');
    expect(regionPopulation('busan')!.label).toBe('부산');
    expect(regionPopulation('gyeonggi')!.label).toBe('경기');
  });

  it('시계열이 표기 변화(경남↔경상남도)로 끊기지 않았습니다', () => {
    for (const r of REGIONS) {
      const s = regionPopulation(r)!;
      // 2008~2024 를 다 이었으면 15년 이상이어야 합니다.
      expect(s.to - s.from).toBeGreaterThanOrEqual(15);
      const years = s.byYear.map(([y]) => y);
      expect(years).toEqual([...years].sort((a, b) => a - b));
      expect(new Set(years).size).toBe(years.length);
    }
  });

  it('초과분은 전국 대비로 정확히 계산됩니다', () => {
    for (const r of REGIONS) {
      const s = regionPopulation(r)!;
      expect(s.excess10).toBeCloseTo(s.cagr10 - POPULATION.national.cagr10, 5);
    }
  });

  it('경기는 늘고 부산·경남은 줍니다 — 실측이 방향을 가릅니다', () => {
    expect(regionPopulation('gyeonggi')!.cagr10).toBeGreaterThan(0);
    expect(regionPopulation('busan')!.cagr10).toBeLessThan(0);
    expect(regionPopulation('changwon')!.cagr10).toBeLessThan(0);
  });

  it('부산이 창원(경남)보다 빠르게 줍니다 — 가중치 배분과 어긋나는 신호입니다', () => {
    expect(regionPopulation('busan')!.cagr10).toBeLessThan(regionPopulation('changwon')!.cagr10);
  });

  it('단계 환산은 1~5 이고 초과분이 클수록 높습니다', () => {
    expect(populationScale5(0.02)).toBe(5);
    expect(populationScale5(-0.02)).toBe(1);
    const xs = [-0.02, -0.008, -0.004, 0, 0.005, 0.02].map(populationScale5);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
  });

  it('경기는 높은 단계, 부산은 낮은 단계가 나옵니다', () => {
    expect(populationFeedback('gyeonggi')!.suggested).toBeGreaterThan(
      populationFeedback('busan')!.suggested
    );
  });

  it('시도 단위라는 한계를 문장으로 들고 다닙니다', () => {
    expect(POPULATION.granularity).toBe('시도');
    expect(POPULATION_CAVEATS.some((c) => c.includes('시군구'))).toBe(true);
  });
});
