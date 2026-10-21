import { describe, expect, it } from 'vitest';
import { autoIndicators, autoSummary } from '../autoScore';
import { MARKET } from '../market';
import { draftToProperty, pickFromMarket } from '../pick';
import { INDICATORS } from '../scoring';
import type { Property } from '../types';
import { makeProperty } from './fixtures';

const picked = (cx: string, area: number): Property => ({
  ...makeProperty(),
  ...draftToProperty(pickFromMarket(cx, area)!),
});
const byId = (p: Property) => new Map(autoIndicators(p).map((a) => [a.id, a]));

/** 부산 단지 중 아무거나 — 후보판(마산)에는 없습니다 */
const busanCx = MARKET.complexes.find((c) => c.region === 'busan' && c.sizes.length)!;

describe('자동 지표 — 25개 전부, 없는 것은 없다고', () => {
  it('INDICATORS 의 모든 id 가 결과에 있습니다 (빠지면 실패)', () => {
    for (const p of [picked('48125-555', 84), makeProperty(), picked(busanCx.id, busanCx.sizes[0].area)]) {
      expect(autoIndicators(p).map((a) => a.id)).toEqual(INDICATORS.map((i) => i.id));
    }
  });

  it('none 은 raw·score 둘 다 없고, 근거 문장은 있습니다', () => {
    for (const a of autoIndicators(picked('48125-555', 84))) {
      expect(a.basis.length).toBeGreaterThan(0);
      if (a.status === 'none') {
        expect(a.raw).toBeUndefined();
        expect(a.score).toBeUndefined();
      } else {
        expect(a.raw !== undefined || a.score !== undefined).toBe(true);
      }
    }
  });

  it('후보판 단지(48125-555 84㎡)는 brt·mart·park 대리, hospital 은 none', () => {
    const m = byId(picked('48125-555', 84));
    for (const id of ['brt', 'mart', 'park']) {
      expect(m.get(id)!.status).toBe('proxy');
      expect(m.get(id)!.score).toBeGreaterThanOrEqual(0);
      expect(m.get(id)!.score).toBeLessThanOrEqual(100);
    }
    // 후보판 auto: bus 3 · shop 4 · walk 5 → (단계−1)/4×100
    expect(m.get('brt')!.score).toBe(50);
    expect(m.get('mart')!.score).toBe(75);
    expect(m.get('park')!.score).toBe(100);
    expect(m.get('hospital')!.status).toBe('none');
    expect(m.get('commuteSelf')!.status).toBe('proxy');
    expect(m.get('commuteSelf')!.raw).toBeGreaterThan(0);
    expect(m.get('commuteSelf')!.basis).toContain('함안의령지사');
  });

  it('후보판에 없는 부산 단지는 생활 인프라·통근이 전부 none', () => {
    const m = byId(picked(busanCx.id, busanCx.sizes[0].area));
    for (const id of ['brt', 'mart', 'park', 'hospital', 'commuteSelf']) expect(m.get(id)!.status).toBe('none');
  });

  it('populationTrend 는 세 권역 모두 measured (권역 단위)', () => {
    for (const region of ['changwon', 'busan', 'gyeonggi'] as const) {
      const a = byId(makeProperty({ region })).get('populationTrend')!;
      expect(a.status).toBe('measured');
      expect(a.raw).toBeGreaterThanOrEqual(1);
      expect(a.raw).toBeLessThanOrEqual(5);
      expect(a.scope).toBe('권역');
    }
  });

  it('districtTier — 용호동 5 · 가음정 4 · 마산 2 · 부산 none', () => {
    const yongho = MARKET.complexes.find((c) => c.umd === '용호동' && c.regionCode === '48123')!;
    expect(byId(picked(yongho.id, yongho.sizes[0].area)).get('districtTier')!.raw).toBe(5);
    expect(byId(picked('48123-90', 60)).get('districtTier')!.raw).toBe(4);
    expect(byId(picked('48125-555', 84)).get('districtTier')!.raw).toBe(2);
    expect(byId(picked('48127-139', 43)).get('districtTier')!.raw).toBe(2);
    expect(byId(picked(busanCx.id, busanCx.sizes[0].area)).get('districtTier')!.status).toBe('none');
    // 부산 남구에도 용호동이 있습니다 — 법정동만으로 잇지 않습니다
    const busanYongho = MARKET.complexes.find((c) => c.umd === '용호동' && c.region === 'busan');
    if (busanYongho) {
      expect(byId(picked(busanYongho.id, busanYongho.sizes[0].area)).get('districtTier')!.status).toBe('none');
    }
  });

  it('districtTier — 성산 기타 법정동 3, 고리 없는 성산구 물건은 none', () => {
    const other = MARKET.complexes.find((c) => c.regionCode === '48123' && c.umd === '사파동')!;
    expect(byId(picked(other.id, other.sizes[0].area)).get('districtTier')!.raw).toBe(3);
    expect(byId(makeProperty({ sigungu: '창원시 성산구' })).get('districtTier')!.status).toBe('none');
    expect(byId(makeProperty({ sigungu: '창원시 진해구' })).get('districtTier')!.raw).toBe(2);
  });

  it('builtYear 는 고리가 있으면 measured, 없으면 none', () => {
    const m = byId(picked('48123-171', 85));
    expect(m.get('builtYear')!.status).toBe('measured');
    expect(m.get('builtYear')!.raw).toBe(MARKET.complexes.find((c) => c.id === '48123-171')!.buildYear);
    expect(byId(makeProperty()).get('builtYear')!.status).toBe('none');
  });

  it('세대수는 어디서도 자동값을 받지 않습니다', () => {
    for (const p of [picked('48125-555', 84), picked('48123-171', 85), makeProperty()]) {
      expect(byId(p).get('householdCount')!.status).toBe('none');
    }
  });

  it('요약 — 자동 + 직접 = 25', () => {
    const s = autoSummary(autoIndicators(picked('48125-555', 84)));
    expect(s.auto + s.none).toBe(INDICATORS.length);
    expect(s.measured).toBe(2); // 준공 · 인구
    expect(s.proxy).toBe(6); // brt · 통근 · 마트 · 공원 · 공급 · 생활권
  });
});
