import { useState } from 'react';
import { Button } from './components/ui';
import { RULES } from './engine/rules';
import { ComparePage } from './pages/ComparePage';
import { ProfilePage } from './pages/ProfilePage';
import { PropertiesPage } from './pages/PropertiesPage';
import { ReportPage } from './pages/ReportPage';
import { ScenarioPage } from './pages/ScenarioPage';
import { MarketPage } from './pages/MarketPage';
import { RankingDrawer } from './pages/RankingDrawer';
import { TenurePage } from './pages/TenurePage';
import { useStore } from './state/store';

type TabId =
  | 'profile'
  | 'scenarios'
  | 'properties'
  | 'compare'
  | 'tenure'
  | 'market'
  | 'report';

/**
 * 7탭을 3층으로 묶습니다 — 가이드 06.
 *
 * 번호는 순서를 암시하지만 실제로는 4번과 5번을 오가며 씁니다. 번호와 순서는
 * 그대로 두고 **그룹 라벨만 얹어** 각 탭이 무엇을 하는 단계인지 드러냅니다.
 */
const TAB_GROUPS: { label: string; tabs: { id: TabId; label: string; step: string }[] }[] = [
  {
    label: '입력 — 무엇을 가정하나',
    tabs: [
      { id: 'profile', label: '가구 프로필', step: '1' },
      { id: 'scenarios', label: '시나리오', step: '2' },
      { id: 'properties', label: '물건 · 입지', step: '3' },
    ],
  },
  {
    label: '판정 — 무엇이 되나',
    tabs: [
      { id: 'compare', label: '비교 매트릭스', step: '4' },
      { id: 'tenure', label: '매수 · 전세 · 월세', step: '5' },
    ],
  },
  {
    label: '근거 · 산출',
    tabs: [
      { id: 'market', label: '실거래 수익률', step: '6' },
      { id: 'report', label: '리포트', step: '7' },
    ],
  },
];

export function App() {
  const [tab, setTab] = useState<TabId>('compare');
  const { reset, matrix } = useStore();

  const feasible = Object.values(matrix.cells).filter((c) => c.best?.feasible).length;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/85 backdrop-blur no-print">
        <div className="mx-auto max-w-7xl px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-sm font-semibold text-slate-100">
                주택 매수 의사결정 시뮬레이터
              </h1>
              <p className="mt-0.5 text-[11px] text-slate-500">
                지역 선택이 곧 대출 조건 선택입니다 — 두 축을 한 화면에서 봅니다
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-500">
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

          <nav className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2 overflow-x-auto">
            {TAB_GROUPS.map((g) => (
              <div key={g.label}>
                <div className="mb-1 px-1 text-[10px] font-medium tracking-wide text-slate-600">
                  {g.label}
                </div>
                <div className="flex gap-1">
                  {g.tabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition ${
                        tab === t.id
                          ? 'bg-sky-500/15 text-sky-300'
                          : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
                      }`}
                    >
                      <span
                        className={`flex h-4.5 w-4.5 items-center justify-center rounded text-[10px] ${
                          tab === t.id ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-500'
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
              <div className="mb-1 px-1 text-[10px] font-medium tracking-wide text-slate-600">
                어디서나
              </div>
              <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-700 px-3 py-2 text-xs text-slate-500">
                수익률 공통점 ▸
              </span>
            </div>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        {tab === 'profile' && <ProfilePage />}
        {tab === 'scenarios' && <ScenarioPage />}
        {tab === 'properties' && <PropertiesPage />}
        {tab === 'compare' && <ComparePage />}
        {tab === 'tenure' && <TenurePage />}
        {tab === 'market' && <MarketPage />}
        {tab === 'report' && <ReportPage />}
      </main>

      <RankingDrawer />

      <footer className="mx-auto max-w-7xl px-5 pb-10">
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3 print-plain">
          <p className="text-[11px] leading-relaxed text-slate-500">
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
