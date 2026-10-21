import { describe, expect, it } from 'vitest';
import { draftToProperty, pickFromMarket } from '../pick';
import {
  BAND_WIDE,
  MIN_PEERS,
  PRICE_GAPS,
  ageBand,
  nearestPeers,
  percentileOf,
  priceContext,
  priceGaps,
} from '../priceContext';
import type { Property } from '../types';
import { makeProperty } from './fixtures';

const picked = (cx: string, area: number, over: Partial<Property> = {}): Property => ({
  ...makeProperty(),
  ...draftToProperty(pickFromMarket(cx, area)!),
  ...over,
});

describe('왜 그 가격인지', () => {
  it('link 없으면 null', () => {
    expect(priceContext(makeProperty())).toBeNull();
    expect(priceContext(makeProperty({ link: { complexId: '없음', area: 84 } }))).toBeNull();
  });

  it('성산구 85㎡ — 이웃은 같은 구·평형대, 자기 단지 제외, 백분위 0~1', () => {
    const ctx = priceContext(picked('48123-171', 85))!;
    expect(ctx.district).toEqual({ code: '48123', label: '창원시 성산구' });
    expect(ctx.band).toEqual({ areaFrom: 75, areaTo: 95 });
    expect(ctx.peers.length).toBeGreaterThanOrEqual(MIN_PEERS);
    for (const p of ctx.peers) {
      expect(p.complexId).not.toBe('48123-171');
      expect(p.complexId.startsWith('48123-')).toBe(true);
      expect(p.area).toBeGreaterThanOrEqual(75);
      expect(p.area).toBeLessThanOrEqual(95);
      expect(p.n).toBeGreaterThanOrEqual(3);
    }
    expect(ctx.percentile).toBeGreaterThanOrEqual(0);
    expect(ctx.percentile).toBeLessThanOrEqual(1);
    expect(ctx.deals4q).toBeGreaterThanOrEqual(3);
    expect(ctx.self!.price).toBe(pickFromMarket('48123-171', 85)!.price);
    expect(ctx.jeonseRatio).not.toBeNull();
    expect(nearestPeers(ctx, 5)).toHaveLength(5);
  });

  it('가격을 올리면 백분위가 오릅니다 — 입력 매매가 기준', () => {
    const base = picked('48123-171', 85);
    const lo = priceContext({ ...base, price: 1e8 })!.percentile!;
    const hi = priceContext({ ...base, price: 3e9 })!.percentile!;
    expect(lo).toBe(0);
    expect(hi).toBe(1);
  });

  it('평형대를 넓히면 이웃이 늘거나 같습니다', () => {
    const p = picked('48123-171', 85);
    expect(priceContext(p, { bandWidth: BAND_WIDE })!.peers.length).toBeGreaterThanOrEqual(
      priceContext(p)!.peers.length
    );
  });

  it('이웃 8개 미만이면 백분위를 내지 않습니다', () => {
    expect(percentileOf(10, [1, 2, 3])).toBeNull();
    expect(percentileOf(10, [1, 2, 3, 4, 5, 6, 7, 20])).toBeCloseTo(7 / 8);
    expect(percentileOf(0, [1, 2, 3, 4, 5, 6, 7, 8])).toBeNull();
  });

  it('연식대 경계 — 7년까지 신축, 20년까지 중간', () => {
    expect(ageBand(0)).toBe('신축≤7년');
    expect(ageBand(7)).toBe('신축≤7년');
    expect(ageBand(8)).toBe('8~20년');
    expect(ageBand(20)).toBe('8~20년');
    expect(ageBand(21)).toBe('20년↑');
  });

  it('연식대 백분위는 같은 연식대 이웃 안에서만', () => {
    const ctx = priceContext(picked('48123-171', 85))!;
    expect(ctx.byAge.n).toBe(ctx.peers.filter((p) => p.ageBand === ctx.byAge.band).length);
  });
});

describe('어긋남 문장 세 규칙', () => {
  const base = { percentile: 0.5, agePercentile: 0.5, groundedShare: 0.8, thesisKind: 'stable' as const };

  it('아무것도 안 걸리는 기준 상태', () => {
    expect(priceGaps(base)).toEqual([]);
  });

  it('① 구 안 비쌈 + 연식대 안 중간 이하', () => {
    expect(priceGaps({ ...base, percentile: 0.8, agePercentile: 0.4 })).toEqual([PRICE_GAPS.pricierThanAge]);
    expect(priceGaps({ ...base, percentile: 0.8, agePercentile: 0.6 })).toEqual([]);
  });

  it('② 싸게 보이는데 근거 50% 미만', () => {
    expect(priceGaps({ ...base, percentile: 0.2, groundedShare: 0.4 })).toEqual([PRICE_GAPS.cheapButUngrounded]);
    expect(priceGaps({ ...base, percentile: 0.2, groundedShare: 0.6 })).toEqual([]);
  });

  it('③ 애매 구간인데 싸지도 않음', () => {
    expect(priceGaps({ ...base, thesisKind: 'ambiguous', percentile: 0.5 })).toEqual([PRICE_GAPS.ambiguousNotCheap]);
    expect(priceGaps({ ...base, thesisKind: 'ambiguous', percentile: 0.4 })).toEqual([]);
  });

  it('백분위가 없으면 어떤 규칙도 켜지지 않습니다', () => {
    expect(priceGaps({ percentile: null, agePercentile: null, groundedShare: 0, thesisKind: 'ambiguous' })).toEqual([]);
  });

  it('priceContext 가 groundedShare 를 넘겨받아 규칙 ② 를 켭니다', () => {
    const ctx = priceContext(picked('48123-171', 85, { price: 1e8 }), { groundedShare: 0.1 })!;
    expect(ctx.gaps).toContain(PRICE_GAPS.cheapButUngrounded);
  });
});
