/**
 * 전월세 보증금 대출 비교 — **어느 상품이 되고, 얼마가 나오고, 월에 얼마인가.**
 *
 * 매수 쪽 `engine/loan.ts` 와 상품군이 통째로 다릅니다. 저기는 주담대라
 * LTV·DSR 이 축인데, 여기는 **보증금의 몇 %까지 · 자격이 되나 · 금리가 몇 %**
 * 셋이 전부입니다. 그래서 룰셋도 계산도 갈라 뒀습니다.
 *
 * ## 자격이 먼저입니다
 *
 * 전세대출은 한도가 막히는 게 아니라 **자격에서 떨어집니다.** 그래서 떨어진
 * 이유를 전부 모아 둡니다 — 하나만 보여 주면 "소득만 낮추면 되나" 로 읽히는데
 * 실제로는 나이·세대주·보증금 상한이 같이 걸려 있는 경우가 많습니다.
 *
 * ## 동거는 신혼이 아닙니다
 *
 * 이 도구를 만든 사람의 상황이기도 한데, **혼인신고 전 동거는 신혼부부 상품의
 * 자격이 없습니다.** 대신 각자 세대주로 청년 상품을 쓰는 길이 있습니다. 이건
 * 계산이 아니라 제도의 갈림길이라 결과에 문장으로 남깁니다.
 */

import ruleset from '../rules/rent-loans-2026-09.json';

export type RentLoanType = 'policy' | 'bank';

export interface RentLoanProduct {
  id: string;
  name: string;
  shortName: string;
  type: RentLoanType;
  order: number;
  /** `wolse` 면 월세 대출 전용 상품입니다 */
  mode?: string;
  eligibility: Record<string, number | boolean | undefined>;
  limits: { cap: number; depositRatio: number; monthlyCap?: number };
  rate: { min: number; max: number };
  term: { years: number; extensions: number; maxYears: number };
  basis: string;
  watchOuts: string[];
}

interface RawRuleset {
  version: string;
  effectiveFrom: string;
  label: string;
  disclaimer: string;
  sources: string[];
  note: string;
  products: RentLoanProduct[];
}

const raw = ruleset as unknown as RawRuleset;

export const RENT_LOAN_RULES = {
  version: raw.version,
  effectiveFrom: raw.effectiveFrom,
  label: raw.label,
  disclaimer: raw.disclaimer,
  sources: raw.sources,
  note: raw.note,
};

export const RENT_LOAN_PRODUCTS: RentLoanProduct[] = [...raw.products].sort(
  (a, b) => a.order - b.order
);

/** 신청자 상황 — 화면에서 받는 값입니다. */
export interface Borrower {
  age: number;
  /** 군 복무로 나이 상한이 늘어나는가 */
  militaryServed: boolean;
  /** 혼인신고를 했는가 — 동거만으로는 false 입니다 */
  married: boolean;
  marriedYears: number;
  /** 2년 이내 출산·입양 */
  newbornWithin2y: boolean;
  /** 중소·중견기업 재직 또는 청년창업 */
  smeEmployed: boolean;
  /** 본인 연소득 (원) */
  income: number;
  /** 배우자 연소득 (원). 혼인신고 전이면 합산하지 않습니다 */
  spouseIncome: number;
  /** 순자산 (원) */
  netWorth: number;
  /** 무주택 세대주가 될 수 있는가 */
  householder: boolean;
  noHouse: boolean;
}

export interface RentTarget {
  /** 보증금 (원) */
  deposit: number;
  /** 월세 (원). 전세면 0 */
  rent: number;
  /** 전용면적 (㎡) */
  areaSqm: number;
}

export interface RentLoanResult {
  product: RentLoanProduct;
  eligible: boolean;
  /** 떨어진 이유 — 전부 모읍니다. 하나만 내면 다른 벽이 안 보입니다 */
  rejectReasons: string[];
  /** 빌릴 수 있는 금액 (원) */
  limit: number;
  /** 무엇이 한도를 막았나 */
  bindingConstraint: 'RATIO' | 'CAP' | 'DEPOSIT' | null;
  /** 적용 금리 범위 */
  rate: { min: number; max: number };
  /** 월 이자 (원) — 금리 하단·상단 */
  monthlyInterest: { min: number; max: number };
  /** 대출을 받고도 내가 내야 하는 보증금 (원) */
  ownCash: number;
  /** 월세까지 더한 월 부담 (원) */
  monthlyTotal: { min: number; max: number };
  notes: string[];
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const bool = (v: unknown): boolean => v === true;

const eok = (v: number) => `${(v / 1e8).toFixed(2)}억`;
const manwon = (v: number) => `${Math.round(v / 10000).toLocaleString('ko-KR')}만원`;

/**
 * 판정소득 — **혼인신고 전이면 합산하지 않습니다.**
 *
 * 정책상품의 소득 요건은 "부부합산" 이라 혼인신고 전에는 본인 소득만 봅니다.
 * 이게 동거 커플에게는 오히려 유리한 지점이라 화면에서 짚어 줍니다.
 */
export function assessedIncome(b: Borrower): number {
  return b.married ? b.income + b.spouseIncome : b.income;
}

function checkEligibility(
  p: RentLoanProduct,
  b: Borrower,
  t: RentTarget
): string[] {
  const el = p.eligibility;
  const reasons: string[] = [];
  const income = assessedIncome(b);

  const ageMax = b.militaryServed
    ? (num(el.age_max_military) ?? num(el.age_max))
    : num(el.age_max);
  const ageMin = num(el.age_min);
  if (ageMin !== undefined && b.age < ageMin) {
    reasons.push(`만 ${ageMin}세 이상이어야 합니다 (현재 ${b.age}세)`);
  }
  if (ageMax !== undefined && b.age > ageMax) {
    reasons.push(
      `만 ${ageMax}세 이하여야 합니다 (현재 ${b.age}세)` +
        (num(el.age_max_military) && !b.militaryServed
          ? ` — 군 복무를 했다면 ${num(el.age_max_military)}세까지 늘어납니다`
          : '')
    );
  }

  if (bool(el.requires_sme) && !b.smeEmployed) {
    reasons.push('중소·중견기업 재직(또는 청년창업) 이어야 합니다');
  }
  if (bool(el.requires_marriage)) {
    if (!b.married) {
      reasons.push('혼인신고가 되어 있어야 합니다 — 동거만으로는 자격이 없습니다');
    } else {
      const within = num(el.marriage_within_years);
      if (within !== undefined && b.marriedYears > within) {
        reasons.push(`혼인 ${within}년 이내여야 합니다 (현재 ${b.marriedYears}년차)`);
      }
    }
  }
  if (bool(el.requires_newborn_within_2y) && !b.newbornWithin2y) {
    reasons.push('2년 이내 출산·입양 자녀가 있어야 합니다');
  }
  if (bool(el.requires_householder) && !b.householder) {
    reasons.push('세대주(또는 예비 세대주) 여야 합니다');
  }
  if (bool(el.requires_no_house) && !b.noHouse) {
    reasons.push('무주택이어야 합니다');
  }

  /*
   * 소득 상한은 혼인 여부로 갈립니다. 혼인신고 전이면 본인 소득만 보므로
   * 단독 기준을, 혼인했으면 부부합산 기준을 씁니다.
   */
  const incomeMax = b.married
    ? (num(el.income_max_couple) ?? num(el.income_max_single))
    : (num(el.income_max_single) ?? num(el.income_max_couple));
  if (incomeMax !== undefined && income > incomeMax) {
    reasons.push(
      `연소득 ${eok(incomeMax)} 이하여야 합니다 (${b.married ? '부부합산' : '본인'} ${eok(income)})`
    );
  }

  const networthMax = num(el.networth_max);
  if (networthMax !== undefined && b.netWorth > networthMax) {
    reasons.push(`순자산 ${eok(networthMax)} 이하여야 합니다 (현재 ${eok(b.netWorth)})`);
  }

  const depositMax = num(el.deposit_max);
  if (depositMax !== undefined && t.deposit > depositMax) {
    reasons.push(`보증금 ${eok(depositMax)} 이하 주택만 됩니다 (이 집 ${eok(t.deposit)})`);
  }

  const rentMax = num(el.monthly_rent_max);
  if (rentMax !== undefined && t.rent > rentMax) {
    reasons.push(`월세 ${manwon(rentMax)} 이하만 됩니다 (이 집 ${manwon(t.rent)})`);
  }

  const areaMax = num(el.area_max_sqm);
  if (areaMax !== undefined && t.areaSqm > areaMax) {
    reasons.push(`전용 ${areaMax}㎡ 이하만 됩니다 (이 집 ${t.areaSqm}㎡)`);
  }

  // 월세 전용 상품은 월세가 있어야 의미가 있습니다.
  if (p.mode === 'wolse' && t.rent === 0) {
    reasons.push('월세 계약에만 쓰는 상품입니다 (이 집은 전세)');
  }

  return reasons;
}

export function evaluateRentLoan(
  p: RentLoanProduct,
  b: Borrower,
  t: RentTarget
): RentLoanResult {
  const rejectReasons = checkEligibility(p, b, t);

  const byRatio = t.deposit * p.limits.depositRatio;
  const cap = p.limits.cap;
  const candidates: { key: 'RATIO' | 'CAP'; value: number }[] = [
    { key: 'RATIO', value: byRatio },
    { key: 'CAP', value: cap },
  ];
  const winner = candidates.reduce((a, c) => (c.value < a.value ? c : a));
  const limit = rejectReasons.length ? 0 : Math.floor(Math.max(0, winner.value) / 10000) * 10000;

  const ownCash = Math.max(0, t.deposit - limit);
  const monthlyInterest = {
    min: (limit * p.rate.min) / 12,
    max: (limit * p.rate.max) / 12,
  };

  const notes: string[] = [];
  if (!rejectReasons.length) {
    if (winner.key === 'CAP') {
      notes.push(
        `상품 한도 ${eok(cap)} 에 걸렸습니다 — 보증금의 ${Math.round(p.limits.depositRatio * 100)}% 인 ${eok(byRatio)} 까지는 규정상 가능하지만 상한이 먼저 막습니다.`
      );
    } else {
      notes.push(
        `보증금의 ${Math.round(p.limits.depositRatio * 100)}% 까지라 ${eok(ownCash)} 는 자기 돈이 필요합니다.`
      );
    }
    if (ownCash > 0) {
      notes.push(`계약할 때 손에 ${eok(ownCash)} 가 있어야 합니다.`);
    }
    notes.push(
      `${p.term.years}년 만기 · 최장 ${p.term.maxYears}년까지 연장할 수 있습니다.`
    );
  }

  return {
    product: p,
    eligible: rejectReasons.length === 0,
    rejectReasons,
    limit,
    bindingConstraint: rejectReasons.length ? null : winner.key,
    rate: p.rate,
    monthlyInterest,
    ownCash,
    monthlyTotal: {
      min: monthlyInterest.min + t.rent,
      max: monthlyInterest.max + t.rent,
    },
    notes,
  };
}

/**
 * 전 상품 비교.
 *
 * **되는 것을 금리순으로 먼저, 안 되는 것을 그 뒤에** 둡니다. 안 되는 것을
 * 숨기지 않는 이유는 그 목록이 곧 "무엇을 바꾸면 되는가" 이기 때문입니다 —
 * 혼인신고, 중소기업 재직, 보증금 낮추기가 전부 거기서 나옵니다.
 */
export function compareRentLoans(b: Borrower, t: RentTarget): RentLoanResult[] {
  const all = RENT_LOAN_PRODUCTS.map((p) => evaluateRentLoan(p, b, t));
  const ok = all.filter((r) => r.eligible).sort((x, y) => x.rate.min - y.rate.min);
  const no = all.filter((r) => !r.eligible).sort((x, y) => x.product.order - y.product.order);
  return [...ok, ...no];
}

export interface RentLoanAdvice {
  headline: string;
  detail: string;
}

/**
 * 결과를 보고 **다음 행동**을 말합니다.
 *
 * 표만 내면 "그래서 뭘 해야 하나" 가 남습니다. 자격이 갈리는 지점은 대개
 * 바꿀 수 있는 것(혼인신고·세대 분리·보증금)이라 그것만 짚습니다.
 */
export function adviseRentLoans(
  b: Borrower,
  t: RentTarget,
  results: RentLoanResult[]
): RentLoanAdvice[] {
  const out: RentLoanAdvice[] = [];
  const best = results.find((r) => r.eligible);

  if (!best) {
    out.push({
      headline: '지금 조건으로 되는 상품이 없습니다',
      detail:
        '아래 탈락 사유를 보세요. 보증금을 낮추거나 세대주 요건을 맞추면 열리는 경우가 많습니다.',
    });
  } else if (best.ownCash > 0) {
    out.push({
      headline: `가장 싼 길은 ${best.product.shortName} — 월 이자 ${manwon(best.monthlyInterest.min)}~${manwon(best.monthlyInterest.max)}`,
      detail: `대출 ${eok(best.limit)} · 자기 돈 ${eok(best.ownCash)} 가 필요합니다.`,
    });
  }

  /*
   * 혼인신고 전 동거는 이 도구를 쓰는 사람의 실제 상황입니다. 신혼부부 상품이
   * 막히는 대신 소득을 합산하지 않아 청년 상품 쪽이 열리기도 해서, 어느 쪽이
   * 유리한지는 숫자로 갈립니다.
   */
  if (!b.married && b.spouseIncome > 0) {
    const couple = b.income + b.spouseIncome;
    out.push({
      headline: '혼인신고 전이라 신혼부부 상품은 자격이 없습니다',
      detail:
        `대신 소득을 합산하지 않아 본인 ${eok(b.income)} 만 봅니다 (합산하면 ${eok(couple)}). ` +
        '둘 중 소득이 낮은 사람이 세대주로 신청하는 쪽이 자격 문턱을 넘기 쉽습니다.',
    });
  }

  if (!b.smeEmployed && b.age <= 34) {
    out.push({
      headline: '중소기업 재직이면 금리가 절반 아래로 내려갑니다',
      detail:
        '중기청 전월세보증금대출은 연 1.5% 입니다. 재직 중인 회사가 중소·중견기업인지 먼저 확인해 보세요.',
    });
  }

  const depositBlocked = results.filter((r) =>
    r.rejectReasons.some((x) => x.includes('보증금'))
  );
  if (depositBlocked.length > 0) {
    out.push({
      headline: `보증금 ${eok(t.deposit)} 이 상한을 넘어 막힌 상품이 ${depositBlocked.length}개 있습니다`,
      detail:
        '보증금이 낮은 집(또는 월세 낀 반전세)으로 바꾸면 더 싼 상품이 열립니다 — 전월세 찾기 화면에서 보증금 상한을 낮춰 보세요.',
    });
  }

  return out;
}

/** 이 표가 못 하는 것 — 화면에 늘 붙습니다. */
export const RENT_LOAN_CAVEATS = [
  '공개된 제도 정보를 전제로 한 추정치입니다. 소득·순자산 요건과 금리 구간은 수시로 바뀌므로 주택도시기금·은행 공고로 재확인하세요.',
  '금리는 구간입니다 — 소득과 보증금 구간, 우대 항목에 따라 표의 하단과 상단 사이에서 정해집니다.',
  '실제 승인 한도는 보증기관 심사와 임대인·주택 조건(등기, 선순위 채권)에 따라 줄어듭니다.',
  '전세대출 원금은 DSR 에 안 들어가지만 이자는 들어갑니다 — 나중에 집을 살 때 주담대 한도를 깎습니다.',
  '한 집에 두 명이 각각 전세대출을 받을 수는 없습니다. 세대주 한 명 명의로 실행합니다.',
];
