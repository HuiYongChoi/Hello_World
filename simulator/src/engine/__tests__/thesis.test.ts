import { describe, expect, it } from 'vitest';
import { normalize, scoreProperty, INDICATORS } from '../scoring';
import { money } from '../format';
import { hasRedevelopmentCase, newBuildFloorFor, propertyThesis } from '../thesis';
import { makeProperty } from './fixtures';

const thisYear = new Date().getFullYear();
const indicator = (id: string) => INDICATORS.find((i) => i.id === id)!;

describe('물건 성격 판정', () => {
  it('7년 이내는 신축으로 본다', () => {
    const t = propertyThesis(makeProperty({ builtYear: thisYear - 3 }));
    expect(t.kind).toBe('newBuild');
    expect(t.preferTenure).toBe(false);
  });

  it('재건축 단계가 추진위 이상이면 연식·용적률과 무관하게 재건축 기대로 본다', () => {
    const t = propertyThesis(
      makeProperty({ builtYear: thisYear - 20, scores: { redevelopmentStage: 4 } })
    );
    expect(t.kind).toBe('redevelopment');
  });

  it('연식만 오래됐고 용적률이 높으면 재건축 기대가 아니다', () => {
    // 사업성이 안 나는 고용적률 구축 — 가장 흔한 함정
    expect(
      hasRedevelopmentCase(
        makeProperty({ builtYear: thisYear - 35, scores: { floorAreaRatio: 280 } })
      )
    ).toBe(false);
  });

  it('오래됐고 용적률이 낮으면 단계가 없어도 재건축 기대로 본다', () => {
    const t = propertyThesis(
      makeProperty({ builtYear: thisYear - 35, scores: { floorAreaRatio: 180 } })
    );
    expect(t.kind).toBe('redevelopment');
  });

  it('신축도 재건축도 아닌 저가 구축은 애매 구간으로 잡고 임차 비교로 보낸다', () => {
    // 창원 3.8억 · 2003년 준공 · 재건축 소식 없음 — 논의에서 나온 바로 그 조합
    const t = propertyThesis(
      makeProperty({ price: 380000000, builtYear: 2003, scores: { floorAreaRatio: 250 } })
    );
    expect(t.kind).toBe('ambiguous');
    expect(t.preferTenure).toBe(true);
    expect(t.advice).toContain('임차');
  });

  it('신축 하한 위 가격대면 애매 구간이 아니다', () => {
    // 하한은 실거래에서 계산되므로 재수집 때마다 바뀝니다. 값을 박지 않고 엔진에서 읽습니다.
    const base = makeProperty({ builtYear: 2003, scores: { floorAreaRatio: 250 } });
    const floor = newBuildFloorFor(base).price;

    expect(propertyThesis({ ...base, price: floor * 1.2 }).kind).toBe('stable');
    expect(propertyThesis({ ...base, price: floor * 0.8 }).kind).toBe('ambiguous');
  });

  it('신축 하한은 권역 평균이 아니라 시군구 값을 쓴다', () => {
    // 성산구와 진해구는 신축 하한이 3배 가까이 차이납니다. 권역으로 묶으면 둘 다 틀립니다.
    const seongsan = newBuildFloorFor(makeProperty({ sigungu: '창원시 성산구' }));
    const jinhae = newBuildFloorFor(makeProperty({ sigungu: '창원시 진해구' }));

    expect(seongsan.scope).toBe('창원시 성산구');
    expect(jinhae.scope).toBe('창원시 진해구');
    expect(seongsan.price).toBeGreaterThan(jinhae.price);
  });

  it('수집하지 않은 시군구는 권역값으로 물러선다', () => {
    const unknown = newBuildFloorFor(makeProperty({ sigungu: '알 수 없는 시군구' }));
    expect(unknown.scope).toBe('권역 평균');
    expect(unknown.price).toBeGreaterThan(0);
  });

  it('입지 점수와 성격 판정은 서로 독립이다 — 좋은 동네의 어중간한 구축이 존재한다', () => {
    const property = makeProperty({
      price: 380000000,
      builtYear: 2003,
      scores: { floorAreaRatio: 250, districtTier: 5, brt: 3, commuteSelf: 15, jobCenter: 12 },
    });
    expect(scoreProperty(property).total).toBeGreaterThan(60);
    expect(propertyThesis(property).kind).toBe('ambiguous');
  });
});

describe('재건축·생활권 지표', () => {
  it('용적률은 낮을수록 높은 점수를 받는다', () => {
    const far = indicator('floorAreaRatio');
    expect(normalize(far, 150)).toBeCloseTo(100, 6);
    expect(normalize(far, 300)).toBeCloseTo(0, 6);
    expect(normalize(far, 220)).toBeGreaterThan(normalize(far, 260));
  });

  it('창원은 BRT·재건축·생활권 가중치가 수도권보다 높다', () => {
    for (const id of ['brt', 'redevelopmentStage', 'districtTier', 'floorAreaRatio']) {
      const w = indicator(id).weights;
      expect(w.changwon).toBeGreaterThan(w.gyeonggi);
    }
  });

  it('재건축 단계가 오르면 총점이 오른다 — 연식 감점을 상쇄할 통로가 생겼다', () => {
    const old = makeProperty({ builtYear: 1990 });
    const noCase = scoreProperty({ ...old, scores: { redevelopmentStage: 1, floorAreaRatio: 280 } });
    const withCase = scoreProperty({
      ...old,
      scores: { redevelopmentStage: 5, floorAreaRatio: 170 },
    });
    expect(withCase.total).toBeGreaterThan(noCase.total);
  });
});

describe('표기', () => {
  it('신축 하한을 반올림해 버리지 않는다 — 4.5억이 5억으로 보이면 안 됩니다', () => {
    const base = makeProperty({ builtYear: 2003, scores: { floorAreaRatio: 250 } });
    const floor = newBuildFloorFor(base);
    const t = propertyThesis({ ...base, price: floor.price * 0.7 });

    expect(t.kind).toBe('ambiguous');
    // money() 는 소수 둘째 자리까지 냅니다. Math.round 로 억 단위를 뭉개면 여기서 걸립니다.
    expect(t.reason).toContain(money(floor.price));
    expect(t.reason).toContain(floor.scope);
  });
});
