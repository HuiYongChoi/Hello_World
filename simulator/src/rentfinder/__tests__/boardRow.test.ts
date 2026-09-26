import { describe, expect, it } from 'vitest';
import { COMPLEXES } from '../data';
import {
  BOARD_MIN_AREA,
  boardRowById,
  depositReach,
  discover,
  jeonseBoardRow,
  rankBoardRows,
  recentJeonse,
  type JeonseBoardRow,
} from '../boardRow';
import { BOARD_SNAPSHOT, DEFAULT_PROFILE, personalizeRows } from '../board/boardDoc';
import { SAFETY_RULES } from '../safety';
import type { Borrower } from '../loans';

const sme: Borrower = { ...DEFAULT_PROFILE, smeEmployed: true, income: 30000000 };

describe('최근 전세 — 2년 중위가 아니라 가까운 거래부터', () => {
  it('전세 2건이 크게 갈리면 시세를 모른다고 합니다 (메트로시티석전 52㎡)', () => {
    const c = COMPLEXES.find((x) => x.name === '창원메트로시티석전')!;
    const s = c.sizes.find((x) => x.area === 52)!;
    const r = recentJeonse(s);
    expect(r.split).toBe(true);
    expect(r.value).toBeNull();
  });

  it('값이 있으면 분기 중위 중 하나입니다 (지어낸 평균이 아님)', () => {
    for (const c of COMPLEXES.slice(0, 300)) {
      for (const s of c.sizes) {
        const r = recentJeonse(s);
        if (r.value != null) expect(s.trend.map((t) => t.deposit)).toContain(r.value);
      }
    }
  });
});

describe('얼마짜리까지 되나 — 상품별 최대 보증금', () => {
  it('최대 보증금에서 내 돈이 가진 돈을 넘지 않습니다', () => {
    for (const cash of [30e6, 70e6, 150e6]) {
      for (const r of depositReach(sme, cash)) {
        if (!r.maxDeposit) continue;
        expect(r.maxDeposit - r.loan).toBeLessThanOrEqual(cash + 1e6);
      }
    }
  });

  it('보증금 상한이 있는 상품은 그 위로 가지 않습니다', () => {
    const r = depositReach(sme, 500e6).find((x) => x.product === '중기청')!;
    expect(r.maxDeposit).toBeLessThanOrEqual(200e6);
    expect(r.binding).toBe('DEPOSIT_MAX');
  });

  it('자격이 없으면 최대 보증금이 0이고 이유가 붙습니다', () => {
    const r = depositReach(DEFAULT_PROFILE, 70e6).find((x) => x.product === '중기청')!;
    expect(r.maxDeposit).toBe(0);
    expect(r.rejectReasons.length).toBeGreaterThan(0);
  });
});

describe('후보판에 없는 집 찾기', () => {
  const exclude = new Set(BOARD_SNAPSHOT.jeonse.map((r) => r.id));
  const found = discover({ mode: 'jeonse', borrower: sme, cash: 70e6, monthlyMax: 900000, exclude, regionCodes: ['48127', '48125'] });

  it('후보판에 이미 있는 집은 나오지 않습니다', () => {
    for (const f of found) expect(exclude.has(f.row.id)).toBe(false);
  });

  it('내 돈과 월 한도 안에서 되는 집만 나옵니다', () => {
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      expect(f.own).toBeLessThanOrEqual(70e6);
      expect(f.monthlyOut).toBeLessThanOrEqual(900000);
      expect(f.row.area).toBeGreaterThanOrEqual(BOARD_MIN_AREA);
    }
  });

  it('월세는 월세 + 대출 이자가 월 한도 안입니다', () => {
    const w = discover({ mode: 'wolse', borrower: sme, cash: 20e6, monthlyMax: 700000, exclude: new Set() });
    for (const f of w) expect(f.monthlyOut).toBeLessThanOrEqual(700000);
  });
});

describe('후보판을 내 조건으로 다시 재기', () => {
  it('중소기업 재직으로 바꾸면 2억 이하 전세에 중기청이 붙습니다', () => {
    const rows = personalizeRows({ borrower: sme }).jeonse;
    const cheap = rows.filter((r) => r.est && r.est <= 200e6 && r.area <= 85);
    expect(cheap.length).toBeGreaterThan(0);
    for (const r of cheap) expect(r.loans[0]?.n).toBe('중기청');
  });

  it('조건을 안 넣으면 스냅샷 그대로입니다', () => {
    const rows = personalizeRows({}).jeonse;
    expect(rows.map((r) => r.loans[0]?.n)).toEqual(BOARD_SNAPSHOT.jeonse.map((r) => r.loans[0]?.n));
  });

  it('담은 집이 "직접 담음" 으로 들어가고 순위가 1부터 다시 매겨집니다', () => {
    const exclude = new Set(BOARD_SNAPSHOT.jeonse.map((r) => r.id));
    const pick = discover({ mode: 'jeonse', borrower: sme, cash: 70e6, monthlyMax: 900000, exclude })[0];
    const rows = personalizeRows({ borrower: sme, added: { jeonse: [pick.row.id], wolse: [] } }).jeonse;
    const addedRow = rows.find((r) => r.id === pick.row.id);
    expect(addedRow?.added).toBe(true);
    expect(rows.map((r) => r.rank).sort((a, b) => a - b)).toEqual(rows.map((_, i) => i + 1));
  });

  it('스냅샷과 같은 규칙으로 만든 줄은 같은 판정을 받습니다', () => {
    for (const snap of BOARD_SNAPSHOT.jeonse.slice(0, 20)) {
      const row = boardRowById('jeonse', snap.id, DEFAULT_PROFILE) as JeonseBoardRow | null;
      if (!row) continue;
      expect(row.tier).toBe(snap.tier);
    }
  });

  it('자동 순위는 판정 다음 전세가율 순입니다', () => {
    const c = COMPLEXES.filter((x) => x.regionCode === '48125').slice(0, 40);
    const rows = c.flatMap((x) => x.sizes.map((s) => jeonseBoardRow(x, s, DEFAULT_PROFILE))).filter((r): r is JeonseBoardRow => !!r);
    const ranked = rankBoardRows(rows, 'jeonse');
    const order = { A: 0, B: 1, C: 2, D: 3 };
    for (let i = 1; i < ranked.length; i++) expect(order[ranked[i].tier]).toBeGreaterThanOrEqual(order[ranked[i - 1].tier]);
  });

  it('최우선변제 기준은 룰셋에서 옵니다', () => {
    const w = personalizeRows({}).wolse;
    for (const r of w) expect(r.priority).toBe(r.dep <= SAFETY_RULES.priorityRepayment.depositMax);
  });
});
