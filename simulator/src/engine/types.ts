export type RegionId = 'gyeonggi' | 'changwon' | 'busan';

export type MarriageTiming = 'before' | 'after';
export type Ownership = 'sole' | 'joint';
export type SpouseHouseHistory = 'none' | 'owning' | 'disposed';
export type MaritalStatus = 'single' | 'engaged' | 'newlywed7y' | 'over7y';

export type Objective = 'interest' | 'monthly' | 'limit' | 'safety';

/** 가구 프로필 — /profile 화면의 입력값 */
export interface Profile {
  ownIncome: number;
  spouseIncome: number;
  isFirstTime: boolean;
  spouseHouseHistory: SpouseHouseHistory;
  isOver30: boolean;
  maritalStatus: MaritalStatus;
  childCount: number;
  /** 2년 이내 출산·입양 자녀 — 신생아 특례 자격 판정 */
  newbornWithin2y: boolean;
  ownCash: number;
  spouseCash: number;
  existingMonthlyDebt: number;
  netWorth: number;
  /** 혼인 전 시나리오에서 배우자 자금을 가용 자산에 포함할지 — 증여세 플래그 트리거 */
  includeSpouseCashBeforeMarriage: boolean;
  termYears: number;
  /** 매수 예정일 — 시행 예정 제도의 적용 여부 판정 */
  purchaseDate: string;
  /** 민감도 분석용 금리 가산 (%p, 소수) */
  rateAdjust: number;
  movingAndRepair: number;
}

/** 시나리오 축 — 지역군은 물건에 귀속되므로 여기서는 혼인시점 × 명의 */
export interface ScenarioAxis {
  id: string;
  marriageTiming: MarriageTiming;
  ownership: Ownership;
}

/** 프로필 × 시나리오축에서 파생된 판정 상태 */
export interface DerivedScenario extends ScenarioAxis {
  label: string;
  isSingleHousehold: boolean;
  isFirstTimeValid: boolean;
  firstTimeLostReason?: string;
  assessedIncome: number;
  availableCash: number;
  /** 단독명의에 배우자 자금 투입 — 증여 과세 검토 대상 */
  giftTaxFlag: boolean;
  /** 혼전 공동명의 — 지분율과 자금부담률 불일치 시 증여 과세 */
  contributionRatioFlag: boolean;
  isNewlywed: boolean;
  hasNoHouseHousehold: boolean;
}

export interface Property {
  id: string;
  name: string;
  region: RegionId;
  sigungu: string;
  price: number;
  areaSqm: number;
  householdCount: number;
  builtYear: number;
  scores: Record<string, number>;
  penalties: string[];
  /** 지역 프리셋 대비 사용자 가중치 오버라이드 */
  weightOverrides?: Record<string, number>;
}

export type BindingConstraint = 'LTV' | 'CAP' | 'DSR' | 'DTI' | 'PRICE';

export interface CostBreakdown {
  acquisitionTax: number;
  acquisitionTaxRelief: number;
  localEducationTax: number;
  ruralTax: number;
  brokerage: number;
  legalAndBond: number;
  movingAndRepair: number;
  total: number;
}

export interface LoanResult {
  productId: string;
  productName: string;
  eligible: boolean;
  rejectReason?: string;
  limit: number;
  /** 한도 산출 각 단계값 — "무엇이 막았는지" 근거 표시용 */
  limitLtv: number;
  limitCap: number;
  limitRepay: number;
  limitPrice: number;
  appliedLtv: number;
  bindingConstraint: BindingConstraint;
  rate: number;
  monthlyPayment: number;
  totalInterest: number;
  dtiRatio: number;
  downPayment: number;
  costs: CostBreakdown;
  requiredCash: number;
  cashGap: number;
  feasible: boolean;
  tight: boolean;
  warnings: string[];
}

export interface CellResult {
  propertyId: string;
  scenarioId: string;
  best: LoanResult | null;
  all: LoanResult[];
  localeScore: number;
  grade: string;
}
