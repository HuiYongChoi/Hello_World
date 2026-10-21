import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  MoneyInput,
  NumberInput,
  Select,
  Stat,
  TextInput,
} from '../components/ui';
import { autoIndicators, autoSummary, type AutoIndicator } from '../engine/autoScore';
import { money } from '../engine/format';
import { findComplex } from '../engine/market';
import { areaNeedsCheck, draftToProperty, pickFromMarket } from '../engine/pick';
import { BAND_DEFAULT, BAND_WIDE, MIN_PEERS, nearestPeers, priceContext } from '../engine/priceContext';
import { RULES, isRegulated } from '../engine/rules';
import { goFocus, showComplexInMarket, type FocusTarget } from './focusLink';
import {
  CATEGORIES,
  GROUNDED_MIN,
  INDICATORS,
  PENALTIES,
  categoryCoverage,
  coverageLabel,
  defaultWeights,
  gradeLabel,
  normalize,
  scoreProperty,
  type Indicator,
  type ScoreResult,
  type ScoreSource,
} from '../engine/scoring';
import { propertyThesis } from '../engine/thesis';
import type { Property, RegionId } from '../engine/types';
import { useStore } from '../state/store';
import { PropertyPicker } from './PropertyPicker';

const GRADE_TONE: Record<string, 'good' | 'info' | 'warn' | 'bad'> = {
  S: 'good',
  A: 'good',
  B: 'info',
  C: 'warn',
  D: 'bad',
};

/** 사용자값과 자동값이 이만큼(0~100 점수) 벌어지면 근거 칸에 어긋남을 적습니다 */
const MISMATCH_POINTS = 25;

export function PropertiesPage() {
  const { properties, addProperty, updateProperty, removeProperty, loadSamples, focusPropertyId, setFocusProperty } =
    useStore();
  const [openId, setOpenId] = useState<string | null>(focusPropertyId);
  const [picking, setPicking] = useState(false);

  // 다른 화면에서 [왜 이 가격]·[수정] 으로 건너오면 초점 물건이 펼쳐져 있어야 그 자리로 내려갑니다
  useEffect(() => {
    if (focusPropertyId) setOpenId(focusPropertyId);
  }, [focusPropertyId]);

  const open = (id: string) => {
    setOpenId(id);
    setFocusProperty(id);
  };

  return (
    <div className="space-y-6">
      <Card
        title="물건 등록 및 입지 평가"
        subtitle="입지 점수는 항목별 입력의 가중합입니다. 항목마다 실측 · 대리지표 · 직접 입력 · 기본값 중 어디서 왔는지를 적습니다 — 자동으로 채운 것도 객관적 시세 예측이 아니라 비교용 점수입니다."
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => setPicking(!picking)}>
              ＋ 시중 단지에서 고르기
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const id = addProperty();
                open(id);
              }}
            >
              ＋ 직접 입력
            </Button>
            <Button size="sm" onClick={loadSamples}>
              샘플 불러오기
            </Button>
          </div>
        }
      >
        {picking && (
          <div className="mb-4">
            <PropertyPicker
              onCancel={() => setPicking(false)}
              onDone={(id) => {
                setPicking(false);
                setOpenId(id);
              }}
            />
          </div>
        )}
        {properties.length === 0 ? (
          <Empty>등록된 물건이 없습니다. 시중 단지에서 고르거나 직접 입력하면 비교 매트릭스가 만들어집니다.</Empty>
        ) : (
          <div className="space-y-3">
            {properties.map((p) => (
              <PropertyCard
                key={p.id}
                property={p}
                open={openId === p.id}
                focused={focusPropertyId === p.id}
                onToggle={() => (openId === p.id ? setOpenId(null) : open(p.id))}
                onChange={(patch) => updateProperty(p.id, patch)}
                onRemove={() => {
                  removeProperty(p.id);
                  if (openId === p.id) setOpenId(null);
                }}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function PropertyCard({
  property,
  open,
  focused,
  onToggle,
  onChange,
  onRemove,
}: {
  property: Property;
  open: boolean;
  focused: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<Property>) => void;
  onRemove: () => void;
}) {
  const score = scoreProperty(property);
  const thesis = propertyThesis(property);
  const region = RULES.regions.find((r) => r.id === property.region)!;
  const regulated = isRegulated(property.sigungu);

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-slate-950/40 print-plain ${
        focused ? 'border-sky-500/40' : 'border-slate-800'
      }`}
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left">
          <span className={`text-xs text-slate-400 transition ${open ? 'rotate-90' : ''}`} aria-hidden>
            ▶
          </span>
          <span className="text-sm font-semibold text-slate-100">{property.name}</span>
          <Badge tone={region.isCapitalArea ? 'bad' : 'good'}>{region.label}</Badge>
          {property.sigungu && <span className="text-xs text-slate-400">{property.sigungu}</span>}
          {regulated && <Badge tone="bad">규제지역</Badge>}
          <span className="text-xs tabular-nums text-slate-300">{property.price > 0 ? money(property.price) : '가격 미입력'}</span>
          <span className="text-xs tabular-nums text-slate-400">전용 {property.areaSqm}㎡</span>
          <span className="text-xs text-slate-400">{thesis.label}</span>
          {property.link && <span className="text-xs text-slate-400">실거래 연결</span>}
        </button>
        <div className="flex items-center gap-2">
          {focused && (
            <span className="text-xs text-sky-300" title="다른 화면들이 축으로 삼는 물건">
              ★ 초점
            </span>
          )}
          <Badge
            tone={GRADE_TONE[score.grade]}
            title={
              score.coverage.groundedShare < GROUNDED_MIN
                ? '가중치의 절반 이상이 미입력 중간값입니다'
                : '근거 = 직접 입력·실측·대리지표로 채운 가중치 비중'
            }
          >
            입지 {score.total.toFixed(0)}점 · {gradeLabel(score)} · {coverageLabel(score)}
          </Badge>
          <Button size="sm" variant="ghost" onClick={onRemove}>
            삭제
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-t border-slate-800 px-4 py-4">
          <BasicInfo property={property} onChange={onChange} />

          {regulated && (
            <p className="mt-3 text-xs text-rose-300">규제지역으로 판정되어 은행 주담대 LTV가 50%로 제한됩니다.</p>
          )}

          <div className="mt-6 grid gap-5 2xl:grid-cols-[minmax(0,1fr)_24rem]">
            <ScoreTable property={property} score={score} onChange={onChange} />
            <div className="grid content-start gap-4 lg:grid-cols-2 2xl:grid-cols-1">
              <CategoryRadar score={score} />
              <ThesisCard property={property} />
              <PriceContextCard property={property} onChange={onChange} />
              <PenaltyPanel property={property} onChange={onChange} />
              <ConnectCard property={property} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── ① 기본정보 — 칸마다 출처 한 줄 ─────────────────────────────────── */

function Provenance({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' | 'user' }) {
  const color = tone === 'warn' ? 'text-amber-300' : tone === 'user' ? 'text-sky-300' : 'text-slate-400';
  return <div className={`mt-1 text-xs leading-relaxed ${color}`}>{children}</div>;
}

function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-xs text-sky-400 transition hover:text-sky-300 no-print">
      {children}
    </button>
  );
}

function BasicInfo({ property, onChange }: { property: Property; onChange: (patch: Partial<Property>) => void }) {
  const [linking, setLinking] = useState(false);
  const complex = property.link ? findComplex(property.link.complexId) : null;
  const basis = property.priceBasis;
  const autoCount = useMemo(() => autoSummary(autoIndicators(property)).auto, [property]);

  return (
    <div id="property-edit" className="scroll-mt-32">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="text-sm font-semibold text-slate-200">기본정보</h3>
        {complex ? (
          <>
            <span className="text-xs text-slate-300">
              실거래 단지: {complex.name} · {property.link!.area}㎡ · {complex.umd}
            </span>
            <LinkButton onClick={() => onChange({ link: undefined, priceBasis: undefined })}>고리 끊기</LinkButton>
          </>
        ) : (
          <>
            <span className="text-xs text-slate-400">손 입력 물건 — 실거래 단지와 이어지지 않았습니다</span>
            <LinkButton onClick={() => setLinking(!linking)}>실거래 단지와 잇기 ▸</LinkButton>
          </>
        )}
        <span className="ml-auto">
          <Button size="sm" variant={property.autoFill ? 'ghost' : 'default'} onClick={() => onChange({ autoFill: !property.autoFill })}>
            {property.autoFill ? '자동 채우기 끄기' : `자동 채우기 켜기 (${autoCount}개 항목)`}
          </Button>
        </span>
      </div>

      {linking && !complex && (
        <div className="mb-4">
          <PropertyPicker
            mode="link"
            initialRegion={property.region}
            onCancel={() => setLinking(false)}
            onLink={(link) => {
              onChange({ link });
              setLinking(false);
            }}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Field label="물건명">
            <TextInput value={property.name} onChange={(v) => onChange({ name: v })} />
          </Field>
        </div>
        <div>
          <Field label="지역군" hint="LTV 우대 여부가 여기서 갈립니다">
            <Select<RegionId>
              value={property.region}
              onChange={(v) => onChange({ region: v })}
              options={RULES.regions.map((r) => ({ value: r.id, label: r.label }))}
            />
          </Field>
        </div>
        <div>
          <Field label="시군구" hint="규제지역 마스터 조인 키">
            <TextInput value={property.sigungu} onChange={(v) => onChange({ sigungu: v })} placeholder="예: 창원시 성산구" />
          </Field>
        </div>
        <div>
          <Field label="매매가">
            <MoneyInput value={property.price} onChange={(v) => onChange({ price: v })} />
          </Field>
          {basis ? (
            property.price === basis.price ? (
              <Provenance>
                실거래 {basis.window} {basis.n}건 거래 가중 중위{' '}
                {basis.thin && <Badge tone="warn">표본 {basis.n}건</Badge>}
              </Provenance>
            ) : (
              <Provenance tone="user">
                직접 수정 — 실거래 {basis.window} 중위는 {money(basis.price)} ({basis.n}건){' '}
                <LinkButton onClick={() => onChange({ price: basis.price })}>↺ 실거래 중위로</LinkButton>
              </Provenance>
            )
          ) : complex ? (
            <Provenance tone="warn">이어 붙인 단지라 가격은 입력값 그대로입니다 (실거래에서 가져오지 않음)</Provenance>
          ) : (
            <Provenance>직접 입력</Provenance>
          )}
          {complex && !basis && property.price <= 0 && (
            <Provenance tone="warn">최근 4분기 거래가 없습니다 — 매매가를 직접 넣어 주세요</Provenance>
          )}
          {basis && property.price <= 0 && <Provenance tone="warn">매매가를 직접 넣어 주세요</Provenance>}
        </div>
        <div>
          <Field label="전용면적" hint="디딤돌 60/85㎡ 판정">
            <NumberInput value={property.areaSqm} step={0.1} suffix="㎡" onChange={(v) => onChange({ areaSqm: v })} />
          </Field>
          {complex && property.areaSqm === property.link!.area && (
            <Provenance>실거래 스냅샷 · 정수로 반올림된 값</Provenance>
          )}
          {areaNeedsCheck(property.areaSqm) && (
            <Provenance tone="warn">85㎡ 경계 — 등기부 전용면적으로 확인하세요</Provenance>
          )}
        </div>
        <div>
          <Field label="세대수">
            <NumberInput value={property.householdCount} suffix="세대" onChange={(v) => onChange({ householdCount: v })} />
          </Field>
          {property.householdCount > 0 ? (
            <Provenance>직접 입력</Provenance>
          ) : (
            <Provenance tone="warn">
              자료 없음 · 직접 입력 — 국토부 실거래에 세대수가 없습니다. 넣기 전까지 이 항목은 점수에서 뺍니다
            </Provenance>
          )}
        </div>
        <div>
          <Field label="준공연도">
            <NumberInput value={property.builtYear} suffix="년" onChange={(v) => onChange({ builtYear: v })} />
          </Field>
          {complex ? (
            complex.buildYear === property.builtYear ? (
              <Provenance>실거래 스냅샷 · 단지 단위</Provenance>
            ) : (
              <Provenance tone="user">
                직접 수정 — 스냅샷은 {complex.buildYear}년{' '}
                <LinkButton onClick={() => onChange({ builtYear: complex.buildYear })}>↺ 스냅샷 값으로</LinkButton>
              </Provenance>
            )
          ) : (
            <Provenance>직접 입력</Provenance>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── ② 점수표 — 25줄, 출처를 글자로 ─────────────────────────────────── */

const SOURCE_LABEL: Record<ScoreSource, string> = {
  measured: '실측',
  proxy: '대리',
  user: '직접',
  default: '기본',
};

const SOURCE_CLASS: Record<ScoreSource, string> = {
  measured: 'font-semibold text-slate-100',
  proxy: 'text-slate-200',
  user: 'text-sky-300',
  default: 'text-slate-400 underline decoration-dotted underline-offset-4',
};

function unitOf(ind: Indicator, raw: number): string {
  const n = raw.toLocaleString('ko-KR');
  switch (ind.kind) {
    case 'minutes':
      return `${n}분`;
    case 'scale3':
    case 'scale5':
      return `${n}단계`;
    case 'households':
    case 'supply':
      return `${n}세대`;
    case 'year':
      return `${raw}년`;
    case 'parking':
      return `${n}대`;
    case 'far':
      return `${n}%`;
  }
}

function autoNormalized(ind: Indicator, a: AutoIndicator): number | null {
  if (a.status === 'none') return null;
  if (a.score !== undefined) return a.score;
  return a.raw !== undefined ? normalize(ind, a.raw) : null;
}

function ScoreTable({
  property,
  score,
  onChange,
}: {
  property: Property;
  score: ScoreResult;
  onChange: (patch: Partial<Property>) => void;
}) {
  const [showWeights, setShowWeights] = useState(false);
  const auto = useMemo(() => autoIndicators(property), [property]);
  const autoById = useMemo(() => new Map(auto.map((a) => [a.id, a])), [auto]);
  const summary = autoSummary(auto);
  const presets = defaultWeights(property.region);
  const configured = { ...presets, ...(property.weightOverrides ?? {}) };
  const cats = new Map(categoryCoverage(score).map((c) => [c.id, c]));
  const rows = new Map(score.byIndicator.map((r) => [r.id, r]));
  const complex = property.link ? findComplex(property.link.complexId) : null;

  const setScore = (id: string, v: number | null) => {
    const next = { ...property.scores };
    if (v == null) delete next[id];
    else next[id] = v;
    onChange({ scores: next });
  };
  const setValue = (ind: Indicator, v: number) => {
    if (ind.id === 'householdCount') onChange({ householdCount: v });
    else if (ind.id === 'builtYear') onChange({ builtYear: v });
    else setScore(ind.id, v);
  };
  const setWeight = (id: string, v: number) =>
    onChange({ weightOverrides: { ...(property.weightOverrides ?? {}), [id]: v } });

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-200">입지 점수표</h3>
        <div className="flex items-center gap-2">
          {property.weightOverrides && Object.keys(property.weightOverrides).length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onChange({ weightOverrides: {} })}>
              프리셋 복원
            </Button>
          )}
          <Button size="sm" onClick={() => setShowWeights(!showWeights)}>
            {showWeights ? '가중치 숨기기' : '가중치 조절'}
          </Button>
        </div>
      </div>

      <p className="mb-3 text-sm text-slate-300">
        자동 {summary.auto} · 직접 입력 필요 {summary.none} · 근거 있는 가중치{' '}
        <span className="tabular-nums font-semibold">{Math.round(score.coverage.groundedShare * 100)}%</span>
        {!property.autoFill && summary.auto > 0 && (
          <span className="text-slate-400"> — 자동 채우기가 꺼져 있어 자동 {summary.auto}개는 아직 점수에 안 들어갔습니다</span>
        )}
      </p>
      {showWeights && (
        <p className="mb-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs leading-relaxed text-slate-400">
          지역 프리셋은 출발점이지 정답이 아닙니다. 가중치 0인 지표는 해당 지역에서 의미가 없다는 뜻입니다 (예: 창원의
          지하철). 본인 상황에 맞게 조절하세요.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-400">
              <th className="px-3 py-2 font-medium">항목</th>
              <th className="px-2 py-2 font-medium">출처</th>
              <th className="px-2 py-2 font-medium">값</th>
              <th className="px-2 py-2 text-right font-medium">점수</th>
              <th className="px-2 py-2 text-right font-medium">w</th>
              <th className="px-2 py-2 font-medium">근거</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((cat) => {
              const items = INDICATORS.filter((i) => i.category === cat.id && (showWeights || (configured[i.id] ?? 0) > 0));
              if (items.length === 0) return null;
              const cc = cats.get(cat.id)!;
              return [
                <tr key={cat.id} className="border-b border-slate-800 bg-slate-900/50">
                  <td colSpan={7} className="px-3 py-1.5 text-xs text-slate-300">
                    <span className="font-semibold">{cat.label}</span>
                    <span className="text-slate-400">
                      {' '}
                      · 가중치 {cc.weight} · 근거 {cc.grounded}/{cc.weight}
                    </span>
                  </td>
                </tr>,
                ...items.map((ind) => {
                  const r = rows.get(ind.id)!;
                  const a = autoById.get(ind.id)!;
                  const isBase = ind.id === 'householdCount' || ind.id === 'builtYear';
                  const unknownHouseholds = ind.id === 'householdCount' && !(property.householdCount > 0);
                  const userRaw = property.scores[ind.id];
                  const autoN = autoNormalized(ind, a);
                  const userN = userRaw !== undefined ? normalize(ind, userRaw) : null;
                  const mismatch =
                    userN != null && autoN != null && Math.abs(userN - autoN) >= MISMATCH_POINTS
                      ? `자동 ${Math.round(autoN)} ↔ 내 값 ${Math.round(userN)}`
                      : null;

                  let value: string;
                  if (unknownHouseholds) value = '—';
                  else if (r.raw != null) value = unitOf(ind, r.raw);
                  else value = `대리 ${Math.round(r.normalized)}점`;

                  let basis: ReactNode;
                  if (unknownHouseholds) {
                    basis = `${a.basis} — 입력하면 가중치 ${configured.householdCount ?? 0}`;
                  } else if (r.source === 'default') {
                    basis = (
                      <>
                        자료 없음 — 중간값입니다
                        {a.status === 'none' ? (
                          <span className="block text-slate-400">{a.basis}</span>
                        ) : (
                          !property.autoFill && <span className="block text-slate-400">자동 채우기를 켜면: {a.basis}</span>
                        )}
                      </>
                    );
                  } else if (r.source === 'user') {
                    basis =
                      ind.id === 'builtYear' && complex && complex.buildYear !== property.builtYear
                        ? `직접 수정 — 스냅샷은 ${complex.buildYear}년`
                        : isBase
                          ? '기본정보 입력값'
                          : a.status !== 'none'
                            ? `직접 입력 · 자동값 근거: ${a.basis}`
                            : '직접 입력';
                  } else {
                    basis = (
                      <>
                        {a.basis}
                        {a.caveat && <span className="block text-slate-400">{a.caveat}</span>}
                      </>
                    );
                  }

                  const canRevert = !isBase && userRaw !== undefined;
                  return (
                    <tr
                      key={ind.id}
                      className={`border-b border-slate-800/70 align-top ${r.weight === 0 && !unknownHouseholds ? 'opacity-60' : ''}`}
                    >
                      <td className="px-3 py-2 text-slate-200">
                        {ind.label}
                        <span className="block text-xs text-slate-400">{ind.hint}</span>
                      </td>
                      <td className={`px-2 py-2 text-xs ${SOURCE_CLASS[unknownHouseholds ? 'user' : r.source]}`}>
                        {unknownHouseholds ? '직접' : SOURCE_LABEL[r.source]}
                        {a.status !== 'none' && <span className="block font-normal text-slate-400">{a.scope}</span>}
                      </td>
                      <td className="px-2 py-2">
                        <ValueCell
                          display={value}
                          initial={unknownHouseholds ? null : (r.raw ?? null)}
                          step={ind.kind === 'parking' ? 0.1 : 1}
                          prompt={unknownHouseholds || r.source === 'default'}
                          onCommit={(v) => setValue(ind, v)}
                        />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-200">
                        {unknownHouseholds ? '—' : Math.round(r.normalized)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-400">
                        {showWeights ? (
                          <input
                            type="number"
                            value={configured[ind.id] ?? 0}
                            min={0}
                            max={40}
                            onChange={(e) => setWeight(ind.id, Number(e.target.value))}
                            className="w-14 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-right text-xs tabular-nums text-slate-200"
                          />
                        ) : (
                          r.weight
                        )}
                        {showWeights && presets[ind.id] !== configured[ind.id] && (
                          <span className="block text-xs text-amber-300">프리셋 {presets[ind.id]}</span>
                        )}
                      </td>
                      <td className="max-w-[22rem] px-2 py-2 text-xs leading-relaxed text-slate-300">
                        {basis}
                        {mismatch && <span className="block text-amber-300">{mismatch}</span>}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {canRevert && (
                          <LinkButton onClick={() => setScore(ind.id, null)}>
                            {property.autoFill && a.status !== 'none' ? '↺ 자동값으로' : '↺ 지우기'}
                          </LinkButton>
                        )}
                      </td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 값 칸 — 누르면 입력, Enter·포커스 이탈로 반영. 비어 있으면 [입력] */
function ValueCell({
  display,
  initial,
  step,
  prompt,
  onCommit,
}: {
  display: string;
  initial: number | null;
  step: number;
  prompt: boolean;
  onCommit: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (editing) {
    const commit = () => {
      const n = Number(draft);
      if (draft.trim() !== '' && Number.isFinite(n)) onCommit(n);
      setEditing(false);
    };
    return (
      <input
        type="number"
        autoFocus
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="w-24 rounded border border-sky-500/60 bg-slate-900 px-2 py-1 text-sm tabular-nums text-slate-100 outline-none"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(initial != null ? String(initial) : '');
        setEditing(true);
      }}
      className="whitespace-nowrap rounded px-1 text-left tabular-nums text-slate-100 transition hover:bg-slate-800"
      title="눌러서 고치기"
    >
      {display}
      {prompt && <span className="ml-1.5 text-xs text-sky-400 no-print">[입력]</span>}
    </button>
  );
}

/* ── 오른쪽 열 ───────────────────────────────────────────────────────── */

function CategoryRadar({ score }: { score: ScoreResult }) {
  const cov = new Map(categoryCoverage(score).map((c) => [c.id, c]));
  const data = score.byCategory
    .filter((c) => c.weight > 0)
    .map((c) => {
      const g = cov.get(c.id)!;
      return { category: c.label, score: Number(c.score.toFixed(1)), low: g.weight > 0 && g.grounded / g.weight < GROUNDED_MIN };
    });
  const low = new Set(data.filter((d) => d.low).map((d) => d.category));

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 print-plain">
      <h3 className="mb-1 text-sm font-semibold text-slate-200">카테고리 프로필</h3>
      <p className="mb-2 text-xs text-slate-400">
        총점 {score.total.toFixed(1)}점 (기본 {score.base.toFixed(1)} − 감점 {score.penalty}) · 점선 = 근거 50% 미만인 축
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="70%">
            <PolarGrid stroke="#1e293b" />
            <PolarAngleAxis
              dataKey="category"
              tick={(props: { x?: number | string; y?: number | string; textAnchor?: string; payload?: { value: string } }) => {
                const label = props.payload?.value ?? '';
                const isLow = low.has(label);
                return (
                  <text
                    x={props.x}
                    y={props.y}
                    textAnchor={(props.textAnchor as 'start' | 'middle' | 'end') ?? 'middle'}
                    fill={isLow ? '#94a3b8' : '#cbd5e1'}
                    fontSize={12}
                    textDecoration={isLow ? 'underline dotted' : undefined}
                  >
                    {isLow ? `${label}?` : label}
                  </text>
                );
              }}
            />
            {/* 눈금 숫자는 도형 위에 겹쳐 읽기를 방해합니다. 격자만 남기고 값은 툴팁으로 봅니다. */}
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar
              dataKey="score"
              stroke="#38bdf8"
              fill="#38bdf8"
              fillOpacity={0.24}
              dot={(p: { cx?: number; cy?: number; index?: number; payload?: { low: boolean } }) => (
                <circle
                  key={p.index}
                  cx={p.cx}
                  cy={p.cy}
                  r={p.payload?.low ? 4 : 3}
                  fill={p.payload?.low ? '#0f172a' : '#38bdf8'}
                  stroke="#38bdf8"
                  strokeDasharray={p.payload?.low ? '2 2' : undefined}
                />
              )}
            />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 }}
              formatter={(v) => [`${Number(v ?? 0).toFixed(1)}점`, '카테고리 점수']}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ThesisCard({ property }: { property: Property }) {
  const t = propertyThesis(property);
  const tone = t.kind === 'ambiguous' ? 'warn' : t.kind === 'newBuild' ? 'good' : 'info';
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 print-plain">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-200">물건 성격</h3>
        <Badge tone={tone}>{t.label}</Badge>
      </div>
      <p className="text-xs leading-relaxed text-slate-300">{t.reason}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{t.advice}</p>
    </div>
  );
}

const pctText = (p: number) => `${Math.round(p * 100)}%`;

/** ③ 왜 이 가격 — 같은 구·평형대·연식대 안의 위치 */
function PriceContextCard({ property, onChange }: { property: Property; onChange: (patch: Partial<Property>) => void }) {
  const [wide, setWide] = useState(false);
  const ctx = useMemo(() => priceContext(property, { bandWidth: wide ? BAND_WIDE : BAND_DEFAULT }), [property, wide]);

  const shell = (children: ReactNode) => (
    <div id="price-context" className="scroll-mt-32 rounded-xl border border-slate-800 bg-slate-950/40 p-4 print-plain">
      <h3 className="mb-2 text-sm font-semibold text-slate-200">왜 이 가격인지</h3>
      {children}
    </div>
  );

  if (!ctx) {
    return shell(
      <p className="text-xs leading-relaxed text-slate-400">
        실거래 단지와 이어야 답할 수 있습니다 — 같은 구 · 같은 평형대 거래와 견줄 고리가 없습니다. 기본정보의 "실거래
        단지와 잇기" 를 쓰세요.
      </p>
    );
  }

  const switchTo = (cx: string, area: number) => {
    const d = pickFromMarket(cx, area);
    if (!d) return;
    // 점수 칸의 직접 입력값은 그대로 둡니다 — 지우면 사용자가 넣은 판단이 조용히 사라집니다
    onChange(draftToProperty(d));
  };

  const top = ctx.percentile != null ? 1 - ctx.percentile : null;

  return shell(
    <div className="space-y-3">
      <Stat
        size="lg"
        label="㎡당 가격 (입력 매매가 ÷ 전용)"
        value={property.price > 0 ? money(ctx.perSqm) : '가격 미입력'}
        hint={
          top != null
            ? `${ctx.district.label} ${ctx.band.areaFrom}~${ctx.band.areaTo}㎡ 중 상위 ${pctText(top)} (이웃 ${ctx.peers.length}개)`
            : `이웃 ${ctx.peers.length}개 — ${MIN_PEERS}개 미만이라 백분위를 내지 않습니다`
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>평형대 ±{wide ? BAND_WIDE : BAND_DEFAULT}㎡</span>
        <LinkButton onClick={() => setWide(!wide)}>{wide ? `±${BAND_DEFAULT}㎡로 좁히기` : `±${BAND_WIDE}㎡로 넓혀 보기`}</LinkButton>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-slate-400">같은 연식대({ctx.byAge.band})</dt>
        <dd className="text-right tabular-nums text-slate-200">
          {ctx.byAge.percentile != null ? `상위 ${pctText(1 - ctx.byAge.percentile)}` : `이웃 ${ctx.byAge.n}개 — 판단 보류`}
        </dd>
        <dt className="text-slate-400">전세가율</dt>
        <dd className="text-right tabular-nums text-slate-200">
          {ctx.jeonseRatio ? `${pctText(ctx.jeonseRatio.value)} (${ctx.jeonseRatio.scope} · ${ctx.jeonseRatio.n.toLocaleString('ko-KR')}건)` : '자료 없음'}
        </dd>
        <dt className="text-slate-400">최근 4분기 거래</dt>
        <dd className="text-right tabular-nums text-slate-200">
          {ctx.deals4q}건{ctx.self?.thin && <span className="ml-1 text-amber-300">표본 얇음</span>}
        </dd>
        <dt className="text-slate-400">이 단지·평형 중위</dt>
        <dd className="text-right tabular-nums text-slate-200">{ctx.self ? `${money(ctx.self.price)} (${ctx.self.window})` : '거래 없음'}</dd>
        <dt className="text-slate-400">판정</dt>
        <dd className="text-right text-slate-200">{ctx.thesis.label}</dd>
      </dl>

      {ctx.gaps.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
          {ctx.gaps.map((g) => (
            <li key={g}>· {g}</li>
          ))}
        </ul>
      )}

      {ctx.peers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-1 font-medium">㎡당가가 가까운 이웃</th>
                <th className="py-1 text-right font-medium">준공</th>
                <th className="py-1 text-right font-medium">㎡당</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {nearestPeers(ctx, 5).map((p) => (
                <tr key={`${p.complexId}_${p.area}`} className="border-t border-slate-800/70">
                  <td className="py-1.5 text-slate-200">
                    {p.name}
                    <span className="block text-slate-400">
                      {p.umd} · {p.area}㎡ · {p.n}건
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-300">{p.buildYear}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-200">{money(p.perSqm)}</td>
                  <td className="py-1.5 pl-2 text-right">
                    <span className="flex flex-col items-end gap-1">
                      <LinkButton onClick={() => switchTo(p.complexId, p.area)}>이 단지로 바꾸기</LinkButton>
                      {/* 초점 물건은 그대로 두고 그 단지 시세만 실거래 탭에서 봅니다 */}
                      <LinkButton onClick={() => showComplexInMarket(p.complexId, p.area)}>차트</LinkButton>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-400">
            바꾸면 기본정보(이름·가격·면적·준공)가 그 단지로 바뀌고, 점수 칸의 직접 입력값은 그대로 남습니다.
          </p>
        </div>
      )}
      <p className="text-xs leading-relaxed text-slate-400">
        같은 구·평형대 거래 대비 위치일 뿐 가격 예측이 아닙니다. 그 차이를 무엇이 설명하는지(위치·브랜드·층)는 이 자료에
        없습니다.
      </p>
    </div>
  );
}

/**
 * 이 물건으로 건너가기 — 같은 물건을 축으로 차트·대출·수익률·3-way 가 클릭 한 번입니다.
 * 실거래 단지와 안 이어진 물건은 차트·수익률을 내지 않습니다 (없는 연결을 있는 척하지 않음).
 */
function ConnectCard({ property }: { property: Property }) {
  const linked = property.link != null && findComplex(property.link.complexId) != null;
  const items: { target: FocusTarget; label: string; hint: string }[] = [
    ...(linked ? [{ target: 'chart' as const, label: '차트', hint: '이 단지·평형 시세와 구별 매매 차트' }] : []),
    { target: 'loan', label: '대출', hint: '비교 매트릭스의 셀 상세 — 상품별 한도·필요소득, 상품명은 설명서로' },
    ...(linked ? [{ target: 'returns' as const, label: '수익률', hint: '진입시점 분포와 이 물건 구의 백테스트' }] : []),
    { target: 'tenure', label: '매수 · 전세 · 월세', hint: '같은 자기자본으로 N년 뒤 손에 남는 돈' },
  ];
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 no-print">
      <h3 className="mb-2 text-sm font-semibold text-slate-200">이 물건으로 보기</h3>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <button
            key={i.target}
            type="button"
            title={i.hint}
            onClick={() => goFocus(i.target, property.id)}
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-sm text-slate-200 transition hover:bg-slate-700 hover:text-slate-100"
          >
            {i.label}
          </button>
        ))}
      </div>
      {!linked && (
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          차트·수익률은 실거래 단지와 이은 뒤에 열립니다 — 기본정보의 "실거래 단지와 잇기" 를 쓰세요.
        </p>
      )}
    </div>
  );
}

function PenaltyPanel({ property, onChange }: { property: Property; onChange: (patch: Partial<Property>) => void }) {
  const toggle = (id: string) => {
    const has = property.penalties.includes(id);
    onChange({ penalties: has ? property.penalties.filter((p) => p !== id) : [...property.penalties, id] });
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 print-plain">
      <h3 className="mb-2 text-sm font-semibold text-slate-200">감점 항목</h3>
      <div className="flex flex-wrap gap-1.5">
        {PENALTIES.map((p) => {
          const on = property.penalties.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              className={`rounded-md border px-2 py-1 text-xs transition ${
                on
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                  : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:text-slate-200'
              }`}
            >
              {p.label} −{p.points}
            </button>
          );
        })}
      </div>
    </div>
  );
}
