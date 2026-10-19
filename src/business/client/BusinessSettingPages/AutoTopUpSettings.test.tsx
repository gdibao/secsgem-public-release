/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AutoTopUpSettings from './AutoTopUpSettings';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  swr: {
    data: {
      enabled: false,
      monthlyLimit: null,
      monthlyTopUpAmount: 0,
      targetBalance: 120_000_000,
      threshold: 40_000_000,
    } as Record<string, unknown> | undefined,
    error: undefined as Error | undefined,
    isLoading: false,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === 'credits.autoTopUp.unavailable'
        ? 'Automatic charging is not supported by the current payment methods.'
        : key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  InputNumber: (props: Record<string, unknown>) => <input {...props} />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  Switch: ({ disabled }: { disabled?: boolean }) => (
    <input readOnly aria-label="auto-top-up-switch" disabled={disabled} type="checkbox" />
  ),
}));

vi.mock('antd', () => ({
  Alert: ({ message, title }: { message?: ReactNode; title?: ReactNode }) => (
    <div role="alert">{title ?? message}</div>
  ),
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({ ...mocks.swr, mutate: mocks.mutate }),
}));

vi.mock('@/services/commercial', () => ({
  commercialService: {
    getAutoTopUpSetting: vi.fn(),
    updateAutoTopUpSetting: vi.fn(),
  },
}));

describe('AutoTopUpSettings', () => {
  beforeEach(() => {
    mocks.mutate.mockReset();
    mocks.swr.data = {
      enabled: false,
      monthlyLimit: null,
      monthlyTopUpAmount: 0,
      targetBalance: 120_000_000,
      threshold: 40_000_000,
    };
    mocks.swr.error = undefined;
    mocks.swr.isLoading = false;
  });

  it('keeps auto top-up disabled while recurring payment authorization is unavailable', () => {
    render(<AutoTopUpSettings isPaidPlan />);

    expect(
      screen.getByText('Automatic charging is not supported by the current payment methods.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'auto-top-up-switch' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'credits.autoTopUp.save' })).toBeDisabled();
  });

  it('shows a retry action when loading the setting fails', () => {
    mocks.swr.data = undefined;
    mocks.swr.error = new Error('network failed');

    render(<AutoTopUpSettings isPaidPlan />);

    expect(screen.getByRole('alert')).toHaveTextContent('credits.autoTopUp.loadError');
    expect(screen.queryByText('正在加载自动充值设置...')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'credits.autoTopUp.retry' }));
    expect(mocks.mutate).toHaveBeenCalledOnce();
  });
});
