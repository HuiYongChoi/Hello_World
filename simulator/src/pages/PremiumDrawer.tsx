import { useMemo, useState } from 'react';
import { Button, Field, SegmentedControl, Select } from '../components/ui';
import { money, percent } from '../engine/format';
import {
  PRESALE,
  annualizedPremium,
  premiumInsights,
  premiumPeriod,
  premiumReport,
  type PremiumMode,
} from '../engine/presale';
import { TRAIT_MIN_BUCKET, type TraitGroup } from '../engine/ranking';

/**
 * 청약·분양권 프리미엄 공통점 — 사이드 토글.
 *
 * "청약에 떨어지면 분양권을 사야 하는데, 어떤 물건에 플러스 피가 붙었나"에
 * 답합니다. 수익률 공통점 드로어와 같은 자리·같은 조작감을 씁니다 — 두 화면이
 * 같은 질문(오른 것들의 공통점)을 하므로 계산도 `computeTraits` 를 공유합니다.
 */

const SCOPES = [
  { id: 'all', label: '전체', codes: [] as string[] },
  { id: 'changwon', label: '창원', codes: ['48121', '48123', '48125', '48127', '48129'] },
  { id: 'busan', label: '부산', codes: ['26350', '26500', '26260', '26290', '26470'] },
  { id: 'gyeonggi', label: '경기', codes: ['41220', '41597', '41595', '41591', '41593'] },
];

function TraitCard({ group, topCount }: { group: TraitGroup; topCount: number }) {
  const shown = group.buckets.filter((b) => b.topCount >= TRAIT_MIN_BUCKET).slice(0, 4);
  if (shown.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold text-slate-200">{group.label}</h4>
        <span className="text-[10px] text-slate-600">상위 {topCount}건 기준</span>
      </div>
      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-600">{group.hint}</p>
      <div className="mt-2 space-y-1.5">
        {shown.map((b) => (
          <div key={b.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-slate-300">{b.key}</span>
              <span className="text-[11px] tabular-nums text-slate-400">
                {b.topCount}건 ·{' '}
                <span className={b.lift >= 1.3 ? 'font-semibold text-slate-100' : 'text-slate-500'}>
                  {b.lift.toFixed(2)}배
                </span>
              </span>
            </div>
            <div className="mt-0.5 flex h-1.5 gap-0.5">
              <div className="flex-1 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-slate-300"
                  style={{ width: `${Math.min(100, b.topShare * 100)}%` }}
                />
              </div>
              <div className="flex-1 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-slate-700"
                  style={{ width: `${Math.min(100, b.allShare * 100)}%` }}
                />
              </div>
            </div>
            <div className="mt-0.5 flex justify-between text-[9px] text-slate-600">
              <span>상위 {percent(b.topShare, 0)}</span>
              <span>전체 {percent(b.allShare, 0)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PremiumDrawer() {
  const [open, setOpen] = useState(false);
  const [scopeId, setScopeId] = useState('all');
  const [mode, setMode] = useState<PremiumMode>('annualized');
  const [copied, setCopied] = useState(false);

  const scope = SCOPES.find((s) => s.id === scopeId) ?? SCOPES[0];
  const result = useMemo(
    () => premiumInsights(scope.codes.length ? scope.codes : undefined, mode),
    [scope, mode]
  );

  const save = () => {
    if (!result) return;
    const blob = new Blob([premiumReport(result, scope.label)], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `청약-프리미엄-공통점-${scope.id}-${PRESALE.asOf}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(premiumReport(result, scope.label));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-1/2 right-0 z-40 translate-y-[calc(50%+6px)] rounded-l-xl border border-r-0 border-slate-700 bg-slate-900 px-2 py-4 text-[11px] font-medium text-slate-300 transition hover:bg-slate-800 no-print"
        style={{ writingMode: 'vertical-rl' }}
      >
        청약 공통점
      </button>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 no-print"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-slate-800 bg-slate-950 no-print">
        <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">청약 공통점 — 플러스 피</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              청약에 떨어지면 분양권을 사서 들어갑니다. 그때 프리미엄이 많이 붙은 물건끼리
              무엇이 같았는지 봅니다. 분양권 거래{' '}
              {PRESALE.stats.deals.toLocaleString('ko-KR')}건 기준.
            </p>
          </div>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            닫기
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!result ? (
            <p className="rounded-lg border border-dashed border-slate-700 px-4 py-6 text-center text-xs text-slate-500">
              짝지어진 표본이 없습니다.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="지역" hint={`짝지어진 ${result.universe}건`}>
                  <Select
                    value={scopeId}
                    onChange={setScopeId}
                    options={SCOPES.map((s) => ({ value: s.id, label: s.label }))}
                  />
                </Field>
                <div className="flex items-end">
                  <SegmentedControl<PremiumMode>
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'annualized', label: '연환산' },
                      { value: 'total', label: '총 프리미엄' },
                    ]}
                  />
                </div>
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                {mode === 'annualized'
                  ? '시차로 나눠 같은 자로 잽니다. 총 프리미엄으로 뽑으면 "오래 들고 있었다"가 1등 공통점이 되어 발견이 없습니다.'
                  : '있는 그대로의 프리미엄입니다. 오래 보유할수록 커지므로 "보유 기간" 공통점은 동어반복이 됩니다.'}
              </p>

              <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
                <div>
                  <div className="text-[10px] text-slate-600">프리미엄 중위</div>
                  <div className="text-sm font-semibold tabular-nums text-slate-100">
                    {percent(result.summary.median, 1)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-600">준공 후가 더 쌌던 비율</div>
                  <div
                    className={`text-sm font-semibold tabular-nums ${
                      result.summary.lossRatio > 0.2 ? 'text-amber-300' : 'text-slate-100'
                    }`}
                  >
                    {percent(result.summary.lossRatio, 0)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-600">시차 중위</div>
                  <div className="text-sm font-semibold tabular-nums text-slate-100">
                    {result.summary.medianQuarterGap}분기
                  </div>
                </div>
              </div>

              <h3 className="mt-5 mb-2 text-xs font-semibold text-slate-300">공통점</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {result.traits.map((g) => (
                  <TraitCard key={g.id} group={g} topCount={result.topCount} />
                ))}
              </div>

              <h3 className="mt-5 mb-2 text-xs font-semibold text-slate-300">
                프리미엄 상위 물건
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px] text-left">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] text-slate-500">
                      <th className="pb-1.5">단지 · 법정동</th>
                      <th className="pb-1.5 text-right">전용</th>
                      <th className="pb-1.5 text-right">분양권 → 매매</th>
                      <th className="pb-1.5 text-right">총</th>
                      <th className="pb-1.5 text-right">연환산</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.entries.slice(0, 25).map((r) => (
                      <tr key={r.key} className="border-b border-slate-800/50">
                        <td className="py-1.5">
                          <div className="text-[11px] font-medium text-slate-200">{r.name}</div>
                          <div className="text-[10px] text-slate-500">
                            {r.umd} · {r.districtLabel} · {premiumPeriod(r)}
                          </div>
                        </td>
                        <td className="py-1.5 text-right text-[10px] tabular-nums text-slate-500">
                          {r.area}㎡
                        </td>
                        <td className="py-1.5 text-right text-[10px] tabular-nums text-slate-400">
                          {money(r.presalePrice)}
                          <br />
                          {money(r.salePrice)}
                        </td>
                        <td className="py-1.5 text-right text-[11px] tabular-nums text-slate-400">
                          {percent(r.premiumRatio, 0)}
                        </td>
                        <td className="py-1.5 text-right text-[11px] font-semibold tabular-nums text-slate-100">
                          {percent(annualizedPremium(r), 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
                <div className="text-[11px] font-medium text-amber-200">읽을 때 주의</div>
                <ul className="mt-1 space-y-1">
                  {result.caveats.map((c) => (
                    <li key={c} className="text-[10px] leading-relaxed text-slate-400">
                      · {c}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-slate-800 px-5 py-3">
          <span className="text-[10px] text-slate-600">
            {PRESALE.source.name} · {PRESALE.asOf}
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={copy}>
              {copied ? '복사됨' : '리포트 복사'}
            </Button>
            <Button size="sm" variant="primary" onClick={save}>
              리포트 내려받기
            </Button>
          </div>
        </footer>
      </aside>
    </>
  );
}
