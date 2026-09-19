import { describe, expect, it } from 'vitest';
import { COMPLEXES, RENT_REGIONS, RENT_SNAPSHOT, monthsAgo } from '../data';
import {
  DEFAULT_INPUT,
  TWO_ROOM_SQM,
  findRentals,
  monthlyCost,
  sortCandidates,
  summarize,
  type FinderInput,
} from '../finder';

const find = (over: Partial<FinderInput> = {}) => findRentals({ ...DEFAULT_INPUT, ...over });

describe('전월세 스냅샷', () => {
  it('마산 두 구와 함안·의령이 들어 있습니다', () => {
    const codes = RENT_REGIONS.map((r) => r.code);
    for (const c of ['48125', '48127', '48730', '48720']) expect(codes).toContain(c);
  });

  it('보증금·월세가 원 단위로 풀립니다 — 만원 그대로 새면 1억이 1만원이 됩니다', () => {
    const deposits = COMPLEXES.flatMap((c) =>
      c.sizes.flatMap((s) => [s.jeonse?.deposit, s.wolse?.deposit]).filter((v): v is number => !!v)
    );
    // 실제 최저는 보증금 100만원짜리 월세입니다. 만원 단위를 안 풀면 100원이 됩니다.
    expect(Math.min(...deposits)).toBeGreaterThanOrEqual(1_000_000);
    expect(Math.max(...deposits)).toBeLessThan(3_000_000_000);
  });

  /** 전세와 월세를 섞어 중위를 내면 보증금 분포가 뭉개집니다. */
  it('전세와 월세가 갈라져 있습니다 — 전세는 월세가 0입니다', () => {
    for (const c of COMPLEXES) {
      for (const s of c.sizes) {
        if (s.jeonse) expect(s.jeonse.rent).toBe(0);
        if (s.wolse) expect(s.wolse.rent).toBeGreaterThan(0);
      }
    }
  });

  it('출퇴근 등급에 근거 문장이 붙어 있습니다 — 소요시간이 아니라 방향 판단입니다', () => {
    for (const r of RENT_REGIONS) {
      expect(r.note.length).toBeGreaterThan(10);
      expect(['onsite', 'near', 'mid', 'far']).toContain(r.commute);
    }
  });
});

describe('월 환산 주거비', () => {
  /**
   * 보증금은 없어지는 돈이 아니라 묶이는 돈입니다. 그 돈이 다른 데서 벌었을
   * 수익을 월로 펴야 월세와 같은 자에 올라갑니다.
   */
  it('월세 + 보증금 × 기회비용 ÷ 12 입니다', () => {
    expect(monthlyCost(100_000_000, 0, 0.042)).toBeCloseTo((100_000_000 * 0.042) / 12, 6);
    expect(monthlyCost(20_000_000, 500_000, 0.042)).toBeCloseTo(
      500_000 + (20_000_000 * 0.042) / 12,
      6
    );
  });

  it('기회비용률을 올리면 전세가 상대적으로 불리해집니다', () => {
    const low = find({ opportunityRate: 0.02, maxMonthly: 2_000_000 });
    const high = find({ opportunityRate: 0.08, maxMonthly: 2_000_000 });
    const jeonseShare = (list: ReturnType<typeof find>) =>
      list.filter((c) => c.best.mode === 'jeonse').length / Math.max(1, list.length);
    expect(jeonseShare(high)).toBeLessThanOrEqual(jeonseShare(low));
  });
});

describe('후보 찾기', () => {
  it('기본 조건에서 후보가 나옵니다', () => {
    const list = find();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].best.monthly).toBeLessThanOrEqual(DEFAULT_INPUT.maxMonthly);
  });

  it('예산을 넘는 후보는 들어오지 않습니다', () => {
    for (const c of find()) {
      expect(c.best.deposit).toBeLessThanOrEqual(DEFAULT_INPUT.maxDeposit);
      expect(c.best.monthly).toBeLessThanOrEqual(DEFAULT_INPUT.maxMonthly);
    }
  });

  /** 방 개수 자료가 없어 전용면적으로 대신 잽니다. */
  it('전용면적 하한이 지켜집니다 — 투룸 대리선', () => {
    for (const c of find({ minArea: TWO_ROOM_SQM })) {
      expect(c.size.area).toBeGreaterThanOrEqual(TWO_ROOM_SQM);
    }
    const wide = find({ minArea: 84 });
    for (const c of wide) expect(c.size.area).toBeGreaterThanOrEqual(84);
    expect(wide.length).toBeLessThan(find({ minArea: TWO_ROOM_SQM }).length);
  });

  it('지역을 좁히면 그 지역 후보만 남습니다', () => {
    for (const c of find({ regionCodes: ['48127'] })) {
      expect(c.complex.regionCode).toBe('48127');
    }
  });

  it('최근 거래 조건이 지켜집니다 — 오래된 시세를 지금 시세로 읽으면 안 됩니다', () => {
    for (const c of find({ freshMonths: 6 })) {
      expect(monthsAgo(c.size.lastYm)).toBeLessThanOrEqual(6);
    }
  });

  it('전세만 보면 월세 선택지가 안 나옵니다', () => {
    for (const c of find({ modes: ['jeonse'] })) {
      expect(c.options.every((o) => o.mode === 'jeonse')).toBe(true);
    }
  });

  it('가장 싼 선택지가 best 입니다', () => {
    for (const c of find()) {
      for (const o of c.options) expect(c.best.monthly).toBeLessThanOrEqual(o.monthly);
    }
  });

  it('거래가 얇으면 표시하고 이유를 답니다', () => {
    const thin = find().filter((c) => c.thin);
    for (const c of thin) {
      expect(c.size.n).toBeLessThan(3);
      expect(c.notes.join(' ')).toContain('거래');
    }
  });

  it('정렬 키마다 순서가 실제로 바뀝니다', () => {
    const list = find();
    expect(sortCandidates(list, 'monthly')[0].best.monthly).toBeLessThanOrEqual(
      sortCandidates(list, 'deposit')[0].best.monthly + 1
    );
    const byArea = sortCandidates(list, 'area');
    expect(byArea[0].size.area).toBeGreaterThanOrEqual(byArea[byArea.length - 1].size.area);
    const byRecent = sortCandidates(list, 'recent');
    expect(byRecent[0].staleMonths).toBeLessThanOrEqual(byRecent[byRecent.length - 1].staleMonths);
  });

  it('요약이 목록과 맞습니다', () => {
    const list = find();
    const s = summarize(list);
    expect(s.candidates).toBe(list.length);
    expect(s.complexes).toBeLessThanOrEqual(list.length);
    expect(s.cheapest?.best.monthly).toBe(Math.min(...list.map((c) => c.best.monthly)));
  });

  it('조건을 풀면 후보가 늘어납니다 — 얼마를 더 내면 되는지가 보여야 합니다', () => {
    const tight = find({ maxMonthly: 400_000 });
    const loose = find({ maxMonthly: 1_200_000 });
    expect(loose.length).toBeGreaterThan(tight.length);
  });

  it('스냅샷 기준일과 수집 범위가 있습니다', () => {
    expect(RENT_SNAPSHOT.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(RENT_SNAPSHOT.stats.deals).toBeGreaterThan(1000);
    expect(RENT_SNAPSHOT.source.note).toContain('매물이 아닙니다');
  });
});

describe('얇은 표본과 부호', () => {
  /** 1건짜리 중위가는 시세가 아니라 그 집 한 채 가격입니다. */
  it('최소 거래 건수가 전세·월세 각각에 걸립니다', () => {
    for (const c of find({ minDeals: 3 })) {
      for (const o of c.options) expect(o.n).toBeGreaterThanOrEqual(3);
    }
    expect(find({ minDeals: 1 }).length).toBeGreaterThan(find({ minDeals: 5 }).length);
  });

  /**
   * 평형 전체 건수로만 걸면 "전세 1건 + 월세 6건" 평형에서 전세 1건이 대표
   * 시세가 되어 목록 1등으로 올라옵니다.
   */
  it('대표로 뽑힌 선택지도 건수 조건을 통과합니다', () => {
    for (const c of find({ minDeals: 2 })) expect(c.best.n).toBeGreaterThanOrEqual(2);
  });

  /**
   * 전세 보증금이 월세 보증금보다 작은 단지가 실제로 있습니다 (LH·구축 소형).
   * "전세가 더 묶인다" 고 전제하면 "−2,992만원 더 묶임" 같은 문장이 나옵니다.
   */
  it('보증금 비교 문장에 음수가 새지 않습니다', () => {
    for (const c of find({ minDeals: 1, maxMonthly: 3_000_000, maxDeposit: 500_000_000 })) {
      for (const n of c.notes) {
        expect(n).not.toContain('-');
        expect(n).not.toContain('−');
      }
    }
  });

  it('전세가 덜 묶이는 경우를 그렇게 적습니다', () => {
    const list = find({ minDeals: 1, maxMonthly: 3_000_000, maxDeposit: 500_000_000 });
    const cheaperDeposit = list.filter(
      (c) =>
        c.options.length === 2 &&
        c.options.find((o) => o.mode === 'jeonse')!.deposit <
          c.options.find((o) => o.mode === 'wolse')!.deposit
    );
    for (const c of cheaperDeposit) {
      const note = c.notes.find((n) => n.includes('같은 평형에서'));
      if (note) expect(note).toContain('덜 묶입니다');
    }
  });
});
