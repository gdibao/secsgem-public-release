import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import useRenderBusinessChatErrorMessageExtra from './useRenderBusinessChatErrorMessageExtra';

const navigateMock = vi.fn();

vi.mock('@lobechat/types', () => ({
  ChatErrorType: {
    InsufficientBudgetForModel: 'InsufficientBudgetForModel',
  },
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: (
    factory: (helpers: { css: (value: TemplateStringsArray) => string }) => any,
  ) =>
    Object.fromEntries(Object.keys(factory({ css: () => 'mock-class' })).map((key) => [key, key])),
  cssVar: new Proxy(
    {},
    {
      get: (_, property) => String(property),
    },
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/features/Conversation/ChatItem/components/ErrorContent', () => ({
  default: ({
    error,
    id,
  }: {
    error?: { action?: ReactNode; description?: ReactNode; message?: string };
    id?: string;
  }) => (
    <div data-testid={id}>
      <div>{error?.message}</div>
      <div>{error?.description}</div>
      {error?.action}
    </div>
  ),
}));

vi.mock('@/hooks/useProviderName', () => ({
  useProviderName: () => 'OpenAI',
}));

const HookHarness = ({
  error,
}: {
  error?: {
    body?: Record<string, unknown>;
    message?: string;
    type?: string;
  } | null;
}) => {
  const node = useRenderBusinessChatErrorMessageExtra(error as any, 'msg-budget');

  return <>{node}</>;
};

describe('useRenderBusinessChatErrorMessageExtra', () => {
  it('renders nothing for non-commercial errors', () => {
    const { container } = render(
      <HookHarness error={{ message: 'Other error', type: 'InternalServerError' }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the insufficient-budget card with precise credits and actions', () => {
    render(
      <HookHarness
        error={{
          body: {
            availableCredits: 120,
            model: 'gpt-test',
            provider: 'openai',
            requiredCredits: 502,
            shortfallCredits: 382,
          },
          message: 'COMMERCIAL_BALANCE_EXHAUSTED',
          type: 'InsufficientBudgetForModel',
        }}
      />,
    );

    expect(screen.getByText('limitation.insufficientBudget.title')).toBeInTheDocument();
    expect(screen.getByText('limitation.insufficientBudget.desc')).toBeInTheDocument();
    expect(screen.getByText('OpenAI / gpt-test')).toBeInTheDocument();
    expect(screen.getByText('0.00012 M')).toBeInTheDocument();
    expect(screen.getByText('0.000502 M')).toBeInTheDocument();
    expect(screen.getByText('0.000382 M')).toBeInTheDocument();

    fireEvent.click(screen.getByText('billing.redeem.title'));
    fireEvent.click(screen.getByText('comparePlans'));

    expect(navigateMock).toHaveBeenNthCalledWith(1, '/settings/billing');
    expect(navigateMock).toHaveBeenNthCalledWith(2, '/settings/plans');
  });
});
