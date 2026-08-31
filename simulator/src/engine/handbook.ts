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

import { money, percent, withParticle } from './format';
import { incomeNeededFor, repayCapacity } from './loan';
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
    note: '연소득 대비 모든 빚의 원리금 비율. 기존 대출이 여기서 걸립니다.',
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
      `같은 조건이라도 물건이 어느 권역이냐로 LTV 가 ${percent(ltvNon, 0)} ↔ ${percent(ltvCap, 0)} 로 갈립니다. 지역 선택이 곧 대출 조건 선택입니다.`
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
      `생애최초는 자격 요건이 아니라 우대 조건입니다. 아니어도 받을 수 있고, 대신 ${parts.join(' · ')} 로 갈립니다.`
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
      '생애최초 우대는 비수도권에서만 살아 있습니다. 경기 수도권 물건은 우대를 받아도 70% 가 상한입니다.',
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
          {
            /*
             * 매매와 같은 구조입니다 — 보증금이 오르면 대출도 오르다가 절대상한에서
             * 멈추고, 그 위로는 전부 자기 돈입니다. 전세도 목돈이 드는 지점입니다.
             */
            key: 'ceiling',
            label: '대출이 멈추는 보증금',
            value: `${money(j.absoluteCap / j.ltvCap)}부터 ${money(j.absoluteCap)}에서 멈춤`,
            note: '보증금이 그보다 크면 오른 만큼이 전부 자기 돈입니다. 전세도 목돈이 드는 지점이 여기입니다.',
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
      '전세는 원금을 갚지 않으므로, 매수와 견주려면 덜 쓴 만큼을 적립해야 비교가 대등해집니다 — 3-way 화면이 그렇게 계산합니다.',
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
      '청약 갈래가 1등이어도 당첨을 전제한 결과입니다. 나머지 셋은 같은 집인데 청약만 다른 집입니다.',
    ],
  };
}

/**
 * 내 조건 — 설명서를 **내 숫자로** 읽기 위한 최소 입력.
 *
 * 물건은 안 받습니다. 물건을 받으면 LTV 가 끼어들어 매트릭스와 같은 계산이
 * 되는데, 여기서 묻는 것은 **"이 상품의 한도를 다 받으려면 얼마를 벌어야 하나"**
 * 라 상품 자체의 성질입니다.
 */
export interface HandbookContext {
  termYears: number;
  existingMonthlyDebt: number;
  isFirstTimeValid: boolean;
  rateAdjust?: number;
  /** 지금 판정소득 — 있으면 부족액까지 냅니다 */
  assessedIncome?: number;
}

/**
 * **"이 한도를 다 받으려면 연소득이 얼마여야 하나."**
 *
 * 설명서는 DTI 60% · DSR 40% 같은 비율만 보여 줍니다. 비율은 그 자체로는
 * 크고 작음을 판단할 기준이 없습니다 — 원 단위로 바꿔야 "내 소득으로 되나" 가
 * 답해집니다.
 *
 * 정책상품에서는 여기서 **소득으로 뚫을 수 없는 구간**이 드러납니다. 필요소득이
 * 자격 상한을 넘으면, 소득을 올리는 순간 상품을 잃기 때문입니다.
 */
function capIncomeSection(p: ProductRule, ctx: HandbookContext): HandbookSection | null {
  const targets: { key: string; label: string; amount: number }[] = [];
  const cap = p.limits.cap as number | undefined;
  const capFirst = p.limits.cap_first_time as number | undefined;
  const capSingle = p.limits.cap_single_household as number | undefined;
  if (cap) targets.push({ key: 'cap', label: '절대상한까지 받으려면', amount: cap });
  if (capFirst)
    targets.push({ key: 'cap_first_time', label: '생애최초 상한까지 받으려면', amount: capFirst });
  if (capSingle)
    targets.push({
      key: 'cap_single_household',
      label: '단독세대주 상한까지 받으려면',
      amount: capSingle,
    });
  if (targets.length === 0) return null;

  const incomeCap =
    (p.eligibility.income_max as number | undefined) ??
    (p.eligibility.income_max_newlywed as number | undefined) ??
    (p.eligibility.income_max_single as number | undefined) ??
    null;
  const kind = p.limits.dsr_exempt ? 'DTI' : 'DSR';
  const ratio = (p.limits.dsr_exempt ? p.limits.dti : p.limits.dsr) as number;

  const rows: HandbookRow[] = targets.map((t) => {
    const need = incomeNeededFor(p, t.amount, {
      termYears: ctx.termYears,
      existingMonthlyDebt: ctx.existingMonthlyDebt,
      isFirstTimeValid: ctx.isFirstTimeValid,
      rateAdjust: ctx.rateAdjust,
    });
    const blocked = incomeCap !== null && need > incomeCap;
    const gap = ctx.assessedIncome !== undefined ? need - ctx.assessedIncome : null;
    const note = blocked
      ? `자격 상한 ${money(incomeCap)}를 넘습니다 — 소득을 올리면 한도가 아니라 상품을 잃습니다. 이 상한까지는 어떤 소득으로도 못 갑니다.`
      : gap === null
        ? undefined
        : gap > 0
          ? `지금 판정소득보다 ${money(gap)} 모자랍니다.`
          : '지금 소득으로 이미 닿습니다.';
    return {
      key: `need_${t.key}`,
      label: `${t.label} (${money(t.amount)})`,
      value: `연소득 ${money(need)}`,
      note,
    };
  });

  return {
    title: `이 한도를 받으려면 — ${kind} ${percent(ratio, 0)} · ${ctx.termYears}년 만기 기준`,
    rows,
  };
}

/**
 * **가격을 올려도 대출이 안 늘어나는 지점.**
 *
 * 주택가격 상한(자격선)과 대출 절대상한(빌릴 수 있는 최대)은 다른 축인데,
 * 설명서에서 둘이 각각 다른 줄에만 적혀 있으면 "6억까지 가능" 이 "6억을
 * 빌려준다" 로 읽힙니다. 이어서 읽는 일을 사용자에게 맡기지 않습니다.
 *
 * ```
 * 대출액   = min(LTV×가격, 상품캡, 상환능력, 가격상한)
 *            ↑가격에 비례    ↑둘 다 가격과 무관
 * 천장가격 = min(상품캡, 상환능력) ÷ LTV
 * ```
 *
 * LTV 가 지역·생애최초로 갈리므로 **줄도 그만큼 갈라** 냅니다 — 같은 상품이라도
 * 창원이냐 경기냐로 천장이 다릅니다.
 */
function loanCeilingSection(p: ProductRule, ctx: HandbookContext): HandbookSection | null {
  const lim = p.limits;
  const capGeneral = (lim.cap as number | undefined) ?? Number.POSITIVE_INFINITY;
  const capFirst = (lim.cap_first_time as number | undefined) ?? capGeneral;
  const capCapital = Math.min(
    (lim.absolute_cap_capital as number | undefined) ?? Number.POSITIVE_INFINITY,
    capGeneral
  );
  const priceMax = p.eligibility.house_price_max as number | undefined;

  const repay = repayCapacity(p, {
    assessedIncome: ctx.assessedIncome ?? 0,
    termYears: ctx.termYears,
    existingMonthlyDebt: ctx.existingMonthlyDebt,
    isFirstTimeValid: ctx.isFirstTimeValid,
    rateAdjust: ctx.rateAdjust,
  });

  const tiers: { key: string; label: string; ltv: number | undefined; cap: number }[] = [
    {
      key: 'ceil_non_capital_first',
      label: '비수도권 · 생애최초',
      ltv: lim.ltv_first_time_non_capital as number | undefined,
      cap: capFirst,
    },
    {
      key: 'ceil_non_capital',
      label: '비수도권 (창원·부산)',
      ltv: lim.ltv_non_capital as number | undefined,
      cap: capGeneral,
    },
    {
      key: 'ceil_capital',
      label: '수도권 (경기)',
      ltv: lim.ltv_capital as number | undefined,
      cap: capCapital,
    },
  ];

  /*
   * 같은 값이 나오는 지역은 **한 줄로 합칩니다.** 은행 상품은 세 지역 LTV 가
   * 모두 70% 라 따로 적으면 똑같은 줄이 셋이고, 그러면 읽는 사람이 "왜 셋을
   * 나눠 놨지" 를 먼저 고민하게 됩니다.
   */
  const merged = new Map<string, { labels: string[]; ltv: number; amount: number; key: string }>();
  for (const t of tiers) {
    if (!t.ltv) continue;
    const amount = Math.min(t.cap, repay > 0 ? repay : Number.POSITIVE_INFINITY);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const k = `${t.ltv}|${Math.round(amount)}`;
    const hit = merged.get(k);
    if (hit) hit.labels.push(t.label);
    else merged.set(k, { labels: [t.label], ltv: t.ltv, amount, key: t.key });
  }

  const rows: HandbookRow[] = [...merged.values()].map((m) => {
    const price = m.amount / m.ltv;
    const by =
      m.amount < (repay > 0 ? repay : Number.POSITIVE_INFINITY)
        ? '상품 절대상한'
        : `${lim.dsr_exempt ? 'DTI' : 'DSR'} 상환능력`;
    const note =
      priceMax !== undefined && price >= priceMax
        ? `주택가격 상한 ${money(priceMax)} 안에서는 안 걸립니다 — 여기서는 LTV 가 끝까지 천장입니다.`
        : `${withParticle(by, '이', '가')} 만든 천장입니다. 이 위로 오른 가격은 전부 자기 돈입니다` +
          (priceMax !== undefined
            ? ` — 상한 ${money(priceMax)}짜리를 사면 ${withParticle(money(priceMax - m.amount), '을', '를')} 현금으로 채워야 합니다.`
            : '.');
    /*
     * 라벨이 셋 다 합쳐지면 "비수도권 · 생애최초 · 비수도권 · 수도권" 이 되어
     * 읽기 어렵습니다. 합쳐진 만큼 이름을 줄입니다.
     */
    const label =
      m.labels.length === 3
        ? '전 지역'
        : m.labels.length === 2 && m.labels.every((l) => l.startsWith('비수도권'))
          ? '비수도권 (창원·부산)'
          : m.labels.join(' · ');
    return {
      key: m.key,
      label: `${label} · LTV ${percent(m.ltv, 0)}`,
      value: `${money(price)}부터 ${money(m.amount)}에서 멈춤`,
      note,
    };
  });
  if (rows.length === 0) return null;

  return { title: '가격을 올려도 대출이 안 늘어나는 지점', rows };
}

/** 설명서 전체. 목록 순서가 곧 읽는 순서입니다. */
export function handbookEntries(ctx?: HandbookContext): HandbookEntry[] {
  return [
    premiseEntry(),
    ...RULES.products.map((p) => {
      const entry = productEntry(p);
      if (!ctx) return entry;
      const extras = [loanCeilingSection(p, ctx), capIncomeSection(p, ctx)].filter(
        (x): x is HandbookSection => x !== null
      );
      return extras.length ? { ...entry, sections: [...entry.sections, ...extras] } : entry;
    }),
    jeonseEntry(),
    subscriptionEntry(),
  ];
}

export function findHandbookEntry(id: string, ctx?: HandbookContext): HandbookEntry | null {
  return handbookEntries(ctx).find((e) => e.id === id) ?? null;
}

/** 화면 하단·서랍 머리에 상시 노출하는 기준일. */
export const HANDBOOK_META = {
  version: RULES.version,
  effectiveFrom: RULES.effectiveFrom,
  sunset: RULES.sunset,
  label: RULES.label,
  disclaimer: RULES.disclaimer,
};
