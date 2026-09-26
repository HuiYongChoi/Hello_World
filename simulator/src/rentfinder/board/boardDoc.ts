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
import {
  boardRowById,
  jeonseBoardLoans,
  rankBoardRows,
  wolseBoardLoans,
  type BoardMode,
  type JeonseBoardRow,
  type WolseBoardRow,
} from '../boardRow';
import type { Borrower } from '../loans';
import { BOARD_TEMPLATE } from './template';

export const BOARD_SNAPSHOT = board;

const PLACEHOLDERS = ['__DATA_J__', '__DATA_W__', '__AXES__', '__MAP__', '__SEED__', '__PROFILE__', '__SIGNALS__'] as const;

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
  /**
   * 대출 칸을 잴 내 조건. 없으면 스냅샷을 만들 때의 기본 가정 그대로입니다.
   * 있으면 모든 줄의 "되는 대출 · 자기 돈 · 월 이자" 를 이 조건으로 다시 잽니다.
   */
  borrower?: Borrower;
  /** 전월세 찾기에서 담은 집 — `단지id_면적` */
  added?: { jeonse: string[]; wolse: string[] };
  /**
   * 전세 신호 — 서버가 매일 쓰는 signals.json (scripts/watch/jeonse_watch.py).
   * 매일 바뀌는 값이라 단일 HTML 에 굽지 않고 같은 서버에서 읽어 넣습니다.
   */
  signals?: BoardSignals | null;
}

export interface BoardSignals {
  kind: 'masan-jeonse-signals';
  asOf: string;
  windowMonths: number;
  rows: Record<string, { upcoming: { end: string; gap: number; floor: string; dep: number; type: string; locked: boolean }[]; recent: { date: string; floor: string; dep: number; rent: number; type: string; term: string }[] }>;
}

/** 서버 신호 파일이 모양을 지키는지 — 깨진 파일로 후보판이 멈추면 안 됩니다 */
export function isBoardSignals(v: unknown): v is BoardSignals {
  const o = v as BoardSignals | null;
  return !!o && o.kind === 'masan-jeonse-signals' && typeof o.asOf === 'string' && typeof o.windowMonths === 'number' && !!o.rows && typeof o.rows === 'object';
}

const won = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(2)}억` : `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`);

/** 후보판 설명 칸에 적을 조건 한 줄 */
export function profileLabel(b: Borrower): string {
  return [
    `만 ${b.age}세`,
    `본인 소득 ${won(b.income)}`,
    b.married ? `부부합산 ${won(b.income + b.spouseIncome)}` : '혼인신고 전',
    `순자산 ${won(b.netWorth)}`,
    b.smeEmployed ? '중소기업 재직' : '중소기업 재직 아님',
  ].join(' · ');
}

type Rows<T> = T[];

/** 스냅샷 줄 + 담은 줄을 내 조건으로 다시 잽니다 */
export function personalizeRows(opts: BoardDocOptions): { jeonse: Rows<JeonseBoardRow>; wolse: Rows<WolseBoardRow> } {
  let jeonse = board.jeonse as unknown as JeonseBoardRow[];
  let wolse = board.wolse as unknown as WolseBoardRow[];
  const b = opts.borrower;
  if (b) {
    jeonse = jeonse.map((r) => ({ ...r, loans: r.est ? jeonseBoardLoans(b, r.est, r.area) : [] }));
    wolse = wolse.map((r) => ({ ...r, loans: wolseBoardLoans(b, r.dep, r.rent, r.area) }));
  }
  const add = (mode: BoardMode, rows: (JeonseBoardRow | WolseBoardRow)[], ids: string[] = []) => {
    const have = new Set(rows.map((r) => r.id));
    const extra = ids
      .filter((id) => !have.has(id))
      .map((id) => boardRowById(mode, id, b ?? DEFAULT_PROFILE))
      .filter((r): r is JeonseBoardRow | WolseBoardRow => !!r)
      .map((r) => ({ ...r, added: true, rank: rows.length + 1000 }));
    return extra.length ? rankBoardRows([...rows, ...extra], mode) : rows;
  };
  jeonse = add('jeonse', jeonse, opts.added?.jeonse) as JeonseBoardRow[];
  wolse = add('wolse', wolse, opts.added?.wolse) as WolseBoardRow[];
  return { jeonse, wolse };
}

/** 스냅샷을 만들 때 쓴 기본 가정 — 조건을 안 넣은 사람도 같은 숫자를 봅니다 */
export const DEFAULT_PROFILE: Borrower = {
  age: 32,
  militaryServed: true,
  married: false,
  marriedYears: 0,
  newbornWithin2y: false,
  smeEmployed: false,
  income: 40000000,
  spouseIncome: 35000000,
  netWorth: 80000000,
  householder: true,
  noHouse: true,
};

export function buildBoardDoc(opts: BoardDocOptions = {}): string {
  const rows = personalizeRows(opts);
  const profile = {
    label: profileLabel(opts.borrower ?? DEFAULT_PROFILE),
    hint: opts.borrower
      ? '전월세 찾기의 "내 조건" 을 바꾸면 이 칸이 다시 계산됩니다.'
      : '기본 가정입니다 — 전월세 찾기에서 내 조건을 넣으면 그 조건으로 다시 잽니다.',
  };
  const body = BOARD_TEMPLATE
    .replace('<!--FONTS-->', opts.fonts ?? '')
    .replace('__DATA_J__', () => safe(rows.jeonse))
    .replace('__DATA_W__', () => safe(rows.wolse))
    .replace('__AXES__', () => safe(board.axes))
    .replace('__MAP__', () => safe(board.map))
    .replace('__SEED__', () => safe(board.seed))
    .replace('__PROFILE__', () => safe(profile))
    .replace('__SIGNALS__', () => safe(isBoardSignals(opts.signals) ? opts.signals : null));
  return [
    '<!doctype html>',
    `<html lang="ko"${opts.theme ? ` data-theme="${opts.theme}"` : ''}>`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    '<body>',
    body,
    '</body></html>',
  ].join('\n');
}
