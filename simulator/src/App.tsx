import { useEffect, useRef, useState } from 'react';
import { PrototypeBanner } from './components/PrototypeBanner';
import { Button, TwoCol } from './components/ui';
import { ProfileRail } from './components/ProfileRail';
import { RULES } from './engine/rules';
import { ComparePage } from './pages/ComparePage';
import { ProfilePage } from './pages/ProfilePage';
import { PropertiesPage } from './pages/PropertiesPage';
import { ReportPage } from './pages/ReportPage';
import { ScenarioPage } from './pages/ScenarioPage';
import { SubscriptionPage } from './pages/SubscriptionPage';
import { RentFinderApp } from './rentfinder/RentFinderApp';
import type { RentTarget } from './rentfinder/loans';
import { BoardFrame } from './rentfinder/BoardFrame';
import { MarketPage } from './pages/MarketPage';
import { DISTRICT_CHART_EVENT } from './pages/districtChartLink';
import { HandbookDrawer } from './pages/HandbookDrawer';
import { ComplexDetailDrawer, openComplexDetail } from './rentfinder/ComplexDetailDrawer';
import { TenurePage } from './pages/TenurePage';
import { TodayCard, openTodayCard, type TodayTarget } from './pages/TodayCard';
import { TownBoardPage } from './rentfinder/TownBoardPage';
import { useStore } from './state/store';

type TabId = 'input' | 'compare' | 'tenure' | 'subscription' | 'market' | 'report';

/** 입력 탭 안의 세 단계 — 탭을 늘리지 않고 안에서 오갑니다. */
type InputStep = 'profile' | 'scenarios' | 'properties';

/**
 * 선택 탭 안의 갈래 — 후보판 · 찾기 · 동네 시세판 · 청약.
 *
 * 청약과 전월세는 둘 다 **선택**이고 둘 다 "집을 사기 전/대신" 의 이야기라
 * 한 탭 안에 둡니다. 탭을 하나 더 늘리는 대신 입력 탭과 같은 패턴을 씁니다.
 * 매일 여는 것은 후보판이라 그것을 맨 앞·기본으로 둡니다.
 */
type OptionalStep = 'subscription' | 'rent' | 'town' | 'board';

/**
 * 탭 8개를 6개로 줄이고 3층으로 묶습니다.
 *
 * 입력 세 화면(프로필·시나리오·물건)은 **한 번 채우고 잘 안 건드리는** 값이라
 * 상시 탭을 셋이나 쓸 이유가 없습니다. 하나로 접고 안에서 단계로 오갑니다.
 * 남은 탭은 전부 "무엇을 묻는가" 가 서로 다릅니다 — 겹치면 다시 줄여야 합니다.
 */
const TAB_GROUPS: { label: string; tabs: { id: TabId; label: string; step: string }[] }[] = [
  {
    label: '입력 — 무엇을 가정하나',
    tabs: [{ id: 'input', label: '프로필 · 시나리오 · 물건', step: '1' }],
  },
  {
    label: '판정 — 무엇이 되나',
    tabs: [
      { id: 'compare', label: '비교 매트릭스', step: '2' },
      { id: 'tenure', label: '매수 · 전세 · 월세', step: '3' },
      // 선택 갈래 둘 — 청약(살 집을 미리)과 전월세(사기 전까지 살 집).
      { id: 'subscription', label: '전월세 · 청약', step: '＋' },
    ],
  },
  {
    label: '근거 · 산출',
    tabs: [
      { id: 'market', label: '실거래 수익률', step: '4' },
      { id: 'report', label: '리포트', step: '5' },
    ],
  },
];

const INPUT_STEPS: { id: InputStep; label: string }[] = [
  { id: 'profile', label: '가구 프로필' },
  { id: 'scenarios', label: '시나리오' },
  { id: 'properties', label: '물건 · 입지' },
];

const OPTIONAL_STEPS: { id: OptionalStep; label: string }[] = [
  { id: 'board', label: '전·월세 후보판' },
  { id: 'rent', label: '찾기 — 내 조건 · 발굴' },
  { id: 'town', label: '동네 시세판' },
  { id: 'subscription', label: '청약 공고 · 안전마진' },
];

/*
 * 마지막에 본 탭·단계를 기억합니다 — 매일 여는 사람은 어제 보던 화면에서 시작합니다.
 * 첫 방문은 전월세 · 청약 탭의 후보판입니다. 저장소가 막혀 있으면 기본값으로.
 */
const LAST_TAB_KEY = 'ui-last-tab';
const LAST_STEP_KEY = 'ui-last-step';
const TAB_IDS: TabId[] = ['input', 'compare', 'tenure', 'subscription', 'market', 'report'];

function readLast<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLast(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장이 안 되면 다음에 기본값으로 열릴 뿐입니다.
  }
}

export function App() {
  const [tab, setTab] = useState<TabId>(() => readLast(LAST_TAB_KEY, TAB_IDS, 'subscription'));
  const [inputStep, setInputStep] = useState<InputStep>('profile');
  const [optionalStep, setOptionalStep] = useState<OptionalStep>(() =>
    readLast(LAST_STEP_KEY, OPTIONAL_STEPS.map((s) => s.id), 'board')
  );
  /** 동네 시세판 → 전월세 찾기로 넘긴 구 — 바뀌면 찾기 화면을 그 구로 새로 엽니다 */
  const [discoverRegion, setDiscoverRegion] = useState<string | null>(null);
  /**
   * 단지 상세 → "이 보증금으로 대출 자세히" 가 넘기는 보증금·평형.
   * 넘길 때마다 n 을 올려 찾기 화면을 새로 열고(④ 로 스크롤), 같은 값을 두 번 눌러도 다시 갑니다.
   */
  const [loanJump, setLoanJump] = useState<{ n: number; target: RentTarget } | null>(null);

  useEffect(() => writeLast(LAST_TAB_KEY, tab), [tab]);

  /*
   * 머리줄 높이를 CSS 변수(--header-h)로 내보냅니다. 넓은 화면에서는 한 줄, 좁으면 두 줄이라
   * 높이가 바뀌는데, 옆에 붙는 레일(Rail)이 그 바로 아래에 붙어야 가려지지 않습니다.
   */
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const set = () => document.documentElement.style.setProperty('--header-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => writeLast(LAST_STEP_KEY, optionalStep), [optionalStep]);

  /* 시장 온도·동네 시세판의 구 이름 → 실거래 수익률 탭의 구별 매매 차트. 탭은 늘리지 않습니다 */
  useEffect(() => {
    const on = () => setTab('market');
    window.addEventListener(DISTRICT_CHART_EVENT, on);
    return () => window.removeEventListener(DISTRICT_CHART_EVENT, on);
  }, []);

  /** 오늘 볼 것 → 그 화면. 탭은 늘리지 않고 기존 탭·단계로만 옮깁니다 */
  const go = (t: TodayTarget) => {
    if (t === 'market') {
      setTab('market');
    } else {
      setTab('subscription');
      setOptionalStep(t);
    }
    window.scrollTo({ top: 0 });
  };
  const { reset, matrix } = useStore();

  const openLoanDetail = (deposit: number, areaSqm: number) => {
    setLoanJump((j) => ({ n: (j?.n ?? 0) + 1, target: { deposit, rent: 0, areaSqm } }));
    setTab('subscription');
    setOptionalStep('rent');
  };
  /** 후보판은 표가 1720px 라 본문 폭 제한을 풀어 화면 끝까지 씁니다 */
  const fullBleed = tab === 'subscription' && optionalStep === 'board';

  const feasible = Object.values(matrix.cells).filter((c) => c.best?.feasible).length;

  return (
    <div className="min-h-full">
      <header ref={headerRef} className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/85 backdrop-blur no-print">
        <PrototypeBanner />
        {/* 1800px 이상에서는 제목 · 탭 · 버튼이 한 줄, 그보다 좁으면 탭이 둘째 줄 — 머리줄이 낮아야 아래 화면이 넓습니다 */}
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-end justify-between gap-x-8 gap-y-2 px-6 py-2.5 2xl:px-10">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-slate-100">
              주택 매수 의사결정 시뮬레이터
            </h1>
            <p className="mt-0.5 hidden text-xs text-slate-400 xl:block">
              지역 선택이 곧 대출 조건 선택입니다 — 두 축을 한 화면에서 봅니다
            </p>
          </div>
          <nav className="order-last flex min-w-0 basis-full flex-nowrap items-end sm:flex-wrap [&>*]:shrink-0 gap-x-6 gap-y-2 overflow-x-auto min-[1800px]:order-none min-[1800px]:basis-auto min-[1800px]:flex-1">
            {TAB_GROUPS.map((g) => (
              <div key={g.label}>
                <div className="mb-1 px-1 text-2xs font-medium tracking-wide text-slate-400">
                  {g.label}
                </div>
                <div className="flex gap-1">
                  {g.tabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition ${
                        tab === t.id
                          ? 'bg-sky-500/15 text-sky-300'
                          : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-300'
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded text-xs ${
                          tab === t.id ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {t.step}
                      </span>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <div className="mb-1 px-1 text-2xs font-medium tracking-wide text-slate-400">
                어디서나
              </div>
              <div className="flex gap-1">
                <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-700 px-3 py-2 text-sm text-slate-400">
                  ◂ 대출 설명서
                </span>
              </div>
            </div>
          </nav>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" onClick={openTodayCard}>
              오늘 볼 것
            </Button>
            <span className="text-sm text-slate-400">
              실행 가능 조합{' '}
              <span className={feasible > 0 ? 'text-emerald-300' : 'text-rose-300'}>
                {feasible}
              </span>
              /{Object.values(matrix.cells).length}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (window.confirm('입력값을 모두 초기화할까요?')) reset();
              }}
            >
              초기화
            </Button>
          </div>
        </div>
      </header>

      <main className={fullBleed ? 'max-w-none px-3 py-4' : 'mx-auto max-w-[1800px] px-6 py-6 2xl:px-10'}>
        <TodayCard onGo={go} />
        {tab === 'input' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              {INPUT_STEPS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setInputStep(s.id)}
                  className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                    inputStep === s.id
                      ? 'bg-sky-500/15 text-sky-300'
                      : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-300'
                  }`}
                >
                  <span className="mr-1.5 text-xs text-slate-400">{i + 1}</span>
                  {s.label}
                </button>
              ))}
            </div>
            <TwoCol rail="right">
              <div className="min-w-0">
                {inputStep === 'profile' && <ProfilePage />}
                {inputStep === 'scenarios' && <ScenarioPage />}
                {inputStep === 'properties' && <PropertiesPage />}
              </div>
              <ProfileRail
                next={
                  inputStep === 'profile'
                    ? { label: '시나리오', go: () => setInputStep('scenarios') }
                    : inputStep === 'scenarios'
                      ? { label: '물건 · 입지', go: () => setInputStep('properties') }
                      : { label: '비교 매트릭스', go: () => setTab('compare') }
                }
              />
            </TwoCol>
          </div>
        )}
        {tab === 'subscription' && (
          <div className={fullBleed ? 'space-y-3' : 'space-y-6'}>
            <div className="flex flex-wrap items-center gap-2">
              {OPTIONAL_STEPS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setOptionalStep(s.id)}
                  className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                    optionalStep === s.id
                      ? 'bg-sky-500/15 text-sky-300'
                      : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {optionalStep === 'subscription' && <SubscriptionPage />}
            {optionalStep === 'rent' && (
              <RentFinderApp
                key={`${discoverRegion ?? 'default'}-${loanJump?.n ?? 0}`}
                initialRegions={discoverRegion ? [discoverRegion] : undefined}
                initialTarget={loanJump?.target}
                onOpenBoard={() => setOptionalStep('board')}
              />
            )}
            {optionalStep === 'town' && (
              <TownBoardPage
                onOpenComplex={openComplexDetail}
                onDiscover={(code) => {
                  setDiscoverRegion(code);
                  setOptionalStep('rent');
                }}
              />
            )}
            {optionalStep === 'board' && <BoardFrame />}
          </div>
        )}
        {tab === 'compare' && <ComparePage />}
        {tab === 'tenure' && <TenurePage />}
        {tab === 'market' && <MarketPage />}
        {tab === 'report' && <ReportPage />}
      </main>

      <HandbookDrawer />
      {/* 단지 상세 — 설명서와 대칭인 오른쪽 패널. 어느 화면에서든 openComplexDetail() 로 열립니다 */}
      <ComplexDetailDrawer onLoanDetail={openLoanDetail} />

      <footer className="mx-auto max-w-[1800px] px-6 pb-10 2xl:px-10">
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3 print-plain">
          <p className="text-xs leading-relaxed text-slate-400">
            <span className="text-slate-400">
              적용 규정 기준일 {RULES.effectiveFrom} · 룰셋 {RULES.version}
            </span>
            <br />
            {RULES.disclaimer}
          </p>
        </div>
      </footer>
    </div>
  );
}
