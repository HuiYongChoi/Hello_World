/**
 * 전·월세 후보판 문서 조립 — **화면을 모르는 순수 함수**입니다.
 *
 * 후보판은 소거·순위·인프라 점수·지도·저장한 보기까지 담은 한 장짜리 화면이라
 * React 로 다시 짜지 않고, 아티팩트로 쓰던 원본(template.html)에 스냅샷을 채워
 * iframe 의 srcdoc 으로 싣습니다. 원본 하나를 사이트와 아티팩트가 같이 씁니다.
 *
 * ```
 * 사이트    글꼴 없음(외부 요청 0건) · 공유 DB 없음 → 이 브라우저 저장 + 파일로 옮기기
 * 아티팩트  구글 글꼴 · 공유 DB → 같이 보는 사람과 저장
 * ```
 *
 * 스냅샷 안의 `</` 는 `<\/` 로 바꿉니다. 데이터에 `</script>` 가 섞이면 문서가
 * 거기서 끊기기 때문입니다.
 */
import board from '../../data/board-2026-09.json';
import { BOARD_TEMPLATE } from './template';

export const BOARD_SNAPSHOT = board;

const PLACEHOLDERS = ['__DATA_J__', '__DATA_W__', '__AXES__', '__MAP__', '__SEED__'] as const;

const safe = (v: unknown) => JSON.stringify(v).replace(/<\//g, '<\\/');

/** 채워 넣을 자리가 원본에 전부 있는지 — 하나라도 없으면 화면이 조용히 빈다 */
export function missingPlaceholders(template = BOARD_TEMPLATE): string[] {
  return PLACEHOLDERS.filter((p) => !template.includes(p));
}

export interface BoardDocOptions {
  /** 아티팩트처럼 외부 글꼴을 써도 되는 곳이면 링크를 넣습니다 */
  fonts?: string;
  /** 사이트는 늘 어두운 화면이라 후보판도 어둡게 엽니다 */
  theme?: 'dark' | 'light';
}

export function buildBoardDoc(opts: BoardDocOptions = {}): string {
  const body = BOARD_TEMPLATE
    .replace('<!--FONTS-->', opts.fonts ?? '')
    .replace('__DATA_J__', () => safe(board.jeonse))
    .replace('__DATA_W__', () => safe(board.wolse))
    .replace('__AXES__', () => safe(board.axes))
    .replace('__MAP__', () => safe(board.map))
    .replace('__SEED__', () => safe(board.seed));
  return [
    '<!doctype html>',
    `<html lang="ko"${opts.theme ? ` data-theme="${opts.theme}"` : ''}>`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    '<body>',
    body,
    '</body></html>',
  ].join('\n');
}
