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
  /** 실제 금리 기준 상환부담률 — 실제로 통장에서 나가는 비율 */
  dtiRatio: number;
  /**
   * 규제 기준 상환비율. 은행 상품은 **스트레스 금리(+1.5%p)** 로 계산한 DSR,
   * DSR 면제 정책상품은 DTI 입니다.
   *
   * 실제 금리로 잰 `dtiRatio` 보다 항상 높습니다 — 그래서 "부담 20%"만 보고
   * 규제선(40%)에 여유가 있다고 판단하면 틀립니다. 한도를 실제로 깎는 것은
   * 이쪽입니다.
   */
  regulatoryRatio: number;
  /** 그 상품에 적용되는 규제 상한 (DSR 40% / DTI 60%) */
  regulatoryCap: number;
  regulatoryKind: 'DSR' | 'DTI';
  /**
   * **상환능력을 빼고** LTV·상품캡·가격만 봤을 때의 최대 한도.
   *
   * "LTV 는 통과한다고 치면 얼마까지 되나" 에 답합니다. 소득이 늘면 여기까지
   * 올라갈 수 있고, 그 위로는 소득을 아무리 올려도 안 올라갑니다.
   */
  limitBeforeRepay: number;
  /**
   * 위 금액을 상환능력으로 받아 내려면 필요한 **연 판정소득**.
   *
   * DTI·DSR 식을 그대로 뒤집은 값입니다. 한도가 막혔을 때 "그래서 얼마를 더
   * 벌어야 하나" 가 다음 행동이라, 막힌 사실만 알려 주면 절반만 답한 것입니다.
   */
  requiredIncome: number;
  /** 필요소득 − 현재 판정소득. 양수면 그만큼 모자랍니다 */
  incomeGap: number;
  /**
   * 필요소득이 이 상품의 **소득 자격 상한**을 넘는가.
   *
   * 정책상품은 소득이 낮아야 자격이 나오고 높아야 한도가 나옵니다. 둘이
   * 어긋나면 **어떤 소득으로도 그 한도에 닿을 수 없습니다** — 소득을 올리면
   * 자격을 잃기 때문입니다. 이 구조적 막힘은 화면에 따로 말해 줘야 합니다.
   */
  requiredIncomeBlocked: boolean;
  /** 그 상품의 소득 자격 상한 (없으면 null) */
  incomeCap: number | null;
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
