/**
 * 공고 별점 — **"이 공고, 지역 안에서 몇 점짜리인가"** 를 그 자리에서 냅니다.
 *
 * 새 공고가 뜨면 판단은 5분 안에 끝나야 합니다. 안전마진(`offering.ts`)은
 * 분양가 한 축만 답하고, 납입 계산(`subscription.ts`)은 현금 한 축만 답합니다.
 * 이 모듈은 **넷을 나란히 세워** 고르는 순간 눈으로 견주게 합니다.
 *
 * ## 하나로 합치지 않습니다
 *
 * 이 저장소의 설계 원칙입니다. 분양가 별 4개 + 당첨 가능성 별 1개를 평균해서
 * 2.5개라고 하면, **싸지만 붙기 어려운 공고**와 **비싸지만 붙기 쉬운 공고**가
 * 같은 점수가 됩니다. 둘은 해야 할 일이 완전히 다릅니다 — 하나는 자금을
 * 준비하는 일이고 하나는 포기하고 다음을 보는 일입니다.
 *
 * ```
 * 분양가        싼가              — 네 기준 마진의 중위 + 지역 과거 공고 대비 평단가
 * 당첨 가능성    붙을 만한가        — 같은 권역 1순위 경쟁률 분포에서의 위치
 * 자금 부담      지금 낼 수 있나    — 계약 시점 현금 대비 여유
 * 묶이는 기간    언제 팔 수 있나    — 입주 대기 + 전매제한
 * ```
 *
 * ## 별점은 순위이지 예측이 아닙니다
 *
 * 전부 **같은 권역 과거 공고 대비 상대 위치**입니다. 별 5개가 "좋은 투자" 라는
 * 뜻이 아니라 "이 지역에서 최근 나온 것들 중 그 축이 나은 편" 이라는 뜻입니다.
 * 표본이 얇으면 별을 주지 않고 `null` 로 둡니다 — 없는 근거로 별을 만들면
 * 그게 제일 나쁩니다.
 */

import { money, percent } from './format';
import { competitionStats, notices, type OfferingModel, type OfferingNotice } from './applyhome';
import { appraiseOffering } from './offering';
import { districtOf } from './applyhome';
import { subscriptionPlan, type SubscriptionPlan } from './subscription';
import { defaultAssumptions } from './tenure';

export type RatingAxisId = 'price' | 'competition' | 'cash' | 'lockup';

export interface RatingAxis {
  id: RatingAxisId;
  label: string;
  /** 이 축이 답하는 질문 — 별 개수만 보면 무엇을 잰 건지 잊습니다 */
  question: string;
  /** 0~5. 잴 근거가 없으면 null — 없는 근거로 별을 만들지 않습니다 */
  stars: number | null;
  /** 한 줄 결론 */
  headline: string;
  /** 왜 그 별점인지 */
  reasons: string[];
  /** 이 축이 못 말하는 것 */
  caveat: string;
  /**
   * **별을 어떻게 나눴는가** — 별 개수마다 어떤 값 구간인지.
   *
   * 별 세 개를 보면 "몇 개월이 별 몇 개인데" 가 바로 따라옵니다. 문장 하나로
   * 뭉뚱그리면 읽는 사람이 자기 값을 어디에 놓아야 할지 못 찾습니다. 구간을
   * 표로 내고 **지금 값이 든 칸을 표시**합니다.
   */
  bands: RatingBand[];
  /** 이 별점이 어떤 식에서 나왔는가 — 식과 대입값 */
  formula: RatingFormula;
  /** 비교에 쓴 표본 수 */
  n: number;
}

export interface RatingBand {
  stars: number;
  /** 이 별을 받는 값 구간 — "48개월 이하" */
  range: string;
  /** 지금 값이 이 구간에 드는가 */
  current: boolean;
}

export interface RatingFormula {
  /** 한 줄 식 */
  expression: string;
  /** 실제로 대입한 값들 */
  steps: string[];
}

export interface OfferingRating {
  axes: RatingAxis[];
  /** 비교 기준이 된 모집단 */
  scope: string;
  caveats: string[];
}

/** 손입력으로 남는 값들 — API 에 없어 공고문을 봐야 합니다. */
export interface RatingTerms {
  downPaymentRatio: number;
  interimRatio: number;
  interimLoanRate: number;
  interimDeferred: boolean;
  resaleBanMonths: number;
  mortgageRate: number;
  mortgageLtv: number;
}

export interface RatingInput {
  notice: OfferingNotice;
  model: OfferingModel;
  terms: RatingTerms;
  /** 계약 시점에 쓸 수 있는 현금 */
  availableCash: number;
  termYears: number;
}

/**
 * 마진을 사람이 읽는 문장으로.
 *
 * `margin` 은 `(기준가 − 분양가) ÷ 기준가` 라 **기준가가 분양가보다 훨씬 쌀 때
 * 음수로 발산합니다.** 마산 소형 구축과 신축 분양가를 견주면 −180% 같은 값이
 * 나오는데, 산술은 맞지만 "180% 비싸다" 는 읽히지 않습니다. 그때는 비율을
 * 뒤집어 **배수**로 말합니다.
 */
function marginPhrase(margin: number): string {
  if (margin > 0) return `분양가가 ${percent(margin, 1)} 쌉니다`;
  if (margin >= -0.5) return `분양가가 ${percent(-margin, 1)} 비쌉니다`;
  return `분양가가 기준가의 ${(1 - margin).toFixed(1)}배입니다`;
}

/** 별 5→1 구간표. `hit` 이 지금 값의 별 개수입니다. */
function bandsOf(ranges: [string, string, string, string, string], hit: number | null): RatingBand[] {
  return ranges.map((range, i) => ({ stars: 5 - i, range, current: hit === 5 - i }));
}

/** 값이 클수록 좋은 축의 별점 — 구간 경계는 위에서부터 5개입니다. */
function starsByThreshold(value: number, cuts: [number, number, number, number]): number {
  if (value >= cuts[0]) return 5;
  if (value >= cuts[1]) return 4;
  if (value >= cuts[2]) return 3;
  if (value >= cuts[3]) return 2;
  return 1;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

/** 표본 안에서 이 값이 아래쪽 몇 %에 있는지 */
function percentileOf(xs: number[], v: number): number {
  if (xs.length === 0) return 0.5;
  return xs.filter((x) => x < v).length / xs.length;
}

/** 이 자료가 못 하는 것 — 별점 옆에 늘 붙습니다. */
export const RATING_CAVEATS = [
  '전부 같은 권역 최근 공고 대비 상대 위치입니다. 별 5개가 좋은 투자라는 뜻이 아니라, 이 지역에서 나온 것들 중 그 축이 나은 편이라는 뜻입니다.',
  '축을 하나로 합치지 않습니다 — 싸지만 붙기 어려운 공고와 비싸지만 붙기 쉬운 공고는 해야 할 일이 다릅니다.',
  '비교 대상 공고는 시점이 제각각입니다. 2023년 공고와 지금은 금리도 규제도 다릅니다.',
  '당첨 확률은 내지 않습니다. 가점제·추첨제·특별공급이 섞여 있어 경쟁률 분포까지가 이 자료의 한계입니다.',
];

/* ── 축 1. 분양가 ──────────────────────────────────────────────────── */

function priceAxis(input: RatingInput): RatingAxis {
  const { notice, model } = input;
  const district = districtOf(notice);
  const waitYears = (notice.waitMonths ?? 30) / 12;

  const appraisal = appraiseOffering({
    region: notice.region,
    sigungu: district?.label ?? '',
    umd: notice.umd,
    price: model.price,
    areaSqm: model.areaSqm,
    waitYears,
  });

  // 같은 권역 과거 공고의 ㎡당 분양가 — "청약끼리" 견주는 축입니다.
  const peers = notices({ region: notice.region })
    .flatMap((n) => n.models.map((m) => m.price / m.areaSqm))
    .filter((v) => Number.isFinite(v) && v > 0);
  const perSqm = model.price / model.areaSqm;
  const pct = percentileOf(peers, perSqm);

  const reasons: string[] = [];
  if (appraisal) {
    for (const b of appraisal.benchmarks) {
      if (b.margin === null) continue;
      reasons.push(
        `${b.label} ${money(Math.round(b.value ?? 0))} 대비 — ${marginPhrase(b.margin)} (표본 ${b.n}${b.thin ? ', 얇음' : ''})`
      );
    }
    if (appraisal.conflicted) {
      reasons.push('기준끼리 어긋납니다 — 어떤 자로는 싸고 어떤 자로는 비쌉니다. 그 간격이 신축 프리미엄을 미리 당겨 받은 몫입니다.');
    }
  }
  if (peers.length >= 20) {
    reasons.push(
      `㎡당 ${money(Math.round(perSqm))}로 이 권역 공고 ${peers.length}개 중 아래에서 ${percent(pct, 0)} 지점입니다 (중위 ${money(Math.round(median(peers)))}/㎡).`
    );
  }

  const margin = appraisal?.medianMargin ?? null;
  const stars =
    margin === null
      ? peers.length >= 20
        ? starsByThreshold(1 - pct, [0.75, 0.6, 0.4, 0.25])
        : null
      : starsByThreshold(margin, [0.25, 0.15, 0.05, -0.05]);

  return {
    id: 'price',
    label: '분양가',
    question: '이 값이 싼가',
    stars,
    headline:
      margin === null
        ? peers.length >= 20
          ? `주변 실거래 표본이 없어 청약끼리만 견줬습니다 — 이 권역 ${percent(pct, 0)} 지점`
          : '견줄 표본이 없습니다'
        : `${marginPhrase(margin)} — 주변 실거래·신축 하한 등 네 기준의 중위`,
    reasons,
    caveat:
      district === null
        ? '주소에서 시군구를 특정하지 못해 권역 전체와 비교했습니다 — 동네가 섞여 있습니다.'
        : '분양가는 공고 기준 최고가입니다. 발코니 확장·옵션이 빠져 있어 실제 계약금액은 더 큽니다.',
    bands: bandsOf(
      [
        '네 기준 중위보다 25% 이상 쌈',
        '15~25% 쌈',
        '5~15% 쌈',
        '5% 쌈 ~ 5% 비쌈 (엇비슷)',
        '5% 넘게 비쌈',
      ],
      stars
    ),
    formula: {
      expression: '마진 = (기준가 − 분양가) ÷ 기준가 · 네 기준의 중위로 별을 매깁니다',
      steps: [
        `분양가 ${money(model.price)} (전용 ${model.areaSqm}㎡ · ㎡당 ${money(Math.round(perSqm))})`,
        ...(appraisal?.benchmarks ?? []).map((b) =>
          b.value === null
            ? `${b.label} — 표본 없음`
            : `${b.label} ${money(Math.round(b.value))} → ${marginPhrase(b.margin ?? 0)}`
        ),
        margin === null
          ? '값이 나온 기준이 없어 청약끼리만 견줬습니다.'
          : `네 기준의 중위 = ${marginPhrase(margin)}`,
      ],
    },
    n: appraisal?.benchmarks.filter((b) => b.value !== null).length ?? 0,
  };
}

/* ── 축 2. 당첨 가능성 ─────────────────────────────────────────────── */

/**
 * 경쟁률 구간표 — **실제 배수로** 적습니다.
 *
 * "하위 25% 안이면 ★4" 는 자기 공고를 어디에 놓아야 할지 알 수 없습니다.
 * 그 권역 분포의 실제 경쟁률로 바꿔 "1.2 : 1 이하면 ★4" 라고 적어야
 * 손에 든 숫자와 바로 견줄 수 있습니다.
 */
/**
 * 경쟁률 구간표 — **실제 배수로**, 그리고 **미달을 뺀 표본**으로 적습니다.
 *
 * "하위 25% 안이면 ★4" 는 자기 공고를 어디에 놓아야 할지 알 수 없습니다.
 * 그렇다고 미달까지 섞어 분위수를 내면 창원처럼 미달이 46% 인 권역에서는
 * 하위 분위가 전부 1 아래로 내려가, "미달 아님 ~ 0.1 : 1" 같은 있을 수 없는
 * 구간이 나옵니다. **미달은 이미 ★5 한 칸을 차지하므로**, 나머지 네 칸은
 * 미달이 아닌 표본 안에서 나눕니다.
 */
function competitionBands(peers: number[], hit: number | null): RatingBand[] {
  const sorted = peers.filter((r) => r >= 1).sort((a, b) => a - b);
  const at = (q: number) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null;
  const fmt = (v: number) => `${v.toFixed(1)} : 1`;

  const edges = [0.25, 0.5, 0.75].map(at);
  const range = (lo: number | null, hi: number | null, tail: string) =>
    lo === null || hi === null ? '표본 없음' : `${fmt(lo)} ~ ${fmt(hi)}${tail}`;

  return bandsOf(
    [
      '1순위 미달 (1 : 1 미만)',
      range(1, edges[0], ' — 붙은 것들 중에서도 경쟁이 약한 축'),
      range(edges[0], edges[1], ''),
      range(edges[1], edges[2], ''),
      edges[2] === null ? '표본 없음' : `${fmt(edges[2])} 초과 — 권역에서 경쟁이 센 축`,
    ],
    hit
  );
}

function competitionAxis(input: RatingInput): RatingAxis {
  const { notice, model } = input;
  const stats = competitionStats(notice.region);
  const rate = model.rank1Rate;

  const peers = notices({ region: notice.region })
    .flatMap((n) => n.models.map((m) => m.rank1Rate))
    .filter((r): r is number => r !== null);

  const reasons: string[] = [];
  if (stats) {
    reasons.push(
      `이 권역 1순위 경쟁률 — 중위 ${stats.median.toFixed(1)} : 1 · 하위 25% ${stats.p25.toFixed(1)} · 상위 25% ${stats.p75.toFixed(1)} (주택형 ${stats.n}개).`
    );
    reasons.push(`1순위 미달이 ${percent(stats.underShare, 0)}입니다 — 미달은 0이 아니라 미달입니다.`);
  }

  if (rate === null) {
    return {
      id: 'competition',
      label: '당첨 가능성',
      question: '붙을 만한가',
      stars: null,
      headline: '아직 경쟁률이 없습니다 — 접수 전이거나 집계 전입니다',
      reasons: [
        ...reasons,
        '이 주택형의 경쟁률이 스냅샷에 없어 별을 주지 않습니다. 같은 권역 분포만 참고하세요.',
      ],
      caveat: '경쟁률은 당첨 확률이 아닙니다. 가점제·추첨제·특별공급이 섞여 있습니다.',
      bands: competitionBands(peers, null),
      formula: {
        expression: '경쟁률 = 1순위 접수건수 ÷ 공급세대',
        steps: [
          '이 주택형은 아직 접수 전이거나 집계 전이라 분자가 없습니다.',
          stats
            ? `같은 권역 주택형 ${stats.n}개의 중위는 ${stats.median.toFixed(1)} : 1 입니다.`
            : '같은 권역 표본도 없습니다.',
        ],
      },
      n: peers.length,
    };
  }

  /*
   * 미달은 그 자체로 한 칸(★5)이므로, 나머지는 **미달이 아닌 표본 안에서**
   * 순위를 매깁니다. 미달까지 섞어 백분위를 내면 1.3 : 1 같은 값이 "권역
   * 46% 지점" 이 되는데, 그 46% 는 대부분 미달이라 견줄 대상이 아닙니다.
   */
  const contested = peers.filter((r) => r >= 1);
  const pct = percentileOf(contested, rate);
  /*
   * ★5 는 미달이 통째로 차지합니다. 미달이 아닌 것은 아무리 경쟁이 약해도
   * ★4 가 상한이어야 표와 별이 어긋나지 않습니다 — 표에는 "★5 = 미달" 이라
   * 적어 놓고 1.3 : 1 에 ★5 를 주면 읽는 사람이 둘을 못 맞춥니다.
   */
  const stars = rate < 1 ? 5 : pct <= 0.25 ? 4 : pct <= 0.5 ? 3 : pct <= 0.75 ? 2 : 1;
  reasons.unshift(
    rate < 1
      ? `이 주택형은 1순위 미달이었습니다 (${rate.toFixed(2)} : 1) — 접수만 하면 되는 구간입니다.`
      : `이 주택형 1순위 ${rate.toFixed(1)} : 1 — 미달이 아닌 주택형 ${contested.length}개 중 아래에서 ${percent(pct, 0)} 지점입니다.`
  );

  return {
    id: 'competition',
    label: '당첨 가능성',
    question: '붙을 만한가',
    stars,
    headline:
      rate < 1
        ? '1순위 미달 — 이 권역에서 가장 붙기 쉬운 쪽'
        : `1순위 ${rate.toFixed(1)} : 1 — 미달 아닌 것들 중 ${percent(pct, 0)} 지점`,
    reasons,
    caveat:
      '경쟁률이 낮다고 좋은 물건이라는 뜻이 아닙니다 — 시장이 덜 평가했다는 뜻이기도 합니다. 분양가 축과 같이 보세요.',
    bands: competitionBands(peers, stars),
    formula: {
      expression: '경쟁률 = 1순위 접수건수 ÷ 공급세대 · 같은 권역 분포에서의 위치로 별을 매깁니다',
      steps: [
        `1순위 접수 ${model.rank1Req.toLocaleString('ko-KR')}건 ÷ 공급 ${model.rank1Supply}세대 = ${rate.toFixed(2)} : 1`,
        `미달이 아닌 주택형 ${contested.length}개 중 아래에서 ${percent(pct, 0)} 지점 (미달 ${peers.length - contested.length}개는 ★5 칸으로 따로 셉니다)`,
        rate < 1 ? '1 미만은 미달입니다 — 접수 자체가 공급세대에 못 미쳤습니다.' : '숫자가 낮을수록 붙기 쉽습니다.',
      ],
    },
    n: peers.length,
  };
}

/* ── 축 3. 자금 부담 ───────────────────────────────────────────────── */

function cashAxis(input: RatingInput): RatingAxis {
  const { notice, model, terms, availableCash, termYears } = input;
  const district = districtOf(notice);
  const plan: SubscriptionPlan = {
    id: 'rating',
    name: notice.name,
    region: notice.region,
    sigungu: district?.label ?? '',
    umd: notice.umd,
    price: model.price,
    areaSqm: model.areaSqm,
    waitYears: (notice.waitMonths ?? 30) / 12,
    resaleBanMonths: terms.resaleBanMonths,
    downPaymentRatio: terms.downPaymentRatio,
    interimRatio: terms.interimRatio,
    interimLoanRate: terms.interimLoanRate,
    interimDeferred: terms.interimDeferred,
    mortgageRate: terms.mortgageRate,
    mortgageLtv: terms.mortgageLtv,
  };
  const res = subscriptionPlan(
    plan,
    defaultAssumptions(notice.region),
    availableCash,
    termYears
  );

  const slack = availableCash > 0 ? (availableCash - res.initialOutlay) / availableCash : -1;
  const stars = starsByThreshold(slack, [0.5, 0.3, 0.1, 0]);

  const reasons = [
    `계약 시점에 ${money(res.initialOutlay)}가 나갑니다 — 계약금 ${money(res.downPayment)} + 대기 중 살 집 보증금 자기부담 ${money(res.waitDeposit)}.`,
    `가용현금 ${money(availableCash)} 대비 ${slack >= 0 ? `${percent(slack, 0)} 남습니다` : `${money(res.initialOutlay - availableCash)} 모자랍니다`}.`,
    terms.interimDeferred
      ? `중도금 이자후불 — 대기 중에는 안 내고 입주 때 ${money(res.interimInterest)}를 한꺼번에 정산합니다.`
      : `중도금 이자를 대기 기간에 매달 냅니다 (총 ${money(res.interimInterest)}).`,
    `입주 때 잔금·취득비로 ${money(res.moveInCash)}가 더 필요하고, 그때 전세보증금 ${money(res.waitDeposit)}를 돌려받습니다.`,
  ];
  if (res.waitMode === 'wolse') {
    reasons.push('계약금을 내고 나면 전세보증금을 못 채워 월세로 계산했습니다 — 대기 중 주거비가 그만큼 늘어납니다.');
  }

  return {
    id: 'cash',
    label: '자금 부담',
    question: '지금 낼 수 있나',
    stars,
    headline:
      slack >= 0
        ? `계약 때 ${money(res.initialOutlay)} — 가용현금의 ${percent(1 - slack, 0)}를 씁니다`
        : `계약 때 ${money(res.initialOutlay - availableCash)} 모자랍니다`,
    reasons,
    caveat:
      '계약금은 대출이 안 됩니다. 청약의 진짜 문턱은 분양가가 아니라 이 돈과 대기 중 살 집 보증금입니다.',
    bands: bandsOf(
      [
        `계약 때 ${money(Math.round(availableCash * 0.5))} 이하 (현금의 절반 이상 남음)`,
        `${money(Math.round(availableCash * 0.7))} 이하 (30% 남음)`,
        `${money(Math.round(availableCash * 0.9))} 이하 (10% 남음)`,
        `${money(Math.round(availableCash))} 이하 (딱 맞음)`,
        `${money(Math.round(availableCash))} 초과 — 모자람`,
      ],
      stars
    ),
    formula: {
      expression: '여유 = (가용현금 − 계약 때 나가는 현금) ÷ 가용현금',
      steps: [
        `계약금 ${money(res.downPayment)} + 대기 중 살 집 보증금 자기부담 ${money(res.waitDeposit)} = ${money(res.initialOutlay)}`,
        `(${money(availableCash)} − ${money(res.initialOutlay)}) ÷ ${money(availableCash)} = ${percent(slack, 0)}`,
        terms.interimDeferred
          ? `중도금 이자 ${money(res.interimInterest)}는 이자후불이라 이 계산에 안 들어가고 입주 때 붙습니다.`
          : `중도금 이자 ${money(res.interimInterest)}는 대기 기간에 매달 나갑니다.`,
      ],
    },
    n: 0,
  };
}

/* ── 축 4. 묶이는 기간 ─────────────────────────────────────────────── */

function lockupAxis(input: RatingInput): RatingAxis {
  const { notice, terms } = input;
  const wait = notice.waitMonths ?? 0;
  const total = wait + terms.resaleBanMonths;

  const peers = notices({ region: notice.region })
    .map((n) => n.waitMonths)
    .filter((v): v is number => v !== null);
  const pct = peers.length >= 5 ? percentileOf(peers, wait) : null;

  const stars = starsByThreshold(-total, [-24, -36, -48, -60]);

  const reasons = [
    `계약부터 입주까지 ${wait}개월${notice.moveInYm ? ` (입주예정 ${notice.moveInYm.slice(0, 4)}.${notice.moveInYm.slice(4)})` : ''}.`,
    terms.resaleBanMonths > 0
      ? `전매제한 ${terms.resaleBanMonths}개월 — 합쳐서 ${total}개월 동안 팔 수 없습니다.`
      : '전매제한을 0으로 두셨습니다 — 공고문에서 확인하세요. API 에 없는 값입니다.',
  ];
  if (pct !== null) {
    reasons.push(
      `대기 기간만 놓고 보면 이 권역 공고 ${peers.length}개 중 아래에서 ${percent(pct, 0)} 지점입니다 (중위 ${Math.round(median(peers))}개월).`
    );
  }

  return {
    id: 'lockup',
    label: '묶이는 기간',
    question: '언제 팔 수 있나',
    stars,
    headline: `입주까지 ${wait}개월 + 전매제한 ${terms.resaleBanMonths}개월 = ${total}개월`,
    reasons,
    caveat:
      '묶인다고 손해는 아닙니다 — 그 기간에 오르면 그대로 가져갑니다. 다만 마음이 바뀌어도 못 판다는 뜻이라 유동성 제약으로 봅니다.',
    bands: bandsOf(
      [
        '24개월 이하 (2년)',
        '25~36개월 (3년)',
        '37~48개월 (4년)',
        '49~60개월 (5년)',
        '60개월 초과',
      ],
      stars
    ),
    formula: {
      expression: '총 묶임 = 입주까지 걸리는 기간 + 전매제한',
      steps: [
        `계약 ${notice.contractDate || '—'} → 입주예정 ${
          notice.moveInYm ? `${notice.moveInYm.slice(0, 4)}.${notice.moveInYm.slice(4)}` : '—'
        } = ${wait}개월`,
        `+ 전매제한 ${terms.resaleBanMonths}개월 = ${total}개월`,
        `${total}개월은 ${stars === 5 ? '24개월 이하' : stars === 4 ? '25~36개월' : stars === 3 ? '37~48개월' : stars === 2 ? '49~60개월' : '60개월 초과'} 구간이라 별 ${stars}개입니다.`,
      ],
    },
    n: peers.length,
  };
}

/**
 * 공고 별점 — 네 축을 나란히.
 *
 * 순서가 곧 읽는 순서입니다. 분양가 → 당첨 가능성 → 자금 → 묶임 순으로,
 * "쌀까 → 될까 → 낼 수 있나 → 언제까지 묶이나" 를 따라갑니다.
 */
export function rateOffering(input: RatingInput): OfferingRating {
  return {
    axes: [priceAxis(input), competitionAxis(input), cashAxis(input), lockupAxis(input)],
    scope: `${notices({ region: input.notice.region }).length}건의 같은 권역 공고 (2023년 이후)`,
    caveats: RATING_CAVEATS,
  };
}
