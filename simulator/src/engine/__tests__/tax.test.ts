import { describe, expect, it } from 'vitest';
import { RULES } from '../rules';
import { capitalGainsTax, leaseBrokerageFee, leaseTransactionAmount, propertyTax } from '../tax';

describe('재산세', () => {
  it('공시 9억 이하는 1주택 특례세율이 적용된다', () => {
    const r = propertyTax(500000000);
    expect(r.specialRate).toBe(true);
  });

  it('공시 9억을 넘으면 표준세율로 넘어가 세부담이 뛴다', () => {
    // 공시가격비율 0.69 → 시세 14억이면 공시 9.66억
    const special = propertyTax(1200000000);
    const standard = propertyTax(1400000000);
    expect(special.specialRate).toBe(true);
    expect(standard.specialRate).toBe(false);
    expect(standard.propertyTax / standard.taxBase).toBeGreaterThan(
      special.propertyTax / special.taxBase
    );
  });

  it('과세표준은 공시가격 × 공정시장가액비율이다', () => {
    const cfg = RULES.tenure.propertyTax;
    const r = propertyTax(380000000);
    expect(r.publishedPrice).toBeCloseTo(380000000 * cfg.publishedPriceRatio, 6);
    expect(r.taxBase).toBeCloseTo(r.publishedPrice * cfg.fairMarketRatio, 6);
  });

  it('도시지역분과 지방교육세가 합계에 포함된다', () => {
    const r = propertyTax(380000000);
    expect(r.total).toBeCloseTo(r.propertyTax + r.urbanAreaTax + r.localEducationTax, 6);
    expect(r.urbanAreaTax).toBeGreaterThan(0);
  });

  it('가격이 오르면 세액도 단조 증가한다', () => {
    const prices = [200000000, 400000000, 800000000, 1600000000];
    const totals = prices.map((p) => propertyTax(p).total);
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i]).toBeGreaterThan(totals[i - 1]);
    }
  });
});

describe('양도소득세 — 1세대1주택', () => {
  const base = { buyPrice: 800000000, expenses: 20000000, holdYears: 10, liveYears: 10 };

  it('양도가액 12억 이하면 전액 비과세다', () => {
    const r = capitalGainsTax({ ...base, salePrice: 1100000000 });
    expect(r.exempt).toBe(true);
    expect(r.total).toBe(0);
  });

  it('12억을 넘으면 초과분만 안분해서 과세한다', () => {
    const salePrice = 1600000000;
    const r = capitalGainsTax({ ...base, salePrice });
    expect(r.exempt).toBe(false);
    // 과세대상 양도차익 = 양도차익 × (양도가액−12억)/양도가액
    expect(r.taxableGain).toBeCloseTo((r.gain * (salePrice - 1200000000)) / salePrice, 6);
    expect(r.taxableGain).toBeLessThan(r.gain);
    expect(r.total).toBeGreaterThan(0);
  });

  it('보유가 길수록 장기보유특별공제가 커져 세액이 줄어든다', () => {
    const short = capitalGainsTax({ ...base, salePrice: 1600000000, holdYears: 4, liveYears: 4 });
    const long = capitalGainsTax({ ...base, salePrice: 1600000000, holdYears: 10, liveYears: 10 });
    expect(long.longTermDeductionRate).toBeGreaterThan(short.longTermDeductionRate);
    expect(long.total).toBeLessThan(short.total);
  });

  it('장기보유특별공제율은 보유·거주 각각 40%가 상한이다', () => {
    const r = capitalGainsTax({ ...base, salePrice: 1600000000, holdYears: 30, liveYears: 30 });
    expect(r.longTermDeductionRate).toBeCloseTo(0.8, 10);
  });

  it('보유 2년 미만은 비과세가 통째로 사라지고 단기 중과세율이 붙는다', () => {
    const justUnder = capitalGainsTax({
      ...base,
      salePrice: 1000000000,
      holdYears: 1.9,
      liveYears: 1.9,
    });
    const justOver = capitalGainsTax({
      ...base,
      salePrice: 1000000000,
      holdYears: 2.1,
      liveYears: 2.1,
    });

    // 12억 이하인데도 2년을 못 채우면 과세된다 — 이 절벽이 핵심
    expect(justOver.total).toBe(0);
    expect(justUnder.total).toBeGreaterThan(0);
    expect(justUnder.taxBase).toBeCloseTo(justUnder.gain - 2500000, 6);
  });

  it('1년 미만은 2년 미만보다 세율이 더 높다', () => {
    const y1 = capitalGainsTax({ ...base, salePrice: 1000000000, holdYears: 0.5, liveYears: 0.5 });
    const y2 = capitalGainsTax({ ...base, salePrice: 1000000000, holdYears: 1.5, liveYears: 1.5 });
    expect(y1.total).toBeGreaterThan(y2.total);
  });

  it('양도차익이 없으면 과세하지 않는다', () => {
    const r = capitalGainsTax({ ...base, salePrice: 700000000 });
    expect(r.gain).toBeLessThan(0);
    expect(r.total).toBe(0);
  });
});

describe('임대차 중개보수', () => {
  it('거래금액은 보증금 + 월세×100 이다', () => {
    expect(leaseTransactionAmount(100000000, 500000)).toBe(150000000);
  });

  it('환산액이 5천만 미만이면 월세 배수가 70으로 낮아진다', () => {
    // 보증금 1천 + 월세 30만 → 100배는 4천만(5천만 미만) → 70배 적용
    expect(leaseTransactionAmount(10000000, 300000)).toBe(31000000);
  });

  it('전세보증금 구간 요율이 매매보다 낮다', () => {
    const fee = leaseBrokerageFee(300000000, 0);
    expect(fee).toBeCloseTo(300000000 * 0.003 * 1.1, 6);
  });

  it('저가 구간은 상한액이 걸린다', () => {
    expect(leaseBrokerageFee(40000000, 0)).toBeCloseTo(200000 * 1.1, 6);
  });
});
