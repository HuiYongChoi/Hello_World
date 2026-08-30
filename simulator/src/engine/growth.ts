/**
 * 지역 집값 상승률 **실측** — 실거래 스냅샷에서 뽑는 연쇄 지수.
 *
 * `priceGrowthRate` 는 이 도구에서 가장 결론을 많이 흔드는 가정값인데, 지금까지
 * 근거 없는 숫자였습니다. 매수·청약 갈래만 여기에 노출되므로 이 하나로 3-way 의
 * 승자가 바뀝니다.
 *
 * ## 왜 가격 수준을 평균하면 안 되나
 *
 * 분기마다 **거래된 단지가 다릅니다.** 이번 분기에 비싼 단지가 많이 팔리면
 * 지역 평균이 오르는데, 그건 값이 오른 게 아니라 구성이 바뀐 것입니다.
 *
 * 그래서 수준이 아니라 **변화율을 이어 붙입니다.**
 *
 * ```
 * 분기마다: 직전 분기와 이번 분기에 둘 다 거래가 있는 단지·평형만 모아
 *           그들의 가격비 중위값을 낸다
 * 지수(q) = 지수(q−1) × 중위 가격비
 * ```
 *
 * 같은 칸(단지·평형)끼리만 비교하므로 구성 변화가 들어오지 않습니다. 전월세에서
 * 전세가율을 낼 때 `aptSeq` 로 같은 단지끼리 짝지은 것과 같은 이유입니다.
 *
 * ## 이것은 예측이 아닙니다
 *
 * 과거 실측 CAGR 은 **그 구간에 그랬다**는 사실일 뿐입니다. 스냅샷이 2016년부터라
 * 그 안에 한 번의 큰 상승과 한 번의 조정이 들어 있고, 구간을 어디서 끊느냐로
 * 값이 크게 달라집니다. 그래서 단일 CAGR 과 함께 **모든 진입시점의 분포**를
 * 같이 냅니다 — 하위 25% 와 최악값을 봐야 "운이 나빴을 때" 를 감당할 수 있는지
 * 판단할 수 있습니다.
 */

import { MARKET, holdingDistribution, yearsBetween, type HoldingDistribution, type MarketPoint } from './market';
import type { RegionId } from './types';

/** 이보다 적은 칸으로 이은 분기는 중위 변화율이 한두 채에 흔들립니다. */
export const MIN_LINKED_PAIRS = 8;

/** 한 분기 거래가 이보다 적은 칸은 연결에 쓰지 않습니다 — 개별 물건 한 채 가격입니다. */
const MIN_DEALS = 2;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

/** 지수 범위 — 한 권역이거나, 수집 지역 전체(시장 공통요인)입니다. */
export type IndexScope = RegionId | 'all';

export interface GrowthIndex {
  scope: IndexScope;
  /** 연쇄 지수 — 시작 분기를 1로 둡니다 */
  points: MarketPoint[];
  /** 각 분기를 이을 때 쓴 칸 수 */
  linkCounts: number[];
  years: number;
  /** 전체 구간 복리 연환산 */
  cagr: number;
  /** 지수에 기여한 단지·평형 칸 수 */
  cells: number;
  /** 연결 표본이 얇아 이어 붙인 분기가 있는가 */
  thin: boolean;
}

const cache = new Map<IndexScope, GrowthIndex | null>();

/**
 * 연쇄 가격지수.
 *
 * 스냅샷 전체를 훑으므로 한 번만 계산하고 캐시합니다 — 화면이 매 렌더마다
 * 40만 건을 다시 접으면 안 됩니다.
 */
function chainedIndex(scope: IndexScope): GrowthIndex | null {
  if (cache.has(scope)) return cache.get(scope)!;

  // 분기 → (칸 키 → 가격). 같은 칸끼리만 이어야 구성 변화가 안 들어옵니다.
  const byQuarter = new Map<number, Map<string, number>>();
  let cells = 0;

  for (const c of MARKET.complexes) {
    if (scope !== 'all' && c.region !== scope) continue;
    for (const s of c.sizes) {
      const key = `${c.id}|${s.area}`;
      let contributed = false;
      for (const p of s.points) {
        if (p.n < MIN_DEALS || p.price <= 0) continue;
        let m = byQuarter.get(p.q);
        if (!m) byQuarter.set(p.q, (m = new Map()));
        m.set(key, p.price);
        contributed = true;
      }
      if (contributed) cells++;
    }
  }

  const quarters = [...byQuarter.keys()].sort((a, b) => a - b);
  if (quarters.length < 8) {
    cache.set(scope, null);
    return null;
  }

  const points: MarketPoint[] = [];
  const linkCounts: number[] = [];
  let level = 1;
  let thin = false;

  for (let i = 0; i < quarters.length; i++) {
    const q = quarters[i];
    if (i === 0) {
      points.push({ q, n: byQuarter.get(q)!.size, price: level });
      linkCounts.push(byQuarter.get(q)!.size);
      continue;
    }
    const prev = byQuarter.get(quarters[i - 1])!;
    const cur = byQuarter.get(q)!;
    const ratios: number[] = [];
    for (const [key, price] of cur) {
      const before = prev.get(key);
      if (before && before > 0) ratios.push(price / before);
    }
    /*
     * 이을 칸이 모자라면 **지수를 옆으로 미는 것이 아니라** 직전 수준을 그대로
     * 들고 갑니다. 없는 변화를 0% 로 채우는 셈이라 CAGR 이 희석되지만,
     * 한두 채의 가격비를 그 분기 전체의 변화로 삼는 것보다 낫습니다.
     */
    if (ratios.length >= MIN_LINKED_PAIRS) {
      level *= median(ratios);
    } else {
      thin = true;
    }
    points.push({ q, n: cur.size, price: level });
    linkCounts.push(ratios.length);
  }

  const first = points[0];
  const last = points[points.length - 1];
  const years = yearsBetween(first.q, last.q);
  const result: GrowthIndex = {
    scope,
    points,
    linkCounts,
    years,
    cagr: years >= 1 ? Math.pow(last.price / first.price, 1 / years) - 1 : 0,
    cells,
    thin,
  };
  cache.set(scope, result);
  return result;
}

/** 권역 연쇄 가격지수. */
export function regionGrowthIndex(region: RegionId): GrowthIndex | null {
  return chainedIndex(region);
}

/**
 * **시장 공통요인 지수** — 수집 3권역을 한 번에 이은 지수.
 *
 * 롤링 백테스트에서 초과수익의 기준선으로 씁니다. 지역 수익률은 전국 금리·
 * 유동성에 함께 끌려다녀 서로 독립이 아니라, 절대 수익률로 상위를 뽑으면
 * "많이 오른 시기에 들어갔다" 가 1등 공통점으로 나옵니다 — 발견이 아니라
 * 동어반복입니다.
 *
 * **전국 지수가 아닙니다.** 창원·부산·경기 수집분을 합친 것뿐이라, 이 셋이
 * 함께 움직인 부분까지만 걷어 냅니다.
 */
export function marketGrowthIndex(): GrowthIndex | null {
  return chainedIndex('all');
}

/**
 * 보유기간별 진입시점 분포.
 *
 * 단일 CAGR 하나만 내면 "언제 들어갔느냐" 가 감춰집니다. 지수 위의 모든
 * 진입시점에서 같은 기간을 들고 있었을 때의 결과를 전부 냅니다.
 */
export function regionGrowthDistribution(
  region: RegionId,
  holdYears: number
): HoldingDistribution | null {
  const idx = regionGrowthIndex(region);
  if (!idx) return null;
  return holdingDistribution(idx.points, holdYears);
}

export interface GrowthSuggestion {
  cagr: number;
  years: number;
  from: number;
  to: number;
  cells: number;
  thin: boolean;
  /** 비교 기간과 같은 보유기간의 분포 — 단일값 옆에 반드시 같이 놓습니다 */
  distribution: HoldingDistribution | null;
}

/**
 * 화면에 붙일 실측 제안값.
 *
 * **기본값으로 몰래 넣지 않습니다.** 과거 CAGR 을 미래 가정으로 자동 대입하면
 * 도구가 "이만큼 오릅니다" 라고 말하는 것이 됩니다. 옆에 놓고 사용자가
 * 가져다 쓰게 합니다.
 */
export function growthSuggestion(region: RegionId, holdYears: number): GrowthSuggestion | null {
  const idx = regionGrowthIndex(region);
  if (!idx) return null;
  return {
    cagr: idx.cagr,
    years: idx.years,
    from: idx.points[0].q,
    to: idx.points[idx.points.length - 1].q,
    cells: idx.cells,
    thin: idx.thin,
    distribution: regionGrowthDistribution(region, holdYears),
  };
}
