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
