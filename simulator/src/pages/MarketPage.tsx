import { useMemo, useState } from 'react';
import { Badge, Card, Empty, Field, NumberInput, Select, Stat, TextInput } from '../components/ui';
import { money, percent } from '../engine/format';
import {
  MARKET,
  cagrBetween,
  holdingDistribution,
  mainSize,
  quarterLabel,
  safetyMargin,
  searchComplexes,
  THIN_DEAL_COUNT,
  type MarketPoint,
} from '../engine/market';

/** 중위가 추이 스파크라인. 거래가 얇은 분기는 점을 비워 표시합니다. */
function Series({
  points,
  fromQ,
  toQ,
}: {
  points: MarketPoint[];
  fromQ: number;
  toQ: number;
}) {
  const w = 100;
  const h = 28;
  const qs = points.map((p) => p.q);
  const minQ = Math.min(...qs);
  const maxQ = Math.max(...qs);
  const prices = points.map((p) => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);

  const x = (q: number) => ((q - minQ) / Math.max(1, maxQ - minQ)) * w;
  const y = (p: number) => h - ((p - minP) / Math.max(1, maxP - minP)) * h;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.q).toFixed(2)},${y(p.price).toFixed(2)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-20 w-full">
      <rect
        x={x(fromQ)}
        y={0}
        width={Math.max(0.5, x(toQ) - x(fromQ))}
        height={h}
        className="fill-sky-500/10"
      />
      <path d={d} className="fill-none stroke-sky-400" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      {points
        .filter((p) => p.q === fromQ || p.q === toQ)
        .map((p) => (
          <circle key={p.q} cx={x(p.q)} cy={y(p.price)} r={1.4} className="fill-sky-300" />
        ))}
    </svg>
  );
}

/**
 * 분포를 하나의 띠로 보여줍니다.
 *
 * 중위·하위25%·최악을 숫자 네 개로 늘어놓으면 서로의 간격이 안 보입니다. 정작
 * 의사결정에 쓰이는 건 **간격**입니다 — 진입시점을 못 고른다면 하위 구간이 실질
 * 기대치이고, 그게 기준선(대출금리 등)을 넘는지가 실행 여부를 가릅니다.
 */
function DistributionRow({
  label,
  dist,
  reference,
}: {
  label: string;
  dist: ReturnType<typeof holdingDistribution>;
  reference: number;
}) {
  if (!dist) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-800/60 px-3 py-2">
        <span className="text-xs text-slate-500">{label}</span>
        <span className="text-[11px] text-slate-600">
          이 기간으로 짝지을 진입시점이 없습니다
        </span>
      </div>
    );
  }

  const margin = safetyMargin(dist, reference);
  // 축은 최악·최고·기준선을 모두 담고 양쪽에 여백을 줍니다.
  const lo = Math.min(dist.worst, reference, 0) - 0.01;
  const hi = Math.max(dist.best, reference, 0) + 0.01;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const width = (a: number, b: number) => `${((b - a) / (hi - lo)) * 100}%`;

  const tone =
    margin.verdict === 'safe'
      ? { badge: 'good' as const, text: '최악도 기준 위' }
      : margin.verdict === 'thin'
        ? { badge: 'warn' as const, text: '하위 25%는 기준 위' }
        : { badge: 'bad' as const, text: '하위 25%가 기준 아래' };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-300">{label}</span>
          <Badge tone={tone.badge}>{tone.text}</Badge>
          {dist.thin && <Badge tone="warn">표본 {dist.count}개</Badge>}
        </div>
        <span className="text-[11px] text-slate-500">진입시점 {dist.count}개</span>
      </div>

      {/* 분포 띠 — 최악 ├ 하위25% ▓ 중위 ▓ 상위25% ┤ 최고 */}
      <div className="relative mt-3 h-9">
        {/* 손실 구간 음영 */}
        {lo < 0 && (
          <div
            className="absolute inset-y-0 rounded-l bg-rose-500/10"
            style={{ left: 0, width: width(lo, Math.min(0, hi)) }}
          />
        )}
        {/* 전체 범위 */}
        <div
          className="absolute top-4 h-px bg-slate-700"
          style={{ left: x(dist.worst), width: width(dist.worst, dist.best) }}
        />
        {/* 사분위 상자 */}
        <div
          className="absolute top-2 h-5 rounded bg-sky-500/25 ring-1 ring-sky-500/40"
          style={{ left: x(dist.p25), width: width(dist.p25, dist.p75) }}
        />
        {/* 중위 */}
        <div className="absolute top-1.5 h-6 w-0.5 bg-sky-300" style={{ left: x(dist.median) }} />
        {/* 기준선 */}
        <div
          className="absolute inset-y-0 w-px border-l border-dashed border-amber-400"
          style={{ left: x(reference) }}
        />
        {/* 양 끝 수염 */}
        {[dist.worst, dist.best].map((v, i) => (
          <div key={i} className="absolute top-2.5 h-3 w-px bg-slate-500" style={{ left: x(v) }} />
        ))}
      </div>

      <div className="flex justify-between text-[10px] tabular-nums text-slate-500">
        <span className="text-rose-300">최악 {percent(dist.worst, 1)}</span>
        <span className="text-amber-300">하위25% {percent(dist.p25, 1)}</span>
        <span className="text-sky-200">중위 {percent(dist.median, 1)}</span>
        <span className="text-slate-400">최고 {percent(dist.best, 1)}</span>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 border-t border-slate-800/70 pt-2">
        <div>
          <div className="text-[10px] text-slate-600">안전마진 (하위25% − 기준)</div>
          <div
            className={`text-sm font-semibold tabular-nums ${
              margin.marginAtP25 >= 0 ? 'text-emerald-300' : 'text-rose-300'
            }`}
          >
            {margin.marginAtP25 >= 0 ? '+' : ''}
            {percent(margin.marginAtP25, 1)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-600">기준 넘긴 진입시점</div>
          <div className="text-sm font-semibold tabular-nums text-slate-100">
            {percent(margin.beatRatio, 0)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-600">손실로 끝난 비율</div>
          <div
            className={`text-sm font-semibold tabular-nums ${
              dist.lossRatio > 0 ? 'text-rose-300' : 'text-slate-100'
            }`}
          >
            {percent(dist.lossRatio, 0)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MarketPage() {
  const [query, setQuery] = useState('');
  const [complexId, setComplexId] = useState('');
  const [areaKey, setAreaKey] = useState('');
  const [fromQ, setFromQ] = useState<number | null>(null);
  const [toQ, setToQ] = useState<number | null>(null);
  // 기준선 기본값은 은행 주담대 금리 수준 — "빌려서 사도 남는가"가 됩니다.
  const [reference, setReference] = useState(0.045);

  const results = useMemo(() => searchComplexes(query), [query]);
  const complex = results.find((c) => c.id === complexId) ?? results[0];
  const size =
    complex?.sizes.find((s) => String(s.area) === areaKey) ??
    (complex ? mainSize(complex) : null);

  const points = size?.points ?? [];
  const first = points[0]?.q ?? 0;
  const last = points[points.length - 1]?.q ?? 0;
  const start = fromQ !== null && points.some((p) => p.q === fromQ) ? fromQ : first;
  const end = toQ !== null && points.some((p) => p.q === toQ) ? toQ : last;

  const result = useMemo(() => cagrBetween(points, start, end), [points, start, end]);

  if (MARKET.complexes.length === 0) {
    return <Empty>실거래 스냅샷이 비어 있습니다. scripts/fetch-market.mjs 를 먼저 실행하세요.</Empty>;
  }

  return (
    <div className="space-y-5">
      <Card
        title="실거래 수익률"
        subtitle={`국토교통부 실거래가를 빌드 시점에 구워 넣은 스냅샷입니다. 가정값이 아니라 실제로 체결된 가격이고, 해제된 거래는 빼뒀습니다. ${MARKET.range.from.slice(0, 4)}년 ~ ${MARKET.range.to.slice(0, 4)}년 · 거래 ${MARKET.stats.deals.toLocaleString('ko-KR')}건 · 단지 ${MARKET.stats.complexes.toLocaleString('ko-KR')}개`}
        action={<Badge tone="info">기준일 {MARKET.asOf}</Badge>}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="단지 검색" hint="단지명 또는 법정동">
            <TextInput value={query} onChange={setQuery} placeholder="예: 토월성원, 가음동" />
          </Field>
          <Field label="단지" hint={`검색 결과 ${results.length}개`}>
            <Select
              value={complex?.id ?? ''}
              onChange={(v) => {
                setComplexId(v);
                setAreaKey('');
                setFromQ(null);
                setToQ(null);
              }}
              options={results.map((c) => ({
                value: c.id,
                label: `${c.name} · ${c.umd}${c.buildYear ? ` · ${c.buildYear}년` : ''}`,
              }))}
            />
          </Field>
          <Field label="평형" hint="전용면적 기준">
            <Select
              value={size ? String(size.area) : ''}
              onChange={(v) => {
                setAreaKey(v);
                setFromQ(null);
                setToQ(null);
              }}
              options={(complex?.sizes ?? []).map((s) => ({
                value: String(s.area),
                label: `${s.area}㎡ (${s.points.reduce((a, p) => a + p.n, 0)}건)`,
              }))}
            />
          </Field>
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-3">
            <div className="text-[11px] text-slate-500">연 복리 수익률</div>
            <div
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                result && result.cagr >= 0 ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {result ? percent(result.cagr, 2) : '—'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {result ? `${result.years.toFixed(2)}년 보유 기준` : '기간이 1년 미만입니다'}
            </div>
          </div>
        </div>

        {complex && size && points.length > 0 && (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="진입 시점">
                <Select
                  value={String(start)}
                  onChange={(v) => setFromQ(Number(v))}
                  options={points.map((p) => ({
                    value: String(p.q),
                    label: `${quarterLabel(p.q)} · ${money(p.price)} (${p.n}건)`,
                  }))}
                />
              </Field>
              <Field label="종료 시점">
                <Select
                  value={String(end)}
                  onChange={(v) => setToQ(Number(v))}
                  options={points.map((p) => ({
                    value: String(p.q),
                    label: `${quarterLabel(p.q)} · ${money(p.price)} (${p.n}건)`,
                  }))}
                />
              </Field>
            </div>

            <div className="mt-4">
              <Series points={points} fromQ={start} toQ={end} />
            </div>

            {result && (
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <Stat
                  label={`${quarterLabel(result.from.q)} 중위가`}
                  value={money(result.from.price)}
                  hint={`거래 ${result.from.n}건`}
                />
                <Stat
                  label={`${quarterLabel(result.to.q)} 중위가`}
                  value={money(result.to.price)}
                  hint={`거래 ${result.to.n}건`}
                />
                <Stat
                  label="누적 변화"
                  value={percent(result.totalReturn, 1)}
                  tone={result.totalReturn >= 0 ? 'good' : 'bad'}
                />
                <Stat
                  label="연 복리"
                  value={percent(result.cagr, 2)}
                  tone={result.cagr >= 0 ? 'good' : 'bad'}
                />
              </div>
            )}

            {result?.thinData && (
              <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
                양 끝 분기의 거래가 {THIN_DEAL_COUNT}건 미만입니다. 중위가라기보다 개별 물건 한
                채의 가격에 가까워, 층·향·수리 상태가 그대로 수익률에 섞여 들어갑니다.
              </p>
            )}
          </>
        )}
      </Card>

      {complex && size && (
        <Card
          title="진입시점을 바꿔 보면"
          subtitle="위 숫자는 진입시점 하나를 고른 결과입니다. 같은 단지도 언제 들어갔느냐로 결과가 갈리므로, 가능한 모든 진입시점의 분포를 같이 봐야 합니다."
          action={
            <div className="w-40">
              <Field label="기준 수익률" hint="이 선을 넘어야 남는 장사">
                <NumberInput
                  value={Number((reference * 100).toFixed(2))}
                  step={0.1}
                  suffix="%"
                  onChange={(v) => setReference(v / 100)}
                />
              </Field>
            </div>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-4 rounded bg-sky-500/25 ring-1 ring-sky-500/40" />
              사분위 (하위25%~상위25%)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-0.5 bg-sky-300" /> 중위
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-px border-l border-dashed border-amber-400" />{' '}
              기준선 {percent(reference, 1)}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-4 rounded bg-rose-500/10" /> 손실 구간
            </span>
          </div>
          <div className="space-y-2">
            {[3, 5, 10].map((y) => (
              <DistributionRow
                key={y}
                label={`${y}년 보유`}
                dist={holdingDistribution(points, y)}
                reference={reference}
              />
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
            “10년 보유하면 연 8%”보다 <span className="text-amber-300">하위 25%가 몇 %인지</span>가
            의사결정에 쓸모 있습니다. 진입시점을 골라서 들어갈 수 없다면 하위 구간이 실질
            기대치이고, 그게 기준선을 넘는지가 실행 여부를 가릅니다. 기준선은 대출금리
            수준으로 두면 “빌려서 사도 남는가”가 됩니다.
          </p>
        </Card>
      )}

      <Card title="이 숫자가 아닌 것">
        <ul className="space-y-1.5">
          {[
            '과거에 일어난 값이지 예측이 아닙니다. 진입시점을 언제로 잡느냐로 답이 크게 갈립니다.',
            '분기 중위가 기준입니다. 같은 평형도 층·향·수리 상태로 편차가 큽니다.',
            '물가·거래비용·보유세·양도세가 빠진 명목 가격 변화입니다. 실제로 손에 남는 돈은 3-way 비교 화면에서 보세요.',
            '해제 신고된 거래는 제외했습니다. 남겨두면 체결되지 않은 고점이 섞입니다.',
          ].map((t) => (
            <li key={t} className="text-xs leading-relaxed text-slate-400">
              · {t}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-slate-600">
          출처 {MARKET.source.name} · {MARKET.source.license} · 수집 {MARKET.asOf}
        </p>
      </Card>
    </div>
  );
}
