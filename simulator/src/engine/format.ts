/** 금액 표기 유틸 — 억/만원 단위 한글 표기 */

export function eok(v: number, digits = 2): string {
  return `${(v / 100000000).toFixed(digits)}억`;
}

export function manwon(v: number): string {
  return `${Math.round(v / 10000).toLocaleString('ko-KR')}만`;
}

/** 3.04억 / 8,500만 처럼 크기에 따라 단위를 바꿔 표기 */
export function money(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 100000000) return eok(v);
  if (abs >= 10000) return manwon(v);
  return `${Math.round(v).toLocaleString('ko-KR')}원`;
}

export function won(v: number): string {
  return `${Math.round(v).toLocaleString('ko-KR')}원`;
}

export function percent(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}
