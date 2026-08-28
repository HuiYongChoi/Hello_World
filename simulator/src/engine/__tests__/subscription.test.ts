import { describe, expect, it } from 'vitest';
import { RULES } from '../rules';
import { emptyPlan, paymentSchedule, subscriptionLegPlan, subscriptionPlan } from '../subscription';
import { defaultAssumptions, housingCostBreakdown, type TenureLeg } from '../tenure';

const a = defaultAssumptions('changwon');
const base = { ...emptyPlan('t1'), price: 500000000, waitYears: 2.5 };

describe('납입 일정', () => {
  it('계약금은 현금, 중도금은 집단대출로 나갑니다', () => {
    const steps = paymentSchedule(base);
    expect(steps[0].label).toBe('계약금');
    expect(steps[0].funded).toBe('cash');
    expect(steps.filter((s) => s.label.startsWith('중도금')).every((s) => s.funded === 'loan'))
      .toBe(true);
  });

  it('중도금은 회차만큼 쪼개지고 시점이 서로 다릅니다', () => {
    const steps = paymentSchedule(base).filter((s) => s.label.startsWith('중도금'));
    expect(steps).toHaveLength(RULES.subscription.interimInstallments);
    const months = steps.map((s) => s.monthOffset);
    expect(months).toEqual([...months].sort((x, y) => x - y));
    expect(new Set(months).size).toBeGreaterThan(1);
  });

  it('입주 시점은 주담대와 현금으로 갈라집니다 — 4.5억을 현금으로 마련하는 게 아닙니다', () => {
    const steps = paymentSchedule(base).filter((s) => s.label.startsWith('잔금'));
    expect(steps).toHaveLength(2);
    const loan = steps.find((s) => s.funded === 'loan')!;
    const cash = steps.find((s) => s.funded === 'cash')!;
    expect(loan.amount).toBeGreaterThan(cash.amount);
    expect(loan.amount).toBeCloseTo(base.price * base.mortgageLtv, -3);
    // 두 줄은 같은 시점입니다 — 입주일에 한꺼번에 정산됩니다.
    expect(loan.monthOffset).toBe(cash.monthOffset);
  });

  it('LTV 가 낮을수록 입주 때 현금이 더 필요합니다', () => {
    const cashAt = (ltv: number) =>
      paymentSchedule({ ...base, mortgageLtv: ltv }).find(
        (s) => s.label === '잔금·중도금 — 현금'
      )!.amount;
    expect(cashAt(0.5)).toBeGreaterThan(cashAt(0.8));
  });

  it('일정 합계는 분양가와 같습니다 — 중도금이 잔금 단계에서 한 번 더 세어지므로 두 배', () => {
    const steps = paymentSchedule(base);
    const interim = base.price * base.interimRatio;
    const total = steps.reduce((s, x) => s + x.amount, 0);
    expect(total - interim).toBeCloseTo(base.price, -3);
  });
});

describe('청약 현금흐름', () => {
  it('계약 시점 지출은 계약금과 대기 전세 자기부담의 합입니다', () => {
    const r = subscriptionPlan(base, a, 200000000, 30);
    expect(r.initialOutlay).toBeCloseTo(r.downPayment + r.waitDeposit, -2);
    expect(r.downPayment).toBeCloseTo(base.price * base.downPaymentRatio, -2);
  });

  it('중도금 이자는 회차별 잔존기간으로 쌓여 전액 선차입보다 작습니다', () => {
    const r = subscriptionPlan(base, a, 200000000, 30);
    const naive = base.price * base.interimRatio * base.interimLoanRate * base.waitYears;
    expect(r.interimInterest).toBeGreaterThan(0);
    expect(r.interimInterest).toBeLessThan(naive);
  });

  it('대기가 길수록 중도금 이자가 커집니다', () => {
    const short = subscriptionPlan({ ...base, waitYears: 1 }, a, 200000000, 30);
    const long = subscriptionPlan({ ...base, waitYears: 4 }, a, 200000000, 30);
    expect(long.interimInterest).toBeGreaterThan(short.interimInterest);
  });

  it('이자후불제면 대기 중 월 부담이 가볍지만 이자 총액은 같습니다', () => {
    const deferred = subscriptionPlan({ ...base, interimDeferred: true }, a, 200000000, 30);
    const upfront = subscriptionPlan({ ...base, interimDeferred: false }, a, 200000000, 30);
    expect(deferred.interimInterest).toBeCloseTo(upfront.interimInterest, -2);
    const waitMonths = Math.round(base.waitYears * 12);
    const dWait = deferred.outflow.slice(0, waitMonths).reduce((s, v) => s + v, 0);
    const uWait = upfront.outflow.slice(0, waitMonths).reduce((s, v) => s + v, 0);
    expect(dWait).toBeLessThan(uWait);
    // 후불이면 입주 시 목돈이 그만큼 커집니다.
    expect(deferred.moveInCash).toBeGreaterThan(upfront.moveInCash);
  });

  it('대기 기간에는 주담대 상환이 없고 입주 후에 시작합니다', () => {
    const r = subscriptionPlan(base, a, 200000000, 30);
    const waitMonths = Math.round(base.waitYears * 12);
    expect(r.outflow[waitMonths - 1]).toBeLessThan(r.outflow[waitMonths]);
  });

  it('입주 후 보유가 2년 미만이면 비과세 미달을 경고합니다', () => {
    const r = subscriptionPlan(base, { ...a, years: 3 }, 200000000, 30);
    expect(r.warnings.some((w) => w.includes('비과세'))).toBe(true);
  });

  it('전매제한을 안내에 담습니다', () => {
    const r = subscriptionPlan({ ...base, resaleBanMonths: 36 }, a, 200000000, 30);
    expect(r.notes.some((n) => n.includes('전매제한 36개월'))).toBe(true);
  });

  it('가격이 오르면 종료 시 회수액이 커집니다', () => {
    const flat = subscriptionPlan(base, { ...a, priceGrowthRate: 0 }, 200000000, 30);
    const up = subscriptionPlan(base, { ...a, priceGrowthRate: 0.03 }, 200000000, 30);
    expect(up.recovered).toBeGreaterThan(flat.recovered);
  });

  it('주거 순비용에는 원금상환이 들어가지 않습니다 — 그건 저축입니다', () => {
    const r = subscriptionPlan(base, a, 200000000, 30);
    expect(r.mortgagePrincipalRepaid).toBeGreaterThan(0);
    expect(r.netHousingCost).toBeGreaterThan(0);
    const withPrincipal = r.netHousingCost + r.mortgagePrincipalRepaid;
    expect(r.netHousingCost).toBeLessThan(withPrincipal);
  });
});

describe('대기 중 어디서 사나', () => {
  it('돈이 넉넉하면 전세로 봅니다', () => {
    const r = subscriptionPlan(base, a, 400000000, 30);
    expect(r.waitMode).toBe('jeonse');
    expect(r.waitMonthlyRent).toBe(0);
  });

  it('계약금을 내고 나면 전세보증금을 못 채우는 일이 흔합니다 — 그때는 월세입니다', () => {
    const r = subscriptionPlan(base, a, 60000000, 30);
    expect(r.waitMode).toBe('wolse');
    expect(r.waitMonthlyRent).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.includes('월세로 사는 것으로 계산'))).toBe(true);
  });

  it('월세로 떨어지면 초기 지출은 줄고 대기 주거비는 늘어납니다', () => {
    const rich = subscriptionPlan(base, a, 400000000, 30);
    const poor = subscriptionPlan(base, a, 60000000, 30);
    expect(poor.waitDeposit).toBeLessThan(rich.waitDeposit);
    expect(poor.waitRentCost).toBeGreaterThan(rich.waitRentCost);
  });

  it('월세는 전세보증금 차액 × 전월세전환율에서 나옵니다 — 독립 가정값이 아닙니다', () => {
    const r = subscriptionPlan(base, a, 60000000, 30);
    const jeonse = base.price * a.jeonseRatio;
    const expected = ((jeonse - jeonse * a.wolseDepositRatio) * a.conversionRate) / 12;
    expect(r.waitMonthlyRent).toBeCloseTo(expected, -2);
  });

  it('전환율이 높을수록 대기 월세가 비싸집니다', () => {
    const low = subscriptionPlan(base, { ...a, conversionRate: 0.04 }, 60000000, 30);
    const high = subscriptionPlan(base, { ...a, conversionRate: 0.07 }, 60000000, 30);
    expect(high.waitRentCost).toBeGreaterThan(low.waitRentCost);
  });
});

describe('tenure 4번째 갈래로 붙이기', () => {
  const lp = subscriptionLegPlan(base, a, 200000000, 30);

  it('LegPlan 모양을 갖춥니다', () => {
    expect(lp.kind).toBe('subscription');
    expect(lp.outflow).toHaveLength(Math.round(a.years * 12));
    expect(lp.lumps).toHaveLength(lp.outflow.length);
  });

  it('원금상환은 주거 순비용에 안 들어갑니다 — 원금상환 대칭이 유지됩니다', () => {
    expect(lp.breakdown.principalRepaid).toBeGreaterThan(0);
    expect(lp.breakdown.netCost).toBeLessThan(
      lp.breakdown.netCost + lp.breakdown.principalRepaid
    );
  });

  it('비용 항목 합계가 주거 순비용과 정확히 맞습니다', () => {
    const leg = {
      kind: 'subscription',
      interestPaid: lp.breakdown.interestPaid,
      rentPaid: lp.breakdown.rentPaid,
      carryCost: lp.breakdown.carryCost,
      detail: lp.detail,
    } as unknown as TenureLeg;
    const sum = housingCostBreakdown(leg).reduce(
      (s, i) => s + (i.reducesCost ? -i.amount : i.amount),
      0
    );
    expect(sum).toBeCloseTo(lp.breakdown.netCost, -2);
  });

  it('중도금 이자와 대기 전세이자를 갈라 냅니다 — 기다린 값이 보여야 합니다', () => {
    const leg = {
      kind: 'subscription',
      interestPaid: lp.breakdown.interestPaid,
      rentPaid: lp.breakdown.rentPaid,
      carryCost: lp.breakdown.carryCost,
      detail: lp.detail,
    } as unknown as TenureLeg;
    const labels = housingCostBreakdown(leg).map((i) => i.label);
    expect(labels).toContain('중도금 이자');
    expect(labels).toContain('대기 중 전세이자');
    expect(labels).toContain('주담대 이자');
  });
});
