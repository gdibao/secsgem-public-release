/**
 * @vitest-environment happy-dom
 */
import { render, waitFor } from '@testing-library/react';
import { type PropsWithChildren, useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAntdLocale, init, instance } = vi.hoisted(() => ({
  getAntdLocale: vi.fn(),
  init: vi.fn(async () => {}),
  instance: { isInitialized: false, language: 'en-US', off: vi.fn(), on: vi.fn() },
}));

vi.mock('@/utils/locale', () => ({ getAntdLocale }));
vi.mock('@/utils/dayjsLocale', () => ({
  loadDayjsLocaleModule: vi.fn(async () => ({ default: {} })),
  normalizeDayjsLocale: (lang: string) => lang,
}));
vi.mock('@/locales/create', () => ({
  createI18nNext: () => ({ init, instance }),
}));
vi.mock('antd', () => ({
  ConfigProvider: ({ children }: PropsWithChildren) => children,
}));
vi.mock('@/layout/GlobalProvider/Editor', () => ({
  default: ({ children }: PropsWithChildren) => children,
}));
vi.mock('dayjs', () => ({ default: { locale: vi.fn() } }));
vi.mock('rtl-detect', () => ({ isRtlLang: () => false }));

import Locale from './Locale';

let mounts = 0;
const MountCounter = () => {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <div>child</div>;
};

describe('Locale', () => {
  beforeEach(() => {
    mounts = 0;
    init.mockClear();
    instance.isInitialized = false;
    getAntdLocale.mockReset();
    getAntdLocale.mockResolvedValue(undefined);
  });

  it('requests synchronous initialization for bundled resources', () => {
    render(
      <Locale defaultLang="en-US">
        <div>content</div>
      </Locale>,
    );

    expect(init).toHaveBeenCalledWith({ initAsync: false });
  });

  it('keeps the subtree mounted when the antd locale resolves', async () => {
    let resolveLocale: (value: unknown) => void = () => {};
    getAntdLocale.mockReturnValue(
      new Promise((resolve) => {
        resolveLocale = resolve;
      }),
    );

    render(
      <Locale defaultLang="zh-CN">
        <MountCounter />
      </Locale>,
    );
    expect(mounts).toBe(1);

    resolveLocale({ locale: 'zh-cn' });
    await waitFor(() => expect(getAntdLocale).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));

    expect(mounts).toBe(1);
  });
});
