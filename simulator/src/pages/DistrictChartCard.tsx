import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge, Card, Foldable, InfoPopover, SegmentedControl } from '../components/ui';
import {
  CHART_PERIODS,
  DISTRICT_CHART_CAVEATS,
  DISTRICT_CHART_MIN,
  DISTRICT_OPTIONS,
  MAX_DISTRICTS,
  MA_QUARTERS,
  axisLength,
  chartRows,
  districtSeries,
  panWindow,
  periodWindow,
  windowChange,
  zoomWindow,
  type ChartMetric,
  type ChartPeriod,
  type ChartRow,
  type DistrictSeries,
} from '../engine/districtChart';
import { money, percent } from '../engine/format';
import { MARKET } from '../engine/market';
import { DISTRICT_CHART_EVENT, takePendingDistrict as takePending } from './districtChartLink';

/**
 * 구별 매매 차트 — 실거래 수익률 탭, 시장 온도 바로 아래.
 *
 * Hedge Fund 앱의 기술적 분석 차트(recharts · 같은 syncId 로 위아래 차트에 같은 세로선 ·
 * 이동평균 · 로그 축)와 Investment Navigator 의 기간 버튼(2년 · 3년 · 5년 · 전체)을
 * 같은 느낌으로 옮겼습니다. 계산은 전부 `engine/districtChart.ts` 에 있고 여기는 그리기만 합니다.
 *
 * 시장 온도·동네 시세판의 구 이름에서 `openDistrictChart(code)` 로 그 구가 선택된 채 열립니다.
 */


const STORE_KEY = 'district-chart-v1';
const DEFAULT_CODES = ['48127', '48125', '48123'];
const COLORS = ['#38bdf8', '#fbbf24', '#34d399', '#fb7185', '#a78bfa', '#fb923c'];
const AXIS = { fill: '#94a3b8', fontSize: 12 };
const GRID = '#1e293b';
const SYNC = 'district-chart';
/** Y축 폭 — 휠 확대의 초점 분기를 마우스 위치로 셈할 때도 씁니다 */
const Y_W = 64;
const MARGIN = { top: 8, right: 12, left: 0, bottom: 0 };

interface Saved {
  codes: string[];
  metric: ChartMetric;
  normalize: boolean;
  ma: boolean;
  log: boolean;
}

function readSaved(): Saved {
  const fallback: Saved = { codes: DEFAULT_CODES, metric: 'perSqm', normalize: false, ma: true, log: false };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<Saved>;
    const codes = (v.codes ?? []).filter((c) => DISTRICT_OPTIONS.some((d) => d.code === c)).slice(0, MAX_DISTRICTS);
    return {
      codes: codes.length ? codes : fallback.codes,
      metric: v.metric === 'index' ? 'index' : 'perSqm',
      normalize: !!v.normalize,
      ma: v.ma ?? true,
      log: !!v.log,
    };
  } catch {
    return fallback;
  }
}

const signed = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${percent(Math.abs(v), d)}`;
const signClass = (v: number) => (v > 0 ? 'text-teal-300' : v < 0 ? 'text-rose-300' : 'text-slate-300');

function Chip({ on, onClick, children, title, color }: { on: boolean; onClick: () => void; children: ReactNode; title?: string; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition ${
        on ? 'border-sky-500/70 bg-sky-500/20 text-sky-100' : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
      }`}
    >
      {color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: on ? color : 'transparent', border: `1.5px solid ${color}` }} />}
      {children}
    </button>
  );
}

export function DistrictChartCard() {
  const [initial] = useState(() => {
    const saved = readSaved();
    const p = takePending();
    return { saved: p ? { ...saved, codes: [p] } : saved, jumped: !!p };
  });
  const [codes, setCodes] = useState<string[]>(initial.saved.codes);
  const [metric, setMetric] = useState<ChartMetric>(initial.saved.metric);
  const [normalize, setNormalize] = useState(initial.saved.normalize);
  const [showMa, setShowMa] = useState(initial.saved.ma);
  const [log, setLog] = useState(initial.saved.log);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<ChartPeriod | 'custom'>('all');
  const [win, setWin] = useState<[number, number] | null>(null);
  const [jump, setJump] = useState(initial.jumped ? 1 : 0);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ codes, metric, normalize, ma: showMa, log }));
    } catch {
      // 저장이 막혀 있으면 다음에 기본값으로 열릴 뿐입니다.
    }
  }, [codes, metric, normalize, showMa, log]);

  // 다른 화면의 구 이름에서 넘어오면 — 그 구 하나만 고른 채 카드로 내려갑니다
  useEffect(() => {
    const on = () => {
      const c = takePending();
      if (!c) return;
      setCodes([c]);
      setHidden(new Set());
      setJump((n) => n + 1);
    };
    window.addEventListener(DISTRICT_CHART_EVENT, on);
    return () => window.removeEventListener(DISTRICT_CHART_EVENT, on);
  }, []);
  useEffect(() => {
    if (!jump) return;
    const t = window.setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    return () => window.clearTimeout(t);
  }, [jump]);

  const series = useMemo(
    () => codes.map((c) => districtSeries(c)).filter((s): s is DistrictSeries => s != null),
    [codes]
  );
  const colorOf = (code: string) => COLORS[codes.indexOf(code) % COLORS.length];
  const total = axisLength(series);
  const view: [number, number] = useMemo(() => {
    if (win && win[1] < total) return win;
    return periodWindow(period === 'custom' ? 'all' : period, total);
  }, [win, period, total]);

  const rows = useMemo(
    () => chartRows(series, { metric, window: view, normalize }),
    [series, metric, view, normalize]
  );
  const overview = useMemo(
    () => chartRows(series, { metric, window: [0, Math.max(0, total - 1)], normalize: false }),
    [series, metric, total]
  );
  const visible = series.filter((s) => !hidden.has(s.code));

  const setWindow = (w: [number, number]) => {
    setWin(w);
    setPeriod('custom');
  };
  const pickPeriod = (p: ChartPeriod) => {
    setPeriod(p);
    setWin(periodWindow(p, total));
  };

  /* ── 휠 확대 · 끌어 이동 ──────────────────────────────────────────── */
  const plotRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const totalRef = useRef(total);
  totalRef.current = total;
  const [hoverY, setHoverY] = useState<number | null>(null);
  const drag = useRef<{ x: number; win: [number, number]; moved: boolean } | null>(null);

  const plotWidth = () => {
    const el = plotRef.current;
    return el ? Math.max(1, el.clientWidth - Y_W - MARGIN.right) : 1;
  };

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      const [s, en] = viewRef.current;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left - Y_W) / plotWidth()));
      const focus = Math.round(s + ratio * (en - s));
      const next = zoomWindow([s, en], focus, e.deltaY > 0 ? 1.25 : 0.8, totalRef.current);
      setWin(next);
      setPeriod('custom');
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [series.length]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, win: view, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    setHoverY(y > MARGIN.top && y < rect.height - 28 ? y : null);
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 4) return;
    if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId);
    d.moved = true;
    const perQ = plotWidth() / Math.max(1, d.win[1] - d.win[0]);
    setWindow(panWindow(d.win, -dx / perQ, total));
  };
  const endDrag = () => {
    drag.current = null;
  };

  /* ── 표기 ─────────────────────────────────────────────────────────── */
  const isRelative = normalize || metric === 'index';
  const fmtValue = (v: number) => (isRelative ? v.toFixed(1) : money(v));
  const fmtAxis = (v: number) => (isRelative ? String(Math.round(v)) : money(v));
  const metricLabel = metric === 'perSqm' ? '㎡당 중위가' : '연쇄 지수';
  const thinRule =
    metric === 'perSqm'
      ? `그 분기 거래 ${DISTRICT_CHART_MIN.deals}건 미만`
      : `지수를 이은 칸 ${DISTRICT_CHART_MIN.links}개 미만`;

  const toggleCode = (code: string) => {
    setCodes((cur) => {
      if (cur.includes(code)) return cur.length > 1 ? cur.filter((c) => c !== code) : cur;
      if (cur.length >= MAX_DISTRICTS) return cur;
      return [...cur, code];
    });
    setHidden((h) => {
      const n = new Set(h);
      n.delete(code);
      return n;
    });
  };

  const groups = ['창원', '부산', '경기'];
  const first = rows[0]?.label ?? '';
  const last = rows[rows.length - 1]?.label ?? '';

  const tooltip = ({ active, payload }: { active?: boolean; payload?: readonly { payload?: unknown }[] }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as ChartRow | undefined;
    if (!row) return null;
    return (
      <div className="min-w-[14rem] rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs tabular-nums text-slate-200 shadow-xl">
        <div className="mb-1 font-semibold text-slate-100">{row.label}</div>
        {visible.map((s) => {
          const v = row[`v_${s.code}`] as number | null;
          const raw = row[`raw_${s.code}`] as number | null;
          const ma = row[`ma_${s.code}`] as number | null;
          const n = row[`n_${s.code}`] as number;
          const thin = row[`thin_${s.code}`] as boolean;
          const links = row[`links_${s.code}`] as number | null;
          return (
            <div key={s.code} className="mt-1 border-t border-slate-800 pt-1 first:mt-0 first:border-0 first:pt-0">
              <div className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: colorOf(s.code) }} />
                  {s.short}
                </span>
                <span className="font-semibold">{v == null ? '거래 없음' : fmtValue(v)}</span>
              </div>
              {v != null && normalize && raw != null && (
                <div className="flex justify-between gap-4 text-slate-400">
                  <span>정규화 전</span>
                  <span>{metric === 'perSqm' ? `${money(raw)}/㎡` : raw.toFixed(1)}</span>
                </div>
              )}
              {v != null && metric === 'perSqm' && !normalize && (
                <div className="flex justify-between gap-4 text-slate-400">
                  <span>전용 평당</span>
                  <span>{money(v * 3.3058)}</span>
                </div>
              )}
              {showMa && ma != null && (
                <div className="flex justify-between gap-4 text-slate-400">
                  <span>{MA_QUARTERS}분기 이동평균</span>
                  <span>{fmtValue(ma)}</span>
                </div>
              )}
              <div className="flex justify-between gap-4 text-slate-400">
                <span>거래</span>
                <span>
                  {n.toLocaleString('ko-KR')}건{metric === 'index' && links != null ? ` · 이은 칸 ${links}` : ''}
                </span>
              </div>
              {thin && <div className="text-amber-300">표본 얇음 — {thinRule}</div>}
            </div>
          );
        })}
      </div>
    );
  };

  const thinDot = (code: string) => (props: { cx?: number; cy?: number; payload?: ChartRow; index?: number }) => {
    const { cx, cy, payload, index } = props;
    if (cx == null || cy == null || !payload?.[`thin_${code}`] || payload[`v_${code}`] == null)
      return <g key={`d-${code}-${index}`} />;
    return <circle key={`d-${code}-${index}`} cx={cx} cy={cy} r={3.5} fill="#0f172a" stroke={colorOf(code)} strokeWidth={1.5} />;
  };

  return (
    <div ref={cardRef} style={{ scrollMarginTop: 'calc(var(--header-h, 120px) + 12px)' }}>
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            구별 매매 차트{' '}
            <span className="text-xs font-normal text-slate-400">분기 실거래 · 수집 {DISTRICT_OPTIONS.length}개 시군구</span>
          </span>
        }
        subtitle="시장 온도의 한 칸이 긴 흐름의 어디쯤인지 봅니다. 구를 여러 개 골라 겹치고, 휠로 확대 · 끌어서 이동 · 두 번 눌러 전체로 돌아갑니다."
        action={<Badge tone="neutral">매매 {MARKET.asOf} 수집 · {last} 까지</Badge>}
      >
        {/* 구 고르기 — 권역별 */}
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g} className="flex flex-wrap items-center gap-1.5">
              <span className="w-10 shrink-0 text-xs text-slate-400">{g}</span>
              {DISTRICT_OPTIONS.filter((d) => d.group === g).map((d) => {
                const on = codes.includes(d.code);
                return (
                  <Chip
                    key={d.code}
                    on={on}
                    color={on ? colorOf(d.code) : '#475569'}
                    onClick={() => toggleCode(d.code)}
                    title={!on && codes.length >= MAX_DISTRICTS ? `한 번에 ${MAX_DISTRICTS}개까지 겹칩니다` : d.label}
                  >
                    {d.short}
                  </Chip>
                );
              })}
            </div>
          ))}
        </div>

        {/* 지표 · 기간 · 보기 옵션 */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <SegmentedControl<ChartMetric>
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'perSqm', label: '㎡당 중위가' },
              { value: 'index', label: '연쇄 지수' },
            ]}
          />
          <InfoPopover icon="ƒ" label={`${metricLabel} — 계산`} align="left">
            <span className="block text-sm leading-relaxed text-slate-300">
              {metric === 'perSqm'
                ? '분기마다 칸(단지·평형)의 분기 중위가 ÷ 전용면적 을 거래 건수로 가중한 중위. 그 분기에 팔린 집의 구성이 섞입니다.'
                : '같은 칸끼리 직전 분기 대비 가격비의 중위를 곱해 이은 값(2016Q1 = 100). 구성 변화는 막지만 곱셈을 이어 가며 위로 치우칩니다 — 연 환산을 기대수익률로 쓰지 마세요.'}
            </span>
          </InfoPopover>
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950/50 p-0.5" role="group" aria-label="기간">
            {CHART_PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => pickPeriod(p.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium tabular-nums transition ${
                  period === p.key ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip on={normalize} onClick={() => setNormalize((v) => !v)} title="보이는 창의 첫 분기를 100 으로 — 수준이 다른 구의 흐름만 견줍니다">
              시작 = 100
            </Chip>
            <Chip on={showMa} onClick={() => setShowMa((v) => !v)} title={`직전 ${MA_QUARTERS}분기 단순 평균 (점선)`}>
              {MA_QUARTERS}분기 이동평균
            </Chip>
            <Chip on={log} onClick={() => setLog((v) => !v)} title="같은 % 변화가 같은 높이로 — 오래 보거나 수준이 다른 구를 겹칠 때">
              로그 축
            </Chip>
          </div>
          <span className="text-xs text-slate-400 tabular-nums">
            {first} ~ {last} · {rows.length}분기
          </span>
        </div>

        {series.length > 1 && metric === 'perSqm' && !normalize && (
          <p className="mt-2 text-xs text-amber-300">
            구마다 집의 연식·크기 구성이 달라 ㎡당 가격 수준을 그대로 견주면 동네가 아니라 재고를 비교하게 됩니다 — 흐름만 보려면 "시작 = 100" 을 켜세요.
          </p>
        )}

        {/* 범례 — 누르면 숨김 · 창 안 변화 */}
        <div className="mt-4 flex flex-wrap gap-2">
          {series.map((s) => {
            const ch = windowChange(s.quarters, metric, view);
            const off = hidden.has(s.code);
            return (
              <button
                key={s.code}
                type="button"
                onClick={() =>
                  setHidden((h) => {
                    const n = new Set(h);
                    if (n.has(s.code)) n.delete(s.code);
                    else n.add(s.code);
                    return n;
                  })
                }
                title={off ? '다시 보이기' : '이 선 숨기기'}
                className={`rounded-lg border px-3 py-2 text-left tabular-nums transition ${
                  off ? 'border-slate-800 opacity-50' : 'border-slate-700 bg-slate-950/40 hover:border-slate-500'
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm text-slate-100">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(s.code) }} />
                  {s.label}
                </span>
                {ch ? (
                  <span className="mt-0.5 block text-xs text-slate-400">
                    {metric === 'perSqm' ? `${money(ch.to.v)}/㎡` : ch.to.v.toFixed(1)}{' '}
                    <span className={signClass(ch.change)}>{signed(ch.change)}</span>
                    {ch.cagr != null && <> · 연 {signed(ch.cagr)}</>}
                    {metric === 'index' && ' (드리프트 포함)'}
                  </span>
                ) : (
                  <span className="mt-0.5 block text-xs text-slate-400">창 안 값이 모자람</span>
                )}
              </button>
            );
          })}
        </div>

        {/* 본 차트 + 거래량 — 같은 syncId 라 한 곳에 올리면 두 차트에 같은 분기 세로선이 뜹니다 */}
        <div
          ref={plotRef}
          className="relative mt-4 h-[340px] cursor-grab [&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none touch-pan-y select-none active:cursor-grabbing xl:h-[420px] 2xl:h-[480px]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => {
            setHoverY(null);
            endDrag();
          }}
          onDoubleClick={() => pickPeriod('all')}
        >
          {hoverY != null && (
            <div
              className="pointer-events-none absolute border-t border-dashed border-slate-500/60"
              style={{ top: hoverY, left: Y_W, right: MARGIN.right }}
            />
          )}
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} syncId={SYNC} margin={MARGIN}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} minTickGap={28} height={28} />
              <YAxis
                width={Y_W}
                tick={AXIS}
                tickFormatter={fmtAxis}
                scale={log ? 'log' : 'auto'}
                domain={['auto', 'auto']}
                allowDataOverflow={false}
              />
              {isRelative && <ReferenceLine y={100} stroke="#475569" strokeDasharray="4 3" />}
              <Tooltip
                content={tooltip}
                isAnimationActive={false}
                cursor={{ stroke: '#94a3b8', strokeOpacity: 0.5, strokeDasharray: '3 3' }}
                wrapperStyle={{ zIndex: 20 }}
              />
              {visible.map((s) => (
                <Line
                  key={s.code}
                  type="linear"
                  dataKey={`v_${s.code}`}
                  stroke={colorOf(s.code)}
                  strokeWidth={2}
                  dot={thinDot(s.code)}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
              {showMa &&
                visible.map((s) => (
                  <Line
                    key={`ma-${s.code}`}
                    type="monotone"
                    dataKey={`ma_${s.code}`}
                    stroke={colorOf(s.code)}
                    strokeOpacity={0.55}
                    strokeWidth={1.4}
                    strokeDasharray="5 4"
                    dot={false}
                    activeDot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="relative mt-1 h-[110px] xl:h-[130px] [&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none">
          <span className="pointer-events-none absolute top-0 z-10 text-2xs text-slate-400" style={{ left: Y_W + 6 }}>
            분기 거래 건수
          </span>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} syncId={SYNC} margin={MARGIN} barGap={0} barCategoryGap="18%">
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" hide />
              <YAxis
                width={Y_W}
                tick={AXIS}
                tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}천` : String(v))}
              />
              <Tooltip content={() => null} cursor={{ fill: '#94a3b8', fillOpacity: 0.08 }} isAnimationActive={false} />
              {visible.map((s) => (
                <Bar key={s.code} dataKey={`n_${s.code}`} fill={colorOf(s.code)} fillOpacity={0.55} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 내비게이터 — 전체 구간 위에서 보이는 창을 끌어 옮깁니다 */}
        {overview.length > 1 && (
          <div className="mt-2 h-[58px] [&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={overview} margin={{ top: 0, right: MARGIN.right, left: Y_W, bottom: 0 }}>
                <XAxis dataKey="label" hide />
                <Brush
                  dataKey="label"
                  height={52}
                  y={2}
                  stroke="#38bdf8"
                  fill="#0f172a"
                  travellerWidth={10}
                  startIndex={view[0]}
                  endIndex={view[1]}
                  tickFormatter={() => ''}
                  onChange={(r: { startIndex?: number; endIndex?: number }) => {
                    if (r.startIndex == null || r.endIndex == null) return;
                    if (r.startIndex === view[0] && r.endIndex === view[1]) return;
                    setWindow([r.startIndex, Math.max(r.endIndex, r.startIndex + 1)]);
                  }}
                >
                  <LineChart data={overview}>
                    {series.map((s) => (
                      <Line
                        key={s.code}
                        dataKey={`v_${s.code}`}
                        stroke={colorOf(s.code)}
                        strokeOpacity={0.7}
                        strokeWidth={1}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </Brush>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        <p className="mt-2 text-2xs text-slate-400">
          실선 = {metricLabel}
          {normalize ? ' (보이는 창 첫 분기 = 100)' : metric === 'index' ? ' (2016Q1 = 100)' : ''} · 점선 = {MA_QUARTERS}분기 이동평균 · 속 빈 점 = 표본 얇음({thinRule}) · 아래 막대 = 분기 거래 건수
        </p>

        <Foldable summary="이 자료가 못 하는 것" count={DISTRICT_CHART_CAVEATS.length}>
          <ul className="list-disc space-y-1 pl-5">
            {DISTRICT_CHART_CAVEATS.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Foldable>
      </Card>
    </div>
  );
}
