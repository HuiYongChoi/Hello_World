import { describe, expect, it } from 'vitest';
import templateHtml from '../board/template.html?raw';
import { BOARD_SNAPSHOT, buildBoardDoc, missingPlaceholders } from '../board/boardDoc';
import { BOARD_TEMPLATE } from '../board/template';

describe('전·월세 후보판', () => {
  it('template.ts 가 template.html 과 같습니다 — 고치고 sync 를 안 돌리면 여기서 걸립니다', () => {
    expect(BOARD_TEMPLATE).toBe(templateHtml);
  });

  it('채울 자리가 원본에 전부 있습니다', () => {
    expect(missingPlaceholders()).toEqual([]);
  });

  it('사이트 문서에는 외부로 나가는 태그가 없습니다 (외부 요청 0건)', () => {
    const doc = buildBoardDoc({ theme: 'dark' });
    expect(doc).not.toMatch(/<(?:script[^>]*\ssrc|link[^>]*\shref|img[^>]*\ssrc)=["']https?:/i);
    for (const p of ['__DATA_J__', '__DATA_W__', '__AXES__', '__MAP__', '__SEED__', '<!--FONTS-->']) {
      expect(doc).not.toContain(p);
    }
  });

  it('데이터 안의 </script> 가 문서를 끊지 않습니다', () => {
    const doc = buildBoardDoc();
    const scripts = doc.match(/<script>/g)?.length ?? 0;
    const closes = doc.match(/<\/script>/g)?.length ?? 0;
    expect(closes).toBe(scripts);
  });

  it('전세·월세 행과 인프라 축이 들어 있습니다', () => {
    expect(BOARD_SNAPSHOT.jeonse.length).toBeGreaterThan(0);
    expect(BOARD_SNAPSHOT.wolse.length).toBeGreaterThan(0);
    expect(BOARD_SNAPSHOT.axes.map((a) => a.key)).toEqual(['walk', 'pet', 'shop', 'med', 'bus', 'life']);
  });

  it('행 id 가 판 안에서 겹치지 않습니다 — 소거·메모가 엉뚱한 행에 붙지 않게', () => {
    for (const rows of [BOARD_SNAPSHOT.jeonse, BOARD_SNAPSHOT.wolse]) {
      const ids = rows.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('옮겨 온 첫 설정(seed)이 실제 행을 가리킵니다', () => {
    const ids = new Set(BOARD_SNAPSHOT.jeonse.map((r) => r.id));
    for (const id of Object.keys(BOARD_SNAPSHOT.seed.jeonse.excluded ?? {})) expect(ids.has(id)).toBe(true);
    for (const id of BOARD_SNAPSHOT.seed.jeonse.order ?? []) expect(ids.has(id)).toBe(true);
  });

  it('자동 순위가 1부터 빈틈없이 매겨져 있습니다', () => {
    for (const rows of [BOARD_SNAPSHOT.jeonse, BOARD_SNAPSHOT.wolse]) {
      const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
      expect(ranks).toEqual(ranks.map((_, i) => i + 1));
    }
  });

  it('인프라 자동 점수는 1~5 이거나 비어 있습니다 (0곳을 점수로 만들지 않음)', () => {
    for (const r of [...BOARD_SNAPSHOT.jeonse, ...BOARD_SNAPSHOT.wolse]) {
      for (const v of Object.values(r.auto as Record<string, number | null>)) {
        if (v !== null) expect(v >= 1 && v <= 5).toBe(true);
      }
    }
  });
});
