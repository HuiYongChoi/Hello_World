/**
 * 역방향 질문 — "이 상품으로 얼마짜리까지 되나".
 *
 * 기존 파이프라인은 **물건을 정해야** 한도가 나옵니다. 그런데 실제 의사결정은
 * 반대 방향으로 옵니다 — "합가하고 신생아특례를 쓰면 7억대에 도전할 수 있나?"
 * 물건을 하나씩 넣어보며 되는지 확인하는 건 사람이 할 일이 아닙니다.
 *
 * 자격 게이트(주택가격 상한)와 자금 제약(가용현금 ≥ 필요현금)은 둘 다 가격에 대해
 * 단조롭습니다 — 싸면 되고 비싸면 안 됩니다. 그래서 성립/불성립 경계를 이분법으로
 * 찾을 수 있습니다. 구간 안에 여러 상한이 겹쳐 있어도 가장 낮은 것이 잡힙니다.
 *
 * 이 값은 **살 수 있는 한계**이지 **사도 되는 가격**이 아닙니다. 한계까지 당겨
 * 사면 상환 부담이 그대로 최대가 됩니다 — 그래서 결과에 부담률을 같이 냅니다.
 */

import { calcLoan } from './loan';
import { RULES, type ProductRule } from './rules';
import type { DerivedScenario, LoanResult, Profile, Property } from './types';

/** 탐색 구간. 3개 지역 물건 가격대를 넉넉히 덮습니다. */
const MIN_PRICE = 50000000;
const MAX_PRICE = 2000000000;
const SCAN_STEPS = 60;
const REFINE_ITERATIONS = 40;

export interface AffordabilityResult {
  productId: string;
  productName: string;
  shortName: string;
  /** 자격·자금이 모두 성립하는 최대 주택가격. 아예 불가면 0. */
  maxPrice: number;
  /** 그 가격에서의 대출 결과 — 부담률·월납을 같이 봐야 합니다. */
  at: LoanResult | null;
  /** 최대가격을 만든 제약 */
  binding: 'ELIGIBILITY' | 'CASH' | 'NONE';
  reason: string;
  /**
   * **이 가격을 넘으면 대출이 더 안 늘어납니다** — 오른 가격은 전부 내 돈입니다.
   *
   * 대출액은 `min(LTV×가격, 상품캡, 상환능력, 가격상한)` 인데 **상품캡과
   * 상환능력은 가격과 무관**합니다. 그래서 가격을 올리다 보면 어느 지점부터
   * 대출이 멈추고, 그 위로는 오른 만큼이 100% 현금 부담이 됩니다.
   *
   * 주택가격 상한(예: 보금자리론 6억)과 대출 절대상한(4.2억)은 **다른 축**입니다.
   * 6억까지 살 수 있다는 말은 6억을 빌려준다는 뜻이 아닙니다 — 이 값이 그
   * 오해가 시작되는 지점을 정확히 찍습니다.
   */
  loanCeilingPrice: number | null;
  /** 그 천장을 만든 것 */
  loanCeilingBy: 'CAP' | 'DSR' | 'DTI' | null;
  /** 천장에서 고정되는 대출액 */
  loanCeilingAmount: number;
}

/** 가격을 올려도 대출이 안 늘어나기 시작하는 지점. */
function loanCeilingOf(r: LoanResult): {
  loanCeilingPrice: number | null;
  loanCeilingBy: AffordabilityResult['loanCeilingBy'];
  loanCeilingAmount: number;
} {
  const ltv = r.appliedLtv;
  const cap = r.limitCap > 0 ? r.limitCap : Number.POSITIVE_INFINITY;
  const repay = r.limitRepay > 0 ? r.limitRepay : Number.POSITIVE_INFINITY;
  const amount = Math.min(cap, repay);
  if (ltv <= 0 || !Number.isFinite(amount)) {
    return { loanCeilingPrice: null, loanCeilingBy: null, loanCeilingAmount: 0 };
  }
  return {
    loanCeilingPrice: amount / ltv,
    loanCeilingBy: cap <= repay ? 'CAP' : r.regulatoryKind,
    loanCeilingAmount: amount,
  };
}

function ok(r: LoanResult): boolean {
  return r.eligible && r.limit > 0 && r.cashGap <= 0;
}

/** 가격만 바꾼 가상 물건 */
function at(template: Property, price: number): Property {
  return { ...template, price };
}

export function maxAffordablePrice(
  product: ProductRule,
  profile: Profile,
  scenario: DerivedScenario,
  template: Property
): AffordabilityResult {
  const head = {
    productId: product.id,
    productName: product.name,
    shortName: product.shortName,
  };

  const test = (price: number) => calcLoan(product, profile, scenario, at(template, price));

  // 하한에서도 안 되면 가격 문제가 아닙니다 (소득·자산·자격 요건).
  const floor = test(MIN_PRICE);
  if (!ok(floor)) {
    return {
      ...head,
      maxPrice: 0,
      at: floor,
      binding: 'NONE',
      loanCeilingPrice: null,
      loanCeilingBy: null,
      loanCeilingAmount: 0,
      reason: floor.rejectReason ?? '가격을 낮춰도 자금이 모자랍니다.',
    };
  }

  // 성립하는 가장 높은 지점을 굵게 훑고, 그 위 구간을 좁힙니다.
  let lo = MIN_PRICE;
  let hi = MAX_PRICE;
  const step = (MAX_PRICE - MIN_PRICE) / SCAN_STEPS;
  for (let i = 1; i <= SCAN_STEPS; i++) {
    const p = MIN_PRICE + step * i;
    if (ok(test(p))) lo = p;
    else {
      hi = p;
      break;
    }
  }

  for (let i = 0; i < REFINE_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (ok(test(mid))) lo = mid;
    else hi = mid;
  }

  const best = test(lo);
  // 경계 바로 위에서 무엇이 막았는지 — 자격이 끊긴 건지 현금이 모자란 건지
  const beyond = test(hi);
  const binding: AffordabilityResult['binding'] = !beyond.eligible ? 'ELIGIBILITY' : 'CASH';

  return {
    ...head,
    maxPrice: Math.floor(lo / 1000000) * 1000000,
    at: best,
    binding,
    ...loanCeilingOf(best),
    reason:
      binding === 'ELIGIBILITY'
        ? (beyond.rejectReason ?? '자격 요건에서 막힙니다.')
        : `가용현금이 모자랍니다 (이 가격의 필요현금 ${Math.round(beyond.requiredCash / 10000).toLocaleString('ko-KR')}만).`,
  };
}

/** 전 상품에 대해 한 번에. 가능한 금액이 큰 순으로 정렬합니다. */
export function affordabilityLadder(
  profile: Profile,
  scenario: DerivedScenario,
  template: Property
): AffordabilityResult[] {
  return RULES.products
    .map((p) => maxAffordablePrice(p, profile, scenario, template))
    .sort((a, b) => b.maxPrice - a.maxPrice);
}
