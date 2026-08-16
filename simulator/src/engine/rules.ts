import ruleset from '../rules/2026-08.json';
import type { RegionId } from './types';

export interface ProductRule {
  id: string;
  name: string;
  shortName: string;
  type: 'policy' | 'bank';
  eligibility: Record<string, number | boolean | string | undefined>;
  limits: Record<string, number | boolean | undefined>;
  rate: Record<string, number | undefined>;
  obligations: { move_in_months: number; residency_years: number };
  features?: Record<string, number | boolean | undefined>;
}

export interface RegionRule {
  id: RegionId;
  label: string;
  isCapitalArea: boolean;
  note: string;
  checklist: string[];
}

/**
 * 신축 하한 통계.
 *
 * 판정에는 `p25` 를 씁니다 — 최저가는 외곽 나홀로 단지 한 건에 흔들립니다.
 * 다만 `lowest` 도 같이 담아 화면에 병기합니다. 둘의 간격이 곧 그 지역 신축
 * 가격대의 폭이고, 간격이 크면 `p25` 도 그만큼 덜 단단합니다.
 */
export interface NewBuildFloorStat {
  p25: number;
  lowest: number;
  median: number;
  n: number;
}

export interface Ruleset {
  version: string;
  effectiveFrom: string;
  sunset: string | null;
  label: string;
  disclaimer: string;
  regions: RegionRule[];
  regulatedSigungu: string[];
  products: ProductRule[];
  costs: {
    acquisitionTax: {
      note: string;
      brackets: { maxPrice: number | null; kind: string; rate?: number }[];
      localEducationTaxRatio: number;
      ruralTaxRate: number;
      ruralTaxAreaThresholdSqm: number;
      firstTimeReliefMax: number;
      firstTimeReliefPriceMax: number;
    };
    brokerage: {
      note: string;
      brackets: { maxPrice: number | null; rate: number; cap: number | null }[];
      vatRatio: number;
    };
    legalAndBondDefault: number;
    movingAndRepairDefault: number;
  };
  appraisal: {
    note: string;
    newBuildMaxAge: number;
    newBuildMinPrice: Record<RegionId, NewBuildFloorStat>;
    /** 법정동코드 → 하한 통계. 권역 평균은 성산구와 마산을 상쇄시키므로 시군구가 우선입니다. */
    newBuildMinPriceByDistrict: Record<string, NewBuildFloorStat>;
    newBuildMinPriceNote: string;
    newBuildMinPriceAsOf: string;
    redevelopmentMinAge: number;
    redevelopmentStageThreshold: number;
    farThreshold: number;
    redevelopmentNote: string;
    districtTierReference: {
      note: string;
      changwon: { name: string; tier: number; note: string }[];
    };
  };
  tenure: {
    note: string;
    leaseBrokerage: {
      note: string;
      brackets: { maxPrice: number | null; rate: number; cap: number | null }[];
      vatRatio: number;
      standardMultiplier: number;
      lowDepositMultiplier: number;
      lowDepositThreshold: number;
    };
    propertyTax: {
      note: string;
      publishedPriceRatio: number;
      fairMarketRatio: number;
      specialRateMaxPublished: number;
      standardBrackets: { maxBase: number | null; base: number; rate: number }[];
      specialBrackets: { maxBase: number | null; base: number; rate: number }[];
      urbanAreaRate: number;
      localEducationTaxRatio: number;
    };
    capitalGainsTax: {
      note: string;
      exemptionPrice: number;
      minHoldYears: number;
      basicDeduction: number;
      shortTermRates: { maxYears: number; rate: number }[];
      longTermHold: { ratePerYear: number; maxRate: number; minYears: number };
      longTermLive: { ratePerYear: number; maxRate: number; minYears: number };
      brackets: { maxBase: number | null; rate: number; deduction: number }[];
      localIncomeTaxRatio: number;
    };
    jeonseLoan: { note: string; ltvCap: number; absoluteCap: number; rate: number };
    lease: {
      note: string;
      renewalYears: number;
      renewalCapRatio: number;
      renewalCapUses: number;
      conversionRateMax: number;
    };
    assumptionDefaults: {
      note: string;
      years: number;
      investmentReturnRate: number;
      depositGrowthRate: number;
      maintenanceRate: number;
      byRegion: Record<
        RegionId,
        { jeonseRatio: number; conversionRate: number; wolseDepositRatio: number }
      >;
    };
  };
  defaults: {
    termYears: number;
    minEquityRatio: number;
    dtiSafeLine: number;
    dtiWarnLine: number;
    cashTightRatio: number;
  };
}

export const RULES = ruleset as unknown as Ruleset;

export function getRegion(id: RegionId): RegionRule {
  const found = RULES.regions.find((r) => r.id === id);
  if (!found) throw new Error(`알 수 없는 지역군: ${id}`);
  return found;
}

export function isCapitalArea(id: RegionId): boolean {
  return getRegion(id).isCapitalArea;
}

export function isRegulated(sigungu: string): boolean {
  const trimmed = sigungu.trim();
  if (!trimmed) return false;
  return RULES.regulatedSigungu.some(
    (s) => trimmed === s || trimmed.includes(s) || s.includes(trimmed)
  );
}

export function getProduct(id: string): ProductRule {
  const found = RULES.products.find((p) => p.id === id);
  if (!found) throw new Error(`알 수 없는 상품: ${id}`);
  return found;
}
