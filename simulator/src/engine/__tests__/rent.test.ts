import { describe, expect, it } from 'vitest';
import {
  RENT,
  districtStats,
  isMeasured,
  measuredConversionRate,
  measuredJeonseRatio,
} from '../rent';
import { RULES } from '../rules';
import { defaultAssumptions } from '../tenure';
import type { RegionId } from '../types';

const REGIONS: RegionId[] = ['changwon', 'busan', 'gyeonggi'];

describe('전세가율·전월세전환율 실측', () => {
  it('출처와 방법이 스냅샷에 박혀 있다', () => {
    expect(RENT.source.name).toContain('전월세');
    expect(RENT.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(RENT.method.jeonseRatio).toContain('같은 단지');
    expect(RENT.stats.deals).toBeGreaterThan(0);
  });

  it('세 권역 모두 실측치가 있다', () => {
    for (const r of REGIONS) {
      expect(isMeasured(r)).toBe(true);
      expect(measuredJeonseRatio(r)).not.toBeNull();
      expect(measuredConversionRate(r)).not.toBeNull();
    }
  });

  it('전세가율은 0.3~1.0 안에 들어온다', () => {
    for (const r of REGIONS) {
      const v = measuredJeonseRatio(r)!;
      expect(v).toBeGreaterThan(0.3);
      expect(v).toBeLessThan(1.0);
    }
  });

  it('전월세전환율은 법정 상한 아래다', () => {
    for (const r of REGIONS) {
      const v = measuredConversionRate(r)!;
      expect(v).toBeGreaterThan(0.01);
      expect(v).toBeLessThan(RULES.tenure.lease.conversionRateMax);
    }
  });

  it('사분위가 순서대로이고 중위를 감싼다', () => {
    for (const r of REGIONS) {
      for (const s of [RENT.byRegion[r].jeonseRatio, RENT.byRegion[r].conversionRate]) {
        expect(s).not.toBeNull();
        expect(s!.p25).toBeLessThanOrEqual(s!.median);
        expect(s!.median).toBeLessThanOrEqual(s!.p75);
        expect(s!.n).toBeGreaterThan(0);
      }
    }
  });

  it('시군구 분해가 권역별로 나온다', () => {
    const cw = districtStats('changwon');
    expect(cw.length).toBeGreaterThan(1);
    expect(cw.every((d) => d.region === 'changwon')).toBe(true);
    // 전세가율 내림차순 정렬
    for (let i = 1; i < cw.length; i++) {
      expect(cw[i - 1].jeonseRatio!.median).toBeGreaterThanOrEqual(cw[i].jeonseRatio!.median);
    }
  });
});

describe('가정값이 실측으로 대체된다', () => {
  it('전세가율·전월세전환율은 룰셋 자리표시자가 아니라 실측치를 쓴다', () => {
    for (const r of REGIONS) {
      const a = defaultAssumptions(r);
      expect(a.jeonseRatio).toBe(measuredJeonseRatio(r));
      expect(a.conversionRate).toBe(measuredConversionRate(r));
    }
  });

  it('나머지 값은 아직 룰셋 자리표시자를 그대로 쓴다', () => {
    const d = RULES.tenure.assumptionDefaults;
    const a = defaultAssumptions('changwon');
    expect(a.investmentReturnRate).toBe(d.investmentReturnRate);
    expect(a.depositGrowthRate).toBe(d.depositGrowthRate);
    expect(a.maintenanceRate).toBe(d.maintenanceRate);
    expect(a.wolseDepositRatio).toBe(d.byRegion.changwon.wolseDepositRatio);
  });

  it('사용자 오버라이드가 실측치보다 우선한다', () => {
    const a = defaultAssumptions('changwon', { jeonseRatio: 0.5 });
    expect(a.jeonseRatio).toBe(0.5);
  });

  it('창원 전세가율이 부산보다 높다 — 권역별로 실제 갈립니다', () => {
    expect(measuredJeonseRatio('changwon')!).toBeGreaterThan(measuredJeonseRatio('busan')!);
  });
});
