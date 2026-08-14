import type { Profile, Property } from '../types';

export const baseProfile: Profile = {
  ownIncome: 60000000,
  spouseIncome: 45000000,
  isFirstTime: true,
  spouseHouseHistory: 'none',
  isOver30: true,
  maritalStatus: 'engaged',
  childCount: 0,
  newbornWithin2y: false,
  ownCash: 120000000,
  spouseCash: 60000000,
  existingMonthlyDebt: 0,
  netWorth: 180000000,
  includeSpouseCashBeforeMarriage: false,
  termYears: 30,
  purchaseDate: '2026-11-01',
  rateAdjust: 0,
  movingAndRepair: 3000000,
};

export function makeProperty(over: Partial<Property> = {}): Property {
  return {
    id: 'p1',
    name: '테스트 아파트',
    region: 'changwon',
    sigungu: '창원시 성산구',
    price: 380000000,
    areaSqm: 84.9,
    householdCount: 1200,
    builtYear: 2018,
    scores: {},
    penalties: [],
    ...over,
  };
}
