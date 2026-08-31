import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui';
import {
  HANDBOOK_CATEGORY_LABEL,
  HANDBOOK_META,
  handbookEntries,
  type HandbookCategory,
  type HandbookEntry,
} from '../engine/handbook';

/**
 * 대출 설명서 — **왼쪽** 서랍.
 *
 * 오른쪽 서랍은 "그래서 뭐가 올랐나" 같은 곁가지 분석에 썼습니다. 여기는
 * 성격이 다릅니다. 매트릭스가 "3.2억 · 은행 주담대" 라고 답했을 때 **그 상품이
 * 무엇을 요구하는지**를 바로 펴 보는 자리라, 본문을 읽다 말고 열어야 합니다.
 * 그래서 화면을 떠나지 않는 서랍이고, 읽는 방향(왼쪽 → 오른쪽)의 시작점인
 * 왼쪽에 답니다.
 *
 * 내용은 전부 `handbook.ts` 가 룰셋에서 폅니다 — 이 파일에는 규정 숫자가
 * 하나도 없습니다.
 */

const OPEN_EVENT = 'handbook:open';

/**
 * 다른 화면에서 설명서를 엽니다 — 매트릭스의 상품명, 3-way 의 전세 가정값처럼
 * "이게 뭔데" 가 생기는 자리에서 부릅니다.
 *
 * 스토어에 상태를 하나 더 넣지 않고 이벤트로 두는 이유는, 설명서가 계산에
 * 아무 영향이 없기 때문입니다. 저장할 것도 없고 되돌릴 것도 없습니다.
 */
export function openHandbook(id?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
}

/** 상품명을 누르면 그 상품 설명이 열리는 인라인 버튼. */
export function HandbookLink({
  id,
  children,
  className = '',
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openHandbook(id);
      }}
      title="대출 설명서에서 이 항목 열기"
      className={`underline decoration-dotted decoration-slate-600 underline-offset-2 transition hover:decoration-sky-400 hover:text-sky-300 ${className}`}
    >
      {children}
    </button>
  );
}

function EntryDetail({ entry }: { entry: HandbookEntry }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-100">{entry.name}</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{entry.headline}</p>
      </div>

      {entry.sections.map((sec) => (
        <section key={sec.title}>
          <h4 className="mb-1.5 text-[11px] font-medium tracking-wide text-slate-500">
            {sec.title}
          </h4>
          <dl className="divide-y divide-slate-900 rounded-lg border border-slate-800 bg-slate-950/40">
            {sec.rows.map((r) => (
              <div key={r.key} className="px-3 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[11px] text-slate-400">
                    {r.label}
                    {r.unlabeled && (
                      <span
                        className="ml-1 text-amber-500/70"
                        title="룰셋에 새로 생긴 항목입니다. 설명서에 라벨을 붙여 주세요."
                      >
                        ⚑
                      </span>
                    )}
                  </dt>
                  <dd className="shrink-0 text-right text-[11px] font-medium text-slate-100 tabular-nums">
                    {r.value}
                  </dd>
                </div>
                {r.note && (
                  <p className="mt-0.5 text-[10px] leading-relaxed text-slate-600">{r.note}</p>
                )}
              </div>
            ))}
          </dl>
        </section>
      ))}

      {entry.watchOuts.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-[11px] font-medium tracking-wide text-slate-500">
            놓치면 손해 보는 것
          </h4>
          <ul className="space-y-1.5">
            {entry.watchOuts.map((w) => (
              <li key={w} className="text-[11px] leading-relaxed text-slate-400">
                · {w}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function HandbookDrawer() {
  const entries = useMemo(handbookEntries, []);
  const [open, setOpen] = useState(false);
  const [currentId, setCurrentId] = useState(entries[0]?.id ?? '');

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string | undefined>).detail;
      if (id && entries.some((x) => x.id === id)) setCurrentId(id);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [entries]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const current = entries.find((e) => e.id === currentId) ?? entries[0];

  const grouped = useMemo(() => {
    const order: HandbookCategory[] = ['premise', 'purchase', 'lease', 'subscription'];
    return order
      .map((c) => ({ category: c, items: entries.filter((e) => e.category === c) }))
      .filter((g) => g.items.length > 0);
  }, [entries]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="전세·매매 정책 대출 설명서를 엽니다"
        className="fixed top-1/2 left-0 z-40 -translate-y-1/2 rounded-r-xl border border-l-0 border-slate-700 bg-slate-900 px-2 py-4 text-[11px] font-medium text-slate-300 transition hover:bg-slate-800 no-print"
        style={{ writingMode: 'vertical-rl' }}
      >
        대출 설명서
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label="닫기"
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-40 bg-black/50 no-print"
      />
      <aside className="fixed inset-y-0 left-0 z-50 flex w-full max-w-2xl flex-col border-r border-slate-800 bg-slate-950 no-print">
        <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">전세 · 매매 대출 설명서</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              화면에 쓰인 규정을 그대로 폈습니다 — 숫자는 전부 룰셋에서 옵니다
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone="info">기준 {HANDBOOK_META.effectiveFrom}</Badge>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
            >
              닫기
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="w-44 shrink-0 overflow-y-auto border-r border-slate-800 py-2">
            {grouped.map((g) => (
              <div key={g.category} className="mb-2">
                <div className="px-3 py-1 text-[10px] font-medium tracking-wide text-slate-600">
                  {HANDBOOK_CATEGORY_LABEL[g.category]}
                </div>
                {g.items.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setCurrentId(e.id)}
                    className={`block w-full px-3 py-1.5 text-left text-[11px] transition ${
                      current?.id === e.id
                        ? 'bg-sky-500/15 text-sky-300'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`}
                  >
                    {e.shortName}
                    <span className="block text-[10px] text-slate-600">{e.name}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
            {current && <EntryDetail entry={current} />}
          </div>
        </div>

        <footer className="border-t border-slate-800 px-5 py-2.5 text-[10px] leading-relaxed text-slate-600">
          {HANDBOOK_META.label} · 시행 {HANDBOOK_META.effectiveFrom}
          {HANDBOOK_META.sunset && ` · 일몰 ${HANDBOOK_META.sunset}`} — {HANDBOOK_META.disclaimer}
        </footer>
      </aside>
    </>
  );
}
