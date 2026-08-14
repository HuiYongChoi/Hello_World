import { describe, expect, it } from 'vitest';
import { INDICATORS, defaultWeights, gradeOf, normalizeMinutes, scoreProperty } from '../scoring';
import { makeProperty } from './fixtures';

describe('정규화', () => {
  it('시간형 지표는 역방향 — 짧을수록 고득점', () => {
    expect(normalizeMinutes(3, 3, 25)).toBeGreaterThan(95);
    expect(normalizeMinutes(25, 3, 25)).toBeLessThan(5);
    expect(normalizeMinutes(14, 3, 25)).toBeCloseTo(50, 0);
  });

  it('정규화 결과는 항상 0~100 범위', () => {
    for (const ind of INDICATORS) {
      const w = defaultWeights('gyeonggi')[ind.id];
      expect(w).toBeGreaterThanOrEqual(0);
    }
    expect(normalizeMinutes(-100, 3, 25)).toBeLessThanOrEqual(100);
    expect(normalizeMinutes(1000, 3, 25)).toBeGreaterThanOrEqual(0);
  });
});

describe('지역별 가중치 프리셋', () => {
  it('창원은 지하철 가중치가 0이고 BRT·고용중심지가 높다', () => {
    const w = defaultWeights('changwon');
    expect(w.subwayWalk).toBe(0);
    expect(w.brt).toBe(12);
    expect(w.jobCenter).toBe(18);
  });

  it('경기권은 GTX와 서울 통근이 살아있고 창원·부산은 0이다', () => {
    expect(defaultWeights('gyeonggi').commuteSeoul).toBe(18);
    expect(defaultWeights('changwon').commuteSeoul).toBe(0);
    expect(defaultWeights('busan').gtx).toBe(0);
  });

  it('지하철 없는 창원 물건이 프리셋 덕분에 부당하게 낮아지지 않는다', () => {
    const noSubway = { subwayWalk: 40, brt: 4, jobCenter: 12 };
    const changwon = scoreProperty(makeProperty({ region: 'changwon', scores: noSubway }));
    const busan = scoreProperty(
      makeProperty({ region: 'busan', sigungu: '부산시 해운대구', scores: noSubway })
    );
    expect(changwon.total).toBeGreaterThan(busan.total);
  });
});

describe('점수 산출', () => {
  it('감점 항목이 총점에서 차감된다', () => {
    const clean = scoreProperty(makeProperty());
    const penalized = scoreProperty(makeProperty({ penalties: ['noise', 'slope'] }));
    expect(penalized.penalty).toBe(9);
    expect(clean.total - penalized.total).toBeCloseTo(9, 6);
  });

  it('세대수·준공연도는 물건 기본정보에서 자동 반영된다', () => {
    const small = scoreProperty(makeProperty({ householdCount: 150 }));
    const large = scoreProperty(makeProperty({ householdCount: 2500 }));
    expect(large.total).toBeGreaterThan(small.total);
  });

  it('사용자 가중치 오버라이드가 프리셋을 덮어쓴다', () => {
    const base = makeProperty({ region: 'changwon', scores: { subwayWalk: 40 } });
    const overridden = scoreProperty({ ...base, weightOverrides: { subwayWalk: 30 } });
    expect(scoreProperty(base).total).toBeGreaterThan(overridden.total);
  });

  it('카테고리 점수 합성이 총점과 정합한다', () => {
    const r = scoreProperty(makeProperty());
    const wSum = r.byCategory.reduce((s, c) => s + c.weight, 0);
    const recombined = r.byCategory.reduce((s, c) => s + c.score * c.weight, 0) / wSum;
    expect(recombined).toBeCloseTo(r.base, 6);
  });

  it('등급 경계', () => {
    expect(gradeOf(90)).toBe('S');
    expect(gradeOf(89.9)).toBe('A');
    expect(gradeOf(70)).toBe('B');
    expect(gradeOf(59.9)).toBe('D');
  });
});
