import { describe, expect, it } from 'vitest';
import { affordabilityLadder, maxAffordablePrice } from '../affordability';
import { calcLoan } from '../loan';
import { getProduct } from '../rules';
import { ALL_SCENARIO_AXES, deriveScenario } from '../scenario';
import type { Profile } from '../types';
import { baseProfile, makeProperty } from './fixtures';

const axis = (id: string) => ALL_SCENARIO_AXES.find((a) => a.id === id)!;
const template = makeProperty();

/** 합가 + 신생아 — "7억대에 도전할 수 있나"를 판정하는 조합 */
const merged: Profile = {
  ...baseProfile,
  ownIncome: 50000000,
  spouseIncome: 50000000,
  ownCash: 60000000,
  spouseCash: 100000000,
  netWorth: 160000000,
  newbornWithin2y: true,
  childCount: 1,
  maritalStatus: 'newlywed7y',
};

function ladderFor(profile: Profile, axisId: string) {
  return affordabilityLadder(profile, deriveScenario(profile, axis(axisId)), template);
}

describe('최대 감당가격 역산', () => {
  it('최대가격에서는 성립하고 그보다 비싸면 깨진다 — 경계를 정확히 잡는다', () => {
    const profile = merged;
    const scenario = deriveScenario(profile, axis('after-joint'));
    const r = maxAffordablePrice(getProduct('sinsaenga_special'), profile, scenario, template);

    const atMax = calcLoan(
      getProduct('sinsaenga_special'),
      profile,
      scenario,
      makeProperty({ price: r.maxPrice })
    );
    const above = calcLoan(
      getProduct('sinsaenga_special'),
      profile,
      scenario,
      makeProperty({ price: r.maxPrice * 1.05 })
    );

    expect(atMax.eligible).toBe(true);
    expect(atMax.cashGap).toBeLessThanOrEqual(0);
    expect(above.eligible && above.cashGap <= 0).toBe(false);
  });

  it('자격 자체가 안 되면 0을 내고 사유를 남긴다', () => {
    // 신생아 자녀가 없으면 가격을 아무리 낮춰도 신생아특례는 열리지 않습니다.
    const r = maxAffordablePrice(
      getProduct('sinsaenga_special'),
      baseProfile,
      deriveScenario(baseProfile, axis('before-sole')),
      template
    );
    expect(r.maxPrice).toBe(0);
    expect(r.reason).toContain('신생아');
  });

  it('합가하면 정책대출 자격이 사라지고 은행만 남는다', () => {
    // 합산소득 1.00억 — 디딤돌 7,000만·보금자리론 8,500만 상한 초과
    const ladder = ladderFor({ ...merged, newbornWithin2y: false, childCount: 0 }, 'after-joint');
    const usable = ladder.filter((r) => r.maxPrice > 0);
    expect(usable).toHaveLength(1);
    expect(usable[0].productId).toBe('bank_mortgage');
  });

  it('신생아특례가 열리면 감당 가격대가 은행보다 위로 올라간다', () => {
    const ladder = ladderFor(merged, 'after-joint');
    const sinsaenga = ladder.find((r) => r.productId === 'sinsaenga_special')!;
    const bank = ladder.find((r) => r.productId === 'bank_mortgage')!;

    expect(sinsaenga.maxPrice).toBeGreaterThan(bank.maxPrice);
    // 사다리는 큰 금액이 위로 오도록 정렬됩니다
    expect(ladder[0].productId).toBe('sinsaenga_special');
  });

  it('신생아특례의 한계는 자격(9억)이 아니라 현금이다', () => {
    // 이 구분이 행동을 가릅니다 — 상품을 바꿀 게 아니라 현금을 더 모아야 합니다.
    const r = ladderFor(merged, 'after-joint').find((x) => x.productId === 'sinsaenga_special')!;
    expect(r.binding).toBe('CASH');
    expect(r.maxPrice).toBeLessThan(900000000);
  });

  it('현금이 늘면 감당 가격도 늘어난다', () => {
    const poor = ladderFor(merged, 'after-joint')[0].maxPrice;
    const rich = ladderFor({ ...merged, spouseCash: 300000000 }, 'after-joint')[0].maxPrice;
    expect(rich).toBeGreaterThan(poor);
  });

  it('감당 가격은 만원 단위 아래로 지저분하게 나오지 않는다', () => {
    for (const r of ladderFor(merged, 'after-joint')) {
      expect(r.maxPrice % 1000000).toBe(0);
    }
  });
});

/**
 * 주택가격 상한과 대출 절대상한은 **다른 축**입니다. "6억까지 가능" 이 "6억을
 * 빌려준다" 로 읽히는 지점이라, 대출이 멈추는 가격을 따로 냅니다.
 */
describe('대출이 멈추는 가격', () => {
  const scenario = deriveScenario(baseProfile, ALL_SCENARIO_AXES[0]);
  const ladder = affordabilityLadder(baseProfile, scenario, template);

  it('천장 가격 × LTV 가 곧 멈추는 대출액입니다', () => {
    for (const r of ladder) {
      if (r.loanCeilingPrice === null || !r.at) continue;
      expect(r.loanCeilingAmount).toBeCloseTo(r.loanCeilingPrice * r.at.appliedLtv, 0);
    }
  });

  it('천장은 상품캡과 상환능력 중 먼저 걸리는 쪽입니다', () => {
    for (const r of ladder) {
      if (r.loanCeilingPrice === null || !r.at) continue;
      const cap = r.at.limitCap > 0 ? r.at.limitCap : Infinity;
      const repay = r.at.limitRepay > 0 ? r.at.limitRepay : Infinity;
      expect(r.loanCeilingAmount).toBeCloseTo(Math.min(cap, repay), 0);
      expect(r.loanCeilingBy).toBe(cap <= repay ? 'CAP' : r.at.regulatoryKind);
    }
  });

  /** 천장 위에서는 가격이 올라도 대출이 그대로여야 합니다 — 오른 만큼 전부 현금. */
  it('천장 위로는 오른 가격이 전부 자기 부담이 됩니다', () => {
    const r = ladder.find((x) => x.loanCeilingPrice !== null && x.at)!;
    const price = r.loanCeilingPrice!;
    const product = getProduct(r.productId);
    const below = calcLoan(product, baseProfile, scenario, { ...template, price: price * 0.9 });
    const above1 = calcLoan(product, baseProfile, scenario, { ...template, price: price * 1.05 });
    const above2 = calcLoan(product, baseProfile, scenario, { ...template, price: price * 1.1 });
    if (!above1.eligible || !above2.eligible) return; // 가격 상한에 먼저 걸리면 건너뜁니다
    expect(below.limit).toBeLessThan(r.loanCeilingAmount);
    expect(above2.limit).toBeCloseTo(above1.limit, 0);
    // 가격 차이가 그대로 자기부담 차이입니다.
    expect(above2.downPayment - above1.downPayment).toBeCloseTo(price * 0.05, 0);
  });
});
