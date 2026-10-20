import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrototypeBanner } from '../PrototypeBanner';

describe('prototype2 배너', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('VITE_PROTOTYPE 없이 빌드하면 아무것도 그리지 않습니다 — 운영 빌드에는 안 나옵니다', () => {
    vi.stubEnv('VITE_PROTOTYPE', '');
    expect(renderToStaticMarkup(createElement(PrototypeBanner))).toBe('');
  });

  it('VITE_PROTOTYPE=2 면 바뀐 것 4가지를 적습니다', () => {
    vi.stubEnv('VITE_PROTOTYPE', '2');
    const html = renderToStaticMarkup(createElement(PrototypeBanner));
    expect(html).toContain('prototype2');
    expect(html).toContain('운영 사이트(/hyrealty/)에는 없습니다');
    for (const mark of ['①', '②', '③', '④']) expect(html).toContain(mark);
  });
});
