import { useMemo, type ReactNode } from 'react';
import { Badge, Card, Foldable, InfoPopover } from '../components/ui';
import { percent } from '../engine/format';
import { MARKET } from '../engine/market';
import { TEMPERATURE_CAVEATS, districtTemperature, qLabel, type SaleTemperature } from '../engine/temperature';
import { RENT_REGIONS } from '../rentfinder/data';
import { SAFETY_RULES } from '../rentfinder/safety';
import { TOWN_CAVEATS, jeonseTemperature, rentQLabel, type JeonseTemperature } from '../rentfinder/town';

/**
 * 시장 온도 — **"지금 전세로 버티나, 매수 쪽으로 기우나" 의 방향만.**
 *
 * 줄은 시군구, 열은 실거래로 잴 수 있는 축입니다. 줄 합계·종합 온도는 없습니다 —
 * 거래량 ↓ 와 전세가율 ↑ 는 해야 할 일이 반대인데 한 숫자로 합치면 둘 다 지워집니다.
 */

interface Line {
  code: string;
  label: string;
  group: string;
  sale: SaleTemperature | null;
  jeonse: JeonseTemperature | null;
}

const CUTS = SAFETY_RULES.ratioCuts;
const RENT_CODES = new Set(RENT_REGIONS.map((r) => r.code));

const signClass = (v: number) => (v > 0 ? 'text-teal-300' : v < 0 ? 'text-rose-300' : 'text-slate-300');
const signed = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${percent(Math.abs(v), d)}`;
function ratioClass(v: number): string {
  if (v < CUTS.low) return 'text-emerald-300';
  if (v < CUTS.mid) return 'text-slate-200';
  if (v < CUTS.high) return 'text-amber-300';
  return 'text-rose-300';
}

/** 작은 막대 스파크 — 값이 없는 칸은 비워 둡니다 */
function Spark({ values, tone = 'fill-sky-400/70', cuts }: { values: (number | null)[]; tone?: string; cuts?: number[] }) {
  const w = 60;
  const h = 18;
  const nums = values.filter((v): v is number => v != null);
  if (!nums.length) return <span className="inline-block h-[18px] w-[60px]" />;
  const lo = cuts ? Math.min(...nums, ...cuts) * 0.95 : 0;
  const hi = Math.max(...nums, ...(cuts ?? [])) || 1;
  const bw = w / values.length;
  const y = (v: number) => h - ((v - lo) / Math.max(1e-9, hi - lo)) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="inline-block h-[18px] w-[60px] align-middle" aria-hidden>
      {cuts?.map((c) => (
        <line key={c} x1={0} x2={w} y1={y(c)} y2={y(c)} className="stroke-slate-600" strokeWidth={0.4} strokeDasharray="1 1" />
      ))}
      {values.map((v, i) =>
        v == null ? (
          <rect key={i} x={i * bw + 0.4} y={h - 1} width={bw - 0.8} height={1} className="fill-slate-700" />
        ) : (
          <rect key={i} x={i * bw + 0.4} y={y(v)} width={bw - 0.8} height={Math.max(0.6, h - y(v))} className={tone} />
        )
      )}
    </svg>
  );
}

const N = ({ children }: { children: ReactNode }) => <span className="ml-1 text-2xs text-slate-400">({children})</span>;
const Dash = ({ why }: { why: string }) => (
  <span className="text-slate-500" title={why}>
    —
  </span>
);

function shortLabel(label: string): string {
  return label.replace(/^창원시 /, '').replace(/^(부산|경기) /, '');
}

export function TemperatureCard() {
  const lines = useMemo<Line[]>(() => {
    const out: Line[] = [];
    for (const r of MARKET.regions) {
      const group = r.region === 'changwon' ? '창원' : r.region === 'busan' ? '부산' : '경기';
      out.push({
        code: r.code,
        label: shortLabel(r.label),
        group,
        sale: districtTemperature(r.code),
        jeonse: RENT_CODES.has(r.code) ? jeonseTemperature([r.code]) : null,
      });
    }
    // 함안·의령 — 매매 스냅샷 밖이라 전세 축만 (참고)
    for (const r of RENT_REGIONS) {
      if (out.some((l) => l.code === r.code)) continue;
      out.push({ code: r.code, label: r.short, group: '함안·의령 (참고)', sale: null, jeonse: jeonseTemperature([r.code]) });
    }
    const order = ['창원', '함안·의령 (참고)', '부산', '경기'];
    return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  }, []);

  const saleWin = lines.find((l) => l.sale)?.sale?.window.label ?? '';
  const rentWin = lines.find((l) => l.jeonse)?.jeonse?.window ?? '';
  const rentCaveats = TOWN_CAVEATS.filter((c) => c.includes('전세') || c.includes('월세'));

  const head = (label: string, formula: string) => (
    <th className="px-2.5 py-2.5 text-right font-medium whitespace-nowrap">
      <span className="inline-flex items-center gap-1">
        {label}
        <InfoPopover icon="ƒ" label={`${label} — 계산`}>
          <span className="block text-sm leading-relaxed text-slate-300">{formula}</span>
        </InfoPopover>
      </span>
    </th>
  );

  let lastGroup = '';
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          시장 온도 <span className="text-xs font-normal text-slate-400">축마다 따로 읽습니다 — 합친 점수는 없습니다</span>
        </span>
      }
      subtitle="실거래로 잴 수 있는 축만 나란히 둡니다. 색은 부호(＋청록 / −장미)와 전세가율 경계에만 칠합니다."
      action={<Badge tone="neutral">매매 {MARKET.asOf} 수집</Badge>}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm tabular-nums">
          <thead className="border-b border-slate-800 text-xs text-slate-400">
            <tr>
              <th className="px-2.5 py-2.5 text-left font-medium">시군구</th>
              {head('매매 거래량', `최근 12분기 거래 수 막대 · 최근 4분기 ÷ 그 앞 4분기 − 1 (${saleWin}). 앞 창이 10건 미만이면 내지 않습니다. 마지막 완결 분기까지만 — 신고 지연으로 진행 중인 분기는 늘 적게 잡힙니다.`)}
              {head('매매 1년', '같은 칸(단지·평형)의 마지막 완결 분기 가격 ÷ 4분기 전 가격 → 칸들의 중위 − 1. 칸 5개 미만이면 내지 않습니다.')}
              {head('전세 1년', `같은 칸 전세 보증금 마지막 완결 분기 ÷ 4분기 전 → 중위 − 1 (${rentWin}). 전월세 스냅샷이 마산권뿐이라 부산·경기는 없습니다.`)}
              {head('전세가율', `분기마다 같은 칸의 (전세 분기 중위 ÷ 매매 분기 중위) 의 중위 · 8분기 막대. 짝지은 칸 8개 미만인 분기와 매매가 미완결인 분기는 비웁니다. 점선은 ${percent(CUTS.low, 0)}·${percent(CUTS.mid, 0)}·${percent(CUTS.high, 0)}.`)}
              {head('신축 비중', '최근 4분기 매매 거래 중 준공 5년 이내 단지 거래의 비중. 좋고 나쁨이 없는 값이라 색이 없습니다.')}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const groupRow = l.group !== lastGroup;
              lastGroup = l.group;
              const s = l.sale;
              const j = l.jeonse;
              const rl = j?.ratioLatest;
              return (
                <FragmentRows key={l.code} group={groupRow ? l.group : null}>
                  <tr className="border-b border-slate-800/60">
                    <td className="px-2.5 py-2 whitespace-nowrap text-slate-200">{l.label}</td>
                    <td className="px-2.5 py-2 text-right whitespace-nowrap">
                      {s ? (
                        <>
                          <Spark values={s.deals.series.map((p) => p.n)} />{' '}
                          {s.deals.change != null ? (
                            <span className={signClass(s.deals.change)}>{signed(s.deals.change, 0)}</span>
                          ) : (
                            <span className="text-slate-500">기준 적음</span>
                          )}
                          <N>
                            {s.deals.recent.toLocaleString('ko-KR')}/{s.deals.prior.toLocaleString('ko-KR')}
                          </N>
                        </>
                      ) : (
                        <span className="text-slate-500">매매 자료 없음</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 text-right">
                      {s?.price1y ? (
                        <span className={signClass(s.price1y.v)}>
                          {signed(s.price1y.v)}
                          <N>{s.price1y.cells}칸</N>
                        </span>
                      ) : (
                        <Dash why={s ? '짝지은 칸 5개 미만' : '매매 자료 없음'} />
                      )}
                    </td>
                    <td className="px-2.5 py-2 text-right">
                      {j ? (
                        j.jeonse1y ? (
                          <span className={signClass(j.jeonse1y.v)}>
                            {signed(j.jeonse1y.v)}
                            <N>{j.jeonse1y.cells}칸</N>
                          </span>
                        ) : (
                          <Dash why="짝지은 칸 5개 미만" />
                        )
                      ) : (
                        <span className="text-slate-500">자료 없음</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 text-right whitespace-nowrap">
                      {j ? (
                        <>
                          <Spark values={j.series.map((p) => p.ratio)} tone="fill-amber-400/60" cuts={[CUTS.low, CUTS.mid, CUTS.high]} />{' '}
                          {rl ? (
                            <span className={ratioClass(rl.v)} title={`${rentQLabel(rl.q)} 기준`}>
                              {percent(rl.v, 0)}
                              <N>{rl.cells}칸</N>
                            </span>
                          ) : (
                            <Dash why="짝지은 칸 8개 미만 — 표본 부족" />
                          )}
                        </>
                      ) : (
                        <span className="text-slate-500">자료 없음</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 text-right text-slate-300">
                      {s?.newShare ? (
                        <>
                          {percent(s.newShare.v, 0)}
                          <N>{s.newShare.deals.toLocaleString('ko-KR')}</N>
                        </>
                      ) : (
                        <Dash why="매매 자료 없음" />
                      )}
                    </td>
                  </tr>
                </FragmentRows>
              );
            })}
          </tbody>
        </table>
      </div>
      <Foldable summary="창 · 괄호 읽는 법" count={2}>
        <p>
          창 — 매매 {saleWin} · 전세 {rentWin}. 매매는 {MARKET.range.to} 수집이라 {qLabel(lines[0]?.sale?.window.recent[1] ?? 0, MARKET.quarterBaseYear)}{' '}
          까지가 마지막 완결 분기입니다.
        </p>
        <p className="mt-1">괄호 안은 거래 건수(최근/이전) 또는 짝지은 칸 수입니다.</p>
      </Foldable>
      <Foldable summary="이 자료가 못 하는 것" count={TEMPERATURE_CAVEATS.length + rentCaveats.length + 2}>
        <ul className="list-disc space-y-1 pl-5">
          <li>부동산원 매매수급·심리지수는 호가·설문이라 재현할 수 없어 넣지 않았습니다.</li>
          {TEMPERATURE_CAVEATS.map((c) => (
            <li key={c}>{c}</li>
          ))}
          {rentCaveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
          <li>금리 국면이 바뀌면 전세가율은 상수가 아닙니다 — 같은 70% 도 금리가 높을 때와 낮을 때 뜻이 다릅니다.</li>
        </ul>
      </Foldable>
    </Card>
  );
}

function FragmentRows({ group, children }: { group: string | null; children: ReactNode }) {
  return (
    <>
      {group && (
        <tr>
          <td colSpan={6} className="px-2.5 pt-4 pb-1 text-sm font-medium text-slate-300">
            {group}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}
