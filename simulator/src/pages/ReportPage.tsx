import { Badge, Button, Card, Empty, Stat } from '../components/ui';
import { money, percent } from '../engine/format';
import { CONSTRAINT_LABELS, OBJECTIVE_LABELS, constraintAdvice } from '../engine/loan';
import { cellKey } from '../engine/matrix';
import { RULES } from '../engine/rules';
import { scoreProperty } from '../engine/scoring';
import { useStore } from '../state/store';

export function ReportPage() {
  const { profile, properties, matrix, objective } = useStore();
  const rec = matrix.recommendation;
  const recProperty = rec ? properties.find((p) => p.id === rec.propertyId) : null;
  const recScenario = rec ? matrix.scenarios.find((s) => s.id === rec.scenarioId) : null;

  const feasibleCount = Object.values(matrix.cells).filter((c) => c.best?.feasible).length;
  const totalCount = Object.values(matrix.cells).length;

  return (
    <div className="space-y-5">
      <Card
        title="종합 리포트"
        subtitle={`규정 기준일 ${RULES.effectiveFrom} · 목적함수 ${OBJECTIVE_LABELS[objective]}`}
        action={
          <div className="no-print">
            <Button onClick={() => window.print()}>인쇄 / PDF 저장</Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="검토 조합" value={`${totalCount}개`} hint={`물건 ${properties.length} × 시나리오 ${matrix.scenarios.length}`} />
          <Stat
            label="실행 가능 조합"
            value={`${feasibleCount}개`}
            tone={feasibleCount > 0 ? 'good' : 'bad'}
          />
          <Stat label="판정 기준 만기" value={`${profile.termYears}년`} />
          <Stat
            label="가구 현금"
            value={money(profile.ownCash + profile.spouseCash)}
            hint={`본인 ${money(profile.ownCash)} + 배우자 ${money(profile.spouseCash)}`}
          />
        </div>
      </Card>

      {rec && recProperty && recScenario ? (
        <Card title="추천 조합">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-slate-100">{recProperty.name}</span>
            <Badge tone="info">{recScenario.label}</Badge>
            <Badge tone="good">{rec.best!.productName}</Badge>
            <Badge tone="neutral">{CONSTRAINT_LABELS[rec.best!.bindingConstraint]}</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="대출 한도" value={money(rec.best!.limit)} />
            <Stat label="적용 금리" value={percent(rec.best!.rate, 2)} />
            <Stat label="월 상환액" value={money(rec.best!.monthlyPayment)} />
            <Stat label="총 이자" value={money(rec.best!.totalInterest)} />
            <Stat label="자기부담금" value={money(rec.best!.downPayment)} />
            <Stat label="부대비용" value={money(rec.best!.costs.total)} />
            <Stat
              label="필요 현금"
              value={money(rec.best!.requiredCash)}
              tone={rec.best!.tight ? 'warn' : 'good'}
            />
            <Stat
              label="상환부담률"
              value={percent(rec.best!.dtiRatio, 0)}
              tone={rec.best!.dtiRatio > RULES.defaults.dtiSafeLine ? 'warn' : 'good'}
            />
          </div>
          <p className="mt-3 text-xs text-slate-400">
            {constraintAdvice(rec.best!, recProperty)}
          </p>
          {rec.best!.warnings.length > 0 && (
            <ul className="mt-3 space-y-1">
              {rec.best!.warnings.map((w) => (
                <li key={w} className="flex gap-1.5 text-[11px] text-amber-300/90">
                  <span>·</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Card title="추천 조합">
          <Empty>
            실행 가능한 조합이 없습니다. 이것도 중요한 정보입니다 — 물건 가격을 낮추거나, 비수도권으로
            지역을 바꾸거나, 자금 계획을 다시 세워야 한다는 뜻입니다.
          </Empty>
        </Card>
      )}

      <Card
        title="물건별 요약"
        subtitle="입지 점수와 대출 적합도는 별개 축입니다. 하나로 합산하지 않았습니다."
      >
        {properties.length === 0 ? (
          <Empty>등록된 물건이 없습니다.</Empty>
        ) : (
          <div className="space-y-4">
            {properties.map((p) => {
              const score = scoreProperty(p);
              const region = RULES.regions.find((r) => r.id === p.region)!;
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 print-plain"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-100">{p.name}</span>
                    <Badge tone={region.isCapitalArea ? 'bad' : 'good'}>{region.label}</Badge>
                    <span className="text-xs tabular-nums text-slate-400">{money(p.price)}</span>
                    <Badge tone="info">
                      입지 {score.total.toFixed(1)}점 · {score.grade}
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {score.byCategory
                      .filter((c) => c.weight > 0)
                      .map((c) => (
                        <span
                          key={c.id}
                          className="rounded-md border border-slate-800 bg-slate-900/50 px-2 py-0.5 text-[11px] text-slate-400"
                        >
                          {c.label} {c.score.toFixed(0)}
                        </span>
                      ))}
                    {score.penalty > 0 && <Badge tone="bad">감점 −{score.penalty}</Badge>}
                  </div>

                  <table className="mt-3 w-full text-[11px]">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="py-1 text-left font-medium">시나리오</th>
                        <th className="py-1 text-left font-medium">상품</th>
                        <th className="py-1 text-right font-medium">한도</th>
                        <th className="py-1 text-right font-medium">월납</th>
                        <th className="py-1 text-right font-medium">필요현금</th>
                        <th className="py-1 text-right font-medium">부담률</th>
                        <th className="py-1 pl-3 text-left font-medium">제약</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.scenarios.map((s) => {
                        const cell = matrix.cells[cellKey(p.id, s.id)];
                        const r = cell?.best;
                        return (
                          <tr key={s.id} className="border-t border-slate-800/70">
                            <td className="py-1.5 text-slate-300">{s.label}</td>
                            {r ? (
                              <>
                                <td className="py-1.5 text-slate-400">{r.productName}</td>
                                <td className="py-1.5 text-right tabular-nums text-slate-300">
                                  {money(r.limit)}
                                </td>
                                <td className="py-1.5 text-right tabular-nums text-slate-300">
                                  {money(r.monthlyPayment)}
                                </td>
                                <td
                                  className={`py-1.5 text-right tabular-nums ${
                                    r.feasible ? 'text-emerald-300' : 'text-rose-300'
                                  }`}
                                >
                                  {money(r.requiredCash)}
                                </td>
                                <td className="py-1.5 text-right tabular-nums text-slate-300">
                                  {percent(r.dtiRatio, 0)}
                                </td>
                                <td className="py-1.5 pl-3 text-slate-500">
                                  {CONSTRAINT_LABELS[r.bindingConstraint]}
                                </td>
                              </>
                            ) : (
                              <td colSpan={6} className="py-1.5 text-slate-600">
                                이용 가능 상품 없음 —{' '}
                                {cell?.all.find((x) => x.rejectReason)?.rejectReason}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="적용 규정 및 면책">
        <dl className="space-y-2 text-xs">
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-slate-500">룰셋 버전</dt>
            <dd className="text-slate-300">
              {RULES.version} ({RULES.label})
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-slate-500">기준일</dt>
            <dd className="text-slate-300">{RULES.effectiveFrom}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-slate-500">매수 예정일</dt>
            <dd className="text-slate-300">{profile.purchaseDate}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-slate-500">면책</dt>
            <dd className="leading-relaxed text-slate-400">{RULES.disclaimer}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-slate-500">입지 점수</dt>
            <dd className="leading-relaxed text-slate-400">
              입지 점수는 사용자가 입력한 주관적 평가의 가중합입니다. 객관적 시세 예측이 아니며,
              가중치 프리셋을 바꾸면 순위도 바뀝니다.
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
