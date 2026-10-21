import { useState } from 'react';
import { MARKET } from '../engine/market';
import { RENT_SNAPSHOT } from '../rentfinder/data';

/**
 * prototype2 배너 — `VITE_PROTOTYPE=2` 로 빌드했을 때만 그립니다.
 *
 * 운영 빌드(`npm run deploy:realty`)에는 변수가 없어 아무것도 그리지 않습니다.
 * 접으면 이 세션 동안 접혀 있습니다(sessionStorage).
 */

const FOLD_KEY = 'prototype-banner-folded';

export const PROTOTYPE_LINES = [
  '① 단지 이름 → 상세 패널: 같은 단지·평형의 매매·전세 분기 추이, 전세가율, 평형별 표, 전세 만기 (후보판·찾기·시세판 어디서든)',
  '② 동네 시세판: 마산회원·합포(창원 5구까지) 동별 ㎡당 전세·매매 중위, 전세가율, 거래량·1년 변화, 신축 비중 — 열을 눌러 정렬',
  '③ 시장 온도: 구별 거래량 추세·매매/전세 1년 변화·전세가율 추이를 나란히 — 합산 점수는 일부러 없습니다 (실거래 수익률 탭 맨 위)',
  '④ 오늘 볼 것: 전세 신호·남은 후보·새 공고·시장 온도 한 줄 — 누르면 그 화면으로 (하루 한 번 접힘)',
];

export function isPrototype2(): boolean {
  return import.meta.env.VITE_PROTOTYPE === '2';
}

function readFolded(): boolean {
  try {
    return sessionStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

export function PrototypeBanner() {
  const [open, setOpen] = useState(() => !readFolded());
  if (!isPrototype2()) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      sessionStorage.setItem(FOLD_KEY, next ? '0' : '1');
    } catch {
      /* 저장이 막혀 있으면 이 화면에서만 */
    }
  };

  return (
    <div className="no-print border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-200">
      <button type="button" onClick={toggle} className="flex w-full items-center gap-2 text-left">
        <span className="font-semibold">prototype2</span>
        <span className="min-w-0 truncate text-amber-200/80">
          바뀐 것 4가지 · 운영 사이트(/hyrealty/)에는 없습니다 · 자료 기준 매매 {MARKET.asOf.slice(0, 7)} · 전월세 {RENT_SNAPSHOT.asOf.slice(0, 7)}
        </span>
        <span className="ml-auto shrink-0 text-amber-300/70">{open ? '접기 ▴' : '펼치기 ▾'}</span>
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pb-1 leading-relaxed text-amber-100/80">
          {PROTOTYPE_LINES.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
