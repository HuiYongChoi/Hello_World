/**
 * 대체투자 수익률 — KRX 지수 실측치와 가정치.
 *
 * 3-way 비교에서 "집 안 사고 굴렸으면"을 계산하는 값입니다. 이 하나가 결론을
 * 뒤집기 때문에 **무엇이 실측이고 무엇이 근사인지** 반드시 구분해야 합니다.
 *
 * ## 코스피는 근사입니다
 *
 * 승인된 KRX 지수 API 는 코스피 계열 51개를 주는데 전부 **가격지수**입니다.
 * 총수익지수(TR)가 없어서 배당이 빠집니다. 배당 연 2%면 10년에 20%p 넘게
 * 벌어지므로 그대로 쓰면 대체투자가 부당하게 불리해집니다. 그래서 가격지수
 * 실측 CAGR 에 배당수익률 **가정**을 더한 근사치를 씁니다.
 *
 * ## 채권은 실측입니다
 *
 * KRX 채권지수는 `TOT_EARNG_IDX`(총수익지수)를 직접 주므로 이자 재투자가 이미
 * 반영돼 있습니다. 근사가 아닙니다.
 *
 * ## 10년 한 구간이라는 한계
 *
 * 시작·끝 시점 두 점으로 낸 CAGR 이라 구간을 조금만 옮겨도 크게 달라집니다.
 * "앞으로도 이만큼"이 아니라 "이 구간에는 이랬다"로 읽어야 합니다.
 */

import indexSnapshot from '../data/index-2026-08.json';
import { RULES } from './rules';

export type Provenance = 'measured' | 'approx' | 'assumed';

export interface InvestmentOption {
  id: string;
  label: string;
  rate: number;
  provenance: Provenance;
  note: string;
}

interface RawIndexSnapshot {
  version: string;
  asOf: string;
  source: { name: string; endpoint: string; license: string };
  range: { from: string; to: string; years: number };
  kospi: {
    label: string;
    fromIndex: number;
    toIndex: number;
    priceCagr: number;
    dividendYieldAssumed: number;
    totalReturnApprox: number;
    note: string;
  };
  bond: {
    label: string;
    fromIndex: number;
    toIndex: number;
    totalReturnCagr: number;
    note: string;
  } | null;
}

export const INDEXES = indexSnapshot as unknown as RawIndexSnapshot;

const ymd = (s: string) => `${s.slice(0, 4)}.${s.slice(4, 6)}`;

/**
 * 화면에 세울 대체투자 후보들.
 *
 * 실측이 있는 것은 실측으로, 없는 것(해외지수)은 통념치로 두되 **표식을
 * 달아 섞이지 않게** 합니다.
 */
export function investmentOptions(): InvestmentOption[] {
  const period = `${ymd(INDEXES.range.from)}~${ymd(INDEXES.range.to)} ${INDEXES.range.years}년`;
  const out: InvestmentOption[] = [
    {
      id: 'kospi',
      label: '코스피',
      rate: INDEXES.kospi.totalReturnApprox,
      provenance: 'approx',
      note:
        `${period} 가격지수 실측 CAGR ${(INDEXES.kospi.priceCagr * 100).toFixed(2)}% ` +
        `+ 배당 가정 ${(INDEXES.kospi.dividendYieldAssumed * 100).toFixed(1)}%. ` +
        'KRX 에 코스피 총수익지수가 없어 배당은 가정입니다.',
    },
  ];

  if (INDEXES.bond) {
    out.push({
      id: 'bond',
      label: 'KRX 채권지수',
      rate: INDEXES.bond.totalReturnCagr,
      provenance: 'measured',
      note: `${period} 총수익지수 실측. 이자 재투자가 반영된 값이라 근사가 아닙니다.`,
    });
  }

  // 해외지수는 아직 소스가 없습니다 — 통념치를 쓰되 실측과 섞이지 않게 표시합니다.
  for (const p of RULES.tenure.investmentPresets.items) {
    if (p.id === 'kospi' || p.id === 'bond') continue;
    out.push({ id: p.id, label: p.label, rate: p.rate, provenance: 'assumed', note: p.note });
  }

  return out.sort((a, b) => a.rate - b.rate);
}

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  measured: '실측',
  approx: '실측+가정',
  assumed: '가정',
};
