import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Card,
  Field,
  Foldable,
  MoneyInput,
  NumberInput,
  SegmentedControl,
  Select,
  Stat,
  Toggle,
} from '../components/ui';
import { money, percent } from '../engine/format';
import { COMMUTE_LABEL, RENT_CAVEATS, RENT_REGIONS, RENT_SNAPSHOT, regionOf } from './data';
import { SAFETY_CAVEATS } from './safety';
import {
  RENT_LOAN_CAVEATS,
  RENT_LOAN_RULES,
  adviseRentLoans,
  compareRentLoans,
  type Borrower,
  type RentTarget,
} from './loans';
import {
  BOARD_MIN_AREA,
  depositReach,
  discover,
  type BoardMode,
  type BoardTier,
  type JeonseBoardRow,
  type WolseBoardRow,
} from './boardRow';
import { BOARD_SNAPSHOT, DEFAULT_PROFILE } from './board/boardDoc';
import { toSupplyPyeong } from './finder';

/**
 * 전월세 찾기 — **내 조건으로 들어갈 수 있는 집을, 후보판 바깥에서.**
 *
 * 후보판이 생기면서 이 화면의 거르기·정렬·후보 카드는 겹치는 기능이 됐습니다.
 * 이 화면에만 있는 쓸모는 둘입니다.
 *
 * ```
 * ① 내 조건   나이·소득·혼인·재직 → 되는 대출 → "얼마짜리 보증금까지 들어가나"
 *             이 조건이 후보판의 대출 · 자기 돈 칸도 다시 잽니다
 * ② 발굴      창원 5개 구 + 함안 전체에서, 후보판에 아직 없는 집만 — 담으면 후보판으로
 * ```
 *
 * 비교·소거·메모는 후보판이 합니다. 여기는 **판에 올릴 집을 고르는 곳**입니다.
 */

/** 후보판과 같이 쓰는 저장 자리 — BoardFrame 이 읽습니다 */
export const PROFILE_KEY = 'masan-rent-finder-v1';
export const ADDED_KEY = 'masan-board-added';

export interface FinderProfile {
  borrower: Borrower;
  /** 보증금에 넣을 수 있는 내 돈 */
  cash: number;
  /** 월 주거비 한도 — 월세 + 대출 이자 */
  monthlyMax: number;
  target: RentTarget;
}

export interface AddedRows {
  jeonse: string[];
  wolse: string[];
}

const DEFAULT: FinderProfile = {
  borrower: DEFAULT_PROFILE,
  cash: 70000000,
  monthlyMax: 900000,
  target: { deposit: 200000000, rent: 0, areaSqm: 59 },
};

export function loadProfile(): FinderProfile {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (p) {
      return {
        borrower: { ...DEFAULT.borrower, ...p.borrower },
        cash: typeof p.cash === 'number' ? p.cash : DEFAULT.cash,
        monthlyMax: typeof p.monthlyMax === 'number' ? p.monthlyMax : DEFAULT.monthlyMax,
        target: { ...DEFAULT.target, ...p.target },
      };
    }
  } catch {
    // 손상된 저장값은 기본값으로 시작합니다.
  }
  return DEFAULT;
}

/** 조건을 한 번이라도 넣었나 — 안 넣었으면 후보판은 기본 가정으로 둡니다 */
export function hasProfile(): boolean {
  try {
    return !!localStorage.getItem(PROFILE_KEY);
  } catch {
    return false;
  }
}

export function loadAdded(): AddedRows {
  try {
    const a = JSON.parse(localStorage.getItem(ADDED_KEY) || 'null');
    if (a) return { jeonse: a.jeonse ?? [], wolse: a.wolse ?? [] };
  } catch {
    // 무시하고 빈 목록으로
  }
  return { jeonse: [], wolse: [] };
}

const TIER_LABEL: Record<BoardTier, string> = {
  A: '위험 낮음',
  B: '등기부 확인 후 가능',
  C: '주의 · 위험',
  D: '판단 보류',
};
const TIER_TONE: Record<BoardTier, 'good' | 'info' | 'bad' | 'neutral'> = { A: 'good', B: 'info', C: 'bad', D: 'neutral' };

const BINDING_LABEL = {
  CASH_RATIO: '내 돈이 막음',
  CAP: '상품 한도',
  DEPOSIT_MAX: '보증금 상한',
} as const;

type SortKey = 'safe' | 'cheap' | 'commute' | 'newest' | 'own';
const SORTS: Record<BoardMode, { value: SortKey; label: string }[]> = {
  jeonse: [
    { value: 'safe', label: '돌려받기 쉬운 순 (판정 → 전세가율)' },
    { value: 'own', label: '내 돈 적게 드는 순' },
    { value: 'commute', label: '함안 방향 가까운 순' },
    { value: 'newest', label: '신축 순' },
  ],
  wolse: [
    { value: 'cheap', label: '매달 나가는 돈 적은 순' },
    { value: 'own', label: '내 돈 적게 드는 순' },
    { value: 'commute', label: '함안 방향 가까운 순' },
    { value: 'newest', label: '신축 순' },
  ],
};
const COMMUTE_ORDER = { onsite: 0, near: 1, mid: 2, far: 3 } as const;
const TIER_ORDER: Record<BoardTier, number> = { A: 0, B: 1, C: 2, D: 3 };

const man = (v: number) => `${Math.round(v / 10000).toLocaleString('ko-KR')}만`;

/** 상품 하나를 보증금 하나로 자세히 — 자격 사유와 한도 */
function LoanDetail({ borrower, target, onTarget }: { borrower: Borrower; target: RentTarget; onTarget: (p: Partial<RentTarget>) => void }) {
  const results = useMemo(() => compareRentLoans(borrower, target), [borrower, target]);
  const advice = useMemo(() => adviseRentLoans(borrower, target, results), [borrower, target, results]);
  const best = results.find((r) => r.eligible);
  return (
    <Card
      title="대출 자세히 — 보증금 하나로 상품별 자격·한도"
      subtitle='목록의 "대출 자세히" 를 누르면 그 집 보증금이 들어옵니다. 떨어진 상품은 이유를 전부 보여 줍니다 — 그게 "무엇을 바꾸면 되나" 입니다'
      action={<Badge tone="info">기준 {RENT_LOAN_RULES.effectiveFrom}</Badge>}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="보증금">
          <MoneyInput value={target.deposit} onChange={(v) => onTarget({ deposit: v })} />
        </Field>
        <Field label="월세" hint="전세면 0">
          <MoneyInput value={target.rent} onChange={(v) => onTarget({ rent: v })} />
        </Field>
        <Field label="전용면적" hint="정책상품은 85㎡ 이하만">
          <NumberInput value={target.areaSqm} step={1} suffix="㎡" onChange={(v) => onTarget({ areaSqm: Math.max(0, v) })} />
        </Field>
      </div>
      {advice.length > 0 && (
        <div className="mt-4 space-y-2">
          {advice.map((a) => (
            <div key={a.headline} className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2">
              <div className="text-xs font-semibold text-sky-200">{a.headline}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-sky-100/80">{a.detail}</div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-[11px]">
          <thead className="text-slate-500">
            <tr className="border-b border-slate-800">
              <th className="py-1.5 pr-3 font-medium">상품</th>
              <th className="py-1.5 pr-3 text-right font-medium">한도</th>
              <th className="py-1.5 pr-3 text-right font-medium">내 돈</th>
              <th className="py-1.5 pr-3 text-right font-medium">금리</th>
              <th className="py-1.5 pr-3 text-right font-medium">월 이자</th>
              <th className="py-1.5 font-medium">판정</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.product.id} className={`border-b border-slate-900 ${r.eligible ? '' : 'opacity-60'}`}>
                <td className="py-2 pr-3">
                  <div className="font-medium text-slate-200">{r.product.shortName}</div>
                  <div className="text-[10px] text-slate-600">{r.product.name}</div>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-200">
                  {r.eligible ? money(r.limit) : '—'}
                  {r.eligible && r.bindingConstraint === 'CAP' && <div className="text-[10px] text-amber-500/80">상품 상한</div>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{r.eligible ? money(r.ownCash) : '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-300">
                  {percent(r.product.rate.min, 1)}~{percent(r.product.rate.max, 1)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-100">
                  {r.eligible ? `${man(r.monthlyInterest.min)}~${man(r.monthlyInterest.max)}` : '—'}
                </td>
                <td className="py-2">
                  {r.eligible ? (
                    <span className="text-emerald-300">가능</span>
                  ) : (
                    <details>
                      <summary className="cursor-pointer text-rose-300">불가 ({r.rejectReasons.length})</summary>
                      <ul className="mt-1 space-y-0.5">
                        {r.rejectReasons.map((x) => (
                          <li key={x} className="text-[10px] leading-relaxed text-slate-500">· {x}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {best && best.product.watchOuts.length > 0 && (
        <Foldable summary={`${best.product.shortName} 에서 놓치면 손해 보는 것`} count={best.product.watchOuts.length}>
          <ul className="space-y-1">
            {best.product.watchOuts.map((w) => (
              <li key={w} className="text-[10px] leading-relaxed text-slate-500">· {w}</li>
            ))}
            <li className="text-[10px] leading-relaxed text-slate-600">근거 · {best.product.basis}</li>
          </ul>
        </Foldable>
      )}
      <Foldable summary="이 표가 못 하는 것" count={RENT_LOAN_CAVEATS.length}>
        <ul className="space-y-1">
          {RENT_LOAN_CAVEATS.map((c) => (
            <li key={c} className="text-[10px] leading-relaxed text-slate-500">· {c}</li>
          ))}
        </ul>
      </Foldable>
      <p className="mt-3 text-[10px] leading-relaxed text-slate-600">
        {RENT_LOAN_RULES.disclaimer} · 출처 {RENT_LOAN_RULES.sources.join(' · ')}
      </p>
    </Card>
  );
}

export function RentFinderApp({ onOpenBoard }: { onOpenBoard?: () => void }) {
  const [profile, setProfile] = useState<FinderProfile>(loadProfile);
  const [added, setAdded] = useState<AddedRows>(loadAdded);
  const [mode, setMode] = useState<BoardMode>('jeonse');
  const [sort, setSort] = useState<SortKey>('safe');
  const [regions, setRegions] = useState<string[]>(['48127', '48125']);
  const [minBuild, setMinBuild] = useState<string>('0');
  const [limit, setLimit] = useState(30);
  const { borrower, cash, monthlyMax, target } = profile;

  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // 저장 실패는 계산에 영향이 없습니다.
    }
  }, [profile]);
  useEffect(() => {
    try {
      localStorage.setItem(ADDED_KEY, JSON.stringify(added));
    } catch {
      // 위와 같습니다.
    }
  }, [added]);

  const setB = (p: Partial<Borrower>) => setProfile((s) => ({ ...s, borrower: { ...s.borrower, ...p } }));
  const setT = (p: Partial<RentTarget>) => setProfile((s) => ({ ...s, target: { ...s.target, ...p } }));

  const reach = useMemo(() => depositReach(borrower, cash), [borrower, cash]);
  const bestReach = reach.find((r) => r.maxDeposit > 0);

  /** 후보판에 이미 있는 줄 — 스냅샷 + 담은 것 */
  const onBoard = useMemo(() => {
    const snap = (mode === 'jeonse' ? BOARD_SNAPSHOT.jeonse : BOARD_SNAPSHOT.wolse).map((r) => r.id);
    return new Set([...snap, ...added[mode]]);
  }, [mode, added]);

  const found = useMemo(
    () =>
      discover({
        mode,
        borrower,
        cash,
        monthlyMax,
        exclude: onBoard,
        regionCodes: regions,
        minBuildYear: Number(minBuild) || 0,
      }),
    [mode, borrower, cash, monthlyMax, onBoard, regions, minBuild]
  );

  const sorted = useMemo(() => {
    const commute = (code: string) => COMMUTE_ORDER[regionOf(code)?.commute ?? 'mid'];
    const code = (cx: string) => cx.split('-')[0];
    const list = [...found];
    const byKey: Record<SortKey, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      // 표본이 얇은 "판단 보류" 가 낮은 전세가율로 맨 위에 오지 않게, 판정부터 봅니다
      safe: (a, b) => TIER_ORDER[a.row.tier] - TIER_ORDER[b.row.tier] || ((a.row as JeonseBoardRow).ratio ?? 9) - ((b.row as JeonseBoardRow).ratio ?? 9),
      cheap: (a, b) => a.monthlyOut - b.monthlyOut,
      own: (a, b) => a.own - b.own || a.monthlyOut - b.monthlyOut,
      commute: (a, b) => commute(code(a.row.cx)) - commute(code(b.row.cx)) || a.monthlyOut - b.monthlyOut,
      newest: (a, b) => (b.row.built || 0) - (a.row.built || 0),
    };
    return list.sort(byKey[sort]);
  }, [found, sort]);

  // 조건이 바뀌면 "더 보기" 로 늘린 개수를 처음으로 되돌립니다.
  useEffect(() => setLimit(30), [mode, cash, monthlyMax, regions, minBuild]);

  const toggleAdd = (id: string) =>
    setAdded((a) => ({ ...a, [mode]: a[mode].includes(id) ? a[mode].filter((x) => x !== id) : [...a[mode], id] }));
  const addedCount = added.jeonse.length + added.wolse.length;
  const switchMode = (m: BoardMode) => {
    setMode(m);
    setSort(m === 'jeonse' ? 'safe' : 'cheap');
  };

  return (
    <div className="space-y-5">
      <Card
        title="전월세 찾기 — 내 조건으로 들어갈 수 있는 집"
        subtitle={`비교·소거·메모는 후보판에서 합니다. 여기서는 ① 내 조건을 넣고 ② 얼마짜리까지 되는지 보고 ③ 후보판에 없는 집을 골라 담습니다. 국토부 아파트 전월세 실거래 ${RENT_SNAPSHOT.stats.deals.toLocaleString('ko-KR')}건 · 기준 ${RENT_SNAPSHOT.asOf}`}
        action={
          onOpenBoard && (
            <button
              type="button"
              onClick={onOpenBoard}
              className="shrink-0 rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-300 transition hover:bg-sky-500/25"
            >
              후보판 열기{addedCount ? ` · 담은 집 ${addedCount}` : ''} →
            </button>
          )
        }
      >
        <p className="text-xs leading-relaxed text-slate-500">
          여기 넣은 조건은 <b className="text-slate-300">후보판의 "되는 대출 · 자기 돈 · 월 이자" 칸도 다시 잽니다</b> — 후보판은 원래
          "32세 · 소득 4천만" 가정으로 계산돼 있었습니다.
        </p>
      </Card>

      <Card title="① 내 조건" subtitle="대출 자격이 여기서 갈립니다. 한 번 넣으면 이 브라우저에 남습니다">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="보증금에 넣을 내 돈" hint="예금·청약 해지 등 계약 때 낼 수 있는 돈">
            <MoneyInput value={cash} onChange={(v) => setProfile((s) => ({ ...s, cash: v }))} />
          </Field>
          <Field label="월 주거비 한도" hint="월세 + 대출 이자 (관리비 빼고)">
            <MoneyInput value={monthlyMax} onChange={(v) => setProfile((s) => ({ ...s, monthlyMax: v }))} />
          </Field>
          <Field label="나이" hint="청년 상품은 만 34세까지">
            <NumberInput value={borrower.age} step={1} suffix="세" onChange={(v) => setB({ age: Math.max(0, v) })} />
          </Field>
          <Field label="본인 연소득" hint="세전">
            <MoneyInput value={borrower.income} onChange={(v) => setB({ income: v })} />
          </Field>
          <Field label="상대방 연소득" hint={borrower.married ? '혼인신고를 해서 합산합니다' : '혼인신고 전이라 합산하지 않습니다'}>
            <MoneyInput value={borrower.spouseIncome} onChange={(v) => setB({ spouseIncome: v })} />
          </Field>
          <Field label="순자산" hint="정책상품은 3.37억 이하">
            <MoneyInput value={borrower.netWorth} onChange={(v) => setB({ netWorth: v })} />
          </Field>
          <Field label="혼인 연차" hint="신혼부부 상품은 7년 이내">
            <NumberInput value={borrower.marriedYears} step={1} suffix="년" onChange={(v) => setB({ marriedYears: Math.max(0, v) })} />
          </Field>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Toggle label="혼인신고를 했다" hint="동거만으로는 신혼부부 상품 자격이 없습니다. 대신 소득도 합산하지 않습니다." checked={borrower.married} onChange={(v) => setB({ married: v })} />
          <Toggle label="중소·중견기업 재직" hint="중기청 전월세보증금대출은 연 1.5% 로 가장 쌉니다." checked={borrower.smeEmployed} onChange={(v) => setB({ smeEmployed: v })} />
          <Toggle label="군 복무를 했다" hint="중기청 나이 상한이 만 34세 → 39세로 늘어납니다." checked={borrower.militaryServed} onChange={(v) => setB({ militaryServed: v })} />
          <Toggle label="2년 이내 출산·입양" hint="신생아 특례 전세자금 자격입니다." checked={borrower.newbornWithin2y} onChange={(v) => setB({ newbornWithin2y: v })} />
          <Toggle label="무주택 세대주가 된다" hint="거의 모든 정책상품의 전제입니다." checked={borrower.householder && borrower.noHouse} onChange={(v) => setB({ householder: v, noHouse: v })} />
        </div>
      </Card>

      <Card
        title="② 그래서 얼마짜리까지 되나"
        subtitle="보증금 = 내 돈 + 대출. 대출은 보증금의 일정 비율까지이고 상품마다 절대 한도와 보증금 상한이 있어, 상품별로 잽니다"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="전세 최대 보증금"
            value={bestReach ? money(bestReach.maxDeposit) : money(cash)}
            hint={
              bestReach
                ? `${bestReach.product} ${money(bestReach.loan)} + 내 돈 ${money(bestReach.maxDeposit - bestReach.loan)} · ${BINDING_LABEL[bestReach.binding]}`
                : '되는 대출이 없어 내 돈만큼'
            }
          />
          <Stat
            label="그때 월 이자"
            value={bestReach ? `${man((bestReach.loan * bestReach.rate.min) / 12)}~${man((bestReach.loan * bestReach.rate.max) / 12)}` : '—'}
            hint={`월 한도 ${man(monthlyMax)} 대비`}
          />
          <Stat label="월세로 가면" value={`월 ${man(monthlyMax)}까지`} hint={`보증금은 내 돈 ${money(cash)} (+ 대출) 안에서`} />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-[11px]">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-800">
                <th className="py-1.5 pr-3 font-medium">상품</th>
                <th className="py-1.5 pr-3 text-right font-medium">최대 보증금</th>
                <th className="py-1.5 pr-3 text-right font-medium">대출</th>
                <th className="py-1.5 pr-3 font-medium">막는 것</th>
                <th className="py-1.5 pr-3 text-right font-medium">금리</th>
                <th className="py-1.5 font-medium">안 되는 이유</th>
              </tr>
            </thead>
            <tbody>
              {reach.map((r) => (
                <tr key={r.product} className={`border-b border-slate-900 ${r.maxDeposit ? '' : 'opacity-55'}`}>
                  <td className="py-1.5 pr-3 font-medium text-slate-200">{r.product}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-100">{r.maxDeposit ? money(r.maxDeposit) : '—'}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-300">{r.maxDeposit ? money(r.loan) : '—'}</td>
                  <td className="py-1.5 pr-3 text-slate-400">{r.maxDeposit ? BINDING_LABEL[r.binding] : ''}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-400">
                    {percent(r.rate.min, 1)}~{percent(r.rate.max, 1)}
                  </td>
                  <td className="py-1.5 text-[10px] leading-relaxed text-slate-500">{r.rejectReasons.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-600">
          전용 85㎡ 이하 집 기준입니다. 넘으면 정책상품이 빠지고 은행 상품만 남습니다. 실제 한도는 보증기관 심사로 줄 수 있습니다.
        </p>
      </Card>

      <Card
        title="③ 후보판에 없는 집 — 내 조건으로 들어갈 수 있는 것만"
        subtitle={`내 돈 ${money(cash)} · 월 ${man(monthlyMax)} 안에서 되는 집만 남깁니다. 방 2개 이상(전용 ${BOARD_MIN_AREA}㎡↑) · 최근 1년 안에 거래가 있는 평형. 후보판에 이미 있는 집은 뺐습니다`}
        action={<Badge tone="info">{sorted.length}곳</Badge>}
      >
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl<BoardMode>
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'jeonse', label: '전세' },
              { value: 'wolse', label: '월세' },
            ]}
          />
          <div className="min-w-[14rem]">
            <Select<SortKey> value={sort} onChange={setSort} options={SORTS[mode]} />
          </div>
          <div className="min-w-[9rem]">
            <Select<string>
              value={minBuild}
              onChange={setMinBuild}
              options={[
                { value: '0', label: '준공 전체' },
                { value: '2005', label: '2005년 이후' },
                { value: '2011', label: '2011년 이후 (15년 이내)' },
                { value: '2016', label: '2016년 이후 (10년 이내)' },
              ]}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {RENT_REGIONS.map((r) => {
            const on = regions.includes(r.code);
            return (
              <button
                key={r.code}
                type="button"
                title={r.note}
                onClick={() => setRegions((x) => (on ? x.filter((c) => c !== r.code) : [...x, r.code]))}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
                  on ? 'bg-sky-500/15 text-sky-300' : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
                }`}
              >
                {r.short} <span className="text-[10px] text-slate-600">{COMMUTE_LABEL[r.commute]}</span>
              </button>
            );
          })}
        </div>

        {sorted.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-800 px-4 py-6 text-center text-xs text-slate-500">
            조건에 맞는 집이 없습니다. 내 돈이나 월 한도를 올리거나, 지역·준공 조건을 넓혀 보세요.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[60rem] text-left text-[11px]">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-800">
                  <th className="py-1.5 pr-3 font-medium">단지</th>
                  <th className="py-1.5 pr-3 text-right font-medium">평형</th>
                  <th className="py-1.5 pr-3 text-right font-medium">준공</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{mode === 'jeonse' ? '최근 전세' : '보증금 / 월세'}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{mode === 'jeonse' ? '전세가율' : '매달 (월세+이자)'}</th>
                  <th className="py-1.5 pr-3 font-medium">판정</th>
                  <th className="py-1.5 pr-3 font-medium">되는 대출</th>
                  <th className="py-1.5 pr-3 text-right font-medium">내 돈</th>
                  <th className="py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, limit).map(({ row, own, monthlyOut, loan }) => {
                  const isAdded = added[mode].includes(row.id);
                  const reg = regionOf(row.cx.split('-')[0]);
                  const j = row as JeonseBoardRow;
                  const w = row as WolseBoardRow;
                  return (
                    <tr key={row.id} className="border-b border-slate-900 align-top">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-slate-100">{row.name}</div>
                        <div className="text-[10px] text-slate-500">
                          {row.umd} · {row.region} · 함안 방향 {reg ? COMMUTE_LABEL[reg.commute] : '—'}
                        </div>
                        {row.notes.length > 0 && <div className="mt-0.5 text-[10px] text-amber-500/80">{row.notes[0]}</div>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-300">
                        {row.area}㎡<div className="text-[10px] text-slate-600">공급 약 {Math.round(toSupplyPyeong(row.area))}평</div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{row.built || '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-100">
                        {mode === 'jeonse' ? (
                          <>
                            {money(j.est ?? 0)}
                            <div className="text-[10px] text-slate-600">{j.estBasis} · {j.estN}건</div>
                          </>
                        ) : (
                          <>
                            {money(w.dep)} / {man(w.rent)}
                            <div className="text-[10px] text-slate-600">월세 {w.wn}건 · 2년 중위</div>
                          </>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {mode === 'jeonse' ? (
                          <span className={j.ratio == null ? 'text-slate-500' : j.ratio < 0.7 ? 'text-emerald-300' : j.ratio < 0.8 ? 'text-sky-300' : 'text-rose-300'}>
                            {j.ratio == null ? '잴 수 없음' : percent(j.ratio, 0)}
                          </span>
                        ) : (
                          <span className="text-slate-100">{man(monthlyOut)}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={TIER_TONE[row.tier]}>{TIER_LABEL[row.tier]}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-slate-300">
                        {loan ? (
                          <>
                            {loan.n} {money(loan.lim)}
                            <div className="text-[10px] text-slate-500">
                              월 이자 {man(loan.i0)}~{man(loan.i1)}
                              {loan.wolse && loan.mcap ? ` · 월세 지원 월 ${man(loan.mcap)}까지` : ''}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-500">대출 없이 내 돈으로</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-100">{money(own)}</td>
                      <td className="py-2">
                        <div className="flex flex-col items-start gap-1">
                          <button
                            type="button"
                            onClick={() => toggleAdd(row.id)}
                            className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                              isAdded ? 'bg-emerald-500/15 text-emerald-300 hover:bg-rose-500/15 hover:text-rose-300' : 'bg-sky-500/15 text-sky-300 hover:bg-sky-500/25'
                            }`}
                            title={isAdded ? '누르면 후보판에서 뺍니다' : '후보판에 이 집을 더합니다'}
                          >
                            {isAdded ? '담김 ✓ (빼기)' : '후보판에 담기'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setT({ deposit: mode === 'jeonse' ? (j.est ?? 0) : w.dep, rent: mode === 'jeonse' ? 0 : w.rent, areaSqm: row.area });
                              document.getElementById('loan-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}
                            className="text-[10px] text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-300"
                          >
                            대출 자세히 ↓
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {sorted.length > limit && (
              <button
                type="button"
                onClick={() => setLimit((l) => l + 30)}
                className="mt-3 rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-700"
              >
                {sorted.length - limit}곳 더 보기
              </button>
            )}
          </div>
        )}
        {added[mode].length > 0 && onOpenBoard && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
            <span className="text-xs text-emerald-200">
              {mode === 'jeonse' ? '전세' : '월세'} 후보판에 {added[mode].length}곳을 담았습니다 — 후보판에서 "직접 담음" 표시로 나옵니다.
            </span>
            <button type="button" onClick={onOpenBoard} className="rounded-md bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-500/30">
              후보판에서 비교하기 →
            </button>
          </div>
        )}
      </Card>

      <div id="loan-detail" style={{ scrollMarginTop: 140 }}>
        <LoanDetail borrower={borrower} target={target} onTarget={setT} />
      </div>

      <Card title="이 자료가 못 하는 것">
        <ul className="space-y-1.5">
          {[...RENT_CAVEATS, ...SAFETY_CAVEATS].map((c) => (
            <li key={c} className="text-xs leading-relaxed text-slate-400">· {c}</li>
          ))}
        </ul>
        <p className="mt-3 text-[10px] leading-relaxed text-slate-600">
          출처 {RENT_SNAPSHOT.source.name} · {RENT_SNAPSHOT.source.license} · 수집 {RENT_SNAPSHOT.asOf} · 범위 {RENT_SNAPSHOT.range.from}~
          {RENT_SNAPSHOT.range.to}
        </p>
      </Card>
    </div>
  );
}
