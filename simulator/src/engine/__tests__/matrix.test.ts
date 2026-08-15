import { describe, expect, it } from 'vitest';
import { rankProducts } from '../loan';
import { buildMatrix, cellKey, summarize } from '../matrix';
import { RULES } from '../rules';
import { ALL_SCENARIO_AXES, deriveScenario } from '../scenario';
import type { Objective, Profile } from '../types';
import { baseProfile, makeProperty } from './fixtures';

const axis = (id: string) => ALL_SCENARIO_AXES.find((a) => a.id === id)!;

/**
 * 캡쳐에서 보고된 상황을 그대로 재현합니다.
 * 혼전·단독 소득 5,000만·현금 6,000만 / 혼후 합산 소득 1.00억·현금 1.60억.
 * 현금이 모자라 전 상품이 자금부족이면 순위가 목적함수로만 갈리는데,
 * 이 조합이 바로 "정책상품이 사라진 것처럼 보이는" 구간입니다.
 */
const lowIncome: Profile = {
  ...baseProfile,
  ownIncome: 50000000,
  spouseIncome: 50000000,
  ownCash: 60000000,
  spouseCash: 100000000,
  netWorth: 160000000,
};

function cellFor(profile: Profile, axisId: string, objective: Objective) {
  const property = makeProperty();
  const scenario = deriveScenario(profile, axis(axisId));
  const { all, best } = rankProducts(profile, scenario, property, objective);
  return { summary: summarize(all, best), all, best };
}

describe('셀 요약 — 정책상품이 왜 안 보이는지', () => {
  it('모든 상품을 세고 적격 수를 따로 낸다', () => {
    const { summary } = cellFor(lowIncome, 'before-sole', 'monthly');
    expect(summary.totalCount).toBe(RULES.products.length);
    expect(summary.eligibleCount).toBeLessThan(summary.totalCount);
    expect(summary.eligibleCount + summary.rejected.length).toBe(summary.totalCount);
  });

  it('부적격 상품은 사유와 함께 하나도 빠뜨리지 않는다', () => {
    const { summary, all } = cellFor(lowIncome, 'before-sole', 'monthly');
    const ineligible = all.filter((r) => !r.eligible);
    expect(summary.rejected).toHaveLength(ineligible.length);
    for (const x of summary.rejected) {
      expect(x.reason.length).toBeGreaterThan(0);
    }
  });

  it('월납 최소화에서 밀린 정책상품을 드러낸다 — 한도는 더 큰데 월납이 비싸서 진 경우', () => {
    const { summary, best } = cellFor(lowIncome, 'before-sole', 'monthly');

    // 승자는 덜 빌리는 은행 상품
    expect(best!.productId).toBe('bank_mortgage');

    // 밀린 정책상품이 잡히고, 한도는 더 크지만 월납이 더 비싸다
    expect(summary.passedOver).not.toBeNull();
    expect(summary.passedOver!.productName).toContain('보금자리론');
    expect(summary.passedOver!.limitDelta).toBeGreaterThan(0);
    expect(summary.passedOver!.monthlyDelta).toBeGreaterThan(0);
  });

  it('목적함수를 한도 최대화로 바꾸면 밀렸던 정책상품이 승자가 된다', () => {
    const monthly = cellFor(lowIncome, 'before-sole', 'monthly');
    const limit = cellFor(lowIncome, 'before-sole', 'limit');

    expect(limit.best!.productId).toBe('bogeumjari_first');
    expect(monthly.summary.passedOver!.productName).toBe(limit.best!.productName);
    // 승자가 된 뒤에는 더 이상 "밀린 상품"으로 잡히지 않는다
    expect(limit.summary.passedOver?.productName).not.toBe(limit.best!.productName);
  });

  it('소득이 상한을 넘으면 정책상품이 전부 부적격으로 빠지고 밀린 상품도 없다', () => {
    // 혼후 합산 1.00억 — 디딤돌 7,000만·보금자리론 8,500만 상한 초과
    const { summary, best } = cellFor(lowIncome, 'after-joint', 'monthly');

    expect(best!.productId).toBe('bank_mortgage');
    expect(summary.passedOver).toBeNull();
    expect(summary.rejected.length).toBe(RULES.products.length - 1);
    expect(summary.rejected.some((x) => x.reason.includes('소득초과'))).toBe(true);
  });

  it('밀린 상품은 은행 상품이 아니라 정책상품만 잡는다', () => {
    const { summary } = cellFor(baseProfile, 'before-sole', 'limit');
    if (summary.passedOver) {
      expect(summary.passedOver.productName).not.toContain('은행');
    }
  });
});

describe('매트릭스 조립', () => {
  it('모든 셀이 요약을 갖는다', () => {
    const m = buildMatrix(
      lowIncome,
      ALL_SCENARIO_AXES,
      [makeProperty(), makeProperty({ id: 'p2', price: 520000000, region: 'gyeonggi' })],
      'monthly'
    );
    for (const cell of Object.values(m.cells)) {
      expect(cell.summary.totalCount).toBe(RULES.products.length);
    }
    expect(Object.keys(m.cells)).toHaveLength(ALL_SCENARIO_AXES.length * 2);
    expect(m.cells[cellKey('p1', 'before-sole')]).toBeDefined();
  });
});
