import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * **엔트리는 하나입니다.**
 *
 * 한때 전월세 찾기를 두 번째 엔트리(`rent.html`)로 두었는데, 그 순간 Vite 가
 * 공통 코드를 공유 청크로 분리했습니다. 단일 HTML 빌더는 `<script src>` 태그만
 * 인라인하므로 엔트리 코드 안의 `import "./index-*.js"` 가 그대로 남았고,
 * 배포된 문서에서 그 파일을 찾지 못해 **두 사이트가 모두 백지**가 됐습니다.
 *
 * 화면은 탭으로 늘리고 번들은 하나로 둡니다.
 */
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
});
