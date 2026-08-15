import { describe, expect, it } from 'vitest';
import { calcLoan } from '../loan';
import { getProduct, RULES } from '../rules';
import { ALL_SCENARIO_AXES, deriveScenario } from '../scenario';
import {
  compareTenures,
  defaultAssumptions,
  loanBalance,
  type TenureAssumptions,
  type TenureComparison,
  type TenureKind,
} from '../tenure';
import { baseProfile, makeProperty } from './fixtures';

const axis = (id: string) => ALL_SCENARIO_AXES.find((a) => a.id === id)!;
const scenario = deriveScenario(baseProfile, axis('before-sole'));
const property = makeProperty();
const loan = calcLoan(getProduct('bogeumjari_first'), baseProfile, scenario, property);

const EQUITY = 180000000;

function compare(
  over: Partial<TenureAssumptions> = {},
  termYears = 30,
  equity = EQUITY
): TenureComparison {
  return compareTenures({
    property,
    loan,
    equity,
    termYears,
    assumptions: defaultAssumptions(property.region, over),
  })!;
}

const leg = (c: TenureComparison, kind: TenureKind) => c.legs.find((l) => l.kind === kind)!;

describe('대출잔액', () => {
  it('만기까지 상환하면 잔액이 0이다', () => {
    expect(loanBalance(300000000, 0.048, loan.monthlyPayment, 360)).toBeLessThan(1);
  });

  it('중도 시점 잔액은 원금보다 작고 0보다 크다', () => {
    const b = loanBalance(loan.limit, loan.rate, loan.monthlyPayment, 120);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(loan.limit);
  });

  it('초기에는 원금이 거의 줄지 않는다 — 이자가 앞에 몰려 있다', () => {
    const after1y = loan.limit - loanBalance(loan.limit, loan.rate, loan.monthlyPayment, 12);
    expect(after1y).toBeLessThan(loan.monthlyPayment * 12 * 0.35);
  });
});

describe('회계 항등식 — 돈이 새지 않는다', () => {
  it('수익률 0이면 종료자산 = 회수액 + (자기자본 − 초기투입) + 순적립', () => {
    const c = compare({ stockReturnRate: 0 });
    for (const l of c.legs) {
      expect(l.terminalWealth).toBeCloseTo(
        l.terminalNonStock + EQUITY - l.initialOutlay + l.netContribution,
        0
      );
    }
  });

  it('세 갈래 모두 같은 자기자본에서 출발한다', () => {
    const c = compare();
    for (const l of c.legs) {
      expect(l.initialStock).toBeCloseTo(EQUITY - l.initialOutlay, 6);
    }
  });
});

describe('원금상환 대칭 — 가장 빠뜨리기 쉬운 항목', () => {
  it('임차는 매수의 월지출 차액만큼 적립투자한다', () => {
    const c = compare();
    expect(leg(c, 'wolse').netContribution).toBeGreaterThan(0);
    expect(leg(c, 'jeonse').netContribution).toBeGreaterThan(0);
    // 전세는 월세보다 월 지출이 적으니 더 많이 적립한다
    expect(leg(c, 'jeonse').netContribution).toBeGreaterThan(leg(c, 'wolse').netContribution);
  });

  it('적립투자를 빼면 임차가 부당하게 불리해진다', () => {
    const c = compare();
    const a = c.assumptions;
    for (const kind of ['jeonse', 'wolse'] as const) {
      const l = leg(c, kind);
      const 대칭없음 = l.terminalNonStock + l.initialStock * Math.pow(1 + a.stockReturnRate, a.years);
      expect(l.terminalWealth).toBeGreaterThan(대칭없음);
    }
  });

  it('기준예산이 바뀌어도 임차끼리의 격차는 그대로다', () => {
    // 만기를 줄이면 매수 월상환액이 커져 기준예산이 통째로 올라간다.
    // 두 임차 갈래에 같은 금액이 더해지므로 격차는 불변이어야 한다.
    const gap = (termYears: number) => {
      const c = compare({}, termYears);
      return leg(c, 'jeonse').terminalWealth - leg(c, 'wolse').terminalWealth;
    };
    expect(gap(20)).toBeCloseTo(gap(30), 0);
  });
});

describe('전세 — 보증금이 묶이는 구조', () => {
  it('보증금만큼 주식 투입액이 줄어든다', () => {
    const c = compare();
    const j = leg(c, 'jeonse');
    const w = leg(c, 'wolse');
    expect(j.initialOutlay).toBeGreaterThan(w.initialOutlay);
    expect(j.initialStock).toBeLessThan(w.initialStock);
  });

  it('자기자본이 보증금에 못 미치면 전세자금대출이 잡히고 이자가 나간다', () => {
    const c = compare({}, 30, 100000000);
    const j = leg(c, 'jeonse');
    expect(j.detail.jeonseLoan).toBeGreaterThan(0);
    expect(j.detail.monthlyInterest).toBeGreaterThan(0);
    expect(j.housingCashOut).toBeGreaterThan(0);
  });

  it('자기자본이 넉넉하면 대출이 없어 월 주거비가 0이다', () => {
    const c = compare({}, 30, 400000000);
    expect(leg(c, 'jeonse').detail.jeonseLoan).toBe(0);
    expect(leg(c, 'jeonse').housingCashOut).toBeCloseTo(0, 6);
  });

  it('보증금은 종료 시 전세대출을 갚고 남은 만큼 회수된다', () => {
    const c = compare({}, 30, 100000000);
    const j = leg(c, 'jeonse');
    expect(j.terminalNonStock).toBeCloseTo(j.detail.depositEnd - j.detail.jeonseLoan, 6);
  });
});

describe('갱신 — 첫 갱신에만 5% 상한이 걸린다', () => {
  it('시장 상승률이 상한을 넘으면 첫 갱신만 5%로 깎인다', () => {
    // 연 10% → 2년이면 21%. 첫 갱신은 5%, 두 번째 갱신은 21%.
    const c = compare({ years: 6, depositGrowthRate: 0.1 });
    const j = leg(c, 'jeonse');
    const cap = RULES.tenure.lease.renewalCapRatio;
    expect(j.detail.renewals).toBe(2);
    expect(j.detail.depositEnd).toBeCloseTo(j.detail.deposit0 * (1 + cap) * 1.21, 0);
  });

  it('시장 상승률이 상한보다 낮으면 상한이 작동하지 않는다', () => {
    const c = compare({ years: 6, depositGrowthRate: 0.01 });
    const j = leg(c, 'jeonse');
    expect(j.detail.depositEnd).toBeCloseTo(j.detail.deposit0 * Math.pow(1.01, 4), 0);
  });
});

describe('월세 — 전세에서 파생된다', () => {
  it('월세는 전세보증금 차액에 전월세전환율을 곱한 값이다', () => {
    const c = compare();
    const w = leg(c, 'wolse');
    const a = c.assumptions;
    const 전세보증금 = property.price * a.jeonseRatio;
    expect(w.detail.deposit0).toBeCloseTo(전세보증금 * a.wolseDepositRatio, 6);
    expect(w.detail.rent0).toBeCloseTo(
      ((전세보증금 - w.detail.deposit0) * a.conversionRate) / 12,
      6
    );
  });

  it('전월세전환율은 법정 상한을 넘지 못한다', () => {
    const c = compare({ conversionRate: 0.5 });
    expect(leg(c, 'wolse').detail.conversionRate).toBe(RULES.tenure.lease.conversionRateMax);
  });

  it('월세는 갱신마다 오른다', () => {
    const c = compare({ depositGrowthRate: 0.03 });
    const w = leg(c, 'wolse');
    expect(w.detail.rentEnd).toBeGreaterThan(w.detail.rent0);
  });
});

describe('매수 — 가격상승률에만 노출된다', () => {
  it('가격이 오를수록 종료자산이 커지지만 임차는 그대로다', () => {
    const low = compare({ priceGrowthRate: 0 });
    const high = compare({ priceGrowthRate: 0.06 });

    expect(leg(high, 'buy').terminalWealth).toBeGreaterThan(leg(low, 'buy').terminalWealth);
    // 임차 갈래의 회수액은 집값과 무관하다
    expect(leg(high, 'jeonse').terminalNonStock).toBeCloseTo(
      leg(low, 'jeonse').terminalNonStock,
      6
    );
    expect(leg(high, 'wolse').terminalNonStock).toBeCloseTo(leg(low, 'wolse').terminalNonStock, 6);
  });

  it('보유세와 수선비가 매수 쪽 월지출에 실린다', () => {
    const c = compare();
    const b = leg(c, 'buy');
    expect(b.detail.firstYearHoldingCost).toBeGreaterThan(0);
    expect(b.housingCashOut).toBeGreaterThan(b.detail.monthlyPayment * c.years * 12);
  });

  it('매도 시 중개보수가 회수액에서 빠진다', () => {
    const c = compare();
    const b = leg(c, 'buy');
    expect(b.detail.sellingFee).toBeGreaterThan(0);
    expect(b.terminalNonStock).toBeCloseTo(
      b.detail.endPrice - b.detail.remainingLoan - b.detail.sellingFee - b.detail.capitalGainsTax,
      6
    );
  });

  it('3.8억 물건은 12억 비과세 한도 안이라 양도세가 0이다', () => {
    expect(leg(compare(), 'buy').detail.capitalGainsTax).toBe(0);
  });
});

describe('손익분기 가격상승률', () => {
  it('손익분기 상승률에서는 매수와 최선의 임차안이 같아진다', () => {
    const c = compare();
    const g = c.breakEvenPriceGrowth!;
    expect(g).not.toBeNull();

    const at = compare({ priceGrowthRate: g });
    const buy = leg(at, 'buy').terminalWealth;
    const rent = Math.max(
      leg(at, 'jeonse').terminalWealth,
      leg(at, 'wolse').terminalWealth
    );
    expect(buy - rent).toBeCloseTo(0, 0);
  });

  it('손익분기 위아래에서 승자가 뒤집힌다', () => {
    const g = compare().breakEvenPriceGrowth!;
    expect(compare({ priceGrowthRate: g - 0.02 }).best).not.toBe('buy');
    expect(compare({ priceGrowthRate: g + 0.02 }).best).toBe('buy');
  });
});

describe('부정적 결과를 숨기지 않는다', () => {
  it('자기자본이 부족하면 부족액을 그대로 드러낸다', () => {
    const c = compare({}, 30, 20000000);
    const b = leg(c, 'buy');
    expect(b.feasible).toBe(false);
    expect(b.shortfall).toBeGreaterThan(0);
    expect(b.shortfall).toBeCloseTo(b.initialOutlay - 20000000, 6);
    expect(b.initialStock).toBeLessThan(0);
    expect(b.liquidityRisk).toBe(true);
  });

  it('가정값이라는 사실을 결과에 붙여 내보낸다', () => {
    const c = compare();
    expect(c.caveats.some((n) => n.includes('예측치가 아닙니다'))).toBe(true);
    expect(c.caveats.some((n) => n.includes('상환과 대칭'))).toBe(true);
  });

  it('부적격 대출은 비교 대상이 아니다', () => {
    const rejected = calcLoan(
      getProduct('didimdol_first'),
      baseProfile,
      scenario,
      makeProperty({ price: 380000000 })
    );
    expect(rejected.eligible).toBe(false);
    expect(
      compareTenures({
        property,
        loan: rejected,
        equity: EQUITY,
        termYears: 30,
        assumptions: defaultAssumptions('changwon'),
      })
    ).toBeNull();
  });
});
