/**
 * 장기수선충당금 실측 — `maintenanceRate` 가정값 옆에 놓는 앵커.
 *
 * 수선유지비는 **매수·청약 갈래만 부담**하므로 결론을 직접 흔듭니다.
 * 기본값 0.5% 는 통상값일 뿐 근거가 없었습니다.
 *
 * ## 이 값은 수선유지비의 전부가 아닙니다 — 하한입니다
 *
 * 장기수선충당금은 **공용부 대규모 수선**(외벽·승강기·배관 교체) 적립금입니다.
 * 세대 내부 수선(도배·싱크대·보일러)은 소유자가 따로 냅니다. 그래서 이걸
 * 그대로 `maintenanceRate` 에 넣으면 매수 갈래가 부당하게 유리해집니다.
 *
 * **그래서 기본값을 덮어쓰지 않습니다.** 실측 하한을 옆에 놓고, 가정한 0.5%
 * 가 그 하한의 몇 배인지 보여줍니다. 나머지가 정말 그만큼인지는 사람이
 * 판단할 몫입니다. 집값 상승률을 실측 CAGR 로 몰래 대입하지 않은 것과
 * 같은 이유입니다.
 *
 * ## 왜 원/㎡ 인가
 *
 * 원 자료는 **단지 전체** 월 부과액입니다. 세대수로 나누면 세대 크기가
 * 섞이고(84㎡ 단지와 59㎡ 단지가 뒤죽박죽), 주택가격으로 나누려면 단지별
 * 시세를 또 붙여야 합니다. 총 전용면적으로 나눈 원/㎡/월 이 가장 안정적이고,
 * 물건의 ㎡당 가격으로 나누면 곧바로 비율이 됩니다.
 */

import data from '../data/repair.json';
import { MARKET } from './market';
import type { RegionId } from './types';

export interface RepairStat {
  n: number;
  /** 원/㎡/월 */
  median: number;
  p25: number;
  p75: number;
}

interface RepairData {
  note: string;
  source: string;
  unit: string;
  searchDate: string;
  asOf: string;
  stats: { complexes: number; districts: number; failed: number };
  overall: RepairStat;
  byRegion: Record<string, RepairStat>;
  byDistrict: Record<string, RepairStat & { label: string; region: string }>;
}

export const REPAIR = data as unknown as RepairData;

/** 시군구가 있으면 그걸, 없으면 권역값을 씁니다 — 신축 하한과 같은 방식입니다. */
export function repairStat(region: RegionId, sigungu?: string): RepairStat | null {
  if (sigungu?.trim()) {
    const t = sigungu.replace(/\s+/g, '');
    const hit = Object.values(REPAIR.byDistrict).find((d) => {
      const l = d.label.replace(/\s+/g, '');
      return l === t || l.includes(t) || t.includes(l);
    });
    if (hit) return hit;
  }
  return REPAIR.byRegion[region] ?? null;
}

/** 이보다 표본이 적으면 중위값이 한두 단지에 흔들립니다. */
export const REPAIR_MIN_SAMPLE = 8;

export interface RepairAnchor {
  stat: RepairStat;
  /** 이 물건의 ㎡당 가격 (원) */
  pricePerSqm: number;
  /** 실측이 시사하는 연 비율 — 하한입니다 */
  measuredRate: number;
  /** 사분위로 낸 범위 */
  lowRate: number;
  highRate: number;
  /** 가정값이 실측 하한의 몇 배인가 */
  ratioToAssumed: number;
  thin: boolean;
  scope: string;
}

/**
 * 물건 가격 기준으로 연 비율을 냅니다.
 *
 * `원/㎡/월 × 12 ÷ ㎡당 가격` 입니다. 같은 단지라도 비싼 평형일수록 비율이
 * 낮아집니다 — 충당금은 면적당인데 가격은 면적당이 아니기 때문입니다.
 */
export function repairAnchor(
  region: RegionId,
  sigungu: string | undefined,
  price: number,
  areaSqm: number,
  assumedRate: number
): RepairAnchor | null {
  const stat = repairStat(region, sigungu);
  if (!stat || !(price > 0) || !(areaSqm > 0)) return null;

  const pricePerSqm = price / areaSqm;
  const toRate = (perM2Month: number) => (perM2Month * 12) / pricePerSqm;
  const measuredRate = toRate(stat.median);

  return {
    stat,
    pricePerSqm,
    measuredRate,
    lowRate: toRate(stat.p25),
    highRate: toRate(stat.p75),
    ratioToAssumed: measuredRate > 0 ? assumedRate / measuredRate : 0,
    thin: stat.n < REPAIR_MIN_SAMPLE,
    scope: sigungu?.trim() && repairStat(region, sigungu) !== REPAIR.byRegion[region] ? '시군구' : '권역',
  };
}

/** 지역 ㎡당 중위 매매가 — 물건을 안 고른 화면에서 대략을 보일 때 씁니다. */
export function medianPricePerSqm(region: RegionId): number | null {
  const vs: number[] = [];
  for (const c of MARKET.complexes) {
    if (c.region !== region) continue;
    for (const s of c.sizes) {
      const last = s.points[s.points.length - 1];
      if (last && last.price > 0 && s.area > 0) vs.push(last.price / s.area);
    }
  }
  if (vs.length < 10) return null;
  vs.sort((a, b) => a - b);
  return vs[Math.floor(vs.length / 2)];
}

export const REPAIR_CAVEATS = [
  '장기수선충당금만입니다 — 공용부 대규모 수선(외벽·승강기·배관) 적립금이고, 세대 내부 수선(도배·싱크대·보일러)은 빠져 있습니다.',
  '그래서 이 값은 수선유지비의 하한입니다. 가정값을 이 숫자로 낮추면 매수 갈래가 부당하게 유리해집니다.',
  '한국 아파트의 장기수선충당금은 실제 필요액보다 적게 걷는다는 지적이 오래 있었습니다 — 하한의 하한일 수 있습니다.',
  '단지 전체 부과액을 총 전용면적으로 나눈 값이라, 같은 단지에서도 비싼 평형일수록 가격 대비 비율은 낮아집니다.',
];
