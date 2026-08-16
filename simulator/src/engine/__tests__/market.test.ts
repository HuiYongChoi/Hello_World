import { describe, expect, it } from 'vitest';
import {
  MARKET,
  cagrBetween,
  holdingDistribution,
  mainSize,
  quarterLabel,
  searchComplexes,
  yearsBetween,
  type MarketPoint,
} from '../market';

/** 분기 인덱스는 기준연도 2000 기준입니다 — 2016Q1 = 64 */
const q = (year: number, quarter: number) =>
  (year - MARKET.quarterBaseYear) * 4 + (quarter - 1);

const point = (year: number, quarter: number, price: number, n = 10): MarketPoint => ({
  q: q(year, quarter),
  n,
  price,
});

describe('분기 좌표', () => {
  it('인덱스를 사람이 읽는 분기로 되돌린다', () => {
    expect(quarterLabel(q(2016, 1))).toBe('2016Q1');
    expect(quarterLabel(q(2026, 3))).toBe('2026Q3');
  });

  it('분기 차이를 햇수로 환산한다', () => {
    expect(yearsBetween(q(2016, 1), q(2026, 1))).toBe(10);
    expect(yearsBetween(q(2016, 1), q(2016, 3))).toBe(0.5);
  });
});

describe('복리 연환산 수익률', () => {
  const points = [
    point(2016, 1, 300000000),
    point(2021, 1, 400000000),
    point(2026, 1, 600000000),
  ];

  it('두 시점 사이를 복리로 환산한다', () => {
    const r = cagrBetween(points, q(2016, 1), q(2026, 1))!;
    expect(r.years).toBe(10);
    expect(r.totalReturn).toBeCloseTo(1.0, 6);
    // 10년에 2배 → 연 7.18%
    expect(r.cagr).toBeCloseTo(Math.pow(2, 0.1) - 1, 10);
  });

  it('환산값을 되짚으면 원래 가격이 나온다', () => {
    const r = cagrBetween(points, q(2016, 1), q(2021, 1))!;
    expect(r.from.price * Math.pow(1 + r.cagr, r.years)).toBeCloseTo(r.to.price, 0);
  });

  it('1년 미만은 연환산하지 않는다 — 3개월 5%를 연 21%로 부르면 안 됩니다', () => {
    const short = [point(2026, 1, 300000000), point(2026, 2, 315000000)];
    expect(cagrBetween(short, q(2026, 1), q(2026, 2))).toBeNull();
  });

  it('없는 분기를 고르면 계산하지 않는다', () => {
    expect(cagrBetween(points, q(2017, 1), q(2026, 1))).toBeNull();
  });

  it('양 끝 거래가 손에 꼽히면 얇은 데이터로 표시한다', () => {
    const thin = [point(2016, 1, 300000000, 1), point(2026, 1, 600000000, 12)];
    expect(cagrBetween(thin, q(2016, 1), q(2026, 1))!.thinData).toBe(true);

    const thick = [point(2016, 1, 300000000, 8), point(2026, 1, 600000000, 12)];
    expect(cagrBetween(thick, q(2016, 1), q(2026, 1))!.thinData).toBe(false);
  });

  it('가격이 내리면 음수가 그대로 나온다', () => {
    const down = [point(2016, 1, 400000000), point(2026, 1, 300000000)];
    expect(cagrBetween(down, q(2016, 1), q(2026, 1))!.cagr).toBeLessThan(0);
  });
});

describe('진입시점 분포 — 평균 하나로 요약하지 않는다', () => {
  /** 앞 5년은 오르고 뒤 5년은 빠지는 시계열 — 진입시점이 결과를 가릅니다 */
  const points: MarketPoint[] = [];
  for (let i = 0; i <= 40; i++) {
    const price = i <= 20 ? 300000000 + i * 10000000 : 500000000 - (i - 20) * 5000000;
    points.push({ q: q(2016, 1) + i, n: 10, price });
  }

  it('모든 진입시점을 표본으로 잡는다', () => {
    const d = holdingDistribution(points, 5)!;
    expect(d.count).toBe(points.length - 20);
    expect(d.samples).toHaveLength(d.count);
  });

  it('분위수가 순서대로 나온다', () => {
    const d = holdingDistribution(points, 5)!;
    expect(d.worst).toBeLessThanOrEqual(d.p25);
    expect(d.p25).toBeLessThanOrEqual(d.median);
    expect(d.median).toBeLessThanOrEqual(d.p75);
    expect(d.p75).toBeLessThanOrEqual(d.best);
  });

  it('꼭지에 들어간 진입시점은 손실로 끝난다 — 평균만 보면 안 보입니다', () => {
    const d = holdingDistribution(points, 5)!;
    expect(d.worst).toBeLessThan(0);
    expect(d.lossRatio).toBeGreaterThan(0);
    expect(d.best).toBeGreaterThan(0);
  });

  it('보유기간이 데이터보다 길면 분포를 못 낸다', () => {
    expect(holdingDistribution(points.slice(0, 8), 5)).toBeNull();
  });
});

describe('실거래 스냅샷', () => {
  it('비어 있지 않고 출처가 박혀 있다', () => {
    expect(MARKET.complexes.length).toBeGreaterThan(0);
    expect(MARKET.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(MARKET.source.name).toContain('국토교통부');
  });

  it('모든 시계열이 분기 순으로 정렬돼 있고 가격이 양수다', () => {
    for (const c of MARKET.complexes.slice(0, 200)) {
      for (const s of c.sizes) {
        expect(s.points.length).toBeGreaterThanOrEqual(4);
        for (let i = 1; i < s.points.length; i++) {
          expect(s.points[i].q).toBeGreaterThan(s.points[i - 1].q);
        }
        for (const p of s.points) {
          expect(p.price).toBeGreaterThan(0);
          expect(p.n).toBeGreaterThan(0);
        }
      }
    }
  });

  it('금액이 원 단위로 변환돼 있다 — 만원 정수를 그대로 쓰면 1만분의 1이 됩니다', () => {
    // Math.min(...prices) 는 40만 개 배열에서 스택을 넘깁니다. 스냅샷이 그 규모입니다.
    let min = Infinity;
    for (const c of MARKET.complexes) {
      for (const s of c.sizes) {
        for (const p of s.points) if (p.price < min) min = p.price;
      }
    }
    expect(min).toBeGreaterThan(1000000);
  });

  it('이름·법정동으로 검색된다', () => {
    const first = MARKET.complexes[0];
    expect(searchComplexes(first.name).some((c) => c.id === first.id)).toBe(true);
    expect(searchComplexes('존재하지않는단지명xyz')).toHaveLength(0);
  });

  it('통칭이 등록명보다 길어도 잡는다 — 토월성원 → 성원', () => {
    // 국토부 등록명은 동네 통칭과 다릅니다. 창원 상남동 "성원"이 통칭 "토월성원"입니다.
    const target = MARKET.complexes.find((c) => c.name.replace(/\s+/g, '') === '성원');
    if (!target) return; // 스냅샷 범위가 바뀌면 건너뜁니다
    expect(searchComplexes('토월성원').some((c) => c.name.replace(/\s+/g, '') === '성원')).toBe(
      true
    );
  });

  it('정확히 일치하는 단지가 부분일치보다 먼저 나온다', () => {
    const exact = MARKET.complexes.find((c) => {
      const n = c.name.replace(/\s+/g, '');
      return MARKET.complexes.some((o) => o !== c && o.name.replace(/\s+/g, '').includes(n));
    });
    if (!exact) return;
    const hit = searchComplexes(exact.name)[0];
    expect(hit.name.replace(/\s+/g, '')).toBe(exact.name.replace(/\s+/g, ''));
  });

  it('두 글자 등록명이 아무 질의어에나 걸리지 않는다', () => {
    // 길이 조건이 없으면 "삼성전자주식회사" 같은 질의가 "삼성"을 끌고 옵니다.
    const results = searchComplexes('가');
    for (const c of results) {
      expect(c.name.includes('가') || c.umd.includes('가')).toBe(true);
    }
  });

  it('기본 평형은 거래가 가장 많은 평형이다', () => {
    for (const c of MARKET.complexes.slice(0, 50)) {
      const main = mainSize(c)!;
      const total = (s: typeof main) => s.points.reduce((a, p) => a + p.n, 0);
      for (const s of c.sizes) expect(total(main)).toBeGreaterThanOrEqual(total(s));
    }
  });
});
