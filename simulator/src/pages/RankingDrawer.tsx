import { useMemo, useState } from 'react';
import { Button, Field, SegmentedControl, Select } from '../components/ui';
import { money, percent } from '../engine/format';
import { MARKET, quarterLabel } from '../engine/market';
import {
  rankPerformers,
  rankingInsightReport,
  rankingInsights,
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

type SortKey = 'name' | 'buildYear' | 'startPrice' | 'cagr' | 'excess';

/**
 * 표 머리글. `hint` 는 마우스를 올렸을 때 뜨는 설명입니다.
 * 특히 "초과"는 이름만 봐서는 무엇 대비 초과인지 알 수 없어 반드시 필요합니다.
 */
const COLUMNS: {
  key: SortKey;
  label: string;
  align?: 'right';
  hint: string;
}[] = [
  { key: 'name', label: '단지 · 법정동', hint: '이름순으로 정렬합니다' },
  {
    key: 'buildYear',
    label: '준공/전용',
    hint: '준공연도 기준으로 정렬합니다. 재건축 기대가 붙는 연식대인지 보세요',
  },
  {
    key: 'startPrice',
    label: '진입 → 현재',
    align: 'right',
    hint: '진입 시점의 분기 중위가 기준으로 정렬합니다',
  },
  {
    key: 'cagr',
    label: '연복리',
    align: 'right',
    hint: '진입 시점부터 지금까지의 복리 연환산 수익률입니다. 시장 전체가 오른 효과가 포함돼 있습니다',
  },
  {
    key: 'excess',
    label: '초과',
    align: 'right',
    hint:
      '초과수익률 = 이 단지의 연복리 − 같은 시군구 단지들의 중위 연복리.\n' +
      '동네가 통째로 오른 효과를 빼고 남은 부분이라, "이 단지가 왜 더 올랐나"에 답합니다.\n' +
      '양수면 같은 동네 평균보다 더 올랐다는 뜻이고, 음수면 덜 올랐다는 뜻입니다.',
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
  const [sortKey, setSortKey] = useState<SortKey>('excess');
  const [sortDesc, setSortDesc] = useState(true);

  const scope = SCOPES.find((s) => s.id === scopeId) ?? SCOPES[0];

  const result = useMemo(
    () => rankPerformers({ districtCodes: scope.codes, years, topPercent: 20, mode }),
    [scope, years, mode]
  );

  /**
   * 정렬은 **보여주는 순서만** 바꿉니다. 어떤 단지가 상위권에 드는지는 위의
   * 모드(절대/초과)가 정하고, 여기서 열을 눌러도 그 선정은 달라지지 않습니다.
   */
  const sorted = useMemo(() => {
    const by = (e: (typeof result.entries)[number]) => {
      switch (sortKey) {
        case 'name':
          return e.name;
        case 'buildYear':
          return e.buildYear;
        case 'startPrice':
          return e.startPrice;
        case 'excess':
          return e.excess;
        default:
          return e.cagr;
      }
    };
    return [...result.entries].sort((a, b) => {
      const x = by(a);
      const y = by(b);
      const cmp = typeof x === 'string' ? x.localeCompare(y as string, 'ko') : (x as number) - (y as number);
      return sortDesc ? -cmp : cmp;
    });
  }, [result.entries, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      // 이름은 가나다순, 숫자는 큰 값부터가 자연스럽습니다.
      setSortDesc(key !== 'name');
    }
  };

  const save = (md: string, suffix: string) => {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${suffix}-${scope.id}-${years}년-${MARKET.asOf}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async (md: string) => {
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const insights = useMemo(() => rankingInsights(result), [result]);

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
              <h3 className="mt-5 mb-2 text-xs font-semibold text-slate-300">인사이트</h3>
              {insights.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-700 px-3 py-3 text-[11px] leading-relaxed text-slate-500">
                  임계 배수를 넘는 공통점이 없습니다. <span className="text-slate-400">공통점이
                  없다는 것도 결과입니다</span> — 이 구간에서는 속성으로 고르는 대신 개별 물건을
                  봐야 합니다.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {insights.slice(0, 6).map((i) => (
                    <li
                      key={i.headline}
                      className={`rounded-lg border px-3 py-2 ${
                        i.strength === 'strong'
                          ? 'border-emerald-500/25 bg-emerald-500/5'
                          : 'border-slate-800 bg-slate-950/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[11px] leading-relaxed text-slate-200">
                          {i.headline}
                        </span>
                        {i.strength === 'weak' && (
                          <span className="shrink-0 text-[9px] text-amber-400/80">표본 얇음</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">
                        {i.evidence}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="mt-5 mb-2 text-xs font-semibold text-slate-300">공통점</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {result.traits.map((g) => (
                  <TraitCard key={g.id} group={g} topCount={result.topCount} />
                ))}
              </div>

              <div className="mt-5 mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-300">상위 단지</h3>
                <span className="text-[10px] text-slate-600">
                  머리글을 누르면 정렬 · 상위 선정 기준은 그대로입니다
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] text-slate-500">
                      {COLUMNS.map((c) => (
                        <th
                          key={c.key}
                          className={`pb-1.5 ${c.align === 'right' ? 'text-right' : ''}`}
                        >
                          <button
                            type="button"
                            title={c.hint}
                            onClick={() => toggleSort(c.key)}
                            className={`inline-flex items-center gap-0.5 transition hover:text-slate-200 ${
                              sortKey === c.key ? 'text-sky-300' : ''
                            }`}
                          >
                            {c.label}
                            <span className="text-[9px]">
                              {sortKey === c.key ? (sortDesc ? '▼' : '▲') : '⇅'}
                            </span>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.slice(0, 25).map((e) => (
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
                        <td
                          className="py-1.5 text-right text-[11px] tabular-nums text-sky-300"
                          title={`같은 시군구 중위 ${percent(
                            e.cagr - e.excess,
                            2
                          )} 대비 ${percent(e.excess, 2)}p`}
                        >
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

        <footer className="border-t border-slate-800 px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] text-slate-600">
              {MARKET.source.name} · {MARKET.asOf}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => copy(rankingInsightReport(result, scope.label))}>
                {copied ? '복사됨' : '인사이트 복사'}
              </Button>
              <Button
                size="sm"
                onClick={() => save(rankingInsightReport(result, scope.label), '인사이트')}
              >
                인사이트 리포트
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => save(rankingReport(result, scope.label), '수익률-공통점')}
              >
                전체 데이터 리포트
              </Button>
            </div>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">
            인사이트 리포트는 해석과 한계를 문장으로, 전체 데이터 리포트는 공통점 표·상위 40개
            단지·시군구 중위 수익률을 표로 담습니다.
          </p>
        </footer>
      </aside>
    </>
  );
}
