import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ALL_SCENARIO_AXES } from '../engine/scenario';
import { buildMatrix, type MatrixResult } from '../engine/matrix';
import { emptyPlan, type SubscriptionPlan } from '../engine/subscription';
import type { Objective, Profile, Property } from '../engine/types';
import { SAMPLE_PROPERTIES } from './defaults';
import {
  STORAGE_KEY,
  defaultState,
  focusAfterRemove,
  newProperty,
  resolveFocusId,
  restoreState,
  type PersistedState,
} from './persist';

interface Store extends PersistedState {
  matrix: MatrixResult;
  /** 초점 물건 — `focusPropertyId` 를 풀어 낸 값 (가리키는 물건이 없으면 첫 물건) */
  focusProperty: Property | null;
  setProfile: (patch: Partial<Profile>) => void;
  /** 초안 없이 부르면 빈 물건. 초안이 있으면 그 위에 덮고, 새 id 를 돌려줍니다 (초점은 안 바꿈) */
  addProperty: (draft?: Partial<Property>) => string;
  updateProperty: (id: string, patch: Partial<Property>) => void;
  removeProperty: (id: string) => void;
  setFocusProperty: (id: string | null) => void;
  addPlan: () => string;
  updatePlan: (id: string, patch: Partial<SubscriptionPlan>) => void;
  removePlan: (id: string) => void;
  toggleScenario: (id: string) => void;
  setObjective: (o: Objective) => void;
  loadSamples: () => void;
  reset: () => void;
}

const StoreContext = createContext<Store | null>(null);

function initialState(): PersistedState {
  if (typeof window === 'undefined') return defaultState();
  try {
    return restoreState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // 저장소 접근이 막힌 환경(프라이빗 모드 등)은 기본값으로 시작합니다.
    return defaultState();
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(initialState);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 저장 실패(용량 초과·프라이빗 모드)는 계산에 영향이 없으므로 무시합니다.
    }
  }, [state]);

  const setProfile = useCallback((patch: Partial<Profile>) => {
    setState((s) => ({ ...s, profile: { ...s.profile, ...patch } }));
  }, []);

  const addProperty = useCallback((draft?: Partial<Property>) => {
    const id = `p-${Date.now().toString(36)}`;
    setState((s) => ({ ...s, properties: [...s.properties, newProperty(id, draft)] }));
    return id;
  }, []);

  const updateProperty = useCallback((id: string, patch: Partial<Property>) => {
    setState((s) => ({
      ...s,
      properties: s.properties.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }, []);

  const removeProperty = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      properties: s.properties.filter((p) => p.id !== id),
      focusPropertyId: focusAfterRemove(s.properties, id, s.focusPropertyId),
    }));
  }, []);

  const setFocusProperty = useCallback((id: string | null) => {
    setState((s) => (s.focusPropertyId === id ? s : { ...s, focusPropertyId: id }));
  }, []);

  const addPlan = useCallback(() => {
    const id = `sub-${Date.now().toString(36)}`;
    setState((s) => ({ ...s, plans: [...s.plans, emptyPlan(id)] }));
    return id;
  }, []);

  const updatePlan = useCallback((id: string, patch: Partial<SubscriptionPlan>) => {
    setState((s) => ({
      ...s,
      plans: s.plans.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }, []);

  const removePlan = useCallback((id: string) => {
    setState((s) => ({ ...s, plans: s.plans.filter((p) => p.id !== id) }));
  }, []);

  const toggleScenario = useCallback((id: string) => {
    setState((s) => {
      const has = s.enabledScenarioIds.includes(id);
      // 최소 하나는 남겨야 매트릭스가 성립합니다.
      if (has && s.enabledScenarioIds.length === 1) return s;
      return {
        ...s,
        enabledScenarioIds: has
          ? s.enabledScenarioIds.filter((x) => x !== id)
          : ALL_SCENARIO_AXES.filter(
              (a) => a.id === id || s.enabledScenarioIds.includes(a.id)
            ).map((a) => a.id),
      };
    });
  }, []);

  const setObjective = useCallback((objective: Objective) => {
    setState((s) => ({ ...s, objective }));
  }, []);

  const loadSamples = useCallback(() => {
    setState((s) => ({
      ...s,
      properties: SAMPLE_PROPERTIES,
      focusPropertyId: resolveFocusId(SAMPLE_PROPERTIES, s.focusPropertyId),
    }));
  }, []);

  const reset = useCallback(() => {
    setState(defaultState());
  }, []);

  const matrix = useMemo(() => {
    const axes = ALL_SCENARIO_AXES.filter((a) => state.enabledScenarioIds.includes(a.id));
    return buildMatrix(state.profile, axes, state.properties, state.objective);
  }, [state.profile, state.enabledScenarioIds, state.properties, state.objective]);

  const focusPropertyId = resolveFocusId(state.properties, state.focusPropertyId);
  const focusProperty = state.properties.find((p) => p.id === focusPropertyId) ?? null;

  const value: Store = {
    ...state,
    focusPropertyId,
    focusProperty,
    matrix,
    setProfile,
    addProperty,
    updateProperty,
    removeProperty,
    setFocusProperty,
    addPlan,
    updatePlan,
    removePlan,
    toggleScenario,
    setObjective,
    loadSamples,
    reset,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
