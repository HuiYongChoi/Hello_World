import { useMemo } from 'react';
import { money, percent } from '../engine/format';
import { priceContext } from '../engine/priceContext';
import { coverageLabel, gradeLabel, GROUNDED_MIN, scoreProperty } from '../engine/scoring';
import { propertyThesis } from '../engine/thesis';
import type { Property, RegionId } from '../engine/types';
import { goFocus, linkedComplex, type FocusTarget } from '../pages/focusLink';
import { useStore } from '../state/store';
import { Badge } from './ui';

const REGION_LABEL: Record<RegionId, string> = { changwon: '창원', busan: '부산', gyeonggi: '경기' };

/** FocusBar 가 붙는 탭 — 입력 탭은 물건 화면 자체가 있어 띄우지 않습니다 */
export type FocusBarTab = 'compare' | 'tenure' | 'market';

/** 지금 탭으로 가는 버튼은 눌러도 갈 곳이 없어 끕니다 (실거래 탭의 차트·수익률은 같은 탭 안의 다른 자리라 켜 둡니다) */
const SAME_TAB: Partial<Record<FocusTarget, FocusBarTab>> = { loan: 'compare', tenure: 'tenure' };

/**
 * 따라다니는 요약 — 판정·근거 탭 머리에 초점 물건 한 줄과 건너가는 버튼.
 *
 * 화면마다 물건을 따로 고르던 것을 한 물건으로 묶습니다. 매트릭스·3-way·실거래가 전부
 * 이 줄의 물건을 축으로 열리고, 여기서 바꾸면 세 화면이 같이 바뀝니다.
 * 실거래 단지와 안 이어진 손 입력 물건은 [차트]·[수익률] 대신 "잇기" 를 냅니다 —
 * 없는 연결을 있는 척하면 엉뚱한 단지의 차트가 뜹니다.
 */
export function FocusBar({ tab }: { tab: FocusBarTab }) {
  const { properties, focusProperty: p, setFocusProperty } = useStore();
  if (!p) return null;
  const linked = linkedComplex(p) !== null;

  const buttons: { target: FocusTarget; label: string; hint: string }[] = [
    ...(linked
      ? [{ target: 'chart' as const, label: '차트', hint: '실거래 탭 — 이 단지·평형 시세와 구별 매매 차트' }]
      : []),
    { target: 'loan', label: '대출', hint: '비교 매트릭스 — 이 물건의 셀 상세(상품별 한도·필요소득)가 열립니다' },
    { target: 'why', label: '왜 이 가격', hint: '물건 화면 — 같은 구·평형대·연식 안에서 이 가격의 위치' },
    ...(linked
      ? [{ target: 'returns' as const, label: '수익률', hint: '실거래 탭 — 진입시점 분포와 이 물건 구의 백테스트' }]
      : []),
    { target: 'tenure', label: '매수 · 전세 · 월세', hint: '같은 자기자본으로 N년 뒤 손에 남는 돈' },
    { target: 'edit', label: '수정', hint: '물건 화면 — 기본정보와 점수표' },
  ];

  return (
    <div className="mb-5 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 no-print">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <FocusSummary property={p} />
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          물건 바꾸기
          <select
            value={p.id}
            onChange={(e) => setFocusProperty(e.target.value)}
            className="max-w-[14rem] rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            {properties.map((o) => (
              <option key={o.id} value={o.id} className="bg-slate-900">
                {o.name || '이름 없음'} · {money(o.price)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {buttons.map((b) => {
          const off = SAME_TAB[b.target] === tab;
          return (
            <button
              key={b.target}
              type="button"
              disabled={off}
              title={off ? '지금 보고 있는 화면입니다' : b.hint}
              onClick={() => goFocus(b.target, p.id)}
              className={`rounded-lg border px-2.5 py-1 text-sm transition ${
                off
                  ? 'cursor-default border-sky-500/30 bg-sky-500/10 text-sky-300'
                  : 'border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-700 hover:text-slate-100'
              }`}
            >
              {b.label}
            </button>
          );
        })}
        {!linked && (
          <button
            type="button"
            onClick={() => goFocus('edit', p.id)}
            title="손으로 넣은 물건이라 실거래 단지와 이어져 있지 않습니다. 이으면 차트·수익률·가격 위치가 열립니다"
            className="rounded-lg border border-dashed border-slate-600 px-2.5 py-1 text-sm text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
          >
            실거래 단지와 잇기 ▸
          </button>
        )}
      </div>
    </div>
  );
}

/** 물건 한 줄 — 값은 스토어·scoreProperty·propertyThesis·priceContext 에서만 냅니다 */
function FocusSummary({ property: p }: { property: Property }) {
  const score = useMemo(() => scoreProperty(p), [p]);
  const thesis = useMemo(() => propertyThesis(p), [p]);
  // 매매가가 비어 있으면(최근 거래 0건) ㎡당 위치를 잴 수 없습니다 — 0원의 위치를 내지 않습니다
  const ctx = useMemo(
    () => (p.price > 0 ? priceContext(p, { groundedShare: score.coverage.groundedShare }) : null),
    [p, score]
  );
  const basis = p.priceBasis;
  const edited = basis != null && basis.price !== p.price;
  const thesisTone = thesis.kind === 'ambiguous' ? 'warn' : thesis.kind === 'stable' ? 'neutral' : 'good';

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-semibold text-slate-100">▣ {p.name || '이름 없음'}</span>
      <span className="text-slate-400">
        {REGION_LABEL[p.region]}
        {p.sigungu ? ` · ${p.sigungu}` : ''}
      </span>
      <span className="tabular-nums text-slate-200">
        {p.price > 0 ? money(p.price) : <span className="text-amber-300">매매가 없음</span>}
        {basis && !edited && (
          <span className={`ml-1 text-xs ${basis.thin ? 'text-amber-300' : 'text-slate-400'}`}>
            (실거래 {basis.window} {basis.n}건{basis.thin ? ' · 표본 얇음' : ''})
          </span>
        )}
        {edited && <span className="ml-1 text-xs text-sky-300">(직접 수정 · 실거래 {money(basis.price)})</span>}
        {!basis && (
          <span className={`ml-1 text-xs ${p.price > 0 ? 'text-slate-400' : 'text-amber-300'}`}>
            {p.price > 0 ? '(직접 입력)' : '— 최근 거래가 없어 직접 넣어야 합니다'}
          </span>
        )}
      </span>
      <span className="tabular-nums text-slate-400">전용 {p.areaSqm}㎡</span>
      <span className="tabular-nums text-slate-400">{p.builtYear}년</span>
      <Badge
        tone={score.grade === 'D' ? 'bad' : 'info'}
        title={
          score.coverage.groundedShare < GROUNDED_MIN
            ? '가중치의 절반 이상이 미입력 중간값입니다 — 입지 점수는 시세 예측이 아닙니다'
            : '근거 = 직접 입력·실측·대리지표로 채운 가중치 비중. 입지 점수는 시세 예측이 아닙니다'
        }
      >
        입지 {score.total.toFixed(0)}점 · {gradeLabel(score)} · {coverageLabel(score)}
      </Badge>
      <Badge tone={thesisTone} title={`${thesis.reason}\n${thesis.advice}`}>
        {thesis.label}
      </Badge>
      {ctx && (
        <button
          type="button"
          onClick={() => goFocus('why', p.id)}
          title="같은 구·같은 평형대 거래 단지와 ㎡당 가격을 견준 위치입니다. 누르면 근거 표로 갑니다"
          className="text-xs tabular-nums text-slate-400 underline decoration-dotted underline-offset-4 hover:text-slate-200"
        >
          ㎡당 {money(ctx.perSqm)} · {ctx.district.label} {ctx.band.areaFrom}~{ctx.band.areaTo}㎡{' '}
          {ctx.percentile === null
            ? `비교 단지 ${ctx.peers.length}개 — 위치는 안 냄`
            : `중 비싼 쪽 ${percent(1 - ctx.percentile, 0)}`}
          {ctx.gaps.length > 0 && <span className="ml-1.5 text-amber-300">어긋남 {ctx.gaps.length}</span>}
        </button>
      )}
    </div>
  );
}
