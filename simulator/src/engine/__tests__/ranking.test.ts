import { describe, expect, it } from 'vitest';
import { subjectParticle, topicParticle } from '../format';
import {
  rankPerformers,
  rankingInsightReport,
  rankingInsights,
  rankingReport,
} from '../ranking';

const CHANGWON = ['48121', '48123', '48125', '48127', '48129'];
const BUSAN = ['26350', '26500', '26260', '26290', '26470'];

const base = { districtCodes: CHANGWON, years: 5, topPercent: 20 } as const;

describe('수익률 상위권 추출', () => {
  it('상위 비율만큼만 뽑는다', () => {
    const r = rankPerformers({ ...base, mode: 'absolute' });
    expect(r.universe).toBeGreaterThan(0);
    expect(r.topCount).toBe(Math.round((r.universe * 20) / 100));
    expect(r.entries).toHaveLength(r.topCount);
  });

  it('절대 수익률 모드는 수익률 내림차순이다', () => {
    const r = rankPerformers({ ...base, mode: 'absolute' });
    for (let i = 1; i < r.entries.length; i++) {
      expect(r.entries[i - 1].cagr).toBeGreaterThanOrEqual(r.entries[i].cagr);
    }
  });

  it('초과수익 모드는 초과분 내림차순이고 순서가 절대 모드와 다르다', () => {
    const abs = rankPerformers({ ...base, mode: 'absolute' });
    const exc = rankPerformers({ ...base, mode: 'excess' });

    for (let i = 1; i < exc.entries.length; i++) {
      expect(exc.entries[i - 1].excess).toBeGreaterThanOrEqual(exc.entries[i].excess);
    }
    // 시군구별 기준선이 다르므로 상위 명단이 그대로일 수 없습니다
    expect(exc.entries.map((e) => e.id)).not.toEqual(abs.entries.map((e) => e.id));
  });

  it('초과수익은 그 시군구 중위를 뺀 값이다', () => {
    const r = rankPerformers({ ...base, mode: 'excess' });
    const medians = new Map(r.districtMedians.map((d) => [d.code, d.median]));
    for (const e of r.entries) {
      expect(e.excess).toBeCloseTo(e.cagr - medians.get(e.districtCode)!, 10);
    }
  });

  it('거래가 얇은 분기는 표본에서 뺀다 — 개별 물건 한 채 가격입니다', () => {
    const r = rankPerformers({ ...base, mode: 'absolute' });
    for (const e of r.entries) expect(e.minDeals).toBeGreaterThanOrEqual(3);
  });

  it('진입가·현재가·기간이 수익률과 맞아떨어진다', () => {
    const r = rankPerformers({ ...base, mode: 'absolute' });
    for (const e of r.entries.slice(0, 20)) {
      expect(e.startPrice * Math.pow(1 + e.cagr, e.years)).toBeCloseTo(e.endPrice, 0);
      expect(e.years).toBeGreaterThanOrEqual(1);
    }
  });

  it('대상 시군구 밖의 단지는 섞이지 않는다', () => {
    const r = rankPerformers({ districtCodes: BUSAN, years: 5, topPercent: 20, mode: 'excess' });
    for (const e of r.entries) expect(BUSAN).toContain(e.districtCode);
  });

  it('기간을 늘리면 표본이 줄어든다 — 오래 버틴 시계열만 남습니다', () => {
    const short = rankPerformers({ ...base, years: 3, mode: 'absolute' });
    const long = rankPerformers({ ...base, years: 10, mode: 'absolute' });
    expect(long.universe).toBeLessThanOrEqual(short.universe);
  });
});

describe('공통점 추출', () => {
  it('속성군마다 상위 비중·전체 비중·배수를 낸다', () => {
    const r = rankPerformers({ ...base, mode: 'excess' });
    const ids = r.traits.map((t) => t.id);
    expect(ids).toContain('buildEra');
    expect(ids).toContain('area');
    expect(ids).toContain('entryPrice');
    expect(ids).toContain('umd');

    for (const g of r.traits) {
      for (const b of g.buckets) {
        expect(b.topShare).toBeGreaterThan(0);
        expect(b.allShare).toBeGreaterThan(0);
        expect(b.lift).toBeCloseTo(b.topShare / b.allShare, 10);
      }
    }
  });

  it('상위 비중 합은 1이다 — 빠진 표본이 없어야 합니다', () => {
    const r = rankPerformers({ ...base, mode: 'excess' });
    for (const g of r.traits) {
      const sum = g.buckets.reduce((s, b) => s + b.topShare, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it('배수 내림차순으로 정렬된다', () => {
    const r = rankPerformers({ ...base, mode: 'excess' });
    for (const g of r.traits) {
      for (let i = 1; i < g.buckets.length; i++) {
        expect(g.buckets[i - 1].lift).toBeGreaterThanOrEqual(g.buckets[i].lift);
      }
    }
  });

  it('모드에 따라 다른 주의문을 낸다', () => {
    const abs = rankPerformers({ ...base, mode: 'absolute' });
    const exc = rankPerformers({ ...base, mode: 'excess' });
    expect(abs.caveats.some((c) => c.includes('동어반복'))).toBe(true);
    expect(exc.caveats.some((c) => c.includes('시군구 중위 대비'))).toBe(true);
  });
});

describe('리포트', () => {
  it('출처·기준·주의를 모두 담는다', () => {
    const r = rankPerformers({ ...base, mode: 'excess' });
    const md = rankingReport(r, '창원 전체');

    expect(md).toContain('# 수익률 상위권 공통점 — 창원 전체');
    expect(md).toContain('국토교통부');
    expect(md).toContain('## 공통점');
    expect(md).toContain('## 상위 단지');
    expect(md).toContain('## 시군구 중위 수익률');
    expect(md).toContain('## 읽을 때 주의');
    expect(md).toContain('지역 초과수익');
  });

  it('상위 단지 표에 실제 단지가 들어간다', () => {
    const r = rankPerformers({ ...base, mode: 'absolute' });
    const md = rankingReport(r, '창원 전체');
    expect(md).toContain(r.entries[0].name);
    expect(md.split('\n').length).toBeGreaterThan(30);
  });
});

describe('인사이트', () => {
  it('임계 배수를 넘는 것만 문장으로 만든다', () => {
    const r = rankPerformers({ ...base, mode: 'excess' });
    const ins = rankingInsights(r);
    for (const i of ins) {
      expect(i.headline.length).toBeGreaterThan(0);
      expect(i.evidence).toMatch(/상위 \d+건/);
    }
  });

  it('표본 3건 미만은 인사이트로 만들지 않는다', () => {
    const r = rankPerformers({ ...base, mode: 'excess' });
    const ins = rankingInsights(r);
    for (const i of ins) {
      const n = Number(i.evidence.match(/상위 (\d+)건/)![1]);
      expect(n).toBeGreaterThanOrEqual(3);
    }
  });

  it('표본 5건 이상이면 strong, 3~4건이면 weak 이고 strong 이 먼저 온다', () => {
    const r = rankPerformers({ ...base, mode: 'excess' });
    const ins = rankingInsights(r);
    for (const i of ins) {
      const n = Number(i.evidence.match(/상위 (\d+)건/)![1]);
      expect(i.strength).toBe(n >= 5 ? 'strong' : 'weak');
    }
    const firstWeak = ins.findIndex((i) => i.strength === 'weak');
    if (firstWeak >= 0) {
      expect(ins.slice(firstWeak).every((i) => i.strength === 'weak')).toBe(true);
    }
  });

  it('절대 수익률 모드에서는 시군구를 인사이트로 만들지 않는다 — 동어반복입니다', () => {
    const r = rankPerformers({ ...base, mode: 'absolute' });
    for (const i of rankingInsights(r)) {
      expect(i.headline.startsWith('시군구:')).toBe(false);
    }
  });

  it('인사이트 리포트는 해석과 한계를 같이 담는다', () => {
    const r = rankPerformers({ ...base, mode: 'excess' });
    const md = rankingInsightReport(r, '창원 전체');
    expect(md).toContain('# 인사이트 — 창원 전체');
    expect(md).toContain('## 이 해석의 한계');
    expect(md).toContain('## 대표 사례');
    expect(md).toContain('국토교통부');
    expect(md).toContain('속성');
  });

  it('공통점이 없으면 없다고 적는다 — 그것도 결과입니다', () => {
    const r = rankPerformers({ ...base, mode: 'excess' });
    const empty = { ...r, traits: [] };
    const md = rankingInsightReport(empty, '테스트');
    expect(md).toContain('뚜렷한 공통점이 없습니다');
  });
});

describe('조사 처리', () => {
  it('받침 유무에 따라 은/는, 이/가를 가려 붙인다', () => {
    expect(topicParticle('1990년대')).toBe('1990년대는');
    expect(topicParticle('1980년대 이전')).toBe('1980년대 이전은');
    expect(subjectParticle('반림동')).toBe('반림동이');
    expect(subjectParticle('트리비아')).toBe('트리비아가');
  });

  it('괄호·숫자로 끝나도 마지막 한글 음절로 판정한다', () => {
    // 실제 값: "중형 (60~85㎡)" 처럼 한글이 앞에만 있는 경우
    expect(subjectParticle('중형 (60~85㎡)')).toBe('중형 (60~85㎡)이');
    expect(subjectParticle('2~3억')).toBe('2~3억이');
  });

  it('한글이 없으면 받침 없는 것으로 본다', () => {
    expect(topicParticle('ABC')).toBe('ABC는');
  });

  it('인사이트 문장의 조사가 앞 글자 받침과 맞는다', () => {
    // 헬퍼를 그대로 부르면 동어반복이므로, 받침 판정을 테스트 안에서 따로 구현합니다.
    const hasJong = (ch: string) => (ch.charCodeAt(0) - 0xac00) % 28 !== 0;
    const r = rankPerformers({ ...base, mode: 'excess' });
    const checked: string[] = [];

    for (const i of rankingInsights(r)) {
      const m = i.headline.match(/([가-힣])([은는이가]) (?:상위권에|오히려)/);
      if (!m) continue;
      const [, prev, particle] = m;
      const expected =
        particle === '은' || particle === '는' ? (hasJong(prev) ? '은' : '는') : hasJong(prev) ? '이' : '가';
      expect(`${i.headline} → ${particle}`).toBe(`${i.headline} → ${expected}`);
      checked.push(i.headline);
    }
    expect(checked.length).toBeGreaterThan(0);
  });
});
