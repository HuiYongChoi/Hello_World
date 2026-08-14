import { describe, expect, it } from 'vitest';
import { ALL_SCENARIO_AXES, deriveScenario } from '../scenario';
import { baseProfile } from './fixtures';

const axis = (id: string) => ALL_SCENARIO_AXES.find((a) => a.id === id)!;

describe('시나리오 파생 상태', () => {
  it('혼인 전 단독은 단독세대주로 판정되고 소득은 본인만 산입', () => {
    const s = deriveScenario(baseProfile, axis('before-sole'));
    expect(s.isSingleHousehold).toBe(true);
    expect(s.assessedIncome).toBe(60000000);
  });

  it('혼인 후에는 소득이 합산되고 단독세대주가 아님', () => {
    const s = deriveScenario(baseProfile, axis('after-joint'));
    expect(s.isSingleHousehold).toBe(false);
    expect(s.assessedIncome).toBe(105000000);
  });

  it('배우자 주택 소유 이력은 혼인 후에만 생애최초를 소멸시킨다', () => {
    const p = { ...baseProfile, spouseHouseHistory: 'disposed' as const };
    expect(deriveScenario(p, axis('before-sole')).isFirstTimeValid).toBe(true);
    const after = deriveScenario(p, axis('after-sole'));
    expect(after.isFirstTimeValid).toBe(false);
    expect(after.firstTimeLostReason).toContain('생애최초');
  });

  it('배우자 보유중이면 혼인 후 무주택세대 요건도 깨진다', () => {
    const p = { ...baseProfile, spouseHouseHistory: 'owning' as const };
    expect(deriveScenario(p, axis('after-sole')).hasNoHouseHousehold).toBe(false);
    expect(deriveScenario(p, axis('before-sole')).hasNoHouseHousehold).toBe(true);
  });

  it('혼인 전 단독명의에 배우자 자금을 끌어오면 증여세 플래그가 선다', () => {
    const off = deriveScenario(baseProfile, axis('before-sole'));
    expect(off.giftTaxFlag).toBe(false);
    expect(off.availableCash).toBe(120000000);

    const on = deriveScenario(
      { ...baseProfile, includeSpouseCashBeforeMarriage: true },
      axis('before-sole')
    );
    expect(on.giftTaxFlag).toBe(true);
    expect(on.availableCash).toBe(180000000);
  });

  it('혼인 전 공동명의는 자금이 합산되고 지분율 플래그가 대신 선다', () => {
    const s = deriveScenario(baseProfile, axis('before-joint'));
    expect(s.availableCash).toBe(180000000);
    // 각자 지분을 각자 자금으로 사는 구조이므로 단순 증여 플래그는 아님
    expect(s.giftTaxFlag).toBe(false);
    expect(s.contributionRatioFlag).toBe(true);
  });

  it('혼인 후에는 배우자 자금 사용에 증여 플래그가 서지 않는다', () => {
    const s = deriveScenario(baseProfile, axis('after-joint'));
    expect(s.giftTaxFlag).toBe(false);
    expect(s.contributionRatioFlag).toBe(false);
    expect(s.availableCash).toBe(180000000);
  });
});
