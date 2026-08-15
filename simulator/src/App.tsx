import { useState } from 'react';
import { Button } from './components/ui';
import { RULES } from './engine/rules';
import { ComparePage } from './pages/ComparePage';
import { ProfilePage } from './pages/ProfilePage';
import { PropertiesPage } from './pages/PropertiesPage';
import { ReportPage } from './pages/ReportPage';
import { ScenarioPage } from './pages/ScenarioPage';
import { MarketPage } from './pages/MarketPage';
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

const TABS: { id: TabId; label: string; step: string }[] = [
  { id: 'profile', label: '가구 프로필', step: '1' },
  { id: 'scenarios', label: '시나리오', step: '2' },
  { id: 'properties', label: '물건 · 입지', step: '3' },
  { id: 'compare', label: '비교 매트릭스', step: '4' },
  { id: 'tenure', label: '매수 · 전세 · 월세', step: '5' },
  { id: 'market', label: '실거래 수익률', step: '6' },
  { id: 'report', label: '리포트', step: '7' },
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

          <nav className="mt-3 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
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
