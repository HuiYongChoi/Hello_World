/**
 * 초점 물건 하나를 축으로 화면을 오가는 고리 — `districtChartLink.ts` 와 같은 패턴입니다.
 *
 * 누르는 쪽(FocusBar · 셀 상세 · 물건 화면)은 `goFocus(target)` 만 부릅니다.
 * App 이 이벤트를 받아 탭·단계를 옮기고, 받는 화면(실거래 · 매트릭스)은 마운트될 때나
 * 이미 떠 있으면 이벤트로 `takePendingFocus()` 를 한 번 꺼내 그 물건으로 맞춥니다.
 *
 * 이벤트에 물건 id 를 같이 싣는 이유: `setFocusProperty(id)` 직후 같은 틱에 `goFocus` 를
 * 부르면 리스너가 보는 스토어 값은 아직 이전 초점입니다. id 를 들고 다니면 순서가 꼬이지 않습니다.
 *
 * 화면 파일과 떼어 둔 이유: 컴포넌트 파일이 함수까지 내보내면 개발 서버의 빠른 새로고침이
 * 그 파일을 통째로 다시 읽습니다.
 */

import { MARKET, type MarketComplex } from '../engine/market';
import type { Property } from '../engine/types';
import { openDistrictChart } from './districtChartLink';

/** 물건 하나에서 건너갈 수 있는 곳 — 탭은 늘리지 않고 기존 탭 안의 자리로만 갑니다 */
export type FocusTarget = 'chart' | 'loan' | 'why' | 'returns' | 'tenure' | 'edit';

export const FOCUS_GO_EVENT = 'focus:go';

/** 받는 화면이 스크롤해 내려갈 자리. 물건 화면(PropertiesPage)의 두 자리는 그 화면이 id 를 답니다 */
export const FOCUS_ANCHORS = {
  why: 'price-context',
  edit: 'property-edit',
  returns: 'complex-returns',
} as const;

export interface FocusJump {
  target: FocusTarget;
  /** 누른 물건. 없으면 스토어의 초점 물건 */
  propertyId: string | null;
}

let pending: FocusJump | null = null;

/** 어느 화면에서든 — 그 물건(없으면 지금 초점)을 들고 target 자리로 옮깁니다 */
export function goFocus(target: FocusTarget, propertyId: string | null = null): void {
  pending = { target, propertyId };
  window.dispatchEvent(new CustomEvent<FocusJump>(FOCUS_GO_EVENT, { detail: { target, propertyId } }));
}

/**
 * 아직 받지 못한 이동 — 한 번 꺼내면 비웁니다.
 * `accept` 를 주면 그 자리로 가는 이동만 꺼냅니다 (실거래 화면이 '대출' 이동을 먹어 버리지 않게).
 */
export function takePendingFocus(accept?: readonly FocusTarget[]): FocusJump | null {
  if (!pending) return null;
  if (accept && !accept.includes(pending.target)) return null;
  const p = pending;
  pending = null;
  return p;
}

/* ── 초점을 바꾸지 않고 실거래 화면에 단지 하나만 띄우기 ─────────────────── */

/**
 * 가격 위치 이웃 표의 [차트] 처럼, 초점 물건은 그대로 두고 다른 단지를 잠깐 볼 때.
 * 구별 차트 고리(`openDistrictChart`)를 같이 당겨 탭 이동은 App 의 기존 리스너가 맡습니다.
 */
export const MARKET_SHOW_COMPLEX_EVENT = 'market:show-complex';

export interface ComplexPick {
  complexId: string;
  area: number;
}

let pendingComplex: ComplexPick | null = null;

export function showComplexInMarket(complexId: string, area: number): void {
  pendingComplex = { complexId, area };
  window.dispatchEvent(new CustomEvent<ComplexPick>(MARKET_SHOW_COMPLEX_EVENT, { detail: pendingComplex }));
  const cx = marketComplexById(complexId);
  if (cx) openDistrictChart(cx.regionCode);
}

export function takePendingComplex(): ComplexPick | null {
  const c = pendingComplex;
  pendingComplex = null;
  return c;
}

/* ── 물건 ↔ 실거래 스냅샷 ─────────────────────────────────────────────── */

let byId: Map<string, MarketComplex> | null = null;

/** 스냅샷의 단지. 처음 부를 때 한 번만 색인합니다 */
export function marketComplexById(id: string): MarketComplex | undefined {
  if (!byId) byId = new Map(MARKET.complexes.map((c) => [c.id, c]));
  return byId.get(id);
}

/** 물건이 잇고 있는 단지 — 손 입력 물건이거나 스냅샷에서 사라진 단지면 null */
export function linkedComplex(property: Property | null | undefined): MarketComplex | null {
  if (!property?.link) return null;
  return marketComplexById(property.link.complexId) ?? null;
}
