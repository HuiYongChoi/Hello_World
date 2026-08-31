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

describe('내 조건으로 읽기 — 필요소득', () => {
  const ctx = {
    termYears: 30,
    existingMonthlyDebt: 0,
    isFirstTimeValid: true,
    assessedIncome: 60000000,
  };

  it('컨텍스트를 주면 상품마다 필요소득 절이 붙습니다', () => {
    for (const p of RULES.products) {
      const plain = findHandbookEntry(p.id)!;
      const withCtx = findHandbookEntry(p.id, ctx)!;
      const hasCap = p.limits.cap !== undefined || p.limits.cap_first_time !== undefined;
      expect(withCtx.sections.length).toBe(plain.sections.length + (hasCap ? 1 : 0));
    }
  });

  /** 비율만 보여 주면 크고 작음을 판단할 기준이 없습니다. 원 단위여야 답이 됩니다. */
  it('절대상한과 생애최초 상한을 따로 냅니다', () => {
    const e = findHandbookEntry('bogeumjari_first', ctx)!;
    const sec = e.sections.find((x) => x.title.startsWith('이 한도를 받으려면'))!;
    const keys = sec.rows.map((r) => r.key);
    expect(keys).toContain('need_cap');
    expect(keys).toContain('need_cap_first_time');
    // 더 큰 한도를 받으려면 더 벌어야 합니다.
    const need = (k: string) => sec.rows.find((r) => r.key === k)!.value;
    expect(need('need_cap_first_time') > need('need_cap')).toBe(true);
  });

  it('기존 부채가 있으면 필요소득이 올라갑니다', () => {
    const row = (c: typeof ctx) =>
      findHandbookEntry('bogeumjari_first', c)!
        .sections.find((x) => x.title.startsWith('이 한도를 받으려면'))!
        .rows.find((r) => r.key === 'need_cap')!.value;
    expect(row({ ...ctx, existingMonthlyDebt: 1000000 })).not.toBe(row(ctx));
  });

  /**
   * 정책상품은 소득이 낮아야 자격이 나오고 높아야 한도가 나옵니다. 필요소득이
   * 자격 상한을 넘으면 그 한도에는 어떤 소득으로도 못 갑니다.
   */
  it('필요소득이 자격 상한을 넘으면 그렇게 적습니다', () => {
    const heavy = { ...ctx, existingMonthlyDebt: 3000000 };
    const sec = findHandbookEntry('bogeumjari_first', heavy)!.sections.find((x) =>
      x.title.startsWith('이 한도를 받으려면')
    )!;
    const note = sec.rows.find((r) => r.key === 'need_cap')!.note ?? '';
    expect(note).toContain('자격 상한');
    expect(note).toContain('상품을 잃습니다');
  });

  it('설명서 문구에 마크다운 별표를 남기지 않습니다 — 화면은 평문으로 그립니다', () => {
    for (const e of handbookEntries(ctx)) {
      const text = [
        e.headline,
        ...e.watchOuts,
        ...e.sections.flatMap((s) => [s.title, ...s.rows.flatMap((r) => [r.label, r.value, r.note ?? ''])]),
      ].join(' ');
      expect(text).not.toContain('**');
    }
  });
});
