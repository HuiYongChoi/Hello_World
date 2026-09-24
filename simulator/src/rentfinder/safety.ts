/**
 * 전세가율 — **"이 전세, 떼일 위험은 어느 정도인가."**
 *
 * 전세에서 가장 중요한 질문은 싸냐가 아니라 **보증금을 돌려받느냐**입니다.
 * 집값이 보증금 근처까지 떨어지면 집주인이 팔아도 못 돌려주는 구간이 생기고,
 * 그게 이른바 깡통전세입니다.
 *
 * ```
 * 전세가율 = 전세보증금 ÷ 같은 단지·평형 매매 중위가
 * ```
 *
 * 매매 스냅샷(`market-*.json`)과 전월세 스냅샷(`masan-rent-*.json`)은 국토부가
 * 주는 **같은 `aptSeq`** 를 쓰므로 단지를 정확히 짝지을 수 있습니다. 시장
 * 평균끼리 나누면 전세가 활발한 단지와 매매가 활발한 단지가 뒤섞여 실제로
 * 없는 비율이 나옵니다 — 3-way 화면에서 이미 겪은 함정이라 여기서도 같은
 * 규율을 씁니다.
 *
 * ## 이 숫자가 못 말하는 것이 더 큽니다
 *
 * **선순위 근저당이 자료에 없습니다.** 전세가율이 50% 여도 집에 대출이 잔뜩
 * 잡혀 있으면 위험하고, 80% 여도 깨끗하면 상대적으로 낫습니다. 실제 안전은
 * **등기부등본**에서 갈리고, 이 숫자는 그 앞에서 후보를 줄이는 데까지만
 * 쓰입니다.
 *
 * 그래서 등급을 "안전" 이라 부르지 않고 **위험이 낮은 축**이라고 적습니다.
 *
 * ## 융자는 못 재지만, 융자가 얼마까지 괜찮은지는 잽니다
 *
 * 근저당은 호수 단위 등기부에만 있고 공개 API 가 없습니다. 대신 **이 집이 얼마의
 * 선순위를 견디는지**는 매매가로 잴 수 있습니다.
 *
 * ```
 * 근저당 허용선 = 매매 중위가 × 낙찰가율 − 보증금
 * ```
 *
 * 경매로 넘어가도 보증금이 남으려면 등기부 을구의 **채권최고액 합계**가 이
 * 선 아래여야 합니다. 중개사가 등기부를 보여 줄 때 이 숫자 하나와 견주면
 * 됩니다 — "융자가 있다/없다" 가 아니라 "그 융자가 괜찮은 크기인가" 로.
 *
 * 매매·전세를 맞대 **갭투자 흔적**(매매 뒤 곧바로 같은 층 신규 전세)도 재 봤지만,
 * 동·호수가 없어 같은 층 다른 호가 섞이는 우연 기대치와 거의 같았습니다
 * (2년 4,502건 대 기대 4,257건). 신호가 아니라 잡음이라 화면에 올리지 않습니다 —
 * `scripts/fetch-masan-landlord.mjs` 에 재현 방법이 남아 있습니다.
 */

import ruleset from '../rules/rent-loans-2026-09.json';
import { MARKET, quarterLabel, type MarketComplex } from '../engine/market';

/** 정책·가정 수치는 룰셋에서 읽습니다 — 코드에는 로직만 둡니다. */
export const SAFETY_RULES = ruleset.jeonseSafety;

export type SafetyGrade = 'low' | 'mid' | 'high' | 'danger' | 'unknown';

export interface JeonseSafety {
  /** 전세보증금 ÷ 매매 중위가. 매매 표본이 없으면 null */
  ratio: number | null;
  /** 짝지은 매매 중위가 (원) */
  salePrice: number | null;
  /** 그 중위가를 만든 거래 건수 */
  saleDeals: number;
  /** 매매 거래가 언제였나 */
  saleQuarter: string | null;
  /** 매매 표본이 몇 분기 전인가 */
  saleStaleQuarters: number | null;
  grade: SafetyGrade;
  headline: string;
  /**
   * 근저당 허용선 — 등기부 을구 **채권최고액 합계**가 이 금액 이하여야 합니다.
   *
   * `auction` 은 경매로 넘어가도 보증금이 남는 선, `guarantee` 는 보증보험
   * (보증금 + 선순위 ≤ 집값 90%) 을 시세로 잰 선입니다. 음수면 근저당이 하나도
   * 없어도 이미 모자랍니다.
   */
  seniorRoom: { auction: number; guarantee: number } | null;
  /** 같은 평형 매매가가 1년 새 얼마나 움직였나 — 떨어지는 중이면 여유가 줄어듭니다 */
  priceTrend: { change: number; from: string; to: string } | null;
  /** 왜 그 등급인지 · 무엇을 더 봐야 하는지 */
  notes: string[];
}

export const SAFETY_LABEL: Record<SafetyGrade, string> = {
  low: '위험 낮음',
  mid: '보통',
  high: '주의',
  danger: '위험',
  unknown: '잴 수 없음',
};

/**
 * 등급 경계.
 *
 * 보증보험 가입 기준이 통상 전세가율 90% 언저리이고, 실무에서 80% 를 넘으면
 * 깡통 경고를 답니다. 그 아래로는 여유가 얼마나 있는지의 문제라 60·70 에서
 * 한 번씩 끊습니다.
 */
const CUTS = SAFETY_RULES.ratioCuts;

/** 매매 표본이 이보다 적으면 중위가를 믿기 어렵습니다. */
const MIN_SALE_DEALS = 3;

/** 전용면적이 이만큼 벌어지면 다른 평형으로 봅니다. */
const AREA_TOLERANCE = 2;

const byId = new Map<string, MarketComplex>(MARKET.complexes.map((c) => [c.id, c]));

function latestQuarter(): number {
  let last = -Infinity;
  for (const c of MARKET.complexes) {
    for (const s of c.sizes) for (const p of s.points) if (p.q > last) last = p.q;
  }
  return last;
}
const LATEST_Q = latestQuarter();

function gradeOf(ratio: number): SafetyGrade {
  if (ratio < CUTS.low) return 'low';
  if (ratio < CUTS.mid) return 'mid';
  if (ratio < CUTS.high) return 'high';
  return 'danger';
}

/**
 * 같은 단지·평형의 매매 중위가로 전세가율을 냅니다.
 *
 * 평형은 ±2㎡ 까지 같은 것으로 봅니다 — 84.97 과 84.99 는 같은 평형인데
 * 반올림 단위가 달라 안 붙는 일이 생깁니다.
 */
export function jeonseSafety(
  complexId: string,
  areaSqm: number,
  deposit: number
): JeonseSafety {
  const base: JeonseSafety = {
    ratio: null,
    salePrice: null,
    saleDeals: 0,
    saleQuarter: null,
    saleStaleQuarters: null,
    grade: 'unknown',
    headline: '같은 단지 매매 거래가 없어 전세가율을 못 냅니다',
    seniorRoom: null,
    priceTrend: null,
    notes: [
      '매매 실거래가 없으면 이 집의 값을 알 수 없어, 보증금이 집값에 얼마나 가까운지도 못 잽니다.',
    ],
  };

  const sale = byId.get(complexId);
  if (!sale) return base;

  // 같은 평형 후보 중 면적이 가장 가까운 것
  const size = sale.sizes
    .filter((s) => Math.abs(s.area - areaSqm) <= AREA_TOLERANCE)
    .sort((a, b) => Math.abs(a.area - areaSqm) - Math.abs(b.area - areaSqm))[0];
  if (!size || size.points.length === 0) return base;

  // 가장 최근 분기의 거래를 씁니다 — 오래된 값이면 그 사실을 같이 냅니다.
  const last = size.points.reduce((a, b) => (b.q > a.q ? b : a));
  if (last.price <= 0) return base;

  const ratio = deposit / last.price;
  const grade = gradeOf(ratio);
  const stale = LATEST_Q - last.q;

  const man = (v: number) => `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원`;
  const notes: string[] = [
    `같은 단지 전용 ${size.area}㎡ 매매 중위가 ${man(last.price)} (${quarterLabel(last.q)} · ${last.n}건).`,
  ];

  const seniorRoom = {
    auction: last.price * SAFETY_RULES.auctionRatio - deposit,
    guarantee: last.price * SAFETY_RULES.guaranteeRatio - deposit,
  };
  const auctionPct = Math.round(SAFETY_RULES.auctionRatio * 100);
  if (seniorRoom.auction > 0) {
    notes.push(
      `근저당 허용선 ${man(seniorRoom.auction)} — 등기부 을구의 채권최고액 합계가 이보다 크면 경매(시세의 ${auctionPct}% 가정)에서 보증금이 모자랄 수 있습니다.`
    );
  } else {
    notes.push(
      `경매로 시세의 ${auctionPct}% 에 팔리면 근저당이 하나도 없어도 보증금이 ${man(-seniorRoom.auction)} 모자랍니다 — 등기부가 깨끗해야 하는 것은 물론이고 보증보험이 사실상 필수입니다.`
    );
  }

  /*
   * 1년 전 분기와 견줍니다. 같은 분기가 비어 있으면 그보다 앞선 가장 가까운
   * 분기를 씁니다 — 그래도 없으면 추세를 내지 않습니다.
   */
  const prior = size.points
    .filter((p) => p.q <= last.q - 4)
    .reduce<(typeof size.points)[number] | null>((a, b) => (!a || b.q > a.q ? b : a), null);
  const priceTrend =
    prior && prior.price > 0
      ? {
          change: last.price / prior.price - 1,
          from: quarterLabel(prior.q),
          to: quarterLabel(last.q),
        }
      : null;
  if (priceTrend && priceTrend.change <= -0.05) {
    notes.push(
      `매매가가 ${priceTrend.from} → ${priceTrend.to} 사이 ${(priceTrend.change * 100).toFixed(0)}% 움직였습니다 — 떨어지는 중이면 같은 전세가율도 여유가 줄어듭니다.`
    );
  }
  if (last.n < MIN_SALE_DEALS) {
    notes.push(`매매가 ${last.n}건뿐이라 그 값 자체가 흔들립니다 — 비율을 세게 읽지 마세요.`);
  }
  if (stale >= 4) {
    notes.push(`매매 거래가 ${stale}분기 전입니다. 그 사이 값이 움직였다면 이 비율도 달라집니다.`);
  }
  notes.push(
    '선순위 근저당은 이 자료에 없습니다. 전세가율이 낮아도 집에 대출이 잡혀 있으면 위험합니다 — 실제 판단은 등기부등본에서 갈립니다.'
  );

  return {
    ratio,
    salePrice: last.price,
    saleDeals: last.n,
    saleQuarter: quarterLabel(last.q),
    saleStaleQuarters: stale,
    grade,
    seniorRoom,
    priceTrend,
    headline:
      grade === 'danger'
        ? `전세가율 ${(ratio * 100).toFixed(0)}% — 집값에 바싹 붙어 있습니다`
        : grade === 'high'
          ? `전세가율 ${(ratio * 100).toFixed(0)}% — 여유가 크지 않습니다`
          : `전세가율 ${(ratio * 100).toFixed(0)}%`,
    notes,
  };
}

/** 이 축이 못 하는 것 — 화면에 늘 붙습니다. */
export const SAFETY_CAVEATS = [
  '전세가율은 "집값 대비 보증금" 일 뿐입니다. 실제 안전은 선순위 근저당·임대인 세금 체납·건물 유형에서 갈리고, 그건 등기부등본과 납세증명으로만 봅니다.',
  '매매 중위가는 같은 단지·평형의 최근 실거래입니다 — 거래가 얇거나 오래됐으면 비율도 그만큼 흔들립니다.',
  '보증보험(HUG·HF) 가입 가능 여부는 공시가격 기준이라 이 자료로 판정할 수 없습니다. 계약 전에 반드시 가입 가능한지 확인하세요.',
  '전세가율이 낮다고 좋은 집이라는 뜻이 아닙니다 — 매매가가 높은 동네일 뿐일 수도 있습니다.',
];

/**
 * 계약 전에 서류로 확인할 것 — **융자 여부는 여기서 갈립니다.**
 *
 * 자료로 못 재는 것을 자료인 척하지 않는 대신, 무엇을 어디서 보면 되는지를
 * 순서대로 적습니다. 근저당 허용선은 두 번째 줄에서 쓰입니다.
 */
export const REGISTRY_CHECKLIST: { what: string; where: string; look: string }[] = [
  {
    what: '소유자',
    where: '등기부등본 갑구 (인터넷등기소 열람)',
    look: '계약하는 사람이 소유자 본인인지. 신탁·가압류·가처분·경매개시결정이 있으면 멈춥니다.',
  },
  {
    what: '근저당 (융자)',
    where: '등기부등본 을구',
    look: '채권최고액 합계를 후보 카드의 "근저당 허용선" 과 견줍니다. 채권최고액 ÷ 1.2 가 대략의 실제 대출입니다.',
  },
  {
    what: '임대인 세금 체납',
    where: '임대인 국세·지방세 완납증명 (계약 전 요구 가능)',
    look: '체납 세금은 보증금보다 먼저 가져갑니다. 등기부에 안 나옵니다.',
  },
  {
    what: '먼저 들어온 세입자',
    where: '전입세대 열람 · 확정일자 부여현황',
    look: '다가구·오피스텔은 앞선 세입자 보증금이 선순위입니다. 아파트는 대개 해당 없음.',
  },
  {
    what: '보증보험 가입 가능',
    where: 'HUG 안심전세 앱 · 은행 창구',
    look: '가입이 안 된다고 나오면 그 자체가 신호입니다. 전세대출도 보증기관 보증이 있어야 나옵니다.',
  },
  {
    what: '잔금일 당일 재확인',
    where: '등기부등본 (잔금 직전 다시 열람)',
    look: '계약 뒤 잔금 전에 근저당을 새로 잡는 사고가 있습니다. 특약에 "잔금일까지 권리변동 없음" 을 넣습니다.',
  },
];
