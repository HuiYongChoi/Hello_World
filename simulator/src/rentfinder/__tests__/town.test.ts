import { describe, expect, it } from 'vitest';
import { MARKET, type MarketComplex } from '../../engine/market';
import { COMPLEXES, type RentComplex } from '../data';
import {
  TOWN_CAVEATS,
  TOWN_MIN,
  jeonseRatioSeries,
  jeonseTemperature,
  townComplexes,
  townRows,
  townRowsFrom,
} from '../town';

const HOEWON = '48127';

const rentCx = (id: string, umd: string, area: number, deposit: number): RentComplex => ({
  id,
  name: id,
  umd,
  road: '',
  regionCode: '99999',
  buildYear: 2010,
  sizes: [
    {
      area,
      n: 6,
      lastYm: '202609',
      floorMin: 1,
      floorMax: 10,
      renewalShare: 0,
      jeonse: { n: 6, deposit, rent: 0 },
      wolse: null,
      trend: [
        { q: 104, n: 3, deposit },
        { q: 105, n: 3, deposit },
      ],
    },
  ],
});
const saleCx = (id: string, umd: string, area: number, price: number): MarketComplex => ({
  id,
  name: id,
  umd,
  regionCode: '99999',
  region: 'changwon',
  buildYear: 2010,
  sizes: [{ area, points: [{ q: 103, n: 4, price }, { q: 104, n: 4, price }] }],
});

describe('동네 시세판 — 동별 줄', () => {
  const rows = townRows({ regionCodes: [HOEWON], level: 'umd' });

  it('마산회원에 내서읍 삼계리·양덕동 줄이 있고 단지 수가 두 스냅샷 합집합입니다', () => {
    for (const umd of ['내서읍 삼계리', '양덕동']) {
      const r = rows.find((x) => x.umd === umd);
      expect(r, umd).toBeTruthy();
      const ids = new Set([
        ...COMPLEXES.filter((c) => c.regionCode === HOEWON && c.umd === umd).map((c) => c.id),
        ...MARKET.complexes.filter((c) => c.regionCode === HOEWON && c.umd === umd).map((c) => c.id),
      ]);
      expect(r!.complexes).toBe(ids.size);
    }
  });

  it(`짝지은 칸이 ${TOWN_MIN.ratioCells}개 미만인 동은 전세가율이 null 입니다`, () => {
    const rent = [rentCx('a', '작은동', 59, 2e8), rentCx('b', '작은동', 84, 2.5e8)];
    const sale = [saleCx('a', '작은동', 59, 3e8), saleCx('b', '작은동', 84, 4e8)];
    const [small] = townRowsFrom({ regionCodes: ['99999'], level: 'umd' }, rent, sale);
    expect(small.ratio).toBeNull();
    const more = [...rent, rentCx('c', '작은동', 74, 2e8)];
    const moreSale = [...sale, saleCx('c', '작은동', 74, 4e8)];
    const [big] = townRowsFrom({ regionCodes: ['99999'], level: 'umd' }, more, moreSale);
    expect(big.ratio!.cells).toBe(3);
    expect(big.ratio!.v).toBeCloseTo(0.625, 10); // 2/3 · 0.625 · 0.5 의 중위
  });

  it('거래량 창이 스냅샷마다의 마지막 완결 분기에서 끝납니다', () => {
    expect(rows[0].windows.rent).toBe('2025Q4~2026Q3 대 2024Q4~2025Q3');
    expect(rows[0].windows.sale).toBe('2025Q3~2026Q2 대 2024Q3~2025Q2');
  });

  it('매매 1년 변화는 가격 비율의 중위입니다 — 모든 칸 가격을 2배 해도 그대로', () => {
    const doubled = MARKET.complexes.map((c) => ({
      ...c,
      sizes: c.sizes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, price: p.price * 2 })) })),
    }));
    const a = townRowsFrom({ regionCodes: [HOEWON], level: 'sgg' }, COMPLEXES, MARKET.complexes)[0];
    const b = townRowsFrom({ regionCodes: [HOEWON], level: 'sgg' }, COMPLEXES, doubled)[0];
    expect(a.salePrice1y).not.toBeNull();
    expect(b.salePrice1y!.v).toBeCloseTo(a.salePrice1y!.v, 12);
    expect(b.salePerSqm!.v).toBeCloseTo(a.salePerSqm!.v * 2, 6);
  });

  it('신축 비중은 0~1 이고 분모는 전월세 2년 거래 수입니다', () => {
    for (const r of rows) {
      if (!r.newShare) continue;
      expect(r.newShare.v).toBeGreaterThanOrEqual(0);
      expect(r.newShare.v).toBeLessThanOrEqual(1);
      const deals = COMPLEXES.filter((c) => c.regionCode === HOEWON && c.umd === r.umd).reduce(
        (a, c) => a + c.sizes.reduce((b, s) => b + s.n, 0),
        0
      );
      expect(r.newShare.deals).toBe(deals);
    }
  });

  it('구 줄의 전세 2년 거래 수는 그 구 동 줄들의 합입니다', () => {
    const [gu] = townRows({ regionCodes: [HOEWON], level: 'sgg' });
    expect(gu.umd).toBeNull();
    expect(gu.jeonseDeals2y).toBe(rows.reduce((a, r) => a + r.jeonseDeals2y, 0));
    expect(gu.wolseDeals2y).toBe(rows.reduce((a, r) => a + r.wolseDeals2y, 0));
  });

  it('기본 정렬은 전세 2년 거래 수 내림차순입니다', () => {
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].jeonseDeals2y).toBeGreaterThanOrEqual(rows[i].jeonseDeals2y);
  });

  it('못 하는 것에 "매물 아님"·"월세 추이 없음" 이 있습니다', () => {
    const all = TOWN_CAVEATS.join(' ');
    expect(all).toContain('매물 아님');
    expect(all).toContain('월세 추이 없음');
  });
});

describe('동 펼침', () => {
  it('두 스냅샷 단지가 다 나오고, 전세가율은 후보판과 같은 계산입니다', () => {
    const list = townComplexes(HOEWON, '양덕동');
    const ids = new Set([
      ...COMPLEXES.filter((c) => c.regionCode === HOEWON && c.umd === '양덕동').map((c) => c.id),
      ...MARKET.complexes.filter((c) => c.regionCode === HOEWON && c.umd === '양덕동').map((c) => c.id),
    ]);
    expect(new Set(list.map((c) => c.cx))).toEqual(ids);
    for (const c of list) for (let i = 1; i < c.sizes.length; i++) expect(c.sizes[i - 1].area).toBeLessThan(c.sizes[i].area);
  });
});

describe('시장 온도 — 전세 축', () => {
  it('전세가율 추세는 8분기이고, 매매가 미완결인 2026Q3 은 비웁니다', () => {
    const s = jeonseRatioSeries([HOEWON, '48125']);
    expect(s.map((p) => p.q)).toEqual([99, 100, 101, 102, 103, 104, 105, 106]);
    expect(s.at(-1)!.ratio).toBeNull();
    for (const p of s) if (p.ratio !== null) expect(p.cells).toBeGreaterThanOrEqual(TOWN_MIN.seriesCells);
  });

  it('칸이 모자라는 분기는 값을 내지 않습니다 (의령)', () => {
    for (const p of jeonseRatioSeries(['48720'])) if (p.cells < TOWN_MIN.seriesCells) expect(p.ratio).toBeNull();
  });

  it('최근 전세가율은 값이 있는 마지막 분기이고 4분기 전 값을 같이 냅니다', () => {
    const t = jeonseTemperature([HOEWON, '48125']);
    expect(t.ratioLatest).not.toBeNull();
    expect(t.ratioLatest!.q).toBe(105);
    expect(t.ratioLatest!.prevQ).toBe(101);
    expect(t.deals.series).toHaveLength(8);
  });
});
