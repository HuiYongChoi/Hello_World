import { useState } from 'react';
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
  TextInput,
} from '../components/ui';
import { money } from '../engine/format';
import { RULES, isRegulated } from '../engine/rules';
import {
  CATEGORIES,
  INDICATORS,
  PENALTIES,
  defaultRaw,
  defaultWeights,
  effectiveWeights,
  scoreProperty,
} from '../engine/scoring';
import { useStore } from '../state/store';
import type { Property, RegionId } from '../engine/types';

const GRADE_TONE: Record<string, 'good' | 'info' | 'warn' | 'bad'> = {
  S: 'good',
  A: 'good',
  B: 'info',
  C: 'warn',
  D: 'bad',
};

export function PropertiesPage() {
  const { properties, addProperty, updateProperty, removeProperty, loadSamples } = useStore();
  const [openId, setOpenId] = useState<string | null>(properties[0]?.id ?? null);

  return (
    <div className="space-y-5">
      <Card
        title="물건 등록 및 입지 평가"
        subtitle="입지 점수는 객관적 시세 예측이 아니라, 당신이 입력한 주관적 평가의 가중합입니다. 물건 간 상대 비교용으로만 쓰세요."
        action={
          <div className="flex gap-2">
            <Button size="sm" onClick={loadSamples}>
              샘플 불러오기
            </Button>
            <Button size="sm" variant="primary" onClick={() => setOpenId(addProperty())}>
              + 물건 추가
            </Button>
          </div>
        }
      >
        {properties.length === 0 ? (
          <Empty>등록된 물건이 없습니다. 물건을 추가하면 비교 매트릭스가 만들어집니다.</Empty>
        ) : (
          <div className="space-y-3">
            {properties.map((p) => (
              <PropertyCard
                key={p.id}
                property={p}
                open={openId === p.id}
                onToggle={() => setOpenId(openId === p.id ? null : p.id)}
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
  onToggle,
  onChange,
  onRemove,
}: {
  property: Property;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<Property>) => void;
  onRemove: () => void;
}) {
  const score = scoreProperty(property);
  const region = RULES.regions.find((r) => r.id === property.region)!;
  const regulated = isRegulated(property.sigungu);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40 print-plain">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} className="flex flex-1 items-center gap-3 text-left">
          <span
            className={`text-xs text-slate-500 transition ${open ? 'rotate-90' : ''}`}
            aria-hidden
          >
            ▶
          </span>
          <span className="text-sm font-semibold text-slate-100">{property.name}</span>
          <Badge tone={region.isCapitalArea ? 'bad' : 'good'}>{region.label}</Badge>
          {regulated && <Badge tone="bad">규제지역</Badge>}
          <span className="text-xs tabular-nums text-slate-400">{money(property.price)}</span>
          <span className="text-xs text-slate-500">전용 {property.areaSqm}㎡</span>
        </button>
        <div className="flex items-center gap-2">
          <Badge tone={GRADE_TONE[score.grade]}>
            {score.total.toFixed(1)}점 · {score.grade}
          </Badge>
          <Button size="sm" variant="ghost" onClick={onRemove}>
            삭제
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-t border-slate-800 px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="물건명">
              <TextInput value={property.name} onChange={(v) => onChange({ name: v })} />
            </Field>
            <Field label="지역군" hint="LTV 우대 여부가 여기서 갈립니다">
              <Select<RegionId>
                value={property.region}
                onChange={(v) => onChange({ region: v })}
                options={RULES.regions.map((r) => ({ value: r.id, label: r.label }))}
              />
            </Field>
            <Field label="시군구" hint="규제지역 마스터 조인 키">
              <TextInput
                value={property.sigungu}
                onChange={(v) => onChange({ sigungu: v })}
                placeholder="예: 창원시 성산구"
              />
            </Field>
            <Field label="매매가">
              <MoneyInput value={property.price} onChange={(v) => onChange({ price: v })} />
            </Field>
            <Field label="전용면적" hint="디딤돌 60/85㎡ 판정">
              <NumberInput
                value={property.areaSqm}
                step={0.1}
                suffix="㎡"
                onChange={(v) => onChange({ areaSqm: v })}
              />
            </Field>
            <Field label="세대수">
              <NumberInput
                value={property.householdCount}
                suffix="세대"
                onChange={(v) => onChange({ householdCount: v })}
              />
            </Field>
            <Field label="준공연도">
              <NumberInput
                value={property.builtYear}
                suffix="년"
                onChange={(v) => onChange({ builtYear: v })}
              />
            </Field>
          </div>

          {regulated && (
            <p className="mt-3 text-xs text-rose-300">
              규제지역으로 판정되어 은행 주담대 LTV가 50%로 제한됩니다.
            </p>
          )}

          <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
            <ScorePanel property={property} onChange={onChange} />
            <div className="space-y-4">
              <CategoryRadar property={property} />
              <PenaltyPanel property={property} onChange={onChange} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScorePanel({
  property,
  onChange,
}: {
  property: Property;
  onChange: (patch: Partial<Property>) => void;
}) {
  const [showWeights, setShowWeights] = useState(false);
  const weights = effectiveWeights(property);
  const presets = defaultWeights(property.region);

  const setScore = (id: string, v: number) =>
    onChange({ scores: { ...property.scores, [id]: v } });

  const setWeight = (id: string, v: number) =>
    onChange({ weightOverrides: { ...(property.weightOverrides ?? {}), [id]: v } });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">입지 스코어링</h3>
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

      {showWeights && (
        <p className="mb-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
          지역 프리셋은 출발점이지 정답이 아닙니다. 가중치 0인 지표는 해당 지역에서 의미가 없다는
          뜻입니다 (예: 창원의 지하철). 본인 상황에 맞게 조절하세요.
        </p>
      )}

      <div className="space-y-4">
        {CATEGORIES.map((cat) => {
          const items = INDICATORS.filter((i) => i.category === cat.id);
          const catWeight = items.reduce((s, i) => s + (weights[i.id] ?? 0), 0);
          if (catWeight === 0 && !showWeights) return null;
          return (
            <div key={cat.id}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-300">{cat.label}</span>
                <span className="text-[11px] text-slate-600">가중치 {catWeight}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {items.map((ind) => {
                  const auto = ind.id === 'householdCount' || ind.id === 'builtYear';
                  const w = weights[ind.id] ?? 0;
                  if (w === 0 && !showWeights) return null;
                  const raw = auto
                    ? ind.id === 'householdCount'
                      ? property.householdCount
                      : property.builtYear
                    : (property.scores[ind.id] ?? defaultRaw(ind));
                  return (
                    <div
                      key={ind.id}
                      className={`rounded-lg border px-3 py-2 ${
                        w === 0
                          ? 'border-slate-800/60 bg-slate-950/20 opacity-50'
                          : 'border-slate-800 bg-slate-950/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-slate-300">{ind.label}</span>
                        {showWeights ? (
                          <input
                            type="number"
                            value={w}
                            min={0}
                            max={40}
                            onChange={(e) => setWeight(ind.id, Number(e.target.value))}
                            className="w-14 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-right text-[11px] tabular-nums text-slate-200"
                          />
                        ) : (
                          <span className="text-[10px] tabular-nums text-slate-600">w{w}</span>
                        )}
                      </div>
                      {auto ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          기본정보에서 자동 반영 ({raw})
                        </div>
                      ) : (
                        <>
                          <input
                            type="number"
                            step={ind.kind === 'parking' ? 0.1 : 1}
                            value={raw}
                            onChange={(e) => setScore(ind.id, Number(e.target.value))}
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs tabular-nums text-slate-100 outline-none focus:border-sky-500"
                          />
                          <div className="mt-0.5 text-[10px] text-slate-600">{ind.hint}</div>
                        </>
                      )}
                      {showWeights && presets[ind.id] !== w && (
                        <div className="mt-0.5 text-[10px] text-amber-400/80">
                          프리셋 {presets[ind.id]} → {w}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CategoryRadar({ property }: { property: Property }) {
  const score = scoreProperty(property);
  const data = score.byCategory
    .filter((c) => c.weight > 0)
    .map((c) => ({ category: c.label, score: Number(c.score.toFixed(1)) }));

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 print-plain">
      <h3 className="mb-1 text-sm font-semibold text-slate-200">카테고리 프로필</h3>
      <p className="mb-2 text-[11px] text-slate-500">
        총점 {score.total.toFixed(1)}점 (기본 {score.base.toFixed(1)} − 감점 {score.penalty})
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="#1e293b" />
            <PolarAngleAxis dataKey="category" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            {/* 눈금 숫자는 도형 위에 겹쳐 읽기를 방해합니다. 격자만 남기고 값은 툴팁으로 봅니다. */}
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar dataKey="score" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.28} />
            <Tooltip
              contentStyle={{
                background: '#0f172a',
                border: '1px solid #1e293b',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v) => [`${Number(v ?? 0).toFixed(1)}점`, '카테고리 점수']}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PenaltyPanel({
  property,
  onChange,
}: {
  property: Property;
  onChange: (patch: Partial<Property>) => void;
}) {
  const toggle = (id: string) => {
    const has = property.penalties.includes(id);
    onChange({
      penalties: has
        ? property.penalties.filter((p) => p !== id)
        : [...property.penalties, id],
    });
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
              className={`rounded-md border px-2 py-1 text-[11px] transition ${
                on
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                  : 'border-slate-700 bg-slate-900/50 text-slate-500 hover:text-slate-300'
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
