import { describe, expect, it } from 'vitest';
import {
  REPAIR,
  REPAIR_CAVEATS,
  medianPricePerSqm,
  repairAnchor,
  repairStat,
} from '../repair';
import type { RegionId } from '../types';

const REGIONS: RegionId[] = ['changwon', 'busan', 'gyeonggi'];

describe('장기수선충당금 실측', () => {
  it('세 권역 모두 값이 있습니다', () => {
    for (const r of REGIONS) expect(repairStat(r)).not.toBeNull();
  });

  it('사분위 순서가 맞습니다', () => {
    for (const r of REGIONS) {
      const s = repairStat(r)!;
      expect(s.p25).toBeLessThanOrEqual(s.median);
      expect(s.median).toBeLessThanOrEqual(s.p75);
      expect(s.n).toBeGreaterThan(20);
    }
  });

  it('시군구가 있으면 시군구 값을 우선합니다', () => {
    const d = repairStat('changwon', '창원시 성산구')!;
    const r = repairStat('changwon')!;
    expect(d.n).toBeLessThan(r.n);
  });

  it('없는 시군구는 권역값으로 떨어집니다', () => {
    expect(repairStat('busan', '없는구')).toEqual(REPAIR.byRegion.busan);
  });

  it('단위가 원/㎡/월 이고 상식적인 범위입니다', () => {
    expect(REPAIR.unit).toBe('원/㎡/월');
    for (const r of REGIONS) {
      const s = repairStat(r)!;
      expect(s.median).toBeGreaterThan(10);
      expect(s.median).toBeLessThan(3000);
    }
  });
});

describe('가격 대비 연 비율', () => {
  const anchor = () => repairAnchor('changwon', '창원시 성산구', 500000000, 84.9, 0.005)!;

  it('원/㎡/월 × 12 ÷ ㎡당 가격 입니다', () => {
    const a = anchor();
    expect(a.pricePerSqm).toBeCloseTo(500000000 / 84.9, 2);
    expect(a.measuredRate).toBeCloseTo((a.stat.median * 12) / a.pricePerSqm, 10);
  });

  it('실측 하한이 가정 0.5% 보다 훨씬 작습니다 — 가정이 결론을 만들고 있었습니다', () => {
    const a = anchor();
    expect(a.measuredRate).toBeLessThan(0.005);
    expect(a.ratioToAssumed).toBeGreaterThan(3);
  });

  it('비싼 물건일수록 가격 대비 비율이 낮아집니다 — 충당금은 면적당이라서', () => {
    const cheap = repairAnchor('busan', undefined, 300000000, 84.9, 0.005)!;
    const rich = repairAnchor('busan', undefined, 900000000, 84.9, 0.005)!;
    expect(rich.measuredRate).toBeLessThan(cheap.measuredRate);
  });

  it('사분위 범위가 중위값을 감쌉니다', () => {
    const a = anchor();
    expect(a.lowRate).toBeLessThanOrEqual(a.measuredRate);
    expect(a.measuredRate).toBeLessThanOrEqual(a.highRate);
  });

  it('가격이나 면적이 없으면 null 입니다', () => {
    expect(repairAnchor('busan', undefined, 0, 84.9, 0.005)).toBeNull();
    expect(repairAnchor('busan', undefined, 5e8, 0, 0.005)).toBeNull();
  });

  it('지역 ㎡당 중위가가 나옵니다', () => {
    for (const r of REGIONS) expect(medianPricePerSqm(r)).toBeGreaterThan(0);
  });

  it('하한이라는 사실을 문장으로 들고 다닙니다 — 이걸로 가정을 낮추면 안 됩니다', () => {
    expect(REPAIR_CAVEATS.some((c) => c.includes('하한'))).toBe(true);
    expect(REPAIR_CAVEATS.some((c) => c.includes('세대 내부'))).toBe(true);
  });
});
