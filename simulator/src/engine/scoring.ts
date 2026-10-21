import { autoIndicators, type AutoIndicator } from './autoScore';
import { clamp } from './finance';
import type { Property, RegionId } from './types';

export type IndicatorKind =
  | 'minutes'
  | 'scale3'
  | 'scale5'
  | 'households'
  | 'year'
  | 'parking'
  | 'supply'
  | 'far';

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
    hint: '분 — 창원은 BRT 축 위에 있느냐가 갈림길입니다',
    kind: 'minutes',
    range: [3, 15],
    weights: { gyeonggi: 3, changwon: 16, busan: 5 },
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
  {
    id: 'redevelopmentStage',
    category: 'future',
    label: '재건축·재개발 단계',
    hint: '1=소식 없음 / 2=논의 / 3=추진위 / 4=조합설립 / 5=사업시행인가 이상',
    kind: 'scale5',
    weights: { gyeonggi: 4, changwon: 12, busan: 8 },
  },
  {
    id: 'floorAreaRatio',
    category: 'future',
    label: '용적률',
    hint: '% — 낮을수록 재건축 사업성이 납니다 (150% 만점 · 300% 0점)',
    kind: 'far',
    weights: { gyeonggi: 2, changwon: 8, busan: 5 },
  },
  {
    id: 'districtTier',
    category: 'future',
    label: '생활권 티어',
    hint: '1~5단계 — 합의된 주관 판단입니다. 창원 참고: 용호동 5 / 가음정 4 / 마산·진해 2',
    kind: 'scale5',
    weights: { gyeonggi: 5, changwon: 12, busan: 8 },
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
    case 'far':
      // 용적률 150% 이하 100점 → 300% 이상 0점. 낮아야 재건축 사업성이 납니다.
      return clamp(100 * (1 - (raw - 150) / 150), 0, 100);
  }
}

export function defaultWeights(region: RegionId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ind of INDICATORS) out[ind.id] = ind.weights[region];
  return out;
}

/**
 * 실제로 쓰는 가중치. 세대수만 예외 — 0 이면 가중치를 0 으로 둡니다.
 * 0세대는 "모름" 이지 "100세대 미만" 이 아닙니다. 그대로 두면 `log(0→1/100)` 로 0점을 받아
 * 세대수 자료가 없는 시중 물건이 전부 손해를 봅니다.
 */
export function effectiveWeights(property: Property): Record<string, number> {
  const w = { ...defaultWeights(property.region), ...(property.weightOverrides ?? {}) };
  if (!(property.householdCount > 0)) w.householdCount = 0;
  return w;
}

/**
 * 그 항목 값이 어디서 왔나.
 *
 * - `user`     사용자가 넣은 값 (점수 칸 · 기본정보의 세대수·준공연도)
 * - `measured` 스냅샷 실측 (`autoFill` 일 때만)
 * - `proxy`    대리지표 (`autoFill` 일 때만)
 * - `default`  미입력 중간값 — 근거 없음
 */
export type ScoreSource = 'user' | 'measured' | 'proxy' | 'default';

export interface ScoreCoverage {
  weightTotal: number;
  /** 출처별 가중치 합 */
  bySource: Record<ScoreSource, number>;
  /** (user + measured + proxy) ÷ weightTotal — 근거 있는 가중치 비중 */
  groundedShare: number;
}

export interface ScoreResult {
  total: number;
  grade: string;
  base: number;
  penalty: number;
  byCategory: { id: CategoryId; label: string; score: number; weight: number }[];
  byIndicator: {
    id: string;
    label: string;
    normalized: number;
    weight: number;
    /** 지표 단위 값. 대리 점수(0~100)로만 들어온 항목은 null */
    raw: number | null;
    source: ScoreSource;
  }[];
  coverage: ScoreCoverage;
}

/** 근거 있는 가중치가 이보다 적으면 등급에 물음표를 붙입니다 */
export const GROUNDED_MIN = 0.5;

/**
 * 입지 점수. 두 번째 인자는 자동 지표 — 기본값은 `autoFill` 일 때만 스냅샷에서 내고,
 * 아니면 빈 목록이라 **`autoFill` 없는 물건의 결과는 예전과 같습니다** (출처·근거 비중 필드만 더해짐).
 */
export function scoreProperty(
  property: Property,
  auto: AutoIndicator[] = property.autoFill ? autoIndicators(property) : []
): ScoreResult {
  const weights = effectiveWeights(property);
  const autoById = new Map(auto.map((a) => [a.id, a]));
  const byIndicator = INDICATORS.map((ind) => {
    const r = resolveRaw(property, ind, autoById.get(ind.id));
    return {
      id: ind.id,
      label: ind.label,
      normalized: r.normalized ?? normalize(ind, r.raw!),
      weight: weights[ind.id] ?? 0,
      raw: r.raw,
      source: r.source,
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

  const bySource: Record<ScoreSource, number> = { user: 0, measured: 0, proxy: 0, default: 0 };
  for (const i of byIndicator) bySource[i.source] += i.weight;
  const weightTotal = weightSum;
  const coverage: ScoreCoverage = {
    weightTotal,
    bySource,
    groundedShare: weightTotal > 0 ? (bySource.user + bySource.measured + bySource.proxy) / weightTotal : 0,
  };

  const total = clamp(base - penalty, 0, 100);
  return { total, grade: gradeOf(total), base, penalty, byCategory, byIndicator, coverage };
}

/**
 * 항목 값 고르기.
 *
 * ```
 * scores[id] 가 있으면          → 사용자값        user
 * else autoFill && auto.raw     → 자동 raw        measured | proxy
 * else autoFill && auto.score   → 정규화 생략     proxy
 * else                          → defaultRaw     default   ← 예전과 같음
 * ```
 *
 * 세대수·준공연도는 기본정보에서 직접 읽습니다 (중복 입력 방지). 준공연도는 기본정보 값이
 * 스냅샷과 같을 때만 `measured`, 사용자가 고쳤으면 `user` 입니다.
 */
function resolveRaw(
  property: Property,
  ind: Indicator,
  auto: AutoIndicator | undefined
): { raw: number | null; normalized?: number; source: ScoreSource } {
  if (ind.id === 'householdCount') return { raw: property.householdCount, source: 'user' };
  if (ind.id === 'builtYear') {
    const measured = auto?.status === 'measured' && auto.raw === property.builtYear;
    return { raw: property.builtYear, source: measured ? 'measured' : 'user' };
  }
  const user = property.scores[ind.id];
  if (user !== undefined) return { raw: user, source: 'user' };
  if (auto && auto.status !== 'none') {
    const source: ScoreSource = auto.status === 'measured' ? 'measured' : 'proxy';
    if (auto.raw !== undefined) return { raw: auto.raw, source };
    if (auto.score !== undefined) return { raw: null, normalized: clamp(auto.score, 0, 100), source: 'proxy' };
  }
  return { raw: defaultRaw(ind), source: 'default' };
}

/** 등급 + 근거가 얇으면 물음표 — `C?` */
export function gradeLabel(result: Pick<ScoreResult, 'grade' | 'coverage'>): string {
  return result.coverage.groundedShare < GROUNDED_MIN ? `${result.grade}?` : result.grade;
}

/** `근거 71%` */
export function coverageLabel(result: Pick<ScoreResult, 'coverage'>): string {
  return `근거 ${Math.round(result.coverage.groundedShare * 100)}%`;
}

/** 카테고리별 근거 비중 — `교통 · 가중치 24 · 근거 0/24` */
export function categoryCoverage(result: ScoreResult): { id: CategoryId; weight: number; grounded: number }[] {
  return CATEGORIES.map((cat) => {
    const items = result.byIndicator.filter((i) => INDICATORS.find((x) => x.id === i.id)?.category === cat.id);
    return {
      id: cat.id,
      weight: items.reduce((s, i) => s + i.weight, 0),
      grounded: items.filter((i) => i.source !== 'default').reduce((s, i) => s + i.weight, 0),
    };
  });
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
    case 'far':
      return 220;
  }
}

export function gradeOf(score: number): string {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}
