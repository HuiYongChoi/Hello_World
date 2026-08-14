import { clamp } from './finance';
import type { Property, RegionId } from './types';

export type IndicatorKind =
  | 'minutes'
  | 'scale3'
  | 'scale5'
  | 'households'
  | 'year'
  | 'parking'
  | 'supply';

export interface Indicator {
  id: string;
  category: CategoryId;
  label: string;
  hint: string;
  kind: IndicatorKind;
  /** minutes 계열: [만점 기준 분, 0점 기준 분] */
  range?: [number, number];
  weights: Record<RegionId, number>;
}

export type CategoryId =
  | 'transit'
  | 'commute'
  | 'school'
  | 'life'
  | 'complex'
  | 'quality'
  | 'future';

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'transit', label: '교통' },
  { id: 'commute', label: '직주근접' },
  { id: 'school', label: '학군' },
  { id: 'life', label: '생활 인프라' },
  { id: 'complex', label: '단지 경쟁력' },
  { id: 'quality', label: '주거 품질' },
  { id: 'future', label: '미래가치' },
];

/**
 * 지표 마스터. weights는 설계안 §4.1 기본 가중치에 §4.2 지역 프리셋을 덮어쓴 값입니다.
 * 창원의 지하철 가중치가 0인 것처럼, 지역 특성이 없는 지표는 0으로 눌러야
 * 해당 지역 물건이 부당하게 낮게 나오지 않습니다.
 */
export const INDICATORS: Indicator[] = [
  // 교통
  {
    id: 'subwayWalk',
    category: 'transit',
    label: '지하철역 도보',
    hint: '분 — 실제 보행 경로 기준',
    kind: 'minutes',
    range: [3, 25],
    weights: { gyeonggi: 12, changwon: 0, busan: 12 },
  },
  {
    id: 'gtx',
    category: 'transit',
    label: 'GTX·광역급행 접근',
    hint: '분 — 미개통 노선은 할인 평가',
    kind: 'minutes',
    range: [5, 40],
    weights: { gyeonggi: 12, changwon: 0, busan: 0 },
  },
  {
    id: 'brt',
    category: 'transit',
    label: 'BRT·간선버스 접근',
    hint: '분 — 지하철 부재 지역의 대체 축',
    kind: 'minutes',
    range: [3, 20],
    weights: { gyeonggi: 3, changwon: 12, busan: 5 },
  },
  {
    id: 'arterialRoad',
    category: 'transit',
    label: '주요 간선도로 진입',
    hint: '분 — 고속도로 IC·자동차전용도로',
    kind: 'minutes',
    range: [3, 25],
    weights: { gyeonggi: 4, changwon: 4, busan: 4 },
  },
  // 직주근접
  {
    id: 'commuteSelf',
    category: 'commute',
    label: '본인 직장 통근시간',
    hint: '분 — 편도, 실제 이용 수단 기준',
    kind: 'minutes',
    range: [15, 90],
    weights: { gyeonggi: 15, changwon: 15, busan: 15 },
  },
  {
    id: 'commuteSpouse',
    category: 'commute',
    label: '배우자 직장 통근시간',
    hint: '분 — 편도',
    kind: 'minutes',
    range: [15, 90],
    weights: { gyeonggi: 10, changwon: 10, busan: 10 },
  },
  {
    id: 'commuteSeoul',
    category: 'commute',
    label: '서울 도심 통근시간',
    hint: '분 — 수도권 물건에만 가중치 부여',
    kind: 'minutes',
    range: [30, 100],
    weights: { gyeonggi: 18, changwon: 0, busan: 0 },
  },
  {
    id: 'jobCenter',
    category: 'commute',
    label: '지역 고용중심지 거리',
    hint: '분 — 창원국가산단 / 센텀·문현·녹산 등',
    kind: 'minutes',
    range: [10, 50],
    weights: { gyeonggi: 3, changwon: 18, busan: 14 },
  },
  // 학군
  {
    id: 'elemInComplex',
    category: 'school',
    label: '초품아',
    hint: '3=단지 내·횡단보도 없음 / 2=도보 5분 내 / 1=대로 횡단',
    kind: 'scale3',
    weights: { gyeonggi: 10, changwon: 10, busan: 10 },
  },
  {
    id: 'midHighSchool',
    category: 'school',
    label: '중·고 배정 학군',
    hint: '1~5단계',
    kind: 'scale5',
    weights: { gyeonggi: 5, changwon: 5, busan: 5 },
  },
  {
    id: 'academyAccess',
    category: 'school',
    label: '학원가 접근성',
    hint: '1~5단계',
    kind: 'scale5',
    weights: { gyeonggi: 3, changwon: 3, busan: 3 },
  },
  // 생활 인프라
  {
    id: 'mart',
    category: 'life',
    label: '대형마트·백화점',
    hint: '분',
    kind: 'minutes',
    range: [5, 30],
    weights: { gyeonggi: 4, changwon: 4, busan: 4 },
  },
  {
    id: 'hospital',
    category: 'life',
    label: '종합병원',
    hint: '분',
    kind: 'minutes',
    range: [10, 40],
    weights: { gyeonggi: 3, changwon: 3, busan: 3 },
  },
  {
    id: 'park',
    category: 'life',
    label: '공원·녹지',
    hint: '1~5단계',
    kind: 'scale5',
    weights: { gyeonggi: 3, changwon: 3, busan: 3 },
  },
  // 단지 경쟁력
  {
    id: 'householdCount',
    category: 'complex',
    label: '세대수',
    hint: '세대 — 물건 기본정보에서 자동 반영',
    kind: 'households',
    weights: { gyeonggi: 5, changwon: 5, busan: 5 },
  },
  {
    id: 'builtYear',
    category: 'complex',
    label: '준공연도',
    hint: '연 — 물건 기본정보에서 자동 반영',
    kind: 'year',
    weights: { gyeonggi: 5, changwon: 5, busan: 5 },
  },
  {
    id: 'brand',
    category: 'complex',
    label: '브랜드',
    hint: '1~5단계',
    kind: 'scale5',
    weights: { gyeonggi: 3, changwon: 3, busan: 3 },
  },
  {
    id: 'parking',
    category: 'complex',
    label: '주차 대수/세대',
    hint: '대 — 자차 의존 지역일수록 가중치 상승',
    kind: 'parking',
    weights: { gyeonggi: 3, changwon: 8, busan: 6 },
  },
  // 주거 품질
  {
    id: 'aspect',
    category: 'quality',
    label: '향·채광',
    hint: '1~5단계',
    kind: 'scale5',
    weights: { gyeonggi: 2, changwon: 2, busan: 2 },
  },
  {
    id: 'layout',
    category: 'quality',
    label: '평면·구조',
    hint: '1~5단계',
    kind: 'scale5',
    weights: { gyeonggi: 2, changwon: 2, busan: 2 },
  },
  // 미래가치
  {
    id: 'futureSupply',
    category: 'future',
    label: '향후 3년 공급물량',
    hint: '세대 — 적을수록 고득점',
    kind: 'supply',
    weights: { gyeonggi: 5, changwon: 9, busan: 7 },
  },
  {
    id: 'populationTrend',
    category: 'future',
    label: '인구·일자리 추이',
    hint: '1~5단계 — 인구감소 리스크 반영',
    kind: 'scale5',
    weights: { gyeonggi: 4, changwon: 10, busan: 8 },
  },
  {
    id: 'development',
    category: 'future',
    label: '개발 호재',
    hint: '1~5단계 — 확정 사업만 높게',
    kind: 'scale5',
    weights: { gyeonggi: 4, changwon: 4, busan: 4 },
  },
];

export const PENALTIES: { id: string; label: string; points: number }[] = [
  { id: 'hazard', label: '유해시설 인접', points: 5 },
  { id: 'noise', label: '소음 (철도·공항·간선)', points: 5 },
  { id: 'slope', label: '급경사지', points: 4 },
  { id: 'piloti', label: '필로티 1층·저층 사생활', points: 3 },
  { id: 'elevator', label: '세대당 엘리베이터 과부하', points: 3 },
];

/** 시간형 지표: 로지스틱 감쇠. good분≈98점, bad분≈2점. */
export function normalizeMinutes(v: number, good: number, bad: number): number {
  const mid = (good + bad) / 2;
  const k = 8 / Math.max(1, bad - good);
  return clamp(100 / (1 + Math.exp(k * (v - mid))), 0, 100);
}

export function normalize(indicator: Indicator, raw: number): number {
  switch (indicator.kind) {
    case 'minutes': {
      const [good, bad] = indicator.range ?? [5, 30];
      return normalizeMinutes(raw, good, bad);
    }
    case 'scale3':
      return clamp(((raw - 1) / 2) * 100, 0, 100);
    case 'scale5':
      return clamp(((raw - 1) / 4) * 100, 0, 100);
    case 'households':
      // 100세대 0점 → 3000세대 100점, 로그 스케일
      return clamp((Math.log(Math.max(raw, 1) / 100) / Math.log(30)) * 100, 0, 100);
    case 'year': {
      const age = new Date().getFullYear() - raw;
      return clamp(100 * (1 - age / 35), 0, 100);
    }
    case 'parking':
      return clamp(((raw - 0.5) / 1.0) * 100, 0, 100);
    case 'supply':
      // 3년 공급 0세대 100점 → 10,000세대 0점
      return clamp(100 * (1 - raw / 10000), 0, 100);
  }
}

export function defaultWeights(region: RegionId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ind of INDICATORS) out[ind.id] = ind.weights[region];
  return out;
}

export function effectiveWeights(property: Property): Record<string, number> {
  return { ...defaultWeights(property.region), ...(property.weightOverrides ?? {}) };
}

export interface ScoreResult {
  total: number;
  grade: string;
  base: number;
  penalty: number;
  byCategory: { id: CategoryId; label: string; score: number; weight: number }[];
  byIndicator: { id: string; label: string; normalized: number; weight: number; raw: number }[];
}

export function scoreProperty(property: Property): ScoreResult {
  const weights = effectiveWeights(property);
  const byIndicator = INDICATORS.map((ind) => {
    const raw = resolveRaw(property, ind);
    return {
      id: ind.id,
      label: ind.label,
      normalized: normalize(ind, raw),
      weight: weights[ind.id] ?? 0,
      raw,
    };
  });

  const weightSum = byIndicator.reduce((s, i) => s + i.weight, 0);
  const base =
    weightSum > 0
      ? byIndicator.reduce((s, i) => s + i.normalized * i.weight, 0) / weightSum
      : 0;

  const penalty = property.penalties.reduce(
    (s, id) => s + (PENALTIES.find((p) => p.id === id)?.points ?? 0),
    0
  );

  const byCategory = CATEGORIES.map((cat) => {
    const items = byIndicator.filter(
      (i) => INDICATORS.find((ind) => ind.id === i.id)?.category === cat.id
    );
    const w = items.reduce((s, i) => s + i.weight, 0);
    const score = w > 0 ? items.reduce((s, i) => s + i.normalized * i.weight, 0) / w : 0;
    return { id: cat.id, label: cat.label, score, weight: w };
  });

  const total = clamp(base - penalty, 0, 100);
  return { total, grade: gradeOf(total), base, penalty, byCategory, byIndicator };
}

/** 세대수·준공연도는 물건 기본정보에서 직접 읽습니다 (중복 입력 방지). */
function resolveRaw(property: Property, ind: Indicator): number {
  if (ind.id === 'householdCount') return property.householdCount;
  if (ind.id === 'builtYear') return property.builtYear;
  return property.scores[ind.id] ?? defaultRaw(ind);
}

export function defaultRaw(ind: Indicator): number {
  switch (ind.kind) {
    case 'minutes':
      return ind.range ? (ind.range[0] + ind.range[1]) / 2 : 15;
    case 'scale3':
      return 2;
    case 'scale5':
      return 3;
    case 'households':
      return 500;
    case 'year':
      return new Date().getFullYear() - 10;
    case 'parking':
      return 1;
    case 'supply':
      return 3000;
  }
}

export function gradeOf(score: number): string {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}
