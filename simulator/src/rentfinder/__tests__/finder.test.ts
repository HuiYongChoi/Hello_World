import { describe, expect, it } from 'vitest';
import { COMPLEXES, RENT_REGIONS, RENT_SNAPSHOT, monthsAgo } from '../data';
import {
  DEFAULT_INPUT,
  TWO_ROOM_SAFE_SQM,
  TWO_ROOM_SQM,
  supplyPyeongToSqm,
  toPyeong,
  toSupplyPyeong,
  findRentals,
  jeonseSplit,
  monthlyCost,
  sortCandidates,
  summarize,
  type FinderInput,
} from '../finder';

import { REGISTRY_CHECKLIST, SAFETY_RULES } from '../safety';
import { jeonseLoanFit } from '../loans';

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

describe('평 환산과 출퇴근 정렬', () => {
  /**
   * 사람은 "15평 아파트" 라고 할 때 대개 **공급면적**을 뜻합니다. 전용 40㎡ 를
   * 그대로 평으로 바꾸면 12.1평이라 "15평이 아니네" 가 되는데, 그 집의 공급은
   * 15평 안팎입니다. 둘을 갈라 보여 주지 않으면 조건이 어긋납니다.
   */
  it('전용 평과 공급 평을 갈라 냅니다', () => {
    expect(toPyeong(40)).toBeCloseTo(12.1, 1);
    expect(toSupplyPyeong(40)).toBeCloseTo(15.5, 1);
    // 되짚기도 맞아야 합니다.
    expect(supplyPyeongToSqm(toSupplyPyeong(40))).toBeCloseTo(40, 6);
  });

  it('공급 15평은 전용 40㎡ 안팎입니다', () => {
    const sqm = supplyPyeongToSqm(15);
    expect(sqm).toBeGreaterThan(37);
    expect(sqm).toBeLessThan(41);
  });

  /** 방 개수 자료가 없어 전용면적으로 대신 재는 선입니다. */
  it('방 둘 대리선이 원룸 경계보다 큽니다', () => {
    expect(TWO_ROOM_SAFE_SQM).toBeGreaterThan(TWO_ROOM_SQM);
  });

  it('출퇴근 순 정렬은 등급이 먼저, 같으면 싼 순입니다', () => {
    const list = find({ regionCodes: ['48127', '48125', '48123'], minArea: TWO_ROOM_SAFE_SQM });
    const sorted = sortCandidates(list, 'commute');
    const order = { onsite: 0, near: 1, mid: 2, far: 3 } as const;
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      expect(order[a.commute]).toBeLessThanOrEqual(order[b.commute]);
      if (a.commute === b.commute) {
        expect(a.best.monthly).toBeLessThanOrEqual(b.best.monthly + 1);
      }
    }
    // 함안 방향이 가까운 마산회원이 먼저 나와야 합니다.
    expect(sorted[0].commute).toBe('near');
  });
});

describe('전세가율 — 안전 축', () => {
  const jeonseOnly = () =>
    find({ modes: ['jeonse'], minArea: TWO_ROOM_SAFE_SQM, regionCodes: ['48127', '48125'] });

  it('전세 선택지가 있으면 전세가율을 냅니다', () => {
    const list = jeonseOnly();
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) expect(c.safety).not.toBeNull();
  });

  it('전세가율 = 보증금 ÷ 같은 단지·평형 매매 중위가', () => {
    for (const c of jeonseOnly()) {
      const s = c.safety!;
      if (s.ratio === null || s.salePrice === null) continue;
      const deposit = c.options.find((o) => o.mode === 'jeonse')!.deposit;
      expect(s.ratio).toBeCloseTo(deposit / s.salePrice, 10);
    }
  });

  it('등급 경계가 지켜집니다', () => {
    for (const c of jeonseOnly()) {
      const s = c.safety!;
      if (s.ratio === null) {
        expect(s.grade).toBe('unknown');
        continue;
      }
      const expected =
        s.ratio < 0.6 ? 'low' : s.ratio < 0.7 ? 'mid' : s.ratio < 0.8 ? 'high' : 'danger';
      expect(s.grade).toBe(expected);
    }
  });

  /** 실제 안전은 등기부에서 갈립니다 — 그 사실을 숫자 옆에 늘 답니다. */
  it('선순위 근저당을 모른다는 것을 매번 적습니다', () => {
    for (const c of jeonseOnly()) {
      if (c.safety?.ratio === null) continue;
      expect(c.safety!.notes.join(' ')).toContain('근저당');
    }
  });

  it('위험·주의 등급이면 후보 메모에도 경고가 붙습니다', () => {
    for (const c of jeonseOnly()) {
      if (c.safety?.grade === 'danger' || c.safety?.grade === 'high') {
        expect(c.notes.join(' ')).toContain('등기부등본');
      }
    }
  });

  /** 모르는 것을 앞에 두면 "위험이 낮아서 위에 있나" 로 읽힙니다. */
  it('전세가율 순 정렬은 못 잰 후보를 뒤로 보냅니다', () => {
    const sorted = sortCandidates(jeonseOnly(), 'safety');
    let seenUnknown = false;
    for (const c of sorted) {
      const known = c.safety?.ratio !== null && c.safety?.ratio !== undefined;
      if (!known) seenUnknown = true;
      else expect(seenUnknown).toBe(false);
    }
  });

  it('신축 순 정렬은 준공연도 내림차순입니다', () => {
    const sorted = sortCandidates(jeonseOnly(), 'newest');
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].complex.buildYear).toBeGreaterThanOrEqual(
        sorted[i].complex.buildYear
      );
    }
  });
});

describe('융자 허용선 · 매매가 추세', () => {
  const list = () =>
    find({ modes: ['jeonse'], minArea: TWO_ROOM_SAFE_SQM, regionCodes: ['48127', '48125'] });

  it('근저당 허용선 = 매매 중위가 × 낙찰가율 − 보증금 (룰셋 값)', () => {
    let seen = 0;
    for (const c of list()) {
      const s = c.safety!;
      if (s.salePrice === null) {
        expect(s.seniorRoom).toBeNull();
        continue;
      }
      seen++;
      const deposit = c.options.find((o) => o.mode === 'jeonse')!.deposit;
      expect(s.seniorRoom!.auction).toBeCloseTo(s.salePrice * SAFETY_RULES.auctionRatio - deposit, 6);
      expect(s.seniorRoom!.guarantee).toBeCloseTo(
        s.salePrice * SAFETY_RULES.guaranteeRatio - deposit,
        6
      );
      // 보증보험 선은 경매 선보다 느슨합니다 (90% > 80%)
      expect(s.seniorRoom!.guarantee).toBeGreaterThan(s.seniorRoom!.auction);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('허용선이 음수면 "근저당 없어도 부족" 으로 말합니다 — 양수인 척하지 않습니다', () => {
    for (const c of list()) {
      const s = c.safety!;
      if (!s.seniorRoom) continue;
      const text = s.notes.join(' ');
      if (s.seniorRoom.auction > 0) expect(text).toContain('근저당 허용선');
      else expect(text).toContain('근저당이 하나도 없어도');
    }
  });

  it('융자 여부를 안다고 말하지 않습니다 — 등기부를 가리킵니다', () => {
    for (const c of list()) {
      if (c.safety!.ratio === null) continue;
      expect(c.safety!.notes.join(' ')).toContain('등기부등본');
    }
  });

  it('매매가 추세는 1년 이상 앞선 분기와 견줍니다', () => {
    for (const c of list()) {
      const t = c.safety!.priceTrend;
      if (!t) continue;
      const [fy, fq] = t.from.split('Q').map((x) => parseInt(x, 10));
      const [ty, tq] = t.to.split('Q').map((x) => parseInt(x, 10));
      expect(ty * 4 + tq - (fy * 4 + fq)).toBeGreaterThanOrEqual(4);
    }
  });

  it('매매가는 최근 1년(4분기)을 묶어 잽니다 — 1건짜리 분기 하나에 흔들리지 않게', () => {
    let pooled = 0;
    for (const c of list()) {
      const s = c.safety!;
      if (s.saleQuarter === null) continue;
      expect(s.saleQuarter).toMatch(/^\d{4}Q\d(~\d{4}Q\d)?$/);
      if (s.saleQuarter.includes('~')) {
        pooled++;
        const [a, b] = s.saleQuarter.split('~').map((x) => {
          const [y, q] = x.split('Q').map(Number);
          return y * 4 + q;
        });
        expect(b - a).toBeLessThan(4);
      }
    }
    expect(pooled).toBeGreaterThan(0);
  });

  it('확인 목록에 근저당·소유자·세금 체납·잔금일 재확인이 있습니다', () => {
    const whats = REGISTRY_CHECKLIST.map((r) => r.what).join(' ');
    for (const w of ['근저당', '소유자', '세금', '잔금일']) expect(whats).toContain(w);
  });
});

describe('후보별 전세대출', () => {
  const borrower = {
    age: 32,
    militaryServed: true,
    married: false,
    marriedYears: 0,
    newbornWithin2y: false,
    smeEmployed: true,
    income: 30000000,
    spouseIncome: 0,
    netWorth: 50000000,
    householder: true,
    noHouse: true,
  };

  it('월세 전용 상품은 전세 후보에 안 붙습니다', () => {
    const fit = jeonseLoanFit(borrower, 100000000, 59);
    for (const r of fit.eligible) expect(r.product.mode).not.toBe('wolse');
  });

  it('되는 상품은 금리 낮은 순이고 best 가 맨 앞입니다', () => {
    const fit = jeonseLoanFit(borrower, 100000000, 59);
    expect(fit.best).toBe(fit.eligible[0]);
    for (let i = 1; i < fit.eligible.length; i++) {
      expect(fit.eligible[i].rate.min).toBeGreaterThanOrEqual(fit.eligible[i - 1].rate.min);
    }
  });

  it('중소기업 재직 청년이면 중기청이 먼저 옵니다', () => {
    expect(jeonseLoanFit(borrower, 100000000, 59).best?.product.id).toBe('jungsocheong');
  });

  it('보증금이 상한을 넘으면 그 상품이 빠집니다', () => {
    const fit = jeonseLoanFit(borrower, 250000000, 59);
    expect(fit.eligible.some((r) => r.product.id === 'jungsocheong')).toBe(false);
    expect(fit.rejected).toBeGreaterThan(0);
  });
});

describe('갈린 전세 — 두 건의 평균이 시세 행세를 하지 않게', () => {
  it('창원메트로시티석전 52㎡ 는 전세가율을 내지 않습니다 (2.50억·0.34억)', () => {
    const c = COMPLEXES.find((x) => x.name === '창원메트로시티석전' && x.sizes.some((s) => s.area === 52));
    if (!c) return;
    const size = c.sizes.find((s) => s.area === 52)!;
    expect(jeonseSplit(size)).not.toBeNull();
    const hit = find({ modes: ['jeonse'], minArea: 50, maxArea: 53, regionCodes: [c.regionCode], maxDeposit: 5e8, maxMonthly: 5e6, minBuildYear: 0 })
      .find((x) => x.complex.id === c.id && x.size.area === 52);
    if (hit) {
      expect(hit.safety?.ratio).toBeNull();
      expect(hit.safety?.grade).toBe('unknown');
    }
  });

  it('거래가 많은 평형은 갈림 판정을 하지 않습니다', () => {
    for (const c of COMPLEXES) for (const s of c.sizes) {
      if (s.jeonse && s.jeonse.n > 3) expect(jeonseSplit(s)).toBeNull();
    }
  });
});
