/**
 * 마산 생활권 전월세 스냅샷 로더.
 *
 * `scripts/fetch-masan-rent.mjs` 가 구운 국토부 아파트 전월세 실거래를 읽습니다.
 * 매수 시뮬레이터의 `engine/` 과 섞지 않으려고 폴더를 갈라 뒀습니다 — 묻는
 * 질문이 다릅니다. 저기는 "살까 말까", 여기는 "지금 어디서 살까" 입니다.
 *
 * **매물이 아니라 체결된 계약입니다.** 이 자료로 "지금 빈 집이 있나" 는 답할
 * 수 없고, "이 단지 59㎡가 최근 얼마에 나갔나" 까지만 답합니다.
 */

import snapshot from '../data/masan-rent-2026-09.json';

export type CommuteGrade = 'onsite' | 'near' | 'mid' | 'far';

export interface RentRegion {
  code: string;
  label: string;
  short: string;
  /** 함안·의령 방향 출퇴근 접근성 — 소요시간이 아니라 등급입니다 */
  commute: CommuteGrade;
  note: string;
}

export interface RentDeal {
  /** 거래 건수 */
  n: number;
  /** 보증금 (원) */
  deposit: number;
  /** 월세 (원). 전세면 0 */
  rent: number;
}

export interface RentSize {
  /** 전용면적 (㎡, 정수 반올림) */
  area: number;
  /** 그 평형의 전체 거래 건수 */
  n: number;
  /** 마지막 거래 `202608` */
  lastYm: string;
  floorMin: number;
  floorMax: number;
  /** 갱신계약 비율 — 높으면 새로 나오는 매물이 적다는 신호입니다 */
  renewalShare: number;
  jeonse: RentDeal | null;
  wolse: RentDeal | null;
  /** 전세 보증금 분기 중위 — 오르는 중인지 */
  trend: { q: number; n: number; deposit: number }[];
}

export interface RentComplex {
  id: string;
  name: string;
  /** 법정동 (`내서읍 삼계리` 처럼 읍면이 붙기도 합니다) */
  umd: string;
  road: string;
  regionCode: string;
  buildYear: number;
  sizes: RentSize[];
}

interface RawSnapshot {
  version: string;
  asOf: string;
  quarterBaseYear: number;
  source: { name: string; endpoint: string; license: string; note: string };
  range: { from: string; to: string };
  stats: {
    deals: number;
    complexes: number;
    failedRequests: number;
    perRegion: Record<string, number>;
  };
  regions: RentRegion[];
  complexes: {
    id: string;
    name: string;
    umd: string;
    road: string;
    regionCode: string;
    buildYear: number;
    sizes: {
      area: number;
      n: number;
      lastYm: string;
      floorMin: number;
      floorMax: number;
      renewalShare: number;
      jeonse: { n: number; deposit: number } | null;
      wolse: { n: number; deposit: number; rent: number } | null;
      trend: number[][];
    }[];
  }[];
}

const raw = snapshot as unknown as RawSnapshot;

/** 만원 → 원. 다른 스냅샷과 같은 약속입니다. */
const won = (manwon: number) => manwon * 10000;

export const RENT_SNAPSHOT = {
  version: raw.version,
  asOf: raw.asOf,
  quarterBaseYear: raw.quarterBaseYear,
  source: raw.source,
  range: raw.range,
  stats: raw.stats,
};

export const RENT_REGIONS: RentRegion[] = raw.regions;

export const COMPLEXES: RentComplex[] = raw.complexes.map((c) => ({
  ...c,
  sizes: c.sizes.map((s) => ({
    ...s,
    jeonse: s.jeonse ? { n: s.jeonse.n, deposit: won(s.jeonse.deposit), rent: 0 } : null,
    wolse: s.wolse
      ? { n: s.wolse.n, deposit: won(s.wolse.deposit), rent: won(s.wolse.rent) }
      : null,
    trend: s.trend.map(([q, n, deposit]) => ({ q, n, deposit: won(deposit) })),
  })),
}));

export const COMMUTE_LABEL: Record<CommuteGrade, string> = {
  onsite: '지사 소재지',
  near: '가까움',
  mid: '보통',
  far: '멂',
};

export function regionOf(code: string): RentRegion | null {
  return RENT_REGIONS.find((r) => r.code === code) ?? null;
}

/** `202608` → 스냅샷 기준일로부터 몇 개월 전인가 */
export function monthsAgo(ym: string): number {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4, 6));
  const asOf = new Date(RENT_SNAPSHOT.asOf);
  return (asOf.getFullYear() - y) * 12 + (asOf.getMonth() + 1 - m);
}

/** 이 자료가 못 하는 것 — 화면에 늘 붙습니다. */
export const RENT_CAVEATS = [
  '매물이 아니라 체결된 계약입니다. 지금 빈 집이 있는지는 이 자료로 알 수 없습니다 — 후보를 좁히는 데까지만 쓰세요.',
  '방 개수가 자료에 없어 전용면적으로 대신 잽니다. 전용 36㎡ 안팎부터 투룸이 나오지만 단지마다 다릅니다.',
  '반려동물 가능 여부는 어느 공공자료에도 없습니다. 관리사무소·임대인에게 직접 확인해야 합니다.',
  '보증금 기회비용은 가정값입니다 — 전세대출을 쓰면 그 금리, 자기 돈이면 예금·투자 수익률로 바꿔 넣으세요.',
  '갱신계약 비율이 높은 단지는 살던 사람이 계속 사는 곳이라, 시세는 보이지만 실제로 나오는 매물은 적을 수 있습니다.',
];
