/**
 * 향후 입주 물량 **대리지표** — 분양권 스냅샷에서 뽑습니다.
 *
 * 입지 점수의 `futureSupply` 는 지금까지 순수 주관 입력이었습니다. 창원 가중치가
 * 9로 가장 높은 항목인데 근거가 없었습니다.
 *
 * ## 어떻게 재나
 *
 * 분양권이 거래된다는 것은 **아직 준공 전**이라는 뜻입니다. 준공되면 매매로
 * 넘어갑니다. 그래서 이렇게 가릅니다.
 *
 * ```
 * 분양권 거래는 있는데 매매 거래가 없는 단지 = 아직 안 지어진 단지 = 앞으로 들어올 물량
 * 분양권도 매매도 있는 단지                  = 준공됐거나 준공 임박
 * ```
 *
 * ## 이 지표가 못 하는 것 — 반드시 같이 읽어야 합니다
 *
 * 1. **세대수가 아니라 단지 수입니다.** 국토부 실거래 자료에 세대수가 없습니다.
 *    300세대 단지와 1,500세대 단지가 똑같이 1로 셉니다.
 * 2. **전매제한 단지는 아예 안 보입니다.** 전매가 금지된 동안에는 분양권 거래가
 *    발생하지 않으므로 자료에 잡히지 않습니다. 규제지역일수록, 최근 분양일수록
 *    더 안 보입니다 — 그래서 이 값은 언제나 **하한**입니다.
 * 3. **입주 시기를 모릅니다.** "향후 3년" 을 가릴 수 없어 "아직 안 지어짐" 까지만
 *    말합니다.
 *
 * 그래서 이 값은 주관 입력을 **대체하지 않습니다.** 옆에 놓고 내 판단이 실측
 * 방향과 어긋나는지만 봅니다.
 */

import { MARKET } from './market';
import { PRESALE } from './presale';
import { DISTRICTS } from './regions';
import type { RegionId } from './types';

const norm = (s: string) => s.replace(/\s+/g, '');

/** 한 분기 거래가 이보다 적으면 개별 물건 한 채입니다. */
const MIN_DEALS = 1;

export interface SupplyOutlook {
  districtCode: string;
  districtLabel: string;
  region: RegionId;
  /** 분양권만 있고 매매가 없는 단지 — 아직 안 지어진 것으로 봅니다 */
  pending: number;
  /** 분양권 거래가 잡힌 전체 단지 */
  presaleComplexes: number;
  /** 그 시군구의 매매 단지 수 — 규모 대비로 봐야 합니다 */
  marketComplexes: number;
  /**
   * 기존 재고 대비 미준공 단지 비율.
   *
   * 절대 개수로 비교하면 큰 시군구가 항상 이깁니다. 재고로 나눠야
   * "이 동네에 새 물량이 상대적으로 얼마나 들어오나" 가 됩니다.
   */
  pendingRatio: number;
}

let cache: SupplyOutlook[] | null = null;

export function supplyOutlooks(): SupplyOutlook[] {
  if (cache) return cache;

  // 매매에 등장하는 단지 키 — 준공 판정에 씁니다.
  const built = new Set<string>();
  const marketByDistrict = new Map<string, number>();
  for (const c of MARKET.complexes) {
    built.add(`${norm(c.name)}|${c.umd}`);
    marketByDistrict.set(c.regionCode, (marketByDistrict.get(c.regionCode) ?? 0) + 1);
  }

  const presaleByDistrict = new Map<string, { total: number; pending: number }>();
  for (const c of PRESALE.complexes) {
    const traded = c.sizes.some((s) => s.points.some((p) => p.n >= MIN_DEALS));
    if (!traded) continue;
    let e = presaleByDistrict.get(c.regionCode);
    if (!e) presaleByDistrict.set(c.regionCode, (e = { total: 0, pending: 0 }));
    e.total++;
    if (!built.has(`${norm(c.name)}|${c.umd}`)) e.pending++;
  }

  cache = [...presaleByDistrict.entries()]
    .map(([code, e]) => {
      const d = DISTRICTS.find((x) => x.code === code);
      const marketComplexes = marketByDistrict.get(code) ?? 0;
      return {
        districtCode: code,
        districtLabel: d?.label ?? code,
        region: (d?.region ?? 'changwon') as RegionId,
        pending: e.pending,
        presaleComplexes: e.total,
        marketComplexes,
        pendingRatio: marketComplexes > 0 ? e.pending / marketComplexes : 0,
      };
    })
    .sort((a, b) => b.pendingRatio - a.pendingRatio);

  return cache;
}

export function supplyOutlookFor(sigungu: string): SupplyOutlook | null {
  if (!sigungu.trim()) return null;
  const t = norm(sigungu);
  return (
    supplyOutlooks().find(
      (o) => norm(o.districtLabel) === t || norm(o.districtLabel).includes(t) || t.includes(norm(o.districtLabel))
    ) ?? null
  );
}

/** 이보다 단지가 적으면 비율이 한두 건에 흔들립니다. */
export const SUPPLY_THIN = 20;

export interface SupplyFeedback {
  outlook: SupplyOutlook;
  /** 같은 지역군 안에서의 백분위 — 높을수록 새 물량이 많습니다 */
  percentile: number;
  /**
   * 실측이 시사하는 **0~100 정규화 점수**.
   *
   * 이 지표의 입력 단위는 세대 수인데 대리지표는 순위밖에 못 냅니다. 백분위를
   * 세대로 되돌리면 없는 숫자를 지어내는 것이라, 주관 입력과 실측을 둘 다
   * **점수로 바꿔** 같은 자에서 비교합니다.
   */
  suggestedScore: number;
  /** 같은 지역군 안에서 공급이 많은 순위 (1이 가장 많음) */
  rankBySupply: number;
  thin: boolean;
  peers: number;
}

/**
 * 주관 입력과 나란히 놓을 실측 신호.
 *
 * 점수 축은 "공급이 적을수록 고득점" 이므로 미준공 비율이 높을수록 낮은 점수를
 * 제안합니다. 같은 지역군 안에서의 상대 위치로 냅니다 — 창원과 경기의 절대
 * 개수를 비교하면 시군구 크기 차이가 그대로 들어옵니다.
 */
export function supplyFeedback(sigungu: string): SupplyFeedback | null {
  const outlook = supplyOutlookFor(sigungu);
  if (!outlook) return null;

  const peers = supplyOutlooks().filter((o) => o.region === outlook.region);
  if (peers.length < 2) return null;

  const sorted = [...peers].sort((a, b) => a.pendingRatio - b.pendingRatio);
  const rank = sorted.findIndex((o) => o.districtCode === outlook.districtCode);
  const percentile = rank / (sorted.length - 1);

  // 공급이 적을수록(백분위가 낮을수록) 높은 점수 — 지표 방향과 같습니다.
  const suggestedScore = Math.round((1 - percentile) * 100);

  return {
    outlook,
    percentile,
    suggestedScore,
    rankBySupply: peers.length - rank,
    thin: outlook.marketComplexes < SUPPLY_THIN,
    peers: peers.length,
  };
}

export const SUPPLY_CAVEATS = [
  '세대수가 아니라 단지 수입니다 — 국토부 실거래 자료에 세대수가 없습니다.',
  '전매제한 중인 단지는 분양권 거래가 없어 아예 안 잡힙니다. 언제나 하한입니다.',
  '입주 시기를 알 수 없어 "향후 3년" 이 아니라 "아직 안 지어짐" 까지만 말합니다.',
  '기존 재고로 나눈 상대값이고, 같은 지역군 안에서만 비교합니다.',
];
