import { describe, expect, it } from 'vitest';
import { buildMatrix } from '../../engine/matrix';
import { ALL_SCENARIO_AXES } from '../../engine/scenario';
import { scoreProperty } from '../../engine/scoring';
import type { Property } from '../../engine/types';
import { DEFAULT_PROFILE, SAMPLE_PROPERTIES, emptyProperty } from '../defaults';
import {
  defaultState,
  focusAfterRemove,
  newProperty,
  resolveFocusId,
  restoreState,
} from '../persist';

const props = (...ids: string[]): Property[] => ids.map((id) => emptyProperty(id));

describe('저장값 호환 — 초점 물건이 생기기 전 저장값', () => {
  // 이 필드들이 생기기 전 실제 저장 모양 (focusPropertyId · link · autoFill · priceBasis 없음)
  const legacy = JSON.stringify({
    profile: { ...DEFAULT_PROFILE },
    properties: SAMPLE_PROPERTIES,
    plans: [],
    enabledScenarioIds: ['before-sole'],
    objective: 'interest',
  });

  it('옛 저장값을 그대로 읽고 초점은 첫 물건', () => {
    const s = restoreState(legacy);
    expect(s.properties).toEqual(SAMPLE_PROPERTIES);
    expect(s.objective).toBe('interest');
    expect(s.enabledScenarioIds).toEqual(['before-sole']);
    expect(s.focusPropertyId).toBe(SAMPLE_PROPERTIES[0].id);
  });

  it('옛 물건에는 새 필드가 없다 — 비어 있는 채로 읽힌다', () => {
    for (const p of restoreState(legacy).properties) {
      expect(p.link).toBeUndefined();
      expect(p.autoFill).toBeUndefined();
      expect(p.priceBasis).toBeUndefined();
    }
  });

  it('저장된 초점이 있으면 유지, 지워진 물건을 가리키면 첫 물건', () => {
    const base = JSON.parse(legacy);
    const keep = restoreState(JSON.stringify({ ...base, focusPropertyId: SAMPLE_PROPERTIES[1].id }));
    expect(keep.focusPropertyId).toBe(SAMPLE_PROPERTIES[1].id);
    const gone = restoreState(JSON.stringify({ ...base, focusPropertyId: 'p-deleted' }));
    expect(gone.focusPropertyId).toBe(SAMPLE_PROPERTIES[0].id);
  });

  it('비었거나 손상된 저장값은 기본값', () => {
    expect(restoreState(null)).toEqual(defaultState());
    expect(restoreState('{not json')).toEqual(defaultState());
    expect(restoreState('null')).toEqual(defaultState());
    expect(restoreState(JSON.stringify({ profile: DEFAULT_PROFILE }))).toEqual(defaultState());
  });

  it('물건이 하나도 없으면 초점은 null', () => {
    const s = restoreState(JSON.stringify({ ...JSON.parse(legacy), properties: [] }));
    expect(s.focusPropertyId).toBeNull();
  });
});

describe('초점 물건 규칙', () => {
  it('resolveFocusId — 있으면 그대로, 없으면 첫 물건', () => {
    expect(resolveFocusId(props('a', 'b'), 'b')).toBe('b');
    expect(resolveFocusId(props('a', 'b'), 'x')).toBe('a');
    expect(resolveFocusId(props('a', 'b'), null)).toBe('a');
    expect(resolveFocusId([], 'a')).toBeNull();
  });

  it('초점을 지우면 다음 물건, 마지막이면 앞 물건, 다 지우면 null', () => {
    const list = props('a', 'b', 'c');
    expect(focusAfterRemove(list, 'b', 'b')).toBe('c');
    expect(focusAfterRemove(list, 'c', 'c')).toBe('b');
    expect(focusAfterRemove(props('a'), 'a', 'a')).toBeNull();
  });

  it('초점이 아닌 물건을 지우면 초점 그대로', () => {
    expect(focusAfterRemove(props('a', 'b', 'c'), 'a', 'c')).toBe('c');
    // 초점이 비어 있으면 첫 물건이 초점이었던 셈 — 그걸 지우면 다음으로
    expect(focusAfterRemove(props('a', 'b'), 'a', null)).toBe('b');
  });
});

describe('addProperty 초안', () => {
  it('초안이 없으면 빈 물건과 같다 (기존 동작)', () => {
    expect(newProperty('p-1')).toEqual(emptyProperty('p-1'));
  });

  it('초안을 덮되 id 는 새로 받은 값', () => {
    const p = newProperty('p-new', {
      id: 'p-old',
      name: 'A아파트',
      sigungu: '창원시 성산구',
      link: { complexId: '48123-1', area: 84 },
      autoFill: true,
    });
    expect(p.id).toBe('p-new');
    expect(p.name).toBe('A아파트');
    expect(p.link).toEqual({ complexId: '48123-1', area: 84 });
    expect(p.autoFill).toBe(true);
    expect(p.scores).toEqual({});
  });

  it('초안의 undefined 는 기본값을 지우지 않는다', () => {
    const p = newProperty('p-2', { scores: undefined, penalties: undefined, price: undefined });
    expect(p.scores).toEqual({});
    expect(p.penalties).toEqual([]);
    expect(p.price).toBe(emptyProperty('p-2').price);
  });
});

describe('새 필드는 autoFill 없이 점수를 바꾸지 않는다', () => {
  const linked = (p: Property): Property => ({
    ...p,
    link: { complexId: '48123-1', area: Math.round(p.areaSqm) },
    priceBasis: { price: p.price, window: '2025Q3~2026Q2', n: 16, thin: false },
  });

  it('scoreProperty 결과가 그대로', () => {
    for (const p of SAMPLE_PROPERTIES) {
      expect(scoreProperty(linked(p))).toEqual(scoreProperty(p));
    }
  });

  it('매트릭스 결과가 그대로', () => {
    const before = buildMatrix(DEFAULT_PROFILE, ALL_SCENARIO_AXES, SAMPLE_PROPERTIES, 'monthly');
    const after = buildMatrix(
      DEFAULT_PROFILE,
      ALL_SCENARIO_AXES,
      SAMPLE_PROPERTIES.map(linked),
      'monthly'
    );
    expect(after.cells).toEqual(before.cells);
  });
});
