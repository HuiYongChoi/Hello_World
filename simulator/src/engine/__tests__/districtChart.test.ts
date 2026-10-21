import { describe, expect, it } from 'vitest';
import {
  CHART_PERIODS,
  DISTRICT_CHART_CAVEATS,
  DISTRICT_CHART_MIN,
  DISTRICT_OPTIONS,
  MIN_WINDOW,
  axisLength,
  buildDistrictQuarters,
  chartRows,
  districtSeries,
  movingAverage,
  panWindow,
  periodWindow,
  shortDistrictLabel,
  windowChange,
  zoomWindow,
  type DistrictSeries,
} from '../districtChart';
import { districtGrowthIndex, regionGrowthIndex } from '../growth';
import { MARKET, type MarketComplex, type MarketPoint } from '../market';
import { SALE_AS_OF_Q } from '../temperature';

const cx = (id: string, sizes: { area: number; points: MarketPoint[] }[]): MarketComplex => ({
  id,
  name: id,
  umd: '테스트동',
  regionCode: '00000',
  region: 'changwon',
  buildYear: 2010,
  sizes,
});

describe('구 목록', () => {
  it('매매 스냅샷의 수집 시군구 그대로 — 전국으로 넓히지 않습니다', () => {
    expect(DISTRICT_OPTIONS.map((d) => d.code)).toEqual(MARKET.regions.map((r) => r.code));
    expect(new Set(DISTRICT_OPTIONS.map((d) => d.group))).toEqual(new Set(['창원', '부산', '경기']));
  });

  it('짧은 이름은 마지막 토큰 — 화성시 아래 구가 화성시로 뭉개지지 않습니다', () => {
    expect(shortDistrictLabel('창원시 성산구')).toBe('성산구');
    expect(shortDistrictLabel('경기 화성시 동탄구')).toBe('동탄구');
    expect(shortDistrictLabel('경기 평택시')).toBe('평택시');
  });
});

describe('분기 시계열 접기', () => {
  it('㎡당 중위가는 거래 건수로 가중합니다 — 1건짜리 비싼 칸이 대표값이 되지 않게', () => {
    const list = [
      cx('a', [{ area: 100, points: [{ q: 10, n: 9, price: 3e8 }] }]), // 300만/㎡ × 9건
      cx('b', [{ area: 50, points: [{ q: 10, n: 1, price: 5e8 }] }]), // 1,000만/㎡ × 1건
    ];
    const qs = buildDistrictQuarters(list, { asOfQ: 10, baseYear: 2000, index: null });
    expect(qs).toHaveLength(1);
    expect(qs[0].perSqm).toBe(3e6);
    expect(qs[0].deals).toBe(10);
  });

  it('거래가 없는 분기도 축에 깔고 null 로 둡니다 — 선이 그 분기를 건너뛰는 것이 보여야 합니다', () => {
    const list = [
      cx('a', [
        {
          area: 84,
          points: [
            { q: 10, n: 3, price: 3e8 },
            { q: 12, n: 3, price: 3.3e8 },
          ],
        },
      ]),
    ];
    const qs = buildDistrictQuarters(list, { asOfQ: 12, baseYear: 2000, index: null });
    expect(qs.map((p) => p.q)).toEqual([10, 11, 12]);
    expect(qs[1].perSqm).toBeNull();
    expect(qs[1].deals).toBe(0);
  });

  it('마지막 완결 분기 뒤는 자릅니다 — 신고 지연으로 거래량이 꺾인 것처럼 보이지 않게', () => {
    const list = [
      cx('a', [
        {
          area: 84,
          points: [
            { q: 10, n: 300, price: 3e8 },
            { q: 11, n: 40, price: 3e8 },
          ],
        },
      ]),
    ];
    const qs = buildDistrictQuarters(list, { asOfQ: 10, baseYear: 2000, index: null });
    expect(qs.map((p) => p.q)).toEqual([10]);
  });

  it('거래가 기준보다 적은 분기는 표본 얇음으로 표시합니다', () => {
    const list = [
      cx('a', [
        {
          area: 84,
          points: [
            { q: 10, n: DISTRICT_CHART_MIN.deals, price: 3e8 },
            { q: 11, n: DISTRICT_CHART_MIN.deals - 1, price: 3e8 },
          ],
        },
      ]),
    ];
    const qs = buildDistrictQuarters(list, { asOfQ: 11, baseYear: 2000, index: null });
    expect(qs.map((p) => p.thinPerSqm)).toEqual([false, true]);
  });

  it('연쇄 지수는 시작 = 100 이고, 같은 칸이 10% 오르면 110 입니다', () => {
    // 칸 10개가 매 분기 둘 다 거래 → 이을 칸이 충분
    const list = Array.from({ length: 10 }, (_, i) =>
      cx(`c${i}`, [
        {
          area: 84,
          points: Array.from({ length: 8 }, (_, k) => ({ q: 10 + k, n: 3, price: 3e8 * (1 + i * 0.05) * (k >= 1 ? 1.1 : 1) })),
        },
      ])
    );
    const qs = buildDistrictQuarters(list, { asOfQ: 17, baseYear: 2000 });
    expect(qs[0].index).toBeCloseTo(100);
    expect(qs[1].index).toBeCloseTo(110);
    expect(qs[7].index).toBeCloseTo(110);
    expect(qs[0].links).toBeNull();
    expect(qs[1].links).toBe(10);
    expect(qs[1].thinIndex).toBe(10 < DISTRICT_CHART_MIN.links);
  });
});

describe('실제 스냅샷', () => {
  it('15개 구 모두 마지막 완결 분기까지 시계열이 있습니다', () => {
    for (const d of DISTRICT_OPTIONS) {
      const s = districtSeries(d.code);
      expect(s, d.label).not.toBeNull();
      expect(s!.quarters[s!.quarters.length - 1].q).toBe(SALE_AS_OF_Q);
      expect(s!.quarters.every((p) => p.perSqm == null || p.perSqm > 0)).toBe(true);
    }
  });

  it('구 지수는 권역 지수와 같은 규칙입니다 — 권역 하나뿐인 구를 모은 것과 맞물립니다', () => {
    const seongsan = districtGrowthIndex('48123')!;
    const changwon = regionGrowthIndex('changwon')!;
    expect(seongsan.points[0].q).toBe(changwon.points[0].q);
    expect(seongsan.scope).toBe('sgg:48123');
    // 구 지수 칸 수 합 = 권역 칸 수 (칸은 단지·평형이라 구 사이에 겹치지 않음)
    const sum = DISTRICT_OPTIONS.filter((d) => d.group === '창원').reduce((a, d) => a + districtGrowthIndex(d.code)!.cells, 0);
    expect(sum).toBe(changwon.cells);
  });

  it('잘못된 코드는 null — 없는 구를 빈 차트로 그리지 않습니다', () => {
    expect(districtSeries('99999')).toBeNull();
  });
});

describe('이동평균', () => {
  it('직전 4분기 평균, 앞 세 칸과 빈 값이 섞인 창은 null', () => {
    expect(movingAverage([1, 2, 3, 4, 5])).toEqual([null, null, null, 2.5, 3.5]);
    expect(movingAverage([1, 2, null, 4, 5, 6, 7])).toEqual([null, null, null, null, null, null, 5.5]);
  });
});

describe('기간 · 확대 · 이동', () => {
  it('기간 버튼은 끝을 마지막 분기에 붙입니다', () => {
    expect(periodWindow('3y', 42)).toEqual([30, 41]);
    expect(periodWindow('all', 42)).toEqual([0, 41]);
    expect(periodWindow('5y', 10)).toEqual([0, 9]);
    expect(CHART_PERIODS.map((p) => p.key)).toContain('all');
  });

  it('확대해도 초점 분기는 화면의 같은 자리에 머뭅니다', () => {
    const z = zoomWindow([0, 40], 20, 0.5, 42);
    expect(z[1] - z[0] + 1).toBe(Math.round(41 * 0.5));
    expect(z[0]).toBeLessThanOrEqual(20);
    expect(z[1]).toBeGreaterThanOrEqual(20);
    expect(Math.abs((20 - z[0]) / (z[1] - z[0]) - 0.5)).toBeLessThan(0.06);
  });

  it(`확대는 ${MIN_WINDOW}분기 밑으로, 축소는 전체 밖으로 안 갑니다`, () => {
    let w: [number, number] = [0, 41];
    for (let i = 0; i < 20; i++) w = zoomWindow(w, 30, 0.5, 42);
    expect(w[1] - w[0] + 1).toBe(MIN_WINDOW);
    for (let i = 0; i < 20; i++) w = zoomWindow(w, 30, 2, 42);
    expect(w).toEqual([0, 41]);
  });

  it('이동은 양 끝에서 멈추고 창 폭은 그대로입니다', () => {
    expect(panWindow([10, 19], -50, 42)).toEqual([0, 9]);
    expect(panWindow([10, 19], 50, 42)).toEqual([32, 41]);
    expect(panWindow([10, 19], 3, 42)).toEqual([13, 22]);
  });
});

describe('차트 행', () => {
  const series = (code: string, values: (number | null)[]): DistrictSeries => ({
    code,
    label: code,
    short: code,
    group: '창원',
    quarters: values.map((v, i) => ({
      q: 64 + i,
      label: `q${i}`,
      deals: 200,
      perSqm: v,
      index: v,
      links: 50,
      thinPerSqm: false,
      thinIndex: false,
    })),
  });

  it('시작 = 100 정규화는 보이는 창의 첫 값이 기준입니다 — 다른 수준의 두 구가 같은 출발선에 섭니다', () => {
    const a = series('A', [100, 200, 300, 400, 500, 600]);
    const b = series('B', [10, 20, 30, 40, 50, 60]);
    const rows = chartRows([a, b], { metric: 'perSqm', window: [2, 5], normalize: true });
    expect(rows).toHaveLength(4);
    expect(rows[0].v_A).toBeCloseTo(100);
    expect(rows[0].v_B).toBeCloseTo(100);
    expect(rows[3].v_A).toBeCloseTo(200);
    expect(rows[3].v_B).toBeCloseTo(200);
    // 정규화 전 값도 같이 — 툴팁이 원 단위를 보여 줍니다
    expect(rows[0].raw_A).toBe(300);
  });

  it('이동평균은 자르기 전에 잽니다 — 창 첫 분기도 창 밖 세 분기를 씁니다', () => {
    const a = series('A', [100, 200, 300, 400, 500, 600]);
    const rows = chartRows([a], { metric: 'perSqm', window: [3, 5], normalize: false });
    expect(rows[0].ma_A).toBeCloseTo(250);
    const norm = chartRows([a], { metric: 'perSqm', window: [3, 5], normalize: true });
    // 값과 같은 기준(창 첫 값 400)으로 나눕니다
    expect(norm[0].ma_A).toBeCloseTo(62.5);
  });

  it('창 안 변화와 연 환산 — 1년 미만이면 연 환산을 내지 않습니다', () => {
    const a = series('A', [100, 110, 121, 133.1, 146.41]);
    const all = windowChange(a.quarters, 'perSqm', [0, 4])!;
    expect(all.change).toBeCloseTo(0.4641);
    expect(all.years).toBe(1);
    expect(all.cagr).toBeCloseTo(0.4641);
    expect(windowChange(a.quarters, 'perSqm', [0, 2])!.cagr).toBeNull();
    expect(axisLength([a])).toBe(5);
  });
});

describe('못 하는 것', () => {
  it('구성 변화와 연쇄 드리프트를 둘 다 적습니다', () => {
    const text = DISTRICT_CHART_CAVEATS.join(' ');
    expect(text).toContain('구성');
    expect(text).toContain('드리프트');
    expect(text).toContain('완결 분기');
  });

  it('점수나 합친 값을 내보내지 않습니다', () => {
    const s = districtSeries('48123')!;
    const keys = Object.keys(s.quarters[0]);
    expect(keys).not.toContain('score');
    expect(keys).not.toContain('total');
  });
});
