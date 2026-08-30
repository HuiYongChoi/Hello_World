/**
 * 청약홈 공고 스냅샷 — **분양가·평형·일정을 손으로 넣지 않게 합니다.**
 *
 * 이 값들은 원래 단지 공고문에만 있어서 전부 손입력이었습니다. 청약홈
 * 분양정보·경쟁률 API 가 열리면서 목록에서 고르기만 하면 되도록 바뀌었습니다.
 * 스냅샷은 `scripts/fetch-applyhome.mjs` 가 빌드 타임에 굽습니다.
 *
 * ## 자동으로 안 채워지는 것이 있습니다
 *
 * ```
 * 자동  분양가 · 전용면적 · 세대수 · 모집공고일 · 당첨자발표 · 계약일 · 입주예정월
 * 손    중도금 이자후불 여부 · 중도금 금리 · 전매제한 개월
 * ```
 *
 * 아래 셋은 API 에 아예 없습니다 — 단지 공고문 본문에만 있습니다. 그래서
 * **불러온 뒤에도 납입 구조는 그대로 두고** 손입력 값을 덮어쓰지 않습니다.
 *
 * ## 경쟁률은 1순위 접수건수 ÷ 공급세대입니다
 *
 * 원자료의 `CMPET_RATE` 는 해당지역·기타지역으로 갈려 있어 한 숫자가 아니고,
 * 미달이면 `-` 로 옵니다. 그래서 접수건수를 1순위끼리 합해 직접 나눕니다.
 * **1 미만이 곧 1순위 미달**이고, 이건 0이 아니라 미달로 읽어야 합니다.
 *
 * ## 시군구를 못 뜯으면 비워 둡니다
 *
 * 공급위치가 `경기도 화성시 반월동` 처럼 **구 없이** 오는 공고가 있습니다.
 * 화성은 동탄·병점·만세·효행으로 갈렸으므로, 여기서 아무 구에나 붙이면
 * 안전마진 기준가가 통째로 다른 동네 것이 됩니다. 라벨이 정확히 맞을 때만
 * 시군구를 채우고, 아니면 비워 화면이 "권역 전체와 비교 중" 이라고
 * 경고하게 둡니다.
 */

import applyhomeSnapshot from '../data/applyhome-2026-08.json';
import { DISTRICTS, type DistrictEntry } from './regions';
import type { SubscriptionPlan } from './subscription';
import type { RegionId } from './types';

export interface OfferingModel {
  /** 주택형 표기 그대로 (`084.9800A`) */
  houseType: string;
  /** 전용면적 (㎡) — 주택형 앞자리입니다. 공급면적이 아닙니다 */
  areaSqm: number;
  /** 공급면적 (㎡) */
  supplyAreaSqm: number;
  /** 분양가 (원) */
  price: number;
  /** 일반공급 세대 */
  general: number;
  /** 특별공급 세대 합 */
  special: number;
  lifeFirst: number;
  newlywed: number;
  /** 1순위 접수건수 (해당+기타지역) */
  rank1Req: number;
  /** 1순위 공급세대 */
  rank1Supply: number;
  /** 1순위 경쟁률. 표본이 없으면 null, 1 미만이면 미달 */
  rank1Rate: number | null;
}

export interface OfferingNotice {
  /** 주택관리번호 */
  id: string;
  /** 공고번호 */
  no: string;
  name: string;
  region: RegionId;
  /** 주소에서 뜯은 시군구. 확신이 없으면 빈 문자열입니다 */
  sigungu: string;
  umd: string;
  address: string;
  /** 민영 / 국민 */
  kind: string;
  /** 분양주택 / 임대주택 */
  supplyKind: string;
  households: number;
  noticeDate: string;
  rank1Date: string;
  winnerDate: string;
  contractDate: string;
  /** `202909` */
  moveInYm: string;
  /** 계약일 → 입주예정월 개월 수. 못 재면 null */
  waitMonths: number | null;
  regulated: boolean;
  speculative: boolean;
  priceCapped: boolean;
  builder: string;
  models: OfferingModel[];
}

interface RawSnapshot {
  version: string;
  asOf: string;
  unit: string;
  unitNote: string;
  source: { name: string; endpoint: string; license: string; note: string };
  range: { from: string; to: string };
  areas: { code: string; region: string }[];
  modelFormat: string[];
  stats: {
    notices: number;
    models: number;
    withCompetition: number;
    perRegion: Record<string, number>;
  };
  notices: (Omit<OfferingNotice, 'models' | 'region'> & {
    region: string;
    models: (string | number)[][];
  })[];
}

const raw = applyhomeSnapshot as unknown as RawSnapshot;

function toModel(row: (string | number)[]): OfferingModel {
  const [ty, area, supplyArea, price, general, special, lifeFirst, newlywed, req, supply] =
    row;
  return {
    houseType: String(ty),
    areaSqm: Number(area),
    supplyAreaSqm: Number(supplyArea),
    // 스냅샷은 만원 단위입니다 — 다른 스냅샷과 같은 약속입니다.
    price: Number(price) * 10000,
    general: Number(general),
    special: Number(special),
    lifeFirst: Number(lifeFirst),
    newlywed: Number(newlywed),
    rank1Req: Number(req),
    rank1Supply: Number(supply),
    rank1Rate: Number(supply) > 0 ? Number(req) / Number(supply) : null,
  };
}

export const APPLYHOME = {
  version: raw.version,
  asOf: raw.asOf,
  source: raw.source,
  range: raw.range,
  stats: raw.stats,
};

export const NOTICES: OfferingNotice[] = raw.notices.map((n) => ({
  ...n,
  region: n.region as RegionId,
  models: n.models.map(toModel),
}));

/** 공고 원문 링크. 스냅샷에 담지 않고 번호로 되짚습니다. */
export function noticeUrl(n: OfferingNotice): string {
  return `https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancDetail.do?houseManageNo=${n.id}&pblancNo=${n.no}`;
}

const normalize = (s: string) =>
  (s ?? '').replace(/\s+/g, '').replace(/^(부산|경기|경남|서울|인천)/, '');

/**
 * 공고의 시군구를 수집 시군구에 붙입니다.
 *
 * `findDistrict` 의 부분일치를 쓰지 않습니다 — `화성시` 만 있는 주소가
 * `화성시 동탄구` 에 붙어 버리기 때문입니다. **정확히 같을 때만** 붙이고
 * 아니면 null 입니다.
 */
export function districtOf(notice: OfferingNotice): DistrictEntry | null {
  const q = normalize(notice.sigungu);
  if (q.length < 2) return null;
  return DISTRICTS.find((d) => normalize(d.label) === q) ?? null;
}

export interface NoticeFilter {
  region?: RegionId;
  /** 이 날짜 이후 모집공고만 (`2026-01-01`) */
  since?: string;
  /** 수집 시군구에 붙는 공고만 — 안전마진을 정확히 잴 수 있는 것들 */
  matchedOnly?: boolean;
}

/** 모집공고일 내림차순. 최근 것이 위입니다 */
export function notices(filter: NoticeFilter = {}): OfferingNotice[] {
  return NOTICES.filter((n) => {
    if (filter.region && n.region !== filter.region) return false;
    if (filter.since && n.noticeDate < filter.since) return false;
    if (filter.matchedOnly && !districtOf(n)) return false;
    return true;
  });
}

/**
 * 공고 + 주택형 → 청약 단지 입력값.
 *
 * **납입 구조(계약금·중도금 비율·금리·이자후불)와 전매제한은 건드리지 않습니다.**
 * API 에 없는 값이라 손으로 넣은 것을 덮어쓰면 안 됩니다.
 */
export function planPatch(
  notice: OfferingNotice,
  model: OfferingModel
): Partial<SubscriptionPlan> {
  const district = districtOf(notice);
  const months = notice.waitMonths;
  return {
    name: `${notice.name} ${model.houseType}`,
    region: notice.region,
    // 수집 시군구에 못 붙으면 비웁니다 — 틀린 동네로 재느니 경고를 띄웁니다.
    sigungu: district?.label ?? '',
    umd: notice.umd,
    price: model.price,
    areaSqm: model.areaSqm,
    // 0.1년(약 5주) 단위로 접습니다. 개월 수를 그대로 나누면 2.5833년이 됩니다.
    waitYears: months ? Math.round((months / 12) * 10) / 10 : undefined,
  };
}

export interface CompetitionStats {
  /** 표본 주택형 수 */
  n: number;
  /** 공고 수 */
  notices: number;
  p25: number;
  median: number;
  p75: number;
  /** 1순위 미달(경쟁률 1 미만) 비율 */
  underShare: number;
}

/**
 * 지역 1순위 경쟁률 분포 — "여기 청약은 되기는 하나".
 *
 * 당첨 확률을 계산해 주지 않습니다. 가점제·추첨제·특별공급 유형이 섞여 있고
 * 순위 내 지역 요건도 다릅니다. **경쟁률 분포까지**가 이 자료로 말할 수 있는
 * 전부이고, 그 이상은 공고문을 봐야 합니다.
 */
export function competitionStats(
  region?: RegionId,
  filter: Omit<NoticeFilter, 'region'> = {}
): CompetitionStats | null {
  const rows = notices({ ...filter, region });
  const rates: number[] = [];
  const seen = new Set<string>();
  for (const n of rows) {
    for (const m of n.models) {
      if (m.rank1Rate === null) continue;
      rates.push(m.rank1Rate);
      seen.add(n.id);
    }
  }
  if (rates.length === 0) return null;
  rates.sort((a, b) => a - b);
  const at = (q: number) => rates[Math.min(rates.length - 1, Math.floor(rates.length * q))];
  return {
    n: rates.length,
    notices: seen.size,
    p25: at(0.25),
    median: at(0.5),
    p75: at(0.75),
    underShare: rates.filter((r) => r < 1).length / rates.length,
  };
}

/** 이 자료가 못 하는 것. 화면에 같이 답니다. */
export const APPLYHOME_CAVEATS = [
  '중도금 이자후불 여부·금리와 전매제한은 API 에 없습니다 — 공고문을 보고 직접 넣으세요.',
  '분양가는 공고 기준 최고가입니다. 발코니 확장·옵션은 빠져 있어 실제 계약금액은 더 큽니다.',
  '경쟁률은 1순위 접수건수 ÷ 공급세대입니다. 가점제·추첨제·특별공급이 섞여 있어 당첨 확률이 아닙니다.',
  '2023년 이후 공고만 담았습니다. 그 전 시장과는 금리도 규제도 다릅니다.',
  '주소에서 구를 못 뜯은 공고는 시군구가 비어 있습니다 — 안전마진이 권역 전체와 비교됩니다.',
];
