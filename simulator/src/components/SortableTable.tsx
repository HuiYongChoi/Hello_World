import { useMemo, useState, type ReactNode } from 'react';

/**
 * 열 머리를 눌러 정렬하는 표 — 두 드로어가 같이 씁니다.
 *
 * **정렬은 보여주는 순서만 바꿉니다.** 어떤 항목이 상위권에 드는지는 위쪽
 * 모드가 정하고, 열을 눌러도 그 선정은 달라지지 않습니다. 정렬로 순위가
 * 바뀐다고 오해하면 "연환산으로 정렬했더니 1등이 달라졌다" 를 발견으로
 * 착각하게 됩니다.
 */

export interface SortColumn<T> {
  key: string;
  label: string;
  align?: 'right';
  hint: string;
  /** 정렬 기준값. 없으면 그 열은 눌러도 정렬되지 않습니다. */
  value?: (row: T) => number | string;
}

export function useSortedRows<T>(
  rows: T[],
  columns: SortColumn<T>[],
  initialKey: string,
  initialDesc = true
) {
  const [sortKey, setSortKey] = useState(initialKey);
  const [sortDesc, setSortDesc] = useState(initialDesc);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.value) return rows;
    const get = col.value;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const cmp =
        typeof x === 'string' ? x.localeCompare(y as string, 'ko') : (x as number) - (y as number);
      return sortDesc ? -cmp : cmp;
    });
  }, [rows, columns, sortKey, sortDesc]);

  const toggle = (key: string) => {
    if (key === sortKey) {
      setSortDesc((d) => !d);
      return;
    }
    setSortKey(key);
    // 이름은 가나다순, 숫자는 큰 값부터가 자연스럽습니다.
    const col = columns.find((c) => c.key === key);
    const sample = col?.value && rows.length > 0 ? col.value(rows[0]) : 0;
    setSortDesc(typeof sample !== 'string');
  };

  return { sorted, sortKey, sortDesc, toggle };
}

export function SortHeader<T>({
  columns,
  sortKey,
  sortDesc,
  onToggle,
}: {
  columns: SortColumn<T>[];
  sortKey: string;
  sortDesc: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <thead>
      <tr className="border-b border-slate-800 text-[10px] text-slate-500">
        {columns.map((c) => (
          <th key={c.key} className={`pb-1.5 ${c.align === 'right' ? 'text-right' : ''}`}>
            {c.value ? (
              <button
                type="button"
                title={`${c.hint}\n\n눌러서 정렬합니다. 다시 누르면 오름차순↔내림차순이 바뀝니다. 정렬은 보여주는 순서만 바꾸고 상위권 선정은 그대로입니다.`}
                onClick={() => onToggle(c.key)}
                className={`inline-flex items-center gap-0.5 transition hover:text-slate-200 ${
                  sortKey === c.key ? 'text-sky-300' : ''
                }`}
              >
                {c.label}
                <span className="text-[9px]">
                  {sortKey === c.key ? (sortDesc ? '▼' : '▲') : '⇅'}
                </span>
              </button>
            ) : (
              <span title={c.hint}>{c.label}</span>
            )}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** 표 아래에 붙는 정렬 상태 안내 — 인쇄본에도 남습니다. */
export function SortNote({ label, desc }: { label: string; desc: boolean }) {
  return (
    <p className="mt-1.5 text-[10px] text-slate-600">
      {label} {desc ? '내림차순' : '오름차순'}으로 정렬했습니다. 열 머리를 누르면 바뀝니다 —
      정렬은 보여주는 순서만 바꾸고 상위권 선정은 그대로입니다.
    </p>
  );
}

export type { ReactNode };
