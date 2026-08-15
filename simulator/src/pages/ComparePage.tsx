import { useState } from 'react';
import { Badge, Button, Card, Empty, SegmentedControl, Stat } from '../components/ui';
import { money, percent, won } from '../engine/format';
import { CONSTRAINT_LABELS, OBJECTIVE_LABELS, constraintAdvice } from '../engine/loan';
import { leverageView } from '../engine/leverage';
import { cellKey } from '../engine/matrix';
import { propertyThesis } from '../engine/thesis';
import { useStore } from '../state/store';
import type {
  CellResult,
  CellSummary,
  DerivedScenario,
  LoanResult,
  Objective,
  Property,
} from '../engine/types';
import { AffordabilityCard } from './AffordabilityCard';
import { BubbleView } from './BubbleView';

export function ComparePage() {
  const { properties, matrix, objective, setObjective } = useStore();
  const [detail, setDetail] = useState<{ property: Property; scenario: DerivedScenario } | null>(
    null
  );

  if (properties.length === 0) {
    return (
      <Card title="시나리오 × 물건 매트릭스">
        <Empty>물건을 먼저 등록하세요.</Empty>
      </Card>
    );
  }

  const rec = matrix.recommendation;
  const recProperty = rec ? properties.find((p) => p.id === rec.propertyId) : null;
  const recScenario = rec ? matrix.scenarios.find((s) => s.id === rec.scenarioId) : null;

  return (
    <div className="space-y-5">
      <Card
        title="시나리오 × 물건 매트릭스"
        subtitle="셀마다 최적 상품·월납·필요현금·실행가능 여부를 표시합니다. 셀을 누르면 전 상품 계산 내역이 열립니다."
        action={
          <SegmentedControl<Objective>
            value={objective}
            onChange={setObjective}
            options={(Object.keys(OBJECTIVE_LABELS) as Objective[]).map((k) => ({
              value: k,
              label: OBJECTIVE_LABELS[k],
            }))}
          />
        }
      >
        <LeverageControl />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="w-52 px-2 pb-2 text-left text-xs font-medium text-slate-500">
                  물건 \ 시나리오
                </th>
                {matrix.scenarios.map((s) => (
                  <th key={s.id} className="px-2 pb-2 text-left">
                    <div className="text-sm font-semibold text-slate-200">{s.label}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {s.isFirstTimeValid ? (
                        <Badge tone="good">생애최초</Badge>
                      ) : (
                        <Badge tone="bad">생애최초 소멸</Badge>
                      )}
                      {s.giftTaxFlag && <Badge tone="warn">증여세</Badge>}
                      {s.contributionRatioFlag && <Badge tone="warn">지분율 주의</Badge>}
                    </div>
                    <div className="mt-1 text-[11px] tabular-nums text-slate-500">
                      소득 {money(s.assessedIncome)} · 현금 {money(s.availableCash)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => (
                <tr key={p.id}>
                  <th className="rounded-lg bg-slate-900/50 px-3 py-2 text-left align-top print-plain">
                    <div className="text-sm font-semibold text-slate-100">{p.name}</div>
                    <div className="mt-1 text-[11px] tabular-nums text-slate-400">
                      {money(p.price)} · 전용 {p.areaSqm}㎡
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge
                        tone={
                          matrix.cells[cellKey(p.id, matrix.scenarios[0]?.id ?? '')]?.grade === 'D'
                            ? 'bad'
                            : 'info'
                        }
                      >
                        입지{' '}
                        {(
                          matrix.cells[cellKey(p.id, matrix.scenarios[0]?.id ?? '')]?.localeScore ??
                          0
                        ).toFixed(0)}
                        점
                      </Badge>
                      <ThesisBadge property={p} />
                    </div>
                  </th>
                  {matrix.scenarios.map((s) => (
                    <td key={s.id} className="align-top">
                      <MatrixCell
                        cell={matrix.cells[cellKey(p.id, s.id)]}
                        property={p}
                        highlight={rec?.propertyId === p.id && rec?.scenarioId === s.id}
                        onClick={() => setDetail({ property: p, scenario: s })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="text-emerald-400">✅</span> 실행 가능
          </span>
          <span className="flex items-center gap-1">
            <span className="text-amber-400">⚠️</span> 빠듯함 (가용현금의 90% 초과)
          </span>
          <span className="flex items-center gap-1">
            <span className="text-rose-400">❌</span> 자금 부족
          </span>
          <span className="flex items-center gap-1">
            <span className="text-slate-500">✖</span> 자격 미달
          </span>
        </div>
      </Card>

      {rec && recProperty && recScenario && (
        <Card
          title="현재 목적함수 기준 최적 조합"
          subtitle={`${OBJECTIVE_LABELS[objective]} 기준으로 실행 가능한 조합 중 최우수입니다. 목적함수를 바꾸면 답도 바뀝니다.`}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-slate-100">{recProperty.name}</span>
            <Badge tone="info">{recScenario.label}</Badge>
            <Badge tone="good">{rec.best!.productName}</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="대출 한도" value={money(rec.best!.limit)} />
            <Stat label="월 상환액" value={money(rec.best!.monthlyPayment)} />
            <Stat
              label="필요 현금"
              value={money(rec.best!.requiredCash)}
              tone={rec.best!.tight ? 'warn' : 'good'}
            />
            <Stat
              label="상환부담률"
              value={percent(rec.best!.dtiRatio, 0)}
              tone={rec.best!.dtiRatio > 0.35 ? 'warn' : 'good'}
            />
            <Stat label="입지 점수" value={`${rec.localeScore.toFixed(1)} · ${rec.grade}`} />
          </div>
        </Card>
      )}

      <AffordabilityCard />

      <BubbleView />

      {detail && (
        <DetailDrawer
          property={detail.property}
          scenario={detail.scenario}
          cell={matrix.cells[cellKey(detail.property.id, detail.scenario.id)]}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

/**
 * 가격상승률 가정 조절. 이 값 하나가 레버리지의 방향을 뒤집기 때문에
 * 매트릭스 바로 위에 두어 조절하면서 셀 변화를 보게 합니다.
 */
function LeverageControl() {
  const { profile, setProfile, matrix } = useStore();

  const rates = Object.values(matrix.cells)
    .map((c) => c.best?.rate)
    .filter((r): r is number => typeof r === 'number');
  const minRate = rates.length > 0 ? Math.min(...rates) : 0;
  const maxRate = rates.length > 0 ? Math.max(...rates) : 0;
  const growth = profile.priceGrowthRate;

  const allBelow = rates.length > 0 && growth < minRate;
  const allAbove = rates.length > 0 && growth > maxRate;

  return (
    <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4 print-plain">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-200">연 가격상승률 가정</div>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-slate-500">
            자기자본 수익률 ≈ 가격상승률 + 부채비율 × (가격상승률 − 금리). 배율은 곱셈,
            금리는 스프레드 안의 한 항입니다. 그래서 <b>스프레드의 부호</b>가 먼저입니다.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={-3}
            max={12}
            step={0.5}
            value={Number((growth * 100).toFixed(1))}
            onChange={(e) => setProfile({ priceGrowthRate: Number(e.target.value) / 100 })}
            className="w-48 accent-sky-500"
            aria-label="연 가격상승률 가정"
          />
          <span className="w-16 text-right text-lg font-semibold tabular-nums text-slate-100">
            {(growth * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {rates.length > 0 && (
        <p className="mt-3 text-[11px] leading-relaxed">
          {allBelow ? (
            <span className="text-rose-300">
              가정한 상승률이 모든 상품 금리({(minRate * 100).toFixed(2)}% 이상)를 밑돕니다 —
              이 구간에서는 <b>LTV가 높을수록 손실이 커집니다.</b> 비수도권 80% 우대가 오히려
              불리하게 작동합니다.
            </span>
          ) : allAbove ? (
            <span className="text-emerald-300">
              가정한 상승률이 모든 상품 금리({(maxRate * 100).toFixed(2)}% 이하)를 웃돕니다 —
              레버리지가 수익을 증폭하므로 LTV가 높을수록 유리합니다.
            </span>
          ) : (
            <span className="text-amber-300">
              손익분기 구간입니다 — 상품에 따라 레버리지 방향이 갈립니다 (금리{' '}
              {(minRate * 100).toFixed(2)}~{(maxRate * 100).toFixed(2)}%).
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function MatrixCell({
  cell,
  property,
  highlight,
  onClick,
}: {
  cell: CellResult | undefined;
  property: Property;
  highlight: boolean;
  onClick: () => void;
}) {
  if (!cell) return null;
  const r = cell.best;

  if (!r) {
    // 사유를 하나만 보여주면 "왜 전부 안 되는지"를 알 수 없어 상품별로 전부 냅니다.
    const reasons = cell.summary.rejected;
    return (
      <button
        type="button"
        onClick={onClick}
        className="h-full w-full rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2.5 text-left transition hover:border-slate-700"
      >
        <div className="text-xs font-medium text-slate-500">
          ✖ 이용 가능 상품 없음 ({reasons.length}종 전부 부적격)
        </div>
        <ul className="mt-1 space-y-0.5">
          {reasons.map((x) => (
            <li key={x.productName} className="text-[11px] leading-relaxed text-slate-600">
              {x.productName} — {x.reason}
            </li>
          ))}
        </ul>
      </button>
    );
  }

  const status = !r.feasible ? 'bad' : r.tight ? 'warn' : 'good';
  const icon = !r.feasible ? '❌' : r.tight ? '⚠️' : '✅';
  const border =
    status === 'good'
      ? 'border-emerald-600/40'
      : status === 'warn'
        ? 'border-amber-600/40'
        : 'border-rose-600/40';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-full w-full rounded-lg border bg-slate-950/40 px-3 py-2.5 text-left transition hover:bg-slate-900/60 print-plain ${border} ${
        highlight ? 'ring-2 ring-sky-500/60' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-200">{r.productName}</span>
        <span className="text-sm">{icon}</span>
      </div>
      <div className="mt-1.5 text-[11px] tabular-nums text-slate-400">
        LTV {(r.appliedLtv * 100).toFixed(0)}% · {money(r.limit)}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-100">
        월 {money(r.monthlyPayment)}
      </div>
      <div
        className={`mt-0.5 text-[11px] tabular-nums ${
          r.feasible ? 'text-slate-400' : 'text-rose-300'
        }`}
      >
        현금 {money(r.requiredCash)}
        {!r.feasible && ` (${money(r.cashGap)} 부족)`}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Badge tone="neutral" title={constraintAdvice(r, property)}>
          {CONSTRAINT_LABELS[r.bindingConstraint]}
        </Badge>
        <Badge tone="neutral">부담 {percent(r.dtiRatio, 0)}</Badge>
        <LeverageBadge result={r} property={property} />
      </div>
      <HiddenProductBadges summary={cell.summary} />
    </button>
  );
}

/**
 * 셀에 안 뜬 상품을 드러냅니다.
 *
 * 승자만 보여주면 정책상품이 아예 계산되지 않았다고 오해하게 됩니다. 실제로는
 * 자격에서 걸렸거나(→ 물건·시나리오를 바꿔야 함) 목적함수에 밀린 것(→ 목적함수만
 * 바꾸면 됨)이고, 둘은 해야 할 행동이 다릅니다.
 */
function HiddenProductBadges({ summary }: { summary: CellSummary }) {
  const { objective } = useStore();
  const { passedOver, rejected } = summary;
  if (!passedOver && rejected.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {passedOver && (
        <Badge
          tone="info"
          title={`${passedOver.productName} — 한도 ${money(passedOver.limit)} (${
            passedOver.limitDelta >= 0 ? '+' : ''
          }${money(passedOver.limitDelta)}) · 금리 ${percent(passedOver.rate)} · 월 ${money(
            passedOver.monthlyPayment
          )} (${passedOver.monthlyDelta >= 0 ? '+' : ''}${money(
            passedOver.monthlyDelta
          )}). 자격은 되지만 “${OBJECTIVE_LABELS[objective]}” 기준에서 밀렸습니다. 목적함수를 바꾸면 이 상품이 올라옵니다.`}
        >
          {passedOver.shortName} 밀림
        </Badge>
      )}
      {rejected.length > 0 && (
        <Badge
          tone="neutral"
          title={rejected.map((x) => `${x.productName} — ${x.reason}`).join('\n')}
        >
          {rejected.length}종 부적격
        </Badge>
      )}
    </div>
  );
}

/**
 * 물건 성격 배지. 입지 점수와 **합치지 않고** 나란히 둡니다 —
 * 좋은 동네의 어중간한 구축이 가장 사기 쉬운 실수라, 두 축이 엇갈리는 걸 보여야 합니다.
 */
function ThesisBadge({ property }: { property: Property }) {
  const t = propertyThesis(property);
  const tone = t.kind === 'ambiguous' ? 'warn' : t.kind === 'stable' ? 'neutral' : 'good';
  return (
    <Badge tone={tone} title={`${t.reason}\n${t.advice}`}>
      {t.label}
    </Badge>
  );
}

function LeverageBadge({ result, property }: { result: LoanResult; property: Property }) {
  const { profile } = useStore();
  const view = leverageView(result, property, profile.priceGrowthRate);
  if (!view) return null;

  return view.amplifying ? (
    <Badge
      tone="neutral"
      title={`가격상승률 ${percent(view.unleveredReturn, 1)} > 금리 ${percent(
        view.breakEvenGrowth,
        2
      )} — 레버리지가 수익을 증폭합니다 (배율 ${view.debtToEquity.toFixed(1)}배)`}
    >
      레버 {view.debtToEquity.toFixed(1)}배
    </Badge>
  ) : (
    <Badge
      tone="bad"
      title={`가격상승률 ${percent(view.unleveredReturn, 1)} < 금리 ${percent(
        view.breakEvenGrowth,
        2
      )} — 배율 ${view.debtToEquity.toFixed(1)}배가 손실을 키웁니다`}
    >
      레버리지 역효과
    </Badge>
  );
}

function DetailDrawer({
  property,
  scenario,
  cell,
  onClose,
}: {
  property: Property;
  scenario: DerivedScenario;
  cell: CellResult | undefined;
  onClose: () => void;
}) {
  if (!cell) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 no-print" onClick={onClose}>
      <div
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-slate-800 bg-slate-950 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">
              {property.name} × {scenario.label}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {money(property.price)} · 전용 {property.areaSqm}㎡ · 판정소득{' '}
              {money(scenario.assessedIncome)} · 가용현금 {money(scenario.availableCash)}
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </div>

        <div className="space-y-3">
          {cell.all.map((r) => (
            <ProductDetail key={r.productId} result={r} property={property} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProductDetail({ result: r, property }: { result: LoanResult; property: Property }) {
  if (!r.eligible) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-400">{r.productName}</span>
          <Badge tone="bad">부적격</Badge>
        </div>
        <p className="mt-2 text-xs text-rose-300/90">{r.rejectReason}</p>
      </div>
    );
  }

  const steps = [
    { label: 'LTV 한도', value: r.limitLtv, key: 'LTV' },
    { label: '상품 캡', value: r.limitCap, key: 'CAP' },
    { label: '상환능력 한도', value: r.limitRepay, key: r.bindingConstraint === 'DSR' ? 'DSR' : 'DTI' },
    { label: '매매가 상한', value: r.limitPrice, key: 'PRICE' },
  ];

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-100">{r.productName}</span>
        <div className="flex gap-1.5">
          <Badge tone="neutral">금리 {percent(r.rate, 2)}</Badge>
          {r.feasible ? (
            r.tight ? (
              <Badge tone="warn">빠듯함</Badge>
            ) : (
              <Badge tone="good">실행 가능</Badge>
            )
          ) : (
            <Badge tone="bad">자금 부족</Badge>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="대출 한도" value={money(r.limit)} />
        <Stat label="월 상환액" value={money(r.monthlyPayment)} />
        <Stat label="총 이자" value={money(r.totalInterest)} />
        <Stat
          label="필요 현금"
          value={money(r.requiredCash)}
          tone={r.feasible ? 'good' : 'bad'}
        />
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-[11px] font-medium text-slate-400">
          한도 산출 — 가장 작은 값이 최종 한도가 됩니다
        </div>
        <div className="space-y-1">
          {steps.map((s) => {
            const binding = s.key === r.bindingConstraint;
            const value = Number.isFinite(s.value) && s.value > 0 ? s.value : null;
            return (
              <div
                key={s.label}
                className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs ${
                  binding ? 'bg-sky-500/10 text-sky-200' : 'text-slate-500'
                }`}
              >
                <span>
                  {s.label}
                  {binding && ' ← 여기서 막힘'}
                </span>
                <span className="tabular-nums">{value ? money(value) : '제한 없음'}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {constraintAdvice(r, property)}
        </p>
      </div>

      <LeverageBlock result={r} property={property} />

      <div className="mt-4">
        <div className="mb-1.5 text-[11px] font-medium text-slate-400">부대비용</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-400 sm:grid-cols-3">
          <Row label="취득세" value={won(r.costs.acquisitionTax)} />
          {r.costs.acquisitionTaxRelief > 0 && (
            <Row label="생애최초 감면" value={`−${won(r.costs.acquisitionTaxRelief)}`} good />
          )}
          <Row label="지방교육세" value={won(r.costs.localEducationTax)} />
          {r.costs.ruralTax > 0 && <Row label="농특세" value={won(r.costs.ruralTax)} />}
          <Row label="중개보수" value={won(r.costs.brokerage)} />
          <Row label="법무·인지·채권" value={won(r.costs.legalAndBond)} />
          <Row label="이사·수리" value={won(r.costs.movingAndRepair)} />
          <Row label="합계" value={won(r.costs.total)} strong />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          필요현금 = 자기부담금 {money(r.downPayment)} + 부대비용 {money(r.costs.total)} ={' '}
          <span className="text-slate-300">{money(r.requiredCash)}</span>
        </p>
      </div>

      {r.warnings.length > 0 && (
        <ul className="mt-4 space-y-1">
          {r.warnings.map((w) => (
            <li key={w} className="flex gap-1.5 text-[11px] text-amber-300/90">
              <span>·</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LeverageBlock({ result, property }: { result: LoanResult; property: Property }) {
  const { profile } = useStore();
  const view = leverageView(result, property, profile.priceGrowthRate);
  if (!view) return null;

  const tone = view.amplifying ? 'text-emerald-300' : 'text-rose-300';

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-medium text-slate-400">레버리지 방향</span>
        {view.amplifying ? (
          <Badge tone="good">수익 증폭</Badge>
        ) : (
          <Badge tone="bad">손실 증폭</Badge>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs tabular-nums">
          <span className="text-slate-500">가격상승 {percent(view.unleveredReturn, 1)}</span>
          <span className="text-slate-600">−</span>
          <span className="text-slate-500">금리 {percent(view.breakEvenGrowth, 2)}</span>
          <span className="text-slate-600">=</span>
          <span className={tone}>스프레드 {percent(view.spread, 2)}</span>
        </div>

        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs tabular-nums">
          <span className="text-slate-500">
            자기자본 {money(view.equity)} · 배율 {view.debtToEquity.toFixed(2)}배
          </span>
          <span className="text-slate-600">→</span>
          <span className={`font-semibold ${tone}`}>
            자기자본 수익률 ≈ {percent(view.equityReturn, 1)}/년
          </span>
          <span className="text-slate-600">
            (무차입 {percent(view.unleveredReturn, 1)})
          </span>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          {view.amplifying
            ? `스프레드가 양수라 배율 ${view.debtToEquity.toFixed(
                2
              )}배가 수익을 키웁니다. 같은 조건이면 LTV가 높을수록 유리합니다.`
            : `스프레드가 음수라 배율 ${view.debtToEquity.toFixed(
                2
              )}배가 손실을 키웁니다. 이 구간에서는 LTV가 높을수록 불리하며, 비수도권 80% 우대가 오히려 독이 됩니다.`}
        </p>

        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
          방향을 보기 위한 1차 근사입니다. 원금상환·보유세·거래비용·양도세를 제외했으므로
          수익률 예측치가 아닙니다. 실제 수익률은 부대비용 {money(result.costs.total)}만큼 더
          낮고, 보유기간이 짧을수록 격차가 벌어집니다.
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  good,
  strong,
}: {
  label: string;
  value: string;
  good?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span
        className={`tabular-nums ${
          good ? 'text-emerald-300' : strong ? 'font-semibold text-slate-200' : ''
        }`}
      >
        {value}
      </span>
    </div>
  );
}
