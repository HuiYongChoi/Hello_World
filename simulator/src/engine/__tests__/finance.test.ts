import { describe, expect, it } from 'vitest';
import { money } from '../format';
import { monthlyPayment, presentValue, totalInterest } from '../finance';

describe('원리금균등상환 계산', () => {
  it('3억 / 연 4% / 30년의 월 상환액은 약 143.2만원', () => {
    const m = monthlyPayment(300000000, 0.04, 30);
    expect(m).toBeGreaterThan(1425000);
    expect(m).toBeLessThan(1435000);
  });

  it('무이자일 때는 원금을 개월수로 나눈 값', () => {
    expect(monthlyPayment(120000000, 0, 10)).toBeCloseTo(1000000, 6);
  });

  it('원금이 0 이하면 상환액도 0', () => {
    expect(monthlyPayment(0, 0.04, 30)).toBe(0);
    expect(monthlyPayment(-100, 0.04, 30)).toBe(0);
  });

  it('presentValue는 monthlyPayment의 역함수', () => {
    const principal = 264000000;
    const m = monthlyPayment(principal, 0.0345, 30);
    expect(presentValue(m, 0.0345, 30)).toBeCloseTo(principal, 2);
  });

  it('총이자 = 총납입 − 원금', () => {
    const principal = 200000000;
    const rate = 0.03;
    const years = 30;
    const expected = monthlyPayment(principal, rate, years) * 360 - principal;
    expect(totalInterest(principal, rate, years)).toBeCloseTo(expected, 6);
  });
});

describe('금액 표기', () => {
  it('부동소수점 먼지를 "-0원"으로 찍지 않는다', () => {
    expect(money(-0)).toBe('0원');
    expect(money(-1e-9)).toBe('0원');
    expect(money(0.4)).toBe('0원');
  });

  it('1원 이상은 그대로 표기하고 음수 부호를 유지한다', () => {
    expect(money(1)).toBe('1원');
    expect(money(-5000)).toBe('-5,000원');
    expect(money(-50000)).toContain('만');
    expect(money(-50000).startsWith('-')).toBe(true);
  });
});
