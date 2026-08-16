import { useMemo, useState } from 'react';
import { Button, Field, SegmentedControl, Select } from '../components/ui';
import { money, percent } from '../engine/format';
import { MARKET, quarterLabel } from '../engine/market';
import {
  rankPerformers,
  rankingReport,
  type RankingMode,
  type TraitGroup,
} from '../engine/ranking';
import { DISTRICTS } from '../engine/regions';

/**
 * 수익률 상위권 공통점 — 사이드 토글.
 *
 * 매트릭스·3-way 를 보다가 "그래서 뭐가 오른 건데"가 궁금해질 때 옆에서 열어
 * 확인하고 닫는 용도입니다. 별도 탭으로 만들면 화면을 떠나야 하고, 본문에 박으면
 * 매번 눈에 걸립니다.
 */

const SCOPES = [
  { id: 'changwon-core', label: '창원 (의창·성산)', codes: ['48121', '48123'] },
  { id: 'masan', label: '마산·진해', codes: ['48125', '48127', '48129'] },
  { id: 'changwon-all', label: '창원 전체', codes: ['48121', '48123', '48125', '48127', '48129'] },
  { id: 'busan', label: '부산 (해수동남연)', codes: ['26350', '26500', '26260', '26290', '26470'] },
  {
    id: 'all',
    label: '창원 + 부산 전체',
    codes: ['48121', '48123', '48125', '48127', '48129', '26350', '26500', '26260', '26290', '26470'],
  },
];

function TraitCard({ group, topCount }: { group: TraitGroup; topCount: number }) {
  // 표본이 한 자리면 배수가 커도 우연입니다. 3건 미만은 아예 내지 않습니다.
  const shown = group.buckets.filter((b) => b.topCount >= 3).slice(0, 5);
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
                <span className={b.lift >= 1.3 ? 'text-emerald-300' : 'text-slate-400'}>
                  {b.lift.toFixed(2)}배
                </span>
              </span>
            </div>
            <div className="mt-0.5 flex h-1.5 gap-0.5">
              <div className="flex-1 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-sky-500"
                  style={{ width: `${Math.min(100, b.topShare * 100)}%` }}
                />
              </div>
              <div className="flex-1 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-slate-600"
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

export function RankingDrawer() {
  const [open, setOpen] = useState(false);
  const [scopeId, setScopeId] = useState(SCOPES[0].id);
  const [years, setYears] = useState(5);
  const [mode, setMode] = useState<RankingMode>('excess');
  const [copied, setCopied] = useState(false);

  const scope = SCOPES.find((s) => s.id === scopeId) ?? SCOPES[0];

  const result = useMemo(
    () => rankPerformers({ districtCodes: scope.codes, years, topPercent: 20, mode }),
    [scope, years, mode]
  );

  const download = () => {
    const md = rankingReport(result, scope.label);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `수익률-공통점-${scope.id}-${years}년-${MARKET.asOf}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(rankingReport(result, scope.label));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-1/2 right-0 z-40 -translate-y-1/2 rounded-l-xl border border-r-0 border-slate-700 bg-slate-900 px-2 py-4 text-[11px] font-medium text-slate-300 transition hover:bg-slate-800 no-print"
        style={{ writingMode: 'vertical-rl' }}
      >
        수익률 공통점
      </button>
    );
  }

  const districtsInScope = DISTRICTS.filter((d) => scope.codes.includes(d.code));

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
            <h2 className="text-base font-semibold text-slate-100">수익률 상위권 공통점</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              오른 것들끼리 무엇이 같았는지 봅니다. 실거래 {MARKET.stats.deals.toLocaleString('ko-KR')}건
              기준.
            </p>
          </div>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            닫기
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="대상" hint={`${districtsInScope.length}개 시군구`}>
              <Select
                value={scopeId}
                onChange={setScopeId}
                options={SCOPES.map((s) => ({ value: s.id, label: s.label }))}
              />
            </Field>
            <Field label="기간" hint="이 기간의 복리 수익률로 줄 세웁니다">
              <Select
                value={String(years)}
                onChange={(v) => setYears(Number(v))}
                options={[3, 5, 7, 10].map((y) => ({ value: String(y), label: `최근 ${y}년` }))}
              />
            </Field>
          </div>

          <div className="mt-3">
            <SegmentedControl<RankingMode>
              value={mode}
              onChange={setMode}
              options={[
                { value: 'excess', label: '지역 초과수익' },
                { value: 'absolute', label: '절대 수익률' },
              ]}
            />
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              {mode === 'excess'
                ? '같은 시군구 중위 대비로 봅니다. 동네가 통째로 오른 효과를 빼야 "이 단지가 왜 더 올랐나"가 남습니다.'
                : '있는 그대로의 수익률입니다. 많이 오른 시군구가 상위를 채우므로, 시군구 공통점은 동어반복이 됩니다.'}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
            <span className="text-[11px] text-slate-500">
              {quarterLabel(result.entries[0]?.fromQ ?? 0)} → {quarterLabel(result.entries[0]?.toQ ?? 0)}
            </span>
            <span className="text-[11px] text-slate-600">·</span>
            <span className="text-[11px] text-slate-400">
              단지·평형 {result.universe.toLocaleString('ko-KR')}건 중 상위{' '}
              <span className="text-sky-300">{result.topCount}건</span>
            </span>
          </div>

          {result.universe === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-slate-700 px-4 py-6 text-center text-xs text-slate-500">
              이 조건에 맞는 표본이 없습니다. 기간을 줄여 보세요.
            </p>
          ) : (
            <>
              <h3 className="mt-5 mb-2 text-xs font-semibold text-slate-300">공통점</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {result.traits.map((g) => (
                  <TraitCard key={g.id} group={g} topCount={result.topCount} />
                ))}
              </div>

              <h3 className="mt-5 mb-2 text-xs font-semibold text-slate-300">상위 단지</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] text-slate-500">
                      <th className="pb-1.5">단지 · 법정동</th>
                      <th className="pb-1.5">준공/전용</th>
                      <th className="pb-1.5 text-right">진입 → 현재</th>
                      <th className="pb-1.5 text-right">연복리</th>
                      <th className="pb-1.5 text-right">초과</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.entries.slice(0, 25).map((e) => (
                      <tr key={e.id} className="border-b border-slate-800/50">
                        <td className="py-1.5">
                          <div className="text-[11px] font-medium text-slate-200">{e.name}</div>
                          <div className="text-[10px] text-slate-500">
                            {e.umd} · {e.districtLabel}
                          </div>
                        </td>
                        <td className="py-1.5 text-[10px] tabular-nums text-slate-400">
                          {e.buildYear || '—'}
                          <br />
                          {e.area}㎡
                        </td>
                        <td className="py-1.5 text-right text-[10px] tabular-nums text-slate-400">
                          {money(e.startPrice)}
                          <br />
                          {money(e.endPrice)}
                        </td>
                        <td className="py-1.5 text-right text-[11px] font-semibold tabular-nums text-emerald-300">
                          {percent(e.cagr, 1)}
                        </td>
                        <td className="py-1.5 text-right text-[11px] tabular-nums text-sky-300">
                          {percent(e.excess, 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="mt-5 mb-2 text-xs font-semibold text-slate-300">시군구 중위 수익률</h3>
              <div className="space-y-1">
                {result.districtMedians.map((d) => (
                  <div key={d.code} className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-slate-400">{d.label}</span>
                    <span className="text-[11px] tabular-nums text-slate-300">
                      {percent(d.median, 2)}{' '}
                      <span className="text-slate-600">({d.n}건)</span>
                    </span>
                  </div>
                ))}
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
            {MARKET.source.name} · {MARKET.asOf}
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={copy}>
              {copied ? '복사됨' : '리포트 복사'}
            </Button>
            <Button size="sm" variant="primary" onClick={download}>
              리포트 내려받기
            </Button>
          </div>
        </footer>
      </aside>
    </>
  );
}
