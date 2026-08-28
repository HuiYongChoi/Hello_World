import { describe, expect, it } from 'vitest';
import { calcLoan } from '../loan';
import { getProduct, RULES } from '../rules';
import { ALL_SCENARIO_AXES, deriveScenario } from '../scenario';
import {
  compareAcrossReturns,
  compareTenures,
  defaultAssumptions,
  housingCostBreakdown,
  loanBalance,
  type TenureAssumptions,
  type TenureComparison,
  type TenureKind,
} from '../tenure';
import { emptyPlan, subscriptionLegPlan } from '../subscription';
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
    const c = compare({ investmentReturnRate: 0 });
    for (const l of c.legs) {
      expect(l.terminalWealth).toBeCloseTo(
        l.recovered + EQUITY - l.initialOutlay + l.netContribution,
        0
      );
    }
  });

  it('세 갈래 모두 같은 자기자본에서 출발한다', () => {
    const c = compare();
    for (const l of c.legs) {
      expect(l.initialInvestment).toBeCloseTo(EQUITY - l.initialOutlay, 6);
    }
  });
});

describe('자금 흐름 — 목돈과 매달이 갈라진다', () => {
  it('투자 원금은 남긴 목돈 + 매달 적립액이다', () => {
    for (const l of compare().legs) {
      expect(l.investedPrincipal).toBeCloseTo(l.initialInvestment + l.netContribution, 6);
      expect(l.investmentGain).toBeCloseTo(l.investmentEnd - l.investedPrincipal, 6);
    }
  });

  it('전세는 목돈을 보증금이 다 가져가도 매달 적립이 쌓여 잔고가 0이 아니다', () => {
    const j = leg(compare({}, 30, 273000000), 'jeonse');
    expect(j.initialInvestment).toBeCloseTo(0, -4); // 목돈은 거의 안 남는다
    expect(j.netContribution).toBeGreaterThan(0); // 그래도 매달 쌓인다
    expect(j.investmentEnd).toBeGreaterThan(j.netContribution); // 수익까지 붙는다
  });

  it('연환산 수익률은 종료자산을 자기자본 기준으로 환산한 값이다', () => {
    const c = compare();
    for (const l of c.legs) {
      expect(EQUITY * Math.pow(1 + l.annualizedReturn, c.years)).toBeCloseTo(
        l.terminalWealth,
        0
      );
    }
  });

  it('종료자산 순위와 연환산 수익률 순위가 일치한다', () => {
    const c = compare();
    const byWealth = [...c.legs].sort((a, b) => b.terminalWealth - a.terminalWealth);
    const byReturn = [...c.legs].sort((a, b) => b.annualizedReturn - a.annualizedReturn);
    expect(byReturn.map((l) => l.kind)).toEqual(byWealth.map((l) => l.kind));
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
      const 대칭없음 = l.recovered + l.initialInvestment * Math.pow(1 + a.investmentReturnRate, a.years);
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
    expect(j.initialInvestment).toBeLessThan(w.initialInvestment);
  });

  it('자기자본이 보증금에 못 미치면 전세자금대출이 잡히고 이자가 나간다', () => {
    const c = compare({}, 30, 100000000);
    const j = leg(c, 'jeonse');
    expect(j.detail.jeonseLoan).toBeGreaterThan(0);
    expect(j.detail.monthlyInterest).toBeGreaterThan(0);
    expect(j.housingCashOut).toBeGreaterThan(0);
  });

  it('대출을 끼면 보증금을 어떻게 맞췄는지 카드에 적어 준다', () => {
    // 목돈만 보면 "1.2억으로 어떻게 2.7억 보증금을?" 이 되므로 근거를 남깁니다.
    const j = leg(compare({}, 30, 120000000), 'jeonse');
    expect(j.detail.jeonseLoan).toBeGreaterThan(0);
    expect(j.notes.some((n) => n.includes('전세자금대출'))).toBe(true);
  });

  it('자기자본이 넉넉하면 대출이 없어 월 주거비가 0이다', () => {
    const c = compare({}, 30, 400000000);
    expect(leg(c, 'jeonse').detail.jeonseLoan).toBe(0);
    expect(leg(c, 'jeonse').housingCashOut).toBeCloseTo(0, 6);
  });

  it('대출 한도가 남아 있으면 중개보수까지 빌려 자금 부족이 뜨지 않는다', () => {
    const j = leg(compare({}, 30, 100000000), 'jeonse');
    expect(j.feasible).toBe(true);
    expect(j.detail.jeonseLoan).toBeLessThan(j.detail.deposit0 * RULES.tenure.jeonseLoan.ltvCap);
    expect(j.initialOutlay).toBeCloseTo(100000000, 0);
  });

  it('초기투입이 자기자본과 정확히 같아도 부동소수점 때문에 부족으로 뒤집히지 않는다', () => {
    // 전세대출은 모자란 만큼 정확히 빌리므로 initialOutlay == equity 가 됩니다.
    // 1e-8원 단위 먼지로 "자금 부족" 배지가 뜬 적이 있어 고정해 둡니다.
    for (const equity of [80000000, 100000000, 123456789, 150000000]) {
      const j = leg(compare({}, 30, equity), 'jeonse');
      if (j.detail.jeonseLoan > 0 && j.detail.jeonseLoan < j.detail.deposit0 * 0.8) {
        expect(j.feasible).toBe(true);
        expect(j.shortfall).toBe(0);
      }
    }
  });

  it('대출 한도가 실제로 막히면 그때는 부족액을 드러낸다', () => {
    const j = leg(compare({ jeonseRatio: 0.95 }, 30, 20000000), 'jeonse');
    expect(j.detail.jeonseLoan).toBeCloseTo(
      j.detail.deposit0 * RULES.tenure.jeonseLoan.ltvCap,
      0
    );
    expect(j.feasible).toBe(false);
    expect(j.shortfall).toBeGreaterThan(0);
  });

  it('보증금은 종료 시 전세대출을 갚고 남은 만큼 회수된다', () => {
    const c = compare({}, 30, 100000000);
    const j = leg(c, 'jeonse');
    expect(j.recovered).toBeCloseTo(j.detail.depositEnd - j.detail.jeonseLoan, 6);
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
    expect(leg(high, 'jeonse').recovered).toBeCloseTo(
      leg(low, 'jeonse').recovered,
      6
    );
    expect(leg(high, 'wolse').recovered).toBeCloseTo(leg(low, 'wolse').recovered, 6);
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
    expect(b.recovered).toBeCloseTo(
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
    expect(b.initialInvestment).toBeLessThan(0);
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

describe('매달 나가는 돈의 성격 분해', () => {
  it('네 항목의 합이 총 현금유출과 같다 — 새는 돈이 없어야 합니다', () => {
    for (const l of compare().legs) {
      expect(l.principalRepaid + l.interestPaid + l.rentPaid + l.carryCost).toBeCloseTo(
        l.housingCashOut,
        0
      );
    }
  });

  it('매수의 원금상환은 비용이 아니라 저축이다 — 잔여대출이 그만큼 줄어 있다', () => {
    const c = compare();
    const b = leg(c, 'buy');
    const remaining = b.detail.remainingLoan;
    expect(b.principalRepaid).toBeCloseTo(b.detail.loanPrincipal - remaining, 0);
    // 그리고 그 값은 ③의 매도 순수취에 그대로 반영돼 있습니다
    expect(b.recovered).toBeCloseTo(
      b.detail.endPrice - remaining - b.detail.sellingFee - b.detail.capitalGainsTax,
      0
    );
  });

  it('매수만 원금상환·보유비가 있고 임차는 없다', () => {
    const c = compare();
    expect(leg(c, 'buy').principalRepaid).toBeGreaterThan(0);
    expect(leg(c, 'buy').carryCost).toBeGreaterThan(0);
    for (const kind of ['jeonse', 'wolse'] as const) {
      expect(leg(c, kind).principalRepaid).toBe(0);
      expect(leg(c, kind).carryCost).toBe(0);
    }
  });

  it('전세는 이자만, 월세는 월세만 나간다', () => {
    const c = compare({}, 30, 120000000);
    expect(leg(c, 'jeonse').interestPaid).toBeGreaterThan(0);
    expect(leg(c, 'jeonse').rentPaid).toBe(0);
    expect(leg(c, 'wolse').rentPaid).toBeGreaterThan(0);
    expect(leg(c, 'wolse').interestPaid).toBe(0);
  });

  it('갱신 증액 보증금이 드러난다 — 넣은 목돈보다 돌려받는 돈이 큰 이유', () => {
    const j = leg(compare({}, 30, 120000000), 'jeonse');
    expect(j.depositTopUp).toBeGreaterThan(0);
    // 최초 보증금 + 증액분 = 최종 보증금
    expect(j.detail.deposit0 + j.depositTopUp).toBeCloseTo(j.detail.depositEnd, 0);
    // 돌려받는 돈 = 최종 보증금 − 전세대출
    expect(j.recovered).toBeCloseTo(j.detail.depositEnd - j.detail.jeonseLoan, 0);
  });

  it('매수는 갱신 증액이 없다', () => {
    expect(leg(compare(), 'buy').depositTopUp).toBe(0);
  });
});

describe('주거 순비용 — 돌려받지 못하고 사라진 돈', () => {
  it('매수 순비용 = 취득비용 + 이자 + 보유비 + 매도중개보수 + 양도세', () => {
    const b = leg(compare(), 'buy');
    expect(b.netHousingCost).toBeCloseTo(
      b.detail.acquisitionCost + b.interestPaid + b.carryCost + b.detail.sellingFee +
        b.detail.capitalGainsTax,
      0
    );
  });

  it('원금상환은 순비용에 들어가지 않는다 — 자본이라 돌아옵니다', () => {
    const b = leg(compare(), 'buy');
    expect(b.principalRepaid).toBeGreaterThan(0);
    expect(b.netHousingCost).toBeLessThan(b.housingCashOut + b.detail.acquisitionCost);
  });

  it('집값이 올라도 순비용은 줄지 않는다 — 비용과 자본이득은 다른 칸입니다', () => {
    // 예전에는 회수액을 통째로 빼서 상승분이 비용을 덮고 음수가 나왔습니다.
    const flat = leg(compare({ priceGrowthRate: 0 }), 'buy');
    const up = leg(compare({ priceGrowthRate: 0.05 }), 'buy');
    expect(up.netHousingCost).toBeGreaterThanOrEqual(flat.netHousingCost);
  });

  it('순비용은 어떤 갈래에서도 음수가 아니다', () => {
    for (const g of [0, 0.03, 0.08]) {
      for (const l of compare({ priceGrowthRate: g }).legs) {
        expect(l.netHousingCost).toBeGreaterThan(0);
      }
    }
  });

  it('전세 순비용은 이자 + 중개보수, 월세는 월세 + 중개보수뿐이다', () => {
    const c = compare({}, 30, 120000000);
    const j = leg(c, 'jeonse');
    const w = leg(c, 'wolse');
    expect(j.netHousingCost).toBeCloseTo(j.interestPaid + j.detail.brokerage, 0);
    expect(w.netHousingCost).toBeCloseTo(w.rentPaid + w.detail.brokerage, 0);
  });
});

describe('현금흐름 차이가 곧 투자 원금 차이', () => {
  it('총 현금유출 = 초기 투입 + 매달 + 갱신 증액', () => {
    for (const l of compare().legs) {
      expect(l.totalCashOut).toBeCloseTo(
        l.initialOutlay + l.housingCashOut + l.depositTopUp,
        0
      );
    }
  });

  it('매수보다 현금이 덜 나가는 만큼 임차가 투자에 더 넣는다', () => {
    // 이 항등식이 "덜 쓴 돈을 굴린다"의 근거입니다. 어긋나면 비교가 성립하지 않습니다.
    const c = compare();
    const buy = leg(c, 'buy');
    for (const kind of ['jeonse', 'wolse'] as const) {
      const l = leg(c, kind);
      expect(l.investedPrincipal - buy.investedPrincipal).toBeCloseTo(
        buy.totalCashOut - l.totalCashOut,
        0
      );
    }
  });

  it('매수의 현금유출이 임차보다 크다 — 원금상환이 얹히기 때문', () => {
    const c = compare();
    const buy = leg(c, 'buy');
    expect(buy.totalCashOut).toBeGreaterThan(leg(c, 'jeonse').totalCashOut);
    expect(buy.totalCashOut).toBeGreaterThan(leg(c, 'wolse').totalCashOut);
  });
});

describe('대체투자 수익률을 바꿔 가며', () => {
  const presets = [
    { id: 'a', label: '낮음', rate: 0.02, note: '' },
    { id: 'b', label: '보통', rate: 0.06, note: '' },
    { id: 'c', label: '높음', rate: 0.13, note: '' },
  ];
  const input = {
    property,
    loan,
    equity: EQUITY,
    termYears: 30,
    assumptions: defaultAssumptions(property.region),
  };

  it('프리셋마다 세 갈래 종료자산을 낸다', () => {
    const rows = compareAcrossReturns(input, presets);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.terminal.buy).toBeGreaterThan(0);
      expect(r.terminal.jeonse).toBeGreaterThan(0);
      expect(r.terminal.wolse).toBeGreaterThan(0);
      expect(r.gap).toBeGreaterThanOrEqual(0);
    }
  });

  it('수익률이 오르면 임차가 매수를 따라잡는다 — 차액을 굴리는 쪽이라', () => {
    const [low, , high] = compareAcrossReturns(input, presets);
    const lead = (r: (typeof low)) => r.terminal.buy - Math.max(r.terminal.jeonse, r.terminal.wolse);
    expect(lead(high)).toBeLessThan(lead(low));
  });

  it('세 갈래 모두 수익률에 반응한다 — 매수도 남긴 목돈을 굴립니다', () => {
    const [low, , high] = compareAcrossReturns(input, presets);
    for (const kind of ['buy', 'jeonse', 'wolse'] as const) {
      expect(high.terminal[kind]).toBeGreaterThan(low.terminal[kind]);
    }
  });

  it('승자는 종료자산이 가장 큰 갈래다', () => {
    for (const r of compareAcrossReturns(input, presets)) {
      const max = Math.max(r.terminal.buy, r.terminal.jeonse, r.terminal.wolse);
      expect(r.terminal[r.best]).toBe(max);
    }
  });
});

describe('주거 순비용 분해', () => {
  it('항목 합계가 순비용과 정확히 맞는다', () => {
    for (const l of compare().legs) {
      const sum = housingCostBreakdown(l).reduce(
        (s, i) => s + (i.reducesCost ? -i.amount : i.amount),
        0
      );
      expect(sum).toBeCloseTo(l.netHousingCost, 0);
    }
  });

  it('매수는 취득비용·이자·보유비·매도수수료로 갈린다', () => {
    const items = housingCostBreakdown(leg(compare(), 'buy')).map((i) => i.label);
    expect(items).toContain('취득비용');
    expect(items).toContain('대출이자');
    expect(items).toContain('재산세·수선유지');
    expect(items).toContain('매도 중개보수');
  });

  it('임차는 이자·월세와 중개보수뿐이다 — 보증금은 자본이라 없습니다', () => {
    const j = housingCostBreakdown(leg(compare({}, 30, 120000000), 'jeonse')).map((i) => i.label);
    expect(j).toContain('전세대출 이자');
    expect(j).toContain('임대차 중개보수');
    expect(j.some((l) => /보증금/.test(l))).toBe(false);

    const w = housingCostBreakdown(leg(compare(), 'wolse')).map((i) => i.label);
    expect(w).toContain('월세');
  });

  it('0원 항목은 빼고 냅니다', () => {
    for (const l of compare().legs) {
      for (const i of housingCostBreakdown(l)) expect(Math.abs(i.amount)).toBeGreaterThan(0);
    }
  });

  it('모든 항목에 설명이 붙어 있다', () => {
    for (const l of compare().legs) {
      for (const i of housingCostBreakdown(l)) expect(i.help.length).toBeGreaterThan(10);
    }
  });
});

describe('청약 — 4번째 갈래', () => {
  const plan = { ...emptyPlan('s1'), price: 450000000, waitYears: 2.5 };
  const withSub = (over: Partial<TenureAssumptions> = {}, equity = EQUITY) => {
    const a = defaultAssumptions(property.region, over);
    return compareTenures({
      property,
      loan,
      equity,
      termYears: 30,
      assumptions: a,
      extraPlans: [subscriptionLegPlan(plan, a, equity, 30)],
    })!;
  };

  it('넣으면 네 갈래가 되고, 안 넣으면 그대로 셋입니다', () => {
    expect(withSub().legs).toHaveLength(4);
    expect(compare().legs).toHaveLength(3);
  });

  it('갈래를 더해도 나머지 셋의 격차와 순위는 그대로입니다 — 기준예산 불변성', () => {
    const three = compare();
    const four = withSub();
    const gap = (c: TenureComparison, x: TenureKind, y: TenureKind) =>
      leg(c, x).terminalWealth - leg(c, y).terminalWealth;

    expect(gap(four, 'buy', 'jeonse')).toBeCloseTo(gap(three, 'buy', 'jeonse'), -2);
    expect(gap(four, 'buy', 'wolse')).toBeCloseTo(gap(three, 'buy', 'wolse'), -2);
    expect(gap(four, 'jeonse', 'wolse')).toBeCloseTo(gap(three, 'jeonse', 'wolse'), -2);
  });

  it('손익분기 상승률은 청약을 빼고 잽니다 — 청약도 집을 사므로 분기점이 사라집니다', () => {
    expect(withSub().breakEvenPriceGrowth).toBeCloseTo(compare().breakEvenPriceGrowth!, 6);
  });

  it('같은 자기자본에서 출발합니다', () => {
    const c = withSub();
    for (const l of c.legs) {
      expect(l.initialOutlay + l.initialInvestment).toBeCloseTo(EQUITY, -2);
    }
  });

  it('종료자산 = 회수액 + 투자잔고', () => {
    const s = leg(withSub(), 'subscription');
    expect(s.terminalWealth).toBeCloseTo(s.recovered + s.investmentEnd, -2);
  });

  it('자기자본이 계약금·대기 보증금에 못 미치면 실행 불가로 잡힙니다', () => {
    const s = leg(withSub({}, 30000000), 'subscription');
    expect(s.feasible).toBe(false);
    expect(s.shortfall).toBeGreaterThan(0);
  });

  it('분양가가 오르면 청약 갈래의 종료자산이 커집니다', () => {
    const a = defaultAssumptions(property.region);
    const run = (growth: number) => {
      const aa = { ...a, priceGrowthRate: growth };
      return leg(
        compareTenures({
          property,
          loan,
          equity: EQUITY,
          termYears: 30,
          assumptions: aa,
          extraPlans: [subscriptionLegPlan(plan, aa, EQUITY, 30)],
        })!,
        'subscription'
      ).terminalWealth;
    };
    expect(run(0.03)).toBeGreaterThan(run(0));
  });

  it('입주가 늦어질수록 종료자산이 줄어듭니다 — 기다리는 값이 있습니다', () => {
    const a = defaultAssumptions(property.region);
    const run = (waitYears: number) =>
      leg(
        compareTenures({
          property,
          loan,
          equity: EQUITY,
          termYears: 30,
          assumptions: a,
          extraPlans: [subscriptionLegPlan({ ...plan, waitYears }, a, EQUITY, 30)],
        })!,
        'subscription'
      ).terminalWealth;
    expect(run(1)).toBeGreaterThan(run(4));
  });

  it('수익률 민감도 표에도 네 갈래가 다 실립니다', () => {
    const a = defaultAssumptions(property.region);
    const scenarios = compareAcrossReturns(
      {
        property,
        loan,
        equity: EQUITY,
        termYears: 30,
        assumptions: a,
        extraPlans: [subscriptionLegPlan(plan, a, EQUITY, 30)],
      },
      RULES.tenure.investmentPresets.items
    );
    for (const sc of scenarios) {
      expect(sc.terminal.subscription).toBeTypeOf('number');
    }
  });
});
