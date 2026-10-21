/**
 * 구별 매매 차트로 건너가는 고리 — 시장 온도·동네 시세판의 구 이름이 씁니다.
 *
 * 화면 파일(DistrictChartCard.tsx)과 떼어 둔 이유: 컴포넌트 파일이 함수까지 내보내면
 * 개발 서버의 빠른 새로고침이 그 파일을 통째로 다시 읽습니다.
 */

export const DISTRICT_CHART_EVENT = 'district-chart:open';
let pending: string | null = null;

/** 어느 화면에서든 — 실거래 수익률 탭으로 옮기고 그 구 하나를 골라 둔 채 차트로 내려갑니다 */
export function openDistrictChart(code: string) {
  pending = code;
  window.dispatchEvent(new CustomEvent(DISTRICT_CHART_EVENT, { detail: { code } }));
}

/** 아직 차트가 받지 못한 구 — 한 번 꺼내면 비웁니다 */
export function takePendingDistrict(): string | null {
  const c = pending;
  pending = null;
  return c;
}
