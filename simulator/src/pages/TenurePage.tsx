import { useMemo, useState, type ReactNode } from 'react';
import {
  Badge,
  Card,
  Empty,
  Field,
  NumberInput,
  ProvenanceValue,
  Select,
  Stat,
  TierBadge,
} from '../components/ui';
import { money, percent } from '../engine/format';
import { growthSuggestion } from '../engine/growth';
import { REPAIR, REPAIR_CAVEATS, repairAnchor } from '../engine/repair';
import { cellKey } from '../engine/matrix';
import { RULES } from '../engine/rules';
import type { RegionId } from '../engine/types';
import {
  compareAcrossReturns,
  compareTenures,
  defaultAssumptions,
  housingCostBreakdown,
  type TenureAssumptions,
  type TenureKind,
  type TenureLeg,
  SUBSCRIPTION_CAVEATS,
} from '../engine/tenure';
import {
  INDEXES,
  PROVENANCE_LABEL,
  RATES,
  investmentOptions,
  measuredInflation,
  toReal,
} from '../engine/indexes';
import { RENT, isMeasured } from '../engine/rent';
import { propertyThesis } from '../engine/thesis';
import { subscriptionLegPlan } from '../engine/subscription';
import { useStore } from '../state/store';

/**
 * 소수로 든 비율을 %로 보여주고 받는 입력.
 *
 * 실측값과 자리표시자가 같은 모양이면 인용되는 순간 구분이 사라집니다.
 * 가정값에는 **점선 밑줄과 "가정" 표식**을 붙이고 명도를 한 단 낮춥니다 —
 * 색이 아니라 획이라 흑백 인쇄와 색각 이상에서도 살아남습니다.
 */
/**
 * 수선유지비 실측 앵커 — **하한**입니다.
 *
 * 장기수선충당금만 잡히고 세대 내부 수선(도배·싱크대·보일러)은 빠져 있어서
 * 이 값으로 가정을 낮추면 매수 갈래가 부당하게 유리해집니다. 그래서
 * "가져오기" 를 두지 않고, 가정이 실측 하한의 **몇 배**인지만 보여줍니다.
 * 나머지가 정말 그만큼인지는 사람이 판단할 몫입니다.
 */
function RepairAnchor({
  region,
  sigungu,
  price,
  areaSqm,
  assumed,
}: {
  region: RegionId;
  sigungu?: string;
  price: number;
  areaSqm: number;
  assumed: number;
}) {
  const a = useMemo(
    () => repairAnchor(region, sigungu, price, areaSqm, assumed),
    [region, sigungu, price, areaSqm, assumed]
  );
  if (!a) return null;

  return (
    <div className="mt-1.5 rounded-lg border border-slate-800 bg-slate-950/50 px-2 py-1.5">
      <div
        className="text-[10px] leading-relaxed text-slate-500"
        title={
          `${a.scope} 기준 · 단지 ${a.stat.n}개 표본\n` +
          `장기수선충당금 중위 ${a.stat.median}원/㎡/월 (사분위 ${a.stat.p25}~${a.stat.p75})\n` +
          `이 물건 ㎡당 ${Math.round(a.pricePerSqm).toLocaleString('ko-KR')}원 기준으로 환산\n\n` +
          REPAIR_CAVEATS.map((c) => `· ${c}`).join('\n')
        }
      >
        실측 하한 <span className="text-slate-300 tabular-nums">{percent(a.measuredRate, 3)}</span>
        <span className="ml-1 text-slate-600">
          ({percent(a.lowRate, 3)}~{percent(a.highRate, 3)} · 단지 {a.stat.n}개)
        </span>
      </div>
      <div className="mt-0.5 text-[9px] leading-relaxed text-slate-600">
        지금 가정 {percent(assumed, 2)}는 그 하한의{' '}
        <b className="text-slate-400">{a.ratioToAssumed.toFixed(1)}배</b>입니다. 실측은{' '}
        <b className="text-slate-400">장기수선충당금만</b>이라 세대 내부 수선(도배·싱크대·보일러)이
        빠져 있습니다 — 값을 대신 넣지 않습니다.
      </div>
      {a.thin && (
        <div className="mt-0.5 text-[9px] text-amber-500/70">
          표본이 {a.stat.n}개뿐이라 중위값이 흔들립니다
        </div>
      )}
    </div>
  );
}

function RateField({
  label,
  source,
  assumed,
  help,
  value,
  onChange,
  step = 0.1,
  anchor,
}: {
  label: string;
  /** 실측이면 출처, 가정이면 무엇을 근거로 찍었는지 */
  source: string;
  assumed: boolean;
  /** 이 값이 무엇이고 어디에 어떻게 쓰이는지 — 마우스를 올리면 뜹니다 */
  help: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  /** 입력칸 아래에 붙는 실측 앵커 — 가정값 옆에 근거를 놓습니다 */
  anchor?: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5" title={help}>
        <span className="text-xs font-medium text-slate-300">{label}</span>
        <span className="text-slate-600">ⓘ</span>
        {assumed ? (
          <span className="rounded border border-slate-700 px-1 text-[9px] text-slate-500 print-plain">
            가정
          </span>
        ) : (
          <span className="text-[9px] text-slate-500">실측</span>
        )}
      </div>
      <div
        className={
          assumed
            ? 'underline decoration-slate-600 decoration-dotted underline-offset-[6px]'
            : undefined
        }
      >
        <NumberInput
          value={Number((value * 100).toFixed(2))}
          step={step}
          suffix="%"
          onChange={(v) => onChange(v / 100)}
        />
      </div>
      <span className="mt-1 block text-[10px] leading-relaxed text-slate-600">{source}</span>
      {anchor}
    </div>
  );
}

/**
 * 가정값 옆에 붙는 **실측 앵커**.
 *
 * 과거 CAGR 을 기본값으로 몰래 대입하지 않습니다 — 그러면 도구가 "이만큼
 * 오릅니다" 라고 말하는 것이 됩니다. 옆에 놓고 가져다 쓰게 합니다.
 *
 * 단일 CAGR 만 내면 "언제 들어갔느냐" 가 감춰지므로 같은 보유기간의 분포를
 * 같이 냅니다. 표본이 얇으면 얇다고 적습니다.
 */
function GrowthAnchor({
  region,
  years,
  current,
  onUse,
}: {
  region: RegionId;
  years: number;
  current: number;
  onUse: (v: number) => void;
}) {
  const s = useMemo(() => growthSuggestion(region, years), [region, years]);
  if (!s) return null;
  const same = Math.abs(current - s.cagr) < 0.0001;
  const d = s.distribution;

  return (
    <div className="mt-1.5 rounded-lg border border-slate-800 bg-slate-950/50 px-2 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] text-slate-500">
          실측 <span className="text-slate-300 tabular-nums">{percent(s.cagr, 2)}</span>
          <span className="ml-1 text-slate-600">
            ({s.years.toFixed(1)}년 · {s.cells.toLocaleString('ko-KR')}칸)
          </span>
        </span>
        <button
          type="button"
          disabled={same}
          onClick={() => onUse(s.cagr)}
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] transition no-print ${
            same
              ? 'text-slate-600'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100'
          }`}
        >
          {same ? '적용됨' : '가져오기'}
        </button>
      </div>
      {d && (
        <div
          className="mt-0.5 text-[9px] leading-relaxed text-slate-600"
          title={`${years}년 보유를 ${d.count}개 진입시점에서 각각 계산한 분포입니다. 중위 ${percent(
            d.median,
            2
          )} · 하위25% ${percent(d.p25, 2)} · 최악 ${percent(d.worst, 2)} · 최고 ${percent(d.best, 2)}.`}
        >
          {years}년 보유 중위 {percent(d.median, 1)} · 하위25% {percent(d.p25, 1)} · 최악{' '}
          {percent(d.worst, 1)}
          {d.thin && (
            <span className="ml-1 text-amber-500/70">{' · '}
              진입시점 {d.count}개뿐 — 분위수가 뭉개집니다
            </span>
          )}
        </div>
      )}
      <div className="mt-0.5 text-[9px] leading-relaxed text-slate-600">
        과거 실측일 뿐 예측이 아닙니다. 구간을 어디서 끊느냐로 크게 달라집니다.
      </div>
    </div>
  );
}

/**
 * 세 갈래 구분은 **색이 아니라 명도**로 합니다 — 가이드 07.
 *
 * 예전에는 매수=sky, 전세=emerald, 월세=amber 였는데, 같은 색이 화면 다른 곳에서
 * "선택됨"·"충족"·"경고"를 뜻합니다. 색이 두 가지를 뜻하면 둘 다 못 읽힙니다.
 * 계열 구분은 무채색 3단계로 옮기고, 색은 판정과 상태에만 남깁니다.
 */
const LEG_LABEL: Record<TenureKind, string> = {
  buy: '매수',
  jeonse: '전세',
  wolse: '월세',
  subscription: '청약',
};

/*
 * 청약은 무채색 4단계에 끼우지 않고 **점선 테두리**로 갈라 둡니다.
 * 나머지 셋은 같은 집이고 청약만 다른 집이라, 명도를 하나 더 늘려 나란히
 * 세우면 "같은 줄에 놓고 비교해도 되는 것" 처럼 읽힙니다.
 */
const TONE: Record<TenureKind, { bar: string; text: string; ring: string }> = {
  buy: { bar: 'bg-slate-100', text: 'text-slate-100', ring: 'border-slate-500 bg-slate-800/40' },
  jeonse: { bar: 'bg-slate-400', text: 'text-slate-300', ring: 'border-slate-600 bg-slate-800/30' },
  wolse: { bar: 'bg-slate-600', text: 'text-slate-400', ring: 'border-slate-700 bg-slate-800/20' },
  subscription: {
    bar: 'bg-slate-500',
    text: 'text-slate-300',
    ring: 'border-dashed border-slate-600 bg-slate-800/20',
  },
};

function Row({
  label,
  value,
  hint,
  tone,
  strong,
  help,
  indent,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  strong?: boolean;
  /** 마우스를 올렸을 때 뜨는 설명 */
  help?: string;
  indent?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-1 ${indent ? 'pl-3' : ''}`}
      title={help}
    >
      <span className={`text-[11px] ${strong ? 'text-slate-300' : 'text-slate-500'}`}>
        {label}
        {help && <span className="ml-1 text-slate-600">ⓘ</span>}
        {hint && <span className="ml-1 text-slate-600">{hint}</span>}
      </span>
      <span
        className={`tabular-nums ${strong ? 'text-sm font-semibold' : 'text-xs'} ${
          tone ?? 'text-slate-300'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** 단계 머리표 — ① 시작 ② 사는 동안 ③ 끝 */
function Stage({ n, title }: { n: string; title: string }) {
  return (
    <div className="mt-3 mb-1 flex items-center gap-1.5 border-t border-slate-800/70 pt-2.5">
      <span className="flex h-4 w-4 items-center justify-center rounded bg-slate-800 text-[9px] text-slate-400">
        {n}
      </span>
      <span className="text-[11px] font-medium text-slate-400">{title}</span>
    </div>
  );
}

/**
 * 한 갈래의 자금 흐름을 시간 순서로 세웁니다.
 *
 * 예전 카드는 "초기 투입"과 "주식 초기 투입"을 나란히 뒀는데, 둘 다 *투입*이라는
 * 말을 쓰면서 실제로는 **같은 목돈이 갈라지는 두 갈래**였습니다. 그래서 전세처럼
 * 보증금이 목돈을 다 먹은 경우 "투자 0원인데 적립 7천만"이 모순처럼 보였습니다.
 * 목돈(①)과 매달(②)을 시간축으로 분리하면 그 모순이 사라집니다.
 */
function LegCard({
  leg,
  best,
  max,
  equity,
  years,
  returnRate,
}: {
  leg: TenureLeg;
  best: boolean;
  max: number;
  equity: number;
  years: number;
  /** 이 계산에 쓰인 대체투자 수익률 — 수익 옆에 무엇 대비인지 적기 위해 */
  returnRate: number;
}) {
  const tone = TONE[leg.kind];
  const width = max > 0 ? Math.max(2, (leg.terminalWealth / max) * 100) : 0;
  const monthlyHousing = leg.housingCashOut / (years * 12);
  const monthlySaving = leg.netContribution / (years * 12);

  return (
    <div
      className={`rounded-xl border p-4 print-plain ${
        best ? tone.ring : 'border-slate-800 bg-slate-950/40'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">{leg.label}</h3>
        <div className="flex flex-wrap justify-end gap-1">
          {best && <TierBadge tier="cond" label="종료자산 최대" />}
          {!leg.feasible && <TierBadge tier="block" label="자금 부족" />}
          {leg.feasible && leg.liquidityRisk && <TierBadge tier="warn" label="중간에 잔고 소진" />}
        </div>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular-nums ${tone.text}`}>
          {money(leg.terminalWealth)}
        </span>
        <span className="text-[11px] text-slate-500">
          연환산 {percent(leg.annualizedReturn, 1)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${tone.bar}`} style={{ width: `${width}%` }} />
      </div>

      <Stage n="①" title={`목돈 ${money(equity)}을 어디에 두나`} />
      <Row
        label="주거에 묶임"
        hint={
          leg.kind === 'buy'
            ? '(자기부담금+취득비용)'
            : leg.kind === 'subscription'
              ? '(계약금+대기 중 보증금)'
              : '(보증금+중개보수)'
        }
        value={money(leg.initialOutlay)}
        help={
          leg.kind === 'subscription'
            ? `계약금 ${money(leg.detail.downPayment)} 과 입주까지 살 집의 보증금·중개보수 ${money(
                leg.detail.waitDeposit
              )} 입니다. 계약금은 대출이 안 되고, 그 집은 분양 단지가 아닌 다른 집입니다 — 청약의 진짜 문턱이 여기입니다.`
            : undefined
        }
      />
      <Row
        label="투자에 남김"
        hint="(주식·채권 등)"
        value={money(leg.initialInvestment)}
        tone={leg.initialInvestment > 0 ? 'text-slate-200' : 'text-slate-600'}
      />
      {!leg.feasible && (
        <Row label="모자란 돈" value={money(leg.shortfall)} tone="text-rose-300" />
      )}

      <Stage n="②" title={`${years}년 동안 매달`} />
      <Row
        label="통장에서 나감"
        hint={`(월 ${money(monthlyHousing)})`}
        value={money(leg.housingCashOut)}
        help={
          leg.kind === 'buy'
            ? '원리금(원금+이자) + 재산세 + 수선유지비의 합입니다. 이 중 원금은 비용이 아니라 저축이라 아래에서 갈라 놨습니다.'
            : leg.kind === 'jeonse'
              ? '전세자금대출 이자만 나갑니다. 대출이 없으면 0원입니다.'
              : leg.kind === 'subscription'
                ? '입주 전에는 대기 중 주거비와 중도금 이자, 입주 후에는 원리금과 보유비가 나갑니다. 두 국면이 이어져 있어 월 평균은 참고치입니다.'
                : '월세만 나갑니다. 돌려받지 못하는 순비용입니다.'
        }
      />
      {leg.principalRepaid > 0 && (
        <Row
          indent
          label="└ 원금상환 (저축)"
          value={money(leg.principalRepaid)}
          tone="text-slate-200"
          help={`대출 원금을 갚은 금액입니다. 나가는 돈이지만 잔여대출이 그만큼 줄어 ③의 “집 팔고 받는 돈”에 그대로 남습니다 — 비용이 아니라 저축입니다. 이 금액만큼 임차 쪽도 투자하게 해야 비교가 성립합니다.`}
        />
      )}
      {leg.interestPaid > 0 && (
        <Row
          indent
          label="└ 이자 (순비용)"
          value={money(leg.interestPaid)}
          tone="text-slate-400"
          help={
            leg.kind === 'buy'
              ? '주택담보대출 이자입니다. 돌려받지 못합니다.'
              : leg.kind === 'subscription'
                ? '중도금 이자와 입주 후 주담대 이자의 합입니다. 아래 “주거 순비용”을 펼치면 갈라서 볼 수 있습니다.'
                : '전세자금대출 이자입니다. 돌려받지 못합니다.'
          }
        />
      )}
      {leg.rentPaid > 0 && (
        <Row
          indent
          label={leg.kind === 'subscription' ? '└ 대기 중 주거비 (순비용)' : '└ 월세 (순비용)'}
          value={money(leg.rentPaid)}
          tone="text-slate-400"
          help={
            leg.kind === 'subscription'
              ? leg.detail.waitMode === 1
                ? '입주 전까지 다른 집에 살며 낸 전세대출 이자입니다. 나머지 세 갈래에는 없는 비용입니다.'
                : `계약금을 낸 뒤 남는 돈으로 전세보증금을 못 채워 월세로 계산했습니다. 월 ${money(
                    leg.detail.waitMonthlyRent
                  )} 입니다.`
              : '집주인에게 낸 월세 누계입니다. 돌려받지 못합니다.'
          }
        />
      )}
      {leg.carryCost > 0 && (
        <Row
          indent
          label="└ 재산세·수선 (순비용)"
          value={money(leg.carryCost)}
          tone="text-slate-400"
          help="소유자만 부담합니다. 재산세와 연 수선유지비(가정값)의 합이고, 집값이 오르면 재산세도 같이 오릅니다."
        />
      )}
      {leg.kind === 'subscription' && Math.abs(leg.depositTopUp) > 1 ? (
        <Row
          label={leg.depositTopUp > 0 ? '입주 때 목돈 나감' : '입주 때 목돈 돌아옴'}
          value={money(Math.abs(leg.depositTopUp))}
          tone="text-slate-300"
          help="입주일에 잔금·취득비를 내고 대기 중 살던 집의 보증금을 돌려받아 정산한 순액입니다. 돌려받는 보증금이 더 크면 오히려 돈이 남습니다. 갱신 증액이 아니라 한 시점의 정산이라 별도로 셉니다."
        />
      ) : leg.depositTopUp > 0 ? (
        <Row
          label="갱신 때 보증금 더 넣음"
          value={money(leg.depositTopUp)}
          tone="text-slate-300"
          help="2년마다 갱신하며 오른 보증금입니다. 투자자산을 헐어 넣으므로 적립액이 그만큼 줄지만, ③에서 돌려받는 보증금에 그대로 얹힙니다. 처음 넣은 목돈보다 돌려받는 돈이 큰 이유가 이것입니다."
        />
      ) : null}
      <Row
        label="투자에 추가 적립"
        hint={`(월 ${money(monthlySaving)})`}
        value={money(leg.netContribution)}
        tone={leg.netContribution > 0 ? 'text-slate-200' : 'text-slate-600'}
        help={
          leg.kind === 'buy'
            ? '갈래 중 가장 많이 쓰는 쪽을 매달 기준예산으로 잡습니다. 매수가 보통 가장 많이 쓰므로 남는 돈이 없어 0원이 됩니다.'
            : '배당 재투자가 아닙니다. 매수자가 매달 쓰는 금액을 기준으로 잡고, 내가 덜 쓴 차액을 투자에 넣은 누계입니다. 배당·이자 수익은 위 “대체투자 기대수익률”에 이미 포함돼 있습니다.'
        }
      />

      <Stage n="③" title={`${years}년 뒤 손에 남는 것`} />
      <Row
        label={
          leg.kind === 'buy' || leg.kind === 'subscription' ? '집 팔고 받는 돈' : '보증금 돌려받음'
        }
        hint={
          leg.kind === 'buy' || leg.kind === 'subscription' ? '(대출·세금·수수료 뺀 뒤)' : undefined
        }
        value={money(leg.recovered)}
        help={
          leg.kind === 'buy'
            ? '매도가에서 잔여대출·매도중개보수·양도세를 뺀 금액입니다. ②에서 갚은 원금이 잔여대출을 줄여 여기에 남습니다.'
            : leg.kind === 'subscription'
              ? '분양 단지를 팔아 잔여대출·중개보수·양도세를 뺀 금액입니다. 매수 갈래와 달리 보유 기간이 입주 후부터라 짧습니다 — 비과세 2년을 못 채우면 양도세가 붙습니다.'
              : `최종 보증금에서 임차대출을 갚고 남는 돈입니다. ①에서 넣은 목돈보다 큰 이유는 ②에서 갱신 때 보증금을 더 넣었기 때문입니다.`
        }
      />
      <Row
        label="투자 잔고"
        hint={`(원금 ${money(leg.investedPrincipal)} + 수익 ${money(leg.investmentGain)})`}
        value={money(leg.investmentEnd)}
        help="①에서 남긴 목돈과 ②에서 적립한 금액이 원금이고, 여기에 대체투자 기대수익률만큼 복리로 붙은 결과입니다. 배당·이자는 그 수익률에 이미 들어 있습니다."
      />
      <Row
        indent
        label="└ 원금 대비"
        value={`${percent(
          leg.investedPrincipal > 0 ? leg.investmentGain / leg.investedPrincipal : 0,
          1
        )}  (연 ${percent(returnRate, 2)} 적립식)`}
        tone="text-slate-500"
        help={`투자 수익 ${money(leg.investmentGain)} ÷ 투자 원금 ${money(
          leg.investedPrincipal
        )} 입니다. 매달 나눠 넣는 **적립식**이라 마지막 달에 넣은 돈은 거의 못 굴립니다 — 같은 돈을 처음부터 목돈으로 넣었다면 ${percent(
          Math.pow(1 + returnRate, years) - 1,
          1
        )} 였을 것이고, 적립식이라 그보다 낮은 것이 정상입니다.${
          leg.depositTopUp > 0
            ? ` 게다가 갱신 때 ${money(leg.depositTopUp)}을 중간에 헐어 써서 그만큼 더 줄어듭니다.`
            : ''
        }`}
      />
      <div className="mt-1 border-t border-slate-800/70 pt-1">
        <Row label="종료자산" value={money(leg.terminalWealth)} tone={tone.text} strong />
        <Row
          label={`${years}년간 주거 순비용`}
          value={money(leg.netHousingCost)}
          tone="text-slate-400"
          help={`돌려받지 못하고 사라진 돈만 셉니다 — ${
            leg.kind === 'buy'
              ? '취득비용 + 이자 + 재산세·수선 + 매도중개보수 + 양도세'
              : leg.kind === 'jeonse'
                ? '전세대출 이자 + 중개보수'
                : '월세 + 중개보수'
          }. 원금상환과 보증금은 자본이라 빠집니다(나갔다가 돌아옵니다). 집값 상승분도 상계하지 않습니다 — 비용과 자본이득은 성격이 달라 같은 칸에서 빼면 둘 다 못 읽습니다.`}
        />
        <Row
          label={`${years}년간 통장에서 나간 총액`}
          value={money(leg.totalCashOut)}
          tone="text-slate-400"
          help="초기 투입 + 매달 나간 돈 + 갱신 증액 보증금. 자본이 되는 원금상환·보증금까지 포함한 현금흐름입니다. 갈래 간 이 값의 차이가 곧 투자에 넣을 수 있는 돈의 차이가 됩니다."
        />
      </div>

      {leg.notes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {leg.notes.map((n) => (
            <li key={n} className="text-[11px] leading-relaxed text-slate-500">
              · {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TenurePage() {
  const { properties, matrix, profile, plans } = useStore();

  const [propertyId, setPropertyId] = useState('');
  /** 청약 갈래로 세울 단지. 빈 문자열이면 3갈래 그대로입니다. */
  const [planId, setPlanId] = useState('');
  const [scenarioId, setScenarioId] = useState('');
  const [over, setOver] = useState<Partial<TenureAssumptions>>({});
  /** 순비용 내역을 펼친 갈래 */
  const [openCost, setOpenCost] = useState<TenureKind | null>(null);

  const property = properties.find((p) => p.id === propertyId) ?? properties[0];
  const scenario = matrix.scenarios.find((s) => s.id === scenarioId) ?? matrix.scenarios[0];
  const cell = property && scenario ? matrix.cells[cellKey(property.id, scenario.id)] : undefined;
  const loan = cell?.best ?? null;

  const assumptions = useMemo(
    () =>
      property
        ? defaultAssumptions(property.region, {
            priceGrowthRate: profile.priceGrowthRate,
            ...over,
          })
        : null,
    [property, profile.priceGrowthRate, over]
  );

  const plan = plans.find((p) => p.id === planId) ?? null;
  /** 갈래 수에 따라 문구가 달라집니다 — "세 갈래" 가 넷일 때 남으면 거짓말입니다. */
  const legWord = plan ? '네 갈래' : '세 갈래';

  /** 청약 갈래는 단지를 고른 경우에만 붙습니다 — 안 고르면 화면이 그대로 셋입니다. */
  const extraPlans = useMemo(() => {
    if (!plan || !scenario || !assumptions) return undefined;
    return [subscriptionLegPlan(plan, assumptions, scenario.availableCash, profile.termYears)];
  }, [plan, scenario, assumptions, profile.termYears]);

  const result = useMemo(() => {
    if (!property || !scenario || !loan || !assumptions) return null;
    return compareTenures({
      property,
      loan,
      equity: scenario.availableCash,
      termYears: profile.termYears,
      assumptions,
      extraPlans,
    });
  }, [property, scenario, loan, assumptions, profile.termYears, extraPlans]);

  const patch = (p: Partial<TenureAssumptions>) => setOver((o) => ({ ...o, ...p }));

  // 전세가율·전월세전환율만 실측으로 바뀌었습니다. 어느 값이 실측인지 구분해 보여줍니다.
  /** 대체투자 수익률을 바꿔 가며 우열이 뒤집히는지 봅니다 */
  const scenarios = useMemo(() => {
    if (!property || !scenario || !loan || !assumptions) return [];
    return compareAcrossReturns(
      {
        property,
        loan,
        equity: scenario.availableCash,
        termYears: profile.termYears,
        assumptions,
        extraPlans,
      },
      investmentOptions()
    );
  }, [property, scenario, loan, assumptions, profile.termYears, extraPlans]);

  const flipsAcrossReturns = new Set(scenarios.map((s) => s.best)).size > 1;
  const provenanceOf = (id: string) =>
    investmentOptions().find((o) => o.id === id)?.provenance ?? 'assumed';
  /** 근사가 아닌 순수 실측이 몇 개인지 — 배지 문구가 실제 상태와 어긋나면 안 됩니다 */
  const measuredCount = scenarios.filter((s) => provenanceOf(s.id) === 'measured').length;

  const measured = property ? isMeasured(property.region) : false;
  const jeonseStat = property ? RENT.byRegion[property.region]?.jeonseRatio : null;
  const conversionStat = property ? RENT.byRegion[property.region]?.conversionRate : null;

  if (properties.length === 0) {
    return <Empty>물건을 먼저 등록하세요. 3단계 “물건 · 입지”에서 추가할 수 있습니다.</Empty>;
  }

  return (
    <div className="space-y-5">
      <Card
        title={plan ? '4-way 거주형태 비교' : '3-way 거주형태 비교'}
        subtitle={
          plan
            ? '매수 · 전세 · 월세 · 청약이 같은 자기자본에서 출발해 같은 기간 뒤 손에 남는 돈을 비교합니다. 임차 쪽은 매수의 원리금 상환과 대칭이 되도록 차액을 적립투자합니다.'
            : '매수 · 전세 · 월세가 같은 자기자본에서 출발해 같은 기간 뒤 손에 남는 돈을 비교합니다. 임차 쪽은 매수의 원리금 상환과 대칭이 되도록 차액을 적립투자합니다.'
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="물건">
            <Select
              value={property?.id ?? ''}
              onChange={setPropertyId}
              options={properties.map((p) => ({
                value: p.id,
                label: `${p.name || '이름 없음'} · ${money(p.price)}`,
              }))}
            />
          </Field>
          <Field label="시나리오" hint={scenario ? `가용 자산 ${money(scenario.availableCash)}` : undefined}>
            <Select
              value={scenario?.id ?? ''}
              onChange={setScenarioId}
              options={matrix.scenarios.map((s) => ({ value: s.id, label: s.label }))}
            />
          </Field>
          <Field
            label="청약 단지 (선택)"
            hint={
              plans.length === 0
                ? '＋ 탭에서 단지를 넣으면 4번째 갈래가 생깁니다'
                : plan
                  ? '이 갈래만 사는 집이 다릅니다'
                  : '고르면 4번째 갈래로 같이 세웁니다'
            }
          >
            <Select
              value={planId}
              onChange={setPlanId}
              options={[
                { value: '', label: plans.length === 0 ? '— 등록된 단지 없음' : '— 세우지 않음' },
                ...plans.map((p) => ({
                  value: p.id,
                  label: `${p.name || '이름 없음'} · ${money(p.price)}`,
                })),
              ]}
            />
          </Field>
          <Field label="비교 기간" hint="이 기간 끝에 매도·이사한다고 봅니다">
            <NumberInput
              value={assumptions?.years ?? RULES.tenure.assumptionDefaults.years}
              step={1}
              suffix="년"
              onChange={(v) => patch({ years: Math.max(1, v) })}
            />
          </Field>
          <RateField
            label="주택 가격상승률"
            help="집값이 매년 오르는 비율입니다. **매수 갈래만 여기에 노출됩니다** — 전세·월세의 회수액은 집값과 무관합니다. 이 값이 손익분기 상승률보다 높으면 매수가, 낮으면 임차가 앞섭니다."
            assumed
            source="매수·청약 갈래만 여기에 노출됩니다"
            value={assumptions?.priceGrowthRate ?? 0}
            onChange={(v) => patch({ priceGrowthRate: v })}
            anchor={
              property && assumptions ? (
                <GrowthAnchor
                  region={property.region}
                  years={assumptions.years}
                  current={assumptions.priceGrowthRate}
                  onUse={(v) => patch({ priceGrowthRate: v })}
                />
              ) : undefined
            }
          />
        </div>
      </Card>

      {property && propertyThesis(property).preferTenure && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <div className="text-xs font-medium text-amber-200">
            애매 구간 물건입니다 — 이 화면이 그래서 중요합니다
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            {propertyThesis(property).reason} {propertyThesis(property).advice}
          </p>
        </div>
      )}

      {!loan || !result ? (
        <Empty>
          이 조합은 실행 가능한 대출 상품이 없어 비교할 수 없습니다. 물건이나 시나리오를 바꿔
          보세요.
        </Empty>
      ) : (
        <>
          {/* ── 결론 ─────────────────────────────────────────── */}
          <Card
            title="손익분기 가격상승률"
            subtitle="“몇 년 뒤 얼마”보다 “몇 % 올라야 매수가 이기나”가 검증 가능한 질문입니다."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                label="손익분기 가격상승률"
                value={
                  result.breakEvenPriceGrowth === null
                    ? '구간 밖'
                    : percent(result.breakEvenPriceGrowth, 2)
                }
                hint="이보다 낮으면 임차가 앞섭니다"
              />
              <Stat
                label="가정한 가격상승률"
                value={percent(result.assumptions.priceGrowthRate, 2)}
                tone={                  result.breakEvenPriceGrowth !== null &&
                  result.assumptions.priceGrowthRate >= result.breakEvenPriceGrowth
                    ? 'good'
                    : 'bad'
                }
              />
              <Stat
                label="가장 큰 종료자산"
                value={result.legs.find((l) => l.kind === result.best)?.label ?? '—'}
                hint={result.legs
                  .map((l) => `${l.label} ${percent(l.annualizedReturn, 1)}`)
                  .join(' · ')}
              />
            </div>
            {result.breakEvenPriceGrowth !== null && (
              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                가정한 {percent(result.assumptions.priceGrowthRate, 2)}가 손익분기{' '}
                {percent(result.breakEvenPriceGrowth, 2)}
                {result.assumptions.priceGrowthRate >= result.breakEvenPriceGrowth
                  ? '보다 높아 매수가 임차보다 앞섭니다. 가정을 손익분기 아래로 낮추면 결론이 뒤집힙니다.'
                  : '보다 낮아 임차가 매수보다 앞섭니다. 매수가 이기려면 그만큼은 올라야 합니다.'}
                {plan && ' 청약은 그쪽도 집을 사므로 이 분기점 밖에 있습니다 — 따로 보세요.'}
              </p>
            )}
            {/*
              청약이 1등이어도 "청약해라" 가 아닙니다. 당첨을 전제로 했고, 사는 집도
              다릅니다. 숫자가 이겼다는 사실과 그 숫자의 조건을 같이 놓습니다.
            */}
            {plan && result.best === 'subscription' && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
                종료자산은 청약이 가장 큽니다 — 다만 <b>당첨을 전제</b>로 했고, 이 갈래만{' '}
                <b>사는 집이 다릅니다</b>. 입주까지 {plan.waitYears}년은 다른 집에 임차로 살고,
                {plan.resaleBanMonths > 0 && ` 전매제한 ${plan.resaleBanMonths}개월 동안은 팔 수도 없습니다.`}{' '}
                "되면 낫다"까지가 이 숫자가 말할 수 있는 전부입니다.
              </p>
            )}
          </Card>

          {/* ── 왜 그렇게 되나 — 현금흐름이 갈리는 지점 ────────── */}
          {/*
            매수는 원금상환이 얹혀 현금유출이 큽니다. 그 차액을 임차가 굴린다는 것이
            이 비교의 전제인데, 화면에는 적립액만 있고 "얼마나 덜 썼는지"가 없었습니다.
            차액 → 투자 원금 → 수익으로 이어지는 사슬을 한 표에 세웁니다.
          */}
          <Card
            title="매수보다 덜 쓴 돈은 어디로 갔나"
            subtitle={`매수는 원금상환이 얹혀 현금이 가장 많이 나갑니다. 임차가 덜 쓴 만큼은 그대로 투자로 갑니다 — 이 표의 "덜 쓴 돈"과 "투자 원금 차이"는 정확히 같은 금액입니다.`}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] text-slate-500">
                    <th className="pb-1.5">갈래</th>
                    <th className="pb-1.5 text-right">통장에서 나간 총액</th>
                    <th className="pb-1.5 text-right">매수보다 덜 씀</th>
                    <th className="pb-1.5 text-right">투자 원금</th>
                    <th className="pb-1.5 text-right">투자 수익</th>
                    <th className="pb-1.5 text-right">주거 순비용</th>
                  </tr>
                </thead>
                <tbody>
                  {result.legs.map((l) => {
                    const buyLeg = result.legs.find((x) => x.kind === 'buy')!;
                    const saved = buyLeg.totalCashOut - l.totalCashOut;
                    const items = housingCostBreakdown(l);
                    const open = openCost === l.kind;
                    return [
                      <tr key={l.kind} className="border-b border-slate-800/50">
                        <td className="py-1.5 text-[11px] text-slate-300">
                          {l.label}
                          {/* 자금 부족이면 투자 원금이 음수가 됩니다 — 표에서도 그 사실이 보여야 합니다. */}
                          {!l.feasible && (
                            <span
                              className="ml-1.5 text-[9px] text-rose-300"
                              title={`초기 자금이 ${money(l.shortfall)} 모자랍니다. 아래 숫자는 그 돈을 어디선가 빌려 왔다고 보고 계산한 값이라, 투자 원금이 음수로 나옵니다.`}
                            >
                              자금 부족
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right text-[11px] tabular-nums text-slate-400">
                          {money(l.totalCashOut)}
                        </td>
                        <td className="py-1.5 text-right text-[11px] tabular-nums text-slate-200">
                          {saved > 1 ? money(saved) : '—'}
                        </td>
                        <td className="py-1.5 text-right text-[11px] tabular-nums text-slate-400">
                          {money(l.investedPrincipal)}
                        </td>
                        <td className="py-1.5 text-right text-[11px] tabular-nums text-slate-200">
                          {money(l.investmentGain)}
                        </td>
                        {/* 순비용은 여러 항목의 합이라 눌러서 풀어 볼 수 있어야 합니다 */}
                        <td className="py-1.5 text-right text-[11px] tabular-nums">
                          <button
                            type="button"
                            onClick={() => setOpenCost(open ? null : l.kind)}
                            className="text-slate-300 transition hover:text-slate-100 no-print"
                            title={items
                              .map((i) => `${i.label} ${money(i.amount)}`)
                              .join(' · ')}
                          >
                            {money(l.netHousingCost)}
                            <span className="ml-1 text-[9px] text-slate-600">
                              {open ? '▾' : '▸'}
                            </span>
                          </button>
                          <span className="hidden print:inline">{money(l.netHousingCost)}</span>
                        </td>
                      </tr>,
                      // 인쇄에서는 접힘이 정보 손실이라 항상 펼칩니다.
                      <tr
                        key={`${l.kind}-detail`}
                        className={`border-b border-slate-800/50 ${open ? '' : 'hidden print:table-row'}`}
                      >
                        <td colSpan={6} className="bg-slate-950/60 px-3 py-2 print-plain">
                          <div className="mb-1 text-[10px] text-slate-500">
                            {l.label} 주거 순비용 {money(l.netHousingCost)} 의 내역
                          </div>
                          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                            {items.map((i) => (
                              <div
                                key={i.label}
                                className="flex items-baseline justify-between gap-3"
                                title={i.help}
                              >
                                <span className="text-[10px] text-slate-500">
                                  {i.label}
                                  <span className="ml-1 text-slate-600">ⓘ</span>
                                </span>
                                <span className="text-[10px] tabular-nums text-slate-300">
                                  {i.reducesCost ? '−' : ''}
                                  {money(i.amount)}
                                </span>
                              </div>
                            ))}
                          </div>
                          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">
                            {l.kind === 'buy'
                              ? '원금상환과 집값 변동은 여기 없습니다 — 원금은 돌려받는 자본이고, 집값 상승분은 비용이 아니라 자본이득이라 상계하지 않습니다.'
                              : '보증금은 여기 없습니다 — 계약 종료 시 돌려받는 자본입니다.'}
                          </p>
                        </td>
                      </tr>,
                    ];
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              매수의 현금유출이 큰 것은 낭비가 아닙니다 — 그중{' '}
              {money(result.legs.find((l) => l.kind === 'buy')?.principalRepaid ?? 0)}는 원금상환이라
              집에 쌓입니다. 반대로 임차가 덜 쓴 돈은 투자에 쌓입니다.{' '}
              <span className="text-slate-300">
                어느 쪽이 이기는지는 집값 상승률과 투자 수익률 중 무엇이 더 높으냐로 갈립니다.
              </span>
            </p>
          </Card>

          {/*
            "어디에 굴리느냐"가 결론을 바꿉니다. 수익률 하나로 답이 뒤집힌다면
            그 답은 "매수가 낫다"가 아니라 "굴릴 자신이 있느냐에 달렸다"입니다.
          */}
          <Card
            title="차액을 어디에 굴리느냐 — 대체투자 수익률별 우열"
            subtitle={`매수와 임차의 차액을 굴리는 수익률을 바꿔 가며 종료자산을 다시 계산합니다. ${legWord} 모두 영향을 받습니다 — 매수도 목돈을 다 쓰지 않고 남긴 만큼은 굴리기 때문입니다.`}
            action={
              <Badge tone={measuredCount > 0 ? 'good' : 'warn'}>
                {measuredCount > 0 ? `${measuredCount}/${scenarios.length} 실측` : '전부 가정값'}
              </Badge>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] text-slate-500">
                    <th className="pb-1.5">굴리는 곳</th>
                    <th className="pb-1.5 text-right">수익률</th>
                    <th className="pb-1.5 text-right">매수</th>
                    <th className="pb-1.5 text-right">전세</th>
                    <th className="pb-1.5 text-right">월세</th>
                    <th className="w-28 border-l border-slate-800 pb-1.5 pl-3 text-right">우위</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((s) => (
                    <tr key={s.id} className="border-b border-slate-800/50" title={s.note}>
                      <td className="py-1.5 text-[11px] text-slate-300">
                        {s.label}
                        <span className="ml-1 text-slate-600">ⓘ</span>
                        <span
                          className={`ml-1.5 rounded border px-1 text-[9px] ${
                            provenanceOf(s.id) === 'measured'
                              ? 'border-slate-500 text-slate-300'
                              : provenanceOf(s.id) === 'approx'
                                ? 'border-slate-700 text-slate-500'
                                : 'border-slate-800 text-slate-600'
                          }`}
                        >
                          {PROVENANCE_LABEL[provenanceOf(s.id)]}
                        </span>
                      </td>
                      <td className="py-1.5 text-right text-[11px] tabular-nums text-slate-400">
                        {percent(s.rate, 1)}
                      </td>
                      {(['buy', 'jeonse', 'wolse'] as const).map((k) => (
                        <td
                          key={k}
                          className={`py-1.5 text-right text-[11px] tabular-nums ${
                            s.best === k && s.gap >= 1000000
                              ? 'font-semibold text-slate-100'
                              : 'text-slate-400'
                          }`}
                        >
                          {money(s.terminal[k])}
                        </td>
                      ))}
                      <td className="w-28 border-l border-slate-800/70 py-1.5 pl-3 text-right text-[11px] tabular-nums text-slate-300">
                        {LEG_LABEL[s.best]}
                        <span className="ml-1 text-[10px] text-slate-600">
                          {s.gap < 1000000 ? '동률' : `+${money(s.gap)}`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 space-y-1">
              <p className="text-[11px] leading-relaxed text-slate-500">
                {flipsAcrossReturns ? (
                  <>
                    <span className="text-amber-300">수익률 가정 하나로 우위가 뒤집힙니다.</span>{' '}
                    그렇다면 결론은 “매수가 낫다”가 아니라{' '}
                    <span className="text-slate-300">
                      “차액을 어디에 굴릴 자신이 있느냐에 달렸다”
                    </span>
                    입니다.
                  </>
                ) : (
                  <>
                    이 구간에서는 수익률을 바꿔도 우위가 <span className="text-slate-300">{LEG_LABEL[scenarios[0]?.best ?? 'buy']}</span>로
                    유지됩니다. 결론이 투자 수익률 가정에 덜 민감하다는 뜻입니다.
                  </>
                )}
              </p>
              <p className="text-[10px] leading-relaxed text-slate-600">
                코스피·채권은 KRX 실측입니다 ({INDEXES.range.from.slice(0, 4)}~
                {INDEXES.range.to.slice(0, 4)}년 {INDEXES.range.years}년 구간). KRX 에 코스피{' '}
                <strong className="text-slate-400">총수익지수가 없어</strong> 가격지수에 배당을
                더해 근사하는데, 그 배당{' '}
                {(INDEXES.kospi.dividendYieldMeasured * 100).toFixed(2)}%도{' '}
                <strong className="text-slate-400">이제 실측</strong>입니다 (ECOS 배당수익률
                20년 평균). 두 항 모두 실측이지만 재투자 시점이 안 들어가 여전히 근사입니다.
                채권만 총수익지수 실측이라 근사가 아닙니다.
                <br />
                해외지수는 <strong className="text-slate-400">가격지수만 FRED 실측</strong>이고
                배당은 가정입니다 — FRED 에 이 지수들의 배당수익률도 총수익지수도 없다는 것을
                확인했습니다. 같은 “실측+가정” 이라도 코스피와 근거 수준이 다릅니다.
              </p>
              {measuredInflation() !== null && (
                <p className="text-[10px] leading-relaxed text-slate-600">
                  전부 <strong className="text-slate-400">명목</strong> 수익률입니다. 같은 기간
                  소비자물가가 연 {percent(measuredInflation()!, 2)} 올랐으므로(ECOS 실측),
                  실질로는 각각 그만큼 낮습니다 — 예: 코스피{' '}
                  {percent(
                    toReal(investmentOptions().find((o) => o.id === 'kospi')?.rate ?? 0, measuredInflation()!),
                    2
                  )}
                  . 집값 상승률도 명목이라 비교 자체는 성립합니다.
                </p>
              )}
              <p className="text-[10px] leading-relaxed text-slate-600">
                10년 두 점으로 낸 CAGR 이라 구간을 조금만 옮겨도 크게 달라집니다.
                “앞으로도 이만큼”이 아니라 “이 구간에는 이랬다”로 읽으세요.
              </p>
              <p className="text-[10px] leading-relaxed text-amber-200/70">
                {RULES.tenure.investmentPresets.currencyWarning}
              </p>
            </div>
          </Card>

          {/* ── 갈래별 상세 ──────────────────────────────────── */}
          <Card
            title="자금 흐름 — 같은 목돈을 어디에 두느냐의 차이"
            subtitle={`${legWord} 모두 자기자본 ${money(
              result.equity
            )}에서 출발합니다. 주거에 묶는 만큼 투자에 남길 돈이 줄고, 매달 주거비를 덜 쓰는 만큼 투자에 더 넣습니다. 매수자가 갚는 원금은 소비가 아니라 저축이므로, 임차 쪽에도 그 차액만큼 투자시켜야 비교가 성립합니다.`}
          >
            <div
              className={`grid gap-4 ${
                result.legs.length > 3 ? 'sm:grid-cols-2 xl:grid-cols-4' : 'lg:grid-cols-3'
              }`}
            >
              {result.legs.map((leg) => (
                <LegCard
                  key={leg.kind}
                  leg={leg}
                  best={leg.kind === result.best}
                  max={Math.max(...result.legs.map((l) => l.terminalWealth))}
                  equity={result.equity}
                  years={result.years}
                  returnRate={result.assumptions.investmentReturnRate}
                />
              ))}
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
              ① + ②의 적립액이 투자 원금이 되고, 여기에 수익이 붙어 ③의 투자 잔고가 됩니다.
              전세처럼 보증금이 목돈을 다 가져가면 ①의 투자액은 0원이지만, ②에서 매달 쌓이기
              때문에 ③의 잔고는 0이 아닙니다.
            </p>
          </Card>

          {/* ── 조건 ─────────────────────────────────────────── */}
          <Card
            title="가정값"
            subtitle={
              measured
                ? `전세가율·전월세전환율은 국토부 전월세 실거래 ${RENT.stats.deals.toLocaleString('ko-KR')}건에서 잰 값입니다 (${RENT.range.from.slice(0, 4)}년~, 같은 단지·평형·분기끼리 짝지음). 나머지는 아직 자리표시자입니다.`
                : RULES.tenure.assumptionDefaults.note
            }
            action={measured ? <Badge tone="good">일부 실측</Badge> : <Badge tone="warn">실측 아님</Badge>}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <RateField
                label="대체투자 기대수익률"
                help="집을 사지 않고 그 돈을 다른 데 굴렸을 때의 연 수익률입니다. 주식·채권 등을 아우르는 총수익 기준이라 **배당과 이자가 이미 포함**돼 있습니다 — 별도로 배당수익률을 넣을 필요가 없습니다. 세 갈래 모두 남는 돈에 이 수익률을 적용하므로, 이 값이 높을수록 임차가 유리해집니다."
                assumed
                source={`아래 표의 프리셋을 참고해 직접 정하세요. 코스피 ${(
                  investmentOptions().find((o) => o.id === 'kospi')?.rate ?? 0
                ) * 100}% 등`}
                value={result.assumptions.investmentReturnRate}
                onChange={(v) => patch({ investmentReturnRate: v })}
              />
              <RateField
                label="전세가율"
                help="매매가 대비 전세보증금의 비율입니다. 전세보증금 = 매매가 × 이 비율. 높을수록 전세에 묶이는 목돈이 커져 투자에 남길 돈이 줄고, 월세도 같이 비싸집니다(월세가 여기서 파생되기 때문)."
                assumed={!jeonseStat}
                source={
                  jeonseStat
                    ? `실거래 · ${property.sigungu || '해당 권역'} · 표본 ${jeonseStat.n.toLocaleString('ko-KR')}건 · 사분위 ${percent(jeonseStat.p25, 1)}~${percent(jeonseStat.p75, 1)}`
                    : '자리표시자 · 매매가 대비 전세보증금'
                }
                value={result.assumptions.jeonseRatio}
                onChange={(v) => patch({ jeonseRatio: v })}
              />
              <RateField
                label="전월세전환율"
                help="전세보증금을 월세로 바꿀 때 적용하는 연이율입니다. 월세 = (전세보증금 − 월세보증금) × 이 비율 ÷ 12. 월세는 독립 가정값이 아니라 전세에서 파생됩니다. 높을수록 월세가 비싸져 월세 갈래가 불리해집니다."
                assumed={!conversionStat}
                source={
                  conversionStat
                    ? `실거래 · 표본 ${conversionStat.n.toLocaleString('ko-KR')}건 · 사분위 ${percent(conversionStat.p25, 2)}~${percent(conversionStat.p75, 2)}`
                    : `자리표시자 · 법정 상한 ${percent(RULES.tenure.lease.conversionRateMax, 0)}`
                }
                value={result.assumptions.conversionRate}
                onChange={(v) => patch({ conversionRate: v })}
              />
              <RateField
                label="월세 보증금 비율"
                help="월세 계약의 보증금이 전세보증금의 몇 %인지입니다. 이 비율이 높을수록 월세 보증금이 커지고 매달 내는 월세는 줄어듭니다."
                assumed
                source="자리표시자 · 전세보증금 대비"
                value={result.assumptions.wolseDepositRatio}
                onChange={(v) => patch({ wolseDepositRatio: v })}
              />
              <RateField
                label="보증금·월세 상승률"
                help="재계약 때 보증금과 월세가 오르는 연 비율입니다. 2년마다 갱신 시점에 반영되고, 첫 갱신에는 계약갱신청구권의 법정 상한 5%가 걸립니다. 오른 보증금은 투자자산을 헐어 채우므로 적립액을 깎습니다."
                assumed
                source={`자리표시자 · 갱신 ${RULES.tenure.lease.renewalYears}년마다 반영`}
                value={result.assumptions.depositGrowthRate}
                onChange={(v) => patch({ depositGrowthRate: v })}
              />
              <RateField
                label="연 수선유지비"
                help="집값 대비 연간 수선·유지 비용입니다. 소유자만 부담하며 매달 나가는 돈에 더해집니다. 임차인은 0입니다."
                assumed
                source={`주택가격 대비, 매수·청약만 부담 · K-apt ${REPAIR.searchDate.slice(0, 4)}년 ${REPAIR.searchDate.slice(4)}월`}
                value={result.assumptions.maintenanceRate}
                step={0.05}
                onChange={(v) => patch({ maintenanceRate: v })}
                anchor={
                  property ? (
                    <RepairAnchor
                      region={property.region}
                      sigungu={property.sigungu}
                      price={property.price}
                      areaSqm={property.areaSqm}
                      assumed={result.assumptions.maintenanceRate}
                    />
                  ) : undefined
                }
              />
              <RateField
                label="전세자금대출 금리"
                help="전세보증금이 목돈보다 클 때 빌리는 대출의 금리입니다. 이자만 매달 내고 원금은 계약 종료 시 보증금에서 갚습니다 — 그래서 전세의 월 지출은 전부 이자입니다."
                assumed={!RATES.rates.jeonseLoan}
                source={
                  RATES.rates.jeonseLoan
                    ? `실측 · 한국은행 ECOS 예금은행 신규취급액 ${RATES.rates.jeonseLoan.year}년`
                    : '자리표시자'
                }
                value={result.assumptions.jeonseLoanRate}
                onChange={(v) => patch({ jeonseLoanRate: v })}
              />
              <ProvenanceValue
                label="적용 대출"
                value={`${money(loan.limit)}`}
                assumed={false}
                size="sm"
                source={`${loan.productName} · ${percent(loan.rate)} · 월 ${money(loan.monthlyPayment)} · 룰셋 ${RULES.version}`}
              />
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
              점선 밑줄이 그어진 숫자는 <span className="text-slate-300">우리가 정한 값</span>입니다.
              근거가 있는 값과 섞어서 인용하면 도구 전체가 거짓말이 됩니다. 실측으로 바뀐 것은
              전세가율·전월세전환율뿐입니다.
            </p>
          </Card>

          <Card title="이 계산이 아닌 것">
            <ul className="space-y-1.5">
              {result.caveats.map((c) => (
                <li key={c} className="text-xs leading-relaxed text-slate-400">
                  · {c}
                </li>
              ))}
              {/* 청약을 세웠을 때만 붙는 단서 — 이 갈래만 사는 집이 다릅니다. */}
              {plan &&
                SUBSCRIPTION_CAVEATS.map((c) => (
                  <li key={c} className="text-xs leading-relaxed text-amber-300/80">
                    · {c}
                  </li>
                ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
