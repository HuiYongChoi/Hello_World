import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RentFinderApp } from './rentfinder/RentFinderApp';
import './index.css';

/**
 * 두 번째 사이트의 진입점.
 *
 * 매수 시뮬레이터(`main.tsx`)와 저장소·빌드 파이프라인은 같이 쓰되 **앱은
 * 완전히 갈라 둡니다.** 스토어도 공유하지 않습니다 — 저기는 가구 프로필과
 * 시나리오가 필요하고 여기는 예산과 지역만 필요합니다.
 */

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

createRoot(root).render(
  <StrictMode>
    <RentFinderApp />
  </StrictMode>
);
