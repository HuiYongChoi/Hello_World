/**
 * 전월세 후보 찾기 — **전세와 월세를 한 자로 견줍니다.**
 *
 * 전세 1.5억과 월세 보증금 2천만·월 50만은 그대로는 비교가 안 됩니다. 한쪽은
 * 목돈이 묶이는 것이고 한쪽은 매달 나가는 것이라 단위가 다릅니다.
 *
 * ```
 * 월 환산 주거비 = 월세 + 보증금 × 기회비용률 ÷ 12
 * ```
 *
 * 보증금은 **없어지는 돈이 아니라 묶이는 돈**입니다. 그 돈이 다른 데서 벌었을
 * 수익(또는 전세대출을 썼다면 그 이자)이 실제 비용이고, 그걸 월로 펴면 월세와
 * 같은 자에 올릴 수 있습니다. 기회비용률을 무엇으로 잡느냐가 이 화면에서 가장
 * 결론을 많이 흔드는 값이라, 화면에서 바꿀 수 있게 두고 기본값이 무엇인지
 * 적습니다.
 *
 * ## 순위를 매기지만 점수로 합치지는 않습니다
 *
 * 월 환산 비용으로 줄을 세우되, 출퇴근·연식·거래 활발도를 그 안에 섞어 하나의
 * 점수로 만들지 않습니다. 싼 집과 가까운 집은 해야 할 일이 다릅니다 — 섞으면
 * 둘 다 안 보입니다.
 */

import {
  COMPLEXES,
  monthsAgo,
  regionOf,
  type CommuteGrade,
  type RentComplex,
  type RentSize,
} from './data';

export type TenureMode = 'jeonse' | 'wolse';

export interface FinderInput {
  /** 전용면적 하한 (㎡) — 투룸 이상의 대리지표 */
  minArea: number;
  /** 전용면적 상한 (㎡). 0이면 상한 없음 */
  maxArea: number;
  /** 낼 수 있는 보증금 상한 (원) */
  maxDeposit: number;
  /** 월 환산 주거비 상한 (원) */
  maxMonthly: number;
  /** 보증금 기회비용 연이율 */
  opportunityRate: number;
  /** 볼 시군구 코드. 비면 전부 */
  regionCodes: string[];
  /** 준공연도 하한. 0이면 제한 없음 */
  minBuildYear: number;
  /** 최근 몇 개월 안에 거래가 있어야 하는가 */
  freshMonths: number;
  /**
   * 이 평형의 최근 2년 거래가 최소 몇 건이어야 하는가.
   *
   * 1건짜리 중위가는 **그 집 한 채 가격**입니다. 그런데 특이하게 싼 한 건이
   * 목록 맨 위로 올라오면 "이 단지가 제일 싸다" 로 읽힙니다 — 시세가 아니라
   * 사연 있는 계약일 가능성이 큽니다. 기본으로 걸러 두고 켜서 볼 수 있게 합니다.
   *
   * **전세·월세 각각에 겁니다.** 평형 전체 건수로만 걸면 "전세 1건 + 월세
   * 6건" 인 평형에서 전세 1건이 그대로 대표 시세가 되어 1등으로 올라옵니다.
   */
  minDeals: number;
  /** 전세만·월세만·둘 다 */
  modes: TenureMode[];
}

export interface CandidateOption {
  mode: TenureMode;
  deposit: number;
  rent: number;
  /** 월 환산 주거비 (원) */
  monthly: number;
  n: number;
}

export interface Candidate {
  key: string;
  complex: RentComplex;
  size: RentSize;
  regionLabel: string;
  commute: CommuteGrade;
  /** 예산 안에 드는 선택지들 — 전세·월세 각각 */
  options: CandidateOption[];
  /** 그중 월 환산이 가장 싼 것 */
  best: CandidateOption;
  /** 마지막 거래가 몇 개월 전인가 */
  staleMonths: number;
  /** 거래가 얇아 중위가를 믿기 어려운가 */
  thin: boolean;
  /** 이 후보에 대해 자료가 말해 주는 것 */
  notes: string[];
}

/** 거래가 이보다 적으면 중위가가 한두 건에 흔들립니다. */
export const THIN_DEALS = 3;

/** 투룸이 나오기 시작하는 전용면적 — 방 개수 자료가 없어 쓰는 대리선입니다. */
export const TWO_ROOM_SQM = 36;

export const DEFAULT_INPUT: FinderInput = {
  minArea: TWO_ROOM_SQM,
  maxArea: 0,
  maxDeposit: 200000000,
  maxMonthly: 900000,
  /*
   * 기본값은 전세자금대출 금리대입니다. 보증금을 대출로 채우면 그 이자가 곧
   * 비용이고, 자기 돈이면 그 돈이 다른 데서 벌었을 수익이 비용입니다.
   */
  opportunityRate: 0.042,
  regionCodes: ['48127', '48125'],
  minBuildYear: 0,
  freshMonths: 12,
  minDeals: 2,
  modes: ['jeonse', 'wolse'],
};

/** 보증금이 묶여서 생기는 월 비용 + 월세 */
export function monthlyCost(deposit: number, rent: number, rate: number): number {
  return rent + (deposit * rate) / 12;
}

function optionsOf(size: RentSize, input: FinderInput): CandidateOption[] {
  const out: CandidateOption[] = [];
  const enough = (n: number) => !input.minDeals || n >= input.minDeals;
  if (input.modes.includes('jeonse') && size.jeonse && enough(size.jeonse.n)) {
    out.push({
      mode: 'jeonse',
      deposit: size.jeonse.deposit,
      rent: 0,
      monthly: monthlyCost(size.jeonse.deposit, 0, input.opportunityRate),
      n: size.jeonse.n,
    });
  }
  if (input.modes.includes('wolse') && size.wolse && enough(size.wolse.n)) {
    out.push({
      mode: 'wolse',
      deposit: size.wolse.deposit,
      rent: size.wolse.rent,
      monthly: monthlyCost(size.wolse.deposit, size.wolse.rent, input.opportunityRate),
      n: size.wolse.n,
    });
  }
  return out;
}

/**
 * 조건에 맞는 단지·평형을 찾습니다.
 *
 * 걸러 내는 순서가 곧 사용자가 포기하는 순서입니다 — 지역·면적은 타협하기
 * 어렵고 예산은 조금씩 움직일 수 있으므로, 예산으로 떨어진 후보는 이유를
 * 남겨 화면이 "얼마를 더 내면 되는지" 를 말할 수 있게 합니다.
 */
export function findRentals(input: FinderInput): Candidate[] {
  const out: Candidate[] = [];

  for (const c of COMPLEXES) {
    if (input.regionCodes.length && !input.regionCodes.includes(c.regionCode)) continue;
    if (input.minBuildYear && c.buildYear && c.buildYear < input.minBuildYear) continue;

    const region = regionOf(c.regionCode);
    for (const size of c.sizes) {
      if (size.area < input.minArea) continue;
      if (input.maxArea && size.area > input.maxArea) continue;

      const stale = monthsAgo(size.lastYm);
      if (input.freshMonths && stale > input.freshMonths) continue;

      const affordable = optionsOf(size, input).filter(
        (o) => o.deposit <= input.maxDeposit && o.monthly <= input.maxMonthly
      );
      if (affordable.length === 0) continue;

      const best = affordable.reduce((a, b) => (b.monthly < a.monthly ? b : a));
      const notes: string[] = [];
      if (size.n < THIN_DEALS) {
        notes.push(`최근 2년 거래가 ${size.n}건뿐이라 시세를 세게 읽으면 안 됩니다.`);
      }
      if (size.renewalShare >= 0.5) {
        notes.push(
          `갱신계약이 ${Math.round(size.renewalShare * 100)}% 입니다 — 살던 사람이 계속 사는 곳이라 새 매물이 드물 수 있습니다.`
        );
      }
      if (affordable.length === 2) {
        const j = affordable.find((o) => o.mode === 'jeonse');
        const w = affordable.find((o) => o.mode === 'wolse');
        if (j && w) {
          const gap = w.monthly - j.monthly;
          const depositGap = j.deposit - w.deposit;
          const man = (v: number) => `${Math.round(Math.abs(v) / 10000).toLocaleString('ko-KR')}만원`;
          /*
           * 부호를 문장으로 옮길 때 전제를 깔면 안 됩니다. 전세 보증금이 월세
           * 보증금보다 **작은** 경우가 실제로 있어 (LH·구축 소형), "전세가 더
           * 묶인다" 고 써 두면 −2,992만원 같은 문장이 나옵니다.
           */
          const depositPhrase =
            depositGap > 0
              ? `보증금은 ${man(depositGap)} 더 묶입니다`
              : depositGap < 0
                ? `보증금도 ${man(depositGap)} 덜 묶입니다`
                : '보증금은 같습니다';
          notes.push(
            gap > 0
              ? `같은 평형에서 전세가 월 ${man(gap)} 쌉니다 — ${depositPhrase}.`
              : `같은 평형에서 월세가 월 ${man(gap)} 쌉니다 — 전세는 ${depositPhrase}.`
          );
        }
      }
      if (c.buildYear) {
        const age = Number(RENT_ASOF_YEAR) - c.buildYear;
        if (age >= 30) notes.push(`준공 ${c.buildYear}년 — ${age}년차라 설비 노후를 직접 보셔야 합니다.`);
      }

      out.push({
        key: `${c.id}|${size.area}`,
        complex: c,
        size,
        regionLabel: region?.short ?? c.regionCode,
        commute: region?.commute ?? 'mid',
        options: affordable,
        best,
        staleMonths: stale,
        thin: size.n < THIN_DEALS,
        notes,
      });
    }
  }

  return out.sort((a, b) => a.best.monthly - b.best.monthly);
}

/** 스냅샷 기준 연도 — 연식 계산에만 씁니다. */
const RENT_ASOF_YEAR = new Date().getFullYear();

export type SortKey = 'monthly' | 'deposit' | 'area' | 'recent' | 'perSqm';

export const SORT_LABEL: Record<SortKey, string> = {
  monthly: '월 환산 주거비',
  deposit: '필요한 보증금',
  area: '전용면적 넓은 순',
  recent: '최근 거래순',
  perSqm: '㎡당 월 비용',
};

export function sortCandidates(list: Candidate[], key: SortKey): Candidate[] {
  const copy = [...list];
  switch (key) {
    case 'monthly':
      return copy.sort((a, b) => a.best.monthly - b.best.monthly);
    case 'deposit':
      return copy.sort((a, b) => a.best.deposit - b.best.deposit);
    case 'area':
      return copy.sort((a, b) => b.size.area - a.size.area);
    case 'recent':
      return copy.sort((a, b) => a.staleMonths - b.staleMonths);
    case 'perSqm':
      return copy.sort(
        (a, b) => a.best.monthly / a.size.area - b.best.monthly / b.size.area
      );
  }
}

export interface FinderSummary {
  candidates: number;
  complexes: number;
  /** 월 환산 주거비 중위 */
  medianMonthly: number;
  cheapest: Candidate | null;
  /** 지역별 후보 수 */
  perRegion: { label: string; n: number }[];
}

export function summarize(list: Candidate[]): FinderSummary {
  const monthlies = list.map((c) => c.best.monthly).sort((a, b) => a - b);
  const perRegion = new Map<string, number>();
  for (const c of list) perRegion.set(c.regionLabel, (perRegion.get(c.regionLabel) ?? 0) + 1);
  return {
    candidates: list.length,
    complexes: new Set(list.map((c) => c.complex.id)).size,
    medianMonthly: monthlies.length
      ? monthlies[Math.floor(monthlies.length / 2)]
      : 0,
    cheapest: list.length ? list.reduce((a, b) => (b.best.monthly < a.best.monthly ? b : a)) : null,
    perRegion: [...perRegion.entries()]
      .map(([label, n]) => ({ label, n }))
      .sort((a, b) => b.n - a.n),
  };
}
