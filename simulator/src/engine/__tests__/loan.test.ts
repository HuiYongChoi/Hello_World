import { describe, expect, it } from 'vitest';
import { calcLoan, constraintAdvice, rankProducts } from '../loan';
import { getProduct } from '../rules';
import { ALL_SCENARIO_AXES, deriveScenario } from '../scenario';
import { baseProfile, makeProperty } from './fixtures';

const axis = (id: string) => ALL_SCENARIO_AXES.find((a) => a.id === id)!;
const bogeumjari = getProduct('bogeumjari_first');
const didimdol = getProduct('didimdol_first');
const bank = getProduct('bank_mortgage');

describe('지역 = 대출조건 커플링 (이 사이트의 핵심 발견)', () => {
  const scenario = deriveScenario(baseProfile, axis('before-sole'));

  it('비수도권 생애최초는 LTV 80%', () => {
    const r = calcLoan(bogeumjari, baseProfile, scenario, makeProperty({ region: 'changwon' }));
    expect(r.appliedLtv).toBeCloseTo(0.8, 6);
    expect(r.limitLtv).toBeCloseTo(380000000 * 0.8, 0);
  });

  it('수도권은 같은 조건에서도 LTV 70%로 떨어진다', () => {
    const r = calcLoan(
      bogeumjari,
      baseProfile,
      scenario,
      makeProperty({ region: 'gyeonggi', sigungu: '평택시' })
    );
    expect(r.appliedLtv).toBeCloseTo(0.7, 6);
    expect(r.warnings.some((w) => w.includes('수도권'))).toBe(true);
  });

  it('규제지역은 은행 주담대 LTV를 50%로 끌어내린다', () => {
    const r = calcLoan(
      bank,
      baseProfile,
      scenario,
      makeProperty({ region: 'gyeonggi', sigungu: '과천시', price: 520000000 })
    );
    expect(r.appliedLtv).toBeCloseTo(0.5, 6);
    expect(r.warnings.some((w) => w.includes('규제지역'))).toBe(true);
  });
});

describe('자격 게이트', () => {
  it('단독세대주는 디딤돌 주택가격 3억 상한에 걸린다', () => {
    const s = deriveScenario(baseProfile, axis('before-sole'));
    const r = calcLoan(didimdol, baseProfile, s, makeProperty({ price: 380000000 }));
    expect(r.eligible).toBe(false);
    expect(r.rejectReason).toContain('주택가격초과');
  });

  it('단독세대주는 전용 60㎡ 상한에 걸린다', () => {
    const s = deriveScenario(baseProfile, axis('before-sole'));
    const r = calcLoan(didimdol, baseProfile, s, makeProperty({ price: 280000000, areaSqm: 84.9 }));
    expect(r.eligible).toBe(false);
    expect(r.rejectReason).toContain('면적초과');
  });

  it('만 30세 미만 단독세대주는 디딤돌 연령 요건에서 탈락', () => {
    const p = { ...baseProfile, isOver30: false };
    const s = deriveScenario(p, axis('before-sole'));
    const r = calcLoan(didimdol, p, s, makeProperty({ price: 280000000, areaSqm: 59 }));
    expect(r.eligible).toBe(false);
    expect(r.rejectReason).toContain('연령미달');
  });

  it('혼인 후 합산소득이 상한을 넘으면 소득초과로 탈락', () => {
    const s = deriveScenario(baseProfile, axis('after-joint')); // 1.05억
    const r = calcLoan(bogeumjari, baseProfile, s, makeProperty());
    expect(r.eligible).toBe(false);
    expect(r.rejectReason).toContain('소득초과');
  });

  it('신혼 소득요건 완화는 시행일 전 매수에는 적용되지 않는다', () => {
    const p = { ...baseProfile, spouseIncome: 20000000, purchaseDate: '2026-09-01' };
    const s = deriveScenario(p, axis('after-joint')); // 8천만
    const r = calcLoan(bogeumjari, p, s, makeProperty());
    expect(r.eligible).toBe(false);
    expect(r.rejectReason).toContain('소득초과');

    const later = { ...p, purchaseDate: '2026-11-01' };
    const r2 = calcLoan(bogeumjari, later, deriveScenario(later, axis('after-joint')), makeProperty());
    expect(r2.eligible).toBe(true);
  });

  it('순자산 요건 초과 시 디딤돌 탈락', () => {
    const p = { ...baseProfile, netWorth: 600000000, isOver30: true };
    const s = deriveScenario(p, axis('before-sole')); // 판정소득 6천만 — 소득 게이트는 통과
    const r = calcLoan(didimdol, p, s, makeProperty({ price: 280000000, areaSqm: 59 }));
    expect(r.eligible).toBe(false);
    expect(r.rejectReason).toContain('자산초과');
  });
});

describe('binding constraint 판별', () => {
  it('저가 물건에서는 LTV가 한도를 막는다', () => {
    const s = deriveScenario(baseProfile, axis('before-sole'));
    const r = calcLoan(bogeumjari, baseProfile, s, makeProperty({ price: 300000000 }));
    expect(r.bindingConstraint).toBe('LTV');
  });

  it('기존 부채가 크면 상환능력(DTI)이 한도를 막는다', () => {
    const p = { ...baseProfile, existingMonthlyDebt: 1500000 };
    const s = deriveScenario(p, axis('before-sole'));
    const r = calcLoan(bogeumjari, p, s, makeProperty({ price: 380000000 }));
    expect(r.bindingConstraint).toBe('DTI');
    expect(r.limit).toBeLessThan(r.limitLtv);
  });

  it('은행 주담대는 DSR 40% + 스트레스 금리로 상환능력 한도가 정책상품보다 낮다', () => {
    const s = deriveScenario(baseProfile, axis('before-sole'));
    const property = makeProperty({ price: 380000000 });
    const bankResult = calcLoan(bank, baseProfile, s, property);
    const policyResult = calcLoan(bogeumjari, baseProfile, s, property);

    expect(bankResult.warnings.some((w) => w.includes('스트레스'))).toBe(true);
    // DSR 40% < DTI 60%, 게다가 스트레스 금리 +1.5%p가 가산됨
    expect(bankResult.limitRepay).toBeLessThan(policyResult.limitRepay);
  });

  it('상품 캡이 가장 낮으면 CAP으로 판정', () => {
    const p = { ...baseProfile, ownIncome: 69000000, spouseIncome: 0 };
    const s = deriveScenario(p, axis('after-joint'));
    const r = calcLoan(didimdol, p, s, makeProperty({ price: 480000000, areaSqm: 84 }));
    expect(r.eligible).toBe(true);
    expect(r.bindingConstraint).toBe('CAP');
    expect(r.limit).toBeLessThanOrEqual(240000000);
  });
});

describe('binding constraint 조언은 물건 맥락을 반영한다', () => {
  const s = deriveScenario(baseProfile, axis('before-sole'));

  it('수도권이라 LTV가 눌린 경우에만 "비수도권으로 바꾸라"고 안내한다', () => {
    const gyeonggi = makeProperty({ region: 'gyeonggi', sigungu: '평택시', price: 300000000 });
    const advice = constraintAdvice(calcLoan(bogeumjari, baseProfile, s, gyeonggi), gyeonggi);
    expect(advice).toContain('비수도권');
  });

  it('이미 비수도권 80%를 받고 있으면 지역을 바꾸라고 하지 않는다', () => {
    const changwon = makeProperty({ region: 'changwon', price: 300000000 });
    const r = calcLoan(bogeumjari, baseProfile, s, changwon);
    expect(r.bindingConstraint).toBe('LTV');
    const advice = constraintAdvice(r, changwon);
    expect(advice).not.toContain('비수도권 물건이면');
    expect(advice).toContain('최대 LTV');
  });

  it('규제지역이면 규제지역을 원인으로 지목한다', () => {
    const regulated = makeProperty({
      region: 'gyeonggi',
      sigungu: '과천시',
      price: 400000000,
    });
    const advice = constraintAdvice(calcLoan(bank, baseProfile, s, regulated), regulated);
    expect(advice).toContain('규제지역');
  });
});

describe('필요현금과 실행가능성', () => {
  it('필요현금 = (매매가 − 대출액) + 부대비용', () => {
    const s = deriveScenario(baseProfile, axis('before-sole'));
    const r = calcLoan(bogeumjari, baseProfile, s, makeProperty());
    expect(r.requiredCash).toBe(Math.round(r.downPayment + r.costs.total));
    expect(r.downPayment).toBe(380000000 - r.limit);
  });

  it('가용현금이 필요현금에 못 미치면 실행 불가로 표시된다', () => {
    const p = { ...baseProfile, ownCash: 30000000 };
    const s = deriveScenario(p, axis('before-sole'));
    const r = calcLoan(bogeumjari, p, s, makeProperty());
    expect(r.feasible).toBe(false);
    expect(r.cashGap).toBeGreaterThan(0);
  });

  it('실거주 의무는 경고로 노출된다', () => {
    const s = deriveScenario(baseProfile, axis('before-sole'));
    const r = calcLoan(bogeumjari, baseProfile, s, makeProperty());
    expect(r.warnings.some((w) => w.includes('실거주'))).toBe(true);
  });
});

describe('상품 랭킹', () => {
  const s = deriveScenario(baseProfile, axis('before-sole'));
  const property = makeProperty();

  it('월납 최소화와 한도 최대화는 서로 다른 상품을 고를 수 있다', () => {
    const byMonthly = rankProducts(baseProfile, s, property, 'monthly').best;
    const byLimit = rankProducts(baseProfile, s, property, 'limit').best;
    expect(byMonthly).not.toBeNull();
    expect(byLimit).not.toBeNull();
    expect(byLimit!.limit).toBeGreaterThanOrEqual(byMonthly!.limit);
  });

  it('부적격 상품도 결과에 남아 사유가 보인다 (부정 결과를 숨기지 않음)', () => {
    const { all } = rankProducts(baseProfile, s, property, 'interest');
    expect(all.length).toBe(4);
    const rejected = all.filter((r) => !r.eligible);
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((r) => Boolean(r.rejectReason))).toBe(true);
  });

  it('실행 가능한 상품이 있으면 그중에서 고른다', () => {
    const { best } = rankProducts(baseProfile, s, property, 'interest');
    expect(best?.feasible).toBe(true);
  });
});
