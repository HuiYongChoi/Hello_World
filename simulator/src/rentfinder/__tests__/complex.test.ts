import { describe, expect, it } from 'vitest';
import { MARKET, THIN_DEAL_COUNT } from '../../engine/market';
import { BOARD_SNAPSHOT, buildBoardDoc, type BoardSignals } from '../board/boardDoc';
import { BOARD_TEMPLATE } from '../board/template';
import { complexDetail, pickArea } from '../complex';
import { COMPLEXES } from '../data';

const rentIds = new Set(COMPLEXES.map((c) => c.id));

describe('단지 상세 — 후보판 줄 뒤의 추이', () => {
  it('머리 전세가율이 후보판 스냅샷 그 줄과 같습니다 (같은 함수를 부름)', () => {
    let checked = 0;
    for (const row of BOARD_SNAPSHOT.jeonse) {
      const d = complexDetail(row.cx, row.area);
      expect(d).not.toBeNull();
      if (row.ratio == null) {
        expect(d!.headline.ratio).toBeNull();
        continue;
      }
      expect(d!.headline.ratio).toBeCloseTo(row.ratio, 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('전세가율 추이의 모든 분기는 매매·전세 양쪽에 점이 있고, 한쪽이 3건 미만이면 thin 입니다', () => {
    let thinSeen = 0;
    for (const row of BOARD_SNAPSHOT.jeonse) {
      const d = complexDetail(row.cx, row.area)!;
      const sale = new Map(d.sale.map((p) => [p.q, p]));
      const jeonse = new Map(d.jeonse.map((p) => [p.q, p]));
      for (const r of d.ratioSeries) {
        const s = sale.get(r.q)!;
        const j = jeonse.get(r.q)!;
        expect(s).toBeDefined();
        expect(j).toBeDefined();
        expect(r.ratio).toBeCloseTo(j.deposit / s.price, 9);
        expect(r.thin).toBe(s.n < THIN_DEAL_COUNT || j.n < THIN_DEAL_COUNT);
        if (r.thin) thinSeen++;
      }
    }
    expect(thinSeen).toBeGreaterThan(0);
  });

  it('매매 스냅샷에만 있는 단지는 rent 가 비었다고 하고 예외 없이 돕니다 · 없는 id 는 null', () => {
    const busan = MARKET.complexes.find((c) => c.regionCode.startsWith('26') && !rentIds.has(c.id) && c.sizes.length > 0)!;
    const d = complexDetail(busan.id);
    expect(d).not.toBeNull();
    expect(d!.missing).toContain('rent');
    expect(d!.missing).not.toContain('sale');
    expect(d!.jeonse).toEqual([]);
    expect(d!.ratioSeries).toEqual([]);
    expect(d!.headline.ratio).toBeNull();
    expect(d!.sale.length).toBeGreaterThan(0);
    expect(complexDetail('없는-단지')).toBeNull();
  });

  it('평형별 표는 면적 오름차순이고 두 스냅샷 평형이 모두 들어갑니다', () => {
    const both = COMPLEXES.filter((c) => MARKET.complexes.some((m) => m.id === c.id)).slice(0, 60);
    for (const c of both) {
      const d = complexDetail(c.id)!;
      const areas = d.sizes.map((s) => s.area);
      expect([...areas].sort((a, b) => a - b)).toEqual(areas);
      for (const s of c.sizes) expect(areas).toContain(s.area);
      const mk = MARKET.complexes.find((m) => m.id === c.id)!;
      for (const s of mk.sizes) expect(areas.some((a) => Math.abs(a - s.area) <= 2)).toBe(true);
    }
  });

  it('신호가 없으면 null(모름), 있는데 그 줄이 없으면 빈 배열(없음)입니다', () => {
    const row = BOARD_SNAPSHOT.jeonse[0];
    expect(complexDetail(row.cx, row.area)!.signals).toBeNull();
    expect(complexDetail(row.cx, row.area, null)!.signals).toBeNull();
    const empty: BoardSignals = { kind: 'masan-jeonse-signals', asOf: '2026-10-21', windowMonths: 3, rows: {} };
    expect(complexDetail(row.cx, row.area, empty)!.signals).toEqual([]);
    const some: BoardSignals = {
      ...empty,
      rows: {
        [row.id]: {
          upcoming: [
            { end: '2027-02', gap: 4, floor: '7', dep: 3e8, type: '갱신', locked: true },
            { end: '2026-12', gap: 2, floor: '3', dep: 3e8, type: '신규', locked: false },
          ],
          recent: [],
        },
      },
    };
    expect(complexDetail(row.cx, row.area, some)!.signals!.map((u) => u.end)).toEqual(['2026-12', '2027-02']);
  });

  it('기본 평형은 전월세 거래가 가장 많은 평형입니다', () => {
    for (const c of COMPLEXES.slice(0, 80)) {
      if (!c.sizes.length) continue;
      const max = Math.max(...c.sizes.map((s) => s.n));
      const a = pickArea(c.id)!;
      expect(c.sizes.find((s) => s.area === a)!.n).toBe(max);
      expect(complexDetail(c.id)!.area).toBe(a);
    }
  });

  it('최근 분기는 6개이고 매매 미완결 분기를 표시합니다', () => {
    const row = BOARD_SNAPSHOT.jeonse[0];
    const d = complexDetail(row.cx, row.area)!;
    expect(d.recentQuarters).toHaveLength(6);
    const qs = d.recentQuarters.map((r) => r.q);
    expect(qs).toEqual(qs.map((_, i) => qs[0] + i));
    expect(d.recentQuarters.filter((r) => r.salePartial).every((r) => r.q > 105)).toBe(true);
  });

  it('후보판 "상세" 버튼은 사이트 문서에서만 켜지고, 원본은 받아 줄 부모가 없으면 그리지 않습니다', () => {
    expect(buildBoardDoc()).toContain('"detail":true');
    expect(BOARD_TEMPLATE).toContain("PROFILE && PROFILE.detail");
    expect(BOARD_TEMPLATE).toContain('window.parent !== window');
    expect(BOARD_TEMPLATE).toContain("kind: 'board:open-complex'");
  });
});
