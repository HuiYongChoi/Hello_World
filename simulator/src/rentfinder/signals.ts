/**
 * 전세 신호 파일 읽기 — 서버가 매일 08:00 에 사이트 옆에 써 두는 `signals.json`.
 *
 * `BoardFrame` 의 규칙을 함수로 뺀 것입니다: 같은 출처, 캐시 안 씀, `isBoardSignals`
 * 로 모양 검증, 시간 초과면 `null`. 없는 곳(GitHub Pages·파일 직접 열기)에서는
 * 조용히 `null` 이고 화면은 그 사실만 적습니다. 외부 호스트 요청이 아닙니다.
 */

import { isBoardSignals, type BoardSignals } from './board/boardDoc';

export function fetchSignals(timeoutMs = 1500): Promise<BoardSignals | null> {
  if (typeof fetch !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: BoardSignals | null) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const t = setTimeout(() => finish(null), timeoutMs);
    fetch(`signals.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => finish(isBoardSignals(j) ? j : null))
      .catch(() => finish(null))
      .finally(() => clearTimeout(t));
  });
}
