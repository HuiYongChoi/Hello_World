import { useMemo, useState } from 'react';
import { Badge, Card, Field, Select } from '../components/ui';
import { affordabilityLadder, type AffordabilityResult } from '../engine/affordability';
import { money, percent } from '../engine/format';
import { RULES } from '../engine/rules';
import { useStore } from '../state/store';
import type { RegionId } from '../engine/types';

/**
 * "얼마까지 되나" — 역방향 화면.
 *
 * 매트릭스는 물건을 정해야 답이 나옵니다. 그런데 실제 대화는 반대로 옵니다:
 * "합가하고 신생아특례 쓰면 7억대 되나?" 물건을 하나씩 넣어보게 만드는 대신
 * 상품별 한계선을 하나의 가격 축에 세웁니다.
 *
 * 축 위에 세우면 **자격이 막은 것과 현금이 막은 것**이 눈으로 갈립니다. 둘은
 * 해야 할 일이 다릅니다 — 자격은 상품·시점을 바꿔야 하고, 현금은 더 모아야 합니다.
 */

const REGION_OPTIONS: { value: RegionId; label: string }[] = RULES.regions.map((r) => ({
  value: r.id,
  label: `${r.label} (${r.isCapitalArea ? '수도권 · LTV 70%' : '비수도권 · LTV 80%'})`,
}));

/** 눈금은 사람이 읽는 단위로 — 1억 단위, 축이 길면 2억 단위 */
function ticksFor(maxAxis: number): number[] {
  const stepEok = maxAxis > 800000000 ? 2 : 1;
  const out: number[] = [];
  for (let v = 0; v <= maxAxis; v += stepEok * 100000000) out.push(v);
  return out;
}

function Compass({
  ladder,
  maxAxis,
}: {
  ladder: AffordabilityResult[];
  maxAxis: number;
}) {
  const { properties } = useStore();
  const pos = (v: number) => `${Math.min(100, (v / maxAxis) * 100)}%`;
  const usable = ladder.filter((r) => r.maxPrice > 0);

  return (
    <div className="mt-4">
      {/* 상품 한계선 — 축 위 */}
      <div className="relative h-14">
        {usable.map((r, i) => (
          <div
            key={r.productId}
            className="absolute flex -translate-x-1/2 flex-col items-center"
            style={{ left: pos(r.maxPrice), bottom: `${(i % 2) * 26}px` }}
            title={`${r.productName} — ${r.reason}`}
          >
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${
                r.binding === 'ELIGIBILITY'
                  ? 'bg-amber-500/20 text-amber-200'
                  : 'bg-sky-500/20 text-sky-200'
              }`}
            >
              {r.shortName} {money(r.maxPrice)}
            </span>
            <span className="h-2 w-px bg-slate-600" />
          </div>
        ))}
      </div>

      {/* 축 */}
      <div className="relative h-2 rounded-full bg-slate-800">
        {usable.length > 0 && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-600/50 to-sky-600/50"
            style={{ width: pos(Math.max(...usable.map((r) => r.maxPrice))) }}
          />
        )}
      </div>

      {/* 눈금 */}
      <div className="relative mt-1 h-4">
        {ticksFor(maxAxis).map((v) => (
          <span
            key={v}
            className="absolute -translate-x-1/2 text-[10px] tabular-nums text-slate-600"
            style={{ left: pos(v) }}
          >
            {v === 0 ? '0' : `${v / 100000000}억`}
          </span>
        ))}
      </div>

      {/* 등록 물건 — 축 아래 */}
      <div className="relative mt-1 h-10">
        {properties.map((p, i) => (
          <div
            key={p.id}
            className="absolute flex -translate-x-1/2 flex-col items-center"
            style={{ left: pos(p.price), top: `${(i % 2) * 20}px` }}
            title={`${p.name} — ${money(p.price)}`}
          >
            <span className="h-2 w-px bg-slate-600" />
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-slate-300">
              {p.name} {money(p.price)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AffordabilityCard() {
  const { profile, matrix, properties } = useStore();
  const [scenarioId, setScenarioId] = useState('');
  const [region, setRegion] = useState<RegionId>('changwon');

  const scenario = matrix.scenarios.find((s) => s.id === scenarioId) ?? matrix.scenarios[0];

  const ladder = useMemo(() => {
    if (!scenario) return [];
    return affordabilityLadder(profile, scenario, {
      id: 'template',
      name: '가상 물건',
      region,
      sigungu: '',
      price: 0,
      areaSqm: 84.9,
      householdCount: 800,
      builtYear: 2015,
      scores: {},
      penalties: [],
    });
  }, [profile, scenario, region]);

  if (!scenario) return null;

  const usable = ladder.filter((r) => r.maxPrice > 0);
  const top = usable[0];
  const maxAxis =
    Math.max(
      ...usable.map((r) => r.maxPrice),
      ...properties.map((p) => p.price),
      300000000
    ) * 1.15;

  return (
    <Card
      title="얼마까지 되나 — 가격 나침반"
      subtitle="물건을 정하지 않고 거꾸로 봅니다. 상품별 한계선을 하나의 가격 축에 세워, 무엇이 막고 있는지를 눈으로 가릅니다. 전용 84.9㎡ 가상 물건 기준입니다."
      action={<Badge tone="warn">한계선이지 적정가가 아님</Badge>}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="시나리오" hint={`가용 자산 ${money(scenario.availableCash)}`}>
          <Select
            value={scenario.id}
            onChange={setScenarioId}
            options={matrix.scenarios.map((s) => ({ value: s.id, label: s.label }))}
          />
        </Field>
        <Field label="지역" hint="지역이 곧 LTV입니다">
          <Select value={region} onChange={setRegion} options={REGION_OPTIONS} />
        </Field>
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-3">
          <div className="text-[11px] text-slate-500">이 조건의 최대</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-slate-100">
            {top ? money(top.maxPrice) : '—'}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {top ? `${top.shortName} 기준` : '이용 가능한 상품이 없습니다'}
          </div>
        </div>
      </div>

      {usable.length > 0 && <Compass ladder={ladder} maxAxis={maxAxis} />}

      <div className="mt-5 space-y-2">
        {ladder.map((r) => (
          <div
            key={r.productId}
            className={`rounded-lg border px-3.5 py-2.5 ${
              r.maxPrice > 0 ? 'border-slate-800 bg-slate-950/40' : 'border-slate-800/60'
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-slate-200">{r.productName}</span>
              {r.maxPrice > 0 ? (
                <span className="text-sm font-semibold tabular-nums text-slate-100">
                  최대 {money(r.maxPrice)}
                </span>
              ) : (
                <Badge tone="bad">불가</Badge>
              )}
            </div>
            {r.maxPrice > 0 && r.at ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-slate-500">
                <span>
                  대출 {money(r.at.limit)} · {percent(r.at.rate)}
                </span>
                <span>월 {money(r.at.monthlyPayment)}</span>
                <span>필요현금 {money(r.at.requiredCash)}</span>
                <span>부담 {percent(r.at.dtiRatio, 0)}</span>
                <Badge tone={r.binding === 'ELIGIBILITY' ? 'warn' : 'info'}>
                  {r.binding === 'ELIGIBILITY' ? '자격이 막음' : '현금이 막음'}
                </Badge>
              </div>
            ) : (
              <div className="mt-1 text-[11px] leading-relaxed text-rose-300/80">{r.reason}</div>
            )}
          </div>
        ))}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        <span className="text-amber-300">자격이 막음</span>은 상품이나 시점을 바꿔야 뚫립니다 —
        더 모아도 소용없습니다. <span className="text-sky-300">현금이 막음</span>은 반대로 자금만
        더 있으면 뚫립니다. 그리고 여기 숫자는 <strong className="text-slate-300">살 수 있는
        한계</strong>이지 사도 되는 가격이 아닙니다. 한계까지 당기면 상환 부담도 같이 최대가
        됩니다.
      </p>
    </Card>
  );
}
