import { ADMIN_COMMANDS } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { adminCommercialService } from '@/services/adminCommercial';

import AdminDangerousActionButton from './AdminDangerousActionButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('antd', () => {
  const Input = Object.assign(
    (props: { value?: string }) => <input readOnly value={props.value} />,
    { TextArea: (props: { value?: string }) => <textarea readOnly value={props.value} /> },
  );

  return {
    Button: ({
      children,
      onClick,
    }: {
      children?: ReactNode;
      onClick?: () => void;
    }) => <button onClick={onClick}>{children}</button>,
    Input,
    Modal: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Popconfirm: ({
      children,
      onConfirm,
    }: {
      children?: ReactNode;
      onConfirm?: () => Promise<void> | void;
    }) => (
      <div>
        {children}
        <button onClick={() => void onConfirm?.()}>Confirm action</button>
      </div>
    ),
    Typography: { Text: ({ children }: { children?: ReactNode }) => <span>{children}</span> },
  };
});

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    admin: {
      users: {
        recordImpersonationAttempt: { mutate: vi.fn() },
      },
    },
  },
}));

describe('AdminDangerousActionButton effect forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards the confirmed envelope through the service to the catalogued HTTP boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ ok: true }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminDangerousActionButton
        actionId="user.impersonate.attempt"
        onConfirm={(command) => adminCommercialService.impersonateUser('target-user', command)}
      >
        Impersonate user
      </AdminDangerousActionButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Impersonate user' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm action' }));

    const boundary = ADMIN_COMMANDS['user.impersonate.attempt'].serverBoundary;
    expect(boundary).toMatchObject({ kind: 'http', method: 'POST' });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(boundary.kind === 'http' ? boundary.path : '', expect.anything());
    });
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(requestInit.body as string)).toEqual({
      command: { actionId: 'user.impersonate.attempt', confirmed: true },
      userId: 'target-user',
    });
    expect(lambdaClient.admin.users.recordImpersonationAttempt.mutate).not.toHaveBeenCalled();
  });
});
