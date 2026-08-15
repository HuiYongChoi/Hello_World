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
  /** 연 가격상승률 가정 — 레버리지 스프레드 판정용 */
  priceGrowthRate: number;
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

/**
 * 셀에 뜨지 **않은** 상품들의 요약.
 *
 * 매트릭스 셀은 승자 하나만 보여주기 때문에, 정책상품이 안 보일 때
 * "룰셋에 없는 것"인지 "자격이 안 되는 것"인지 "목적함수에 밀린 것"인지
 * 구분이 안 됩니다. 이 셋은 사용자가 할 행동이 완전히 다릅니다 —
 * 자격 미달이면 물건·시나리오를 바꿔야 하고, 밀린 것이면 목적함수만
 * 바꾸면 됩니다. 그래서 셀에서 바로 드러냅니다.
 */
export interface CellSummary {
  totalCount: number;
  eligibleCount: number;
  /** 부적격 상품과 그 사유 */
  rejected: { productName: string; reason: string }[];
  /** 적격인데 목적함수에 밀린 정책상품 대표 1건 (한도가 가장 큰 것) */
  passedOver: {
    productName: string;
    shortName: string;
    limit: number;
    rate: number;
    monthlyPayment: number;
    /** 승자 대비 한도 차 — 양수면 더 많이 빌릴 수 있다는 뜻 */
    limitDelta: number;
    /** 승자 대비 월납 차 — 양수면 더 비싸다는 뜻 */
    monthlyDelta: number;
  } | null;
}

export interface CellResult {
  propertyId: string;
  scenarioId: string;
  best: LoanResult | null;
  all: LoanResult[];
  localeScore: number;
  grade: string;
  summary: CellSummary;
}
