/**
 * 3-way 거주형태 비교 — 매수 / 전세 / 월세.
 *
 * 세 갈래가 **같은 자기자본 E** 에서 출발해 N년 뒤 손에 남는 돈(종료자산)을 비교합니다.
 *
 * ```
 * 매수 종료자산 = P_end − 잔여대출 − 매도비용 − 양도세 + 투자잔고
 * 임차 종료자산 = 보증금 반환 − 임차대출 + 투자잔고
 *   투자잔고   = (E − 초기투입) 성장
 *              + Σ(매수 월지출 − 내 월지출) 적립투자 성장   ← 원금상환 대칭
 * ```
 *
 * ## 원금상환 대칭이 핵심입니다
 *
 * 매수자가 매달 내는 원리금 중 원금분은 **비용이 아니라 저축**입니다. 그게 잔여대출을
 * 줄여 종료자산에 그대로 남죠. 임차자에게 같은 금액을 투자시키지 않으면 매수만
 * 저축하고 임차는 소비만 한 셈이 되어 비교가 성립하지 않습니다. 가장 빠뜨리기 쉬운
 * 항목이라 여기서는 월별 시뮬레이션으로 명시적으로 넣습니다.
 *
 * ## 기준예산은 결과를 바꾸지 않습니다
 *
 * 매달 세 갈래 중 **가장 많이 쓰는 쪽**을 기준예산으로 잡고, 각자 덜 쓴 만큼을
 * 적립합니다. 기준예산에 상수를 더하면 세 갈래 모두 같은 금액이 더해지므로
 * **격차와 순위는 불변**입니다 (테스트로 고정해 뒀습니다). 기준을 어디에 두든
 * 비교는 흔들리지 않는다는 뜻입니다.
 *
 * ## 이 계산이 아닌 것
 *
 * 가격상승률·투자수익률·전세가율·전월세전환율은 전부 **가정값**입니다. 예측이 아니고,
 * 매수 쪽만 가격상승률에 노출되므로 `breakEvenPriceGrowth`(손익분기 상승률)를 함께
 * 읽어야 합니다 — "얼마나 올라야 매수가 이기는가"가 실제 의사결정 질문입니다.
 */

import { brokerageFee } from './costs';
import { money } from './format';
import { measuredConversionRate, measuredJeonseRatio } from './rent';
import { RULES } from './rules';
import { capitalGainsTax, leaseBrokerageFee, propertyTax } from './tax';
import type { LoanResult, Property, RegionId } from './types';

export type TenureKind = 'buy' | 'jeonse' | 'wolse';

export interface TenureAssumptions {
  /** 비교 기간 (년) */
  years: number;
  /** 주택 가격상승률 (연) — 매수 갈래만 여기에 노출됩니다 */
  priceGrowthRate: number;
  /** 대체투자 기대수익률 (연, 명목). 주식·채권 등 주거 아닌 곳에 굴렸을 때. */
  investmentReturnRate: number;
  /** 전세가율 — 매매가 대비 전세보증금 */
  jeonseRatio: number;
  /** 전월세전환율 (연) — 월세는 전세에서 파생됩니다 */
  conversionRate: number;
  /** 월세 보증금 / 전세보증금 */
  wolseDepositRatio: number;
  /** 보증금·월세 상승률 (연) */
  depositGrowthRate: number;
  /** 연 수선유지비 (주택가격 대비) — 매수자만 부담 */
  maintenanceRate: number;
  /** 전세자금대출 금리 */
  jeonseLoanRate: number;
}

export interface TenureLeg {
  kind: TenureKind;
  label: string;
  /** 초기 자기자본으로 감당되는가 */
  feasible: boolean;
  /** 초기 자금 부족액 (feasible이면 0) */
  shortfall: number;
  /** ① 계약 시점에 주거로 묶인 목돈 — 자기부담금+취득비용 / 보증금+중개보수 */
  initialOutlay: number;
  /** ① 주거에 묶고 남아 투자로 간 목돈 (자기자본 − initialOutlay) */
  initialInvestment: number;
  /** ② 기간 중 순 적립액 (음수면 인출) */
  netContribution: number;
  /** ② 주거에 실제로 나간 현금 총액 (원금상환·보증금 제외) */
  housingCashOut: number;
  /** ③ 종료 시 투자 외로 회수한 목돈 — 매도 순수취 / 보증금 반환 */
  recovered: number;
  /** ③ 종료 투자잔고 (원금 + 수익) */
  investmentEnd: number;
  /** 투자에 넣은 원금 총액 = initialInvestment + netContribution */
  investedPrincipal: number;
  /** 투자에서 번 돈 = investmentEnd − investedPrincipal */
  investmentGain: number;
  terminalWealth: number;
  /**
   * 자기자본 기준 연환산 수익률.
   *
   * 같은 집에 같은 기간 살면서 자기자본이 연 몇 %로 불었는지입니다. 세 갈래가
   * 같은 주거 서비스를 소비하므로 서로 비교하면 "매수 대신 다른 데 굴렸으면"에
   * 답이 됩니다. 다만 주거비 소비가 빠진 뒤의 값이라 순수 투자수익률은 아닙니다.
   */
  annualizedReturn: number;
  /** 기간 중 투자잔고가 음수로 내려간 적이 있는가 */
  liquidityRisk: boolean;
  detail: Record<string, number>;
  notes: string[];
}

export interface TenureComparison {
  equity: number;
  years: number;
  assumptions: TenureAssumptions;
  legs: TenureLeg[];
  best: TenureKind;
  /** 매수가 최선의 임차안과 같아지는 가격상승률. 구간 밖이면 null. */
  breakEvenPriceGrowth: number | null;
  caveats: string[];
}

const LABEL: Record<TenureKind, string> = {
  buy: '매수',
  jeonse: '전세',
  wolse: '월세',
};

/**
 * 지역별 시장 가정값 기본치.
 *
 * 전세가율·전월세전환율은 **실측 스냅샷이 있으면 그것을 씁니다** (`rent.ts`).
 * 룰셋의 값은 스냅샷이 비었을 때만 쓰이는 자리표시자입니다. 나머지(투자수익률·
 * 상승률·수선유지비)는 아직 전부 자리표시자입니다.
 */
export function defaultAssumptions(
  region: RegionId,
  over: Partial<TenureAssumptions> = {}
): TenureAssumptions {
  const d = RULES.tenure.assumptionDefaults;
  const r = d.byRegion[region];
  return {
    years: d.years,
    priceGrowthRate: 0.03,
    investmentReturnRate: d.investmentReturnRate,
    jeonseRatio: measuredJeonseRatio(region) ?? r.jeonseRatio,
    conversionRate: measuredConversionRate(region) ?? r.conversionRate,
    wolseDepositRatio: r.wolseDepositRatio,
    depositGrowthRate: d.depositGrowthRate,
    maintenanceRate: d.maintenanceRate,
    jeonseLoanRate: RULES.tenure.jeonseLoan.rate,
    ...over,
  };
}

/** 원리금균등 상환 중 m개월 경과 시점의 대출잔액 */
export function loanBalance(
  principal: number,
  annualRate: number,
  payment: number,
  monthsElapsed: number
): number {
  if (principal <= 0) return 0;
  const i = annualRate / 12;
  const m = Math.max(0, monthsElapsed);
  const remaining =
    i === 0
      ? principal - payment * m
      : principal * Math.pow(1 + i, m) - payment * ((Math.pow(1 + i, m) - 1) / i);
  return Math.max(0, remaining);
}

/** 갱신 시점마다 오르는 보증금·월세의 상승률. 첫 갱신만 법정 상한(5%)이 걸립니다. */
function renewalRaise(a: TenureAssumptions, renewalIndex: number): number {
  const lease = RULES.tenure.lease;
  const market = Math.pow(1 + a.depositGrowthRate, lease.renewalYears) - 1;
  const capped = renewalIndex < lease.renewalCapUses;
  return capped ? Math.min(market, lease.renewalCapRatio) : market;
}

/** 한 갈래의 월별 현금흐름 계획 */
interface LegPlan {
  kind: TenureKind;
  initialOutlay: number;
  /** 월별 주거비 (경상 지출) */
  outflow: number[];
  /** 월별 일시 지출 — 갱신 증액 보증금 등 */
  lumps: number[];
  recovered: number;
  detail: Record<string, number>;
  notes: string[];
}

function buyPlan(
  property: Property,
  loan: LoanResult,
  a: TenureAssumptions,
  termYears: number
): LegPlan {
  const months = Math.round(a.years * 12);
  const termMonths = Math.round(termYears * 12);
  const principal = loan.limit;
  const acquisitionCost = loan.costs.total;
  // 필요경비에는 이사·수리비가 들어가지 않습니다 (양도세 계산 기준)
  const deductibleCost = acquisitionCost - loan.costs.movingAndRepair;

  const outflow: number[] = [];
  for (let m = 1; m <= months; m++) {
    const year = Math.floor((m - 1) / 12);
    const priceThisYear = property.price * Math.pow(1 + a.priceGrowthRate, year);
    const holding =
      (propertyTax(priceThisYear).total + priceThisYear * a.maintenanceRate) / 12;
    outflow.push((m <= termMonths ? loan.monthlyPayment : 0) + holding);
  }

  const endPrice = property.price * Math.pow(1 + a.priceGrowthRate, a.years);
  const remainingLoan = loanBalance(
    principal,
    loan.rate,
    loan.monthlyPayment,
    Math.min(months, termMonths)
  );
  const sellingFee = brokerageFee(endPrice);
  const cgt = capitalGainsTax({
    salePrice: endPrice,
    buyPrice: property.price,
    expenses: deductibleCost + sellingFee,
    holdYears: a.years,
    liveYears: a.years,
  });

  const notes = [cgt.note];
  if (a.years < RULES.tenure.capitalGainsTax.minHoldYears) {
    notes.push('보유 2년 미만은 비과세가 통째로 사라집니다. 기간을 늘려 보세요.');
  }

  return {
    kind: 'buy',
    initialOutlay: property.price - principal + acquisitionCost,
    outflow,
    lumps: new Array(months).fill(0),
    recovered: endPrice - remainingLoan - sellingFee - cgt.total,
    detail: {
      loanPrincipal: principal,
      acquisitionCost,
      endPrice,
      remainingLoan,
      sellingFee,
      capitalGainsTax: cgt.total,
      monthlyPayment: loan.monthlyPayment,
      firstYearHoldingCost: propertyTax(property.price).total + property.price * a.maintenanceRate,
    },
    notes,
  };
}

function jeonsePlan(property: Property, a: TenureAssumptions, equity: number): LegPlan {
  const cfg = RULES.tenure.jeonseLoan;
  const lease = RULES.tenure.lease;
  const months = Math.round(a.years * 12);

  const deposit0 = property.price * a.jeonseRatio;
  const brokerage = leaseBrokerageFee(deposit0, 0);
  // 중개보수까지 포함해 모자란 만큼 빌립니다. 보증금에만 맞춰 빌리면 수수료 때문에
  // 한도가 남아 있는데도 늘 자금 부족으로 잡힙니다.
  const need = Math.max(0, deposit0 + brokerage - equity);
  const jeonseLoan = Math.min(need, deposit0 * cfg.ltvCap, cfg.absoluteCap);
  const initialOutlay = deposit0 - jeonseLoan + brokerage;

  const outflow: number[] = new Array(months).fill((jeonseLoan * a.jeonseLoanRate) / 12);
  const lumps: number[] = new Array(months).fill(0);

  let deposit = deposit0;
  let renewals = 0;
  for (let m = lease.renewalYears * 12; m < months; m += lease.renewalYears * 12) {
    const raise = deposit * renewalRaise(a, renewals);
    lumps[m - 1] += raise; // 갱신 증액분은 투자에서 빼서 넣습니다
    deposit += raise;
    renewals++;
  }

  const notes = [
    '갱신 증액 보증금은 투자자산을 헐어 충당한다고 봅니다 (대출 증액 아님).',
    '계약갱신청구권으로 계속 거주해 중개보수는 최초 1회만 계산합니다.',
  ];
  // 목돈만 보면 "이 돈으로 어떻게 저 보증금을?" 이 됩니다. 대출을 끼웠다는 사실과
  // 월 주거비의 정체(그 이자)를 같이 적어 둡니다.
  if (jeonseLoan > 0) {
    notes.unshift(
      `보증금 ${money(deposit0)} 중 ${money(jeonseLoan)}은 전세자금대출입니다. 월 주거비는 그 이자이고, 원금은 종료 시 보증금에서 갚습니다.`
    );
  }
  if (need > jeonseLoan) {
    notes.push('전세대출 한도로도 보증금을 못 채웁니다 — 전세가 성립하지 않는 구간입니다.');
  }

  return {
    kind: 'jeonse',
    initialOutlay,
    outflow,
    lumps,
    recovered: deposit - jeonseLoan,
    detail: {
      deposit0,
      depositEnd: deposit,
      jeonseLoan,
      monthlyInterest: (jeonseLoan * a.jeonseLoanRate) / 12,
      brokerage,
      renewals,
    },
    notes,
  };
}

function wolsePlan(property: Property, a: TenureAssumptions): LegPlan {
  const lease = RULES.tenure.lease;
  const months = Math.round(a.years * 12);

  const jeonseEquivalent = property.price * a.jeonseRatio;
  const deposit0 = jeonseEquivalent * a.wolseDepositRatio;
  const conversionRate = Math.min(a.conversionRate, lease.conversionRateMax);
  const rent0 = ((jeonseEquivalent - deposit0) * conversionRate) / 12;

  const outflow: number[] = [];
  const lumps: number[] = new Array(months).fill(0);

  let deposit = deposit0;
  let rent = rent0;
  let renewals = 0;
  for (let m = 1; m <= months; m++) {
    outflow.push(rent);
    if (m % (lease.renewalYears * 12) === 0 && m < months) {
      const raise = renewalRaise(a, renewals);
      lumps[m - 1] += deposit * raise;
      deposit *= 1 + raise;
      rent *= 1 + raise;
      renewals++;
    }
  }

  return {
    kind: 'wolse',
    initialOutlay: deposit0 + leaseBrokerageFee(deposit0, rent0),
    outflow,
    lumps,
    recovered: deposit,
    detail: {
      deposit0,
      depositEnd: deposit,
      rent0,
      rentEnd: rent,
      conversionRate,
      brokerage: leaseBrokerageFee(deposit0, rent0),
      renewals,
    },
    notes: ['월세는 전세보증금에서 전월세전환율로 환산했습니다 — 독립 가정값이 아닙니다.'],
  };
}

/** 계획을 공통 기준예산에 태워 투자잔고와 종료자산을 계산합니다. */
function runLegs(plans: LegPlan[], equity: number, a: TenureAssumptions): TenureLeg[] {
  const months = Math.round(a.years * 12);
  const monthlyReturn = Math.pow(1 + a.investmentReturnRate, 1 / 12) - 1;

  return plans.map((plan) => {
    const initialInvestment = equity - plan.initialOutlay;
    let balance = initialInvestment;
    let netContribution = 0;
    let housingCashOut = 0;
    let liquidityRisk = balance < 0;

    for (let m = 0; m < months; m++) {
      const budget = Math.max(...plans.map((p) => p.outflow[m]));
      const contribution = budget - plan.outflow[m] - plan.lumps[m];
      balance = balance * (1 + monthlyReturn) + contribution;
      netContribution += contribution;
      housingCashOut += plan.outflow[m];
      if (balance < 0) liquidityRisk = true;
    }

    // 전세대출은 모자란 만큼 정확히 빌리도록 잡혀 있어 초기투입이 자기자본과 같아집니다.
    // 그때 부동소수점 먼지(1e-8원)가 남아 "자금 부족"으로 뒤집히는 일이 실제로 있었습니다.
    // 1원 미만 차이는 0으로 봅니다.
    const rawShortfall = plan.initialOutlay - equity;
    const shortfall = rawShortfall > 1 ? rawShortfall : 0;
    const investedPrincipal = initialInvestment + netContribution;
    const terminalWealth = plan.recovered + balance;

    return {
      kind: plan.kind,
      label: LABEL[plan.kind],
      feasible: shortfall === 0,
      shortfall,
      initialOutlay: plan.initialOutlay,
      initialInvestment,
      netContribution,
      housingCashOut,
      recovered: plan.recovered,
      investmentEnd: balance,
      investedPrincipal,
      investmentGain: balance - investedPrincipal,
      terminalWealth,
      annualizedReturn:
        equity > 0 && terminalWealth > 0
          ? Math.pow(terminalWealth / equity, 1 / a.years) - 1
          : 0,
      liquidityRisk,
      detail: plan.detail,
      notes: plan.notes,
    };
  });
}

export interface TenureInput {
  property: Property;
  loan: LoanResult;
  /** 세 갈래가 공통으로 출발하는 자기자본 */
  equity: number;
  termYears: number;
  assumptions: TenureAssumptions;
}

function compute(input: TenureInput): TenureLeg[] {
  const { property, loan, equity, termYears, assumptions: a } = input;
  return runLegs(
    [
      buyPlan(property, loan, a, termYears),
      jeonsePlan(property, a, equity),
      wolsePlan(property, a),
    ],
    equity,
    a
  );
}

/**
 * 매수가 최선의 임차안과 같아지는 가격상승률을 이분법으로 찾습니다.
 * "3년 뒤 얼마?" 보다 "몇 % 올라야 본전인가?" 가 훨씬 검증 가능한 질문입니다.
 */
function findBreakEven(input: TenureInput): number | null {
  const gap = (g: number): number => {
    const legs = compute({ ...input, assumptions: { ...input.assumptions, priceGrowthRate: g } });
    const buy = legs.find((l) => l.kind === 'buy')!;
    const rent = legs.filter((l) => l.kind !== 'buy');
    return buy.terminalWealth - Math.max(...rent.map((l) => l.terminalWealth));
  };

  let lo = -0.2;
  let hi = 0.3;
  let flo = gap(lo);
  let fhi = gap(hi);
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (flo > 0 === fhi > 0) return null;

  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    const fmid = gap(mid);
    if (fmid > 0 === flo > 0) {
      lo = mid;
      flo = fmid;
    } else {
      hi = mid;
      fhi = fmid;
    }
  }
  return (lo + hi) / 2;
}

const CAVEATS = [
  '세 갈래 모두 같은 자기자본에서 출발해 같은 기간 뒤 남는 돈을 비교합니다.',
  '임차 쪽 적립액은 매수의 원리금 상환과 대칭입니다 — 이걸 빼면 임차가 부당하게 불리해집니다.',
  '가격상승률·투자수익률·전세가율·전월세전환율은 가정값입니다. 예측치가 아닙니다.',
  '매수만 가격상승률에 노출됩니다. 손익분기 상승률을 함께 보세요.',
  '연환산 수익률은 주거비를 쓰고 남은 자기자본 기준입니다 — 순수 투자수익률이 아니라 “같은 집에 살면서 자본이 얼마나 불었나”입니다.',
  '거주 만족도·이사 비용·직장 이동 같은 비금전 요소는 들어 있지 않습니다.',
];

export function compareTenures(input: TenureInput): TenureComparison | null {
  if (!input.loan.eligible || input.loan.limit <= 0) return null;
  if (input.assumptions.years <= 0) return null;

  const legs = compute(input);
  const best = legs.reduce((a, b) => (b.terminalWealth > a.terminalWealth ? b : a));

  return {
    equity: input.equity,
    years: input.assumptions.years,
    assumptions: input.assumptions,
    legs,
    best: best.kind,
    breakEvenPriceGrowth: findBreakEven(input),
    caveats: CAVEATS,
  };
}
