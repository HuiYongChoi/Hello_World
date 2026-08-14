import { describe, expect, it } from 'vitest';
import { acquisitionTaxRate, brokerageFee, calcCosts } from '../costs';

describe('취득세율', () => {
  it('6억 이하 1%', () => {
    expect(acquisitionTaxRate(500000000)).toBeCloseTo(0.01, 6);
  });

  it('6~9억 구간은 누진 산식', () => {
    // 7.5억 → (7.5×2/3 − 3)/100 = 2%
    expect(acquisitionTaxRate(750000000)).toBeCloseTo(0.02, 6);
    // 구간 경계 연속성
    expect(acquisitionTaxRate(600000000)).toBeCloseTo(0.01, 6);
    expect(acquisitionTaxRate(900000000)).toBeCloseTo(0.03, 6);
  });

  it('9억 초과 3%', () => {
    expect(acquisitionTaxRate(1000000000)).toBeCloseTo(0.03, 6);
  });
});

describe('중개보수', () => {
  it('2~9억 구간은 0.4% + VAT', () => {
    expect(brokerageFee(380000000)).toBeCloseTo(380000000 * 0.004 * 1.1, 2);
  });

  it('5천~2억 구간은 한도 80만원이 걸린다', () => {
    expect(brokerageFee(190000000)).toBeCloseTo(800000 * 1.1, 2);
  });
});

describe('부대비용 합계', () => {
  const input = { price: 380000000, areaSqm: 84.9, movingAndRepair: 3000000 };

  it('생애최초 감면 200만원이 적용된다', () => {
    const withRelief = calcCosts({ ...input, isFirstTimeValid: true });
    const without = calcCosts({ ...input, isFirstTimeValid: false });
    expect(withRelief.acquisitionTaxRelief).toBe(2000000);
    expect(without.acquisitionTaxRelief).toBe(0);
    expect(without.total - withRelief.total).toBe(2000000);
  });

  it('전용 85㎡ 초과 시 농특세가 붙는다', () => {
    const small = calcCosts({ ...input, isFirstTimeValid: true });
    const large = calcCosts({ ...input, areaSqm: 101, isFirstTimeValid: true });
    expect(small.ruralTax).toBe(0);
    expect(large.ruralTax).toBeCloseTo(380000000 * 0.002, 2);
  });

  it('합계는 각 항목의 합과 일치한다', () => {
    const c = calcCosts({ ...input, isFirstTimeValid: true });
    const sum =
      c.acquisitionTax -
      c.acquisitionTaxRelief +
      c.localEducationTax +
      c.ruralTax +
      c.brokerage +
      c.legalAndBond +
      c.movingAndRepair;
    expect(c.total).toBe(Math.round(sum));
  });
});
