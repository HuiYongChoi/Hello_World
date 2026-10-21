/**
 * 자동 점수 — 입지 지표 25개 각각을 **어디서 잴 수 있나**.
 *
 * 입지 점수는 항목별 입력의 가중합입니다. 그 가운데 자료로 잴 수 있는 것만
 * 자동으로 채우고, 나머지는 "자료 없음 — 직접 입력" 으로 남깁니다.
 *
 * ```
 * measured  실측       스냅샷 값이 지표 단위 그대로 (준공연도 · 인구 추이 단계)
 * proxy     대리지표   다른 자로 잰 값을 옮긴 것 (OSM·OSRM 도보·차 분 · 반경 시설 5분위 · 이름의 브랜드
 *                     · 공급 상대점수 · 생활권 참고표)
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
 * 위치 항목은 `location-2026-10.json`(scripts/location/collect.mjs 가 3권역 전 단지에 구움)에서,
 * 거리 → 점수 기준은 `rules/location-2026-10.json` 에서 읽습니다. 단지 이름을 OSM 에서 못 찾아
 * 법정동 중심으로 물러선 단지는 도보·반경 항목을 비우고 차 시간만 근사로 씁니다.
 */

import { findComplex } from './market';
import {
  LOCATION_RULES,
  brandOf,
  complexLocation,
  defaultWorkplace,
  elemStep,
  nearestPlace,
  placeById,
  placesFor,
  quintileAxis,
  quintileStep,
  umdLocation,
  type ComplexLocation,
  type CountField,
  type UmdLocation,
} from './location';
import { POPULATION, POPULATION_CAVEATS, populationFeedback } from './population';
import { RULES } from './rules';
import { INDICATORS } from './scoring';
import { SUPPLY_CAVEATS, supplyFeedback } from './supply';
import type { Property, RegionId } from './types';

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
  scope: '단지' | '법정동' | '시군구' | '권역' | '—';
  n?: number;
  thin?: boolean;
  /** 그 축이 못 말하는 것 */
  caveat?: string;
}

/* ── 자료 없음 — 항목마다 왜 없는지 ─────────────────────────────────── */

const NO_LINK = '실거래 단지와 이으면 위치 스냅샷에서 채워집니다';

const NONE_BASIS: Record<string, string> = {
  subwayWalk: NO_LINK,
  gtx: NO_LINK,
  brt: NO_LINK,
  arterialRoad: NO_LINK,
  commuteSelf: NO_LINK,
  commuteSpouse: '배우자 직장 위치를 모릅니다',
  commuteSeoul: NO_LINK,
  jobCenter: NO_LINK,
  elemInComplex: NO_LINK,
  midHighSchool: NO_LINK,
  academyAccess: NO_LINK,
  mart: NO_LINK,
  hospital: NO_LINK,
  park: NO_LINK,
  householdCount: '국토부 실거래 자료에 세대수가 없습니다',
  builtYear: '실거래 단지와 이어지지 않아 기본정보 입력값을 씁니다',
  brand: NO_LINK,
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

/* ── 위치 스냅샷 항목 ───────────────────────────────────────────────── */

const IND = LOCATION_RULES.indicators;
const APPROX_WALK = '단지 이름을 OSM 에서 못 찾아 법정동 중심으로 물러선 좌표라 걸어서 닿는 거리는 재지 않았습니다';
const APPROX_CAVEAT = ' 좌표가 법정동 중심 근사라 몇 분 어긋날 수 있습니다.';
const DRIVE_CAVEAT = '신호·정체를 뺀 차 최소 시간입니다 (FOSSGIS OSRM).';
const WALK_CAVEAT = 'OSRM 보행 경로(5km/h) — 횡단보도 대기·경사는 빠집니다. 한국 OSM 에 없는 시설은 못 셉니다.';

const fmtMin = (m: number) => (m < 10 ? m.toFixed(1) : String(Math.round(m)));
const fmtM = (m: number | null) => (m == null ? '' : m >= 1000 ? ` · ${(m / 1000).toFixed(1)}km` : ` · ${m}m`);

interface Ctx {
  property: Property;
  region: RegionId;
  loc: ComplexLocation | null;
  umd: UmdLocation | null;
  name: string | null;
}

/** 도보 분 — 좌표가 맞은 단지만 */
function walkMinutes(
  id: string,
  ctx: Ctx,
  pick: (l: ComplexLocation) => { min: number | null; m: number | null; name: string | null; extra?: string },
  target: string,
  beyond?: { minutes: number; basis: string }
): AutoIndicator {
  const l = ctx.loc;
  if (!l) return none(id);
  if (!l.exact) return none(id, APPROX_WALK);
  const v = pick(l);
  if (v.min == null) {
    if (!beyond) return none(id, `${target} — 걸어서 닿는 곳을 찾지 못했습니다`);
    return { id, status: 'proxy', raw: beyond.minutes, basis: beyond.basis, scope: '단지', caveat: WALK_CAVEAT };
  }
  return {
    id,
    status: 'proxy',
    raw: Math.round(v.min),
    basis: `${v.name ? `${v.name} ` : `${target} `}도보 ${fmtMin(v.min)}분${fmtM(v.m)}${v.extra ?? ''} (OSRM 보행)`,
    scope: '단지',
    caveat: WALK_CAVEAT,
  };
}

/** 차 분 — 근사 좌표도 씁니다(표시만 얇게) */
function driveMinutes(
  id: string,
  ctx: Ctx,
  pick: (l: ComplexLocation) => { min: number | null; name: string | null },
  target: string,
  caveat?: string
): AutoIndicator {
  const l = ctx.loc;
  if (!l) return none(id);
  const v = pick(l);
  if (v.min == null) return none(id, `${target} — 30km 안에서 찾지 못했습니다`);
  return {
    id,
    status: 'proxy',
    raw: Math.max(1, Math.round(v.min)),
    basis: `${v.name ?? target}까지 차 ${fmtMin(v.min)}분 (OSRM)`,
    scope: '단지',
    thin: !l.exact,
    caveat: (caveat ? caveat + ' ' : '') + DRIVE_CAVEAT + (l.exact ? '' : APPROX_CAVEAT),
  };
}

/** 법정동 단위로 잰 먼 곳 — 여러 장소 중 가장 가까운 곳 */
function umdNearest(id: string, ctx: Ctx, kinds: ('job' | 'seoul' | 'gtx')[], what: string, caveat?: string): AutoIndicator {
  const places = placesFor(ctx.region, kinds);
  if (places.length === 0) return none(id, `${what} — 이 권역에는 해당 장소가 없습니다 (가중치 0)`);
  if (!ctx.umd) return none(id);
  const best = nearestPlace(ctx.umd, places);
  if (!best) return none(id, `${what}까지 경로를 찾지 못했습니다`);
  return {
    id,
    status: 'proxy',
    raw: Math.max(1, Math.round(best.min)),
    basis: `${best.place.name}까지 차 ${fmtMin(best.min)}분 — ${what} ${places.length}곳 중 가장 가까움 (법정동 단위 · OSRM)`,
    scope: '법정동',
    thin: !ctx.umd.exact,
    caveat: (caveat ? caveat + ' ' : '') + DRIVE_CAVEAT,
  };
}

function commuteSelf(ctx: Ctx): AutoIndicator {
  const wid = ctx.property.workplaceId ?? defaultWorkplace(ctx.region);
  if (!wid) return none('commuteSelf', '본인 직장을 고르면 채워집니다 — 이 권역은 정해 둔 직장이 없습니다');
  const place = placeById(wid);
  if (!place || !place.regions.includes(ctx.region)) {
    return none('commuteSelf', `고른 직장(${place?.name ?? wid})은 이 권역 후보가 아닙니다 — 다시 고르세요`);
  }
  if (!ctx.umd) return none('commuteSelf');
  const min = ctx.umd.minutes[wid];
  if (min == null) return none('commuteSelf', `${place.name}까지 경로를 찾지 못했습니다`);
  return {
    id: 'commuteSelf',
    status: 'proxy',
    raw: Math.max(1, Math.round(min)),
    basis: `${place.name}까지 차 ${fmtMin(min)}분 (법정동 단위 · OSRM)${ctx.property.workplaceId ? '' : ' — 기본 직장'}`,
    scope: '법정동',
    thin: !ctx.umd.exact,
    caveat: `${DRIVE_CAVEAT} 직장이 ${place.name}일 때만 뜻이 있습니다 — 점수표에서 바꿀 수 있습니다.`,
  };
}

function elemInComplex(ctx: Ctx): AutoIndicator {
  const l = ctx.loc;
  if (!l) return none('elemInComplex');
  if (!l.exact) return none('elemInComplex', APPROX_WALK);
  const step = elemStep(l.elemMin);
  const where =
    l.elemMin == null
      ? `직선 ${(IND.elemInComplex.maxStraightM / 1000).toFixed(0)}km 안 초등학교 없음`
      : `${l.elem ?? '초등학교'} 도보 ${fmtMin(l.elemMin)}분${fmtM(l.elemM)}`;
  return {
    id: 'elemInComplex',
    status: 'proxy',
    raw: step.raw,
    basis: `${where} → ${step.raw}단계 (${step.label})`,
    scope: '단지',
    caveat: '횡단보도·대로를 건너는지는 자료가 없습니다. ' + WALK_CAVEAT,
  };
}

/** 반경 안 시설 수 → 같은 권역 단지끼리 5분위 단계 */
function countStep(id: string, ctx: Ctx, field: CountField, what: string, radiusM: number, caveat: string): AutoIndicator {
  const l = ctx.loc;
  if (!l) return none(id);
  if (!l.exact) return none(id, APPROX_WALK);
  const v = l[field];
  if (v == null) return none(id);
  const axis = quintileAxis(ctx.region, field);
  if (axis.sparse) {
    return none(
      id,
      `OSM ${what} 자료는 이 권역 단지의 ${Math.round(axis.zeroShare * 100)}% 가 0곳이라(누락으로 봄) 점수로 쓰지 않습니다 — 이 단지 ${v}곳`
    );
  }
  const step = quintileStep(axis, v);
  return {
    id,
    status: 'proxy',
    raw: step,
    basis: `반경 ${radiusM >= 1000 ? `${radiusM / 1000}km` : `${radiusM}m`} ${what} ${v}곳 → 같은 권역 ${axis.n.toLocaleString('ko-KR')}단지 중 ${step}/5분위`,
    scope: '단지',
    n: axis.n,
    caveat: caveat + ' 권역 안 상대 단계입니다. 한국 OSM 에 없는 시설은 못 셉니다.',
  };
}

function brand(ctx: Ctx): AutoIndicator {
  if (!ctx.name) return none('brand');
  const b = brandOf(ctx.name);
  if (!b) return none('brand', `단지 이름 "${ctx.name}" 에서 10대 건설사 브랜드를 찾지 못했습니다 — 브랜드가 없다는 뜻은 아닙니다`);
  return {
    id: 'brand',
    status: 'proxy',
    raw: IND.brand.raw,
    basis: `이름에 ${b.name}(${b.builder}) → ${IND.brand.raw}단계`,
    scope: '단지',
    caveat: '시공능력평가 상위 10위권 브랜드인지만 봅니다. 하이엔드·중견 브랜드는 가르지 않습니다 — 고쳐 넣으세요.',
  };
}

/* ── 시군구·권역·단지 기본 ──────────────────────────────────────────── */

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
 * 물건 하나의 자동 지표 25개. `INDICATORS` 순서 그대로, 빠지는 항목이 없습니다.
 *
 * 위치 항목은 `link` 가 있어야 찾습니다. 시군구·권역 단위 항목(공급·인구·생활권 일부)은
 * 고리가 없어도 기본정보의 시군구·지역군으로 냅니다.
 */
export function autoIndicators(property: Property): AutoIndicator[] {
  const c = property.link ? findComplex(property.link.complexId) : null;
  const ctx: Ctx = {
    property,
    region: property.region,
    loc: c ? complexLocation(c.id) : null,
    umd: c ? umdLocation(c.regionCode, c.umd) : null,
    name: c?.name ?? null,
  };

  const by: Record<string, () => AutoIndicator> = {
    subwayWalk: () =>
      walkMinutes('subwayWalk', ctx, (l) => ({ min: l.railMin, m: l.railM, name: l.rail ? `${l.rail}역` : null }), '가장 가까운 역', {
        minutes: IND.subwayWalk.beyondMinutes,
        basis: IND.subwayWalk.beyondBasis,
      }),
    gtx: () => umdNearest('gtx', ctx, ['gtx'], '개통한 GTX 역', '역까지 가는 접근 시간입니다 — 열차 시간은 빠집니다.'),
    brt: () =>
      walkMinutes(
        'brt',
        ctx,
        (l) => ({ min: l.busMin, m: l.busM, name: null, extra: l.bus400 != null ? ` · 반경 ${IND.brt.countRadiusM}m 정류장 ${l.bus400}곳` : '' }),
        '가장 가까운 버스 정류장'
      ),
    arterialRoad: () => driveMinutes('arterialRoad', ctx, (l) => ({ min: l.icMin, name: l.ic ? `${l.ic}` : null }), '고속도로 IC'),
    commuteSelf: () => commuteSelf(ctx),
    commuteSeoul: () =>
      umdNearest('commuteSeoul', ctx, ['seoul'], '서울 도심', '출퇴근 시간대 실제 시간은 이보다 깁니다 — 정체를 넣을 자료가 없어 곱하지 않습니다.'),
    jobCenter: () => umdNearest('jobCenter', ctx, ['job'], '권역 고용중심지'),
    elemInComplex: () => elemInComplex(ctx),
    midHighSchool: () =>
      countStep('midHighSchool', ctx, 'midHigh1k', '중·고등학교', IND.midHighSchool.radiusM, '배정 학교군·학업성취도가 아니라 걸어서 닿는 중·고 수입니다.'),
    academyAccess: () => countStep('academyAccess', ctx, 'academy1k', '학원', IND.academyAccess.radiusM, '학원 이름이 OSM 에 올라온 것만 셉니다.'),
    mart: () => driveMinutes('mart', ctx, (l) => ({ min: l.martMin, name: l.mart }), '대형마트·백화점'),
    hospital: () =>
      driveMinutes('hospital', ctx, (l) => ({ min: l.hospMin, name: l.hosp }), '병원급', '종합병원 지정 여부가 아니라 이름으로 거른 병원급입니다.'),
    park: () => countStep('park', ctx, 'park800', '이름 있는 공원', IND.park.radiusM, '공원 넓이는 세지 않습니다.'),
    brand: () => brand(ctx),
    futureSupply: () => futureSupply(property),
    populationTrend: () => populationTrend(property),
    builtYear: () => builtYear(property),
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
