/**
 * 오늘 볼 것 — **"오늘 아침에 뭘 봐야 하나"** 를 네 줄로.
 *
 * ```
 * 전세 신호     소거 안 한 후보 중 만기 3개월 안 · 그중 갱신 끝남 · 새 계약     → 후보판
 * 남은 후보     소거 안 한 전세 줄 순위 1~3                                    → 후보판
 * 청약 새 공고   권역별 최신 공고 — 수집 기준 30일 안이면 그 공고, 아니면 N일째 없음 → 청약
 * 시장 온도     마산 매매 거래량 · 전세가율 · 전세 1년 변화 (나란히, 합치지 않음)   → 실거래 수익률
 * ```
 *
 * 순수 함수입니다. 신호 파일(fetch)과 후보판 소거 목록(localStorage)은 화면에서
 * 읽어 값으로 넘깁니다 — 그래야 테스트가 됩니다.
 */

import { MARKET } from '../engine/market';
import { APPLYHOME, NOTICES } from '../engine/applyhome';
import { money, percent } from '../engine/format';
import { saleTemperature } from '../engine/temperature';
import type { RegionId } from '../engine/types';
import { BOARD_SNAPSHOT, type BoardSignals } from './board/boardDoc';
import type { JeonseBoardRow } from './boardRow';
import { COMPLEXES } from './data';
import { jeonseTemperature, rentQLabel } from './town';

export type TodayTarget = 'board' | 'town' | 'subscription' | 'market';

export interface TodayItem {
  key: 'signals' | 'shortlist' | 'notices' | 'temperature';
  title: string;
  line: string;
  detail: string[];
  target: TodayTarget;
  /** 근거가 없어 흐리게 — 숫자를 지어내지 않고 이유만 적습니다 */
  muted: boolean;
}

export interface TodayInput {
  /** fetchSignals() 결과. 서버판이 아니면 null */
  signals: BoardSignals | null;
  /** 후보판 `masan-jeonse-board-v2` 의 excluded — 없으면 스냅샷 seed */
  excluded: Record<string, unknown>;
  /** 'YYYY-MM-DD' */
  today: string;
}

/** 새 공고로 볼 기간 (수집 기준일로부터) */
export const NEW_NOTICE_DAYS = 30;
/** 시장 온도 한 줄이 보는 구 — 마산회원·마산합포 */
export const TODAY_TOWN_CODES = ['48127', '48125'];

const REGION_LABEL: Record<RegionId, string> = { changwon: '창원', busan: '부산', gyeonggi: '경기' };
const REGION_ORDER: RegionId[] = ['changwon', 'busan', 'gyeonggi'];

/** 'YYYY-MM-DD' 두 날짜 사이 일수 (b − a) */
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86400000);
}

const BOARD_JEONSE = BOARD_SNAPSHOT.jeonse as unknown as JeonseBoardRow[];

const isExcluded = (excluded: Record<string, unknown>, id: string) => !!excluded[id];

/** 줄 id(`단지id_면적`) → 사람이 읽는 이름 */
function rowName(id: string): string {
  const r = BOARD_JEONSE.find((x) => x.id === id);
  if (r) return `${r.name} ${r.area}㎡`;
  const cut = id.lastIndexOf('_');
  const c = COMPLEXES.find((x) => x.id === id.slice(0, cut));
  return c ? `${c.name} ${id.slice(cut + 1)}㎡` : id;
}

const mmdd = (date: string) => date.slice(5, 10);
const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${percent(Math.abs(v), digits)}`;

function signalsItem(signals: BoardSignals | null, excluded: Record<string, unknown>, today: string): TodayItem {
  const base = { key: 'signals' as const, title: '전세 신호', target: 'board' as const };
  if (!signals) {
    return {
      ...base,
      line: '서버판에서만 — 신호 파일 없음',
      detail: [
        '전세 신호는 서버가 매일 08:00 에 쓰는 signals.json 을 읽습니다. 이 사이트(파일 직접 열기·GitHub Pages)에는 그 파일이 없습니다.',
        '메일을 받고 있다면 같은 내용이 메일에 있습니다.',
      ],
      muted: true,
    };
  }
  const w = signals.windowMonths;
  let soon = 0;
  let locked = 0;
  let later = 0;
  let recent = 0;
  const lines: { end: string; text: string }[] = [];
  for (const [id, row] of Object.entries(signals.rows)) {
    if (isExcluded(excluded, id)) continue;
    recent += row.recent.length;
    for (const u of row.upcoming) {
      if (u.gap <= w) {
        soon++;
        if (u.locked) locked++;
        lines.push({
          end: u.end,
          text: `${u.end} 만기 · ${rowName(id)} ${u.floor}층 · ${money(u.dep)}${u.locked ? ' · 갱신 끝남 — 나올 가능성 높음' : ''}`,
        });
      } else later++;
    }
  }
  lines.sort((a, b) => a.end.localeCompare(b.end));
  const age = daysBetween(signals.asOf.slice(0, 10), today);
  const stamp = `기준 ${mmdd(signals.asOf)}${age >= 2 ? ` (${age}일 전)` : ''}`;
  const detail = lines.map((l) => l.text);
  if (later) detail.push(`${w + 1}~6개월 안 만기 ${later}건은 후보판에서 봅니다.`);
  if (!detail.length) detail.push(`${w}개월 안 만기가 없습니다 — 소거한 후보는 세지 않습니다.`);
  detail.push('매물이 아니라 계약입니다. 동·호수 없이 층까지만 압니다.');
  return {
    ...base,
    line: `${w}개월 안 만기 ${soon}건 (갱신 끝남 ${locked}) · 새 계약 ${recent} — ${stamp}`,
    detail,
    muted: false,
  };
}

function shortlistItem(excluded: Record<string, unknown>): TodayItem {
  const left = BOARD_JEONSE.filter((r) => !isExcluded(excluded, r.id)).sort((a, b) => a.rank - b.rank);
  const top = left.slice(0, 3);
  return {
    key: 'shortlist',
    title: '남은 후보',
    target: 'board',
    line: top.length ? top.map((r, i) => `${i + 1} ${r.name} ${r.area} (${r.tier})`).join(' · ') : '남은 전세 후보가 없습니다',
    detail: [
      `소거 안 한 전세 후보 ${left.length}곳 / 전체 ${BOARD_JEONSE.length}곳.`,
      ...top.map(
        (r, i) =>
          `${i + 1}. ${r.name} ${r.area}㎡ · 최근 전세 ${r.est ? money(r.est) : '—'} · 전세가율 ${r.ratio != null ? percent(r.ratio, 0) : '—'} · 판정 ${r.tier}`
      ),
      '순위는 후보판 스냅샷의 자동 순위입니다 — 후보판에서 직접 고친 순위·판정은 후보판에서 보세요.',
    ],
    muted: !top.length,
  };
}

function noticesItem(): TodayItem {
  const asOf = APPLYHOME.asOf;
  const parts: { order: number; text: string }[] = [];
  const detail: string[] = [];
  for (const region of REGION_ORDER) {
    const list = NOTICES.filter((n) => n.region === region).sort((a, b) => b.noticeDate.localeCompare(a.noticeDate));
    const label = REGION_LABEL[region];
    if (!list.length) {
      parts.push({ order: 9999, text: `${label} 공고 없음` });
      continue;
    }
    const fresh = list.filter((n) => daysBetween(n.noticeDate, asOf) <= NEW_NOTICE_DAYS);
    if (fresh.length) {
      const first = fresh[0];
      parts.push({ order: -fresh.length, text: `${label} ${fresh.length}건 (${mmdd(first.noticeDate)} ${first.name})` });
      for (const n of fresh) detail.push(`${label} · ${n.noticeDate} · ${n.name}${n.sigungu ? ` (${n.sigungu})` : ''}`);
    } else {
      const days = daysBetween(list[0].noticeDate, asOf);
      parts.push({ order: days, text: `${label} ${days}일째 없음` });
      detail.push(`${label} · 마지막 공고 ${list[0].noticeDate} ${list[0].name}`);
    }
  }
  parts.sort((a, b) => a.order - b.order);
  detail.push(`청약홈 수집 기준 ${asOf} · ${NEW_NOTICE_DAYS}일 안 공고를 새 공고로 봅니다. 스냅샷이 오래된 것과 그 권역에 새 공고가 없는 것은 다른 문제입니다.`);
  return { key: 'notices', title: '청약 새 공고', target: 'subscription', line: parts.map((p) => p.text).join(' · '), detail, muted: false };
}

function temperatureItem(): TodayItem {
  const jt = jeonseTemperature(TODAY_TOWN_CODES);
  const st = saleTemperature(MARKET.complexes.filter((c) => TODAY_TOWN_CODES.includes(c.regionCode)));
  const sale = st.deals.change != null ? `마산 매매 거래 ${signed(st.deals.change, 0)}` : '마산 매매 거래 — 기준 적음';
  const r = jt.ratioLatest;
  const ratio = r
    ? `전세가율 ${percent(r.v, 0)}${r.prev != null ? ` (${r.v >= r.prev ? '↑' : '↓'}${Math.abs((r.v - r.prev) * 100).toFixed(1)}%p)` : ''}`
    : '전세가율 — 표본 부족';
  const j1 = jt.jeonse1y ? `전세 1년 ${signed(jt.jeonse1y.v)}` : '전세 1년 — 표본 부족';
  return {
    key: 'temperature',
    title: '시장 온도',
    target: 'market',
    line: [sale, ratio, j1].join(' · '),
    detail: [
      `매매 거래량: ${st.deals.recent.toLocaleString('ko-KR')}건 대 ${st.deals.prior.toLocaleString('ko-KR')}건 (${st.window.label})`,
      r
        ? `전세가율: ${rentQLabel(r.q)} 같은 칸 ${r.cells}개의 중위${r.prev != null ? ` · 4분기 전 ${rentQLabel(r.prevQ)} ${percent(r.prev, 0)}` : ''}`
        : '전세가율: 짝지은 칸이 적어 내지 않습니다',
      jt.jeonse1y ? `전세 1년 변화: 같은 칸 ${jt.jeonse1y.cells}개의 보증금 비율 중위 (${jt.window})` : '전세 1년 변화: 짝지은 칸이 적어 내지 않습니다',
      '축마다 따로 읽습니다 — 합친 점수는 없습니다. 거래량 ↓ 와 전세가율 ↑ 는 해야 할 일이 반대입니다.',
    ],
    muted: false,
  };
}

/** 늘 네 줄, 순서 고정: 전세 신호 → 남은 후보 → 청약 새 공고 → 시장 온도 */
export function todayItems(input: TodayInput): TodayItem[] {
  return [
    signalsItem(input.signals, input.excluded, input.today),
    shortlistItem(input.excluded),
    noticesItem(),
    temperatureItem(),
  ];
}

/** 후보판이 쓰는 전세판 저장 키 — template.html 의 MODES.jeonse.ls 와 같은 문자열 */
export const JEONSE_BOARD_LS = 'masan-jeonse-board-v2';

/** 후보판 저장값에서 소거 목록만 — 없거나 깨졌으면 스냅샷 seed */
export function excludedFrom(stored: unknown): Record<string, unknown> {
  const o = stored as { excluded?: unknown } | null;
  if (o && o.excluded && typeof o.excluded === 'object') return o.excluded as Record<string, unknown>;
  return (BOARD_SNAPSHOT.seed.jeonse.excluded ?? {}) as Record<string, unknown>;
}
