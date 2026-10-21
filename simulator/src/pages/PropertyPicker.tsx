import { useMemo, useState } from 'react';
import { Badge, Button, SegmentedControl, Select, TextInput } from '../components/ui';
import { money } from '../engine/format';
import { findComplex } from '../engine/market';
import {
  PICK_WINDOW,
  areaNeedsCheck,
  draftToProperty,
  pickCandidates,
  pickDistricts,
  pickFromMarket,
  pickSizes,
} from '../engine/pick';
import type { PropertyLink, RegionId } from '../engine/types';
import { useStore } from '../state/store';

const REGION_OPTIONS: { value: RegionId; label: string }[] = [
  { value: 'changwon', label: '창원' },
  { value: 'busan', label: '부산' },
  { value: 'gyeonggi', label: '경기' },
];

/** 한 번에 보여 줄 단지 후보 수 — 더 많으면 검색어로 좁힙니다 */
const SHOWN = 12;

/**
 * 시중 단지에서 고르기 — 인라인 패널 (모달 아님).
 *
 * 지역군 → 시군구 → 단지 검색 → 평형 → 미리보기 → 추가. `mode="link"` 는 손 입력
 * 물건에 **고리만** 답니다 — 이미 넣은 값(가격·면적·준공)은 덮지 않습니다.
 */
export function PropertyPicker({
  mode = 'add',
  initialRegion = 'changwon',
  onDone,
  onCancel,
  onLink,
}: {
  mode?: 'add' | 'link';
  initialRegion?: RegionId;
  /** 추가 모드: 새 물건 id */
  onDone?: (id: string) => void;
  onCancel: () => void;
  /** 잇기 모드: 고른 고리 */
  onLink?: (link: PropertyLink) => void;
}) {
  const { addProperty, setFocusProperty } = useStore();
  const [region, setRegion] = useState<RegionId>(initialRegion);
  const [district, setDistrict] = useState<string>('');
  const [query, setQuery] = useState('');
  const [complexId, setComplexId] = useState<string | null>(null);
  const [area, setArea] = useState<number | null>(null);

  const districts = useMemo(() => pickDistricts(region), [region]);
  const candidates = useMemo(
    () => pickCandidates(query, { region, districtCode: district || undefined, limit: SHOWN }),
    [query, region, district]
  );
  const complex = complexId ? findComplex(complexId) : null;
  const sizes = useMemo(() => (complexId ? pickSizes(complexId) : []), [complexId]);
  const draft = complexId && area != null ? pickFromMarket(complexId, area) : null;

  const chooseComplex = (id: string) => {
    setComplexId(id);
    setArea(pickSizes(id)[0]?.area ?? null);
  };

  const submit = () => {
    if (!draft) return;
    if (mode === 'link') {
      onLink?.(draft.link);
      return;
    }
    const id = addProperty(draftToProperty(draft));
    setFocusProperty(id);
    onDone?.(id);
  };

  return (
    <div className="rounded-xl border border-sky-500/30 bg-slate-950/50 p-4 print-plain no-print">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">
          {mode === 'link' ? '실거래 단지와 잇기 — 입력한 값은 그대로 두고 고리만 답니다' : '시중 단지에서 고르기'}
        </h3>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          닫기
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[auto_minmax(0,14rem)_minmax(0,1fr)] md:items-end">
        <div>
          <span className="mb-1 block text-xs text-slate-400">지역군</span>
          <SegmentedControl<RegionId>
            value={region}
            onChange={(v) => {
              setRegion(v);
              setDistrict('');
              setComplexId(null);
            }}
            options={REGION_OPTIONS}
          />
        </div>
        <label className="block">
          <span className="block text-xs text-slate-400">시군구</span>
          <Select<string>
            value={district}
            onChange={(v) => {
              setDistrict(v);
              setComplexId(null);
            }}
            options={[{ value: '', label: '전체' }, ...districts.map((d) => ({ value: d.code, label: d.label }))]}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-slate-400">단지명·법정동</span>
          <TextInput value={query} onChange={setQuery} placeholder="예: 푸르지오, 상남동" />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {candidates.length === 0 && <span className="text-sm text-slate-400">맞는 단지가 없습니다.</span>}
        {candidates.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => chooseComplex(c.id)}
            className={`rounded-md border px-2.5 py-1 text-left text-sm transition ${
              c.id === complexId
                ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                : 'border-slate-700 bg-slate-900/50 text-slate-300 hover:border-slate-500'
            }`}
          >
            {c.name}
            <span className="ml-1.5 text-xs text-slate-400">
              {c.umd} · {c.buildYear}년
            </span>
          </button>
        ))}
      </div>
      {!query.trim() && (
        <p className="mt-1.5 text-xs text-slate-400">검색어가 없으면 거래가 많은 단지부터 {SHOWN}개만 보입니다.</p>
      )}

      {complex && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <span className="mb-1.5 block text-xs text-slate-400">평형 (전용 ㎡ · 스냅샷 전체 거래 건수)</span>
          <div className="flex flex-wrap gap-1.5">
            {sizes.map((s) => (
              <button
                key={s.area}
                type="button"
                onClick={() => setArea(s.area)}
                className={`rounded-md border px-2.5 py-1 text-sm tabular-nums transition ${
                  s.area === area
                    ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                    : 'border-slate-700 bg-slate-900/50 text-slate-300 hover:border-slate-500'
                }`}
              >
                {s.area}㎡ <span className="text-xs text-slate-400">{s.deals}건</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {draft && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
          <span className="text-sm font-semibold text-slate-100">{draft.name}</span>
          <span className="text-sm text-slate-300">{draft.sigungu}</span>
          <span className="text-sm tabular-nums text-slate-200">
            {draft.price != null ? `최근 매매 중위 ${money(draft.price)}` : '최근 4분기 거래 없음 — 가격은 직접 입력'}
          </span>
          {draft.priceBasis && (
            <span className="text-xs text-slate-400">
              {PICK_WINDOW} · {draft.priceBasis.n}건
            </span>
          )}
          {draft.priceBasis?.thin && <Badge tone="warn">표본 {draft.priceBasis.n}건</Badge>}
          <span className="text-sm tabular-nums text-slate-300">준공 {draft.builtYear}년</span>
          <span className="text-sm tabular-nums text-slate-300">전용 {draft.areaSqm}㎡</span>
          {areaNeedsCheck(draft.areaSqm) && (
            <span className="text-xs text-amber-300">반올림 값 — 85㎡ 경계는 등기부 전용면적으로 확인</span>
          )}
          {mode === 'add' && <span className="text-xs text-amber-300">세대수는 자료에 없어 직접 입력합니다</span>}
          <div className="ml-auto">
            <Button size="sm" variant="primary" onClick={submit}>
              {mode === 'link' ? '이 단지와 잇기' : '이 물건으로 추가'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
