import { describe, expect, it } from 'vitest';
import { SAMPLE_PROPERTIES } from '../../state/defaults';
import { autoIndicators } from '../autoScore';
import { draftToProperty, pickFromMarket } from '../pick';
import {
  INDICATORS,
  PENALTIES,
  categoryCoverage,
  coverageLabel,
  defaultRaw,
  defaultWeights,
  gradeLabel,
  gradeOf,
  normalize,
  normalizeMinutes,
  scoreProperty,
} from '../scoring';
import type { Property } from '../types';
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
    expect(w.jobCenter).toBe(18);
    // BRT 축 위에 있느냐가 창원의 갈림길이라, 교통 지표 중 가장 무겁습니다.
    expect(w.brt).toBe(16);
    expect(w.brt).toBeGreaterThan(w.arterialRoad);
    expect(w.brt).toBeGreaterThan(defaultWeights('busan').brt);
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

/** 자동 점수가 들어오기 전의 산술 그대로 — 회귀 기준 */
function legacyTotal(p: Property): number {
  const w: Record<string, number> = { ...defaultWeights(p.region), ...(p.weightOverrides ?? {}) };
  let sum = 0;
  let wsum = 0;
  for (const ind of INDICATORS) {
    const raw =
      ind.id === 'householdCount' ? p.householdCount : ind.id === 'builtYear' ? p.builtYear : (p.scores[ind.id] ?? defaultRaw(ind));
    sum += normalize(ind, raw) * (w[ind.id] ?? 0);
    wsum += w[ind.id] ?? 0;
  }
  const penalty = p.penalties.reduce((s, id) => s + (PENALTIES.find((x) => x.id === id)?.points ?? 0), 0);
  return Math.min(100, Math.max(0, (wsum > 0 ? sum / wsum : 0) - penalty));
}

const picked = (cx: string, area: number, over: Partial<Property> = {}): Property => ({
  ...makeProperty(),
  ...draftToProperty(pickFromMarket(cx, area)!),
  ...over,
});

describe('자동 점수 주입', () => {
  it('autoFill 없는 물건의 총점은 예전 산술과 같습니다', () => {
    const cases = [
      ...SAMPLE_PROPERTIES,
      makeProperty(),
      makeProperty({ penalties: ['noise'], weightOverrides: { subwayWalk: 30 } }),
      makeProperty({ link: { complexId: '48125-555', area: 84 } }), // 고리만 있고 autoFill 없음
    ];
    for (const p of cases) {
      const r = scoreProperty(p);
      expect(r.total).toBeCloseTo(legacyTotal(p), 10);
      expect(r.byIndicator.every((i) => i.source === 'user' || i.source === 'default')).toBe(true);
    }
  });

  it('autoFill + link 물건은 준공연도·인구 추이가 measured', () => {
    const r = scoreProperty(picked('48123-171', 85, { householdCount: 900 }));
    const by = new Map(r.byIndicator.map((i) => [i.id, i]));
    expect(by.get('builtYear')!.source).toBe('measured');
    expect(by.get('populationTrend')!.source).toBe('measured');
    expect(by.get('futureSupply')!.source).toBe('proxy');
  });

  it('준공연도를 고치면 user 로 바뀝니다', () => {
    const p = picked('48123-171', 85);
    const r = scoreProperty({ ...p, builtYear: p.builtYear - 3 });
    expect(r.byIndicator.find((i) => i.id === 'builtYear')!.source).toBe('user');
  });

  it('사용자값이 자동값보다 우선, 지우면 자동값으로 돌아옵니다', () => {
    const p = picked('48125-555', 84);
    const auto = autoIndicators(p).find((a) => a.id === 'park')!;
    const withUser = scoreProperty({ ...p, scores: { park: 1 } }).byIndicator.find((i) => i.id === 'park')!;
    expect(withUser.source).toBe('user');
    expect(withUser.normalized).toBe(0);
    const back = scoreProperty({ ...p, scores: {} }).byIndicator.find((i) => i.id === 'park')!;
    expect(back.source).toBe('proxy');
    expect(back.normalized).toBe(auto.score);
    expect(back.raw).toBeNull();
  });

  it('none 항목은 자동 점수를 받지 않고 default 로 남습니다', () => {
    const p = picked('48125-555', 84);
    const r = scoreProperty(p);
    const none = new Set(autoIndicators(p).filter((a) => a.status === 'none').map((a) => a.id));
    none.delete('householdCount'); // 기본정보에서 읽습니다
    for (const i of r.byIndicator) if (none.has(i.id)) expect(i.source).toBe('default');
  });

  it('coverage.groundedShare = (user+measured+proxy) ÷ 전체 가중치', () => {
    const r = scoreProperty(picked('48125-555', 84, { scores: { elemInComplex: 3 } }));
    const { bySource, weightTotal, groundedShare } = r.coverage;
    expect(weightTotal).toBe(r.byIndicator.reduce((s, i) => s + i.weight, 0));
    expect(bySource.user + bySource.measured + bySource.proxy + bySource.default).toBe(weightTotal);
    expect(groundedShare).toBeCloseTo((bySource.user + bySource.measured + bySource.proxy) / weightTotal, 10);
    expect(bySource.user).toBeGreaterThan(0);
    expect(coverageLabel(r)).toBe(`근거 ${Math.round(groundedShare * 100)}%`);
  });

  it('세대수 0 → 그 지표 가중치 0 (모름은 100세대 미만이 아닙니다)', () => {
    const r = scoreProperty(makeProperty({ householdCount: 0 }));
    expect(r.byIndicator.find((i) => i.id === 'householdCount')!.weight).toBe(0);
    expect(scoreProperty(makeProperty({ householdCount: 500 })).byIndicator.find((i) => i.id === 'householdCount')!.weight).toBe(5);
  });

  it('근거 50% 미만이면 등급에 물음표', () => {
    const thin = scoreProperty(makeProperty({ householdCount: 0, builtYear: 2018 }));
    expect(thin.coverage.groundedShare).toBeLessThan(0.5);
    expect(gradeLabel(thin)).toBe(`${thin.grade}?`);
    const full = scoreProperty(SAMPLE_PROPERTIES[0]);
    expect(full.coverage.groundedShare).toBeGreaterThanOrEqual(0.5);
    expect(gradeLabel(full)).toBe(full.grade);
  });

  it('카테고리별 근거 가중치는 카테고리 가중치를 넘지 않습니다', () => {
    const r = scoreProperty(picked('48125-555', 84));
    for (const c of categoryCoverage(r)) expect(c.grounded).toBeLessThanOrEqual(c.weight);
    expect(categoryCoverage(r).reduce((s, c) => s + c.weight, 0)).toBe(r.coverage.weightTotal);
  });
});
