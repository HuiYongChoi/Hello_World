import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Foldable,
  MoneyInput,
  NumberInput,
  Select,
  TextInput,
  Toggle,
} from '../components/ui';
import { money, percent } from '../engine/format';
import {
  APPLYHOME,
  APPLYHOME_CAVEATS,
  competitionStats,
  districtOf,
  noticeUrl,
  notices,
  planPatch,
  type OfferingNotice,
} from '../engine/applyhome';
import { annualizedPremium, premiumRows } from '../engine/presale';
import { OFFERING_CAVEATS, appraiseOffering } from '../engine/offering';
import { collectedDistricts } from '../engine/regions';
import { PremiumCard } from './PremiumCard';
import { RULES } from '../engine/rules';
import {
  paymentSchedule,
  subscriptionPlan,
  type SubscriptionPlan,
} from '../engine/subscription';
import {
  RATING_CAVEATS,
  rateOffering,
  type RatingAxis,
  type RatingTerms,
} from '../engine/rating';
import { defaultAssumptions } from '../engine/tenure';
import type { RegionId } from '../engine/types';
import { useStore } from '../state/store';

const REGION_OPTIONS = RULES.regions.map((r) => ({ value: r.id, label: r.label }));

/**
 * 같은 지역·비슷한 평형의 분양권이 실제로 얼마나 붙었는지.
 *
 * 입력한 분양가가 맞는지는 확인해 줄 수 없습니다 — 그건 단지 공고에만 있습니다.
 * 대신 **그 지역에서 분양권이 어떻게 움직였는지**를 옆에 놓아, 입력한 기대가
 * 실측 범위 안에 있는지 스스로 보게 합니다.
 */
function useNearbyPremium(region: RegionId, areaSqm: number) {
  return useMemo(() => {
    const codes = collectedDistricts()
      .filter((d) => d.region === region)
      .map((d) => d.code);
    const rows = premiumRows(codes).filter(
      (r) => Math.abs(r.area - areaSqm) <= 10
    );
    if (rows.length < 3) return null;
    const ann = rows.map(annualizedPremium).sort((a, b) => a - b);
    const at = (q: number) => ann[Math.min(ann.length - 1, Math.floor(ann.length * q))];
    return {
      n: rows.length,
      p25: at(0.25),
      median: at(0.5),
      p75: at(0.75),
      lossShare: ann.filter((v) => v < 0).length / ann.length,
    };
  }, [region, areaSqm]);
}

/** `11.68` → `11.7 : 1`. 1 미만은 숫자가 아니라 **미달**로 읽어야 합니다. */
function rateLabel(rate: number | null): string {
  if (rate === null) return '경쟁률 없음';
  if (rate < 1) return `미달 ${rate.toFixed(2)} : 1`;
  return `${rate.toFixed(1)} : 1`;
}

/**
 * 공고 불러오기 — **분양가·전용면적·일정을 손으로 넣지 않게 합니다.**
 *
 * 청약홈 분양정보가 열리기 전까지 이 탭은 전부 손입력이었습니다. 이제
 * 목록에서 고르면 다음이 채워집니다.
 *
 * ```
 * 자동  분양가 · 전용면적 · 지역 · 시군구 · 법정동 · 입주까지 남은 기간
 * 손    중도금 이자후불 여부 · 중도금 금리 · 전매제한
 * ```
 *
 * 아래 셋은 **API 에 아예 없습니다** — 단지 공고문 본문에만 있어서, 불러온
 * 뒤에도 납입 구조는 손으로 확인하셔야 합니다. 그래서 불러오기가 그 값들을
 * 건드리지 않습니다.
 */

/** 손입력 기본값 — 룰셋의 통상값에서 출발합니다. 단지마다 다르므로 바꿀 수 있어야 합니다. */
function defaultTerms(region: RegionId): RatingTerms {
  const c = RULES.subscription;
  return {
    downPaymentRatio: c.downPaymentRatio,
    interimRatio: c.interimRatio,
    interimLoanRate: c.interimLoanRate,
    interimDeferred: true,
    resaleBanMonths: c.defaultResaleBanMonths,
    mortgageRate: RULES.products.find((p) => p.type === 'bank')?.rate.max ?? 0.045,
    mortgageLtv: RULES.regions.find((r) => r.id === region)?.isCapitalArea ? 0.7 : 0.8,
  };
}

/**
 * 별 다섯 개.
 *
 * 못 재는 축은 별을 그리지 않고 "—" 로 둡니다. 근거가 없는데 별 3개를 주면
 * 그게 제일 나쁩니다 — 읽는 사람은 그것도 판정이라고 믿습니다.
 */
function Stars({ n }: { n: number | null }) {
  if (n === null) return <span className="text-[11px] text-slate-600">잴 수 없음</span>;
  return (
    <span className="tracking-tight" title={`${n} / 5`}>
      <span className="text-amber-300">{'★'.repeat(n)}</span>
      <span className="text-slate-700">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

function AxisCard({ axis }: { axis: RatingAxis }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-100">{axis.label}</div>
          {/*
            질문이 라벨 옆에 붙어 있으면 "분양가이 값이 싼가" 로 읽힙니다.
            줄을 나누고 명도를 올려 별개의 문장으로 보이게 합니다.
          */}
          <div className="mt-0.5 text-[11px] text-slate-400">{axis.question}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Stars n={axis.stars} />
          {/* 별 옆에 기준을 바로 붙입니다 — "기준이 뭔데" 가 곧바로 따라옵니다. */}
          <span
            title={axis.scale}
            aria-label={axis.scale}
            className="cursor-help rounded-full border border-slate-700 px-1 text-[10px] leading-4 text-slate-500 transition hover:border-sky-500/60 hover:text-sky-300"
          >
            ⓘ
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">{axis.headline}</p>
      <Foldable summary={`왜 이 별점인가 · ${axis.label}`} count={axis.reasons.length}>
        <ul className="space-y-1">
          {axis.reasons.map((r) => (
            <li key={r} className="text-[10px] leading-relaxed text-slate-500">
              · {r}
            </li>
          ))}
          <li className="text-[10px] leading-relaxed text-amber-500/70">⚠ {axis.caveat}</li>
        </ul>
      </Foldable>
    </div>
  );
}

function NoticePicker({
  onPick,
}: {
  onPick: (patch: Partial<SubscriptionPlan>) => void;
}) {
  const { profile } = useStore();
  const [region, setRegion] = useState<RegionId>('changwon');
  const [noticeId, setNoticeId] = useState('');
  const [houseType, setHouseType] = useState('');
  /*
   * 중도금 조건·전매제한은 API 에 없어 공고문을 봐야 합니다. 단지를 추가한
   * 뒤에 넣게 하면 **판단이 끝난 다음에 값을 넣는** 셈이라 순서가 거꾸로입니다.
   * 고르는 자리에서 넣고, 넣는 즉시 별점이 움직이게 둡니다.
   */
  const [terms, setTerms] = useState<RatingTerms>(() => defaultTerms('changwon'));
  /*
   * 자금 부담은 가구 프로필에 딸린 축이라 공고를 고르는 단계에서는 늘 필요하진
   * 않습니다. 기본은 접어 두고 필요할 때만 켭니다 — 나머지 셋은 공고 자체의
   * 성질이라 항상 보입니다.
   */
  const [showCash, setShowCash] = useState(false);
  const patchTerms = (patch: Partial<RatingTerms>) => setTerms((t) => ({ ...t, ...patch }));

  const list = useMemo(() => notices({ region }), [region]);
  const notice: OfferingNotice | null =
    list.find((n) => n.id === noticeId) ?? list[0] ?? null;
  const model =
    notice?.models.find((m) => m.houseType === houseType) ?? notice?.models[0] ?? null;
  const stats = useMemo(() => competitionStats(region), [region]);
  const matched = notice ? districtOf(notice) : null;

  // 청약은 계약부터 입주까지 몇 년이 걸려 그 사이 합가가 자연스럽습니다.
  const availableCash = profile.ownCash + profile.spouseCash;
  const rating = useMemo(
    () =>
      notice && model
        ? rateOffering({
            notice,
            model,
            terms,
            availableCash,
            termYears: profile.termYears,
          })
        : null,
    [notice, model, terms, availableCash, profile.termYears]
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="권역">
          <Select<RegionId>
            value={region}
            onChange={(v) => {
              setRegion(v);
              setNoticeId('');
              setHouseType('');
              // 권역이 바뀌면 LTV 기본값이 달라집니다 (수도권 70 / 비수도권 80).
              setTerms(defaultTerms(v));
            }}
            options={REGION_OPTIONS}
          />
        </Field>
        <Field label="공고" hint={`${list.length}건 · 최근 순`}>
          <Select<string>
            value={notice?.id ?? ''}
            onChange={(v) => {
              setNoticeId(v);
              setHouseType('');
            }}
            options={
              list.length
                ? list.map((n) => ({
                    value: n.id,
                    label: `${n.noticeDate.slice(2)} ${n.name}${n.sigungu ? ` · ${n.sigungu}` : ''}`,
                  }))
                : [{ value: '', label: '— 공고 없음' }]
            }
          />
        </Field>
        <Field label="주택형" hint="전용면적 · 분양가 · 1순위 경쟁률">
          <Select<string>
            value={model?.houseType ?? ''}
            onChange={setHouseType}
            options={
              notice
                ? notice.models.map((m) => ({
                    value: m.houseType,
                    label: `${m.areaSqm}㎡ · ${money(m.price)} · ${rateLabel(m.rank1Rate)}`,
                  }))
                : [{ value: '', label: '—' }]
            }
          />
        </Field>
      </div>

      {notice && model && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-200">{notice.name}</span>
            {notice.regulated && <Badge tone="warn">규제지역</Badge>}
            {notice.speculative && <Badge tone="warn">투기과열</Badge>}
            {notice.priceCapped && <Badge tone="good">분양가상한제</Badge>}
            <Badge>{notice.kind}</Badge>
            <a
              href={noticeUrl(notice)}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-sky-400 underline-offset-2 hover:underline"
            >
              공고 원문 ↗
            </a>
          </div>
          <div className="mt-2 grid gap-x-6 gap-y-1 text-[11px] text-slate-400 sm:grid-cols-2 lg:grid-cols-4">
            <span>
              총 <b className="text-slate-200 tabular-nums">{notice.households}</b>세대 ·
              이 주택형 <b className="text-slate-200 tabular-nums">{model.general + model.special}</b>
            </span>
            <span>
              모집공고 <span className="tabular-nums">{notice.noticeDate}</span>
            </span>
            <span>
              계약 <span className="tabular-nums">{notice.contractDate || '—'}</span>
            </span>
            <span>
              입주예정{' '}
              <span className="tabular-nums">
                {notice.moveInYm ? `${notice.moveInYm.slice(0, 4)}.${notice.moveInYm.slice(4)}` : '—'}
              </span>
              {notice.waitMonths !== null && (
                <span className="text-slate-500"> ({notice.waitMonths}개월 뒤)</span>
              )}
            </span>
            <span>
              특별공급 <span className="tabular-nums">{model.special}</span>세대 · 생애최초{' '}
              <span className="tabular-nums">{model.lifeFirst}</span> · 신혼{' '}
              <span className="tabular-nums">{model.newlywed}</span>
            </span>
            <span className="lg:col-span-3">{notice.address}</span>
          </div>

          {/*
            시군구를 못 뜯은 공고는 안전마진이 권역 전체와 비교됩니다. 불러온
            뒤에 조용히 어긋나느니 여기서 미리 말합니다.
          */}
          {!matched && (
            <p className="mt-2 text-[11px] leading-relaxed text-amber-300">
              ⚠ 이 공고 주소에서 수집 시군구를 특정하지 못했습니다
              {notice.sigungu ? ` (${notice.sigungu})` : ''} — 불러온 뒤 위에서 시군구를 직접
              고르세요. 비워 두면 안전마진이 권역 전체와 비교됩니다.
            </p>
          )}

          {/*
            공고문에만 있는 값들. 여기서 넣어야 아래 별점이 그 조건으로 다시
            계산됩니다 — 추가한 뒤에 넣으면 판단이 끝난 다음에 값을 넣는 셈입니다.
          */}
          <div className="mt-3 border-t border-slate-800 pt-3">
            <h5 className="mb-2 text-[11px] font-medium tracking-wide text-slate-500">
              공고문을 보고 넣을 값 — API 에 없습니다
            </h5>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="계약금 비율" hint="자기 돈으로만 냅니다">
                <NumberInput
                  value={Math.round(terms.downPaymentRatio * 1000) / 10}
                  step={1}
                  suffix="%"
                  onChange={(v) => patchTerms({ downPaymentRatio: v / 100 })}
                />
              </Field>
              <Field label="중도금 비율" hint={`${RULES.subscription.interimInstallments}회 분할`}>
                <NumberInput
                  value={Math.round(terms.interimRatio * 1000) / 10}
                  step={1}
                  suffix="%"
                  onChange={(v) => patchTerms({ interimRatio: v / 100 })}
                />
              </Field>
              <Field label="중도금 금리">
                <NumberInput
                  value={Math.round(terms.interimLoanRate * 10000) / 100}
                  step={0.05}
                  suffix="%"
                  onChange={(v) => patchTerms({ interimLoanRate: v / 100 })}
                />
              </Field>
              <Field label="전매제한" hint="이 기간엔 팔 수 없습니다">
                <NumberInput
                  value={terms.resaleBanMonths}
                  step={1}
                  suffix="개월"
                  onChange={(v) => patchTerms({ resaleBanMonths: Math.max(0, v) })}
                />
              </Field>
            </div>
            <div className="mt-2">
              <Toggle
                label="중도금 이자후불제"
                hint="대기 중엔 안 내고 입주 때 한꺼번에 정산합니다. 대기 부담은 가벼워지고 입주 목돈이 커집니다."
                checked={terms.interimDeferred}
                onChange={(v) => patchTerms({ interimDeferred: v })}
              />
            </div>
          </div>

          {rating && (
            <div className="mt-3 border-t border-slate-800 pt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h5 className="text-[11px] font-medium tracking-wide text-slate-500">
                  이 공고, 지역 안에서 몇 점인가
                </h5>
                <span className="text-[10px] text-slate-600">{rating.scope} 대비</span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {rating.axes
                  .filter((a) => a.id !== 'cash' || showCash)
                  .map((a) => (
                    <AxisCard key={a.id} axis={a} />
                  ))}
              </div>
              <button
                type="button"
                onClick={() => setShowCash((v) => !v)}
                className="mt-2 text-[11px] text-slate-500 underline decoration-dotted underline-offset-2 transition hover:text-slate-300"
              >
                {showCash ? '자금 부담 축 숨기기' : '자금 부담 축도 보기 (가구 프로필 기준)'}
              </button>
              {/*
                합치지 않는 이유를 화면에도 적습니다. 별을 넷 그려 놓으면
                사람은 자동으로 평균을 냅니다.
              */}
              <p className="mt-2 text-[10px] leading-relaxed text-slate-600">
                네 축을 <b className="text-slate-500">합치지 않습니다</b> — 싸지만 붙기 어려운
                공고와 비싸지만 붙기 쉬운 공고는 해야 할 일이 다릅니다. 별점은 예측이 아니라
                같은 권역 최근 공고들 사이에서의 위치입니다.
              </p>
              <Foldable summary="별점이 못 하는 것" count={RATING_CAVEATS.length}>
                <ul className="space-y-1">
                  {RATING_CAVEATS.map((c) => (
                    <li key={c} className="text-[10px] leading-relaxed text-slate-500">
                      · {c}
                    </li>
                  ))}
                </ul>
              </Foldable>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              onClick={() => onPick({ ...planPatch(notice, model), ...terms })}
            >
              이 주택형으로 단지 추가
            </Button>
            <span className="text-[11px] text-slate-500">
              위에서 넣은 중도금 조건·전매제한이 그대로 따라갑니다.
            </span>
          </div>
        </div>
      )}

      {stats && (
        <p className="text-[11px] leading-relaxed text-slate-500">
          이 권역 1순위 경쟁률 — 중위{' '}
          <b className="text-slate-300 tabular-nums">{stats.median.toFixed(1)} : 1</b> · 하위 25%{' '}
          <span className="tabular-nums">{stats.p25.toFixed(1)}</span> · 상위 25%{' '}
          <span className="tabular-nums">{stats.p75.toFixed(1)}</span> · 1순위 미달{' '}
          <span className="tabular-nums text-amber-300">{percent(stats.underShare, 0)}</span>{' '}
          <span className="text-slate-600">
            (공고 {stats.notices}건 · 주택형 {stats.n}개, {APPLYHOME.range.from} 이후)
          </span>
        </p>
      )}

      <Foldable summary="이 자료가 못 하는 것" count={APPLYHOME_CAVEATS.length}>
        <ul className="space-y-1">
          {APPLYHOME_CAVEATS.map((c) => (
            <li key={c} className="text-[10px] leading-relaxed text-slate-500">
              · {c}
            </li>
          ))}
        </ul>
      </Foldable>
    </div>
  );
}

function PlanForm({
  plan,
  onChange,
}: {
  plan: SubscriptionPlan;
  onChange: (patch: Partial<SubscriptionPlan>) => void;
}) {
  const districts = collectedDistricts().filter((d) => d.region === plan.region);
  const balanceRatio = 1 - plan.downPaymentRatio - plan.interimRatio;
  const ratioBroken = balanceRatio < -0.0001;

  return (
    <div className="space-y-5">
      <section>
        <h4 className="mb-2 text-[11px] font-medium tracking-wide text-slate-500">단지</h4>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="단지명">
            <TextInput value={plan.name} onChange={(v) => onChange({ name: v })} />
          </Field>
          <Field label="지역" hint="대출 조건이 여기서 갈립니다">
            <Select<RegionId>
              value={plan.region}
              onChange={(v) => onChange({ region: v, sigungu: '' })}
              options={REGION_OPTIONS}
            />
          </Field>
          <Field label="시군구" hint="실측 대조용 (선택)">
            <Select<string>
              value={plan.sigungu}
              onChange={(v) => onChange({ sigungu: v })}
              options={[
                { value: '', label: '— 선택 안 함' },
                ...districts.map((d) => ({ value: d.label, label: d.label })),
              ]}
            />
          </Field>
          <Field label="법정동" hint="같은 동네끼리 안전마진을 잽니다 (선택)">
            <TextInput
              value={plan.umd ?? ''}
              placeholder="예: 가음동"
              onChange={(v) => onChange({ umd: v })}
            />
          </Field>
          <Field label="전용면적">
            <NumberInput
              value={plan.areaSqm}
              step={0.1}
              suffix="㎡"
              onChange={(v) => onChange({ areaSqm: v })}
            />
          </Field>
          <Field label="분양가" hint="공고문 기준. 발코니 확장·옵션은 별도입니다">
            <MoneyInput value={plan.price} onChange={(v) => onChange({ price: v })} />
          </Field>
          <Field label="입주까지" hint="계약부터 입주지정일까지">
            <NumberInput
              value={plan.waitYears}
              step={0.5}
              suffix="년"
              onChange={(v) => onChange({ waitYears: Math.max(0, v) })}
            />
          </Field>
          <Field label="전매제한" hint="이 기간엔 팔 수 없습니다">
            <NumberInput
              value={plan.resaleBanMonths}
              step={1}
              suffix="개월"
              onChange={(v) => onChange({ resaleBanMonths: Math.max(0, v) })}
            />
          </Field>
          <Field label="청약 가점" hint="당첨 가능성 메모용 — 계산에는 안 씁니다">
            <NumberInput
              value={plan.score ?? 0}
              step={1}
              suffix="점"
              onChange={(v) => onChange({ score: v })}
            />
          </Field>
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-[11px] font-medium tracking-wide text-slate-500">
          납입 구조 — 단지마다 다릅니다
        </h4>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="계약금 비율" hint="자기 돈으로만 냅니다">
            <NumberInput
              value={Math.round(plan.downPaymentRatio * 1000) / 10}
              step={1}
              suffix="%"
              onChange={(v) => onChange({ downPaymentRatio: v / 100 })}
            />
          </Field>
          <Field label="중도금 비율" hint={`${RULES.subscription.interimInstallments}회 분할`}>
            <NumberInput
              value={Math.round(plan.interimRatio * 1000) / 10}
              step={1}
              suffix="%"
              onChange={(v) => onChange({ interimRatio: v / 100 })}
            />
          </Field>
          <Field label="중도금 금리">
            <NumberInput
              value={Math.round(plan.interimLoanRate * 10000) / 100}
              step={0.05}
              suffix="%"
              onChange={(v) => onChange({ interimLoanRate: v / 100 })}
            />
          </Field>
          <Field label="잔금 비율" hint="계약금·중도금의 나머지로 자동 계산">
            <div
              className={`mt-1 rounded-lg border px-3 py-2 text-sm tabular-nums ${
                ratioBroken
                  ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                  : 'border-slate-800 bg-slate-950/40 text-slate-300'
              }`}
            >
              {percent(balanceRatio)}
            </div>
          </Field>
        </div>
        <div className="mt-3">
          <Toggle
            label="중도금 이자후불제"
            hint="대기 중엔 안 내고 입주 때 한꺼번에 정산합니다. 후불이면 대기 기간 월 부담이 가벼워 보이지만 입주 시 목돈이 커집니다."
            checked={plan.interimDeferred}
            onChange={(v) => onChange({ interimDeferred: v })}
          />
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-[11px] font-medium tracking-wide text-slate-500">
          입주 시 전환할 주담대
        </h4>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="주담대 금리">
            <NumberInput
              value={Math.round(plan.mortgageRate * 10000) / 100}
              step={0.05}
              suffix="%"
              onChange={(v) => onChange({ mortgageRate: v / 100 })}
            />
          </Field>
          <Field
            label="주담대 LTV"
            hint={
              RULES.regions.find((r) => r.id === plan.region)?.isCapitalArea
                ? '수도권 — 생애최초 우대가 무효라 70%가 상한입니다'
                : '비수도권 — 생애최초면 80%까지 가능합니다'
            }
          >
            <NumberInput
              value={Math.round(plan.mortgageLtv * 1000) / 10}
              step={1}
              suffix="%"
              onChange={(v) => onChange({ mortgageLtv: v / 100 })}
            />
          </Field>
        </div>
      </section>

      <Field label="메모">
        <TextInput
          value={plan.memo ?? ''}
          placeholder="입주지정일, 옵션, 특별공급 유형 등"
          onChange={(v) => onChange({ memo: v })}
        />
      </Field>
    </div>
  );
}

function Schedule({ plan }: { plan: SubscriptionPlan }) {
  const steps = paymentSchedule(plan);
  const maxMonth = Math.max(1, ...steps.map((s) => s.monthOffset));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-end gap-3 pb-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-sky-500/45" /> 내 돈
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-slate-600/50" /> 대출
        </span>
      </div>
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-[11px] text-slate-500 tabular-nums">
            +{s.monthOffset}개월
          </span>
          <span className="w-28 shrink-0 text-xs text-slate-300">{s.label}</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-slate-900/60">
            <div
              className={`h-full ${s.funded === 'cash' ? 'bg-sky-500/45' : 'bg-slate-600/50'}`}
              style={{
                marginLeft: `${(s.monthOffset / maxMonth) * 55}%`,
                width: `${Math.max(6, (s.amount / plan.price) * 40)}%`,
              }}
            />
          </div>
          <span className="w-24 shrink-0 text-right text-xs text-slate-200 tabular-nums">
            {money(s.amount)}
          </span>
          <span
            className={`w-14 shrink-0 text-right text-[10px] ${
              s.funded === 'cash' ? 'text-sky-300' : 'text-slate-500'
            }`}
          >
            {s.funded === 'cash' ? '내 돈' : '대출'}
          </span>
        </div>
      ))}
    </div>
  );
}

function PlanResult({ plan }: { plan: SubscriptionPlan }) {
  const { profile } = useStore();
  const assumptions = useMemo(() => defaultAssumptions(plan.region), [plan.region]);
  /*
   * 청약은 계약금부터 입주 잔금까지 몇 년에 걸치므로, 그 사이에 합가하는 것이
   * 자연스럽습니다. 그래서 시나리오축을 따로 걸지 않고 **합가 기준 가용현금**을
   * 씁니다 — 이 화면은 순위를 매기는 곳이 아니라 필요 현금을 재는 곳입니다.
   */
  const equity = profile.ownCash + profile.spouseCash;

  const res = useMemo(
    () => subscriptionPlan(plan, assumptions, equity, profile.termYears),
    [plan, assumptions, equity, profile.termYears]
  );
  const nearby = useNearbyPremium(plan.region, plan.areaSqm);
  const shortAtContract = res.initialOutlay - equity;
  const moveInNet = res.moveInCash - res.waitDeposit;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            k: '계약 때 나가는 현금',
            v: res.initialOutlay,
            sub: `계약금 ${money(res.downPayment)} + 대기 전세 자기부담 ${money(res.waitDeposit)}`,
            bad: shortAtContract > 0,
          },
          /*
           * 이 값은 음수가 될 수 있습니다 — 돌려받는 전세보증금이 잔금 자기부담보다
           * 크면 오히려 손에 돈이 남습니다. 그때 "나가는 현금 −712만" 이라 적으면
           * 부호를 두 번 읽어야 하므로 라벨 자체를 바꿉니다.
           */
          moveInNet >= 0
            ? {
                k: '입주 때 더 필요한 현금',
                v: moveInNet,
                sub: `잔금·취득비 ${money(res.moveInCash)} − 돌려받는 보증금 ${money(res.waitDeposit)}`,
                bad: false,
              }
            : {
                k: '입주 때 오히려 남는 현금',
                v: -moveInNet,
                sub: `돌려받는 보증금 ${money(res.waitDeposit)} 이 잔금 자기부담 ${money(res.moveInCash)} 보다 큽니다`,
                bad: false,
              },
          {
            k: '중도금 이자 총액',
            v: res.interimInterest,
            sub: plan.interimDeferred ? '입주 때 한꺼번에 정산' : '대기 기간에 매달',
            bad: false,
          },
        ].map((s) => (
          <div
            key={s.k}
            className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3"
          >
            <div className="text-[11px] text-slate-500">{s.k}</div>
            <div
              className={`mt-0.5 text-lg font-semibold tabular-nums ${
                s.bad ? 'text-rose-300' : 'text-slate-100'
              }`}
            >
              {money(s.v)}
            </div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{s.sub}</div>
          </div>
        ))}
      </div>

      {shortAtContract > 0 && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs leading-relaxed text-rose-200">
          계약 시점 현금이 <span className="font-semibold">{money(shortAtContract)}</span>{' '}
          모자랍니다. 계약금은 대출이 안 되고, 대기 기간에 살 집 보증금도 같이 필요합니다 —
          청약의 진짜 문턱은 분양가가 아니라 이 두 개입니다.
        </div>
      )}

      <div>
        <h4 className="mb-2 text-[11px] font-medium tracking-wide text-slate-500">
          납입 일정 — 비율이 아니라 시점이 문제입니다
        </h4>
        <Schedule plan={plan} />
      </div>

      {nearby && (
        <Foldable
          summary={`실측 대조 — ${
            RULES.regions.find((r) => r.id === plan.region)?.label
          } · 전용 ${Math.round(plan.areaSqm)}㎡ 안팎 분양권`}
          count={nearby.n}
        >
          <div className="space-y-2 text-xs leading-relaxed text-slate-400">
            <p>
              분양권 최종 거래가 대비 준공 후 매매가의 <b className="text-slate-200">연환산</b>{' '}
              변화입니다. 중위{' '}
              <b className="text-slate-100 tabular-nums">{percent(nearby.median)}</b> · 하위
              25%{' '}
              <span className="tabular-nums text-slate-300">{percent(nearby.p25)}</span> · 상위
              25%{' '}
              <span className="tabular-nums text-slate-300">{percent(nearby.p75)}</span>.
              준공 후가 더 쌌던 비율{' '}
              <span className="tabular-nums text-amber-300">{percent(nearby.lossShare, 0)}</span>.
            </p>
            <p className="text-slate-500">
              입력한 분양가가 적정한지는 확인해 줄 수 없습니다 — 그건 단지 공고에만 있습니다.
              이 수치는 같은 지역·평형의 분양권이 실제로 어떻게 움직였는지일 뿐이고, 지나간
              시장의 상승분이 통째로 섞여 있습니다.
            </p>
          </div>
        </Foldable>
      )}

      {(res.notes.length > 0 || res.warnings.length > 0) && (
        <ul className="space-y-1.5 text-[11px] leading-relaxed">
          {res.warnings.map((w, i) => (
            <li key={`w${i}`} className="text-amber-300">
              ⚠ {w}
            </li>
          ))}
          {res.notes.map((n, i) => (
            <li key={`n${i}`} className="text-slate-500">
              · {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SubscriptionPage() {
  const { plans, addPlan, updatePlan, removePlan } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const current = plans.find((p) => p.id === openId) ?? plans[0] ?? null;

  return (
    <div className="space-y-5">
      <Card
        title="청약 단지 (선택)"
        subtitle="매수·전세·월세와 구조가 다릅니다 — 계약금을 먼저 내고, 입주까지 몇 년을 다른 집에서 임차로 삽니다"
        action={
          <Button size="sm" onClick={() => setOpenId(addPlan())}>
            단지 추가
          </Button>
        }
      >
        <p className="text-xs leading-relaxed text-slate-500">
          분양가·전용면적·일정은 <b className="text-slate-300">청약홈 공고에서 불러옵니다</b> —
          아래에서 고르면 채워집니다. 다만 <b className="text-slate-300">중도금 조건과
          전매제한은 API 에 없어</b> 공고문을 보고 아래에서 직접 넣으셔야 합니다 — 넣는 즉시
          별점이 그 조건으로 다시 계산됩니다. 넣으면 계약·대기·입주
          시점별로 현금이 언제 얼마나 필요한지와, 같은 지역·평형 분양권이 실제로 얼마나
          붙었는지를 나란히 봅니다.
        </p>

        <div className="mt-4 border-t border-slate-800 pt-4">
          <h4 className="mb-2 text-[11px] font-medium tracking-wide text-slate-500">
            공고에서 불러오기 — {APPLYHOME.stats.notices}건 (기준 {APPLYHOME.asOf})
          </h4>
          <NoticePicker
            onPick={(patch) => {
              const id = addPlan();
              updatePlan(id, patch);
              setOpenId(id);
            }}
          />
        </div>

        {plans.length === 0 ? (
          <div className="mt-4">
            <Empty>
              아직 넣은 단지가 없습니다. 이 탭은 선택이라 비워 둬도 나머지 화면은 그대로
              돌아갑니다.
            </Empty>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {plans.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOpenId(p.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  current?.id === p.id
                    ? 'bg-sky-500/15 text-sky-300'
                    : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
                }`}
              >
                {p.name || '이름 없음'}
                <span className="ml-2 text-[10px] text-slate-500 tabular-nums">
                  {money(p.price)}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {current && (
        <>
          <Card
            title={current.name || '이름 없는 단지'}
            subtitle="공고에서 불러온 값입니다 — 중도금 조건·전매제한은 공고문을 보고 확인하세요"
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (window.confirm(`'${current.name || '이름 없음'}'을 지울까요?`)) {
                    removePlan(current.id);
                    setOpenId(null);
                  }
                }}
              >
                삭제
              </Button>
            }
          >
            <PlanForm
              plan={current}
              onChange={(patch) => updatePlan(current.id, patch)}
            />
          </Card>

          <Card
            title="분양가가 싼가 — 안전마진"
            subtitle="네 자로 재고 점수로 합치지 않습니다. 어긋나는 지점이 곧 봐야 할 곳입니다"
          >
            <SafetyMargin plan={current} />
          </Card>

          {/*
            떨어졌을 때의 대안이라 청약 옆이 제자리입니다. 예전에는 실거래 탭에
            있었는데, 거기서는 "이걸 왜 보고 있지" 가 됩니다.
          */}
          <PremiumCard />

          <Card
            title="이 단지를 하면 현금이 언제 얼마나 필요한가"
            subtitle="가용현금은 1번 가구 프로필, 전세가율·전세대출 금리는 실측치를 씁니다"
            action={
              current.resaleBanMonths > 0 ? (
                <Badge tone="warn">전매제한 {current.resaleBanMonths}개월</Badge>
              ) : undefined
            }
          >
            <PlanResult plan={current} />
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * 안전마진 — **분양가가 싼가**를 네 자로 잽니다.
 *
 * 점수로 합치지 않습니다. 넷을 나란히 놓고 **어긋나는 지점**을 보여줍니다 —
 * 주변 구축 대비 28% 싼데 신축치고는 7%밖에 안 싸다면, 그 간격이 곧
 * "이 분양가가 신축 프리미엄을 얼마나 미리 당겨 받았나" 입니다.
 */
function SafetyMargin({ plan }: { plan: SubscriptionPlan }) {
  const a = useMemo(
    () =>
      appraiseOffering({
        region: plan.region,
        sigungu: plan.sigungu,
        umd: plan.umd,
        price: plan.price,
        areaSqm: plan.areaSqm,
        waitYears: plan.waitYears,
      }),
    [plan]
  );
  if (!a) return null;

  const withValue = a.benchmarks.filter((b) => b.value !== null);
  if (withValue.length === 0) {
    return (
      <Empty>
        같은 지역·평형의 실거래를 찾지 못했습니다. 전용면적이나 시군구를 확인하세요.
      </Empty>
    );
  }

  // 막대는 분양가를 0으로 둔 좌우 축입니다. 최대 마진에 맞춰 폭을 잡습니다.
  const span = Math.max(0.1, ...withValue.map((b) => Math.abs(b.margin ?? 0)));

  return (
    <div className="space-y-4">
      {/*
        시군구가 비면 권역 전체 중위가와 비교하게 됩니다 — 창원이면 성산구와
        마산이 섞여 숫자가 통째로 달라집니다. 호버에만 적으면 못 보고 지나칩니다.
      */}
      {!plan.sigungu.trim() && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
          시군구를 고르지 않아 <b>권역 전체</b>와 비교하고 있습니다. 창원이면 성산구와 마산이
          섞여 기준가가 통째로 달라집니다 — 위에서 시군구를 고르면 정확해집니다.
        </div>
      )}
      <div className="space-y-2">
        {a.benchmarks.map((b) => {
          const m = b.margin;
          const cheap = (m ?? 0) > 0;
          return (
            <div key={b.id} className="rounded-lg px-2 py-1.5 hover:bg-slate-900/40" title={b.note}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-medium text-slate-200">
                  {b.label}
                  <span className={`ml-1.5 text-[9px] ${b.thin ? 'text-amber-500/70' : 'text-slate-600'}`}>
                    n={b.n}
                    {b.thin && ' 얇음'}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                  {b.value === null ? '표본 없음' : money(b.value)}
                  {b.low !== undefined && b.high !== undefined && (
                    <span className="ml-1 text-slate-600">
                      ({money(b.low)}~{money(b.high)})
                    </span>
                  )}
                </span>
              </div>
              {m !== null && (
                <div className="mt-1 flex items-center gap-2">
                  {/* 가운데가 분양가입니다. 오른쪽으로 뻗으면 기준보다 싸다는 뜻입니다. */}
                  <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-800/70">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-slate-600" />
                    <div
                      className={`absolute inset-y-0 rounded-full ${
                        cheap ? 'bg-slate-200' : 'bg-slate-500'
                      }`}
                      style={{
                        left: cheap ? '50%' : `${50 - (Math.abs(m) / span) * 50}%`,
                        width: `${(Math.abs(m) / span) * 50}%`,
                      }}
                    />
                  </div>
                  <span
                    className={`w-16 shrink-0 text-right text-[11px] tabular-nums ${
                      b.thin ? 'text-slate-500' : cheap ? 'font-semibold text-slate-100' : 'text-slate-400'
                    }`}
                  >
                    {cheap ? '−' : '+'}
                    {percent(Math.abs(m), 1)}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] leading-relaxed text-slate-600">
        가운데 선이 분양가입니다. 막대가 <b className="text-slate-400">오른쪽</b>으로 뻗으면 그
        기준보다 분양가가 <b className="text-slate-400">싸다</b>는 뜻입니다. 각 줄에 마우스를 올리면
        그 기준이 무엇을 말하고 무엇을 못 말하는지 나옵니다.
      </p>

      {a.conflicted && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
          <b>기준끼리 어긋납니다.</b> 어떤 자로는 싸고 어떤 자로는 비쌉니다 — 그 간격이 곧 봐야 할
          곳입니다. 대개 주변 구축 대비로는 싸 보이는데 신축 하한과 견주면 아닌 경우이고, 그렇다면
          분양가가 신축 프리미엄을 미리 당겨 받았다는 뜻입니다.
        </div>
      )}

      <Foldable summary="이 판정이 못 하는 것" count={OFFERING_CAVEATS.length}>
        <ul className="space-y-1">
          {OFFERING_CAVEATS.map((c) => (
            <li key={c} className="text-[10px] leading-relaxed text-slate-500">
              · {c}
            </li>
          ))}
        </ul>
      </Foldable>
    </div>
  );
}
