import { describe, expect, it } from 'vitest';
import { APPLYHOME, NOTICES } from '../../engine/applyhome';
import { BOARD_SNAPSHOT, type BoardSignals } from '../board/boardDoc';
import { NEW_NOTICE_DAYS, daysBetween, excludedFrom, todayItems } from '../today';

const ids = [...(BOARD_SNAPSHOT.jeonse as { id: string; rank: number }[])].sort((a, b) => a.rank - b.rank).map((r) => r.id);
const up = (gap: number, locked = false) => ({ end: `2026-${String(9 + gap).padStart(2, '0')}`, gap, floor: '5', dep: 2e8, type: locked ? '갱신' : '신규', locked });

const signals: BoardSignals = {
  kind: 'masan-jeonse-signals',
  asOf: '2026-09-27',
  windowMonths: 3,
  rows: {
    [ids[0]]: { upcoming: [up(1, true), up(5)], recent: [{ date: '2026-09-10', floor: '3', dep: 2e8, rent: 0, type: '신규', term: '' }] },
    [ids[1]]: { upcoming: [up(3), up(2, true)], recent: [] },
    [ids[2]]: { upcoming: [up(4), up(6)], recent: [] },
  },
};

const run = (over: Partial<Parameters<typeof todayItems>[0]> = {}) =>
  todayItems({ signals, excluded: {}, today: '2026-09-28', ...over });

describe('오늘 볼 것', () => {
  it('늘 네 줄이고 순서가 고정입니다', () => {
    expect(run().map((i) => i.key)).toEqual(['signals', 'shortlist', 'notices', 'temperature']);
    expect(run({ signals: null }).map((i) => i.key)).toEqual(['signals', 'shortlist', 'notices', 'temperature']);
    expect(run().map((i) => i.target)).toEqual(['board', 'board', 'subscription', 'market']);
  });

  it('신호 파일이 없으면 전세 신호만 흐리고 나머지 셋은 정상입니다', () => {
    const [sig, ...rest] = run({ signals: null });
    expect(sig.muted).toBe(true);
    expect(sig.line).toContain('신호 파일 없음');
    for (const r of rest) expect(r.muted).toBe(false);
  });

  it(`신호 건수는 gap ≤ windowMonths 만 셉니다 (4~6개월은 뒤 문구로)`, () => {
    const sig = run()[0];
    expect(sig.line).toContain('3개월 안 만기 3건 (갱신 끝남 2)');
    expect(sig.line).toContain('새 계약 1');
    expect(sig.line).toContain('기준 09-27');
    expect(sig.detail.some((d) => d.includes('4~6개월 안 만기 3건'))).toBe(true);
  });

  it('소거한 줄은 남은 후보와 신호 건수에서 빠집니다', () => {
    const excluded = { [ids[0]]: true };
    const [sig, short] = run({ excluded });
    expect(sig.line).toContain('3개월 안 만기 2건 (갱신 끝남 1)');
    expect(sig.line).toContain('새 계약 0');
    const first = (BOARD_SNAPSHOT.jeonse as { id: string; name: string; area: number }[]).find((r) => r.id === ids[0])!;
    const second = (BOARD_SNAPSHOT.jeonse as { id: string; name: string }[]).find((r) => r.id === ids[1])!;
    expect(short.line.startsWith(`1 ${second.name}`)).toBe(true);
    expect(short.line).not.toContain(`${first.name} ${first.area} (`);
  });

  it('새 공고는 수집 기준 30일 안만이고, 아니면 N일째가 asOf − 최신 공고일입니다', () => {
    const line = run()[2].line;
    const labels = { changwon: '창원', busan: '부산', gyeonggi: '경기' } as const;
    for (const region of ['changwon', 'busan', 'gyeonggi'] as const) {
      const latest = NOTICES.filter((n) => n.region === region).map((n) => n.noticeDate).sort().at(-1)!;
      const days = daysBetween(latest, APPLYHOME.asOf);
      if (days <= NEW_NOTICE_DAYS) {
        const fresh = NOTICES.filter((n) => n.region === region && daysBetween(n.noticeDate, APPLYHOME.asOf) <= NEW_NOTICE_DAYS);
        expect(line).toContain(`${labels[region]} ${fresh.length}건`);
      } else {
        expect(line).toContain(`${labels[region]} ${days}일째 없음`);
      }
    }
  });

  it('후보판 저장값이 없거나 깨졌으면 스냅샷 seed 의 소거 목록을 씁니다', () => {
    expect(excludedFrom(null)).toEqual(BOARD_SNAPSHOT.seed.jeonse.excluded);
    expect(excludedFrom({ memo: {} })).toEqual(BOARD_SNAPSHOT.seed.jeonse.excluded);
    expect(excludedFrom({ excluded: { x: true } })).toEqual({ x: true });
  });

  it('시장 온도는 축을 나란히 적고 합친 숫자를 내지 않습니다', () => {
    const t = run()[3];
    expect(t.line).toMatch(/매매 거래/);
    expect(t.line).toMatch(/전세가율/);
    expect(t.line).toMatch(/전세 1년/);
    expect(t.detail.join(' ')).toContain('합친 점수는 없습니다');
  });
});
