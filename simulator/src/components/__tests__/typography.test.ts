import { describe, expect, it } from 'vitest';

/**
 * 글자 가드 — 2000px 어두운 화면에서 안 읽히던 두 가지를 다시 못 들어오게 막습니다.
 *
 * - 10~11px 임의값이 본문 역할을 했습니다. 크기는 토큰(text-2xs 12 · text-xs 13 · text-sm 14)만 씁니다.
 * - text-slate-600 은 배경 대비 2.6:1 이라 글자로 읽히지 않습니다. 선·배경에만 씁니다.
 *
 * 파일은 Vite 의 raw 글롭으로 읽습니다 — 앱 tsconfig 에 node 타입이 없어 fs 를 쓰면 빌드가 깨집니다.
 */

const SCREENS = import.meta.glob(['../../pages/*.tsx', '../../rentfinder/*.tsx', '../*.tsx', '../../App.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function offenders(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const [file, body] of Object.entries(SCREENS)) {
    body.split('\n').forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${file.replace(/^(\.\.\/)+/, '')}:${i + 1}`);
    });
  }
  return hits;
}

describe('글자 가드', () => {
  it('화면 파일에 text-[9px]·[10px]·[11px] 임의값이 없습니다', () => {
    expect(offenders(/text-\[(9|10|11)px\]/)).toEqual([]);
  });

  it('화면 파일에 text-slate-600 으로 적힌 글자가 없습니다', () => {
    expect(offenders(/text-slate-600/)).toEqual([]);
  });

  it('검사 대상이 실제로 잡힙니다 — 빈 목록으로 통과하지 않게', () => {
    expect(Object.keys(SCREENS).length).toBeGreaterThan(15);
    expect(Object.keys(SCREENS).some((f) => f.endsWith('App.tsx'))).toBe(true);
  });
});
