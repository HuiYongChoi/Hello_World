/**
 * 저장값 복원 · 초점 물건 규칙 — React 를 모르는 순수 함수.
 *
 * 스토어(`store.tsx`)가 쓰고, 테스트가 기존 localStorage 값과의 호환을 여기서 고정합니다.
 * 키(`STORAGE_KEY`)를 바꾸지 않는 이유는 기존 사용자의 물건·프로필을 그대로 읽기 위해서입니다 —
 * 새 필드는 전부 없어도 되는 값이라, 옛 저장값은 "새 필드가 빈 상태" 로 읽힙니다.
 */
import { ALL_SCENARIO_AXES } from '../engine/scenario';
import { type SubscriptionPlan } from '../engine/subscription';
import type { Objective, Profile, Property } from '../engine/types';
import { DEFAULT_PROFILE, SAMPLE_PROPERTIES, emptyProperty } from './defaults';

export const STORAGE_KEY = 'house-simulator-state-v1';

export interface PersistedState {
  profile: Profile;
  properties: Property[];
  /** 청약 단지 — 선택 입력. 없으면 청약 축이 화면에 안 나옵니다. */
  plans: SubscriptionPlan[];
  enabledScenarioIds: string[];
  objective: Objective;
  /**
   * 화면들이 축으로 삼는 물건. 저장값 그대로라 지워진 물건을 가리킬 수 있으므로
   * 읽을 때는 늘 `resolveFocusId` 를 거칩니다 (없으면 첫 물건).
   */
  focusPropertyId: string | null;
}

export function defaultState(): PersistedState {
  return {
    profile: DEFAULT_PROFILE,
    properties: SAMPLE_PROPERTIES,
    plans: [],
    enabledScenarioIds: ALL_SCENARIO_AXES.map((a) => a.id),
    objective: 'monthly',
    focusPropertyId: SAMPLE_PROPERTIES[0]?.id ?? null,
  };
}

/** localStorage 문자열 → 상태. 비었거나 손상됐으면 기본값 */
export function restoreState(raw: string | null): PersistedState {
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState> | null;
    if (!parsed?.profile || !Array.isArray(parsed.properties)) return defaultState();
    return {
      profile: { ...DEFAULT_PROFILE, ...parsed.profile },
      properties: parsed.properties,
      plans: parsed.plans ?? [],
      enabledScenarioIds: parsed.enabledScenarioIds?.length
        ? parsed.enabledScenarioIds
        : ALL_SCENARIO_AXES.map((a) => a.id),
      objective: parsed.objective ?? 'monthly',
      // 이 필드가 생기기 전 저장값에는 없습니다 → 첫 물건
      focusPropertyId: resolveFocusId(parsed.properties, parsed.focusPropertyId ?? null),
    };
  } catch {
    // 손상된 저장값은 무시하고 기본값으로 시작합니다.
    return defaultState();
  }
}

/** 가리키는 물건이 있으면 그대로, 없으면 첫 물건, 물건이 없으면 null */
export function resolveFocusId(properties: Property[], id: string | null | undefined): string | null {
  if (id && properties.some((p) => p.id === id)) return id;
  return properties[0]?.id ?? null;
}

/**
 * 물건을 지운 뒤의 초점. 초점이 아닌 물건을 지우면 그대로,
 * 초점을 지우면 바로 다음 물건(마지막이었으면 바로 앞 물건)으로.
 */
export function focusAfterRemove(
  properties: Property[],
  removedId: string,
  focusId: string | null
): string | null {
  const rest = properties.filter((p) => p.id !== removedId);
  const current = resolveFocusId(properties, focusId);
  if (current !== removedId) return resolveFocusId(rest, current);
  const i = properties.findIndex((p) => p.id === removedId);
  return rest[Math.min(i, rest.length - 1)]?.id ?? null;
}

/**
 * 새 물건 = 빈 물건 위에 초안을 덮은 것. id 는 초안에 있어도 항상 새로 받은 값을 씁니다.
 * 초안의 `undefined` 값은 빈 물건의 기본값을 지우지 않도록 건너뜁니다
 * (`scores: undefined` 가 덮이면 점수 계산이 깨집니다).
 */
export function newProperty(id: string, draft?: Partial<Property>): Property {
  const base = emptyProperty(id);
  if (!draft) return base;
  const defined = Object.fromEntries(
    Object.entries(draft).filter(([, v]) => v !== undefined)
  ) as Partial<Property>;
  return { ...base, ...defined, id };
}
