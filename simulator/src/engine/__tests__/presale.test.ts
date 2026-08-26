import { describe, expect, it } from 'vitest';
import { PRESALE, premiumPeriod, premiumRows, summarizePremium } from '../presale';

const CHANGWON = ['48121', '48123', '48125', '48127', '48129'];

describe('분양권 스냅샷', () => {
  it('비어 있지 않고 출처가 박혀 있다', () => {
    expect(PRESALE.complexes.length).toBeGreaterThan(0);
    expect(PRESALE.source.name).toContain('분양권');
    expect(PRESALE.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('금액이 원 단위로 변환돼 있다', () => {
    let min = Infinity;
    for (const c of PRESALE.complexes) {
      for (const s of c.sizes) for (const p of s.points) if (p.price < min) min = p.price;
    }
    expect(min).toBeGreaterThan(1000000);
  });
});

describe('프리미엄 — 분양권 대비 준공 후 매매가', () => {
  const rows = premiumRows();

  it('짝이 지어진 것만 나온다', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(
      PRESALE.complexes.reduce((n, c) => n + c.sizes.length, 0)
    );
  });

  it('매매는 반드시 분양권 거래 이후다 — 순서가 뒤집히면 비교가 아닙니다', () => {
    for (const r of rows) {
      expect(r.saleQ).toBeGreaterThan(r.presaleQ);
      expect(r.quarterGap).toBeGreaterThan(0);
    }
  });

  it('프리미엄은 두 가격의 차이와 정확히 맞는다', () => {
    for (const r of rows.slice(0, 50)) {
      expect(r.premium).toBeCloseTo(r.salePrice - r.presalePrice, 0);
      expect(r.premiumRatio).toBeCloseTo(r.salePrice / r.presalePrice - 1, 10);
    }
  });

  it('양 끝 거래가 얇은 건은 빠진다', () => {
    for (const r of rows) {
      expect(r.presaleDeals).toBeGreaterThanOrEqual(2);
      expect(r.saleDeals).toBeGreaterThanOrEqual(2);
    }
  });

  it('프리미엄 내림차순으로 정렬된다', () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].premiumRatio).toBeGreaterThanOrEqual(rows[i].premiumRatio);
    }
  });

  it('지역을 좁히면 그 지역 것만 남는다', () => {
    const cw = premiumRows(CHANGWON);
    expect(cw.length).toBeGreaterThan(0);
    expect(cw.length).toBeLessThan(rows.length);
    for (const r of cw) expect(r.region).toBe('changwon');
  });

  it('기간 표기가 두 시점을 담는다', () => {
    expect(premiumPeriod(rows[0])).toMatch(/^\d{4}Q\d → \d{4}Q\d$/);
  });
});

describe('프리미엄 요약', () => {
  it('분위수가 순서대로 나온다', () => {
    const s = summarizePremium(premiumRows())!;
    expect(s.p25).toBeLessThanOrEqual(s.median);
    expect(s.median).toBeLessThanOrEqual(s.p75);
    expect(s.count).toBeGreaterThan(0);
  });

  it('손실 비율은 음수 프리미엄의 비율과 같다', () => {
    const rows = premiumRows();
    const s = summarizePremium(rows)!;
    const losses = rows.filter((r) => r.premiumRatio < 0).length;
    expect(s.lossRatio).toBeCloseTo(losses / rows.length, 10);
  });

  it('표본이 없으면 null 이다', () => {
    expect(summarizePremium([])).toBeNull();
  });
});
