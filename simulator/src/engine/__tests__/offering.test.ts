import { describe, expect, it } from 'vitest';
import { OFFERING_CAVEATS, appraiseOffering, type OfferingInput } from '../offering';

const base: OfferingInput = {
  region: 'changwon',
  sigungu: '창원시 성산구',
  umd: '가음동',
  price: 500000000,
  areaSqm: 84.9,
  waitYears: 2.5,
};

describe('공고 안전마진', () => {
  it('네 기준을 모두 냅니다', () => {
    const a = appraiseOffering(base)!;
    expect(a.benchmarks.map((b) => b.id)).toEqual([
      'nearby',
      'newBuildFloor',
      'atMoveIn',
      'presale',
    ]);
  });

  it('부호 약속이 지켜집니다 — 양수면 분양가가 싸다', () => {
    const cheap = appraiseOffering({ ...base, price: 200000000 })!;
    const dear = appraiseOffering({ ...base, price: 1500000000 })!;
    for (const b of cheap.benchmarks) if (b.margin !== null) expect(b.margin).toBeGreaterThan(0);
    for (const b of dear.benchmarks) if (b.margin !== null) expect(b.margin).toBeLessThan(0);
  });

  it('마진은 (기준가 − 분양가) ÷ 기준가 입니다', () => {
    const a = appraiseOffering(base)!;
    for (const b of a.benchmarks) {
      if (b.value === null || b.margin === null) continue;
      expect(b.margin).toBeCloseTo((b.value - base.price) / b.value, 10);
    }
  });

  it('분양가가 오르면 모든 마진이 줄어듭니다', () => {
    const lo = appraiseOffering({ ...base, price: 400000000 })!;
    const hi = appraiseOffering({ ...base, price: 600000000 })!;
    for (let i = 0; i < lo.benchmarks.length; i++) {
      const a = lo.benchmarks[i].margin;
      const b = hi.benchmarks[i].margin;
      if (a === null || b === null) continue;
      expect(b).toBeLessThan(a);
    }
  });

  it('입주가 멀수록 예상가가 높아집니다 — 상승률이 양수인 지역에서', () => {
    const near = appraiseOffering({ ...base, region: 'gyeonggi', sigungu: '경기 평택시', umd: undefined, waitYears: 1 })!;
    const far = appraiseOffering({ ...base, region: 'gyeonggi', sigungu: '경기 평택시', umd: undefined, waitYears: 5 })!;
    const n = near.benchmarks.find((b) => b.id === 'atMoveIn')!;
    const f = far.benchmarks.find((b) => b.id === 'atMoveIn')!;
    if (n.value !== null && f.value !== null) expect(f.value).toBeGreaterThan(n.value);
  });

  it('입주 시점 예상가에는 분포 범위가 붙습니다 — 단일값만 내면 예측이 됩니다', () => {
    const b = appraiseOffering(base)!.benchmarks.find((x) => x.id === 'atMoveIn')!;
    if (b.value !== null) {
      expect(b.low).toBeDefined();
      expect(b.high).toBeDefined();
      expect(b.low!).toBeLessThanOrEqual(b.high!);
    }
  });

  it('기준끼리 어긋나면 표시합니다', () => {
    const a = appraiseOffering(base)!;
    const pos = a.benchmarks.filter((b) => (b.margin ?? 0) > 0.02).length;
    const neg = a.benchmarks.filter((b) => (b.margin ?? 0) < -0.02).length;
    expect(a.conflicted).toBe(pos > 0 && neg > 0);
  });

  it('표본이 얇으면 얇다고 적습니다', () => {
    const a = appraiseOffering({ ...base, areaSqm: 200 })!;
    const nearby = a.benchmarks.find((b) => b.id === 'nearby')!;
    expect(nearby.thin || nearby.n === 0).toBe(true);
  });

  it('가격이나 면적이 없으면 null 입니다', () => {
    expect(appraiseOffering({ ...base, price: 0 })).toBeNull();
    expect(appraiseOffering({ ...base, areaSqm: 0 })).toBeNull();
  });

  it('점수로 합치지 않는다는 것을 단서로 들고 다닙니다', () => {
    expect(OFFERING_CAVEATS.some((c) => c.includes('합치지'))).toBe(true);
    expect(OFFERING_CAVEATS.some((c) => c.includes('당첨'))).toBe(true);
  });

  it('실제 값이 나오는지 — 창원 성산구 5억 84㎡', () => {
    const a = appraiseOffering(base)!;
    for (const b of a.benchmarks) {
      console.log(
        `  ${b.label.padEnd(12)} ${b.value ? (b.value / 1e8).toFixed(2) + '억' : '—'}` +
          `  마진 ${b.margin !== null ? (b.margin * 100).toFixed(1) + '%' : '—'}` +
          `  n=${b.n}${b.thin ? ' (얇음)' : ''}`
      );
    }
    expect(a.benchmarks.filter((b) => b.value !== null).length).toBeGreaterThanOrEqual(2);
  });
});
