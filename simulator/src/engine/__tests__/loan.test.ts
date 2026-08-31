import { describe, expect, it } from 'vitest';
import {
  calcLoan,
  constraintAdvice,
  CONSTRAINT_LABELS,
  limitDerivation,
  limitFootnote,
  rankProducts,
  requiredIncomeNote,
} from '../loan';
import { money } from '../format';
import { monthlyPayment } from '../finance';
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

describe('한도 근거 문장 (가이드 03)', () => {
  const scenario = deriveScenario(baseProfile, ALL_SCENARIO_AXES.find((a) => a.id === 'before-sole')!);

  it('구속 조건에 맞는 산출 경로를 한 줄로 낸다', () => {
    const property = makeProperty();
    const r = calcLoan(getProduct('bogeumjari_first'), baseProfile, scenario, property);
    const line = limitDerivation(r, property);

    expect(line).toContain(`${(r.appliedLtv * 100).toFixed(0)}%`);
    expect(line.length).toBeGreaterThan(10);
  });

  it('인쇄 각주는 네 후보를 모두 담는다 — 종이만 들고 나가도 빠지는 게 없어야 합니다', () => {
    const property = makeProperty();
    const r = calcLoan(getProduct('bogeumjari_first'), baseProfile, scenario, property);
    const note = limitFootnote(r, property);

    expect(note).toContain('LTV');
    expect(note).toContain('상품 한도');
    expect(note).toContain('상환능력');
    expect(note).toContain('매매가 상한');
    expect(note).toContain(CONSTRAINT_LABELS[r.bindingConstraint]);
  });

  it('각주에 최종 한도값이 들어간다', () => {
    const property = makeProperty();
    const r = calcLoan(getProduct('bank_mortgage'), baseProfile, scenario, property);
    expect(limitFootnote(r, property)).toContain(money(r.limit));
  });
});

describe('규제 상환비율 (DSR/DTI)', () => {
  const scenario = deriveScenario(baseProfile, ALL_SCENARIO_AXES.find((a) => a.id === 'before-sole')!);

  it('은행 상품은 DSR, DSR 면제 정책상품은 DTI 로 판정한다', () => {
    const bank = calcLoan(getProduct('bank_mortgage'), baseProfile, scenario, makeProperty());
    const policy = calcLoan(getProduct('bogeumjari_first'), baseProfile, scenario, makeProperty());

    expect(bank.regulatoryKind).toBe('DSR');
    expect(policy.regulatoryKind).toBe('DTI');
    expect(bank.regulatoryCap).toBe(0.4);
    expect(policy.regulatoryCap).toBe(0.6);
  });

  it('스트레스 금리를 얹으므로 규제 DSR 은 실제 부담률보다 높다', () => {
    const bank = calcLoan(getProduct('bank_mortgage'), baseProfile, scenario, makeProperty());
    expect(bank.regulatoryRatio).toBeGreaterThan(bank.dtiRatio);
  });

  it('스트레스가 없는 정책상품은 규제 비율과 실제 부담률이 같다', () => {
    const policy = calcLoan(getProduct('bogeumjari_first'), baseProfile, scenario, makeProperty());
    expect(policy.regulatoryRatio).toBeCloseTo(policy.dtiRatio, 10);
  });

  it('규제 비율이 상한을 넘지 않는다 — 넘으면 한도가 그만큼 깎였어야 합니다', () => {
    for (const id of ['bank_mortgage', 'bogeumjari_first']) {
      const r = calcLoan(getProduct(id), baseProfile, scenario, makeProperty());
      if (!r.eligible) continue;
      expect(r.regulatoryRatio).toBeLessThanOrEqual(r.regulatoryCap + 0.001);
    }
  });

  it('부적격이어도 필드가 비어 있지 않다', () => {
    const r = calcLoan(getProduct('sinsaenga_special'), baseProfile, scenario, makeProperty());
    expect(r.eligible).toBe(false);
    expect(r.regulatoryKind).toBeDefined();
  });
});

/**
 * 보금자리론은 **생애최초가 자격 요건이 아닙니다** — 무주택 세대면 됩니다.
 * 생애최초는 LTV·한도 우대 조건일 뿐입니다.
 *
 * 예전에는 우대값(80% · 4.2억)이 무조건값으로 박혀 있어서, 생애최초가 아닌
 * 사람에게도 우대 한도가 나갔습니다. 상품 이름이 "(생애최초)" 라 그 어긋남이
 * 가려져 있었습니다.
 */
describe('생애최초 — 요건인가 우대인가', () => {
  const notFirst = { ...baseProfile, isFirstTime: false };
  const s = deriveScenario(notFirst, axis('before-sole'));
  const changwon = makeProperty({ region: 'changwon' });

  it('보금자리론은 생애최초가 아니어도 자격을 통과합니다', () => {
    const r = calcLoan(bogeumjari, notFirst, s, changwon);
    expect(r.eligible).toBe(true);
  });

  it('디딤돌은 생애최초가 아니면 탈락합니다 — 이쪽은 요건입니다', () => {
    /*
     * 자격 게이트는 순서대로 걸립니다 — 소득 → 순자산 → 가격 → 면적 → 생애최초.
     * 생애최초 게이트까지 도달하려면 앞의 넷을 다 통과시켜야 합니다.
     */
    const lowIncome = { ...notFirst, ownIncome: 30000000, spouseIncome: 20000000 };
    const joint = deriveScenario(lowIncome, axis('after-joint'));
    const r = calcLoan(didimdol, lowIncome, joint, changwon);
    expect(r.eligible).toBe(false);
    expect(r.rejectReason).toContain('생애최초');
  });

  it('보금자리론 LTV 는 생애최초 80% / 아니면 80% 아래로 갈립니다', () => {
    const first = calcLoan(bogeumjari, baseProfile, deriveScenario(baseProfile, axis('before-sole')), changwon);
    const plain = calcLoan(bogeumjari, notFirst, s, changwon);
    expect(first.appliedLtv).toBeCloseTo(0.8, 6);
    expect(plain.appliedLtv).toBeLessThan(first.appliedLtv);
  });

  it('한도 우대도 같이 갈립니다 — 우대값을 무조건값으로 두면 안 됩니다', () => {
    const first = calcLoan(bogeumjari, baseProfile, deriveScenario(baseProfile, axis('before-sole')), changwon);
    const plain = calcLoan(bogeumjari, notFirst, s, changwon);
    expect(plain.limitCap).toBeLessThan(first.limitCap);
  });

  it('생애최초 우대가 없는 상품은 두 시나리오가 같습니다', () => {
    const first = calcLoan(bank, baseProfile, deriveScenario(baseProfile, axis('before-sole')), changwon);
    const plain = calcLoan(bank, notFirst, s, changwon);
    expect(plain.appliedLtv).toBeCloseTo(first.appliedLtv, 6);
    expect(plain.limitCap).toBe(first.limitCap);
  });
});

/**
 * 한도가 막혔다는 사실만으로는 다음 행동이 안 나옵니다 — **"그래서 얼마를 더
 * 벌어야 하나"** 까지가 한 짝입니다. 그 값은 DTI·DSR 식을 그대로 뒤집어 냅니다.
 */
describe('필요 소득 — LTV 를 통과한다고 칠 때', () => {
  const s = deriveScenario(baseProfile, axis('before-sole'));
  const gyeonggi = makeProperty({ region: 'gyeonggi', sigungu: '평택시', price: 520000000 });

  it('상환능력을 뺀 최대는 LTV·상품캡·가격 중 최솟값입니다', () => {
    for (const product of [bogeumjari, bank]) {
      const r = calcLoan(product, baseProfile, s, gyeonggi);
      expect(r.limitBeforeRepay).toBeCloseTo(
        Math.min(r.limitLtv, r.limitCap || Infinity, r.limitPrice),
        0
      );
      // 상환능력이 막고 있어도 이 값은 그대로입니다 — 소득이 늘면 여기까지 갑니다.
      expect(r.limitBeforeRepay).toBeGreaterThanOrEqual(r.limit);
    }
  });

  /**
   * 역산이 맞는지 확인하는 가장 단단한 방법은 **되돌려 보는 것**입니다.
   * 필요소득을 가진 사람으로 다시 계산하면 상환능력이 더 이상 안 막아야 합니다.
   */
  it('필요소득을 가진 사람으로 다시 계산하면 상환능력이 안 막습니다', () => {
    const r = calcLoan(bank, baseProfile, s, gyeonggi);
    expect(r.bindingConstraint).toBe('DSR');
    expect(r.incomeGap).toBeGreaterThan(0);

    // 판정소득은 본인 소득에서 옵니다 (혼인 전 단독 축).
    const richer = { ...baseProfile, ownIncome: Math.ceil(r.requiredIncome) };
    const r2 = calcLoan(bank, richer, deriveScenario(richer, axis('before-sole')), gyeonggi);
    expect(r2.limitRepay).toBeGreaterThanOrEqual(r2.limitBeforeRepay - 1_000_000);
    expect(r2.bindingConstraint).not.toBe('DSR');
  });

  it('부족액은 필요소득 − 판정소득입니다', () => {
    const r = calcLoan(bank, baseProfile, s, gyeonggi);
    expect(r.incomeGap).toBeCloseTo(r.requiredIncome - s.assessedIncome, 0);
  });

  /**
   * 은행 상품의 필요소득은 **스트레스 금리로** 재야 합니다. 실제 금리로 재면
   * 필요소득이 실제보다 작게 나와, 그만큼 벌어도 한도가 안 나옵니다.
   */
  it('은행 상품은 스트레스 금리로 필요소득을 잽니다', () => {
    const r = calcLoan(bank, baseProfile, s, gyeonggi);
    // 실제 금리로 재면 원리금이 작아져 필요소득도 작게 나옵니다 — 그만큼 벌어도
    // 한도는 안 나옵니다. 스트레스로 잰 값이 더 커야 맞습니다.
    const naive =
      (monthlyPayment(r.limitBeforeRepay, r.rate, baseProfile.termYears) * 12) /
      r.regulatoryCap;
    expect(r.requiredIncome).toBeGreaterThan(naive);
  });

  /**
   * 정책상품은 소득이 **낮아야 자격**이 나오고 **높아야 한도**가 나옵니다.
   * 둘이 어긋나면 어떤 소득으로도 그 한도에 닿을 수 없습니다.
   */
  it('소득을 올리면 자격을 잃는 구간을 구조적 막힘으로 표시합니다', () => {
    const indebted = { ...baseProfile, existingMonthlyDebt: 2500000 };
    const r = calcLoan(bogeumjari, indebted, deriveScenario(indebted, axis('before-sole')), gyeonggi);
    expect(r.eligible).toBe(true);
    expect(r.requiredIncome).toBeGreaterThan(r.incomeCap as number);
    expect(r.requiredIncomeBlocked).toBe(true);
    expect(r.warnings.some((w) => w.includes('구조적 막힘'))).toBe(true);
  });

  it('상환능력이 안 막으면 이미 충족했다고 적습니다', () => {
    const r = calcLoan(bogeumjari, baseProfile, s, makeProperty({ region: 'changwon' }));
    expect(r.incomeGap).toBeLessThanOrEqual(0);
    expect(requiredIncomeNote(r)).toContain('이미 충족');
  });
});
