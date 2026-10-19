import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InstallationSecrets from './InstallationSecrets';

const mocks = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  deleteSecret: vi.fn(),
  mutate: vi.fn(),
  secretsError: undefined as unknown,
  secretsData: {
    items: [
      {
        createdAt: new Date('2026-07-26T00:00:00.000Z'),
        secretKey: 'CRM_TOKEN',
        updatedAt: new Date('2026-07-26T00:00:00.000Z'),
      },
    ],
    missingKeys: ['API_KEY'],
    ready: false,
    requiredKeys: ['API_KEY', 'CRM_TOKEN'],
  } as
    | {
        items: Array<{ createdAt: Date; secretKey: string; updatedAt: Date }>;
        missingKeys: string[];
        ready: boolean;
        requiredKeys: string[];
      }
    | undefined,
  secretsLoading: false,
  upsertSecret: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { key?: string }) => (values?.key ? `${key}:${values.key}` : key),
  }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    icon,
    loading: _loading,
    type: _type,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: ReactNode;
    loading?: boolean;
  }) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  ),
  confirmModal: mocks.confirmModal,
}));

vi.mock('swr', () => ({
  default: vi.fn(() => ({
    data: mocks.secretsData,
    error: mocks.secretsError,
    isLoading: mocks.secretsLoading,
    mutate: mocks.mutate,
  })),
}));

vi.mock('@/services/moduleApp', () => ({
  moduleAppService: {
    deleteInstallationSecret: mocks.deleteSecret,
    listInstallationSecrets: vi.fn(),
    upsertInstallationSecret: mocks.upsertSecret,
  },
}));

describe('InstallationSecrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteSecret.mockResolvedValue({ ok: true });
    mocks.mutate.mockResolvedValue(undefined);
    mocks.secretsData = {
      items: [
        {
          createdAt: new Date('2026-07-26T00:00:00.000Z'),
          secretKey: 'CRM_TOKEN',
          updatedAt: new Date('2026-07-26T00:00:00.000Z'),
        },
      ],
      missingKeys: ['API_KEY'],
      ready: false,
      requiredKeys: ['API_KEY', 'CRM_TOKEN'],
    };
    mocks.secretsError = undefined;
    mocks.secretsLoading = false;
    mocks.upsertSecret.mockResolvedValue({ ok: true });
  });

  it('sets, rotates, and deletes only installation-scoped secret metadata', async () => {
    const onChange = vi.fn();
    render(
      <InstallationSecrets
        installationId="installation-1"
        workspaceId="workspace-1"
        onChange={onChange}
      />,
    );

    expect(screen.getByText('moduleApps.secrets.configured')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.secrets.notConfigured')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('')).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('CRM_TOKEN'), { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.secrets.rotate' }));

    await waitFor(() =>
      expect(mocks.upsertSecret).toHaveBeenCalledWith({
        installationId: 'installation-1',
        secretKey: 'CRM_TOKEN',
        value: 'new-secret',
        workspaceId: 'workspace-1',
      }),
    );
    expect(mocks.mutate).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.secrets.deleteKey:CRM_TOKEN' }));
    expect(mocks.confirmModal).toHaveBeenCalledTimes(1);
    await mocks.confirmModal.mock.calls[0][0].onOk();
    expect(mocks.deleteSecret).toHaveBeenCalledWith({
      installationId: 'installation-1',
      secretKey: 'CRM_TOKEN',
      workspaceId: 'workspace-1',
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does not present missing credentials before metadata finishes loading', () => {
    mocks.secretsData = undefined;
    mocks.secretsLoading = true;

    render(<InstallationSecrets installationId="installation-1" />);

    expect(screen.getByTestId('module-app-installation-secrets')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByText('moduleApps.secrets.loading')).toBeInTheDocument();
    expect(screen.queryByText('moduleApps.secrets.notConfigured')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows a terminal error instead of leaving the section busy', () => {
    mocks.secretsData = undefined;
    mocks.secretsError = new Error('request failed');

    render(<InstallationSecrets installationId="installation-1" />);

    expect(screen.getByTestId('module-app-installation-secrets')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('moduleApps.secrets.error');
    expect(screen.queryByText('moduleApps.secrets.loading')).not.toBeInTheDocument();
  });

  it('stays hidden when the installed version declares no credentials', () => {
    mocks.secretsData = { items: [], missingKeys: [], ready: true, requiredKeys: [] };

    render(<InstallationSecrets installationId="installation-1" />);

    expect(screen.queryByTestId('module-app-installation-secrets')).not.toBeInTheDocument();
  });
});
