import { describe, expect, it } from 'vitest';
import {
  HANDBOOK_CATEGORY_LABEL,
  HANDBOOK_META,
  findHandbookEntry,
  handbookEntries,
} from '../handbook';
import { RULES } from '../rules';

const entries = handbookEntries();

describe('대출 설명서', () => {
  it('룰셋의 모든 상품이 설명서에 있습니다', () => {
    const ids = new Set(entries.map((e) => e.id));
    for (const p of RULES.products) expect(ids.has(p.id)).toBe(true);
  });

  it('매매·전세·청약과 전제가 모두 들어 있습니다', () => {
    const cats = new Set(entries.map((e) => e.category));
    for (const c of Object.keys(HANDBOOK_CATEGORY_LABEL)) expect(cats.has(c as never)).toBe(true);
  });

  /**
   * 설명서가 조용히 빠뜨리면 "이 상품엔 그 조건이 없구나" 로 잘못 읽힙니다.
   * 룰셋에 있는 항목은 라벨을 못 붙였더라도 반드시 화면에 나와야 합니다.
   */
  it('상품의 룰셋 항목을 하나도 빠뜨리지 않습니다', () => {
    for (const p of RULES.products) {
      const entry = findHandbookEntry(p.id)!;
      const shown = new Set(entry.sections.flatMap((s) => s.rows.map((r) => r.key)));
      const expected = [
        ...Object.entries(p.eligibility),
        ...Object.entries(p.limits),
        ...Object.entries(p.rate),
        ...Object.entries(p.obligations),
        ...Object.entries(p.features ?? {}),
      ].filter(([, v]) => v !== undefined && v !== null);
      for (const [key] of expected) expect(shown.has(key)).toBe(true);
      expect(shown.size).toBe(expected.length);
    }
  });

  it('라벨을 못 붙인 항목은 표시가 남습니다 — 나중에 붙이라고', () => {
    const unlabeled = entries.flatMap((e) =>
      e.sections.flatMap((s) => s.rows.filter((r) => r.unlabeled).map((r) => `${e.id}.${r.key}`))
    );
    // 지금은 전부 라벨이 붙어 있습니다. 룰셋에 새 항목이 생기면 여기서 걸립니다.
    expect(unlabeled).toEqual([]);
  });

  it('모든 항목에 값이 있습니다 — 빈칸은 규정이 없다는 뜻으로 읽힙니다', () => {
    for (const e of entries) {
      expect(e.headline.length).toBeGreaterThan(0);
      for (const s of e.sections) {
        expect(s.rows.length).toBeGreaterThan(0);
        for (const r of s.rows) expect(r.value.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('상품마다 놓치면 손해 보는 것이 붙어 있습니다', () => {
    for (const e of entries) expect(e.watchOuts.length).toBeGreaterThan(0);
  });

  it('DSR 면제 여부가 상품마다 드러납니다 — 한도 차이의 가장 큰 이유입니다', () => {
    for (const p of RULES.products) {
      const entry = findHandbookEntry(p.id)!;
      const text = entry.watchOuts.join(' ');
      expect(text).toContain('DSR');
    }
  });

  it('지역 = 대출조건 전제가 첫 항목입니다', () => {
    expect(entries[0].category).toBe('premise');
    expect(entries[0].sections[0].rows.length).toBe(RULES.regions.length);
  });

  it('전세 설명서에 한도·금리·갱신 상한이 있습니다', () => {
    const e = findHandbookEntry('jeonse-loan')!;
    const keys = new Set(e.sections.flatMap((s) => s.rows.map((r) => r.key)));
    for (const k of ['ltvCap', 'absoluteCap', 'rate', 'renewalCapRatio', 'conversionRateMax'])
      expect(keys.has(k)).toBe(true);
  });

  it('기준일과 면책이 상시 노출됩니다', () => {
    expect(HANDBOOK_META.effectiveFrom).toBe(RULES.effectiveFrom);
    expect(HANDBOOK_META.version).toBe(RULES.version);
    expect(HANDBOOK_META.disclaimer.length).toBeGreaterThan(10);
  });

  it('없는 id 는 null 입니다', () => {
    expect(findHandbookEntry('없는상품')).toBeNull();
  });
});
