import { useEffect, useMemo, useState } from 'react';
import type { BoardSignals } from '../rentfinder/board/boardDoc';
import { fetchSignals } from '../rentfinder/signals';
import { JEONSE_BOARD_LS, excludedFrom, todayItems, type TodayTarget } from '../rentfinder/today';

export type { TodayTarget } from '../rentfinder/today';

/**
 * 오늘 볼 것 — 첫 화면 타일 네 칸. 넓은 화면에서는 한 줄이라 아래 화면이 바로 보입니다. 누르면 그 화면.
 *
 * 접으면 **그날만** 접힙니다(`today-folded` = 오늘 날짜). 다음 날 다시 펴지고,
 * 머리줄의 "오늘 볼 것" 버튼(`openTodayCard()`)으로 언제든 다시 폅니다.
 */

const FOLD_KEY = 'today-folded';
const OPEN_EVENT = 'today:open';

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 오늘 접어 두었나 — 머리줄 버튼의 표시 여부에 씁니다 */
export function isTodayFolded(): boolean {
  return readLS(FOLD_KEY) === todayStr();
}

/** 접은 카드를 다시 폅니다 — 머리줄 "오늘 볼 것" 버튼이 부릅니다 */
export function openTodayCard() {
  try {
    localStorage.removeItem(FOLD_KEY);
  } catch {
    /* 저장소가 막혀 있어도 이벤트로 폅니다 */
  }
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

/** 후보판(iframe srcdoc — 같은 출처)이 저장한 전세판 소거 목록 */
function loadExcluded(): Record<string, unknown> {
  const raw = readLS(JEONSE_BOARD_LS);
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  return excludedFrom(parsed);
}

export function TodayCard({ onGo }: { onGo: (t: TodayTarget) => void }) {
  const [folded, setFolded] = useState(isTodayFolded);
  const [signals, setSignals] = useState<BoardSignals | null | undefined>(undefined);
  // 후보판에서 소거하고 돌아오면 다시 읽도록, 펼칠 때마다 새로 셉니다.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchSignals().then((s) => alive && setSignals(s));
    const reopen = () => {
      setFolded(false);
      setTick((t) => t + 1);
    };
    window.addEventListener(OPEN_EVENT, reopen);
    return () => {
      alive = false;
      window.removeEventListener(OPEN_EVENT, reopen);
    };
  }, []);

  const today = todayStr();
  const items = useMemo(
    () => todayItems({ signals: signals ?? null, excluded: loadExcluded(), today }),
    // tick: 다시 펼 때 소거 목록을 새로 읽습니다
    [signals, today, tick]
  );

  if (folded) return null;

  const fold = () => {
    try {
      localStorage.setItem(FOLD_KEY, today);
    } catch {
      /* 저장이 안 되면 이번 화면에서만 접힙니다 */
    }
    setFolded(true);
  };

  return (
    <section className="no-print mb-6">
      <header className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-100">
          오늘 볼 것 <span className="ml-1 text-xs font-normal text-slate-400">{today} · 누르면 그 화면으로</span>
        </h2>
        <button type="button" onClick={fold} className="text-xs text-slate-400 hover:text-slate-200">
          오늘은 접기 ✕
        </button>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((it) => {
          const pending = it.key === 'signals' && signals === undefined;
          return (
            <li key={it.key} className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
              <button
                type="button"
                onClick={() => onGo(it.target)}
                className="group block w-full min-w-0 text-left"
              >
                <span className="flex items-center justify-between gap-2 text-xs font-medium text-slate-400">
                  {it.title}
                  <span className="text-slate-500 transition group-hover:text-sky-300">→</span>
                </span>
                <span
                  className={`mt-1 block truncate text-[15px] tabular-nums transition group-hover:text-sky-300 ${
                    it.muted || pending ? 'text-slate-400' : 'text-slate-100'
                  }`}
                  title={pending ? undefined : it.line}
                >
                  {pending ? '신호 파일 읽는 중…' : it.line}
                </span>
              </button>
              {it.detail.length > 0 && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer list-none text-xs text-slate-400 transition hover:text-sky-300">
                    ▸ 자세히 {it.detail.length}
                  </summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-slate-300 tabular-nums">
                    {it.detail.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
