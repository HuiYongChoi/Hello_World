import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 한 저장소에 사이트가 둘입니다.
 *
 *   index.html  주택 매수 의사결정 시뮬레이터
 *   rent.html   마산 전월세 찾기 (함안·의령 출퇴근 기준)
 *
 * 묻는 질문이 달라 앱을 갈라 뒀지만, React·Tailwind·포맷 유틸·UI 컴포넌트는
 * 그대로 나눠 씁니다. 빌드도 한 번에 돌고 각각 단일 HTML 로 인라인됩니다.
 */
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      // 경로는 vite root 기준 상대경로입니다 — node 타입을 끌어오지 않으려고
      // __dirname 을 쓰지 않습니다.
      input: {
        index: 'index.html',
        rent: 'rent.html',
      },
    },
  },
});
