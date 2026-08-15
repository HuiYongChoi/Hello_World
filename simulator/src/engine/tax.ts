/**
 * 보유세·양도세·임대차 중개보수 — 거주형태 비교에 필요한 세금 모듈.
 *
 * `costs.ts` 가 **살 때** 드는 돈(취득세·매매중개보수)을 다룬다면, 여기는
 * **갖고 있는 동안**과 **팔 때** 드는 돈을 다룹니다. 매수와 임차를 같은 자를 대고
 * 비교하려면 이 둘이 반드시 들어가야 합니다 — 빠뜨리면 매수가 부당하게 유리해집니다.
 *
 * 모든 세율·상한은 `rules/*.json` 에 있고 여기엔 산식만 있습니다.
 */

import { RULES } from './rules';

/** 누진 산식: 과세표준이 속한 구간의 누진공제 방식 (base + 초과분×rate) */
function progressiveByBase(
  taxBase: number,
  brackets: { maxBase: number | null; base: number; rate: number }[]
): number {
  if (taxBase <= 0) return 0;
  let lower = 0;
  for (const b of brackets) {
    if (b.maxBase === null || taxBase <= b.maxBase) {
      return b.base + (taxBase - lower) * b.rate;
    }
    lower = b.maxBase;
  }
  return 0;
}

// ── 재산세 ──────────────────────────────────────────────────────

export interface PropertyTaxResult {
  /** 시세에서 환산한 공시가격 */
  publishedPrice: number;
  /** 공시가격 × 공정시장가액비율 */
  taxBase: number;
  /** 1주택 특례세율이 적용됐는지 */
  specialRate: boolean;
  propertyTax: number;
  urbanAreaTax: number;
  localEducationTax: number;
  /** 연간 합계 */
  total: number;
}

/** 시세 기준 연간 재산세. 1주택 특례세율은 공시가격 9억 이하에만 적용됩니다. */
export function propertyTax(marketPrice: number, isSingleHome = true): PropertyTaxResult {
  const cfg = RULES.tenure.propertyTax;
  const publishedPrice = Math.max(0, marketPrice) * cfg.publishedPriceRatio;
  const taxBase = publishedPrice * cfg.fairMarketRatio;

  const specialRate = isSingleHome && publishedPrice <= cfg.specialRateMaxPublished;
  const brackets = specialRate ? cfg.specialBrackets : cfg.standardBrackets;

  const tax = progressiveByBase(taxBase, brackets);
  const urbanAreaTax = taxBase * cfg.urbanAreaRate;
  const localEducationTax = tax * cfg.localEducationTaxRatio;

  return {
    publishedPrice,
    taxBase,
    specialRate,
    propertyTax: tax,
    urbanAreaTax,
    localEducationTax,
    total: tax + urbanAreaTax + localEducationTax,
  };
}

// ── 양도소득세 ──────────────────────────────────────────────────

export interface CapitalGainsInput {
  salePrice: number;
  buyPrice: number;
  /** 필요경비 — 취득세·법무비·매수/매도 중개보수. 이사·수리비는 제외입니다. */
  expenses: number;
  holdYears: number;
  /** 실거주 기간. 장기보유특별공제의 거주분 판정에 씁니다. */
  liveYears: number;
}

export interface CapitalGainsResult {
  /** 양도차익 = 양도가액 − 취득가액 − 필요경비 */
  gain: number;
  /** 1세대1주택 12억 이하로 전액 비과세됐는지 */
  exempt: boolean;
  /** 12억 초과 안분 후 과세대상 양도차익 */
  taxableGain: number;
  longTermDeductionRate: number;
  longTermDeduction: number;
  taxBase: number;
  incomeTax: number;
  localIncomeTax: number;
  total: number;
  note: string;
}

const ZERO_GAINS = (gain: number, note: string): CapitalGainsResult => ({
  gain,
  exempt: true,
  taxableGain: 0,
  longTermDeductionRate: 0,
  longTermDeduction: 0,
  taxBase: 0,
  incomeTax: 0,
  localIncomeTax: 0,
  total: 0,
  note,
});

/**
 * 1세대1주택 양도소득세.
 *
 * 12억까지는 비과세이고 **초과분만 안분해서** 과세합니다. 서울 밖 3개 지역
 * 가격대에서는 대부분 0이 나오지만, 2년을 못 채우면 비과세가 통째로 날아가고
 * 단기 중과세율(60~70%)이 붙습니다 — 이 절벽이 이 함수의 존재 이유입니다.
 */
export function capitalGainsTax(input: CapitalGainsInput): CapitalGainsResult {
  const cfg = RULES.tenure.capitalGainsTax;
  const gain = input.salePrice - input.buyPrice - input.expenses;
  if (gain <= 0) return ZERO_GAINS(gain, '양도차익이 없어 과세되지 않습니다.');

  // 보유 2년 미만 — 비과세 배제 + 단기 중과세율
  if (input.holdYears < cfg.minHoldYears) {
    const short =
      cfg.shortTermRates.find((r) => input.holdYears < r.maxYears) ??
      cfg.shortTermRates[cfg.shortTermRates.length - 1];
    const taxBase = Math.max(0, gain - cfg.basicDeduction);
    const incomeTax = taxBase * short.rate;
    const localIncomeTax = incomeTax * cfg.localIncomeTaxRatio;
    return {
      gain,
      exempt: false,
      taxableGain: gain,
      longTermDeductionRate: 0,
      longTermDeduction: 0,
      taxBase,
      incomeTax,
      localIncomeTax,
      total: incomeTax + localIncomeTax,
      note: `보유 ${input.holdYears}년 — 2년 미만이라 비과세가 배제되고 ${(short.rate * 100).toFixed(0)}% 단기세율이 적용됩니다.`,
    };
  }

  if (input.salePrice <= cfg.exemptionPrice) {
    return ZERO_GAINS(gain, '1세대1주택 12억 이하 — 전액 비과세입니다.');
  }

  // 12억 초과분 안분
  const taxableGain = (gain * (input.salePrice - cfg.exemptionPrice)) / input.salePrice;

  const holdRate =
    input.holdYears >= cfg.longTermHold.minYears
      ? Math.min(cfg.longTermHold.maxRate, input.holdYears * cfg.longTermHold.ratePerYear)
      : 0;
  const liveRate =
    holdRate > 0 && input.liveYears >= cfg.longTermLive.minYears
      ? Math.min(cfg.longTermLive.maxRate, input.liveYears * cfg.longTermLive.ratePerYear)
      : 0;
  const longTermDeductionRate = holdRate + liveRate;
  const longTermDeduction = taxableGain * longTermDeductionRate;

  const taxBase = Math.max(0, taxableGain - longTermDeduction - cfg.basicDeduction);
  const bracket =
    cfg.brackets.find((b) => b.maxBase === null || taxBase <= b.maxBase) ??
    cfg.brackets[cfg.brackets.length - 1];
  const incomeTax = Math.max(0, taxBase * bracket.rate - bracket.deduction);
  const localIncomeTax = incomeTax * cfg.localIncomeTaxRatio;

  return {
    gain,
    exempt: false,
    taxableGain,
    longTermDeductionRate,
    longTermDeduction,
    taxBase,
    incomeTax,
    localIncomeTax,
    total: incomeTax + localIncomeTax,
    note: `12억 초과분만 과세. 장기보유특별공제 ${(longTermDeductionRate * 100).toFixed(0)}% 적용.`,
  };
}

// ── 임대차 중개보수 ─────────────────────────────────────────────

/** 임대차 거래금액 = 보증금 + 월세×100 (환산액이 5천만 미만이면 월세×70) */
export function leaseTransactionAmount(deposit: number, monthlyRent: number): number {
  const cfg = RULES.tenure.leaseBrokerage;
  const standard = deposit + monthlyRent * cfg.standardMultiplier;
  if (standard >= cfg.lowDepositThreshold) return standard;
  return deposit + monthlyRent * cfg.lowDepositMultiplier;
}

/** 임대차 중개보수 (상한요율, VAT 포함) */
export function leaseBrokerageFee(deposit: number, monthlyRent: number): number {
  const cfg = RULES.tenure.leaseBrokerage;
  const amount = leaseTransactionAmount(deposit, monthlyRent);
  for (const b of cfg.brackets) {
    if (b.maxPrice === null || amount <= b.maxPrice) {
      const raw = amount * b.rate;
      const capped = b.cap !== null ? Math.min(raw, b.cap) : raw;
      return capped * (1 + cfg.vatRatio);
    }
  }
  return 0;
}
