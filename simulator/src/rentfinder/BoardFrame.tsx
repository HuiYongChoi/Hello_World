import { useEffect, useMemo, useRef, useState } from 'react';
import { buildBoardDoc } from './board/boardDoc';
import { hasProfile, loadAdded, loadProfile } from './RentFinderApp';

/**
 * 전·월세 후보판 — 사이트 안에 싣는 자리.
 *
 * 후보판은 자기 사이드바(전세 ↔ 월세)와 표·지도·메모를 가진 한 장짜리 화면이라
 * iframe 안에 통째로 둡니다. 같은 출처(srcdoc)라 저장은 이 사이트의 브라우저
 * 저장소에 남고, 다른 기기로는 후보판의 "설정 옮기기" 로 파일을 주고받습니다.
 *
 * 높이는 화면 높이에서 **사이트의 고정 머리줄만큼 뺀 값**입니다. 내용 높이로
 * 늘리면 후보판 안의 고정 머리줄과 사이드바가 붙지 않고, 머리줄을 안 빼면
 * 후보판 윗부분이 그 밑에 깔립니다.
 */
export function BoardFrame() {
  /*
   * 전월세 찾기의 "내 조건" 과 담은 집을 여기서 읽어 후보판을 다시 조립합니다.
   * 탭을 열 때마다 새로 조립하므로, 찾기 화면에서 바꾼 것이 바로 반영됩니다.
   */
  const doc = useMemo(
    () =>
      buildBoardDoc({
        theme: 'dark',
        borrower: hasProfile() ? loadProfile().borrower : undefined,
        added: loadAdded(),
      }),
    []
  );
  const ref = useRef<HTMLIFrameElement>(null);
  const [top, setTop] = useState(0);

  useEffect(() => {
    const measure = () => setTop(document.querySelector('header')?.getBoundingClientRect().height ?? 0);
    measure();
    window.addEventListener('resize', measure);
    // 탭을 열면 후보판이 머리줄 바로 아래부터 화면을 채우도록 끌어올립니다.
    requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'start' }));
    return () => window.removeEventListener('resize', measure);
  }, []);

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-slate-500">
        왼쪽 사이드바에서 <b className="text-slate-300">전세 · 월세</b>를 오갑니다. 소거·메모·순위·점수는
        이 브라우저에 저장되고, 다른 기기로는 사이드바 아래 <b className="text-slate-300">설정 옮기기</b>로 파일을
        주고받습니다.
      </p>
      <iframe
        ref={ref}
        title="전·월세 후보판"
        srcDoc={doc}
        className="block w-full rounded-xl border border-slate-800"
        style={{ height: `calc(100vh - ${Math.round(top) + 16}px)`, minHeight: 520, scrollMarginTop: Math.round(top) + 8 }}
      />
    </div>
  );
}
