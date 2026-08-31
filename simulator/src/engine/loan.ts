import { calcCosts } from './costs';
import { clamp, floorToManwon, monthlyPayment, presentValue, totalInterest } from './finance';
import { money } from './format';
import { RULES, isCapitalArea, isRegulated, type ProductRule } from './rules';
import type {
  BindingConstraint,
  DerivedScenario,
  LoanResult,
  Objective,
  Profile,
  Property,
} from './types';

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const bool = (v: unknown): boolean => v === true;

/**
 * 적용금리 산출.
 * 상품 rate.min~max 사이를 소득 수준으로 보간하고, 우대·할인을 차감한 뒤
 * 민감도 분석용 사용자 조정(rateAdjust)을 가산합니다.
 */
export function effectiveRate(
  product: ProductRule,
  profile: Profile,
  scenario: DerivedScenario
): number {
  const min = product.rate.min ?? 0.04;
  const max = product.rate.max ?? min;
  const incomeCap =
    num(product.eligibility.income_max) ??
    num(product.eligibility.income_max_newlywed) ??
    num(product.eligibility.income_max_single) ??
    100000000;
  const ratio = clamp(scenario.assessedIncome / incomeCap, 0, 1);
  let rate = min + (max - min) * ratio;

  if (scenario.isFirstTimeValid) rate -= product.rate.first_time_discount ?? 0;
  rate -= product.rate.online_discount ?? 0;

  return Math.max(0.001, rate + profile.rateAdjust);
}

/** 소득 요건 상한 — 상품별로 단일/신혼 기준이 갈리고 시행일이 붙습니다. */
function incomeLimitOf(
  product: ProductRule,
  scenario: DerivedScenario,
  profile: Profile
): { limit: number | undefined; pending: boolean } {
  const flat = num(product.eligibility.income_max);
  if (flat !== undefined) return { limit: flat, pending: false };

  const single = num(product.eligibility.income_max_single);
  const newlywed = num(product.eligibility.income_max_newlywed);
  if (single === undefined) return { limit: undefined, pending: false };
  if (!scenario.isNewlywed || newlywed === undefined) return { limit: single, pending: false };

  const from = product.eligibility.newlywed_income_effective_from;
  const notYet = typeof from === 'string' && profile.purchaseDate < from;
  return { limit: notYet ? single : newlywed, pending: notYet };
}

/**
 * 한도 계산 파이프라인 (설계안 §3.2).
 * STEP 1 자격게이트 → 2 LTV → 3 상품캡 → 4 상환능력 → 5 최종 min + binding constraint
 */
export function calcLoan(
  product: ProductRule,
  profile: Profile,
  scenario: DerivedScenario,
  property: Property
): LoanResult {
  const warnings: string[] = [];
  const capital = isCapitalArea(property.region);
  const regulated = isRegulated(property.sigungu);

  const costs = calcCosts({
    price: property.price,
    areaSqm: property.areaSqm,
    isFirstTimeValid: scenario.isFirstTimeValid,
    movingAndRepair: profile.movingAndRepair,
  });

  const reject = (reason: string): LoanResult => ({
    productId: product.id,
    productName: product.name,
    eligible: false,
    rejectReason: reason,
    limit: 0,
    limitLtv: 0,
    limitCap: 0,
    limitRepay: 0,
    limitPrice: property.price,
    appliedLtv: 0,
    bindingConstraint: 'PRICE',
    rate: 0,
    monthlyPayment: 0,
    totalInterest: 0,
    dtiRatio: 0,
    regulatoryRatio: 0,
    regulatoryCap: 0,
    regulatoryKind: 'DSR',
    limitBeforeRepay: 0,
    requiredIncome: 0,
    incomeGap: 0,
    requiredIncomeBlocked: false,
    incomeCap: null,
    downPayment: property.price,
    costs,
    requiredCash: property.price + costs.total,
    cashGap: property.price + costs.total - scenario.availableCash,
    feasible: false,
    tight: false,
    warnings,
  });

  // ── STEP 1: 자격 게이트 ────────────────────────────────────────────
  const el = product.eligibility;
  const { limit: incomeMax, pending: incomePending } = incomeLimitOf(product, scenario, profile);

  if (incomeMax !== undefined && scenario.assessedIncome > incomeMax) {
    return reject(`소득초과 (판정소득 ${fmtEok(scenario.assessedIncome)} > 상한 ${fmtEok(incomeMax)})`);
  }
  if (incomePending) {
    warnings.push('신혼 소득요건 완화는 2026-10-01 시행 예정 — 현재 단일 기준으로 판정했습니다.');
  }

  const networthMax = num(el.networth_max);
  if (networthMax !== undefined && profile.netWorth > networthMax) {
    return reject(`자산초과 (순자산 ${fmtEok(profile.netWorth)} > 요건 ${fmtEok(networthMax)})`);
  }

  const priceMax = scenario.isSingleHousehold
    ? (num(el.house_price_max_single) ?? num(el.house_price_max))
    : num(el.house_price_max);
  if (priceMax !== undefined && property.price > priceMax) {
    return reject(
      `주택가격초과 (${fmtEok(property.price)} > 상한 ${fmtEok(priceMax)}${
        scenario.isSingleHousehold ? ', 단독세대주 기준' : ''
      })`
    );
  }

  const areaMax = scenario.isSingleHousehold
    ? (num(el.area_max_sqm_single) ?? num(el.area_max_sqm))
    : num(el.area_max_sqm);
  if (areaMax !== undefined && property.areaSqm > areaMax) {
    return reject(
      `면적초과 (전용 ${property.areaSqm}㎡ > ${areaMax}㎡${
        scenario.isSingleHousehold ? ', 단독세대주 기준' : ''
      })`
    );
  }

  if (bool(el.requires_first_time) && !scenario.isFirstTimeValid) {
    return reject(`생애최초 소멸 (${scenario.firstTimeLostReason ?? '요건 미충족'})`);
  }
  if (bool(el.requires_no_house_household) && !scenario.hasNoHouseHousehold) {
    return reject('무주택세대 요건 미충족 (배우자 주택 보유중)');
  }
  if (bool(el.requires_newborn_within_2y) && !profile.newbornWithin2y) {
    return reject('신생아 요건 미충족 (2년 내 출산·입양 자녀 없음)');
  }

  const minAge = num(el.min_age_if_single_household);
  if (minAge !== undefined && scenario.isSingleHousehold && !profile.isOver30) {
    return reject(`연령미달 (단독세대주는 만 ${minAge}세 이상)`);
  }

  const effFrom = el.effective_from;
  if (typeof effFrom === 'string' && profile.purchaseDate < effFrom) {
    return reject(`시행 전 (${effFrom} 시행 예정)`);
  }

  // ── STEP 2: LTV 한도 ──────────────────────────────────────────────
  const lim = product.limits;
  let ltv = capital
    ? (num(lim.ltv_capital) ?? 0.7)
    : scenario.isFirstTimeValid
      ? (num(lim.ltv_first_time_non_capital) ?? num(lim.ltv_non_capital) ?? 0.7)
      : (num(lim.ltv_non_capital) ?? 0.7);

  if (regulated) {
    const reg = num(lim.ltv_regulated);
    if (reg !== undefined) {
      ltv = Math.min(ltv, reg);
      warnings.push(`규제지역(${property.sigungu}) — LTV ${(reg * 100).toFixed(0)}%로 제한`);
    }
  }
  const nonCapitalLtv = num(lim.ltv_first_time_non_capital) ?? num(lim.ltv_non_capital);
  if (capital && scenario.isFirstTimeValid && nonCapitalLtv !== undefined && nonCapitalLtv > ltv) {
    warnings.push(
      `수도권 — 생애최초 LTV ${(nonCapitalLtv * 100).toFixed(0)}% 우대가 무효화되어 ${(
        ltv * 100
      ).toFixed(0)}% 적용`
    );
  }
  const limitLtv = property.price * ltv;

  // ── STEP 3: 상품 캡 ───────────────────────────────────────────────
  let limitCap =
    scenario.isSingleHousehold && num(lim.cap_single_household) !== undefined
      ? (num(lim.cap_single_household) as number)
      : /*
         * 생애최초 한도 우대. LTV 와 같은 모양으로 둡니다.
         *
         * 보금자리론처럼 **생애최초가 자격 요건은 아닌데 우대는 있는** 상품이
         * 있습니다. 우대값을 무조건값으로 박아 두면 생애최초가 아닌 사람에게도
         * 우대 한도가 나갑니다 — 실제로 그렇게 잘못 들어가 있었습니다.
         */
        scenario.isFirstTimeValid && num(lim.cap_first_time) !== undefined
        ? (num(lim.cap_first_time) as number)
        : (num(lim.cap) ?? Number.POSITIVE_INFINITY);

  const absCapCapital = num(lim.absolute_cap_capital);
  if (capital && absCapCapital !== undefined) {
    if (absCapCapital < limitCap) {
      warnings.push(`수도권 대출 절대상한 ${fmtEok(absCapCapital)} 적용`);
    }
    limitCap = Math.min(limitCap, absCapCapital);
  }

  // ── STEP 4: 상환능력 한도 ─────────────────────────────────────────
  const dsrExempt = bool(lim.dsr_exempt);
  const rate = effectiveRate(product, profile, scenario);
  const ratioForRepay = dsrExempt ? (num(lim.dti) ?? 0.6) : (num(lim.dsr) ?? 0.4);
  const stress = dsrExempt ? 0 : (num(lim.stress_rate_add) ?? 0);
  const appliedRateForLimit = rate + stress;
  if (stress > 0) {
    warnings.push(
      `스트레스 DSR — 한도 산정 시 금리 +${(stress * 100).toFixed(1)}%p 가산 적용`
    );
  }

  const annualCapacity =
    scenario.assessedIncome * ratioForRepay - profile.existingMonthlyDebt * 12;
  const limitRepay =
    annualCapacity <= 0
      ? 0
      : presentValue(annualCapacity / 12, appliedRateForLimit, profile.termYears);

  // ── STEP 5: 최종 ──────────────────────────────────────────────────
  const limitPrice = property.price * (1 - RULES.defaults.minEquityRatio);

  /*
   * **"LTV 는 통과한다고 치면 얼마까지, 그러려면 얼마를 벌어야 하나."**
   *
   * 상환능력을 빼고 LTV·상품캡·가격만 본 최대치를 내고, 그 금액을 상환능력으로
   * 받아 내려면 필요한 연소득을 DTI·DSR 식을 뒤집어 구합니다. 한도가 막혔다는
   * 사실만 알려 주면 절반만 답한 것입니다 — 다음 행동은 "얼마를 더 벌어야 하나"
   * 이기 때문입니다.
   *
   * 뒤집는 식은 STEP 4 와 정확히 대칭이어야 합니다. 스트레스 금리로 잰 원리금을
   * 쓰지 않으면 필요소득이 실제보다 낮게 나옵니다.
   */
  const limitBeforeRepay = Math.max(0, Math.min(limitLtv, limitCap, limitPrice));
  /*
   * **금리가 소득에 따라 움직여서 한 번에 안 풀립니다.**
   *
   * `effectiveRate` 는 소득이 자격 상한에 가까울수록 금리를 올립니다(우대 축소).
   * 그래서 "필요소득 → 금리 → 원리금 → 필요소득" 이 서로를 물고 있습니다.
   * 현재 금리로 한 번만 뒤집으면 그 소득을 벌었을 때 금리가 올라 있어 한도가
   * 조금 모자랍니다 — 실제로 5.2억 물건에서 50만원쯤 어긋났습니다.
   *
   * 몇 번 돌리면 금리 밴드가 좁아 금방 수렴합니다.
   */
  let requiredIncome = 0;
  let probeRate = appliedRateForLimit;
  for (let i = 0; i < 5; i++) {
    const pmt = monthlyPayment(limitBeforeRepay, probeRate, profile.termYears);
    const next =
      ratioForRepay > 0
        ? (pmt * 12 + profile.existingMonthlyDebt * 12) / ratioForRepay
        : 0;
    if (Math.abs(next - requiredIncome) < 1000) {
      requiredIncome = next;
      break;
    }
    requiredIncome = next;
    probeRate =
      effectiveRate(product, profile, { ...scenario, assessedIncome: requiredIncome }) + stress;
  }
  /*
   * 만원 단위로 **올림**합니다. 딱 떨어지는 값을 적으면 그 소득을 벌어도 원 단위
   * 반올림 때문에 한도가 한 뼘 모자랍니다 — "6,561만이면 된다" 가 사실이어야 합니다.
   */
  requiredIncome = Math.ceil(requiredIncome / 10000) * 10000;
  /*
   * 정책상품은 **소득이 낮아야 자격이 나오고 높아야 한도가 나옵니다.** 둘이
   * 어긋나면 어떤 소득으로도 그 한도에 닿을 수 없습니다 — 소득을 올리는 순간
   * 자격을 잃기 때문입니다. 이 구조적 막힘은 따로 말해 줘야 합니다.
   */
  const requiredIncomeBlocked =
    incomeMax !== undefined && requiredIncome > incomeMax;

  const candidates: { key: BindingConstraint; value: number }[] = [
    { key: 'LTV', value: limitLtv },
    { key: 'CAP', value: limitCap },
    { key: dsrExempt ? 'DTI' : 'DSR', value: limitRepay },
    { key: 'PRICE', value: limitPrice },
  ];
  const winner = candidates.reduce((a, b) => (b.value < a.value ? b : a));
  const limit = floorToManwon(Math.max(0, winner.value));

  if (limit <= 0) {
    return {
      ...reject('상환능력 한도 0 — 판정소득 대비 기존 부채가 과다합니다'),
      limitLtv,
      limitCap: Number.isFinite(limitCap) ? limitCap : 0,
      limitRepay,
      appliedLtv: ltv,
    };
  }

  const monthly = monthlyPayment(limit, rate, profile.termYears);
  const interest = totalInterest(limit, rate, profile.termYears);
  const downPayment = property.price - limit;
  const requiredCash = Math.round(downPayment + costs.total);
  const dtiRatio =
    scenario.assessedIncome > 0
      ? (monthly * 12 + profile.existingMonthlyDebt * 12) / scenario.assessedIncome
      : 0;

  /*
   * 규제 비율은 **스트레스 금리로 잰 값**입니다. 실제 금리로 잰 dtiRatio 보다
   * 높고, 한도를 깎는 것도 이쪽입니다. 둘을 같이 보여줘야 "부담 20%인데 왜
   * 한도가 막혔나"가 설명됩니다.
   */
  const stressedMonthly = monthlyPayment(limit, appliedRateForLimit, profile.termYears);
  const regulatoryRatio =
    scenario.assessedIncome > 0
      ? (stressedMonthly * 12 + profile.existingMonthlyDebt * 12) / scenario.assessedIncome
      : 0;

  const feasible = requiredCash <= scenario.availableCash;
  const tight =
    feasible && requiredCash > scenario.availableCash * RULES.defaults.cashTightRatio;

  // 부대 경고
  if (product.obligations.move_in_months > 0) {
    warnings.push(
      `실거주 의무 — 대출 실행 후 ${product.obligations.move_in_months}개월 내 전입` +
        (product.obligations.residency_years > 0
          ? `, ${product.obligations.residency_years}년 이상 거주`
          : '')
    );
  }
  if (scenario.giftTaxFlag) {
    warnings.push('혼인 전 단독명의에 배우자 자금 투입 — 증여세 과세 대상 검토 필요');
  }
  if (scenario.contributionRatioFlag) {
    warnings.push('혼인 전 공동명의 — 지분율과 실제 자금부담 비율이 어긋나면 증여로 과세됩니다');
  }
  /*
   * 소득을 올리면 자격을 잃는 구간입니다. "소득이 부족해 한도가 막혔다" 까지만
   * 말하면 사용자는 소득을 올리려 하는데, 그 순간 상품이 사라집니다.
   */
  if (requiredIncomeBlocked && (winner.key === 'DTI' || winner.key === 'DSR')) {
    warnings.push(
      `구조적 막힘 — LTV 한도 ${fmtEok(limitBeforeRepay)}를 받으려면 연소득 ` +
        `${fmtEok(requiredIncome)}가 필요한데, 그 소득이면 자격 상한 ` +
        `${fmtEok(incomeMax as number)}을 넘어 상품 자체를 잃습니다`
    );
  }
  if (dtiRatio > RULES.defaults.dtiWarnLine) {
    warnings.push(`상환부담률 ${(dtiRatio * 100).toFixed(0)}% — 안전선(35%) 초과`);
  }

  return {
    productId: product.id,
    productName: product.name,
    eligible: true,
    limit,
    limitLtv,
    limitCap: Number.isFinite(limitCap) ? limitCap : 0,
    limitRepay,
    limitPrice,
    appliedLtv: ltv,
    bindingConstraint: winner.key,
    rate,
    monthlyPayment: monthly,
    totalInterest: interest,
    dtiRatio,
    regulatoryRatio,
    regulatoryCap: ratioForRepay,
    regulatoryKind: dsrExempt ? 'DTI' : 'DSR',
    limitBeforeRepay,
    requiredIncome,
    incomeGap: requiredIncome - scenario.assessedIncome,
    requiredIncomeBlocked,
    incomeCap: incomeMax ?? null,
    downPayment,
    costs,
    requiredCash,
    cashGap: requiredCash - scenario.availableCash,
    feasible,
    tight,
    warnings,
  };
}

/** 전 상품 계산 + 목적함수별 랭킹 (설계안 §3.3) */
export function rankProducts(
  profile: Profile,
  scenario: DerivedScenario,
  property: Property,
  objective: Objective
): { all: LoanResult[]; best: LoanResult | null } {
  const all = RULES.products.map((p) => calcLoan(p, profile, scenario, property));

  const eligible = all.filter((r) => r.eligible);
  // 1차 필터: 실행가능. 전부 자금부족이면 필터를 풀고 차선을 보여줍니다.
  const pool = eligible.filter((r) => r.feasible);
  const ranked = (pool.length > 0 ? pool : eligible).slice().sort((a, b) => {
    const primary = compareByObjective(a, b, objective);
    if (primary !== 0) return primary;
    // 동점 처리: 고정금리 > 변동금리, 중도상환수수료 면제 우대
    const fixed = Number(isFixed(b)) - Number(isFixed(a));
    if (fixed !== 0) return fixed;
    return Number(hasNoEarlyFee(b)) - Number(hasNoEarlyFee(a));
  });

  const sortedAll = all.slice().sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    return compareByObjective(a, b, objective);
  });

  return { all: sortedAll, best: ranked[0] ?? null };
}

function compareByObjective(a: LoanResult, b: LoanResult, objective: Objective): number {
  switch (objective) {
    case 'interest':
      return a.totalInterest - b.totalInterest;
    case 'monthly':
      return a.monthlyPayment - b.monthlyPayment;
    case 'limit':
      return b.limit - a.limit;
    case 'safety':
      return a.dtiRatio - b.dtiRatio;
  }
}

function isFixed(r: LoanResult): boolean {
  return RULES.products.find((p) => p.id === r.productId)?.features?.fixed_rate === true;
}
function hasNoEarlyFee(r: LoanResult): boolean {
  return RULES.products.find((p) => p.id === r.productId)?.features?.early_repayment_fee === false;
}

export const OBJECTIVE_LABELS: Record<Objective, string> = {
  interest: '이자 최소화',
  monthly: '월납 최소화',
  limit: '한도 최대화',
  safety: '안전 우선',
};

export const CONSTRAINT_LABELS: Record<BindingConstraint, string> = {
  LTV: 'LTV가 막음',
  CAP: '상품 캡이 막음',
  DSR: 'DSR이 막음',
  DTI: 'DTI가 막음',
  PRICE: '매매가가 상한',
};

/**
 * 한도가 그 숫자인 이유를 한 줄로 — 가이드 03.
 *
 * "3.64억"만 보여주면 왜 그 숫자인지 모릅니다. 툴팁에 숨기면 인쇄에서 통째로
 * 빠지므로 **화면에 상시 노출**할 짧은 문장을 냅니다. 네 후보(LTV·캡·상환능력·
 * 매매가) 중 무엇이 이겼는지와, 그 값이 어떻게 나왔는지를 같이 적습니다.
 */
export function limitDerivation(result: LoanResult, property: Property): string {
  const ltv = `LTV ${(result.appliedLtv * 100).toFixed(0)}%×${money(property.price)}`;
  switch (result.bindingConstraint) {
    case 'LTV':
      return `${ltv} = ${money(result.limitLtv)}`;
    case 'CAP':
      return `${ltv} → 상품 한도 ${money(result.limitCap)}로 절삭`;
    case 'DSR':
      return `${ltv} → 스트레스 DSR ${money(result.limitRepay)}로 절삭`;
    case 'DTI':
      return `${ltv} → DTI ${money(result.limitRepay)}로 절삭`;
    case 'PRICE':
      return `매매가 ${money(property.price)}가 상한`;
  }
}

/**
 * 인쇄본 각주용 전체 문장 — 화면 칩보다 길게, 네 후보를 모두 적습니다.
 * 종이만 들고 나가도 빠지는 정보가 없어야 합니다 (검수 ①).
 */
export function limitFootnote(result: LoanResult, property: Property): string {
  const parts = [
    `LTV ${(result.appliedLtv * 100).toFixed(0)}% × 매매가 ${money(property.price)} = ${money(result.limitLtv)}`,
    `상품 한도 ${money(result.limitCap)}`,
    `상환능력 ${money(result.limitRepay)}`,
    `매매가 상한 ${money(result.limitPrice)}`,
  ];
  return (
    `${result.productName} 한도 ${money(result.limit)} = 네 값 중 최솟값. ` +
    `${parts.join(' · ')}. ` +
    `${requiredIncomeNote(result)} ` +
    `구속 조건은 ${CONSTRAINT_LABELS[result.bindingConstraint]}. ${constraintAdvice(result, property)}`
  );
}

/**
 * binding constraint별 "다음 행동" 제안.
 * 같은 LTV 제약이라도 수도권이라 막힌 것인지, 규제지역이라 막힌 것인지에 따라
 * 취해야 할 행동이 완전히 달라지므로 물건 맥락을 함께 봅니다.
 */
/**
 * "LTV 는 통과한다고 치면 얼마까지, 그러려면 얼마를 벌어야 하나" 한 문장.
 *
 * 한도가 막혔다는 사실만으로는 다음 행동이 안 나옵니다. 필요소득을 같이 적어야
 * "얼마를 더 벌면 되나" 와 "그게 가능한가" 를 바로 판단할 수 있습니다.
 */
export function requiredIncomeNote(result: LoanResult): string {
  if (result.limitBeforeRepay <= 0) return '';
  const head = `LTV·상품한도까지면 ${money(result.limitBeforeRepay)}, 그러려면 연소득 ${money(result.requiredIncome)} 필요`;
  if (result.requiredIncomeBlocked) {
    return `${head} — 그런데 자격 상한이 ${money(result.incomeCap as number)}라 소득을 올리면 상품을 잃습니다.`;
  }
  if (result.incomeGap > 0) {
    return `${head} (지금보다 ${money(result.incomeGap)} 부족).`;
  }
  return `${head} — 이미 충족해 상환능력은 한도를 막지 않습니다.`;
}

export function constraintAdvice(result: LoanResult, property: Property): string {
  const product = RULES.products.find((p) => p.id === result.productId);
  const capital = isCapitalArea(property.region);
  const regulated = isRegulated(property.sigungu);

  switch (result.bindingConstraint) {
    case 'LTV': {
      if (regulated) {
        return `규제지역(${property.sigungu})이라 LTV가 눌렸습니다 — 비규제 지역 물건이면 한도가 올라갑니다.`;
      }
      const nonCapital =
        num(product?.limits.ltv_first_time_non_capital) ?? num(product?.limits.ltv_non_capital);
      if (capital && nonCapital !== undefined && nonCapital > result.appliedLtv) {
        return `수도권이라 생애최초 LTV ${(nonCapital * 100).toFixed(0)}% 우대가 죽었습니다 — 비수도권 물건이면 한도가 ${money(
          property.price * nonCapital - result.limit
        )} 늘어납니다.`;
      }
      return `이미 최대 LTV ${(result.appliedLtv * 100).toFixed(
        0
      )}%를 적용받고 있습니다 — 한도를 더 늘리려면 매매가가 더 높은 물건이어야 합니다.`;
    }
    case 'CAP':
      return '상품별 대출 한도 상한에 걸렸습니다 — 한도가 더 큰 상품이나 혼합 조달을 검토하세요.';
    case 'DSR':
      return '소득을 늘리거나 기존 대출을 줄여야 한도가 열립니다. 스트레스 금리가 가산된 점도 감안하세요.';
    case 'DTI':
      return '소득을 늘리거나 만기를 늘리면 한도가 열립니다.';
    case 'PRICE':
      return '매매가 자체가 한도입니다 — 대출 여력이 남아 있습니다.';
  }
}

function fmtEok(v: number): string {
  return `${(v / 100000000).toFixed(2)}억`;
}
