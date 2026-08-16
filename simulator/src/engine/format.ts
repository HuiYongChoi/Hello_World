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

/**
 * 받침에 맞는 조사를 붙입니다 — "1990년대은" 같은 문장이 나오지 않게.
 *
 * 값이 데이터에서 오면 어떤 글자로 끝날지 미리 알 수 없습니다. 괄호·숫자·영문으로
 * 끝나는 경우도 있어(예: `중형 (60~85㎡)`) 마지막 **한글 음절**을 찾아 판정하고,
 * 한글이 하나도 없으면 받침 없는 것으로 봅니다.
 */
export function withParticle(word: string, withJong: string, withoutJong: string): string {
  const syllables = [...word].filter((ch) => ch >= '가' && ch <= '힣');
  const last = syllables[syllables.length - 1];
  if (!last) return `${word}${withoutJong}`;
  const hasJongseong = (last.charCodeAt(0) - 0xac00) % 28 !== 0;
  return `${word}${hasJongseong ? withJong : withoutJong}`;
}

/** 은/는 */
export const topicParticle = (w: string) => withParticle(w, '은', '는');
/** 이/가 */
export const subjectParticle = (w: string) => withParticle(w, '이', '가');
