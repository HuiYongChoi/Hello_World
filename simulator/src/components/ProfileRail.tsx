import { money, percent } from '../engine/format';
import { useStore } from '../state/store';
import { Card, Rail, Stat } from './ui';

/**
 * 입력 탭 오른쪽 고정 열 — 지금 넣은 값이 무엇이고, 그래서 몇 조합이 되는지.
 *
 * 예전에는 "현재 프로필 요약" 이 시나리오 단계 맨 끝에 있어, 프로필을 고치는 중에는
 * 볼 수 없었습니다. 세 단계 어디서든 옆에 붙어 있고, 다음 단계로 가는 단추도 여기 둡니다.
 */
export function ProfileRail({ next }: { next: { label: string; go: () => void } }) {
  const { profile, matrix } = useStore();
  const cells = Object.values(matrix.cells);
  const feasible = cells.filter((c) => c.best?.feasible).length;

  return (
    <Rail>
      <Card title="현재 프로필 요약">
        <div className="grid grid-cols-2 gap-2.5">
          <Stat label="본인 연소득" value={money(profile.ownIncome)} />
          <Stat label="합산 연소득" value={money(profile.ownIncome + profile.spouseIncome)} />
          <Stat label="본인 현금" value={money(profile.ownCash)} />
          <Stat label="가구 합산 현금" value={money(profile.ownCash + profile.spouseCash)} />
          <Stat label="순자산" value={money(profile.netWorth)} />
          <Stat label="기존 대출 월납" value={money(profile.existingMonthlyDebt)} />
          <Stat label="만기" value={`${profile.termYears}년`} />
          <Stat
            label="금리 가정 조정"
            value={profile.rateAdjust === 0 ? '기본' : `${percent(profile.rateAdjust, 2)}p`}
            tone={profile.rateAdjust > 0 ? 'warn' : 'neutral'}
          />
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
          <span className="text-sm text-slate-400">실행 가능 조합</span>
          <span className="text-xl font-semibold tabular-nums">
            <span className={feasible > 0 ? 'text-emerald-300' : 'text-rose-300'}>{feasible}</span>
            <span className="text-base text-slate-400"> / {cells.length}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={next.go}
          className="mt-3 w-full rounded-lg bg-sky-500/15 px-4 py-2.5 text-sm font-medium text-sky-300 transition hover:bg-sky-500/25 no-print"
        >
          다음 단계 — {next.label} →
        </button>
      </Card>
    </Rail>
  );
}
