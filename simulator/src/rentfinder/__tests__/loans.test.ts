import { describe, expect, it } from 'vitest';
import {
  RENT_LOAN_CAVEATS,
  RENT_LOAN_PRODUCTS,
  RENT_LOAN_RULES,
  adviseRentLoans,
  assessedIncome,
  compareRentLoans,
  evaluateRentLoan,
  type Borrower,
  type RentTarget,
} from '../loans';

/** 혼인신고 전 동거 · 만 32세 · 중소기업 재직 — 이 도구를 만든 상황입니다. */
const base: Borrower = {
  age: 32,
  militaryServed: true,
  married: false,
  marriedYears: 0,
  newbornWithin2y: false,
  smeEmployed: true,
  /* 중기청 단독 소득 상한이 3,500만원이라 그 아래로 잡았습니다 — 이 한 줄이
     자격을 가르는 지점이라 픽스처에도 그대로 둡니다. */
  income: 32000000,
  spouseIncome: 38000000,
  netWorth: 80000000,
  householder: true,
  noHouse: true,
};

/** 마산 내서읍 전용 60㎡ 전세 4,500만 — 목록 상위에 실제로 있는 집입니다. */
const target: RentTarget = { deposit: 45000000, rent: 0, areaSqm: 60 };

const product = (id: string) => RENT_LOAN_PRODUCTS.find((p) => p.id === id)!;

describe('전월세 대출 룰셋', () => {
  it('정책상품과 은행상품이 같이 있습니다', () => {
    expect(RENT_LOAN_PRODUCTS.length).toBeGreaterThanOrEqual(6);
    expect(RENT_LOAN_PRODUCTS.some((p) => p.type === 'policy')).toBe(true);
    expect(RENT_LOAN_PRODUCTS.some((p) => p.type === 'bank')).toBe(true);
  });

  it('상품마다 근거와 주의가 붙어 있습니다', () => {
    for (const p of RENT_LOAN_PRODUCTS) {
      expect(p.basis.length).toBeGreaterThan(10);
      expect(p.watchOuts.length).toBeGreaterThan(0);
      expect(p.rate.min).toBeLessThanOrEqual(p.rate.max);
      expect(p.limits.depositRatio).toBeGreaterThan(0);
      expect(p.limits.depositRatio).toBeLessThanOrEqual(1);
    }
  });

  /** 규정이 수시로 바뀌는 값이라 기준일과 면책이 상시 노출돼야 합니다. */
  it('기준일과 면책이 있습니다', () => {
    expect(RENT_LOAN_RULES.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(RENT_LOAN_RULES.disclaimer).toContain('재확인');
    expect(RENT_LOAN_RULES.sources.length).toBeGreaterThan(0);
  });
});

describe('판정소득 — 혼인 여부로 갈립니다', () => {
  it('혼인신고 전이면 본인 소득만 봅니다', () => {
    expect(assessedIncome(base)).toBe(base.income);
  });

  it('혼인신고를 하면 합산합니다', () => {
    expect(assessedIncome({ ...base, married: true })).toBe(
      base.income + base.spouseIncome
    );
  });
});

describe('한도', () => {
  it('보증금 비율과 상품 상한 중 작은 쪽입니다', () => {
    for (const r of compareRentLoans(base, target)) {
      if (!r.eligible) continue;
      const byRatio = target.deposit * r.product.limits.depositRatio;
      expect(r.limit).toBeLessThanOrEqual(Math.max(byRatio, r.product.limits.cap));
      expect(r.limit).toBeLessThanOrEqual(byRatio + 10000);
    }
  });

  it('무엇이 한도를 막았는지 밝힙니다', () => {
    const small = evaluateRentLoan(product('jungsocheong'), base, target);
    expect(small.bindingConstraint).toBe('RATIO');
    const big = evaluateRentLoan(product('jungsocheong'), base, {
      ...target,
      deposit: 190000000,
    });
    expect(big.bindingConstraint).toBe('CAP');
    expect(big.notes.join(' ')).toContain('상품 한도');
  });

  it('대출을 받고도 내야 하는 자기 돈을 냅니다', () => {
    const r = evaluateRentLoan(product('beotimmok_youth'), base, target);
    expect(r.ownCash).toBeCloseTo(target.deposit - r.limit, 0);
  });

  it('자격이 없으면 한도가 0입니다 — 숫자를 먼저 보여 주면 되는 줄 압니다', () => {
    const r = evaluateRentLoan(product('newlywed'), base, target);
    expect(r.eligible).toBe(false);
    expect(r.limit).toBe(0);
  });
});

describe('자격', () => {
  it('동거는 신혼이 아닙니다', () => {
    const r = evaluateRentLoan(product('newlywed'), base, target);
    expect(r.rejectReasons.join(' ')).toContain('혼인신고');
  });

  it('혼인신고를 하면 신혼부부 상품이 열립니다', () => {
    const r = evaluateRentLoan(
      product('newlywed'),
      { ...base, married: true, marriedYears: 1 },
      target
    );
    expect(r.eligible).toBe(true);
  });

  /** 중기청은 소득 문턱이 가장 낮습니다 — 여기서 갈리는 사람이 많습니다. */
  it('소득이 상한을 넘으면 중기청이 막힙니다', () => {
    const r = evaluateRentLoan(product('jungsocheong'), { ...base, income: 42000000 }, target);
    expect(r.eligible).toBe(false);
    expect(r.rejectReasons.join(' ')).toContain('연소득');
  });

  /** 하나만 보여 주면 "소득만 낮추면 되나" 로 읽힙니다. */
  it('떨어진 이유를 전부 모읍니다', () => {
    const old = { ...base, age: 45, smeEmployed: false, income: 90000000 };
    const r = evaluateRentLoan(product('jungsocheong'), old, target);
    expect(r.rejectReasons.length).toBeGreaterThanOrEqual(3);
    // 군 복무를 했으면 상한이 39세로 늘어나므로 그 숫자가 나옵니다.
    expect(r.rejectReasons.join(' ')).toContain('39세');
    expect(r.rejectReasons.join(' ')).toContain('중소');
  });

  it('군 복무를 했으면 나이 상한이 늘어납니다', () => {
    const age37 = { ...base, age: 37 };
    expect(evaluateRentLoan(product('jungsocheong'), age37, target).eligible).toBe(true);
    expect(
      evaluateRentLoan(product('jungsocheong'), { ...age37, militaryServed: false }, target)
        .rejectReasons.join(' ')
    ).toContain('34세');
  });

  it('월세 전용 상품은 전세 계약에 안 붙습니다', () => {
    const r = evaluateRentLoan(product('wolse_youth'), base, target);
    expect(r.rejectReasons.join(' ')).toContain('월세 계약');
  });

  it('보증금 상한을 넘으면 그 사실을 적습니다', () => {
    const r = evaluateRentLoan(product('jungsocheong'), base, {
      ...target,
      deposit: 250000000,
    });
    expect(r.rejectReasons.join(' ')).toContain('보증금');
  });
});

describe('비교와 조언', () => {
  it('되는 것을 금리순으로 먼저, 안 되는 것을 뒤에 둡니다', () => {
    const list = compareRentLoans(base, target);
    const okCount = list.filter((r) => r.eligible).length;
    expect(okCount).toBeGreaterThan(0);
    for (let i = 0; i < okCount; i++) expect(list[i].eligible).toBe(true);
    for (let i = okCount; i < list.length; i++) expect(list[i].eligible).toBe(false);
    for (let i = 1; i < okCount; i++) {
      expect(list[i].rate.min).toBeGreaterThanOrEqual(list[i - 1].rate.min);
    }
  });

  it('중기청이 자격되면 가장 싼 축입니다', () => {
    const list = compareRentLoans(base, target);
    expect(list[0].product.id).toBe('jungsocheong');
    expect(list[0].rate.min).toBeLessThan(0.02);
  });

  it('월 이자는 한도 × 금리 ÷ 12 입니다', () => {
    for (const r of compareRentLoans(base, target)) {
      if (!r.eligible) continue;
      expect(r.monthlyInterest.min).toBeCloseTo((r.limit * r.rate.min) / 12, 6);
      expect(r.monthlyTotal.max).toBeCloseTo(r.monthlyInterest.max + target.rent, 6);
    }
  });

  it('동거 커플에게 합산하지 않는다는 사실을 짚습니다', () => {
    const advice = adviseRentLoans(base, target, compareRentLoans(base, target));
    expect(advice.some((a) => a.headline.includes('혼인신고 전'))).toBe(true);
  });

  it('되는 상품이 하나도 없으면 그렇게 말합니다', () => {
    const blocked: Borrower = {
      ...base,
      age: 50,
      smeEmployed: false,
      income: 300000000,
      netWorth: 900000000,
      householder: false,
    };
    const list = compareRentLoans(blocked, target);
    expect(list.every((r) => !r.eligible)).toBe(true);
    expect(adviseRentLoans(blocked, target, list)[0].headline).toContain('없습니다');
  });

  it('한계가 붙어 있습니다', () => {
    expect(RENT_LOAN_CAVEATS.length).toBeGreaterThanOrEqual(4);
    expect(RENT_LOAN_CAVEATS.join(' ')).toContain('DSR');
  });
});
