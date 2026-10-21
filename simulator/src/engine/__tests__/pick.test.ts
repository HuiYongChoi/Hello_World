import { describe, expect, it } from 'vitest';
import { complexDetail } from '../../rentfinder/complex';
import { MARKET, findComplex, pooledMedian } from '../market';
import { PICK_POOL_QUARTERS, PICK_WINDOW, areaNeedsCheck, draftToProperty, pickCandidates, pickFromMarket, pickSizes } from '../pick';
import { SALE_AS_OF_Q } from '../temperature';

describe('시중 물건 고르기', () => {
  it('성산구 단지 → 창원 · 창원시 성산구, 준공·면적은 스냅샷 그대로', () => {
    const d = pickFromMarket('48123-171', 85)!;
    expect(d.region).toBe('changwon');
    expect(d.sigungu).toBe('창원시 성산구');
    expect(d.builtYear).toBe(findComplex('48123-171')!.buildYear);
    expect(d.areaSqm).toBe(85);
    expect(d.link).toEqual({ complexId: '48123-171', area: 85 });
    expect(d.autoFill).toBe(true);
  });

  it('세대수는 지어내지 않고 0 — 화면이 직접 입력을 요구합니다', () => {
    expect(pickFromMarket('48123-171', 85)!.householdCount).toBe(0);
    expect(draftToProperty(pickFromMarket('48123-171', 85)!).householdCount).toBe(0);
  });

  it('최근 4분기 거래가 3건 이상이면 가격과 구간 라벨, thin 아님', () => {
    const d = pickFromMarket('48123-171', 85)!;
    expect(d.price).toBeGreaterThan(0);
    expect(d.priceBasis).toMatchObject({ price: d.price, window: PICK_WINDOW, thin: false });
    expect(d.priceBasis!.n).toBeGreaterThanOrEqual(3);
    expect(PICK_WINDOW).toMatch(/^\d{4}Q\d~\d{4}Q\d$/);
  });

  it('3건 미만이면 가격은 채우되 thin', () => {
    const d = pickFromMarket('48123-1', 57)!;
    expect(d.price).toBeGreaterThan(0);
    expect(d.priceBasis!.thin).toBe(true);
    expect(d.priceBasis!.n).toBeLessThan(3);
  });

  it('0건이면 가격 null — 빈 물건 기본가격이 남지 않게 0 으로 넘깁니다', () => {
    const d = pickFromMarket('48123-75', 75)!;
    expect(d.price).toBeNull();
    expect(d.priceBasis).toBeNull();
    expect(draftToProperty(d).price).toBe(0);
  });

  it('스냅샷에 없는 단지·평형은 null', () => {
    expect(pickFromMarket('없는-단지', 84)).toBeNull();
    expect(pickFromMarket('48123-171', 999)).toBeNull();
  });

  it('지역 필터가 다른 권역 단지를 뺍니다', () => {
    const cw = pickCandidates('', { region: 'changwon', limit: 500 });
    expect(cw.length).toBeGreaterThan(0);
    expect(cw.every((c) => c.region === 'changwon')).toBe(true);
    const ss = pickCandidates('', { districtCode: '48123', limit: 500 });
    expect(ss.every((c) => c.regionCode === '48123')).toBe(true);
    // 검색어가 있어도 필터는 뒤에 걸립니다
    const q = pickCandidates('푸르지오', { region: 'busan' });
    expect(q.every((c) => c.region === 'busan')).toBe(true);
  });

  it('평형 선택지는 거래 많은 순, 85㎡ 근처는 경계 표시', () => {
    const sizes = pickSizes('48125-555');
    expect(sizes.map((s) => s.area).sort()).toEqual([84, 85]);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i - 1].deals).toBeGreaterThanOrEqual(sizes[i].deals);
    expect(sizes.every((s) => s.boundary)).toBe(true);
    expect(areaNeedsCheck(59)).toBe(false);
  });
});

describe('pooledMedian — 단지 상세와 같은 규칙', () => {
  it('단지 상세 평형별 매매 묶음과 같은 값', () => {
    let compared = 0;
    for (const cx of ['48125-555', '48127-139', '48123-90']) {
      const detail = complexDetail(cx);
      const mk = findComplex(cx)!;
      for (const row of detail!.sizes) {
        const size = mk.sizes.find((s) => s.area === row.area);
        if (!size || !row.sale) continue;
        expect(pooledMedian(size.points, SALE_AS_OF_Q, PICK_POOL_QUARTERS)).toEqual(row.sale);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('구간 밖 분기는 안 섞습니다', () => {
    const pts = [
      { q: 10, n: 5, price: 100 },
      { q: 11, n: 1, price: 900 },
      { q: 12, n: 1, price: 300 },
    ];
    expect(pooledMedian(pts, 12, 2)).toEqual({ price: 300, n: 2 });
    expect(pooledMedian(pts, 12, 3)).toEqual({ price: 100, n: 7 });
    expect(pooledMedian(pts, 20, 2)).toBeNull();
  });

  it('스냅샷 regions 의 모든 시군구가 고르기에서 지역군을 받습니다', () => {
    for (const r of MARKET.regions) {
      const c = MARKET.complexes.find((x) => x.regionCode === r.code && x.sizes.length);
      if (!c) continue;
      expect(pickFromMarket(c.id, c.sizes[0].area)!.region).toBe(r.region);
    }
  });
});
