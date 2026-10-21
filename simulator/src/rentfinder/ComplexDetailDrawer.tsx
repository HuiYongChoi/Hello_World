import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, Foldable, Stat } from '../components/ui';
import { money, percent } from '../engine/format';
import { quarterLabel } from '../engine/market';
import type { BoardSignals } from './board/boardDoc';
import { fetchSignals } from './signals';
import { COMPLEX_CAVEATS, complexDetail, type ComplexDetail, type MaturityItem } from './complex';
import { toPyeong, toSupplyPyeong } from './finder';
import { REGISTRY_CHECKLIST, SAFETY_LABEL, SAFETY_RULES, type SafetyGrade } from './safety';

/**
 * 단지 상세 — 오른쪽 슬라이드 패널.
 *
 * 왼쪽 대출 설명서와 대칭으로 오른쪽에 답니다. 오른쪽 서랍을 뺐던 이유는 "곁가지
 * 분석" 이었는데, 이 패널은 분석이 아니라 **방금 누른 줄 하나의 근거**입니다 —
 * 단지 하나를 보이고 닫히며, 자기 상태를 저장하지 않습니다.
 *
 * 설명서처럼 윈도 이벤트로 엽니다. 후보판(iframe)·찾기·시세판 어디서든
 * `openComplexDetail(cx, area)` 한 줄이면 됩니다.
 */

const OPEN_EVENT = 'complex:open';

export function openComplexDetail(cx: string, area?: number) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { cx, area } }));
}

/*
 * 전세 신호는 서버가 매일 쓰는 signals.json (같은 출처) — fetchSignals() 가 1.5초까지만
 * 기다립니다. 없는 곳(GitHub Pages·파일 직접 열기)에서는 null 이 되어 만기 섹션이 통째로 빠집니다.
 */

const GRADE_TONE: Record<SafetyGrade, 'good' | 'neutral' | 'warn' | 'bad'> = {
  low: 'good',
  mid: 'neutral',
  high: 'warn',
  danger: 'bad',
  unknown: 'neutral',
};

const areaLabel = (a: number) => `전용 ${a}㎡ (${toPyeong(a).toFixed(1)}평 · 공급 약 ${Math.round(toSupplyPyeong(a))}평)`;
const ymLabel = (ym: string | null) => (ym ? (ym.includes('Q') ? ym : `${ym.slice(0, 4)}.${ym.slice(4, 6)}`) : '—');

/**
 * `onLoanDetail` — 머리의 "이 보증금으로 대출 자세히 →" 가 부릅니다. 찾기 화면 ④ 로 가서
 * 그 보증금·평형으로 상품별 자격·한도를 엽니다 (후보판 → 상세 → 대출 확인 동선).
 */
export function ComplexDetailDrawer({ onLoanDetail }: { onLoanDetail?: (deposit: number, areaSqm: number) => void } = {}) {
  const [target, setTarget] = useState<{ cx: string; area?: number } | null>(null);
  const [signals, setSignals] = useState<BoardSignals | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ cx: string; area?: number }>).detail;
      if (!d?.cx) return;
      setTarget({ cx: d.cx, area: d.area });
      // 패널을 열 때 한 번 — 매일 바뀌는 값이라 들고 있지 않습니다.
      fetchSignals().then(setSignals);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTarget(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target]);

  const detail = useMemo(
    () => (target ? complexDetail(target.cx, target.area, signals) : null),
    [target, signals]
  );

  if (!target) return null;
  const close = () => setTarget(null);

  return (
    <>
      <button type="button" aria-label="닫기" onClick={close} className="fixed inset-0 z-40 bg-black/50 no-print" />
      <aside
        role="dialog"
        aria-label="단지 상세"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[52rem] flex-col border-l border-slate-800 bg-slate-950 no-print"
      >
        {!detail ? (
          <div className="flex items-start justify-between gap-3 px-5 py-4">
            <p className="text-sm text-slate-400">이 단지를 두 스냅샷 어디에서도 찾지 못했습니다.</p>
            <CloseButton onClick={close} />
          </div>
        ) : (
          <DetailBody
            detail={detail}
            onClose={close}
            onArea={(a) => setTarget({ cx: detail.cx, area: a })}
            onLoanDetail={
              onLoanDetail &&
              ((deposit, area) => {
                close();
                onLoanDetail(deposit, area);
              })
            }
          />
        )}
      </aside>
    </>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-lg px-2.5 py-1 text-sm text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
    >
      닫기
    </button>
  );
}

function DetailBody({
  detail: d,
  onClose,
  onArea,
  onLoanDetail,
}: {
  detail: ComplexDetail;
  onClose: () => void;
  onArea: (a: number) => void;
  onLoanDetail?: (deposit: number, areaSqm: number) => void;
}) {
  const h = d.headline;
  const grade: SafetyGrade = h.safety?.grade ?? 'unknown';
  /** 대출을 잴 보증금 — 최근 전세가 갈리거나 없으면 단추를 내지 않습니다 (없는 값으로 재지 않게) */
  const loanDeposit = !h.recent.split && h.recent.value ? h.recent.value : null;
  return (
    <>
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-100">{d.name}</h2>
            <p className="mt-0.5 text-sm text-slate-400">
              {d.umd} · {d.region} · {d.built ? `${d.built}년 준공` : '준공연도 모름'} · {areaLabel(d.area)}
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        {d.sizes.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="평형 선택">
            {d.sizes.map((s) => (
              <button
                key={s.area}
                type="button"
                onClick={() => onArea(s.area)}
                aria-pressed={s.area === d.area}
                className={`rounded-md px-2.5 py-1 text-sm tabular-nums transition ${
                  s.area === d.area ? 'bg-sky-500 text-white' : 'border border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {s.area}㎡
              </button>
            ))}
          </div>
        )}
        {d.missing.length > 0 && (
          <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            {d.missing.includes('rent') && '이 평형은 전월세 스냅샷(마산 생활권)에 없습니다 — 전세 추이·전세가율을 낼 수 없습니다. '}
            {d.missing.includes('sale') && '같은 단지·평형(±2㎡) 매매 거래가 없습니다 — 집값을 몰라 전세가율을 낼 수 없습니다.'}
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {/* 머리 숫자 — 후보판과 같은 계산 */}
        <section className="grid gap-2.5 sm:grid-cols-3">
          <Stat
            label="최근 전세"
            size="lg"
            value={h.recent.split ? '갈림' : h.recent.value ? money(h.recent.value) : '—'}
            hint={h.recent.split ? '거래가 1.5배 넘게 갈려 시세 불명' : h.recent.value ? `${h.recent.basis} · ${h.recent.n}건` : h.recent.basis}
            tone={h.recent.split ? 'warn' : undefined}
          />
          <Stat
            label="매매 최근 1년"
            size="lg"
            value={h.safety?.salePrice ? money(h.safety.salePrice) : '—'}
            hint={h.safety?.saleQuarter ? `${h.safety.saleQuarter} · ${h.safety.saleDeals}건` : '같은 칸 매매 없음'}
          />
          <Stat
            label="전세가율"
            size="lg"
            value={
              <span className="flex flex-wrap items-center gap-2">
                {h.ratio == null ? '—' : percent(h.ratio, 0)}
                {h.ratio != null && <Badge tone={GRADE_TONE[grade]}>{SAFETY_LABEL[grade]}</Badge>}
              </span>
            }
            hint="후보판과 같은 계산"
          />
        </section>
        {onLoanDetail && loanDeposit != null && (
          <button
            type="button"
            onClick={() => onLoanDetail(loanDeposit, d.area)}
            className="w-full rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-left text-sm font-medium text-sky-300 transition hover:bg-sky-500/20"
          >
            이 보증금으로 대출 자세히 → <span className="font-normal text-sky-200/80 tabular-nums">{money(loanDeposit)} · 전용 {d.area}㎡ — 상품별 자격·한도·내 돈</span>
          </button>
        )}
        {h.safety?.seniorRoom && (
          <div>
            <p className="text-sm leading-relaxed text-slate-300">
              근저당 허용선 <b className="tabular-nums text-slate-100">{money(h.safety.seniorRoom.auction)}</b> — 등기부 을구
              채권최고액 합계가 이보다 크면 경매(시세의 {Math.round(SAFETY_RULES.auctionRatio * 100)}% 가정)에서 보증금이 모자랄 수 있습니다.
            </p>
            <RegistryChecklist />
          </div>
        )}
        {!h.safety?.seniorRoom && <RegistryChecklist />}

        <Section title="매매 · 전세 분기 추이" hint="분기 중위 · 빈 원은 거래 3건 미만">
          <TrendChart detail={d} />
        </Section>

        <Section title="전세가율 추이" hint="분기마다 전세 중위 ÷ 같은 분기 매매 중위 · 흐린 막대는 어느 쪽이든 3건 미만">
          <RatioBars detail={d} />
        </Section>

        <Section title="평형별" hint={`매매는 ${d.saleWindow} 거래건수 가중 중위 · 전세·월세는 2년 중위`}>
          <SizeTable detail={d} onArea={onArea} />
        </Section>

        <Section title="최근 분기" hint="개별 거래는 자료에 없습니다 — 분기 중위와 건수까지입니다">
          <RecentTable detail={d} />
        </Section>

        {d.signals !== null && (
          <Section title="전세 만기 — 앞으로 6개월" hint="국토부 신고의 계약기간 · 진한 점은 갱신을 이미 쓴 계약(만기에 나올 가능성이 큼)">
            <MaturityTimeline items={d.signals} />
          </Section>
        )}

        <Foldable summary="이 자료가 못 하는 것" count={COMPLEX_CAVEATS.length}>
          <ul className="list-disc space-y-1 pl-4">
            {COMPLEX_CAVEATS.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Foldable>
      </div>
    </>
  );
}

/** 계약 전 서류로 볼 것 — 후보판 맨 아래에만 있던 표를 단지 상세에서도 엽니다 (safety.ts 그대로) */
function RegistryChecklist() {
  return (
    <Foldable summary="계약 전 서류로 볼 것" count={REGISTRY_CHECKLIST.length}>
      <ol className="list-decimal space-y-1.5 pl-5">
        {REGISTRY_CHECKLIST.map((c) => (
          <li key={c.what}>
            <b className="font-medium text-slate-200">{c.what}</b> <span className="text-slate-400">— {c.where}</span>
            <div className="text-slate-300">{c.look}</div>
          </li>
        ))}
      </ol>
    </Foldable>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-base font-semibold text-slate-100">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

/* ─────────────────────── 추이 — 자체 SVG ─────────────────────── */

function TrendChart({ detail: d }: { detail: ComplexDetail }) {
  const pts = [...d.sale.map((p) => ({ q: p.q, v: p.price })), ...d.jeonse.map((p) => ({ q: p.q, v: p.deposit }))];
  if (!pts.length) return <p className="text-xs text-slate-400">같은 칸 거래가 없습니다.</p>;
  const W = 600;
  const H = 180;
  const L = 52;
  const R = 8;
  const T = 8;
  const B = 22;
  const minQ = Math.min(...pts.map((p) => p.q));
  const maxQ = Math.max(...pts.map((p) => p.q));
  const lo = Math.min(...pts.map((p) => p.v)) * 0.92;
  const hi = Math.max(...pts.map((p) => p.v)) * 1.04;
  const x = (q: number) => L + ((q - minQ) / Math.max(1, maxQ - minQ)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const path = (s: { q: number; v: number }[]) =>
    s.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.q).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const sale = d.sale.map((p) => ({ q: p.q, v: p.price, n: p.n }));
  const jeonse = d.jeonse.map((p) => ({ q: p.q, v: p.deposit, n: p.n }));
  const years: number[] = [];
  const span = maxQ - minQ;
  const step = span > 24 ? 8 : 4;
  for (let q = Math.ceil(minQ / 4) * 4; q <= maxQ; q += step) years.push(q);
  const yTicks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  const saleN = sale.reduce((s, p) => s + p.n, 0);
  const jeonseN = jeonse.reduce((s, p) => s + p.n, 0);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="매매·전세 분기 중위 추이">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-slate-800" strokeWidth={1} />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" className="fill-slate-400 text-2xs tabular-nums">
              {money(v)}
            </text>
          </g>
        ))}
        {years.map((q) => (
          <text key={q} x={x(q)} y={H - 6} textAnchor="middle" className="fill-slate-400 text-2xs tabular-nums">
            {quarterLabel(q).slice(0, 4)}
          </text>
        ))}
        {sale.length > 1 && <path d={path(sale)} className="fill-none stroke-sky-400" strokeWidth={1.5} />}
        {jeonse.length > 1 && <path d={path(jeonse)} className="fill-none stroke-emerald-400" strokeWidth={1.5} />}
        {sale.map((p) => (
          <circle
            key={`s${p.q}`}
            cx={x(p.q)}
            cy={y(p.v)}
            r={2.6}
            className={p.n < 3 ? 'fill-slate-950 stroke-sky-400' : 'fill-sky-400 stroke-sky-400'}
            strokeWidth={1.2}
          >
            <title>{`매매 ${quarterLabel(p.q)} · ${money(p.v)} · ${p.n}건`}</title>
          </circle>
        ))}
        {jeonse.map((p) => (
          <circle
            key={`j${p.q}`}
            cx={x(p.q)}
            cy={y(p.v)}
            r={2.6}
            className={p.n < 3 ? 'fill-slate-950 stroke-emerald-400' : 'fill-emerald-400 stroke-emerald-400'}
            strokeWidth={1.2}
          >
            <title>{`전세 ${quarterLabel(p.q)} · ${money(p.v)} · ${p.n}건`}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-slate-400">
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-400 align-middle" />
          매매 분기 중위 · 거래 {saleN}건{sale.length ? ` (${quarterLabel(sale[0].q)}~)` : ''}
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400 align-middle" />
          전세 분기 중위 · 거래 {jeonseN}건{jeonse.length ? ` (${quarterLabel(jeonse[0].q)}~)` : ''}
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full border border-slate-400 align-middle" />
          3건 미만 — 그 집 한 채의 가격에 가까움
        </span>
      </div>
    </div>
  );
}

function RatioBars({ detail: d }: { detail: ComplexDetail }) {
  if (!d.ratioSeries.length) {
    return <p className="text-xs text-slate-400">매매·전세가 같은 분기에 같이 거래된 적이 없어 분기별 비율을 낼 수 없습니다.</p>;
  }
  const cuts = SAFETY_RULES.ratioCuts;
  const W = 600;
  const H = 110;
  const T = 6;
  const B = 18;
  const L = 34;
  const top = Math.max(1, ...d.ratioSeries.map((r) => r.ratio)) * 1.02;
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const slot = (W - L) / Math.max(8, d.ratioSeries.length);
  const tone = (r: number) =>
    r < cuts.low ? 'fill-emerald-500' : r < cuts.mid ? 'fill-slate-400' : r < cuts.high ? 'fill-amber-500' : 'fill-rose-500';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="분기별 전세가율">
      {[cuts.low, cuts.mid, cuts.high].map((c) => (
        <g key={c}>
          <line x1={L} x2={W} y1={y(c)} y2={y(c)} className="stroke-slate-700" strokeDasharray="3 3" strokeWidth={1} />
          <text x={L - 4} y={y(c) + 3} textAnchor="end" className="fill-slate-400 text-2xs tabular-nums">
            {Math.round(c * 100)}%
          </text>
        </g>
      ))}
      {d.ratioSeries.map((r, i) => {
        const bx = L + i * slot + slot * 0.2;
        return (
          <g key={r.q} opacity={r.thin ? 0.35 : 1}>
            <rect x={bx} y={y(r.ratio)} width={slot * 0.6} height={y(0) - y(r.ratio)} rx={2} className={tone(r.ratio)}>
              <title>{`${quarterLabel(r.q)} · ${percent(r.ratio, 0)}${r.thin ? ' · 표본 3건 미만' : ''}`}</title>
            </rect>
            <text x={bx + slot * 0.3} y={y(r.ratio) - 3} textAnchor="middle" className="fill-slate-300 text-2xs tabular-nums">
              {Math.round(r.ratio * 100)}
            </text>
            <text x={bx + slot * 0.3} y={H - 5} textAnchor="middle" className="fill-slate-400 text-2xs tabular-nums">
              {quarterLabel(r.q).slice(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function SizeTable({ detail: d, onArea }: { detail: ComplexDetail; onArea: (a: number) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs text-slate-400">
            <th className="py-2 pr-2 font-medium">전용</th>
            <th className="py-2 pr-2 text-right font-medium">매매 최근1년</th>
            <th className="py-2 pr-2 text-right font-medium">전세 2년</th>
            <th className="py-2 pr-2 text-right font-medium">월세</th>
            <th className="py-2 pr-2 text-right font-medium">전세가율</th>
            <th className="py-2 pr-2 text-right font-medium">갱신</th>
            <th className="py-2 text-right font-medium">마지막</th>
          </tr>
        </thead>
        <tbody>
          {d.sizes.map((s) => (
            <tr
              key={s.area}
              className={`border-b border-slate-900 tabular-nums ${s.area === d.area ? 'bg-sky-500/10' : ''}`}
            >
              <td className="py-2 pr-2">
                <button type="button" onClick={() => onArea(s.area)} className="text-left text-slate-200 hover:text-sky-300">
                  {s.area}㎡
                </button>
                <div className="text-xs text-slate-400">
                  {toPyeong(s.area).toFixed(1)}평 · 공급 약 {Math.round(toSupplyPyeong(s.area))}평
                </div>
              </td>
              <td className="py-2 pr-2 text-right text-slate-300">{s.sale ? `${money(s.sale.price)} (${s.sale.n})` : '—'}</td>
              <td className="py-2 pr-2 text-right text-slate-300">{s.jeonse ? `${money(s.jeonse.deposit)} (${s.jeonse.n})` : '—'}</td>
              <td className="py-2 pr-2 text-right text-slate-300">
                {s.wolse ? `${money(s.wolse.deposit)} / ${money(s.wolse.rent)} (${s.wolse.n})` : '—'}
              </td>
              <td className="py-2 pr-2 text-right text-slate-300">{s.ratio == null ? '—' : percent(s.ratio, 0)}</td>
              <td className="py-2 pr-2 text-right text-slate-400">{s.renewalShare == null ? '—' : percent(s.renewalShare, 0)}</td>
              <td className="py-2 text-right text-slate-400">{ymLabel(s.lastYm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentTable({ detail: d }: { detail: ComplexDetail }) {
  return (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="border-b border-slate-800 text-left text-xs text-slate-400">
          <th className="py-2 pr-2 font-medium">분기</th>
          <th className="py-2 pr-2 text-right font-medium">매매 중위 (건)</th>
          <th className="py-2 text-right font-medium">전세 중위 (건)</th>
        </tr>
      </thead>
      <tbody>
        {[...d.recentQuarters].reverse().map((r) => (
          <tr key={r.q} className="border-b border-slate-900">
            <td className="py-2 pr-2 text-slate-300">
              {r.label}
              {r.salePartial && <span className="ml-1 text-xs text-slate-400">매매는 수집 도중</span>}
            </td>
            <td className={`py-2 pr-2 text-right ${r.sale && r.sale.n < 3 ? 'text-slate-400' : 'text-slate-200'}`}>
              {r.sale ? `${money(r.sale.price)} (${r.sale.n})` : '—'}
            </td>
            <td className={`py-2 text-right ${r.jeonse && r.jeonse.n < 3 ? 'text-slate-400' : 'text-slate-200'}`}>
              {r.jeonse ? `${money(r.jeonse.deposit)} (${r.jeonse.n})` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MaturityTimeline({ items }: { items: MaturityItem[] }) {
  if (!items.length) return <p className="text-xs text-slate-400">6개월 안 만기 없음 — 감시 목록에 있는 줄이지만 곧 끝나는 계약이 신고돼 있지 않습니다.</p>;
  const W = 600;
  const H = 70;
  const L = 10;
  const R = 10;
  const months = 7; // 이번 달 ~ +6개월
  const x = (gap: number) => L + (Math.min(Math.max(gap, 0), months - 1) / (months - 1)) * (W - L - R);
  // 같은 달에 여럿이면 위로 쌓습니다.
  const stack = new Map<number, number>();
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="전세 만기 타임라인">
        <line x1={L} x2={W - R} y1={H - 22} y2={H - 22} className="stroke-slate-700" strokeWidth={1} />
        {Array.from({ length: months }, (_, g) => (
          <text key={g} x={x(g)} y={H - 6} textAnchor="middle" className="fill-slate-400 text-2xs">
            {g === 0 ? '이번 달' : `+${g}개월`}
          </text>
        ))}
        {items.map((u, i) => {
          const k = Math.round(u.gap);
          const level = stack.get(k) ?? 0;
          stack.set(k, level + 1);
          return (
            <circle
              key={i}
              cx={x(u.gap)}
              cy={H - 30 - level * 11}
              r={4.5}
              className={u.locked ? 'fill-amber-400' : 'fill-slate-950 stroke-amber-400'}
              strokeWidth={1.5}
            >
              <title>{`${u.end} 만기 · ${u.floor}층 · ${money(u.dep)}${u.locked ? ' · 갱신 끝남' : ''}`}</title>
            </circle>
          );
        })}
      </svg>
      <ul className="mt-1 space-y-0.5 text-sm tabular-nums text-slate-300">
        {items.map((u, i) => (
          <li key={i}>
            <span className={u.locked ? 'text-amber-300' : 'text-slate-300'}>{u.end.replace('-', '.')} 만기</span> · {u.floor}층 ·{' '}
            {u.type} {money(u.dep)}
            {u.locked && ' · 갱신 끝남 — 또 갱신할 권리 없음'}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-slate-400">동·호수가 없어 층까지만 압니다. 같은 층·같은 만기 두 줄은 두 세대인지 중복 신고인지 가릴 수 없습니다.</p>
    </div>
  );
}
