import { describe, expect, it } from 'vitest';
import { MARKET, type MarketComplex, type MarketPoint } from '../market';
import {
  NEW_BUILD_YEARS,
  TEMPERATURE_CAVEATS,
  TEMPERATURE_MIN,
  dealsChange,
  districtTemperature,
  lastCompleteQ,
  regionTemperature,
  saleTemperature,
} from '../temperature';

const cx = (id: string, buildYear: number, sizes: { area: number; points: MarketPoint[] }[]): MarketComplex => ({
  id,
  name: id,
  umd: '테스트동',
  regionCode: '00000',
  region: 'changwon',
  buildYear,
  sizes,
});

/** 칸 k개 — 각 칸이 asOf 와 asOf−4 에 거래를 가진다 */
function cells(k: number, asOfQ: number, ratio: (i: number) => number, scale = 1): MarketComplex[] {
  return Array.from({ length: k }, (_, i) =>
    cx(`c${i}`, 2000, [
      {
        area: 84,
        points: [
          { q: asOfQ - 4, n: 3, price: 3e8 * scale * (1 + i * 0.1) },
          { q: asOfQ, n: 3, price: 3e8 * scale * (1 + i * 0.1) * ratio(i) },
        ],
      },
    ])
  );
}

describe('마지막 완결 분기', () => {
  it('월이 3·6·9·12 가 아니면 직전 분기까지만 믿습니다', () => {
    expect(lastCompleteQ('202608', 2000)).toBe(105);
    expect(lastCompleteQ('202609', 2000)).toBe(106);
    expect(lastCompleteQ('202612', 2000)).toBe(107);
  });

  it('스냅샷 창이 그 분기에서 끝납니다 — 두 달짜리 분기를 넣지 않습니다', () => {
    const t = districtTemperature('48127');
    expect(t.window.recent[1]).toBe(lastCompleteQ(MARKET.range.to, MARKET.quarterBaseYear));
    expect(t.window.label).toBe('2025Q3~2026Q2 대 2024Q3~2025Q2');
    expect(t.deals.series).toHaveLength(12);
    expect(t.deals.series.at(-1)!.q).toBe(105);
  });
});

describe('거래량 변화', () => {
  it('recent/prior − 1 이고, 이전 창이 10건 미만이면 null', () => {
    expect(dealsChange(120, 100).change).toBeCloseTo(0.2, 10);
    expect(dealsChange(5, TEMPERATURE_MIN.priorDeals - 1).change).toBeNull();
    expect(dealsChange(5, TEMPERATURE_MIN.priorDeals).change).toBeCloseTo(-0.5, 10);
  });

  it('단지 묶음에서 최근 4분기·이전 4분기 거래를 셉니다', () => {
    const asOfQ = 105;
    const pts: MarketPoint[] = [];
    for (let q = 98; q <= 105; q++) pts.push({ q, n: q >= 102 ? 6 : 3, price: 3e8 });
    pts.push({ q: 106, n: 50, price: 3e8 }); // 미완결 분기는 빠져야 합니다
    const t = saleTemperature([cx('a', 2000, [{ area: 84, points: pts }])], { asOfQ });
    expect(t.deals.recent).toBe(24);
    expect(t.deals.prior).toBe(12);
    expect(t.deals.change).toBeCloseTo(1, 10);
  });
});

describe('매매 1년 변화 — 같은 칸 비율의 중위', () => {
  it('모든 칸 가격을 두 배 해도 값이 그대로입니다 (수준 차가 아님)', () => {
    const r = (i: number) => 1 + 0.01 * i;
    const a = saleTemperature(cells(7, 105, r), { asOfQ: 105 });
    const b = saleTemperature(cells(7, 105, r, 2), { asOfQ: 105 });
    expect(a.price1y).not.toBeNull();
    expect(a.price1y!.v).toBeCloseTo(b.price1y!.v, 12);
    expect(a.price1y!.v).toBeCloseTo(0.03, 10); // 중위 칸(i=3)
    expect(a.price1y!.cells).toBe(7);
  });

  it(`칸이 ${TEMPERATURE_MIN.changeCells}개 미만이면 null`, () => {
    const t = saleTemperature(cells(TEMPERATURE_MIN.changeCells - 1, 105, () => 1.1), { asOfQ: 105 });
    expect(t.price1y).toBeNull();
  });
});

describe('신축 비중', () => {
  it(`최근 4분기 거래 중 준공 ${NEW_BUILD_YEARS}년 이내 단지 비중`, () => {
    const p = (n: number): MarketPoint[] => [{ q: 104, n, price: 3e8 }];
    const t = saleTemperature(
      [cx('new', 2022, [{ area: 84, points: p(3) }]), cx('old', 1995, [{ area: 84, points: p(9) }])],
      { asOfQ: 105 }
    );
    expect(t.newShare!.v).toBeCloseTo(0.25, 10);
    expect(t.newShare!.deals).toBe(12);
  });
});

describe('합산 금지', () => {
  /** 이 저장소의 설계 원칙 — rating.ts 와 같은 금지입니다 */
  it('결과에 score·total·index·temperature 숫자 필드가 없습니다', () => {
    const banned = new Set(['score', 'total', 'index', 'temperature', 'average']);
    const walk = (o: unknown, path: string) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if (banned.has(k)) expect.fail(`${path}.${k} 필드가 있습니다`);
        walk(v, `${path}.${k}`);
      }
    };
    walk(districtTemperature('48123'), 'district');
    walk(regionTemperature('busan'), 'region');
  });
});

describe('15개 시군구', () => {
  it('모든 수집 시군구에서 예외 없이 돕니다', () => {
    expect(MARKET.regions).toHaveLength(15);
    for (const r of MARKET.regions) {
      const t = districtTemperature(r.code);
      expect(t.deals.recent).toBeGreaterThan(0);
      if (t.newShare) {
        expect(t.newShare.v).toBeGreaterThanOrEqual(0);
        expect(t.newShare.v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('못 하는 것', () => {
  it('신고 지연·호가 없음을 적습니다', () => {
    const all = TEMPERATURE_CAVEATS.join(' ');
    expect(all).toContain('신고 지연');
    expect(all).toContain('호가 없음');
  });
});
