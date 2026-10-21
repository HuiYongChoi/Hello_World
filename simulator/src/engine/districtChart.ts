/**
 * 구별 매매 차트 — 수집 15개 시군구의 매매를 **분기 시계열**로 폅니다.
 *
 * 시장 온도는 "최근 4분기 대 그 앞 4분기" 한 칸만 보여 줍니다. 그 숫자가 긴 흐름의
 * 어디쯤인지 — 고점 뒤 조정 중인지, 바닥에서 막 오르는지 — 는 시계열로만 보입니다.
 *
 * ```
 * ㎡당 중위가   분기마다 칸(단지·평형) 분기 중위가 ÷ 전용면적 을 거래 건수로 가중한 중위
 * 연쇄 지수     같은 칸끼리 직전 분기 대비 가격비의 중위를 곱해 이은 값 (growth.ts, 시작 = 100)
 * 거래량        그 분기 거래 건수 합
 * 이동평균      직전 4분기(이번 분기 포함) 단순 평균 — 넷 중 하나라도 비면 내지 않음
 * ```
 *
 * **두 지표는 서로 다른 거짓말을 합니다.** ㎡당 중위가는 그 분기에 팔린 집의 구성이
 * 섞이고(신축이 많이 팔린 분기는 오른 것처럼 보임), 연쇄 지수는 구성을 막는 대신
 * 곱셈을 이어 가며 위로 치우칩니다(연쇄 드리프트). 그래서 둘을 합치지 않고 고르게
 * 합니다 — 같은 방향이면 믿을 만하고, 갈리면 구성 변화를 의심합니다.
 *
 * **마지막 완결 분기까지만 씁니다.** 신고 지연으로 진행 중인 분기는 늘 적게 잡혀
 * 거래량이 꺾인 것처럼 보입니다 (`temperature.ts` 와 같은 규칙).
 *
 * 이 파일은 React 를 모릅니다. 확대·이동·기간 창 계산도 여기서 끝냅니다.
 */

import { districtGrowthIndex, buildChainedIndex, MIN_LINKED_PAIRS, type GrowthIndex } from './growth';
import { MARKET, type MarketComplex } from './market';
import { SALE_AS_OF_Q, qLabel, weightedMedian } from './temperature';

/** 얇은 표본 기준 — 한 곳에 모아 테스트로 고정합니다. */
export const DISTRICT_CHART_MIN = {
  /** 한 분기 거래가 이보다 적으면 ㎡당 중위가를 "표본 얇음" 으로 표시합니다 */
  deals: 100,
  /** 연쇄 지수를 이을 때 쓴 칸이 이보다 적으면 "표본 얇음". 8개 미만이면 지수가 아예 옆으로 갑니다 */
  links: 20,
} as const;

/** 이동평균 창 — 분기 4개 = 1년. 계절성(봄·가을 이사철)을 지웁니다 */
export const MA_QUARTERS = 4;

/** 한 번에 겹쳐 볼 수 있는 구 수 — 그 이상은 선이 엉켜 못 읽습니다 */
export const MAX_DISTRICTS = 6;

/** 확대해도 이보다 좁게는 안 갑니다 — 분기 4개면 선이 아니라 점입니다 */
export const MIN_WINDOW = 4;

export type ChartMetric = 'perSqm' | 'index';
export type ChartPeriod = '2y' | '3y' | '5y' | 'all';

export const CHART_PERIODS: { key: ChartPeriod; label: string; quarters: number | null }[] = [
  { key: '2y', label: '2년', quarters: 8 },
  { key: '3y', label: '3년', quarters: 12 },
  { key: '5y', label: '5년', quarters: 20 },
  { key: 'all', label: '전체', quarters: null },
];

export interface DistrictQuarter {
  q: number;
  label: string;
  /** 그 분기 거래 건수 합 */
  deals: number;
  /** ㎡당 중위가 (원) — 거래가 없으면 null */
  perSqm: number | null;
  /** 연쇄 지수 (시작 분기 = 100) */
  index: number | null;
  /** 지수를 이을 때 쓴 칸 수 (첫 분기는 null) */
  links: number | null;
  thinPerSqm: boolean;
  thinIndex: boolean;
}

export interface DistrictSeries {
  code: string;
  label: string;
  /** 칩·범례용 짧은 이름 — `성산구`, `해운대구`, `동탄구` */
  short: string;
  /** 권역 이름 — 창원 · 부산 · 경기 */
  group: string;
  quarters: DistrictQuarter[];
}

const GROUP: Record<string, string> = { changwon: '창원', busan: '부산', gyeonggi: '경기' };

/** `창원시 성산구` → `성산구`, `경기 화성시 동탄구` → `동탄구`, `경기 평택시` → `평택시` */
export function shortDistrictLabel(label: string): string {
  const parts = label.split(' ').filter(Boolean);
  return parts[parts.length - 1] ?? label;
}

export interface DistrictOption {
  code: string;
  label: string;
  short: string;
  group: string;
}

/** 차트에 올릴 수 있는 구 — 매매 스냅샷의 수집 시군구 그대로 */
export const DISTRICT_OPTIONS: DistrictOption[] = MARKET.regions.map((r) => ({
  code: r.code,
  label: r.label,
  short: shortDistrictLabel(r.label),
  group: GROUP[r.region] ?? r.region,
}));

export const hasDistrictChart = (code: string) => DISTRICT_OPTIONS.some((d) => d.code === code);

/**
 * 단지 목록 하나를 분기 시계열로 접습니다 — 캐시 없는 순수 함수.
 *
 * `index` 는 넘겨받은 연쇄 지수를 쓰고, 없으면 같은 단지 목록으로 새로 잇습니다.
 * 축은 첫 거래 분기부터 `asOfQ` 까지 빈칸 없이 깔립니다 — 거래가 없는 분기는 null 입니다.
 */
export function buildDistrictQuarters(
  complexes: MarketComplex[],
  opts: { asOfQ: number; baseYear: number; index?: GrowthIndex | null }
): DistrictQuarter[] {
  const cells = new Map<number, { n: number; v: number }[]>();
  const deals = new Map<number, number>();
  for (const c of complexes) {
    for (const s of c.sizes) {
      if (s.area <= 0) continue;
      for (const p of s.points) {
        if (p.q > opts.asOfQ || p.n <= 0 || p.price <= 0) continue;
        deals.set(p.q, (deals.get(p.q) ?? 0) + p.n);
        let list = cells.get(p.q);
        if (!list) cells.set(p.q, (list = []));
        list.push({ n: p.n, v: p.price / s.area });
      }
    }
  }
  if (deals.size === 0) return [];

  const idx = opts.index === undefined ? buildChainedIndex(complexes, 'all') : opts.index;
  const level = new Map<number, { v: number; links: number }>();
  if (idx) {
    const base = idx.points[0]?.price ?? 1;
    idx.points.forEach((p, i) => level.set(p.q, { v: (p.price / base) * 100, links: idx.linkCounts[i] }));
  }
  const firstIndexQ = idx?.points[0]?.q;

  const firstQ = Math.min(...deals.keys());
  const out: DistrictQuarter[] = [];
  for (let q = firstQ; q <= opts.asOfQ; q++) {
    const n = deals.get(q) ?? 0;
    const wm = weightedMedian(cells.get(q) ?? []);
    const lv = level.get(q);
    const links = lv && q !== firstIndexQ ? lv.links : null;
    out.push({
      q,
      label: qLabel(q, opts.baseYear),
      deals: n,
      perSqm: wm ? wm.v : null,
      index: lv ? lv.v : null,
      links,
      thinPerSqm: wm != null && n < DISTRICT_CHART_MIN.deals,
      thinIndex: links != null && links < DISTRICT_CHART_MIN.links,
    });
  }
  return out;
}

const seriesCache = new Map<string, DistrictSeries | null>();

/** 수집 시군구 하나의 시계열 — 스냅샷을 훑으므로 한 번만 계산합니다 */
export function districtSeries(code: string): DistrictSeries | null {
  if (seriesCache.has(code)) return seriesCache.get(code)!;
  const opt = DISTRICT_OPTIONS.find((d) => d.code === code);
  let result: DistrictSeries | null = null;
  if (opt) {
    const quarters = buildDistrictQuarters(
      MARKET.complexes.filter((c) => c.regionCode === code),
      { asOfQ: SALE_AS_OF_Q, baseYear: MARKET.quarterBaseYear, index: districtGrowthIndex(code) }
    );
    if (quarters.length) result = { ...opt, quarters };
  }
  seriesCache.set(code, result);
  return result;
}

/* ── 보조 계산 ─────────────────────────────────────────────────────── */

/** 직전 `w` 개(자기 포함) 단순 평균. 창 안에 빈 값이 하나라도 있으면 null */
export function movingAverage(values: (number | null)[], w = MA_QUARTERS): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < w) return null;
    let sum = 0;
    for (let k = i - w + 1; k <= i; k++) {
      const v = values[k];
      if (v == null) return null;
      sum += v;
    }
    return sum / w;
  });
}

/** 기간 버튼 → 보이는 창 `[시작 인덱스, 끝 인덱스]` (양 끝 포함). 끝은 늘 마지막 분기 */
export function periodWindow(period: ChartPeriod, total: number): [number, number] {
  const def = CHART_PERIODS.find((p) => p.key === period);
  const len = def?.quarters ?? total;
  const end = total - 1;
  return [Math.max(0, end - Math.max(len, MIN_WINDOW) + 1), end];
}

/** 창 안을 확대(factor < 1)·축소(factor > 1). `focus` 분기가 화면의 같은 자리에 머뭅니다 */
export function zoomWindow(
  win: [number, number],
  focus: number,
  factor: number,
  total: number
): [number, number] {
  const [s, e] = win;
  const len = e - s + 1;
  const next = Math.min(total, Math.max(Math.min(MIN_WINDOW, total), Math.round(len * factor)));
  if (next === len) return win;
  const ratio = len > 1 ? (focus - s) / (len - 1) : 0.5;
  let ns = Math.round(focus - ratio * (next - 1));
  ns = Math.max(0, Math.min(total - next, ns));
  return [ns, ns + next - 1];
}

/** 창을 `delta` 분기만큼 옆으로 — 양 끝에서 멈춥니다 */
export function panWindow(win: [number, number], delta: number, total: number): [number, number] {
  const len = win[1] - win[0] + 1;
  const s = Math.max(0, Math.min(total - len, win[0] + Math.round(delta)));
  return [s, s + len - 1];
}

/** 보이는 창 안의 시작 → 끝 변화. 연 환산은 1년 이상일 때만 */
export interface WindowChange {
  from: { label: string; v: number };
  to: { label: string; v: number };
  change: number;
  years: number;
  cagr: number | null;
}

export function windowChange(quarters: DistrictQuarter[], metric: ChartMetric, win: [number, number]): WindowChange | null {
  const slice = quarters.slice(win[0], win[1] + 1).filter((p) => p[metric] != null);
  if (slice.length < 2) return null;
  const a = slice[0];
  const b = slice[slice.length - 1];
  const va = a[metric]!;
  const vb = b[metric]!;
  const years = (b.q - a.q) / 4;
  return {
    from: { label: a.label, v: va },
    to: { label: b.label, v: vb },
    change: vb / va - 1,
    years,
    cagr: years >= 1 ? Math.pow(vb / va, 1 / years) - 1 : null,
  };
}

/* ── 차트 행 ───────────────────────────────────────────────────────── */

/**
 * recharts 에 바로 넘기는 행. 구 코드마다 `v_코드`(값) · `ma_코드`(이동평균) ·
 * `n_코드`(거래 건수) · `thin_코드`(표본 얇음) · `raw_코드`(정규화 전 값) 를 답니다.
 */
export type ChartRow = { q: number; label: string } & Record<string, number | string | boolean | null>;

export interface ChartRowsOptions {
  metric: ChartMetric;
  /** 보이는 창 — 정규화 기준이 창의 첫 분기입니다 */
  window: [number, number];
  /** 시작 = 100 정규화 */
  normalize: boolean;
}

/**
 * 여러 구를 같은 분기 축에 놓고 창만큼 자릅니다.
 *
 * **이동평균은 자르기 전에 잽니다** — 창 첫 분기의 이동평균이 창 밖 세 분기를
 * 써야 맞습니다. 정규화하면 값과 이동평균을 같은 기준(창 안 첫 값)으로 나눕니다.
 */
export function chartRows(list: DistrictSeries[], opts: ChartRowsOptions): ChartRow[] {
  if (!list.length) return [];
  const firstQ = Math.min(...list.map((s) => s.quarters[0].q));
  const lastQ = Math.max(...list.map((s) => s.quarters[s.quarters.length - 1].q));
  const total = lastQ - firstQ + 1;
  const [ws, we] = [Math.max(0, opts.window[0]), Math.min(total - 1, opts.window[1])];

  const rows: ChartRow[] = [];
  for (let i = ws; i <= we; i++) {
    const q = firstQ + i;
    rows.push({ q, label: qLabel(q, MARKET.quarterBaseYear) });
  }

  for (const s of list) {
    const byQ = new Map(s.quarters.map((p) => [p.q, p]));
    const full: (number | null)[] = [];
    for (let q = firstQ; q <= lastQ; q++) full.push(byQ.get(q)?.[opts.metric] ?? null);
    const ma = movingAverage(full);
    let base = 1;
    if (opts.normalize) {
      const first = full.slice(ws, we + 1).find((v) => v != null);
      base = first ? first / 100 : 1;
    }
    rows.forEach((row) => {
      const i = row.q - firstQ;
      const p = byQ.get(row.q);
      const v = full[i];
      row[`v_${s.code}`] = v == null ? null : v / base;
      row[`raw_${s.code}`] = v;
      row[`ma_${s.code}`] = ma[i] == null ? null : ma[i]! / base;
      row[`n_${s.code}`] = p?.deals ?? 0;
      row[`thin_${s.code}`] = p ? (opts.metric === 'perSqm' ? p.thinPerSqm : p.thinIndex) : false;
      row[`links_${s.code}`] = p?.links ?? null;
    });
  }
  return rows;
}

/** 여러 구를 겹칠 때의 전체 분기 수 — 창 계산의 `total` */
export function axisLength(list: DistrictSeries[]): number {
  if (!list.length) return 0;
  const firstQ = Math.min(...list.map((s) => s.quarters[0].q));
  const lastQ = Math.max(...list.map((s) => s.quarters[s.quarters.length - 1].q));
  return lastQ - firstQ + 1;
}

/** 이 차트가 못 하는 것 — 화면 하단에 늘 붙습니다 */
export const DISTRICT_CHART_CAVEATS = [
  '㎡당 중위가는 그 분기에 팔린 집의 구성이 섞입니다 — 신축·대단지가 많이 팔린 분기는 값이 오르지 않아도 올라 보입니다. 층·향·수리 상태도 섞입니다.',
  `연쇄 지수는 구성을 막는 대신 위로 치우칩니다(연쇄 드리프트). 분기마다 가격비 중위를 곱해 이어서, 5년 보유 기준 시장지수 중위가 표본 중위보다 2~4%p 높게 나옵니다. 지수의 연 환산을 기대수익률로 쓰지 마세요 — 매수 · 전세 · 월세 탭의 제안값은 표본 중위입니다.`,
  `이을 칸이 ${MIN_LINKED_PAIRS}개 미만인 분기는 지수가 직전 수준을 그대로 들고 갑니다(0% 로 채움). 속이 빈 점이 표본 얇은 분기입니다.`,
  '마지막 완결 분기까지만 그립니다. 실거래는 체결 뒤 30일 안에 신고해 진행 중인 분기는 늘 적게 잡힙니다.',
  '체결된 실거래만 봅니다 — 호가·매물·미분양은 없습니다. 명목 가격이라 물가를 빼지 않았습니다.',
  '구가 다르면 집의 평균 연식·크기가 달라 ㎡당 가격 수준을 그대로 견주면 동네가 아니라 재고를 비교하게 됩니다. 겹쳐 볼 때는 시작 = 100 으로 흐름만 견주세요.',
];
