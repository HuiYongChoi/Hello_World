import { describe, expect, it } from 'vitest';
import { leverageView } from '../leverage';
import { calcLoan } from '../loan';
import { getProduct } from '../rules';
import { ALL_SCENARIO_AXES, deriveScenario } from '../scenario';
import { baseProfile, makeProperty } from './fixtures';

const axis = (id: string) => ALL_SCENARIO_AXES.find((a) => a.id === id)!;
const bogeumjari = getProduct('bogeumjari_first');
const scenario = deriveScenario(baseProfile, axis('before-sole'));

/** 같은 물건·같은 프로필을 지역만 바꿔 LTV 70% / 80%를 만듭니다. */
function views(priceGrowthRate: number) {
  const nonCapital = makeProperty({ region: 'changwon', sigungu: '창원시 성산구' });
  const capital = makeProperty({ region: 'gyeonggi', sigungu: '평택시' });

  const ltv80 = leverageView(
    calcLoan(bogeumjari, baseProfile, scenario, nonCapital),
    nonCapital,
    priceGrowthRate
  )!;
  const ltv70 = leverageView(
    calcLoan(bogeumjari, baseProfile, scenario, capital),
    capital,
    priceGrowthRate
  )!;
  return { ltv80, ltv70 };
}

describe('레버리지 배율', () => {
  it('LTV 80%의 부채비율이 70%보다 높다 (4.0배 vs 2.33배)', () => {
    const { ltv80, ltv70 } = views(0.03);
    expect(ltv80.debtToEquity).toBeCloseTo(4.0, 1);
    expect(ltv70.debtToEquity).toBeCloseTo(2.33, 1);
  });

  it('손익분기 가격상승률은 적용금리와 같다', () => {
    const r = calcLoan(bogeumjari, baseProfile, scenario, makeProperty());
    const v = leverageView(r, makeProperty(), 0.03)!;
    expect(v.breakEvenGrowth).toBeCloseTo(r.rate, 10);
  });

  it('부적격이거나 한도 0이면 분석 대상이 아니다', () => {
    const rejected = calcLoan(
      getProduct('didimdol_first'),
      baseProfile,
      scenario,
      makeProperty({ price: 380000000 })
    );
    expect(rejected.eligible).toBe(false);
    expect(leverageView(rejected, makeProperty(), 0.03)).toBeNull();
  });
});

describe('스프레드 부호가 레버리지의 방향을 뒤집는다', () => {
  it('가격상승률이 금리를 밑돌면 레버리지가 손실을 키운다', () => {
    // 금리 약 4.8% 대비 가격상승 1% — 스프레드 음수
    const { ltv80, ltv70 } = views(0.01);

    expect(ltv80.spread).toBeLessThan(0);
    expect(ltv80.amplifying).toBe(false);

    // 무차입보다 나쁘고, 배율이 클수록 더 나쁘다
    expect(ltv80.equityReturn).toBeLessThan(ltv80.unleveredReturn);
    expect(ltv80.equityReturn).toBeLessThan(ltv70.equityReturn);
  });

  it('가격상승률이 금리를 웃돌면 레버리지가 수익을 증폭한다', () => {
    const { ltv80, ltv70 } = views(0.08);

    expect(ltv80.spread).toBeGreaterThan(0);
    expect(ltv80.amplifying).toBe(true);

    expect(ltv80.equityReturn).toBeGreaterThan(ltv80.unleveredReturn);
    expect(ltv80.equityReturn).toBeGreaterThan(ltv70.equityReturn);
  });

  it('"비수도권 LTV 80%가 항상 유리하다"는 통념이 실제로 뒤집힌다', () => {
    // 동일 조건에서 가정만 바꿨을 때 우열이 반대로 나오는지 확인
    const low = views(0.01);
    const high = views(0.08);

    expect(low.ltv80.equityReturn).toBeLessThan(low.ltv70.equityReturn);
    expect(high.ltv80.equityReturn).toBeGreaterThan(high.ltv70.equityReturn);
  });

  it('스프레드가 0이면 배율과 무관하게 무차입 수익률과 같다', () => {
    const property = makeProperty();
    const r = calcLoan(bogeumjari, baseProfile, scenario, property);
    const v = leverageView(r, property, r.rate)!;

    expect(v.spread).toBeCloseTo(0, 10);
    expect(v.equityReturn).toBeCloseTo(v.unleveredReturn, 10);
  });
});
