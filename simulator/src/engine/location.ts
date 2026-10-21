/**
 * 입지 지표 스냅샷 로더 — `data/location-2026-10.json` (scripts/location/collect.mjs 가 구움)
 * 과 변환 기준 `rules/location-2026-10.json`.
 *
 * ```
 * 단지 단위   exact=1  OSM 아파트 이름으로 짝지은 좌표 → 도보 분 · 반경 시설 수 · 차 분
 *            exact=0  법정동 중심으로 물러선 좌표   → 차 분만 (도보·반경은 비움)
 * 법정동 단위          고용중심지 · 직장 후보 · 서울 도심 · GTX 역까지 차 분
 * ```
 *
 * 5분위(중·고 수 · 학원 수 · 공원 수)는 **같은 권역의 좌표 맞은 단지끼리** 매깁니다.
 * 0곳 비중이 룰셋 `sparseZeroShare` 를 넘는 축은 OSM 에 안 올라온 것으로 보고 단계를 내지 않습니다.
 */

import snapshot from '../data/location-2026-10.json';
import rules from '../rules/location-2026-10.json';
import type { RegionId } from './types';

type Cell = string | number | null;

interface LocationSnapshot {
  version: string;
  asOf: string;
  fields: string[];
  names: string[];
  complexes: Cell[][];
  umdFields: string[];
  placeIds: string[];
  umd: Cell[][];
  stats: {
    complexes: number;
    located: number;
    exact: number;
    byRegion: Record<RegionId, { complexes: number; exact: number }>;
  };
}

export interface Place {
  id: string;
  name: string;
  kind: 'workplace' | 'job' | 'seoul' | 'gtx';
  regions: RegionId[];
  lat: number;
  lon: number;
  basis: string;
}

export interface ComplexLocation {
  id: string;
  /** OSM 아파트 이름으로 짝지은 좌표인가 (false = 법정동 중심 근사) */
  exact: boolean;
  lat: number;
  lon: number;
  busMin: number | null;
  busM: number | null;
  bus400: number | null;
  railMin: number | null;
  railM: number | null;
  rail: string | null;
  elemMin: number | null;
  elemM: number | null;
  elem: string | null;
  midHigh1k: number | null;
  academy1k: number | null;
  park800: number | null;
  icMin: number | null;
  ic: string | null;
  martMin: number | null;
  mart: string | null;
  hospMin: number | null;
  hosp: string | null;
}

export interface UmdLocation {
  key: string;
  /** 중심을 짝지은 단지들 평균으로 냈나 (false = Nominatim 법정동 중심) */
  exact: boolean;
  /** 중심을 낸 단지 수 */
  n: number;
  /** 장소 id → 차 최소 분 */
  minutes: Record<string, number | null>;
}

const SNAP = snapshot as unknown as LocationSnapshot;
export const LOCATION_RULES = rules;
export const LOCATION_VERSION = SNAP.version;
export const LOCATION_AS_OF = SNAP.asOf;
export const LOCATION_STATS = SNAP.stats;
export const PLACES = rules.places as Place[];

const NAME_FIELDS = new Set(['rail', 'elem', 'ic', 'mart', 'hosp']);

function decode(row: Cell[]): ComplexLocation {
  const o: Record<string, unknown> = {};
  SNAP.fields.forEach((f, i) => {
    const v = row[i];
    if (f === 'exact') o[f] = v === 1;
    else if (NAME_FIELDS.has(f)) o[f] = typeof v === 'number' ? SNAP.names[v] : null;
    else o[f] = v;
  });
  return o as unknown as ComplexLocation;
}

const BY_ID = new Map(SNAP.complexes.map((r) => [String(r[0]), r]));
const UMD = new Map(SNAP.umd.map((r) => [String(r[0]), r]));

export function complexLocation(id: string): ComplexLocation | null {
  const r = BY_ID.get(id);
  return r ? decode(r) : null;
}

export function umdLocation(regionCode: string, umd: string): UmdLocation | null {
  const r = UMD.get(`${regionCode} ${umd}`);
  if (!r) return null;
  const minutes: Record<string, number | null> = {};
  SNAP.placeIds.forEach((id, i) => {
    const v = r[5 + i];
    minutes[id] = typeof v === 'number' ? v : null;
  });
  return { key: String(r[0]), exact: r[1] === 1, n: Number(r[2]), minutes };
}

export const placeById = (id: string) => PLACES.find((p) => p.id === id) ?? null;

export function placesFor(region: RegionId, kinds: Place['kind'][]): Place[] {
  return PLACES.filter((p) => p.regions.includes(region) && kinds.includes(p.kind));
}

/** 본인 직장으로 고를 수 있는 곳 — 지사 · 그 권역 고용중심지 */
export const workplaceOptions = (region: RegionId) => placesFor(region, ['workplace', 'job']);

export function defaultWorkplace(region: RegionId): string | null {
  return (rules.workplace.default as Record<RegionId, string | null>)[region] ?? null;
}

/** 여러 장소 중 가장 가까운 곳 */
export function nearestPlace(u: UmdLocation, places: Place[]): { place: Place; min: number } | null {
  let best: { place: Place; min: number } | null = null;
  for (const p of places) {
    const m = u.minutes[p.id];
    if (m == null) continue;
    if (!best || m < best.min) best = { place: p, min: m };
  }
  return best;
}

/* ── 5분위 ──────────────────────────────────────────────────────────── */

export type CountField = 'midHigh1k' | 'academy1k' | 'park800';

export interface QuintileAxis {
  /** 같은 권역 좌표 맞은 단지 수 */
  n: number;
  zeroShare: number;
  sparse: boolean;
  sorted: number[];
}

const REGION_OF = new Map<string, RegionId>();
function regionOfId(id: string): RegionId | null {
  if (REGION_OF.size === 0) {
    for (const r of SNAP.complexes) {
      const code = String(r[0]).split('-')[0];
      REGION_OF.set(String(r[0]), code.startsWith('48') ? 'changwon' : code.startsWith('26') ? 'busan' : 'gyeonggi');
    }
  }
  return REGION_OF.get(id) ?? null;
}

const AXES = new Map<string, QuintileAxis>();

export function quintileAxis(region: RegionId, field: CountField): QuintileAxis {
  const key = `${region}:${field}`;
  const hit = AXES.get(key);
  if (hit) return hit;
  const vals: number[] = [];
  for (const r of SNAP.complexes) {
    if (regionOfId(String(r[0])) !== region) continue;
    const c = decode(r);
    if (!c.exact) continue;
    const v = c[field];
    if (typeof v === 'number') vals.push(v);
  }
  vals.sort((a, b) => a - b);
  const zeros = vals.filter((v) => v === 0).length;
  const zeroShare = vals.length ? zeros / vals.length : 1;
  const axis = { n: vals.length, zeroShare, sparse: zeroShare > rules.sparseZeroShare.value, sorted: vals };
  AXES.set(key, axis);
  return axis;
}

/** 같은 값은 가운데 순위로 — 1~5 단계 */
export function quintileStep(axis: QuintileAxis, v: number): number {
  const s = axis.sorted;
  let less = 0;
  let eq = 0;
  for (const x of s) {
    if (x < v) less++;
    else if (x === v) eq++;
  }
  const rank = s.length ? (less + eq / 2) / s.length : 0.5;
  return Math.min(5, Math.max(1, 1 + Math.floor(rank * 5)));
}

/** 초품아 단계 — 보행 분을 룰셋 구간에 */
export function elemStep(minutes: number | null): { raw: number; label: string } {
  const steps = rules.indicators.elemInComplex.steps;
  for (const s of steps) {
    if (s.maxMinutes == null || (minutes != null && minutes <= s.maxMinutes)) return { raw: s.raw, label: s.label };
  }
  const last = steps[steps.length - 1];
  return { raw: last.raw, label: last.label };
}

/* ── 브랜드 ─────────────────────────────────────────────────────────── */

export function brandOf(name: string): { name: string; builder: string } | null {
  const b = rules.indicators.brand;
  // "롯데캐슬자이언트" — 자이언트를 지운 뒤 찾습니다 (롯데캐슬은 남고 자이는 사라짐)
  let s = name.toLowerCase().replace(/\s+/g, '');
  for (const p of b.excludePatterns) s = s.split(p).join('');
  const hit = b.brands.find((x) => x.patterns.some((p) => s.includes(p.toLowerCase())));
  return hit ? { name: hit.name, builder: hit.builder } : null;
}
