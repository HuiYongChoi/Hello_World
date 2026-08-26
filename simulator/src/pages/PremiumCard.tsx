import { useMemo, useState } from 'react';
import { Badge, Card, Field, Select, Stat } from '../components/ui';
import { money, percent } from '../engine/format';
import { PRESALE, premiumPeriod, premiumRows, summarizePremium } from '../engine/presale';

/**
 * 분양권 프리미엄 — 청약 축(로드맵 4번)의 첫 조각.
 *
 * 청약에 붙으면 분양가로 들어가지만, 떨어지면 분양권을 사서 들어가야 합니다.
 * 그때 얼마를 더 주는지가 여기 있습니다. 같은 단지·평형끼리만 짝지어 계산해
 * 시장 평균끼리 나누는 함정을 피했습니다.
 */

const SCOPES = [
  { id: 'all', label: '전체', codes: [] as string[] },
  { id: 'changwon', label: '창원', codes: ['48121', '48123', '48125', '48127', '48129'] },
  { id: 'busan', label: '부산', codes: ['26350', '26500', '26260', '26290', '26470'] },
  { id: 'gyeonggi', label: '경기', codes: ['41220', '41597', '41595', '41591', '41593'] },
];

export function PremiumCard() {
  const [scopeId, setScopeId] = useState('all');
  const scope = SCOPES.find((s) => s.id === scopeId) ?? SCOPES[0];

  const rows = useMemo(
    () => premiumRows(scope.codes.length ? scope.codes : undefined),
    [scope]
  );
  const summary = useMemo(() => summarizePremium(rows), [rows]);

  if (!summary) return null;

  return (
    <Card
      title="분양권 프리미엄 — 청약에 떨어지면 얼마를 더 주나"
      subtitle="분양권 마지막 거래가와 그 이후 같은 단지·평형의 매매가를 짝지었습니다. 시장 평균끼리 나누면 분양권이 활발한 신축과 매매가 활발한 구축이 뒤섞여 실제로 없는 비율이 나옵니다."
      action={<Badge tone="good">실측</Badge>}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="지역" hint={`짝지어진 단지·평형 ${summary.count}건`}>
          <Select
            value={scopeId}
            onChange={setScopeId}
            options={SCOPES.map((s) => ({ value: s.id, label: s.label }))}
          />
        </Field>
        <Stat
          label="프리미엄 중위"
          value={percent(summary.median, 1)}
          hint={`사분위 ${percent(summary.p25, 1)}~${percent(summary.p75, 1)}`}
        />
        <Stat
          label="준공 후가 더 쌌던 비율"
          value={percent(summary.lossRatio, 0)}
          tone={summary.lossRatio > 0.2 ? 'warn' : undefined}
          hint="분양권을 비싸게 산 경우"
        />
        <Stat
          label="비교 시차 중위"
          value={`${summary.medianQuarterGap}분기`}
          hint="길수록 시장 전체 변동이 섞입니다"
        />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] text-slate-500">
              <th className="pb-1.5">단지 · 법정동</th>
              <th className="pb-1.5 text-right">전용</th>
              <th className="pb-1.5 text-right">분양권 → 매매</th>
              <th className="pb-1.5 text-right">차이</th>
              <th className="pb-1.5 text-right">기간</th>
            </tr>
          </thead>
          <tbody>
            {[...rows.slice(0, 8), ...rows.slice(-3)].map((r) => (
              <tr key={r.key} className="border-b border-slate-800/50">
                <td className="py-1.5">
                  <div className="text-[11px] font-medium text-slate-200">{r.name}</div>
                  <div className="text-[10px] text-slate-500">
                    {r.umd} · {r.districtLabel}
                  </div>
                </td>
                <td className="py-1.5 text-right text-[10px] tabular-nums text-slate-500">
                  {r.area}㎡
                </td>
                <td className="py-1.5 text-right text-[10px] tabular-nums text-slate-400">
                  {money(r.presalePrice)} → {money(r.salePrice)}
                </td>
                <td
                  className={`py-1.5 text-right text-[11px] font-semibold tabular-nums ${
                    r.premiumRatio >= 0 ? 'text-slate-100' : 'text-rose-300'
                  }`}
                >
                  {percent(r.premiumRatio, 1)}
                </td>
                <td className="py-1.5 text-right text-[10px] tabular-nums text-slate-600">
                  {premiumPeriod(r)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 space-y-1.5">
        <p className="text-[11px] leading-relaxed text-slate-400">
          중위 {percent(summary.median, 1)}는 “분양권이 그만큼 싸다”가 아닙니다. 분양권 거래와
          매매 사이에 <span className="text-slate-300">중위 {summary.medianQuarterGap}분기</span>가
          벌어져 있어, 그 기간 시장 전체가 오른 몫이 섞여 있습니다.
        </p>
        <p className="text-[10px] leading-relaxed text-slate-600">
          {summary.lossRatio > 0
            ? `그래도 ${percent(summary.lossRatio, 0)}는 준공 후가 더 쌌습니다 — 분양권 프리미엄을 주고 들어갔다가 손해 본 구간이 실제로 있습니다.`
            : '이 표본에서는 준공 후가 더 싼 경우가 없었습니다.'}{' '}
          소형 평형(20㎡ 안팎)에 마이너스가 몰려 있어, 평형대를 함께 보셔야 합니다.
        </p>
        <p className="text-[10px] leading-relaxed text-slate-600">
          출처 {PRESALE.source.name} · 기준일 {PRESALE.asOf} · 거래{' '}
          {PRESALE.stats.deals.toLocaleString('ko-KR')}건
        </p>
      </div>
    </Card>
  );
}
