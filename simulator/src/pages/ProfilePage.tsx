import {
  Badge,
  Card,
  Field,
  MoneyInput,
  NumberInput,
  Select,
  TextInput,
  Toggle,
} from '../components/ui';
import { money } from '../engine/format';
import { useStore } from '../state/store';
import type { MaritalStatus, SpouseHouseHistory } from '../engine/types';

export function ProfilePage() {
  const { profile, setProfile } = useStore();
  const householdIncome = profile.ownIncome + profile.spouseIncome;
  const householdCash = profile.ownCash + profile.spouseCash;

  return (
    <div className="space-y-5">
      <Card
        title="소득"
        subtitle="DSR·DTI 판정과 정책상품 소득요건에 직접 들어가는 값입니다. 세전 연소득 기준."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="본인 연소득" hint="세전, 상여 포함">
            <MoneyInput
              value={profile.ownIncome}
              onChange={(v) => setProfile({ ownIncome: v })}
            />
          </Field>
          <Field label="배우자(예정) 연소득" hint="혼인 후·공동명의 시나리오에서 합산">
            <MoneyInput
              value={profile.spouseIncome}
              onChange={(v) => setProfile({ spouseIncome: v })}
            />
          </Field>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          합산 소득 <span className="text-slate-300">{money(householdIncome)}</span> — 보금자리론
          신혼 상한 8,500만원, 디딤돌 생애최초 상한 7,000만원과 비교됩니다.
        </p>
      </Card>

      <Card
        title="생애최초 · 세대 요건"
        subtitle="이 블록이 LTV 우대와 상품 자격을 통째로 결정합니다."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            checked={profile.isFirstTime}
            onChange={(v) => setProfile({ isFirstTime: v })}
            label="본인 생애최초 주택 구입"
            hint="세대 전원이 과거 주택 소유 이력 없음"
          />
          <Toggle
            checked={profile.isOver30}
            onChange={(v) => setProfile({ isOver30: v })}
            label="본인 만 30세 이상"
            hint="미혼 단독세대주의 디딤돌 이용 요건"
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="배우자 주택 소유 이력"
            hint="혼인 후 시나리오에서 세대 기준 생애최초를 소멸시킵니다"
          >
            <Select<SpouseHouseHistory>
              value={profile.spouseHouseHistory}
              onChange={(v) => setProfile({ spouseHouseHistory: v })}
              options={[
                { value: 'none', label: '없음' },
                { value: 'disposed', label: '처분 완료' },
                { value: 'owning', label: '보유 중' },
              ]}
            />
          </Field>
          <Field label="혼인 상태" hint="신혼 특례·소득 합산 시점 판정">
            <Select<MaritalStatus>
              value={profile.maritalStatus}
              onChange={(v) => setProfile({ maritalStatus: v })}
              options={[
                { value: 'single', label: '미혼' },
                { value: 'engaged', label: '혼인 예정' },
                { value: 'newlywed7y', label: '혼인 7년 이내' },
                { value: 'over7y', label: '혼인 7년 초과' },
              ]}
            />
          </Field>
        </div>
        {profile.spouseHouseHistory !== 'none' && (
          <p className="mt-3 flex items-start gap-2 text-xs text-amber-300">
            <Badge tone="warn">주의</Badge>
            <span>
              배우자에게 주택 소유 이력이 있으므로 <b>혼인 후</b> 시나리오에서는 생애최초 요건이
              소멸합니다. 혼인 전 매수와의 격차를 매트릭스에서 확인하세요.
            </span>
          </p>
        )}
      </Card>

      <Card title="자녀" subtitle="소득기준 완화와 신생아 특례 자격에 사용됩니다.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="자녀 수">
            <NumberInput
              value={profile.childCount}
              onChange={(v) => setProfile({ childCount: Math.max(0, v) })}
              suffix="명"
            />
          </Field>
          <div className="flex items-end">
            <Toggle
              checked={profile.newbornWithin2y}
              onChange={(v) => setProfile({ newbornWithin2y: v })}
              label="2년 내 출산·입양 자녀 있음"
              hint="신생아 특례 디딤돌 자격 판정"
            />
          </div>
        </div>
      </Card>

      <Card
        title="자산 · 부채"
        subtitle="실행 가능성(필요현금 ≤ 가용현금)과 디딤돌 자산요건 판정에 쓰입니다."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="본인 보유 현금">
            <MoneyInput value={profile.ownCash} onChange={(v) => setProfile({ ownCash: v })} />
          </Field>
          <Field label="배우자 보유 현금" hint="시나리오별로 가용 여부가 갈립니다">
            <MoneyInput
              value={profile.spouseCash}
              onChange={(v) => setProfile({ spouseCash: v })}
            />
          </Field>
          <Field label="순자산" hint="디딤돌 자산요건 5.11억 판정">
            <MoneyInput value={profile.netWorth} onChange={(v) => setProfile({ netWorth: v })} />
          </Field>
          <Field label="기존 대출 월 상환액" hint="DSR·DTI에서 차감">
            <MoneyInput
              value={profile.existingMonthlyDebt}
              onChange={(v) => setProfile({ existingMonthlyDebt: v })}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Toggle
            checked={profile.includeSpouseCashBeforeMarriage}
            onChange={(v) => setProfile({ includeSpouseCashBeforeMarriage: v })}
            label="혼인 전 시나리오에서도 배우자 자금 포함"
            hint="증여세 검토 대상이 됩니다"
          />
        </div>

        {profile.includeSpouseCashBeforeMarriage && profile.spouseCash > 0 && (
          <p className="mt-3 flex items-start gap-2 text-xs text-amber-300">
            <Badge tone="warn">증여세</Badge>
            <span>
              혼인 전에 배우자 자금 {money(profile.spouseCash)}을 매수 자금으로 쓰면 증여로 볼 수
              있습니다. 혼인신고 후 부부간 증여공제(10년 6억)를 쓰거나, 차용증·이자지급 등 금전소비대차
              형식을 검토하세요.
            </span>
          </p>
        )}

        <p className="mt-3 text-xs text-slate-500">
          가구 합산 현금 <span className="text-slate-300">{money(householdCash)}</span>
        </p>
      </Card>

      <Card
        title="매수 조건 · 민감도"
        subtitle="시행일이 걸린 제도의 적용 여부와, 금리 변동 가정을 조정합니다."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="매수 예정일" hint="시행 예정 제도의 적용 판정">
            <TextInput
              value={profile.purchaseDate}
              onChange={(v) => setProfile({ purchaseDate: v })}
              placeholder="2026-11-01"
            />
          </Field>
          <Field label="대출 만기">
            <Select
              value={String(profile.termYears)}
              onChange={(v) => setProfile({ termYears: Number(v) })}
              options={[
                { value: '10', label: '10년' },
                { value: '20', label: '20년' },
                { value: '30', label: '30년' },
                { value: '40', label: '40년' },
                { value: '50', label: '50년' },
              ]}
            />
          </Field>
          <Field label="금리 가정 조정" hint="+1 이면 모든 상품 금리 +1%p">
            <NumberInput
              value={Number((profile.rateAdjust * 100).toFixed(2))}
              step={0.25}
              suffix="%p"
              onChange={(v) => setProfile({ rateAdjust: v / 100 })}
            />
          </Field>
          <Field label="이사·수리비" hint="부대비용에 합산">
            <MoneyInput
              value={profile.movingAndRepair}
              onChange={(v) => setProfile({ movingAndRepair: v })}
            />
          </Field>
        </div>
      </Card>
    </div>
  );
}
