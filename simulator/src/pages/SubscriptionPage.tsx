import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Foldable,
  MoneyInput,
  NumberInput,
  Select,
  TextInput,
  Toggle,
} from '../components/ui';
import { money, percent } from '../engine/format';
import { annualizedPremium, premiumRows } from '../engine/presale';
import { collectedDistricts } from '../engine/regions';
import { RULES } from '../engine/rules';
import {
  paymentSchedule,
  subscriptionPlan,
  type SubscriptionPlan,
} from '../engine/subscription';
import { defaultAssumptions } from '../engine/tenure';
import type { RegionId } from '../engine/types';
import { useStore } from '../state/store';

const REGION_OPTIONS = RULES.regions.map((r) => ({ value: r.id, label: r.label }));

/**
 * 같은 지역·비슷한 평형의 분양권이 실제로 얼마나 붙었는지.
 *
 * 입력한 분양가가 맞는지는 확인해 줄 수 없습니다 — 그건 단지 공고에만 있습니다.
 * 대신 **그 지역에서 분양권이 어떻게 움직였는지**를 옆에 놓아, 입력한 기대가
 * 실측 범위 안에 있는지 스스로 보게 합니다.
 */
function useNearbyPremium(region: RegionId, areaSqm: number) {
  return useMemo(() => {
    const codes = collectedDistricts()
      .filter((d) => d.region === region)
      .map((d) => d.code);
    const rows = premiumRows(codes).filter(
      (r) => Math.abs(r.area - areaSqm) <= 10
    );
    if (rows.length < 3) return null;
    const ann = rows.map(annualizedPremium).sort((a, b) => a - b);
    const at = (q: number) => ann[Math.min(ann.length - 1, Math.floor(ann.length * q))];
    return {
      n: rows.length,
      p25: at(0.25),
      median: at(0.5),
      p75: at(0.75),
      lossShare: ann.filter((v) => v < 0).length / ann.length,
    };
  }, [region, areaSqm]);
}

function PlanForm({
  plan,
  onChange,
}: {
  plan: SubscriptionPlan;
  onChange: (patch: Partial<SubscriptionPlan>) => void;
}) {
  const districts = collectedDistricts().filter((d) => d.region === plan.region);
  const balanceRatio = 1 - plan.downPaymentRatio - plan.interimRatio;
  const ratioBroken = balanceRatio < -0.0001;

  return (
    <div className="space-y-5">
      <section>
        <h4 className="mb-2 text-[11px] font-medium tracking-wide text-slate-500">단지</h4>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="단지명">
            <TextInput value={plan.name} onChange={(v) => onChange({ name: v })} />
          </Field>
          <Field label="지역" hint="대출 조건이 여기서 갈립니다">
            <Select<RegionId>
              value={plan.region}
              onChange={(v) => onChange({ region: v, sigungu: '' })}
              options={REGION_OPTIONS}
            />
          </Field>
          <Field label="시군구" hint="실측 대조용 (선택)">
            <Select<string>
              value={plan.sigungu}
              onChange={(v) => onChange({ sigungu: v })}
              options={[
                { value: '', label: '— 선택 안 함' },
                ...districts.map((d) => ({ value: d.label, label: d.label })),
              ]}
            />
          </Field>
          <Field label="전용면적">
            <NumberInput
              value={plan.areaSqm}
              step={0.1}
              suffix="㎡"
              onChange={(v) => onChange({ areaSqm: v })}
            />
          </Field>
          <Field label="분양가" hint="공고문 기준. 발코니 확장·옵션은 별도입니다">
            <MoneyInput value={plan.price} onChange={(v) => onChange({ price: v })} />
          </Field>
          <Field label="입주까지" hint="계약부터 입주지정일까지">
            <NumberInput
              value={plan.waitYears}
              step={0.5}
              suffix="년"
              onChange={(v) => onChange({ waitYears: Math.max(0, v) })}
            />
          </Field>
          <Field label="전매제한" hint="이 기간엔 팔 수 없습니다">
            <NumberInput
              value={plan.resaleBanMonths}
              step={1}
              suffix="개월"
              onChange={(v) => onChange({ resaleBanMonths: Math.max(0, v) })}
            />
          </Field>
          <Field label="청약 가점" hint="당첨 가능성 메모용 — 계산에는 안 씁니다">
            <NumberInput
              value={plan.score ?? 0}
              step={1}
              suffix="점"
              onChange={(v) => onChange({ score: v })}
            />
          </Field>
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-[11px] font-medium tracking-wide text-slate-500">
          납입 구조 — 단지마다 다릅니다
        </h4>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="계약금 비율" hint="자기 돈으로만 냅니다">
            <NumberInput
              value={Math.round(plan.downPaymentRatio * 1000) / 10}
              step={1}
              suffix="%"
              onChange={(v) => onChange({ downPaymentRatio: v / 100 })}
            />
          </Field>
          <Field label="중도금 비율" hint={`${RULES.subscription.interimInstallments}회 분할`}>
            <NumberInput
              value={Math.round(plan.interimRatio * 1000) / 10}
              step={1}
              suffix="%"
              onChange={(v) => onChange({ interimRatio: v / 100 })}
            />
          </Field>
          <Field label="중도금 금리">
            <NumberInput
              value={Math.round(plan.interimLoanRate * 10000) / 100}
              step={0.05}
              suffix="%"
              onChange={(v) => onChange({ interimLoanRate: v / 100 })}
            />
          </Field>
          <Field label="잔금 비율" hint="계약금·중도금의 나머지로 자동 계산">
            <div
              className={`mt-1 rounded-lg border px-3 py-2 text-sm tabular-nums ${
                ratioBroken
                  ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                  : 'border-slate-800 bg-slate-950/40 text-slate-300'
              }`}
            >
              {percent(balanceRatio)}
            </div>
          </Field>
        </div>
        <div className="mt-3">
          <Toggle
            label="중도금 이자후불제"
            hint="대기 중엔 안 내고 입주 때 한꺼번에 정산합니다. 후불이면 대기 기간 월 부담이 가벼워 보이지만 입주 시 목돈이 커집니다."
            checked={plan.interimDeferred}
            onChange={(v) => onChange({ interimDeferred: v })}
          />
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-[11px] font-medium tracking-wide text-slate-500">
          입주 시 전환할 주담대
        </h4>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="주담대 금리">
            <NumberInput
              value={Math.round(plan.mortgageRate * 10000) / 100}
              step={0.05}
              suffix="%"
              onChange={(v) => onChange({ mortgageRate: v / 100 })}
            />
          </Field>
          <Field
            label="주담대 LTV"
            hint={
              RULES.regions.find((r) => r.id === plan.region)?.isCapitalArea
                ? '수도권 — 생애최초 우대가 무효라 70%가 상한입니다'
                : '비수도권 — 생애최초면 80%까지 가능합니다'
            }
          >
            <NumberInput
              value={Math.round(plan.mortgageLtv * 1000) / 10}
              step={1}
              suffix="%"
              onChange={(v) => onChange({ mortgageLtv: v / 100 })}
            />
          </Field>
        </div>
      </section>

      <Field label="메모">
        <TextInput
          value={plan.memo ?? ''}
          placeholder="입주지정일, 옵션, 특별공급 유형 등"
          onChange={(v) => onChange({ memo: v })}
        />
      </Field>
    </div>
  );
}

function Schedule({ plan }: { plan: SubscriptionPlan }) {
  const steps = paymentSchedule(plan);
  const maxMonth = Math.max(1, ...steps.map((s) => s.monthOffset));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-end gap-3 pb-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-sky-500/45" /> 내 돈
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-slate-600/50" /> 대출
        </span>
      </div>
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-[11px] text-slate-500 tabular-nums">
            +{s.monthOffset}개월
          </span>
          <span className="w-28 shrink-0 text-xs text-slate-300">{s.label}</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-slate-900/60">
            <div
              className={`h-full ${s.funded === 'cash' ? 'bg-sky-500/45' : 'bg-slate-600/50'}`}
              style={{
                marginLeft: `${(s.monthOffset / maxMonth) * 55}%`,
                width: `${Math.max(6, (s.amount / plan.price) * 40)}%`,
              }}
            />
          </div>
          <span className="w-24 shrink-0 text-right text-xs text-slate-200 tabular-nums">
            {money(s.amount)}
          </span>
          <span
            className={`w-14 shrink-0 text-right text-[10px] ${
              s.funded === 'cash' ? 'text-sky-300' : 'text-slate-500'
            }`}
          >
            {s.funded === 'cash' ? '내 돈' : '대출'}
          </span>
        </div>
      ))}
    </div>
  );
}

function PlanResult({ plan }: { plan: SubscriptionPlan }) {
  const { profile } = useStore();
  const assumptions = useMemo(() => defaultAssumptions(plan.region), [plan.region]);
  /*
   * 청약은 계약금부터 입주 잔금까지 몇 년에 걸치므로, 그 사이에 합가하는 것이
   * 자연스럽습니다. 그래서 시나리오축을 따로 걸지 않고 **합가 기준 가용현금**을
   * 씁니다 — 이 화면은 순위를 매기는 곳이 아니라 필요 현금을 재는 곳입니다.
   */
  const equity = profile.ownCash + profile.spouseCash;

  const res = useMemo(
    () => subscriptionPlan(plan, assumptions, equity, profile.termYears),
    [plan, assumptions, equity, profile.termYears]
  );
  const nearby = useNearbyPremium(plan.region, plan.areaSqm);
  const shortAtContract = res.initialOutlay - equity;
  const moveInNet = res.moveInCash - res.waitDeposit;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            k: '계약 때 나가는 현금',
            v: res.initialOutlay,
            sub: `계약금 ${money(res.downPayment)} + 대기 전세 자기부담 ${money(res.waitDeposit)}`,
            bad: shortAtContract > 0,
          },
          /*
           * 이 값은 음수가 될 수 있습니다 — 돌려받는 전세보증금이 잔금 자기부담보다
           * 크면 오히려 손에 돈이 남습니다. 그때 "나가는 현금 −712만" 이라 적으면
           * 부호를 두 번 읽어야 하므로 라벨 자체를 바꿉니다.
           */
          moveInNet >= 0
            ? {
                k: '입주 때 더 필요한 현금',
                v: moveInNet,
                sub: `잔금·취득비 ${money(res.moveInCash)} − 돌려받는 보증금 ${money(res.waitDeposit)}`,
                bad: false,
              }
            : {
                k: '입주 때 오히려 남는 현금',
                v: -moveInNet,
                sub: `돌려받는 보증금 ${money(res.waitDeposit)} 이 잔금 자기부담 ${money(res.moveInCash)} 보다 큽니다`,
                bad: false,
              },
          {
            k: '중도금 이자 총액',
            v: res.interimInterest,
            sub: plan.interimDeferred ? '입주 때 한꺼번에 정산' : '대기 기간에 매달',
            bad: false,
          },
        ].map((s) => (
          <div
            key={s.k}
            className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3"
          >
            <div className="text-[11px] text-slate-500">{s.k}</div>
            <div
              className={`mt-0.5 text-lg font-semibold tabular-nums ${
                s.bad ? 'text-rose-300' : 'text-slate-100'
              }`}
            >
              {money(s.v)}
            </div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{s.sub}</div>
          </div>
        ))}
      </div>

      {shortAtContract > 0 && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs leading-relaxed text-rose-200">
          계약 시점 현금이 <span className="font-semibold">{money(shortAtContract)}</span>{' '}
          모자랍니다. 계약금은 대출이 안 되고, 대기 기간에 살 집 보증금도 같이 필요합니다 —
          청약의 진짜 문턱은 분양가가 아니라 이 두 개입니다.
        </div>
      )}

      <div>
        <h4 className="mb-2 text-[11px] font-medium tracking-wide text-slate-500">
          납입 일정 — 비율이 아니라 시점이 문제입니다
        </h4>
        <Schedule plan={plan} />
      </div>

      {nearby && (
        <Foldable
          summary={`실측 대조 — ${
            RULES.regions.find((r) => r.id === plan.region)?.label
          } · 전용 ${Math.round(plan.areaSqm)}㎡ 안팎 분양권`}
          count={nearby.n}
        >
          <div className="space-y-2 text-xs leading-relaxed text-slate-400">
            <p>
              분양권 최종 거래가 대비 준공 후 매매가의 <b className="text-slate-200">연환산</b>{' '}
              변화입니다. 중위{' '}
              <b className="text-slate-100 tabular-nums">{percent(nearby.median)}</b> · 하위
              25%{' '}
              <span className="tabular-nums text-slate-300">{percent(nearby.p25)}</span> · 상위
              25%{' '}
              <span className="tabular-nums text-slate-300">{percent(nearby.p75)}</span>.
              준공 후가 더 쌌던 비율{' '}
              <span className="tabular-nums text-amber-300">{percent(nearby.lossShare, 0)}</span>.
            </p>
            <p className="text-slate-500">
              입력한 분양가가 적정한지는 확인해 줄 수 없습니다 — 그건 단지 공고에만 있습니다.
              이 수치는 같은 지역·평형의 분양권이 실제로 어떻게 움직였는지일 뿐이고, 지나간
              시장의 상승분이 통째로 섞여 있습니다.
            </p>
          </div>
        </Foldable>
      )}

      {(res.notes.length > 0 || res.warnings.length > 0) && (
        <ul className="space-y-1.5 text-[11px] leading-relaxed">
          {res.warnings.map((w, i) => (
            <li key={`w${i}`} className="text-amber-300">
              ⚠ {w}
            </li>
          ))}
          {res.notes.map((n, i) => (
            <li key={`n${i}`} className="text-slate-500">
              · {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SubscriptionPage() {
  const { plans, addPlan, updatePlan, removePlan } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const current = plans.find((p) => p.id === openId) ?? plans[0] ?? null;

  return (
    <div className="space-y-5">
      <Card
        title="청약 단지 (선택)"
        subtitle="매수·전세·월세와 구조가 다릅니다 — 계약금을 먼저 내고, 입주까지 몇 년을 다른 집에서 임차로 삽니다"
        action={
          <Button size="sm" onClick={() => setOpenId(addPlan())}>
            단지 추가
          </Button>
        }
      >
        <p className="text-xs leading-relaxed text-slate-500">
          분양가·입주예정·중도금 조건·전매제한은 <b className="text-slate-300">실거래 API에
          없습니다</b> — 단지 공고에만 있어서 직접 넣으셔야 합니다. 넣으면 계약·대기·입주
          시점별로 현금이 언제 얼마나 필요한지와, 같은 지역·평형 분양권이 실제로 얼마나
          붙었는지를 나란히 봅니다.
        </p>

        {plans.length === 0 ? (
          <div className="mt-4">
            <Empty>
              아직 넣은 단지가 없습니다. 이 탭은 선택이라 비워 둬도 나머지 화면은 그대로
              돌아갑니다.
            </Empty>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {plans.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOpenId(p.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  current?.id === p.id
                    ? 'bg-sky-500/15 text-sky-300'
                    : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
                }`}
              >
                {p.name || '이름 없음'}
                <span className="ml-2 text-[10px] text-slate-500 tabular-nums">
                  {money(p.price)}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {current && (
        <>
          <Card
            title={current.name || '이름 없는 단지'}
            subtitle="단지 공고문의 값을 그대로 넣으세요"
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (window.confirm(`'${current.name || '이름 없음'}'을 지울까요?`)) {
                    removePlan(current.id);
                    setOpenId(null);
                  }
                }}
              >
                삭제
              </Button>
            }
          >
            <PlanForm
              plan={current}
              onChange={(patch) => updatePlan(current.id, patch)}
            />
          </Card>

          <Card
            title="이 단지를 하면 현금이 언제 얼마나 필요한가"
            subtitle="가용현금은 1번 가구 프로필, 전세가율·전세대출 금리는 실측치를 씁니다"
            action={
              current.resaleBanMonths > 0 ? (
                <Badge tone="warn">전매제한 {current.resaleBanMonths}개월</Badge>
              ) : undefined
            }
          >
            <PlanResult plan={current} />
          </Card>
        </>
      )}
    </div>
  );
}
