import { useMemo, useState } from 'react';
import { Button, Field, SegmentedControl, Select } from '../components/ui';
import { money, percent } from '../engine/format';
import {
  PRESALE,
  annualizedPremium,
  type PremiumRow,
  premiumInsights,
  premiumPeriod,
  premiumReport,
  type PremiumInsightResult,
  type PremiumMode,
} from '../engine/presale';
import { TraitCard, TraitLegend } from '../components/TraitCard';
import { SortHeader, SortNote, useSortedRows, type SortColumn } from '../components/SortableTable';
import type { TraitBucket, TraitGroup } from '../engine/ranking';

/**
 * 청약·분양권 프리미엄 공통점 — 사이드 토글.
 *
 * "청약에 떨어지면 분양권을 사야 하는데, 어떤 물건에 플러스 피가 붙었나"에
 * 답합니다. 수익률 공통점 드로어와 같은 자리·같은 조작감을 씁니다 — 두 화면이
 * 같은 질문(오른 것들의 공통점)을 하므로 계산도 `computeTraits` 를 공유합니다.
 */

/**
 * 프리미엄 상위 물건 표의 열.
 *
 * `value` 가 있는 열만 정렬됩니다 — 분양권→매매는 두 값이 겹쳐 있어 어느 쪽으로
 * 정렬할지가 모호하므로 분양권 매입가를 기준으로 둡니다.
 */
const PREMIUM_COLUMNS: SortColumn<PremiumRow>[] = [
  { key: 'name', label: '단지 · 법정동', hint: '단지명 가나다순', value: (r) => r.name },
  { key: 'area', label: '전용', align: 'right', hint: '전용면적', value: (r) => r.area },
  {
    key: 'presalePrice',
    label: '분양권 → 매매',
    align: 'right',
    hint: '분양권 매입가 기준으로 정렬합니다. 싸게 산 것이 더 올랐는지 보세요',
    value: (r) => r.presalePrice,
  },
  {
    key: 'total',
    label: '총',
    align: 'right',
    hint: '분양권 대비 매매가의 누적 변화율입니다. 오래 들고 있을수록 커지므로 연환산과 같이 보세요',
    value: (r) => r.premiumRatio,
  },
  {
    key: 'annualized',
    label: '연환산',
    align: 'right',
    hint: '시차로 나눠 같은 자로 잰 값입니다. 보유 기간이 다른 건들을 비교하려면 이쪽입니다',
    value: (r) => annualizedPremium(r),
  },
];

/** 프리미엄 상위 물건 표 — 구간 상세에서도 같은 표를 재사용합니다. */
function PremiumTable({
  rows,
  limit,
  markTop,
}: {
  rows: PremiumRow[];
  limit?: number;
  /** 상위권에 든 행의 키 — 구간 상세에서 든 것과 못 든 것을 가릅니다 */
  markTop?: Set<string>;
}) {
  const { sorted, sortKey, sortDesc, toggle } = useSortedRows(
    rows,
    PREMIUM_COLUMNS,
    'annualized'
  );
  const shown = limit ? sorted.slice(0, limit) : sorted;
  const label = PREMIUM_COLUMNS.find((c) => c.key === sortKey)?.label ?? '';

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[500px] text-left">
          <SortHeader
            columns={PREMIUM_COLUMNS}
            sortKey={sortKey}
            sortDesc={sortDesc}
            onToggle={toggle}
          />
          <tbody>
            {shown.map((r) => {
              const isTop = markTop?.has(r.key);
              return (
                <tr
                  key={r.key}
                  className={`border-b border-slate-800/50 ${
                    markTop && !isTop ? 'opacity-45' : ''
                  }`}
                >
                  <td className="py-1.5">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[11px] font-medium text-slate-200">{r.name}</span>
                      {markTop && (
                        <span
                          className={`shrink-0 text-[9px] ${
                            isTop ? 'text-slate-300' : 'text-slate-600'
                          }`}
                        >
                          {isTop ? '상위권' : '밖'}
                        </span>
                      )}
                    </div>
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
              );
            })}
          </tbody>
        </table>
      </div>
      <SortNote label={label} desc={sortDesc} />
      {limit && sorted.length > limit && (
        <p className="text-[10px] text-slate-600">
          {sorted.length}건 중 {limit}건만 보여줍니다 — 정렬을 바꾸면 다른 {limit}건이 나옵니다.
        </p>
      )}
    </div>
  );
}

/**
 * 구간 상세 — "중형에 프리미엄이 붙었다" 다음에 오는 질문에 답합니다.
 *
 * 상위권에 든 것만 보여주면 반쪽입니다. **같은 구간인데 못 든 것**을 같이
 * 놓아야 "왜 이건 되고 저건 안 됐나" 를 볼 수 있습니다. 못 든 것은 흐리게
 * 깔고 정렬은 표에 그대로 둡니다.
 */
function BucketDetail({
  group,
  bucket,
  result,
  onClose,
}: {
  group: TraitGroup;
  bucket: TraitBucket;
  result: PremiumInsightResult;
  onClose: () => void;
}) {
  const rows = bucket.allIndices.map((i) => result.allEntries[i]).filter(Boolean);
  const topKeys = new Set(bucket.topIndices.map((i) => result.entries[i]?.key).filter(Boolean));
  const baseRate = result.topCount / Math.max(1, result.universe);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/70 p-0 sm:items-center sm:p-6 no-print">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-t-2xl border border-slate-800 bg-slate-950 sm:rounded-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <div className="text-[10px] text-slate-500">{group.label}</div>
            <h3 className="text-sm font-semibold text-slate-100">{bucket.key}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              이 구간 <b className="text-slate-200">{bucket.allCount}건</b> 중{' '}
              <b className="text-slate-200">{bucket.topCount}건</b>이 상위권 ={' '}
              <b className="text-slate-100 tabular-nums">{percent(bucket.hitRate, 0)}</b>
              <span className="text-slate-500">
                {' '}
                · 아무거나 골랐을 때 {percent(baseRate, 0)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-xs text-slate-500 transition hover:text-slate-200"
          >
            닫기
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4">
          <p className="mb-2 text-[10px] leading-relaxed text-slate-500">
            상위권에 든 것과 <span className="text-slate-400">같은 구간인데 못 든 것</span>을
            같이 놓았습니다 — 못 든 쪽은 흐리게 깔았습니다. 열 머리를 눌러 정렬하면 둘이 어디서
            갈리는지 보입니다.
          </p>
          <PremiumTable rows={rows} markTop={topKeys} />
        </div>
      </div>
    </div>
  );
}

const SCOPES = [
  { id: 'all', label: '전체', codes: [] as string[] },
  { id: 'changwon', label: '창원', codes: ['48121', '48123', '48125', '48127', '48129'] },
  { id: 'busan', label: '부산', codes: ['26350', '26500', '26260', '26290', '26470'] },
  { id: 'gyeonggi', label: '경기', codes: ['41220', '41597', '41595', '41591', '41593'] },
];

export function PremiumDrawer() {
  const [open, setOpen] = useState(false);
  const [scopeId, setScopeId] = useState('all');
  const [mode, setMode] = useState<PremiumMode>('annualized');
  const [copied, setCopied] = useState(false);
  /** 열어 둔 구간 상세 — 어느 공통점의 어느 칸인지 */
  const [detail, setDetail] = useState<{ group: TraitGroup; bucket: TraitBucket } | null>(null);

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
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col border-l border-slate-800 bg-slate-950 no-print">
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
              <div className="mb-2">
                <TraitLegend topCount={result.topCount} universe={result.universe} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {result.traits.map((g) => (
                  <TraitCard
                    key={g.id}
                    group={g}
                    topCount={result.topCount}
                    universe={result.universe}
                    maxBuckets={4}
                    onOpenBucket={(group, bucket) => setDetail({ group, bucket })}
                  />
                ))}
              </div>

              <h3 className="mt-5 mb-2 text-xs font-semibold text-slate-300">
                프리미엄 상위 물건
              </h3>
              <PremiumTable rows={result.entries} limit={25} />

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

      {detail && result && (
        <BucketDetail
          group={detail.group}
          bucket={detail.bucket}
          result={result}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}
