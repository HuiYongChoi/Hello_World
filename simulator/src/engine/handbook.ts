/**
 * 대출 설명서 — **지금 이 룰셋이 무엇을 말하고 있는지**를 사람 말로 폅니다.
 *
 * 매트릭스는 "3.2억, 은행 주담대" 라는 결론만 줍니다. 그 상품이 무엇을 요구하고
 * 무엇을 막는지는 룰셋 JSON 안에 숫자로만 있어서, 화면을 보다가 "디딤돌이
 * 뭐였더라" 가 되면 코드를 열어야 했습니다. 이 모듈이 그 JSON 을 그대로 펴서
 * 왼쪽 서랍에 담습니다.
 *
 * ## 문구는 코드에, 숫자는 룰셋에
 *
 * 이 저장소의 첫 번째 분리 원칙입니다. 여기에는 **어떤 항목이 무슨 뜻인지**만
 * 적고, 값은 전부 `RULES` 에서 읽습니다. 규정이 바뀌면 JSON 만 갈아 끼우면
 * 설명서도 같이 바뀝니다.
 *
 * ## 룰셋에 새 항목이 생기면 설명서에 저절로 나타납니다
 *
 * 알려진 키는 라벨을 붙여 예쁘게 내고, **모르는 키는 키 이름 그대로라도
 * 냅니다.** 설명서가 조용히 빠뜨리면 "이 상품엔 그 조건이 없구나" 로 잘못
 * 읽히기 때문입니다. 빠뜨리지 않는 쪽이 못생긴 쪽보다 낫습니다.
 */

import { money, percent } from './format';
import { RULES } from './rules';
import type { ProductRule } from './rules';

export type HandbookCategory = 'premise' | 'purchase' | 'lease' | 'subscription';

export interface HandbookRow {
  key: string;
  label: string;
  value: string;
  /** 이 숫자가 왜 중요한지 */
  note?: string;
  /** 룰셋에 있는데 라벨을 못 붙인 항목 */
  unlabeled?: boolean;
}

export interface HandbookSection {
  title: string;
  rows: HandbookRow[];
}

export interface HandbookEntry {
  id: string;
  category: HandbookCategory;
  name: string;
  shortName: string;
  /** 목록에 한 줄로 보이는 요약 */
  headline: string;
  sections: HandbookSection[];
  /** 놓치면 손해 보는 것 */
  watchOuts: string[];
}

export const HANDBOOK_CATEGORY_LABEL: Record<HandbookCategory, string> = {
  premise: '먼저 읽을 것',
  purchase: '매매 — 주택담보대출',
  lease: '전세 — 임차보증금 대출',
  subscription: '청약 — 분양 납입',
};

const years = (v: number) => `${v}년`;
const months = (v: number) => `${v}개월`;
const sqm = (v: number) => `전용 ${v}㎡`;
const yesNo = (v: boolean, y: string, n: string) => (v ? y : n);

/**
 * 알려진 룰셋 키의 라벨과 뜻.
 *
 * `format` 은 값을 사람이 읽는 문자열로 바꿉니다. `note` 는 **그래서 뭐가
 * 달라지는지**를 적습니다 — 숫자만 있으면 크고 작음을 판단할 기준이 없습니다.
 */
const FIELD: Record<
  string,
  { label: string; format: (v: never) => string; note?: string }
> = {
  // ── 자격 ──────────────────────────────────────────────────────────
  income_max: {
    label: '부부합산 연소득 상한',
    format: (v: number) => `${money(v)} 이하`,
    note: '세전 기준입니다. 넘으면 상품 자체가 막히므로 한도가 아니라 자격 문제입니다.',
  },
  networth_max: {
    label: '순자산 상한',
    format: (v: number) => `${money(v)} 이하`,
    note: '전세보증금·예금·차량까지 포함한 가구 순자산입니다.',
  },
  house_price_max: {
    label: '주택가격 상한',
    format: (v: number) => `${money(v)} 이하`,
    note: '실거래가 기준입니다. 이 선을 넘는 물건은 이 상품으로 못 삽니다.',
  },
  house_price_max_single: {
    label: '주택가격 상한 (단독세대주)',
    format: (v: number) => `${money(v)} 이하`,
    note: '혼인 전 단독세대주면 가격 상한이 따로 걸립니다.',
  },
  area_max_sqm: {
    label: '전용면적 상한',
    format: (v: number) => `${sqm(v)} 이하`,
  },
  area_max_sqm_single: {
    label: '전용면적 상한 (단독세대주)',
    format: (v: number) => `${sqm(v)} 이하`,
  },
  requires_first_time: {
    label: '생애최초 요건',
    format: (v: boolean) => yesNo(v, '필요', '불필요'),
    note: '세대 구성원 전원이 과거 주택 소유 이력이 없어야 합니다.',
  },
  requires_no_house_household: {
    label: '무주택 세대 요건',
    format: (v: boolean) => yesNo(v, '필요', '불필요'),
  },
  min_age_if_single_household: {
    label: '단독세대주 최소 연령',
    format: (v: number) => `만 ${v}세 이상`,
    note: '혼인 전 단독세대주는 나이로도 걸립니다.',
  },
  requires_newborn_within_2y: {
    label: '신생아 요건',
    format: (v: boolean) => yesNo(v, '2년 이내 출산·입양 필요', '불필요'),
    note: '대출 신청일 기준 2년 안에 아이가 생겨야 합니다 — 임신 중은 안 됩니다.',
  },
  income_max_single: {
    label: '연소득 상한 (일반)',
    format: (v: number) => `${money(v)} 이하`,
  },
  income_max_newlywed: {
    label: '연소득 상한 (신혼)',
    format: (v: number) => `${money(v)} 이하`,
    note: '혼인 여부로 소득 문턱이 갈립니다 — 혼인 시점이 자격을 바꾸는 지점입니다.',
  },
  newlywed_single_earner_rule: {
    label: '신혼 외벌이 단서',
    format: (v: boolean) => yesNo(v, '적용', '없음'),
    note: '외벌이 신혼은 완화된 상한을 못 쓰고 일반 상한으로 돌아갑니다.',
  },
  newlywed_single_earner_max: {
    label: '신혼 외벌이 소득 상한',
    format: (v: number) => `${money(v)} 이하`,
  },
  newlywed_income_effective_from: {
    label: '신혼 소득완화 시행일',
    format: (v: string) => `${v}부터`,
    note: '이 날짜 전에 신청하면 완화 전 기준으로 봅니다 — 며칠 차이로 자격이 갈립니다.',
  },

  // ── 한도 ──────────────────────────────────────────────────────────
  cap: {
    label: '대출 절대상한',
    format: (v: number) => money(v),
    note: 'LTV·상환능력을 다 통과해도 이 금액을 넘지 못합니다.',
  },
  cap_first_time: {
    label: '절대상한 (생애최초)',
    format: (v: number) => money(v),
    note: '생애최초는 자격 요건이 아니라 우대 조건인 상품이 있습니다 — 아니어도 받되 한도가 줄어듭니다.',
  },
  cap_single_household: {
    label: '절대상한 (단독세대주)',
    format: (v: number) => money(v),
    note: '혼인 전이면 한도가 이만큼으로 줄어듭니다 — 혼인 시점이 결론을 바꾸는 지점입니다.',
  },
  cap_capital: {
    label: '절대상한 (수도권)',
    format: (v: number) => money(v),
    note: '수도권 물건은 이 상한이 따로 걸립니다.',
  },
  ltv_non_capital: {
    label: 'LTV — 비수도권',
    format: (v: number) => percent(v, 0),
    note: '창원·부산이 여기입니다.',
  },
  ltv_capital: {
    label: 'LTV — 수도권',
    format: (v: number) => percent(v, 0),
    note: '경기 수도권이 여기입니다. 같은 사람이라도 물건 위치로 갈립니다.',
  },
  ltv_regulated: {
    label: 'LTV — 규제지역',
    format: (v: number) => percent(v, 0),
  },
  dti: {
    label: 'DTI',
    format: (v: number) => percent(v, 0),
    note: '연소득 대비 이 대출의 원리금 비율. 다른 빚은 안 봅니다.',
  },
  dsr: {
    label: 'DSR',
    format: (v: number) => percent(v, 0),
    note: '연소득 대비 **모든** 빚의 원리금 비율. 기존 대출이 여기서 걸립니다.',
  },
  dsr_exempt: {
    label: 'DSR 적용',
    format: (v: boolean) => yesNo(v, '면제 — DTI 로만 봅니다', '적용 — 기존 대출이 한도를 깎습니다'),
    note: '정책상품이 은행 상품보다 한도가 크게 나오는 가장 큰 이유입니다.',
  },
  stress_rate_add: {
    label: '스트레스 금리 가산',
    format: (v: number) => `+${percent(v, 2)}`,
    note: '상환능력을 잴 때 실제 금리에 이만큼 얹어서 계산합니다 — 그만큼 한도가 줄어듭니다.',
  },
  absolute_cap_capital: {
    label: '수도권 절대상한',
    format: (v: number) => money(v),
    note: '수도권 물건은 LTV 를 통과해도 이 금액을 넘지 못합니다.',
  },
  ltv_first_time_non_capital: {
    label: 'LTV — 비수도권 생애최초',
    format: (v: number) => percent(v, 0),
    note: '은행 상품에서는 생애최초여도 정책상품 80% 같은 우대가 없습니다.',
  },
  online_discount: {
    label: '온라인 신청 우대',
    format: (v: number) => `−${percent(v, 2)}`,
  },
  preferential_max: {
    label: '우대금리 최대',
    format: (v: number) => `−${percent(v, 2)}`,
    note: '청약저축·다자녀 등 조건을 모두 채웠을 때의 상한입니다.',
  },
  graduated_payment: {
    label: '체증식 상환',
    format: (v: boolean) => yesNo(v, '가능', '불가'),
    note: '초기 원금을 적게 갚아 월납이 가벼워집니다. 총이자는 늘어납니다.',
  },
  graduated_age_max: {
    label: '체증식 연령 상한',
    format: (v: number) => `만 ${v}세 이하`,
  },

  // ── 금리 ──────────────────────────────────────────────────────────
  min: { label: '금리 하단', format: (v: number) => percent(v, 2) },
  max: { label: '금리 상단', format: (v: number) => percent(v, 2) },
  first_time_discount: {
    label: '생애최초 우대',
    format: (v: number) => `−${percent(v, 2)}`,
  },
  newborn_discount: { label: '신생아 우대', format: (v: number) => `−${percent(v, 2)}` },
  base: { label: '기준금리', format: (v: number) => percent(v, 2) },

  // ── 의무 ──────────────────────────────────────────────────────────
  move_in_months: {
    label: '전입 의무',
    format: (v: number) => `${months(v)} 이내`,
    note: '어기면 대출이 회수됩니다. 세입자를 낀 채로는 못 삽니다.',
  },
  residency_years: {
    label: '실거주 의무',
    format: (v: number) => (v > 0 ? `${years(v)}` : '없음'),
    note: '이 기간에는 전세를 놓을 수 없습니다 — 갭투자가 막히는 지점입니다.',
  },

  // ── 특징 ──────────────────────────────────────────────────────────
  fixed_rate: {
    label: '금리 방식',
    format: (v: boolean) => yesNo(v, '고정', '변동'),
  },
  early_repayment_fee: {
    label: '중도상환수수료',
    format: (v: boolean) => yesNo(v, '있음', '없음'),
  },
};

function toRows(source: Record<string, unknown> | undefined): HandbookRow[] {
  if (!source) return [];
  const rows: HandbookRow[] = [];
  for (const [key, raw] of Object.entries(source)) {
    if (raw === undefined || raw === null) continue;
    const spec = FIELD[key];
    if (spec) {
      rows.push({
        key,
        label: spec.label,
        value: spec.format(raw as never),
        note: spec.note,
      });
    } else {
      // 라벨을 못 붙였어도 냅니다 — 빠뜨리면 "그 조건이 없다" 로 읽힙니다.
      rows.push({
        key,
        label: key,
        value: typeof raw === 'boolean' ? yesNo(raw, '예', '아니오') : String(raw),
        unlabeled: true,
      });
    }
  }
  return rows;
}

function productEntry(p: ProductRule): HandbookEntry {
  const ltvNon = p.limits.ltv_non_capital as number | undefined;
  const ltvCap = p.limits.ltv_capital as number | undefined;
  const cap = p.limits.cap as number | undefined;

  const headline =
    p.type === 'policy'
      ? `정책상품 · 비수도권 LTV ${ltvNon ? percent(ltvNon, 0) : '—'} · 한도 ${cap ? money(cap) : '—'}`
      : `은행상품 · 자격 제한 없음 · DSR 로 한도가 갈립니다`;

  const watchOuts: string[] = [];
  if (p.limits.dsr_exempt) {
    watchOuts.push(
      'DSR 면제라 기존 대출이 있어도 한도가 덜 깎입니다. 은행 상품과 한도 차이가 여기서 납니다.'
    );
  } else {
    watchOuts.push(
      'DSR 이 적용됩니다. 신용대출·카드론이 있으면 그만큼 주담대 한도가 줄어듭니다.'
    );
  }
  if (ltvNon && ltvCap && ltvNon !== ltvCap) {
    watchOuts.push(
      `같은 조건이라도 **물건이 어느 권역이냐로 LTV 가 ${percent(ltvNon, 0)} ↔ ${percent(ltvCap, 0)} 로 갈립니다.** 지역 선택이 곧 대출 조건 선택입니다.`
    );
  }
  const ftLtv = p.limits.ltv_first_time_non_capital as number | undefined;
  const ftCap = p.limits.cap_first_time as number | undefined;
  if (!p.eligibility.requires_first_time && (ftLtv || ftCap)) {
    const parts = [
      ftLtv && ltvNon ? `LTV ${percent(ltvNon, 0)} → ${percent(ftLtv, 0)}` : '',
      ftCap && cap ? `한도 ${money(cap)} → ${money(ftCap)}` : '',
    ].filter(Boolean);
    watchOuts.push(
      `**생애최초는 자격 요건이 아니라 우대 조건입니다.** 아니어도 받을 수 있고, 대신 ${parts.join(' · ')} 로 갈립니다.`
    );
  }
  if (p.limits.cap_single_household && p.limits.cap) {
    watchOuts.push(
      `혼인 전 단독세대주면 한도가 ${money(p.limits.cap as number)} → ${money(p.limits.cap_single_household as number)} 로 줄어듭니다.`
    );
  }
  if (p.obligations.residency_years > 0) {
    watchOuts.push(
      `실거주 ${p.obligations.residency_years}년 의무가 붙습니다 — 그 기간에는 전세를 놓을 수 없습니다.`
    );
  }

  return {
    id: p.id,
    category: 'purchase',
    name: p.name,
    shortName: p.shortName,
    headline,
    sections: [
      { title: '자격 — 못 넘으면 상품 자체가 막힙니다', rows: toRows(p.eligibility) },
      { title: '한도 — 얼마까지 빌려주나', rows: toRows(p.limits) },
      { title: '금리', rows: toRows(p.rate) },
      { title: '의무 — 받은 뒤에 지켜야 할 것', rows: toRows(p.obligations) },
      { title: '특징', rows: toRows(p.features) },
    ].filter((s) => s.rows.length > 0),
    watchOuts,
  };
}

function premiseEntry(): HandbookEntry {
  const rows: HandbookRow[] = RULES.regions.map((r) => ({
    key: r.id,
    label: r.label,
    value: r.isCapitalArea ? '수도권' : '비수도권',
    note: r.note,
  }));

  return {
    id: 'region-ltv',
    category: 'premise',
    name: '지역 = 대출조건',
    shortName: '지역',
    headline: '같은 소득·같은 생애최초라도 물건 위치로 LTV 가 갈립니다',
    sections: [
      { title: '이 도구가 다루는 세 권역', rows },
      {
        title: '규제지역',
        rows: [
          {
            key: 'regulated',
            label: '규제지역 시군구',
            value: RULES.regulatedSigungu.length
              ? RULES.regulatedSigungu.join(' · ')
              : '없음',
            note: '규제지역이면 LTV 가 한 번 더 깎입니다.',
          },
        ],
      },
    ],
    watchOuts: [
      '생애최초 우대는 **비수도권에서만** 살아 있습니다. 경기 수도권 물건은 우대를 받아도 70% 가 상한입니다.',
      '비수도권 80% 는 항상 유리한 것이 아닙니다 — 가격상승률이 금리를 밑돌면 많이 빌릴수록 손실이 커집니다.',
    ],
  };
}

function jeonseEntry(): HandbookEntry {
  const j = RULES.tenure.jeonseLoan;
  const l = RULES.tenure.lease;
  return {
    id: 'jeonse-loan',
    category: 'lease',
    name: '전세자금대출 · 주택임대차보호법',
    shortName: '전세',
    headline: `보증금의 ${percent(j.ltvCap, 0)} · 최대 ${money(j.absoluteCap)} · 이자만 냅니다`,
    sections: [
      {
        title: '전세자금대출',
        rows: [
          {
            key: 'ltvCap',
            label: '보증금 대비 한도',
            value: percent(j.ltvCap, 0),
            note: '나머지는 자기 돈으로 채워야 합니다 — 전세도 목돈이 듭니다.',
          },
          { key: 'absoluteCap', label: '절대상한', value: money(j.absoluteCap) },
          {
            key: 'rate',
            label: '금리',
            value: percent(j.rate, 2),
            note: '만기일시 상환이라 원금은 안 갚고 이자만 냅니다. 매수의 원리금과 대칭이 아닙니다.',
          },
        ],
      },
      {
        title: '주택임대차보호법 — 계약을 지켜 주는 규정',
        rows: [
          {
            key: 'renewalYears',
            label: '갱신 기간',
            value: years(l.renewalYears),
            note: '계약갱신청구권으로 한 번 더 살 수 있습니다.',
          },
          {
            key: 'renewalCapRatio',
            label: '갱신 증액 상한',
            value: percent(l.renewalCapRatio, 0),
            note: `그 갱신 ${l.renewalCapUses}회에만 걸립니다. 새 계약은 상한이 없습니다.`,
          },
          {
            key: 'conversionRateMax',
            label: '전월세전환율 상한',
            value: percent(l.conversionRateMax, 0),
            note: '보증금을 월세로 바꿀 때의 법정 상한입니다. 실제 시장 전환율은 실거래로 따로 잽니다.',
          },
        ],
      },
    ],
    watchOuts: [
      '전세는 원금을 갚지 않으므로, 매수와 견주려면 **덜 쓴 만큼을 적립**해야 비교가 대등해집니다 — 3-way 화면이 그렇게 계산합니다.',
      '갱신 증액분은 대출을 늘리는 것이 아니라 모아 둔 돈을 헐어 채운다고 봅니다.',
      `증액 상한 ${percent(l.renewalCapRatio, 0)} 는 갱신청구권을 쓴 ${l.renewalCapUses}회에만 걸립니다. 그 다음 계약은 시세대로 오릅니다.`,
    ],
  };
}

function subscriptionEntry(): HandbookEntry {
  const s = RULES.subscription;
  return {
    id: 'subscription',
    category: 'subscription',
    name: '청약 — 분양 납입 구조',
    shortName: '청약',
    headline: `계약금 ${percent(s.downPaymentRatio, 0)} → 중도금 ${percent(s.interimRatio, 0)}(${s.interimInstallments}회) → 잔금 ${percent(s.balanceRatio, 0)}`,
    sections: [
      {
        title: '납입 구조 — 단지마다 다릅니다',
        rows: [
          {
            key: 'downPaymentRatio',
            label: '계약금',
            value: percent(s.downPaymentRatio, 0),
            note: '대출이 안 됩니다. 청약의 진짜 문턱은 분양가가 아니라 이 돈입니다.',
          },
          {
            key: 'interimRatio',
            label: '중도금',
            value: `${percent(s.interimRatio, 0)} · ${s.interimInstallments}회 분할`,
            note: s.interimNote,
          },
          { key: 'interimLoanRate', label: '중도금 금리', value: percent(s.interimLoanRate, 2) },
          {
            key: 'balanceRatio',
            label: '잔금',
            value: percent(s.balanceRatio, 0),
            note: '입주 때 주담대로 전환합니다 — 그때의 LTV·금리가 다시 걸립니다.',
          },
          {
            key: 'defaultResaleBanMonths',
            label: '전매제한 (기본값)',
            value: months(s.defaultResaleBanMonths),
            note: '단지 공고에만 있는 값이라 화면에서 직접 넣습니다.',
          },
        ],
      },
    ],
    watchOuts: [
      s.waitTenureNote,
      '이자후불제는 대기 중 월 부담을 낮추고 입주 목돈을 키웁니다. 총액은 같습니다.',
      '청약 갈래가 1등이어도 **당첨을 전제**한 결과입니다. 나머지 셋은 같은 집인데 청약만 다른 집입니다.',
    ],
  };
}

/** 설명서 전체. 목록 순서가 곧 읽는 순서입니다. */
export function handbookEntries(): HandbookEntry[] {
  return [
    premiseEntry(),
    ...RULES.products.map(productEntry),
    jeonseEntry(),
    subscriptionEntry(),
  ];
}

export function findHandbookEntry(id: string): HandbookEntry | null {
  return handbookEntries().find((e) => e.id === id) ?? null;
}

/** 화면 하단·서랍 머리에 상시 노출하는 기준일. */
export const HANDBOOK_META = {
  version: RULES.version,
  effectiveFrom: RULES.effectiveFrom,
  sunset: RULES.sunset,
  label: RULES.label,
  disclaimer: RULES.disclaimer,
};
