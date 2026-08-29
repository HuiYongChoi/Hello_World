/**
 * 청약 — 매수/전세/월세와 **구조가 다른** 네 번째 갈래.
 *
 * 세 갈래는 전부 "지금 목돈을 넣고 그 집에 산다"입니다. 청약은 아닙니다.
 *
 * ```
 * 계약   계약금 10% 지출. 그 집엔 아직 못 삽니다 → 다른 집에 임차로 거주
 * 대기   중도금 60% 를 회차로 납입 (집단대출, 이자후불이면 입주 때 정산)
 * 입주   잔금 30% + 중도금 대출 상환 → 주담대로 전환, 임차 보증금 회수
 * 이후   보유하다 매도
 * ```
 *
 * ## 비교가 완전히 대등하지는 않습니다
 *
 * 다른 세 갈래는 **같은 집**에 삽니다. 청약만 대기 기간 동안 다른 집에 살고,
 * 입주 후에는 분양 단지에 삽니다. 주거 서비스가 다르므로 종료자산만 나란히
 * 놓고 "청약이 이긴다"고 말하면 안 됩니다. 이 사실을 결과에 담아 화면이
 * 반드시 같이 말하게 합니다.
 *
 * ## 전매제한은 자산이 아니라 제약입니다
 *
 * 전매제한 기간에는 팔 수 없습니다. 종료자산 계산에는 안 들어가지만 유동성
 * 제약이므로 별도로 표시합니다.
 */

import { brokerageFee } from './costs';
import { monthlyPayment } from './finance';
import { RULES } from './rules';
import { capitalGainsTax, leaseBrokerageFee, propertyTax } from './tax';
import { loanBalance, type LegPlan, type TenureAssumptions } from './tenure';
import type { RegionId } from './types';

/** 사용자가 입력하는 분양 단지 정보 */
export interface SubscriptionPlan {
  id: string;
  name: string;
  region: RegionId;
  /** 시군구 — 실측 프리미엄 대조에 씁니다 */
  sigungu: string;
  /** 법정동 — 있으면 같은 동네끼리 안전마진을 잽니다 */
  umd?: string;
  /** 분양가 (원) */
  price: number;
  areaSqm: number;
  /** 계약부터 입주까지 (년) */
  waitYears: number;
  /** 전매제한 (개월) */
  resaleBanMonths: number;
  downPaymentRatio: number;
  interimRatio: number;
  interimLoanRate: number;
  /** 이자후불제 — 대기 중엔 안 내고 입주 때 한꺼번에 정산 */
  interimDeferred: boolean;
  /** 입주 시 주담대 금리 */
  mortgageRate: number;
  /** 입주 시 주담대 LTV */
  mortgageLtv: number;
  /** 청약 가점 (참고용, 계산에는 안 씁니다) */
  score?: number;
  memo?: string;
}

export function emptyPlan(id: string): SubscriptionPlan {
  const s = RULES.subscription;
  return {
    id,
    name: '새 청약 단지',
    region: 'changwon',
    sigungu: '',
    price: 500000000,
    areaSqm: 84.9,
    waitYears: s.defaultWaitYears,
    resaleBanMonths: s.defaultResaleBanMonths,
    downPaymentRatio: s.downPaymentRatio,
    interimRatio: s.interimRatio,
    interimLoanRate: s.interimLoanRate,
    interimDeferred: true,
    mortgageRate: 0.045,
    mortgageLtv: 0.7,
  };
}

export interface SubscriptionResult {
  /** ① 계약 시점에 나가는 돈 — 계약금 + 대기 중 임차 보증금 */
  initialOutlay: number;
  downPayment: number;
  waitDeposit: number;
  /** ② 대기 기간 지출 */
  waitRentCost: number;
  interimInterest: number;
  /** ② 입주 후 지출 */
  mortgagePrincipalRepaid: number;
  mortgageInterest: number;
  carryCost: number;
  /** 입주 시 한꺼번에 나가는 잔금 (중도금 대출 상환 후 자기부담) */
  moveInCash: number;
  /** 입주 시 실행하는 주담대 */
  mortgage: number;
  /** ③ 종료 시 회수 */
  recovered: number;
  /** 주거 순비용 — 돌려받지 못한 돈 */
  netHousingCost: number;
  acquisitionCost: number;
  sellingFee: number;
  capitalGainsTax: number;
  /** 대기 중 살 집의 임대차 중개보수 — 이 갈래에만 있는 비용입니다 */
  waitBrokerage: number;
  /** 대기 중 어떻게 사는가 — 계약금을 내고 남은 돈으로 전세가 안 되면 월세입니다 */
  waitMode: 'jeonse' | 'wolse';
  /** 월세일 때의 월 임차료 (전세면 0) */
  waitMonthlyRent: number;
  /** 매달 나간 돈 (월별) — 3-way 와 같은 기준예산에 태우기 위해 */
  outflow: number[];
  /** 월별 일시 지출 (계약금 외) */
  lumps: number[];
  notes: string[];
  warnings: string[];
}

/**
 * 청약 갈래의 현금흐름을 만듭니다.
 *
 * 대기 기간에는 **전세**로 산다고 봅니다 — 월세로 두면 대기 비용이 과장되고,
 * 자가로 둘 수는 없기 때문입니다. 그 전세는 비교 대상 물건과 같은 조건
 * (전세가율·전세대출 금리)을 씁니다.
 */
export function subscriptionPlan(
  plan: SubscriptionPlan,
  a: TenureAssumptions,
  equity: number,
  termYears: number
): SubscriptionResult {
  const cfg = RULES.subscription;
  const months = Math.round(a.years * 12);
  const waitMonths = Math.min(months, Math.round(plan.waitYears * 12));

  const notes: string[] = [];
  const warnings: string[] = [];

  // ── 계약: 계약금 + 대기 중 살 집 ────────────────────────────
  const downPayment = plan.price * plan.downPaymentRatio;
  const afterDown = Math.max(0, equity - downPayment);
  const jeonseCfg = RULES.tenure.jeonseLoan;

  /*
   * 대기 중 살 집은 분양가 수준의 전세로 봅니다. 다만 계약금을 먼저 낸 뒤라
   * **전세보증금을 못 채우는 일이 흔합니다** — 청약의 진짜 문턱이 여기입니다.
   *
   * 예전에는 그 경우 경고만 띄우고 숫자는 전세 그대로였습니다. 구할 수 없는
   * 집의 주거비로 계산한 셈이라, 실제로 나갈 돈보다 싸게 나옵니다. 3-way 와
   * 같은 방식으로 **전세에서 월세를 파생**시켜 떨어뜨립니다.
   */
  const jeonseDeposit = plan.price * a.jeonseRatio;
  const jeonseBrokerage = leaseBrokerageFee(jeonseDeposit, 0);
  const maxJeonseLoan = Math.min(jeonseDeposit * jeonseCfg.ltvCap, jeonseCfg.absoluteCap);
  const jeonseNeed = Math.max(0, jeonseDeposit + jeonseBrokerage - afterDown);
  const canJeonse = jeonseNeed <= maxJeonseLoan;

  const waitMode: 'jeonse' | 'wolse' = canJeonse ? 'jeonse' : 'wolse';
  const waitDepositFull = canJeonse ? jeonseDeposit : jeonseDeposit * a.wolseDepositRatio;
  // 월세는 전세보증금 차액 × 전월세전환율에서 나옵니다 — 독립 가정값이 아닙니다.
  const monthlyRent = canJeonse
    ? 0
    : ((jeonseDeposit - waitDepositFull) * a.conversionRate) / 12;
  const waitBrokerage = leaseBrokerageFee(waitDepositFull, monthlyRent);
  const waitLoan = canJeonse ? Math.min(jeonseNeed, maxJeonseLoan) : 0;
  const waitDepositOwn = waitDepositFull - waitLoan + waitBrokerage;

  const initialOutlay = downPayment + waitDepositOwn;
  if (!canJeonse) {
    warnings.push(
      '계약금을 낸 뒤 남는 돈으로는 대기 중 전세보증금을 전세대출로도 못 채웁니다 — 월세로 사는 것으로 계산했습니다.'
    );
  }

  // ── 중도금 ────────────────────────────────────────────────
  const interim = plan.price * plan.interimRatio;
  const perInstallment = interim / cfg.interimInstallments;
  /*
   * 중도금은 회차마다 나눠 나가므로 이자도 회차마다 쌓입니다. 전액을 처음부터
   * 빌린 것으로 계산하면 이자가 과장됩니다 — 평균 잔액으로 봅니다.
   */
  let interimInterest = 0;
  for (let k = 1; k <= cfg.interimInstallments; k++) {
    const drawnAtMonth = Math.round((waitMonths * k) / (cfg.interimInstallments + 1));
    const monthsOutstanding = Math.max(0, waitMonths - drawnAtMonth);
    interimInterest += perInstallment * plan.interimLoanRate * (monthsOutstanding / 12);
  }

  // ── 입주: 잔금 + 주담대 ────────────────────────────────────
  const mortgage = Math.min(plan.price * plan.mortgageLtv, interim + plan.price * (1 - plan.downPaymentRatio - plan.interimRatio));
  const acquisitionCost =
    plan.price * 0.01 + RULES.costs.legalAndBondDefault; // 분양은 중개보수가 없습니다
  // 입주 시 현금: 총 분양가 − 계약금 − 실행 주담대 + 취득비용 (+ 이자후불 정산)
  const moveInCash =
    plan.price - downPayment - mortgage + acquisitionCost + (plan.interimDeferred ? interimInterest : 0);

  const outflow = new Array(months).fill(0);
  const lumps = new Array(months).fill(0);

  const mortgageMonths = Math.round(termYears * 12);
  const mortgageMonthly = monthlyPayment(mortgage, plan.mortgageRate, termYears);
  // 대기 중 주거비 — 전세면 대출이자, 월세면 월세. 둘 다 돌려받지 못합니다.
  const waitMonthlyHousing = canJeonse ? (waitLoan * a.jeonseLoanRate) / 12 : monthlyRent;
  const monthlyInterimInterest = plan.interimDeferred
    ? 0
    : waitMonths > 0
      ? interimInterest / waitMonths
      : 0;

  for (let m = 0; m < months; m++) {
    if (m < waitMonths) {
      // 대기 중 — 전세 이자 + (이자선납이면) 중도금 이자
      outflow[m] = waitMonthlyHousing + monthlyInterimInterest;
    } else {
      const sinceMoveIn = m - waitMonths;
      const year = Math.floor(sinceMoveIn / 12);
      const priceThisYear = plan.price * Math.pow(1 + a.priceGrowthRate, year);
      const holding =
        (propertyTax(priceThisYear).total + priceThisYear * a.maintenanceRate) / 12;
      outflow[m] = (sinceMoveIn < mortgageMonths ? mortgageMonthly : 0) + holding;
    }
  }

  // 입주 시 목돈이 한꺼번에 나갑니다. 보증금은 돌려받아 상쇄됩니다.
  if (waitMonths < months) {
    lumps[waitMonths] += moveInCash - (waitDepositFull - waitLoan);
  }

  // ── 종료 ──────────────────────────────────────────────────
  const heldYears = Math.max(0, a.years - plan.waitYears);
  const endPrice = plan.price * Math.pow(1 + a.priceGrowthRate, heldYears);
  const paidMonths = Math.min(months - waitMonths, mortgageMonths);
  const remainingLoan = loanBalance(mortgage, plan.mortgageRate, mortgageMonthly, Math.max(0, paidMonths));
  const sellingFee = brokerageFee(endPrice);
  const cgt = capitalGainsTax({
    salePrice: endPrice,
    buyPrice: plan.price,
    expenses: acquisitionCost + sellingFee,
    holdYears: heldYears,
    liveYears: heldYears,
  });

  const totalInstallment = mortgageMonthly * Math.max(0, paidMonths);
  const mortgagePrincipalRepaid = mortgage - remainingLoan;
  const carryCost =
    outflow.slice(waitMonths).reduce((s, v) => s + v, 0) - totalInstallment;
  const waitRentCost = waitMonthlyHousing * waitMonths;

  notes.push(
    canJeonse
      ? `${cfg.waitTenureNote} 여기서는 전세로 봤습니다.`
      : `${cfg.waitTenureNote} 여기서는 월세(월 ${Math.round(monthlyRent / 10000).toLocaleString('ko-KR')}만)로 봤습니다.`
  );
  notes.push(
    plan.interimDeferred
      ? `중도금 이자 ${Math.round(interimInterest / 10000).toLocaleString('ko-KR')}만은 이자후불제라 입주 때 한꺼번에 냅니다.`
      : '중도금 이자를 대기 기간에 매달 냅니다.'
  );
  if (plan.resaleBanMonths > 0) {
    notes.push(
      `전매제한 ${plan.resaleBanMonths}개월 — 그 기간에는 팔 수 없습니다. 종료자산에는 안 들어가지만 유동성 제약입니다.`
    );
  }
  if (heldYears < RULES.tenure.capitalGainsTax.minHoldYears) {
    warnings.push(
      `입주 후 보유가 ${heldYears.toFixed(1)}년뿐이라 1세대1주택 비과세(2년)를 못 채웁니다.`
    );
  }

  const recovered = endPrice - remainingLoan - sellingFee - cgt.total;

  const netHousingCost =
    acquisitionCost + interimInterest + waitRentCost + waitBrokerage +
    (totalInstallment - mortgagePrincipalRepaid) + carryCost + sellingFee + cgt.total;

  return {
    initialOutlay,
    downPayment,
    waitDeposit: waitDepositOwn,
    waitRentCost,
    interimInterest,
    mortgagePrincipalRepaid,
    mortgageInterest: totalInstallment - mortgagePrincipalRepaid,
    carryCost,
    moveInCash,
    mortgage,
    recovered,
    netHousingCost,
    acquisitionCost,
    sellingFee,
    capitalGainsTax: cgt.total,
    waitBrokerage,
    waitMode,
    waitMonthlyRent: monthlyRent,
    outflow,
    lumps,
    notes,
    warnings,
  };
}

/** 납입 일정 한 줄 */
export interface PaymentStep {
  label: string;
  monthOffset: number;
  amount: number;
  /** 자기 돈인가, 집단대출인가 */
  funded: 'cash' | 'loan';
  note?: string;
}

/**
 * 계약부터 입주까지의 납입 일정을 펼칩니다.
 *
 * 화면에 "10%/60%/30%" 비율만 적으면 언제 얼마가 나가는지 안 보입니다.
 * 청약의 어려움은 비율이 아니라 **시점**에 있습니다.
 */
export function paymentSchedule(plan: SubscriptionPlan): PaymentStep[] {
  const cfg = RULES.subscription;
  const waitMonths = Math.round(plan.waitYears * 12);
  const steps: PaymentStep[] = [
    {
      label: '계약금',
      monthOffset: 0,
      amount: plan.price * plan.downPaymentRatio,
      funded: 'cash',
      note: '자기 돈으로 냅니다 — 대출이 안 됩니다.',
    },
  ];
  const interim = plan.price * plan.interimRatio;
  const per = interim / cfg.interimInstallments;
  for (let k = 1; k <= cfg.interimInstallments; k++) {
    steps.push({
      label: `중도금 ${k}회`,
      monthOffset: Math.round((waitMonths * k) / (cfg.interimInstallments + 1)),
      amount: per,
      funded: 'loan',
      note: k === 1 ? '집단대출로 나갑니다 — 자기 돈은 안 나갑니다.' : undefined,
    });
  }
  /*
   * 입주 시점은 "잔금 + 중도금 상환" 을 한 줄로 두면 안 됩니다. 그 액수의 대부분은
   * 주담대로 갈아타는 것이고 실제 자기 돈은 나머지뿐인데, 한 줄에 '현금' 이라 적으면
   * 4.5억을 현금으로 마련해야 하는 것처럼 읽힙니다. 조달 방법으로 쪼갭니다.
   */
  const balanceRatio = Math.max(0, 1 - plan.downPaymentRatio - plan.interimRatio);
  const dueAtMoveIn = plan.price * balanceRatio + interim;
  const mortgage = Math.min(plan.price * plan.mortgageLtv, dueAtMoveIn);
  steps.push({
    label: '잔금·중도금 — 주담대',
    monthOffset: waitMonths,
    amount: mortgage,
    funded: 'loan',
    note: '중도금 집단대출을 주담대로 갈아탑니다 — 자기 돈이 나가지 않습니다.',
  });
  steps.push({
    label: '잔금·중도금 — 현금',
    monthOffset: waitMonths,
    amount: dueAtMoveIn - mortgage,
    funded: 'cash',
    note: '주담대로 못 채운 나머지. 대기 중 전세보증금을 돌려받아 충당합니다.',
  });
  return steps;
}

/**
 * 청약 결과를 tenure 엔진이 먹는 모양으로 빚습니다.
 *
 * 방향이 **subscription → tenure** 여야 합니다. tenure 가 청약을 알면 순환
 * 참조가 되고, 무엇보다 청약은 선택 갈래라 엔진의 기본 축이 아닙니다.
 *
 * 원금상환 대칭은 그대로 성립합니다 — 주담대 원금은 `netHousingCost` 에서
 * 빠져 있고, 종료 시 `recovered` 로 돌아옵니다.
 */
export function subscriptionLegPlan(
  plan: SubscriptionPlan,
  a: TenureAssumptions,
  equity: number,
  termYears: number
): LegPlan {
  const r = subscriptionPlan(plan, a, equity, termYears);
  return {
    kind: 'subscription',
    initialOutlay: r.initialOutlay,
    outflow: r.outflow,
    lumps: r.lumps,
    recovered: r.recovered,
    breakdown: {
      principalRepaid: r.mortgagePrincipalRepaid,
      interestPaid: r.mortgageInterest + r.interimInterest,
      rentPaid: r.waitRentCost,
      carryCost: r.carryCost,
      netCost: r.netHousingCost,
    },
    detail: {
      planPrice: plan.price,
      acquisitionCost: r.acquisitionCost,
      sellingFee: r.sellingFee,
      capitalGainsTax: r.capitalGainsTax,
      waitBrokerage: r.waitBrokerage,
      waitMode: r.waitMode === 'jeonse' ? 1 : 0,
      waitMonthlyRent: r.waitMonthlyRent,
      downPayment: r.downPayment,
      waitDeposit: r.waitDeposit,
      waitYears: plan.waitYears,
      interimInterest: r.interimInterest,
      moveInCash: r.moveInCash,
      mortgage: r.mortgage,
      resaleBanMonths: plan.resaleBanMonths,
    },
    notes: [...r.warnings, ...r.notes],
  };
}
