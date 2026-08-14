import { Badge, Card, SegmentedControl, Stat } from '../components/ui';
import { money, percent } from '../engine/format';
import { OBJECTIVE_LABELS } from '../engine/loan';
import { RULES } from '../engine/rules';
import { ALL_SCENARIO_AXES, deriveScenario } from '../engine/scenario';
import { useStore } from '../state/store';
import type { Objective } from '../engine/types';

export function ScenarioPage() {
  const { profile, enabledScenarioIds, toggleScenario, objective, setObjective } = useStore();

  return (
    <div className="space-y-5">
      <Card
        title="시나리오 축"
        subtitle="지역군은 물건에 귀속되므로 시나리오 축은 혼인시점 × 명의 4종입니다. 최종 조합 수는 4 × 물건 수가 됩니다."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {ALL_SCENARIO_AXES.map((axis) => {
            const s = deriveScenario(profile, axis);
            const on = enabledScenarioIds.includes(axis.id);
            return (
              <button
                key={axis.id}
                type="button"
                onClick={() => toggleScenario(axis.id)}
                className={`rounded-xl border p-4 text-left transition ${
                  on
                    ? 'border-sky-500/60 bg-sky-500/5'
                    : 'border-slate-800 bg-slate-950/30 opacity-50 hover:opacity-80'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-100">{s.label}</span>
                  <div className="flex gap-1">
                    {s.isSingleHousehold && <Badge tone="info">단독세대주</Badge>}
                    {s.isFirstTimeValid ? (
                      <Badge tone="good">생애최초 유효</Badge>
                    ) : (
                      <Badge tone="bad">생애최초 소멸</Badge>
                    )}
                    {s.giftTaxFlag && <Badge tone="warn">증여세</Badge>}
                    {s.contributionRatioFlag && <Badge tone="warn">지분율 주의</Badge>}
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">판정소득</dt>
                    <dd className="tabular-nums text-slate-300">{money(s.assessedIncome)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">가용현금</dt>
                    <dd className="tabular-nums text-slate-300">{money(s.availableCash)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">무주택세대</dt>
                    <dd className={s.hasNoHouseHousehold ? 'text-emerald-300' : 'text-rose-300'}>
                      {s.hasNoHouseHousehold ? '충족' : '미충족'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">신혼 판정</dt>
                    <dd className="text-slate-300">{s.isNewlywed ? '해당' : '비해당'}</dd>
                  </div>
                </dl>

                {s.firstTimeLostReason && (
                  <p className="mt-2.5 text-[11px] leading-relaxed text-rose-300/90">
                    {s.firstTimeLostReason}
                  </p>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          카드를 눌러 비교 매트릭스에 포함할 시나리오를 켜고 끕니다. 최소 1개는 유지됩니다.
        </p>
      </Card>

      <Card
        title="목적함수"
        subtitle="여러 상품이 자격을 통과하면 이 기준으로 대표 상품을 고릅니다. 동점이면 고정금리·중도상환수수료 면제를 우대합니다."
      >
        <SegmentedControl<Objective>
          value={objective}
          onChange={setObjective}
          options={(Object.keys(OBJECTIVE_LABELS) as Objective[]).map((k) => ({
            value: k,
            label: OBJECTIVE_LABELS[k],
          }))}
        />
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          주의: 월납·이자 최소화는 <b>덜 빌리는 쪽</b>을 유리하게 만듭니다. 대출을 적게 받으면 월납은
          당연히 낮아지지만 필요현금이 늘어납니다. 매트릭스에서 월납과 필요현금을 반드시 함께 읽으세요.
        </p>
      </Card>

      <Card
        title="지역군 = 대출조건"
        subtitle="이 도구의 핵심 전제입니다. 같은 소득·같은 생애최초라도 물건이 어느 권역에 있느냐로 LTV가 갈립니다."
      >
        <div className="grid gap-3 md:grid-cols-3">
          {RULES.regions.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 print-plain"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-100">{r.label}</span>
                <Badge tone={r.isCapitalArea ? 'bad' : 'good'}>
                  {r.isCapitalArea ? '수도권 · LTV 70%' : '비수도권 · LTV 80%'}
                </Badge>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{r.note}</p>
              <ul className="mt-3 space-y-1">
                {r.checklist.map((c) => (
                  <li key={c} className="flex gap-1.5 text-[11px] text-slate-500">
                    <span className="text-slate-600">·</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card title="현재 프로필 요약">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="본인 연소득" value={money(profile.ownIncome)} />
          <Stat label="합산 연소득" value={money(profile.ownIncome + profile.spouseIncome)} />
          <Stat label="본인 현금" value={money(profile.ownCash)} />
          <Stat
            label="가구 합산 현금"
            value={money(profile.ownCash + profile.spouseCash)}
          />
          <Stat label="순자산" value={money(profile.netWorth)} />
          <Stat label="기존 대출 월납" value={money(profile.existingMonthlyDebt)} />
          <Stat label="만기" value={`${profile.termYears}년`} />
          <Stat
            label="금리 가정 조정"
            value={profile.rateAdjust === 0 ? '기본' : `${percent(profile.rateAdjust, 2)}p`}
            tone={profile.rateAdjust > 0 ? 'warn' : 'neutral'}
          />
        </div>
      </Card>
    </div>
  );
}
