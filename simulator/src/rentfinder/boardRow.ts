/**
 * 후보판 한 줄 — **"내 조건" 으로 다시 재는 전·월세 후보.**
 *
 * 후보판(board/template.html)은 스냅샷을 그대로 보여 주는 화면이라, 대출 칸이
 * 스냅샷을 만들 때의 가정(32세·소득 4천만)에 묶여 있었습니다. 그러면 "내가
 * 이 집에 들어가려면 내 돈이 얼마 드나" 에 답하지 못합니다. 여기서 사용자의
 * 조건으로 다시 재고, 전월세 찾기에서 새로 담은 집도 같은 모양의 줄로 만듭니다.
 *
 * ```
 * 최근 전세   2026년 3건↑ → 최근 4분기 → 6분기 → 2년 (중위의 70% 미만 거래는 특수 계약으로 뺌)
 * 전세가율    최근 전세 ÷ 같은 단지·평형 최근 1년 매매 중위
 * 월 환산     월세 + 보증금 × 기회비용률 ÷ 12
 * 최대 보증금  내 돈 + 대출 — 상품마다 비율·상한·보증금 상한이 달라 상품별로 잽니다
 * ```
 *
 * 화면을 모릅니다. 계산은 전부 여기서 끝나고 화면은 결과를 그립니다.
 */

import { MARKET, quarterLabel } from '../engine/market';
import { COMPLEXES, regionOf, type RentComplex, type RentSize } from './data';
import { DEFAULT_INPUT, toSupplyPyeong } from './finder';
import {
  RENT_LOAN_PRODUCTS,
  compareRentLoans,
  evaluateRentLoan,
  jeonseLoanFit,
  type Borrower,
} from './loans';
import { SAFETY_RULES, jeonseSafety } from './safety';

export type BoardMode = 'jeonse' | 'wolse';
export type BoardTier = 'A' | 'B' | 'C' | 'D';

/** 후보판이 읽는 대출 칸 모양 */
export interface BoardLoan {
  n: string;
  lim: number;
  r0: number;
  r1: number;
  own: number;
  i0: number;
  i1: number;
  wolse?: boolean;
  mcap?: number | null;
}

type Hist = [string, number, number][];

interface BoardRowBase {
  id: string;
  cx: string;
  name: string;
  umd: string;
  road: string;
  region: string;
  built: number;
  area: number;
  supply: number;
  sale: number | null;
  saleN: number;
  ratio: number | null;
  room: number | null;
  trend: number | null;
  loans: BoardLoan[];
  km: number | null;
  min: number | null;
  jh: Hist;
  sh: Hist;
  deals: number;
  last: string;
  renew: number;
  notes: string[];
  tier: BoardTier;
  rank: number;
  counts: Record<string, number>;
  auto: Record<string, number | null>;
  /** 전월세 찾기에서 직접 담은 줄 */
  added?: boolean;
}

export interface JeonseBoardRow extends BoardRowBase {
  est: number | null;
  estN: number;
  estBasis: string;
  guar: number | null;
  wolse: { n: number; deposit: number; rent: number } | null;
}

export interface WolseBoardRow extends BoardRowBase {
  dep: number;
  rent: number;
  wn: number;
  monthly: number;
  j: { n: number; deposit: number } | null;
  priority: boolean;
  rental: boolean;
}

export const INFRA_KEYS = ['walk', 'pet', 'shop', 'med', 'bus', 'life'] as const;
const EMPTY_AUTO = Object.fromEntries(INFRA_KEYS.map((k) => [k, null])) as Record<string, null>;

/** 방 둘이 안정적으로 나오는 선 — 전월세 찾기와 후보판이 같은 기준을 씁니다 */
export const BOARD_MIN_AREA = 45;
/** 최근 몇 달 안에 거래가 있어야 후보로 보나 */
export const BOARD_FRESH_MONTHS = 12;

const LATEST_Q = Math.max(...COMPLEXES.flatMap((c) => c.sizes.flatMap((s) => s.trend.map((t) => t.q))));
const LATEST_YM = COMPLEXES.flatMap((c) => c.sizes.map((s) => s.lastYm)).reduce((a, b) => (b > a ? b : a), '');
const ASOF_YEAR = Number(LATEST_YM.slice(0, 4));

const eok = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(2)}억` : `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`);
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;

function monthsBetween(ym: string, ref: string): number {
  const a = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4, 6));
  const b = Number(ref.slice(0, 4)) * 12 + Number(ref.slice(4, 6));
  return b - a;
}

/** 거래건수로 가중한 중위 — 분기 중위가 여러 개일 때 */
function weightedMedian(points: { n: number; v: number }[]): { v: number; n: number } | null {
  const s = [...points].sort((a, b) => a.v - b.v);
  const total = s.reduce((acc, p) => acc + p.n, 0);
  let acc = 0;
  for (const p of s) {
    acc += p.n;
    if (acc * 2 >= total) return { v: p.v, n: total };
  }
  return null;
}

export interface RecentJeonse {
  value: number | null;
  n: number;
  basis: string;
  /** 거래가 1.5배 넘게 갈려 시세를 모름 */
  split: boolean;
  /** 특수 계약으로 보고 뺀 값 */
  dropped: number[];
}

/**
 * 최근 전세 — 2년 중위는 오른 시장을 따라가지 못합니다(교방동 신축이 2.7억 → 3.5억).
 * 가까운 거래부터 보고, 표본이 모자라면 창을 넓힙니다.
 */
export function recentJeonse(size: RentSize): RecentJeonse {
  const pts = size.trend.map((t) => ({ q: t.q, n: t.n, v: t.deposit }));
  if (!pts.length) return { value: null, n: 0, basis: '거래 없음', split: false, dropped: [] };
  const sortedV = pts.map((p) => p.v).sort((a, b) => a - b);
  const center = sortedV[Math.floor((sortedV.length - 1) / 2)];
  const kept = pts.filter((p) => p.v >= 0.7 * center);
  const dropped = pts.filter((p) => p.v < 0.7 * center).map((p) => p.v);
  const sumN = (w: typeof pts) => w.reduce((a, p) => a + p.n, 0);
  const windows: [number, number, string][] = [
    [3, 3, '최근 3분기'],
    [4, 3, '최근 4분기'],
    [6, 2, '최근 6분기'],
  ];
  let win = kept;
  let basis = '2년 전체';
  for (const [q, min, label] of windows) {
    const w = kept.filter((p) => p.q > LATEST_Q - q);
    if (sumN(w) >= min) {
      win = w;
      basis = label;
      break;
    }
  }
  const vals = kept.map((p) => p.v);
  const split = sumN(kept) <= 3 && vals.length >= 2 && Math.max(...vals) / Math.min(...vals) > 1.5;
  const m = split ? null : weightedMedian(win);
  return { value: m?.v ?? null, n: m?.n ?? 0, basis, split, dropped };
}

function saleHistory(c: RentComplex, area: number): Hist {
  const mk = MARKET.complexes.find((x) => x.id === c.id);
  const size = mk?.sizes
    .filter((s) => Math.abs(s.area - area) <= 2)
    .sort((a, b) => Math.abs(a.area - area) - Math.abs(b.area - area))[0];
  return size ? size.points.slice(-6).map((p) => [quarterLabel(p.q), p.n, p.price]) : [];
}

/** 대출 결과를 후보판 칸 모양으로 */
function toBoardLoan(r: ReturnType<typeof evaluateRentLoan>): BoardLoan {
  return {
    n: r.product.shortName,
    lim: r.limit,
    r0: r.rate.min,
    r1: r.rate.max,
    own: r.ownCash,
    i0: Math.round(r.monthlyInterest.min),
    i1: Math.round(r.monthlyInterest.max),
    wolse: r.product.mode === 'wolse',
    mcap: r.product.limits.monthlyCap ?? null,
  };
}

/** 전세 보증금에 되는 대출 — 금리 낮은 순 */
export function jeonseBoardLoans(b: Borrower, deposit: number, area: number): BoardLoan[] {
  return jeonseLoanFit(b, deposit, area).eligible.map(toBoardLoan);
}

/** 월세(보증금 + 월세)에 되는 대출 — 청년 월세대출 포함, 금리 낮은 순 */
export function wolseBoardLoans(b: Borrower, deposit: number, rent: number, area: number): BoardLoan[] {
  return compareRentLoans(b, { deposit, rent, areaSqm: area })
    .filter((r) => r.eligible)
    .map(toBoardLoan);
}

const base = (c: RentComplex, s: RentSize) => {
  const reg = regionOf(c.regionCode);
  return {
    id: `${c.id}_${s.area}`,
    cx: c.id,
    name: c.name,
    umd: c.umd,
    road: c.road,
    region: reg?.short ?? c.regionCode,
    built: c.buildYear,
    area: s.area,
    supply: Math.round(toSupplyPyeong(s.area)),
    km: null,
    min: null,
    sh: saleHistory(c, s.area),
    jh: s.trend.slice(-6).map((t) => [quarterLabel(t.q), t.n, t.deposit]) as Hist,
    deals: s.n,
    last: s.lastYm,
    renew: s.renewalShare,
    counts: {},
    auto: { ...EMPTY_AUTO },
    rank: 0,
  };
};

export function jeonseBoardRow(c: RentComplex, s: RentSize, b: Borrower): JeonseBoardRow | null {
  if (!s.jeonse) return null;
  const rj = recentJeonse(s);
  const est = rj.value;
  const saf = est ? jeonseSafety(c.id, s.area, est) : null;
  const sale = saf?.salePrice ?? null;
  const ratio = est && sale ? est / sale : null;
  const thin = rj.n < 3 || (saf?.saleDeals ?? 0) < 5;
  const tier: BoardTier = ratio == null || thin ? 'D' : ratio < SAFETY_RULES.ratioCuts.mid ? 'A' : ratio < SAFETY_RULES.ratioCuts.high ? 'B' : 'C';
  const notes: string[] = [];
  if (rj.split) notes.push('전세 거래가 크게 갈려 시세를 알 수 없음');
  if (rj.dropped.length) notes.push(`튀는 거래 제외: ${rj.dropped.map(eok).join(', ')}`);
  if (!rj.split && est && rj.n < 3) notes.push(`전세 표본 ${rj.n}건`);
  if (sale && (saf?.saleDeals ?? 0) < 5) notes.push(`매매 표본 ${saf?.saleDeals}건`);
  if (s.area > 85) notes.push('전용 85㎡ 초과 — 정책상품 불가');
  else if (est && est > 3e8) notes.push('보증금 3억 초과 — 청년버팀목 불가');
  if (saf?.priceTrend && saf.priceTrend.change <= -0.05) notes.push(`매매가 하락 중 (${pct(saf.priceTrend.change, 1)})`);
  if (s.renewalShare >= 0.4) notes.push(`갱신계약 ${pct(s.renewalShare)} — 새 매물 드묾`);
  return {
    ...base(c, s),
    est,
    estN: rj.n,
    estBasis: rj.basis,
    sale,
    saleN: saf?.saleDeals ?? 0,
    ratio,
    room: est && sale ? sale * SAFETY_RULES.auctionRatio - est : null,
    guar: est && sale ? sale * SAFETY_RULES.guaranteeRatio - est : null,
    trend: saf?.priceTrend?.change ?? null,
    loans: est ? jeonseBoardLoans(b, est, s.area) : [],
    wolse: s.wolse,
    notes,
    tier,
  };
}

export function wolseBoardRow(c: RentComplex, s: RentSize, b: Borrower): WolseBoardRow | null {
  if (!s.wolse) return null;
  const dep = s.wolse.deposit;
  const rent = s.wolse.rent;
  const saf = jeonseSafety(c.id, s.area, dep);
  const sale = saf.salePrice;
  const room = saf.seniorRoom?.auction ?? null;
  const pr = SAFETY_RULES.priorityRepayment;
  const priority = dep <= pr.depositMax;
  const rental = !sale && s.wolse.n >= SAFETY_RULES.rentalOnlyMinDeals;
  const tier: BoardTier =
    sale == null ? 'D' : room != null && room > 0 && (dep <= pr.amount || (saf.ratio ?? 1) < 0.5) ? 'A' : room != null && room > 0 ? 'B' : 'C';
  const notes: string[] = [];
  if (rental) notes.push(`매매 0건 · 월세 ${s.wolse.n}건 — 임대 전용(공공·민간임대) 단지로 보임, 임대인·보증 조건 확인`);
  if (priority) notes.push(`보증금 ${eok(pr.depositMax)} 이하 — 소액임차인 최우선변제 대상(${eok(pr.amount)}까지, 전입·확정일자 필요 · 시행령 확인)`);
  if (s.area > 85) notes.push('전용 85㎡ 초과 — 정책상품 불가');
  if (s.wolse.n < 5) notes.push(`월세 표본 ${s.wolse.n}건`);
  if (s.renewalShare >= 0.4) notes.push(`갱신계약 ${pct(s.renewalShare)} — 새 매물 드묾`);
  return {
    ...base(c, s),
    dep,
    rent,
    wn: s.wolse.n,
    monthly: rent + (dep * DEFAULT_INPUT.opportunityRate) / 12,
    j: s.jeonse,
    sale,
    saleN: saf.saleDeals,
    ratio: saf.ratio,
    room,
    trend: saf.priceTrend?.change ?? null,
    loans: wolseBoardLoans(b, dep, rent, s.area),
    priority,
    rental,
    notes,
    tier,
  };
}

/**
 * 자동 순위 — 전세는 판정(A→D) 다음 전세가율, 월세는 판정 다음 월 환산.
 * 스냅샷 줄과 새로 담은 줄을 같은 규칙으로 섞어 다시 셉니다.
 */
export function rankBoardRows<T extends BoardRowBase>(rows: T[], mode: BoardMode): T[] {
  const order: Record<BoardTier, number> =
    mode === 'jeonse' ? { A: 0, B: 1, C: 2, D: 3 } : { A: 0, B: 0, C: 1, D: 2 };
  const key = (r: T) =>
    mode === 'jeonse' ? ((r as unknown as JeonseBoardRow).ratio ?? 9) : (r as unknown as WolseBoardRow).monthly;
  const sorted = [...rows].sort((a, b) => order[a.tier] - order[b.tier] || key(a) - key(b) || a.rank - b.rank);
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

/* ─────────────────────── 얼마짜리까지 되나 ─────────────────────── */

export interface DepositReach {
  product: string;
  /** 이 상품으로 들어갈 수 있는 최대 보증금 */
  maxDeposit: number;
  /** 그때 빌리는 돈 */
  loan: number;
  /** 무엇이 최대치를 막았나 */
  binding: 'CASH_RATIO' | 'CAP' | 'DEPOSIT_MAX';
  rate: { min: number; max: number };
  /** 자격에서 떨어진 이유 — 비어 있으면 됨 */
  rejectReasons: string[];
}

/**
 * 내 돈으로 들어갈 수 있는 최대 전세 보증금 — 상품별로.
 *
 * ```
 * 빌리는 돈 = min(보증금 × 비율, 상품 상한)
 * 내 돈    = 보증금 − 빌리는 돈 ≤ 가진 돈
 * → 비율 구간  보증금 ≤ 가진 돈 ÷ (1 − 비율)
 *   상한 구간  보증금 ≤ 가진 돈 + 상품 상한
 * ```
 *
 * 보증금 상한은 자격 조건이라 넘으면 그 상품이 통째로 빠집니다 — 그래서 최대치를
 * 거기서 자릅니다. 전용면적 상한은 집마다 달라 여기서는 85㎡ 이하 집을 가정합니다.
 */
export function depositReach(b: Borrower, cash: number, areaSqm = 59): DepositReach[] {
  const out: DepositReach[] = [];
  for (const p of RENT_LOAN_PRODUCTS) {
    if (p.mode === 'wolse') continue;
    // 보증금과 무관한 자격만 봅니다 — 보증금은 아래에서 잘라 냅니다.
    const probe = evaluateRentLoan(p, b, { deposit: 1, rent: 0, areaSqm });
    const reasons = probe.rejectReasons.filter((r) => !r.includes('보증금'));
    const r = p.limits.depositRatio;
    const cap = p.limits.cap;
    let maxDep: number;
    let binding: DepositReach['binding'];
    if (r >= 1 || cash / (1 - r) > cap / r) {
      maxDep = cash + cap;
      binding = 'CAP';
    } else {
      maxDep = cash / (1 - r);
      binding = 'CASH_RATIO';
    }
    const depMax = typeof p.eligibility.deposit_max === 'number' ? p.eligibility.deposit_max : undefined;
    if (depMax !== undefined && maxDep > depMax) {
      maxDep = depMax;
      binding = 'DEPOSIT_MAX';
    }
    maxDep = Math.floor(maxDep / 1e6) * 1e6;
    out.push({
      product: p.shortName,
      maxDeposit: reasons.length ? 0 : maxDep,
      loan: reasons.length ? 0 : Math.min(maxDep * r, cap),
      binding,
      rate: p.rate,
      rejectReasons: reasons,
    });
  }
  return out.sort((a, b) => b.maxDeposit - a.maxDeposit || a.rate.min - b.rate.min);
}

/* ─────────────────────── 후보판에 없는 집 찾기 ─────────────────────── */

export interface DiscoverOptions {
  mode: BoardMode;
  borrower: Borrower;
  /** 보증금에 넣을 수 있는 내 돈 */
  cash: number;
  /** 월 주거비 한도 — 월세 + 대출 이자 */
  monthlyMax: number;
  /** 이미 후보판에 있는 줄 */
  exclude: Set<string>;
  regionCodes?: string[];
  minArea?: number;
  minBuildYear?: number;
}

export interface Discovered<T> {
  row: T;
  /** 가장 적게 드는 내 돈 */
  own: number;
  /** 그때 매달 나가는 돈 (월세 + 대출 최저 이자) */
  monthlyOut: number;
  /** 어떤 대출로 */
  loan: BoardLoan | null;
}

function cheapestWay(deposit: number, rent: number, loans: BoardLoan[]) {
  // 대출 없이 전부 내 돈으로 가는 길도 후보입니다.
  let best = { own: deposit, monthlyOut: rent, loan: null as BoardLoan | null };
  for (const l of loans) {
    if (l.own < best.own || (l.own === best.own && rent + l.i0 < best.monthlyOut)) {
      best = { own: l.own, monthlyOut: rent + l.i0, loan: l };
    }
  }
  return best;
}

/**
 * 내 돈과 월 한도로 **실제로 들어갈 수 있는** 집만 — 창원 5개 구 + 함안·의령 전체에서.
 *
 * 후보판은 이미 좁힌 목록을 비교하는 곳이고, 여기는 그 밖에서 새 후보를 찾는
 * 곳입니다. 그래서 후보판에 있는 줄은 뺍니다.
 */
export function discover(o: DiscoverOptions): Discovered<JeonseBoardRow | WolseBoardRow>[] {
  const out: Discovered<JeonseBoardRow | WolseBoardRow>[] = [];
  const minArea = o.minArea ?? BOARD_MIN_AREA;
  for (const c of COMPLEXES) {
    if (o.regionCodes?.length && !o.regionCodes.includes(c.regionCode)) continue;
    if (o.minBuildYear && c.buildYear && c.buildYear < o.minBuildYear) continue;
    for (const s of c.sizes) {
      if (s.area < minArea) continue;
      if (monthsBetween(s.lastYm, LATEST_YM) > BOARD_FRESH_MONTHS) continue;
      if (o.exclude.has(`${c.id}_${s.area}`)) continue;
      if (o.mode === 'jeonse') {
        if (!s.jeonse || s.jeonse.n < 2) continue;
        const row = jeonseBoardRow(c, s, o.borrower);
        if (!row || !row.est) continue;
        const w = cheapestWay(row.est, 0, row.loans);
        if (w.own > o.cash || w.monthlyOut > o.monthlyMax) continue;
        out.push({ row, ...w });
      } else {
        if (!s.wolse || s.wolse.n < 3) continue;
        const row = wolseBoardRow(c, s, o.borrower);
        if (!row) continue;
        const w = cheapestWay(row.dep, row.rent, row.loans);
        if (w.own > o.cash || w.monthlyOut > o.monthlyMax) continue;
        out.push({ row, ...w });
      }
    }
  }
  return out;
}

/** 저장된 id(`단지id_면적`) 로 후보판 줄을 다시 만듭니다 — 담은 집은 id 만 저장합니다 */
export function boardRowById(mode: BoardMode, id: string, b: Borrower): JeonseBoardRow | WolseBoardRow | null {
  const cut = id.lastIndexOf('_');
  const cx = id.slice(0, cut);
  const area = Number(id.slice(cut + 1));
  const c = COMPLEXES.find((x) => x.id === cx);
  const s = c?.sizes.find((x) => x.area === area);
  if (!c || !s) return null;
  return mode === 'jeonse' ? jeonseBoardRow(c, s, b) : wolseBoardRow(c, s, b);
}

export const BOARD_ASOF_YEAR = ASOF_YEAR;
