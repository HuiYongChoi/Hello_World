import { useMemo, useState } from 'react';
import { Badge, Card, Empty, Field, NumberInput, Select, Stat } from '../components/ui';
import { money, percent } from '../engine/format';
import { cellKey } from '../engine/matrix';
import { RULES } from '../engine/rules';
import {
  compareTenures,
  defaultAssumptions,
  type TenureAssumptions,
  type TenureKind,
  type TenureLeg,
} from '../engine/tenure';
import { useStore } from '../state/store';

/** 소수로 든 비율을 %로 보여주고 받는 입력 */
function RateField({
  label,
  hint,
  value,
  onChange,
  step = 0.1,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      <NumberInput
        value={Number((value * 100).toFixed(2))}
        step={step}
        suffix="%"
        onChange={(v) => onChange(v / 100)}
      />
    </Field>
  );
}

const TONE: Record<TenureKind, { bar: string; text: string; ring: string }> = {
  buy: { bar: 'bg-sky-500', text: 'text-sky-300', ring: 'border-sky-500/40 bg-sky-500/5' },
  jeonse: {
    bar: 'bg-emerald-500',
    text: 'text-emerald-300',
    ring: 'border-emerald-500/40 bg-emerald-500/5',
  },
  wolse: {
    bar: 'bg-amber-500',
    text: 'text-amber-300',
    ring: 'border-amber-500/40 bg-amber-500/5',
  },
};

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`text-xs tabular-nums ${tone ?? 'text-slate-300'}`}>{value}</span>
    </div>
  );
}

function LegCard({ leg, best, max }: { leg: TenureLeg; best: boolean; max: number }) {
  const tone = TONE[leg.kind];
  const width = max > 0 ? Math.max(2, (leg.terminalWealth / max) * 100) : 0;

  return (
    <div
      className={`rounded-xl border p-4 print-plain ${
        best ? tone.ring : 'border-slate-800 bg-slate-950/40'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">{leg.label}</h3>
        <div className="flex gap-1">
          {best && <Badge tone="info">종료자산 최대</Badge>}
          {!leg.feasible && <Badge tone="bad">자금 부족</Badge>}
          {leg.feasible && leg.liquidityRisk && <Badge tone="warn">중간에 잔고 소진</Badge>}
        </div>
      </div>

      <div className={`mt-2 text-2xl font-semibold tabular-nums ${tone.text}`}>
        {money(leg.terminalWealth)}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${tone.bar}`} style={{ width: `${width}%` }} />
      </div>

      <div className="mt-3 divide-y divide-slate-800/70 border-t border-slate-800/70">
        <Row label="초기 투입" value={money(leg.initialOutlay)} />
        <Row label="주식 초기 투입" value={money(leg.initialStock)} />
        <Row label="기간 중 주거비" value={money(leg.housingCashOut)} />
        <Row
          label="적립투자 누계"
          value={money(leg.netContribution)}
          tone={leg.netContribution > 0 ? 'text-emerald-300' : 'text-slate-300'}
        />
        <Row label="종료 주식잔고" value={money(leg.stockEnd)} />
        <Row
          label={leg.kind === 'buy' ? '매도 순수취' : '보증금 회수'}
          value={money(leg.terminalNonStock)}
        />
        {!leg.feasible && (
          <Row label="부족액" value={money(leg.shortfall)} tone="text-rose-300" />
        )}
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
  const { properties, matrix, profile } = useStore();

  const [propertyId, setPropertyId] = useState('');
  const [scenarioId, setScenarioId] = useState('');
  const [over, setOver] = useState<Partial<TenureAssumptions>>({});

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

  const result = useMemo(() => {
    if (!property || !scenario || !loan || !assumptions) return null;
    return compareTenures({
      property,
      loan,
      equity: scenario.availableCash,
      termYears: profile.termYears,
      assumptions,
    });
  }, [property, scenario, loan, assumptions, profile.termYears]);

  const patch = (p: Partial<TenureAssumptions>) => setOver((o) => ({ ...o, ...p }));

  if (properties.length === 0) {
    return <Empty>물건을 먼저 등록하세요. 3단계 “물건 · 입지”에서 추가할 수 있습니다.</Empty>;
  }

  return (
    <div className="space-y-5">
      <Card
        title="3-way 거주형태 비교"
        subtitle="매수 · 전세 · 월세가 같은 자기자본에서 출발해 같은 기간 뒤 손에 남는 돈을 비교합니다. 임차 쪽은 매수의 원리금 상환과 대칭이 되도록 차액을 적립투자합니다."
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
            hint="매수 갈래만 여기에 노출됩니다"
            value={assumptions?.priceGrowthRate ?? 0}
            onChange={(v) => patch({ priceGrowthRate: v })}
          />
        </div>
      </Card>

      {!loan || !result ? (
        <Empty>
          이 조합은 실행 가능한 대출 상품이 없어 비교할 수 없습니다. 물건이나 시나리오를 바꿔
          보세요.
        </Empty>
      ) : (
        <>
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
                tone={
                  result.breakEvenPriceGrowth !== null &&
                  result.assumptions.priceGrowthRate >= result.breakEvenPriceGrowth
                    ? 'good'
                    : 'bad'
                }
              />
              <Stat
                label="가장 큰 종료자산"
                value={result.legs.find((l) => l.kind === result.best)?.label ?? '—'}
                hint={`${result.years}년 뒤 기준`}
              />
            </div>
            {result.breakEvenPriceGrowth !== null && (
              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                가정한 {percent(result.assumptions.priceGrowthRate, 2)}가 손익분기{' '}
                {percent(result.breakEvenPriceGrowth, 2)}
                {result.assumptions.priceGrowthRate >= result.breakEvenPriceGrowth
                  ? '보다 높아 매수가 앞섭니다. 가정을 손익분기 아래로 낮추면 결론이 뒤집힙니다.'
                  : '보다 낮아 임차가 앞섭니다. 매수가 이기려면 그만큼은 올라야 합니다.'}
              </p>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            {result.legs.map((leg) => (
              <LegCard
                key={leg.kind}
                leg={leg}
                best={leg.kind === result.best}
                max={Math.max(...result.legs.map((l) => l.terminalWealth))}
              />
            ))}
          </div>

          <Card
            title="가정값"
            subtitle={RULES.tenure.assumptionDefaults.note}
            action={<Badge tone="warn">실측 아님</Badge>}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <RateField
                label="주식 기대수익률"
                hint="배당 포함 명목"
                value={result.assumptions.stockReturnRate}
                onChange={(v) => patch({ stockReturnRate: v })}
              />
              <RateField
                label="전세가율"
                hint="매매가 대비 전세보증금"
                value={result.assumptions.jeonseRatio}
                onChange={(v) => patch({ jeonseRatio: v })}
              />
              <RateField
                label="전월세전환율"
                hint={`법정 상한 ${percent(RULES.tenure.lease.conversionRateMax, 0)}`}
                value={result.assumptions.conversionRate}
                onChange={(v) => patch({ conversionRate: v })}
              />
              <RateField
                label="월세 보증금 비율"
                hint="전세보증금 대비"
                value={result.assumptions.wolseDepositRatio}
                onChange={(v) => patch({ wolseDepositRatio: v })}
              />
              <RateField
                label="보증금·월세 상승률"
                hint={`갱신 ${RULES.tenure.lease.renewalYears}년마다 반영`}
                value={result.assumptions.depositGrowthRate}
                onChange={(v) => patch({ depositGrowthRate: v })}
              />
              <RateField
                label="연 수선유지비"
                hint="주택가격 대비, 매수자만 부담"
                value={result.assumptions.maintenanceRate}
                step={0.05}
                onChange={(v) => patch({ maintenanceRate: v })}
              />
              <RateField
                label="전세자금대출 금리"
                value={result.assumptions.jeonseLoanRate}
                onChange={(v) => patch({ jeonseLoanRate: v })}
              />
              <Field label="적용 대출" hint={`${percent(loan.rate)} · 월 ${money(loan.monthlyPayment)}`}>
                <div className="mt-1 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
                  {loan.productName} {money(loan.limit)}
                </div>
              </Field>
            </div>
          </Card>

          <Card title="이 계산이 아닌 것">
            <ul className="space-y-1.5">
              {result.caveats.map((c) => (
                <li key={c} className="text-xs leading-relaxed text-slate-400">
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
