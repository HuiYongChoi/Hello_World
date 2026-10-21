/**
 * 자동 점수 — 입지 지표 25개 각각을 **어디서 잴 수 있나**.
 *
 * 입지 점수는 항목별 입력의 가중합입니다. 그 가운데 자료로 잴 수 있는 것만
 * 자동으로 채우고, 나머지는 "자료 없음 — 직접 입력" 으로 남깁니다.
 *
 * ```
 * measured  실측       스냅샷 값이 지표 단위 그대로 (준공연도 · 인구 추이 단계)
 * proxy     대리지표   다른 자로 잰 값을 옮긴 것 (후보판 시설 5분위 · 공급 상대점수 · 통근 최소시간 · 생활권 참고표)
 * none      자료 없음  어떤 경로로도 점수를 내지 않습니다 — raw·score 둘 다 비움
 * ```
 *
 * **점수를 지어내지 않습니다.** `none` 은 `raw`·`score` 가 둘 다 없고, 점수 계산은 그
 * 항목을 사용자값이나 기본값(미입력 중간값)으로만 채웁니다. 기본값이 몇 % 인지는
 * `scoring.ts` 의 `coverage` 가 화면에 상시 냅니다.
 *
 * 자동값은 저장하지 않습니다 — 매번 스냅샷에서 다시 냅니다. 그래서 사용자값을 지우면
 * 자동값으로 돌아오고, 스냅샷을 갱신하면 자동값도 따라옵니다.
 *
 * 후보판 스냅샷(`board-*.json`)은 좁은 타입으로 직접 읽습니다 — rentfinder 를 import
 * 하지 않습니다 (후보판 화면 코드와 엮이지 않게).
 */

import board from '../data/board-2026-09.json';
import { LOCATION_RULES, brandOf } from './location';
import { findComplex } from './market';
import { POPULATION, POPULATION_CAVEATS, populationFeedback } from './population';
import { RULES } from './rules';
import { INDICATORS } from './scoring';
import { SUPPLY_CAVEATS, supplyFeedback } from './supply';
import type { Property } from './types';

export type AutoStatus = 'measured' | 'proxy' | 'none';

export interface AutoIndicator {
  /** `INDICATORS` 의 id — 25개 전부 들어 있습니다 */
  id: string;
  status: AutoStatus;
  /** 지표의 원래 단위로 낼 수 있을 때 (연도·단계·분) */
  raw?: number;
  /** 0~100 으로만 낼 수 있을 때 (대리지표). raw 와 둘 중 하나 */
  score?: number;
  /** 근거 한 문장 */
  basis: string;
  scope: '단지' | '시군구' | '권역' | '—';
  n?: number;
  thin?: boolean;
  /** 그 축이 못 말하는 것 */
  caveat?: string;
}

/* ── 후보판 스냅샷 — 쓰는 칸만 ─────────────────────────────────────── */

type AxisKey = 'walk' | 'pet' | 'shop' | 'med' | 'bus' | 'life';

interface BoardRowLite {
  cx: string;
  area: number;
  counts: Record<AxisKey, number>;
  auto: Record<AxisKey, number | null>;
  min: number;
  km: number;
  approx?: boolean;
}

interface BoardAxisLite {
  key: AxisKey;
  label: string;
  r: number;
  unit: string;
  sparse: boolean;
}

interface BoardLite {
  version: string;
  destination: { name: string; address: string };
  axes: BoardAxisLite[];
  jeonse: BoardRowLite[];
  wolse: BoardRowLite[];
}

const BOARD = board as unknown as BoardLite;
const BOARD_ROWS = [...BOARD.jeonse, ...BOARD.wolse];
const BOARD_COMPLEXES = new Set(BOARD_ROWS.map((r) => r.cx)).size;
const AXIS = new Map(BOARD.axes.map((a) => [a.key, a]));

/** 단지의 후보판 줄 — 시설 수는 위치 값이라 평형이 달라도 같습니다. 같은 평형이 있으면 그것을 */
function boardRowFor(complexId: string, area: number): BoardRowLite | null {
  const rows = BOARD_ROWS.filter((r) => r.cx === complexId);
  if (rows.length === 0) return null;
  return rows.find((r) => r.area === area) ?? rows[0];
}

/** 5분위 단계(1~5) → 0~100 */
export const quintileScore = (step: number) => Math.round(((step - 1) / 4) * 100);

/* ── 자료 없음 — 항목마다 왜 없는지 ─────────────────────────────────── */

const NONE_BASIS: Record<string, string> = {
  subwayWalk: '역 좌표 자료가 없습니다',
  gtx: '광역급행 역 좌표·개통 일정 자료가 없습니다',
  brt: '후보판(마산 생활권) 밖 단지라 정류장 수를 잰 적이 없습니다',
  arterialRoad: 'IC·자동차전용도로 진입점 좌표가 없습니다',
  commuteSelf: '후보판 밖 단지라 도로 시간을 잰 적이 없습니다',
  commuteSpouse: '배우자 직장 위치를 모릅니다',
  commuteSeoul: '서울 도심까지의 경로 자료가 없습니다',
  jobCenter: '고용중심지 좌표·경로 자료가 없습니다',
  elemInComplex: '학교 위치·통학로 자료가 없습니다',
  midHighSchool: '배정 학군 자료가 없습니다',
  academyAccess: '학원가 자료가 없습니다',
  mart: '후보판(마산 생활권) 밖 단지라 주변 시설을 센 적이 없습니다',
  hospital: '종합병원 위치 자료가 없습니다',
  park: '후보판(마산 생활권) 밖 단지라 주변 공원을 센 적이 없습니다',
  householdCount: '국토부 실거래 자료에 세대수가 없습니다',
  builtYear: '실거래 단지와 이어지지 않아 기본정보 입력값을 씁니다',
  brand: '실거래 단지와 이으면 단지 이름에서 브랜드를 찾습니다',
  parking: '주차 대수 자료가 없습니다 (건축물대장 API 미신청)',
  aspect: '향·채광은 호수마다 달라 공개 자료가 없습니다',
  layout: '평면 자료가 없습니다',
  futureSupply: '이 시군구의 분양권 스냅샷이 없습니다',
  populationTrend: '이 권역의 인구 통계가 없습니다',
  development: '확정 개발사업 목록 자료가 없습니다',
  redevelopmentStage: '정비사업 단계 자료가 없습니다',
  floorAreaRatio: '용적률 자료가 없습니다 (건축물대장 API 미신청)',
  districtTier: '생활권 참고표는 창원만 있습니다',
};

const none = (id: string, basis?: string): AutoIndicator => ({
  id,
  status: 'none',
  basis: basis ?? NONE_BASIS[id] ?? '자료가 없습니다',
  scope: '—',
});

/* ── 항목별 산정 ────────────────────────────────────────────────────── */

/** 후보판 시설 5분위 → 대리 점수. 단계가 없거나 그 축이 성긴(sparse) 자료면 none */
function boardAxis(id: string, row: BoardRowLite | null, key: AxisKey): AutoIndicator {
  const axis = AXIS.get(key);
  if (!row || !axis) return none(id);
  const step = row.auto[key];
  if (axis.sparse || step == null) {
    return none(id, `후보판 ${axis.label} 자료는 누락이 많아(0곳이 40% 넘음) 점수로 쓰지 않습니다`);
  }
  return {
    id,
    status: 'proxy',
    score: quintileScore(step),
    basis: `후보판 OSM 반경 ${axis.r}m ${axis.unit} ${row.counts[key]}곳 → 후보 ${BOARD_COMPLEXES}단지 중 ${step}/5분위`,
    scope: '단지',
    n: BOARD_COMPLEXES,
    caveat: '마산 생활권 후보끼리의 상대 점수입니다 — 분(分)이 아니고, 한국 OSM 은 빠진 시설이 있습니다.',
  };
}

function commuteSelf(row: BoardRowLite | null): AutoIndicator {
  if (!row || !(row.min > 0)) return none('commuteSelf');
  const d = BOARD.destination;
  return {
    id: 'commuteSelf',
    status: 'proxy',
    raw: Math.round(row.min),
    basis: `${d.name}(${d.address})까지 도로 최소 ${Math.round(row.min)}분 · ${row.km.toFixed(1)}km (FOSSGIS OSRM)`,
    scope: '단지',
    thin: row.approx === true,
    caveat: `신호·정체를 뺀 최소치이고, 직장이 ${d.name}일 때만 뜻이 있습니다.${
      row.approx ? ' 좌표가 근사라 수백 m 어긋날 수 있습니다.' : ''
    }`,
  };
}

function futureSupply(property: Property): AutoIndicator {
  const fb = supplyFeedback(property.sigungu);
  if (!fb) return none('futureSupply');
  return {
    id: 'futureSupply',
    status: 'proxy',
    score: fb.suggestedScore,
    basis: `${fb.outlook.districtLabel} 미준공 단지 ${fb.outlook.pending}개 · 재고 대비 ${(
      fb.outlook.pendingRatio * 100
    ).toFixed(0)}% → 같은 지역군 ${fb.peers}개 시군구 중 ${fb.rankBySupply}번째로 많음`,
    scope: '시군구',
    n: fb.outlook.marketComplexes,
    thin: fb.thin,
    caveat: SUPPLY_CAVEATS[0] + ' ' + SUPPLY_CAVEATS[1],
  };
}

function populationTrend(property: Property): AutoIndicator {
  const pf = populationFeedback(property.region);
  if (!pf) return none('populationTrend');
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  return {
    id: 'populationTrend',
    status: 'measured',
    raw: pf.suggested,
    basis: `${pf.stat.label} 최근 10년 인구 ${pct(pf.stat.cagr10)}/년 · 전국 대비 ${pct(pf.stat.excess10)}p → ${pf.suggested}단계 (${POPULATION.granularity} · 행안부 통계연보)`,
    scope: '권역',
    caveat: POPULATION_CAVEATS[0],
  };
}

function builtYear(property: Property): AutoIndicator {
  const c = property.link ? findComplex(property.link.complexId) : null;
  if (!c || !(c.buildYear > 0)) return none('builtYear');
  return {
    id: 'builtYear',
    status: 'measured',
    raw: c.buildYear,
    basis: `실거래 스냅샷 준공연도 ${c.buildYear}년`,
    scope: '단지',
  };
}

/**
 * 창원 생활권 티어 — 룰셋 `appraisal.districtTierReference` 의 **합의된 주관 참고표**.
 *
 * 참고표 행 이름과 법정동·시군구를 잇는 규칙만 코드에 둡니다(값은 룰셋):
 * 용호동 → "용호동" · 가음정동 → "가음정사거리 일대" · 상남동·중앙동 → "상남·중앙동"
 * · 그 외 성산·의창 → "그 외 성산·의창" · 마산합포·마산회원·진해 → "마산·진해 생활권".
 * 부산 남구에도 용호동이 있어 법정동만으로 잇지 않고 시군구를 먼저 봅니다.
 */
const TIER_ROW_BY_UMD: Record<string, string> = {
  용호동: '용호동',
  가음정동: '가음정사거리 일대',
  상남동: '상남·중앙동',
  중앙동: '상남·중앙동',
};
const CORE_DISTRICTS = new Set(['48121', '48123']); // 의창 · 성산
const SPLIT_DISTRICTS = new Set(['48125', '48127', '48129']); // 마산합포 · 마산회원 · 진해

function districtCodeOf(property: Property): string | null {
  const c = property.link ? findComplex(property.link.complexId) : null;
  if (c) return c.regionCode;
  const s = property.sigungu.replace(/\s+/g, '');
  if (/마산합포/.test(s)) return '48125';
  if (/마산회원/.test(s)) return '48127';
  if (/진해/.test(s)) return '48129';
  return null;
}

function districtTier(property: Property): AutoIndicator {
  if (property.region !== 'changwon') return none('districtTier');
  const table = RULES.appraisal.districtTierReference.changwon;
  const code = districtCodeOf(property);
  const c = property.link ? findComplex(property.link.complexId) : null;

  let rowName: string | null = null;
  if (code && SPLIT_DISTRICTS.has(code)) rowName = '마산·진해 생활권';
  else if (code && CORE_DISTRICTS.has(code) && c) rowName = TIER_ROW_BY_UMD[c.umd] ?? '그 외 성산·의창';

  const row = rowName ? table.find((t) => t.name === rowName) : undefined;
  if (!row) {
    return none('districtTier', '성산·의창은 법정동을 알아야 참고표 행을 고를 수 있습니다 — 실거래 단지와 이어 주세요');
  }
  return {
    id: 'districtTier',
    status: 'proxy',
    raw: row.tier,
    basis: `생활권 참고표 "${row.name}" ${row.tier}단계${c ? ` (${c.umd})` : ''} — ${row.note}`,
    scope: c && rowName !== '마산·진해 생활권' ? '단지' : '시군구',
    caveat: '실측이 아니라 합의된 주관 참고표입니다. 물건별로 직접 고치세요.',
  };
}

/**
 * 브랜드 — 단지 이름에 시공능력평가 상위 10위권 10개사 브랜드가 있으면 룰셋 단계(`rules/location-*.json`).
 * 이름에서 못 찾으면 none — 브랜드가 없다는 뜻이 아니라 이름으로 못 가린 것입니다.
 */
function brand(property: Property): AutoIndicator {
  const c = property.link ? findComplex(property.link.complexId) : null;
  if (!c) return none('brand');
  const b = brandOf(c.name);
  const rule = LOCATION_RULES.indicators.brand;
  if (!b) return none('brand', `단지 이름 "${c.name}" 에서 10대 건설사 브랜드를 찾지 못했습니다 — 브랜드가 없다는 뜻은 아닙니다`);
  return {
    id: 'brand',
    status: 'proxy',
    raw: rule.raw,
    basis: `이름에 ${b.name}(${b.builder}) → ${rule.raw}단계`,
    scope: '단지',
    caveat: '시공능력평가 상위 10위권 브랜드인지만 봅니다. 하이엔드·중견 브랜드는 가르지 않습니다 — 고쳐 넣으세요.',
  };
}

/**
 * 물건 하나의 자동 지표 25개. `INDICATORS` 순서 그대로, 빠지는 항목이 없습니다.
 *
 * 후보판 줄은 `link` 가 있어야 찾습니다. 시군구·권역 단위 항목(공급·인구·생활권 일부)은
 * 고리가 없어도 기본정보의 시군구·지역군으로 냅니다.
 */
export function autoIndicators(property: Property): AutoIndicator[] {
  const row = property.link ? boardRowFor(property.link.complexId, property.link.area) : null;

  const by: Record<string, () => AutoIndicator> = {
    brt: () => boardAxis('brt', row, 'bus'),
    mart: () => boardAxis('mart', row, 'shop'),
    park: () => boardAxis('park', row, 'walk'),
    hospital: () =>
      row
        ? none('hospital', '후보판 병원·의원 자료는 의원이 많이 빠져(0곳이 40% 넘음) 점수로 쓰지 않습니다')
        : none('hospital'),
    commuteSelf: () => commuteSelf(row),
    futureSupply: () => futureSupply(property),
    populationTrend: () => populationTrend(property),
    builtYear: () => builtYear(property),
    brand: () => brand(property),
    districtTier: () => districtTier(property),
  };

  return INDICATORS.map((ind) => (by[ind.id] ? by[ind.id]() : none(ind.id)));
}

/** 머리글 한 줄용 — 자동으로 채운 것 / 직접 넣을 것 */
export function autoSummary(items: AutoIndicator[]): { auto: number; none: number; measured: number; proxy: number } {
  const measured = items.filter((i) => i.status === 'measured').length;
  const proxy = items.filter((i) => i.status === 'proxy').length;
  return { auto: measured + proxy, none: items.length - measured - proxy, measured, proxy };
}

/** 후보판 스냅샷 버전 — 출처 표기용 */
export const AUTO_BOARD_VERSION = BOARD.version;
