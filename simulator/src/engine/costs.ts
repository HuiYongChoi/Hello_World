import { RULES } from './rules';
import type { CostBreakdown } from './types';

/** 주택 유상취득 취득세율. 6~9억 구간은 누진 산식 (가액×2/3억 − 3)/100. */
export function acquisitionTaxRate(price: number): number {
  const brackets = RULES.costs.acquisitionTax.brackets;
  for (const b of brackets) {
    if (b.maxPrice === null || price <= b.maxPrice) {
      if (b.kind === 'linear_6_9') {
        const eok = price / 100000000;
        return ((eok * 2) / 3 - 3) / 100;
      }
      return b.rate ?? 0;
    }
  }
  return 0;
}

/** 매매 중개보수 (상한요율, VAT 포함) */
export function brokerageFee(price: number): number {
  const { brackets, vatRatio } = RULES.costs.brokerage;
  for (const b of brackets) {
    if (b.maxPrice === null || price <= b.maxPrice) {
      const raw = price * b.rate;
      const capped = b.cap !== null ? Math.min(raw, b.cap) : raw;
      return capped * (1 + vatRatio);
    }
  }
  return 0;
}

export interface CostInput {
  price: number;
  areaSqm: number;
  isFirstTimeValid: boolean;
  movingAndRepair: number;
}

export function calcCosts(input: CostInput): CostBreakdown {
  const cfg = RULES.costs.acquisitionTax;
  const rate = acquisitionTaxRate(input.price);
  const acquisitionTax = input.price * rate;

  const relief =
    input.isFirstTimeValid && input.price <= cfg.firstTimeReliefPriceMax
      ? Math.min(cfg.firstTimeReliefMax, acquisitionTax)
      : 0;

  const localEducationTax = acquisitionTax * cfg.localEducationTaxRatio;
  const ruralTax =
    input.areaSqm > cfg.ruralTaxAreaThresholdSqm ? input.price * cfg.ruralTaxRate : 0;

  const brokerage = brokerageFee(input.price);
  const legalAndBond = RULES.costs.legalAndBondDefault;
  const movingAndRepair = input.movingAndRepair;

  const total =
    acquisitionTax -
    relief +
    localEducationTax +
    ruralTax +
    brokerage +
    legalAndBond +
    movingAndRepair;

  return {
    acquisitionTax,
    acquisitionTaxRelief: relief,
    localEducationTax,
    ruralTax,
    brokerage,
    legalAndBond,
    movingAndRepair,
    total: Math.round(total),
  };
}
