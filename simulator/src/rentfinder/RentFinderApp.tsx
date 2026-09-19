import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Card,
  Empty,
  Field,
  Foldable,
  MoneyInput,
  NumberInput,
  Select,
  Stat,
} from '../components/ui';
import { money, percent } from '../engine/format';
import {
  COMMUTE_LABEL,
  RENT_CAVEATS,
  RENT_REGIONS,
  RENT_SNAPSHOT,
  type CommuteGrade,
} from './data';
import {
  DEFAULT_INPUT,
  SORT_LABEL,
  findRentals,
  sortCandidates,
  summarize,
  type Candidate,
  type FinderInput,
  type SortKey,
  type TenureMode,
} from './finder';

/**
 * 마산 전월세 찾기.
 *
 * 매수 시뮬레이터와 한 저장소에 있지만 **다른 사이트**입니다. 저기는 "살까
 * 말까", 여기는 "집을 사기 전까지 어디서 살까" 라 묻는 것이 다릅니다.
 *
 * 화면은 세 단으로 갑니다 — 조건을 넣고, 후보가 몇 개인지 보고, 하나씩
 * 들여다봅니다. 조건을 바꾸면 바로 개수가 움직여야 "얼마를 더 내면 선택지가
 * 늘어나는지" 가 몸으로 잡힙니다.
 */

const STORAGE_KEY = 'masan-rent-finder-v1';

const COMMUTE_TONE: Record<CommuteGrade, 'good' | 'info' | 'neutral' | 'warn'> = {
  onsite: 'good',
  near: 'good',
  mid: 'info',
  far: 'warn',
};

interface Saved {
  input: FinderInput;
  starred: string[];
  memos: Record<string, string>;
}

function load(): Saved {
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Saved>;
        return {
          input: { ...DEFAULT_INPUT, ...p.input },
          starred: p.starred ?? [],
          memos: p.memos ?? {},
        };
      }
    } catch {
      // 손상된 저장값은 무시하고 기본 조건으로 시작합니다.
    }
  }
  return { input: DEFAULT_INPUT, starred: [], memos: {} };
}

/** 월 환산 주거비를 만원 단위로 — 이 화면의 공용 단위입니다. */
const manwonPerMonth = (v: number) => `월 ${Math.round(v / 10000).toLocaleString('ko-KR')}만`;

function CandidateCard({
  c,
  starred,
  memo,
  onStar,
  onMemo,
}: {
  c: Candidate;
  starred: boolean;
  memo: string;
  onStar: () => void;
  onMemo: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const age = c.complex.buildYear
    ? new Date(RENT_SNAPSHOT.asOf).getFullYear() - c.complex.buildYear
    : null;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-slate-100">{c.complex.name}</span>
            <Badge tone={COMMUTE_TONE[c.commute]} title={`함안·의령 방향 ${COMMUTE_LABEL[c.commute]}`}>
              {c.regionLabel} · {COMMUTE_LABEL[c.commute]}
            </Badge>
            {c.thin && <Badge tone="warn">거래 {c.size.n}건</Badge>}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {c.complex.umd}
            {c.complex.road && ` · ${c.complex.road}`}
            {' · '}전용 {c.size.area}㎡
            {age !== null && ` · 준공 ${c.complex.buildYear}년 (${age}년차)`}
            {c.size.floorMax > 0 && ` · ${c.size.floorMin}~${c.size.floorMax}층 거래`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right">
            <div className="text-lg font-semibold text-slate-100 tabular-nums">
              {manwonPerMonth(c.best.monthly)}
            </div>
            <div className="text-[10px] text-slate-500">
              {c.best.mode === 'jeonse' ? '전세 기준' : '월세 기준'} 환산
            </div>
          </div>
          <button
            type="button"
            onClick={onStar}
            title={starred ? '후보에서 빼기' : '후보로 담기'}
            className={`rounded-lg border px-2 py-1 text-sm transition ${
              starred
                ? 'border-amber-400/60 bg-amber-500/15 text-amber-300'
                : 'border-slate-700 text-slate-500 hover:text-amber-300'
            }`}
          >
            ★
          </button>
        </div>
      </div>

      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {c.options.map((o) => (
          <div
            key={o.mode}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
              o.mode === c.best.mode
                ? 'border-sky-500/40 bg-sky-500/10 text-sky-100'
                : 'border-slate-800 bg-slate-950/40 text-slate-400'
            }`}
          >
            <span className="font-medium">{o.mode === 'jeonse' ? '전세' : '월세'}</span>{' '}
            <span className="tabular-nums">
              {o.mode === 'jeonse'
                ? money(o.deposit)
                : `보증금 ${money(o.deposit)} · 월 ${money(o.rent)}`}
            </span>
            <span className="ml-1 text-slate-500">
              → {manwonPerMonth(o.monthly)} · 거래 {o.n}건
            </span>
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
        <span>
          최근 거래 {c.staleMonths === 0 ? '이번 달' : `${c.staleMonths}개월 전`}
        </span>
        <span>갱신계약 {percent(c.size.renewalShare, 0)}</span>
        <a
          href={`https://map.naver.com/p/search/${encodeURIComponent(
            `${c.complex.umd} ${c.complex.name}`
          )}`}
          target="_blank"
          rel="noreferrer"
          className="text-sky-400 underline-offset-2 hover:underline"
        >
          지도에서 보기 ↗
        </a>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-300"
        >
          {open ? '메모 접기' : '메모 · 확인할 것'}
        </button>
      </div>

      {c.notes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {c.notes.map((n) => (
            <li key={n} className="text-[10px] leading-relaxed text-amber-500/80">
              · {n}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-2 border-t border-slate-800 pt-2">
          <textarea
            value={memo}
            onChange={(e) => onMemo(e.target.value)}
            rows={3}
            placeholder="반려견 가능? 주차 대수? 엘리베이터? 관리비? — 자료에 없는 것들을 여기 적어 두세요."
            className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-sky-500"
          />
          <p className="mt-1 text-[10px] leading-relaxed text-slate-600">
            반려동물 가능 여부·관리비·주차는 공공자료에 없습니다. 관리사무소나 임대인에게
            확인한 내용을 여기 적어 두면 브라우저에 남습니다.
          </p>
        </div>
      )}
    </div>
  );
}

export function RentFinderApp() {
  const [state, setState] = useState<Saved>(load);
  const [sort, setSort] = useState<SortKey>('monthly');
  const [onlyStarred, setOnlyStarred] = useState(false);
  const { input } = state;

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 저장 실패는 계산에 영향이 없으므로 무시합니다.
    }
  }, [state]);

  const patch = (p: Partial<FinderInput>) =>
    setState((s) => ({ ...s, input: { ...s.input, ...p } }));

  const all = useMemo(() => findRentals(input), [input]);
  const list = useMemo(() => {
    const base = onlyStarred ? all.filter((c) => state.starred.includes(c.key)) : all;
    return sortCandidates(base, sort);
  }, [all, sort, onlyStarred, state.starred]);
  const sum = useMemo(() => summarize(all), [all]);

  const toggleRegion = (code: string) => {
    const has = input.regionCodes.includes(code);
    patch({
      regionCodes: has
        ? input.regionCodes.filter((c) => c !== code)
        : [...input.regionCodes, code],
    });
  };

  const toggleMode = (mode: TenureMode) => {
    const has = input.modes.includes(mode);
    // 최소 하나는 남겨야 결과가 성립합니다.
    if (has && input.modes.length === 1) return;
    patch({ modes: has ? input.modes.filter((m) => m !== mode) : [...input.modes, mode] });
  };

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/85 backdrop-blur">
        <div className="mx-auto max-w-6xl px-5 py-3">
          <h1 className="text-sm font-semibold text-slate-100">
            마산 전월세 찾기 — 함안 · 의령 출퇴근 기준
          </h1>
          <p className="mt-0.5 text-[11px] text-slate-500">
            국토부 아파트 전월세 실거래 {RENT_SNAPSHOT.stats.deals.toLocaleString('ko-KR')}건 ·
            단지 {RENT_SNAPSHOT.stats.complexes.toLocaleString('ko-KR')}개 · 기준{' '}
            {RENT_SNAPSHOT.asOf} — <b className="text-slate-400">매물이 아니라 체결된 계약</b>이라
            후보를 좁히는 데까지 쓰고 매물 확인은 직접 하셔야 합니다.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        <Card
          title="조건"
          subtitle="조건을 움직이면 아래 후보 수가 바로 바뀝니다 — 얼마를 더 내면 선택지가 늘어나는지 보세요"
          action={<Badge tone="info">후보 {sum.candidates}개</Badge>}
        >
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-slate-400">지역</div>
            <div className="flex flex-wrap gap-1.5">
              {RENT_REGIONS.map((r) => {
                const on = input.regionCodes.includes(r.code);
                const n = RENT_SNAPSHOT.stats.perRegion[r.code] ?? 0;
                return (
                  <button
                    key={r.code}
                    type="button"
                    onClick={() => toggleRegion(r.code)}
                    title={r.note}
                    className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
                      on
                        ? 'bg-sky-500/15 text-sky-300'
                        : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
                    }`}
                  >
                    {r.short}
                    <span className="ml-1 text-[10px] text-slate-600">
                      {COMMUTE_LABEL[r.commute]} · {n.toLocaleString('ko-KR')}건
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-600">
              출퇴근 등급은 <b className="text-slate-500">소요시간이 아니라 방향 판단</b>입니다 —
              지도 API 가 없어 분 단위를 낼 수 없습니다. 버튼에 마우스를 올리면 근거가 나옵니다.
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="전용면적 하한" hint="투룸은 대개 전용 36㎡부터">
              <NumberInput
                value={input.minArea}
                step={1}
                suffix="㎡"
                onChange={(v) => patch({ minArea: Math.max(0, v) })}
              />
            </Field>
            <Field label="전용면적 상한" hint="0이면 제한 없음">
              <NumberInput
                value={input.maxArea}
                step={1}
                suffix="㎡"
                onChange={(v) => patch({ maxArea: Math.max(0, v) })}
              />
            </Field>
            <Field label="낼 수 있는 보증금" hint="이보다 큰 보증금은 빼고 봅니다">
              <MoneyInput value={input.maxDeposit} onChange={(v) => patch({ maxDeposit: v })} />
            </Field>
            <Field label="월 환산 주거비 상한" hint="월세 + 보증금 기회비용">
              <MoneyInput value={input.maxMonthly} onChange={(v) => patch({ maxMonthly: v })} />
            </Field>
            <Field
              label="보증금 기회비용"
              hint="전세대출이면 그 금리, 자기 돈이면 예금·투자 수익률"
            >
              <NumberInput
                value={Math.round(input.opportunityRate * 10000) / 100}
                step={0.1}
                suffix="%"
                onChange={(v) => patch({ opportunityRate: v / 100 })}
              />
            </Field>
            <Field label="준공연도 하한" hint="0이면 제한 없음">
              <NumberInput
                value={input.minBuildYear}
                step={1}
                suffix="년"
                onChange={(v) => patch({ minBuildYear: Math.max(0, v) })}
              />
            </Field>
            <Field label="최근 거래" hint="이 기간 안에 거래가 있던 평형만">
              <NumberInput
                value={input.freshMonths}
                step={1}
                suffix="개월"
                onChange={(v) => patch({ freshMonths: Math.max(0, v) })}
              />
            </Field>
            <Field label="최소 거래 건수" hint="1건짜리 중위가는 그 집 한 채 가격입니다">
              <NumberInput
                value={input.minDeals}
                step={1}
                suffix="건"
                onChange={(v) => patch({ minDeals: Math.max(0, v) })}
              />
            </Field>
            <Field label="정렬">
              <Select<SortKey>
                value={sort}
                onChange={setSort}
                options={(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({
                  value: k,
                  label: SORT_LABEL[k],
                }))}
              />
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(['jeonse', 'wolse'] as TenureMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => toggleMode(m)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  input.modes.includes(m)
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {m === 'jeonse' ? '전세' : '월세 · 반전세'}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setOnlyStarred((v) => !v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                onlyStarred ? 'bg-amber-500/15 text-amber-300' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              ★ 담은 것만 ({state.starred.length})
            </button>
          </div>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="조건에 맞는 평형"
            value={`${sum.candidates}개`}
            hint={`단지 ${sum.complexes}곳`}
          />
          <Stat
            label="월 환산 주거비 중위"
            value={sum.candidates ? manwonPerMonth(sum.medianMonthly) : '—'}
            hint="보증금 기회비용 포함"
          />
          <Stat
            label="가장 싼 후보"
            value={sum.cheapest ? manwonPerMonth(sum.cheapest.best.monthly) : '—'}
            hint={sum.cheapest ? `${sum.cheapest.complex.name} 전용 ${sum.cheapest.size.area}㎡` : ''}
          />
          <Stat
            label="지역 분포"
            value={sum.perRegion.length ? sum.perRegion[0].label : '—'}
            hint={sum.perRegion.map((r) => `${r.label} ${r.n}`).join(' · ')}
          />
        </div>

        <Card
          title={`후보 ${list.length}개`}
          subtitle="월 환산 주거비 = 월세 + 보증금 × 기회비용 ÷ 12 — 전세와 월세를 한 자에 올립니다"
        >
          {list.length === 0 ? (
            <Empty>
              조건에 맞는 평형이 없습니다. 보증금 상한이나 월 환산 상한을 올리거나, 전용면적
              하한을 낮춰 보세요.
            </Empty>
          ) : (
            <div className="mt-3 space-y-2">
              {list.slice(0, 60).map((c) => (
                <CandidateCard
                  key={c.key}
                  c={c}
                  starred={state.starred.includes(c.key)}
                  memo={state.memos[c.key] ?? ''}
                  onStar={() =>
                    setState((s) => ({
                      ...s,
                      starred: s.starred.includes(c.key)
                        ? s.starred.filter((k) => k !== c.key)
                        : [...s.starred, c.key],
                    }))
                  }
                  onMemo={(v) =>
                    setState((s) => ({ ...s, memos: { ...s.memos, [c.key]: v } }))
                  }
                />
              ))}
              {list.length > 60 && (
                <p className="pt-1 text-[11px] text-slate-500">
                  {list.length}개 중 60개만 보입니다 — 조건을 좁히면 나머지가 드러납니다.
                </p>
              )}
            </div>
          )}
        </Card>

        <Card title="이 자료가 못 하는 것">
          <ul className="space-y-1.5">
            {RENT_CAVEATS.map((c) => (
              <li key={c} className="text-xs leading-relaxed text-slate-400">
                · {c}
              </li>
            ))}
          </ul>
          <Foldable summary="강아지와 함께 살 집을 볼 때 직접 확인할 것" count={6}>
            <ul className="space-y-1">
              {[
                '반려동물 허용 여부 — 관리규약에 막혀 있는 단지가 있습니다. 관리사무소에 먼저 확인하세요.',
                '엘리베이터 유무와 층 — 노견이 되면 계단은 매일의 문제가 됩니다.',
                '산책 동선 — 단지 밖으로 바로 나가는 길, 가까운 하천·공원 유무.',
                '바닥재와 소음 — 강아지 발톱 소리는 아랫집 민원으로 이어집니다.',
                '주차 대수와 방문차량 — 구축은 세대당 1대 미만인 곳이 많습니다.',
                '관리비에 무엇이 포함되는지 — 이 자료의 월 환산에는 관리비가 빠져 있습니다.',
              ].map((t) => (
                <li key={t} className="text-[11px] leading-relaxed text-slate-500">
                  · {t}
                </li>
              ))}
            </ul>
          </Foldable>
          <p className="mt-3 text-[10px] leading-relaxed text-slate-600">
            출처 {RENT_SNAPSHOT.source.name} · {RENT_SNAPSHOT.source.license} · 수집{' '}
            {RENT_SNAPSHOT.asOf} · 범위 {RENT_SNAPSHOT.range.from}~{RENT_SNAPSHOT.range.to}
          </p>
        </Card>
      </main>
    </div>
  );
}
