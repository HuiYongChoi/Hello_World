import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Badge, Card, Foldable, InfoPopover, SegmentedControl } from '../components/ui';
import { money, percent } from '../engine/format';
import { regionOf } from './data';
import { toPyeong, toSupplyPyeong } from './finder';
import { SAFETY_RULES } from './safety';
import { TOWN_CAVEATS, TOWN_MIN, TOWN_NEW_SINCE, townComplexes, townRows, type TownRow } from './town';

/**
 * 동네 시세판 — **"어느 동네에서 찾나"**.
 *
 * 전월세 찾기 ③ 발굴의 지역과 전세·월세 선택을 바꾸는 표입니다. 동마다 ㎡당 전세·매매,
 * 전세가율, 거래량·1년 변화, 신축 비중을 나란히 둡니다. **점수로 합치지 않습니다** —
 * 색은 규칙이 있는 칸(전세가율 경계·변화의 부호)에만 칠합니다.
 */

type Scope = 'masan' | 'changwon' | 'all';
const SCOPES: Record<Scope, { label: string; codes: string[] }> = {
  masan: { label: '마산회원·합포', codes: ['48127', '48125'] },
  changwon: { label: '창원 5구', codes: ['48127', '48125', '48121', '48123', '48129'] },
  all: { label: '+함안·의령', codes: ['48127', '48125', '48121', '48123', '48129', '48730', '48720'] },
};

type SortKey =
  | 'label'
  | 'complexes'
  | 'jeonseDeals2y'
  | 'wolseDeals2y'
  | 'jeonsePerSqm'
  | 'salePerSqm'
  | 'ratio'
  | 'jeonseDeals'
  | 'saleDeals'
  | 'salePrice1y'
  | 'jeonse1y'
  | 'newShare';

const GET: Record<Exclude<SortKey, 'label'>, (r: TownRow) => number | null> = {
  complexes: (r) => r.complexes,
  jeonseDeals2y: (r) => r.jeonseDeals2y,
  wolseDeals2y: (r) => r.wolseDeals2y,
  jeonsePerSqm: (r) => r.jeonsePerSqm?.v ?? null,
  salePerSqm: (r) => r.salePerSqm?.v ?? null,
  ratio: (r) => r.ratio?.v ?? null,
  jeonseDeals: (r) => r.jeonseDealsChange.change,
  saleDeals: (r) => r.saleDealsChange.change,
  salePrice1y: (r) => r.salePrice1y?.v ?? null,
  jeonse1y: (r) => r.jeonse1y?.v ?? null,
  newShare: (r) => r.newShare?.v ?? null,
};

const CUTS = SAFETY_RULES.ratioCuts;

/** 전세가율 4단 — 룰셋의 60·70·80 경계 */
function ratioClass(v: number): string {
  if (v < CUTS.low) return 'text-emerald-300';
  if (v < CUTS.mid) return 'text-slate-200';
  if (v < CUTS.high) return 'text-amber-300';
  return 'text-rose-300';
}

const signClass = (v: number) => (v > 0 ? 'text-teal-300' : v < 0 ? 'text-rose-300' : 'text-slate-300');
const signed = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${percent(Math.abs(v), d)}`;

const Dash = ({ why }: { why: string }) => (
  <span className="text-slate-500" title={why}>
    —
  </span>
);
const N = ({ children }: { children: ReactNode }) => <span className="ml-1 text-2xs text-slate-400">({children})</span>;

export function TownBoardPage({
  onOpenComplex,
  onDiscover,
}: {
  onOpenComplex?: (cx: string, area?: number) => void;
  onDiscover?: (regionCode: string) => void;
}) {
  const [scope, setScope] = useState<Scope>('masan');
  const [level, setLevel] = useState<'umd' | 'sgg'>('umd');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'jeonseDeals2y', dir: -1 });
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => townRows({ regionCodes: SCOPES[scope].codes, level }), [scope, level]);
  const sorted = useMemo(() => {
    if (sort.key === 'label') return [...rows].sort((a, b) => sort.dir * a.label.localeCompare(b.label, 'ko'));
    const get = GET[sort.key];
    // 값이 없는 줄은 방향과 무관하게 늘 아래 — "—" 가 1등으로 올라오면 안 됩니다.
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return sort.dir * (x - y);
    });
  }, [rows, sort]);

  const windows = rows[0]?.windows;
  const multiRegion = SCOPES[scope].codes.length > 2 && level === 'umd';

  const head = (key: SortKey, label: string, formula?: string) => (
    <th className="px-2.5 py-2.5 text-right font-medium whitespace-nowrap first:text-left">
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === 'label' ? 1 : -1 }))}
          className={`hover:text-slate-200 ${sort.key === key ? 'text-sky-300' : ''}`}
        >
          {label}
          {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
        </button>
        {formula && (
          <InfoPopover icon="ƒ" label={`${label} — 계산`}>
            <span className="block text-sm leading-relaxed text-slate-300">{formula}</span>
          </InfoPopover>
        )}
      </span>
    </th>
  );

  return (
    <div className="space-y-6">
      <Card
        title="동네 시세판"
        subtitle="동마다 ㎡당 전세·매매, 전세가율, 거래량·1년 변화, 신축 비중을 나란히 둡니다. 합친 점수는 없습니다 — 열 제목을 누르면 그 기준으로 정렬됩니다."
        action={windows && <Badge tone="neutral">매매 {windows.sale.split(' 대 ')[0]} · 전세 {windows.rent.split(' 대 ')[0]}</Badge>}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SegmentedControl
            value={scope}
            onChange={(v) => {
              setScope(v);
              setOpen(null);
            }}
            options={(Object.keys(SCOPES) as Scope[]).map((k) => ({ value: k, label: SCOPES[k].label }))}
          />
          <SegmentedControl
            value={level}
            onChange={(v) => {
              setLevel(v);
              setOpen(null);
            }}
            options={[
              { value: 'umd', label: '동' },
              { value: 'sgg', label: '구' },
            ]}
          />
          <span className="text-sm text-slate-400">{rows.length}줄 · 동을 누르면 단지가 펼쳐집니다</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-sm tabular-nums">
            <thead className="border-b border-slate-800 text-xs text-slate-400">
              <tr>
                {head('label', level === 'umd' ? '동' : '구')}
                {head('complexes', '단지', '전월세·매매 두 스냅샷 단지의 합집합')}
                {head('jeonseDeals2y', '전세 2년', '전월세 스냅샷 2년(2024Q4~) 전세 거래 수')}
                {head('wolseDeals2y', '월세 2년', '같은 기간 월세 거래 수 — 월세는 2년 중위뿐이라 추이가 없습니다')}
                {head('jeonsePerSqm', '㎡당 전세', `전세 창(${windows?.rent.split(' 대 ')[0] ?? ''}) 분기 중위 보증금 ÷ 전용면적 을 거래 건수로 가중한 중위. 동마다 평형 구성이 달라 보증금을 그대로 견주지 않습니다.`)}
                {head('salePerSqm', '㎡당 매매', `매매 창(${windows?.sale.split(' 대 ')[0] ?? ''}) 분기 중위가 ÷ 전용면적 을 거래 건수로 가중한 중위.`)}
                {head('ratio', '전세가율', `칸(단지·평형)마다 전세 창 전세 ÷ 매매 창 매매(±2㎡ 짝)의 중위. 짝지은 칸이 ${TOWN_MIN.ratioCells}개 미만이면 내지 않습니다. 색: ${percent(CUTS.low, 0)}·${percent(CUTS.mid, 0)}·${percent(CUTS.high, 0)} 경계.`)}
                {head('jeonseDeals', '전세 거래량', `최근 4분기 ÷ 그 앞 4분기 − 1 (${windows?.rent ?? ''}). 앞 창이 10건 미만이면 내지 않습니다.`)}
                {head('saleDeals', '매매 거래량', `최근 4분기 ÷ 그 앞 4분기 − 1 (${windows?.sale ?? ''}). 앞 창이 10건 미만이면 내지 않습니다.`)}
                {head('salePrice1y', '매매 1년', '같은 칸의 마지막 완결 분기 ÷ 4분기 전 가격 → 칸들의 중위 − 1. 수준(동 평균가)끼리 나누지 않습니다. 칸 5개 미만이면 내지 않습니다.')}
                {head('jeonse1y', '전세 1년', '같은 칸 전세 보증금 마지막 완결 분기 ÷ 4분기 전 → 중위 − 1. 칸 5개 미만이면 내지 않습니다.')}
                {head('newShare', '신축 비중', `전월세 2년 거래 중 ${TOWN_NEW_SINCE}년 이후 준공 단지 거래의 비중. 좋고 나쁨이 없는 값이라 색이 없습니다.`)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const isOpen = open === r.key;
                return (
                  <Fragment key={r.key}>
                    <tr
                      onClick={() => setOpen(isOpen ? null : r.key)}
                      className={`cursor-pointer border-b border-slate-800/60 hover:bg-slate-800/30 ${isOpen ? 'bg-slate-800/40' : ''}`}
                    >
                      <td className="px-2.5 py-2.5 text-left whitespace-nowrap text-slate-200">
                        <span className="mr-1 text-slate-500">{isOpen ? '▾' : '▸'}</span>
                        {r.label}
                        {multiRegion && <span className="ml-1 text-2xs text-slate-400">{regionShort(r.regionCode)}</span>}
                      </td>
                      <td className="px-2.5 py-2.5 text-right text-slate-300">{r.complexes}</td>
                      <td className="px-2.5 py-2.5 text-right text-slate-300">{r.jeonseDeals2y.toLocaleString('ko-KR')}</td>
                      <td className="px-2.5 py-2.5 text-right text-slate-300">{r.wolseDeals2y.toLocaleString('ko-KR')}</td>
                      <td className="px-2.5 py-2.5 text-right text-slate-300">
                        {r.jeonsePerSqm ? (
                          <>
                            {money(r.jeonsePerSqm.v)}
                            <N>{r.jeonsePerSqm.n}</N>
                          </>
                        ) : (
                          <Dash why="전세 창 안 거래 없음" />
                        )}
                      </td>
                      <td className="px-2.5 py-2.5 text-right text-slate-300">
                        {r.salePerSqm ? (
                          <>
                            {money(r.salePerSqm.v)}
                            <N>{r.salePerSqm.n}</N>
                          </>
                        ) : (
                          <Dash why="매매 창 안 거래 없음 (또는 매매 스냅샷 밖 지역)" />
                        )}
                      </td>
                      <td className="px-2.5 py-2.5 text-right">
                        {r.ratio ? (
                          <span className={ratioClass(r.ratio.v)}>
                            {percent(r.ratio.v, 0)}
                            <N>{r.ratio.cells}칸</N>
                          </span>
                        ) : (
                          <Dash why={`짝지은 칸 ${TOWN_MIN.ratioCells}개 미만 — 표본 부족`} />
                        )}
                      </td>
                      <ChangeCell c={r.jeonseDealsChange} />
                      <ChangeCell c={r.saleDealsChange} />
                      <td className="px-2.5 py-2.5 text-right">
                        {r.salePrice1y ? (
                          <span className={signClass(r.salePrice1y.v)}>
                            {signed(r.salePrice1y.v)}
                            <N>{r.salePrice1y.cells}칸</N>
                          </span>
                        ) : (
                          <Dash why="짝지은 칸 5개 미만" />
                        )}
                      </td>
                      <td className="px-2.5 py-2.5 text-right">
                        {r.jeonse1y ? (
                          <span className={signClass(r.jeonse1y.v)}>
                            {signed(r.jeonse1y.v)}
                            <N>{r.jeonse1y.cells}칸</N>
                          </span>
                        ) : (
                          <Dash why="짝지은 칸 5개 미만" />
                        )}
                      </td>
                      <td className="px-2.5 py-2.5 text-right text-slate-300">
                        {r.newShare ? (
                          <>
                            {percent(r.newShare.v, 0)}
                            <N>{r.newShare.deals}</N>
                          </>
                        ) : (
                          <Dash why="전월세 거래 없음" />
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-slate-800">
                        <td colSpan={12} className="bg-slate-950/40 px-3 py-3">
                          <TownDetail row={r} onOpenComplex={onOpenComplex} onDiscover={onDiscover} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {windows && (
          <Foldable summary="거래량 창 · 괄호 읽는 법" count={2}>
            <p>
              거래량 창 — 매매 {windows.sale} · 전세 {windows.rent}. 매매·전세 창이 한 분기 어긋나는 것은 각 스냅샷의 마지막 완결
              분기를 쓰기 때문입니다.
            </p>
            <p className="mt-1">괄호 안은 거래 건수 또는 짝지은 칸 수입니다.</p>
          </Foldable>
        )}
        <Foldable summary="이 자료가 못 하는 것" count={TOWN_CAVEATS.length}>
          <ul className="list-disc space-y-1 pl-5">
            {TOWN_CAVEATS.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Foldable>
      </Card>
    </div>
  );
}

const regionShort = (code: string) => regionOf(code)?.short ?? code;

function ChangeCell({ c }: { c: TownRow['jeonseDealsChange'] }) {
  return (
    <td className="px-2.5 py-2.5 text-right" title={`${c.recent}건 대 ${c.prior}건`}>
      {c.change != null ? (
        <span className={signClass(c.change)}>
          {signed(c.change, 0)}
          <N>
            {c.recent}/{c.prior}
          </N>
        </span>
      ) : (
        <span className="text-slate-500">
          — <N>기준 적음 {c.prior}</N>
        </span>
      )}
    </td>
  );
}

const areaLabel = (a: number) => `${a}㎡ (${toPyeong(a).toFixed(1)}평 · 공급 약 ${Math.round(toSupplyPyeong(a))}평)`;

function TownDetail({
  row,
  onOpenComplex,
  onDiscover,
}: {
  row: TownRow;
  onOpenComplex?: (cx: string, area?: number) => void;
  onDiscover?: (regionCode: string) => void;
}) {
  const list = useMemo(() => (row.umd ? townComplexes(row.regionCode, row.umd) : []), [row]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-slate-300">
          {row.umd
            ? `${row.label} 단지 ${list.length}곳 — 최근 전세·전세가율은 후보판과 같은 계산입니다`
            : '구 단위 줄입니다. 단지 목록은 [동] 으로 바꿔 동을 펼치면 나옵니다.'}
        </span>
        {onDiscover && (
          <button
            type="button"
            onClick={() => onDiscover(row.regionCode)}
            className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-300 hover:bg-sky-500/20"
          >
            이 구에서 발굴하기 →
          </button>
        )}
      </div>
      {row.umd && (
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-slate-400">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">단지</th>
              <th className="px-2 py-1.5 text-right font-medium">준공</th>
              <th className="px-2 py-1.5 text-left font-medium">평형 · 최근 전세 · 전세가율</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.cx} className="border-t border-slate-800/60 align-top">
                <td className="px-2 py-1.5 text-left whitespace-nowrap">
                  {onOpenComplex ? (
                    <button type="button" onClick={() => onOpenComplex(c.cx)} className="text-sky-300 hover:underline">
                      {c.name}
                    </button>
                  ) : (
                    <span className="text-slate-200">{c.name}</span>
                  )}
                  {c.rentDeals2y === 0 && <span className="ml-1 text-slate-500">매매만</span>}
                </td>
                <td className="px-2 py-1.5 text-right text-slate-400">{c.built || '—'}</td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {c.sizes.map((s) => (
                      <button
                        key={s.area}
                        type="button"
                        disabled={!onOpenComplex}
                        onClick={() => onOpenComplex?.(c.cx, s.area)}
                        title={areaLabel(s.area)}
                        className="rounded border border-slate-800 bg-slate-900/60 px-1.5 py-0.5 text-left text-slate-300 enabled:hover:border-sky-500/50"
                      >
                        <span className="text-slate-400">{s.area}㎡</span>{' '}
                        {s.jeonse ? (
                          s.jeonse.split ? (
                            <span className="text-slate-500">전세 갈림</span>
                          ) : s.jeonse.deposit ? (
                            <>
                              전세 {money(s.jeonse.deposit)}
                              <N>{s.jeonse.n}</N>
                            </>
                          ) : (
                            <span className="text-slate-500">전세 —</span>
                          )
                        ) : s.wolse ? (
                          <>
                            월세 {money(s.wolse.deposit)}/{money(s.wolse.rent)}
                            <N>{s.wolse.n}</N>
                          </>
                        ) : s.sale ? (
                          <>
                            매매 {money(s.sale.price)}
                            <N>{s.sale.n}</N>
                          </>
                        ) : (
                          '—'
                        )}
                        {s.ratio != null && <span className={`ml-1 ${ratioClass(s.ratio)}`}>{percent(s.ratio, 0)}</span>}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
