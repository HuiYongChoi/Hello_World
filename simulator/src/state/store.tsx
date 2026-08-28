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
import { DEFAULT_PROFILE, SAMPLE_PROPERTIES, emptyProperty } from './defaults';

const STORAGE_KEY = 'house-simulator-state-v1';

interface PersistedState {
  profile: Profile;
  properties: Property[];
  /** 청약 단지 — 선택 입력. 없으면 청약 축이 화면에 안 나옵니다. */
  plans: SubscriptionPlan[];
  enabledScenarioIds: string[];
  objective: Objective;
}

interface Store extends PersistedState {
  matrix: MatrixResult;
  setProfile: (patch: Partial<Profile>) => void;
  addProperty: () => string;
  updateProperty: (id: string, patch: Partial<Property>) => void;
  removeProperty: (id: string) => void;
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
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        if (parsed.profile && parsed.properties) {
          return {
            profile: { ...DEFAULT_PROFILE, ...parsed.profile },
            properties: parsed.properties,
            plans: parsed.plans ?? [],
            enabledScenarioIds: parsed.enabledScenarioIds?.length
              ? parsed.enabledScenarioIds
              : ALL_SCENARIO_AXES.map((a) => a.id),
            objective: parsed.objective ?? 'monthly',
          };
        }
      }
    } catch {
      // 손상된 저장값은 무시하고 기본값으로 시작합니다.
    }
  }
  return {
    profile: DEFAULT_PROFILE,
    properties: SAMPLE_PROPERTIES,
    plans: [],
    enabledScenarioIds: ALL_SCENARIO_AXES.map((a) => a.id),
    objective: 'monthly',
  };
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

  const addProperty = useCallback(() => {
    const id = `p-${Date.now().toString(36)}`;
    setState((s) => ({ ...s, properties: [...s.properties, emptyProperty(id)] }));
    return id;
  }, []);

  const updateProperty = useCallback((id: string, patch: Partial<Property>) => {
    setState((s) => ({
      ...s,
      properties: s.properties.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }, []);

  const removeProperty = useCallback((id: string) => {
    setState((s) => ({ ...s, properties: s.properties.filter((p) => p.id !== id) }));
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
    setState((s) => ({ ...s, properties: SAMPLE_PROPERTIES }));
  }, []);

  const reset = useCallback(() => {
    setState({
      profile: DEFAULT_PROFILE,
      properties: SAMPLE_PROPERTIES,
      plans: [],
      enabledScenarioIds: ALL_SCENARIO_AXES.map((a) => a.id),
      objective: 'monthly',
    });
  }, []);

  const matrix = useMemo(() => {
    const axes = ALL_SCENARIO_AXES.filter((a) => state.enabledScenarioIds.includes(a.id));
    return buildMatrix(state.profile, axes, state.properties, state.objective);
  }, [state.profile, state.enabledScenarioIds, state.properties, state.objective]);

  const value: Store = {
    ...state,
    matrix,
    setProfile,
    addProperty,
    updateProperty,
    removeProperty,
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
