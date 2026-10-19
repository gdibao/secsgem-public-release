import { ConfigProvider } from '@lobehub/ui';
import type * as LobeUIBaseModule from '@lobehub/ui/base-ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as m from 'motion/react-m';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ADMIN_DESKTOP_OVERVIEW_SWR_KEY,
  ADMIN_SETTINGS_SECTION_SWR_KEY,
} from '@/const/adminCacheKeys';
import { useClientDataSWR } from '@/libs/swr';
import { adminCommercialService } from '@/services/adminCommercial';

import type { DesktopReleaseHistoryItem } from './DesktopBuildHistory';
import DesktopControlCenter from './index';

const confirmModalMock = vi.hoisted(() => vi.fn());
const routeBlocker = vi.hoisted(() => ({
  proceed: vi.fn(),
  reset: vi.fn(),
  state: 'unblocked' as 'blocked' | 'unblocked',
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof LobeUIBaseModule>()),
  confirmModal: confirmModalMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router', () => ({
  useBlocker: () => routeBlocker,
  useLocation: () => ({ pathname: '/settings/admin/desktop-update', search: '' }),
  useSearchParams: vi.fn(),
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: vi.fn(),
}));

vi.mock('@/services/adminCommercial', () => ({
  adminCommercialService: {
    activateDesktopRelease: vi.fn(),
    archiveBuildProfile: vi.fn(),
    completeBuildAssetUpload: vi.fn(),
    createBuildAssetUpload: vi.fn(),
    createDesktopRelease: vi.fn(),
    getBuildProfile: vi.fn(),
    getDesktopOverview: vi.fn(),
    getSettingsSection: vi.fn(),
    listBuildProfiles: vi.fn(),
    listDesktopReleases: vi.fn(),
    reconcileDesktopRelease: vi.fn(),
    retryDesktopRelease: vi.fn(),
    saveBuildProfileDraft: vi.fn(),
    setAppSettingsBatch: vi.fn(),
  },
}));

const availableArtifact = (type: 'linux' | 'mac-arm' | 'mac-intel' | 'windows') => ({
  assetName:
    type === 'windows'
      ? 'ComHub-2.3.0-setup.exe'
      : type === 'linux'
        ? 'ComHub-2.3.0.AppImage'
        : `ComHub-2.3.0-${type}.dmg`,
  publishedAt: '2026-07-21T00:00:00.000Z',
  size: 1024 * 1024,
  status: 'available' as const,
  type,
  url: `https://releases.example.com/${type}`,
  version: '2.3.0',
});

const overviewData = {
  automation: {
    configured: true,
    ref: 'main',
    repository: 'maheshenga/comhub',
    tokenConfigured: true,
    workflowFile: 'comhub-desktop-release.yml',
  },
  configuredChannel: 'stable',
  configuredVersion: '2.3.0',
  diagnostics: {
    baseUrl: 'https://releases.example.com',
    channels: [
      {
        channel: 'stable' as const,
        platforms: {
          'linux': availableArtifact('linux'),
          'mac-arm': availableArtifact('mac-arm'),
          'mac-intel': availableArtifact('mac-intel'),
          'windows': availableArtifact('windows'),
        },
        publishedAt: '2026-07-21T00:00:00.000Z',
        status: 'healthy' as const,
        version: '2.3.0',
      },
      {
        channel: 'canary' as const,
        platforms: {
          'linux': availableArtifact('linux'),
          'mac-arm': availableArtifact('mac-arm'),
          'mac-intel': availableArtifact('mac-intel'),
          'windows': availableArtifact('windows'),
        },
        publishedAt: '2026-07-21T00:00:00.000Z',
        status: 'healthy' as const,
        version: '2.3.0',
      },
    ],
    checkedAt: '2026-07-21T00:00:00.000Z',
    configured: true,
  },
  runtimePolicy: {
    autoCheck: true,
    channel: 'stable' as const,
    checkInterval: 60,
  },
};

const defaultSettingsData = {
  desktopDownloadLabel: 'Download desktop',
  desktopDownloadUrl: 'https://downloads.example.com',
  desktopLoginConfig: {},
  desktopOssConfig: {
    bucket: 'releases',
    credentialsConfigured: true,
    endpoint: 'oss.example.com',
    path: 'releases',
  },
  desktopUpdateConfig: {
    autoCheck: true,
    channel: 'stable',
    checkInterval: 60,
    currentVersion: '2.3.0',
    releaseNotes: '',
    serverUrl: 'https://releases.example.com',
  },
  section: 'desktop-update' as const,
};

const setSearchParams = vi.fn();
const overviewMutate = vi.fn().mockResolvedValue(undefined);
const settingsMutate = vi.fn().mockResolvedValue(undefined);
const profilesMutate = vi.fn().mockResolvedValue(undefined);
const releasesMutate = vi.fn().mockResolvedValue(undefined);
let setProfilesData: (data: { items: Array<typeof buildProfileData>; nextCursor?: string }) => void;
let setSettingsData: (data: typeof defaultSettingsData) => void;

const completeAssets = {
  appPreview: {
    contentType: 'image/png',
    key: 'desktop-build-assets/profile/app-preview.png',
    kind: 'appPreview',
    sha256: 'a'.repeat(64),
    size: 1024,
  },
  nsisHeader: {
    contentType: 'image/bmp',
    key: 'desktop-build-assets/profile/header.bmp',
    kind: 'nsisHeader',
    sha256: 'b'.repeat(64),
    size: 1024,
  },
  nsisSidebar: {
    contentType: 'image/bmp',
    key: 'desktop-build-assets/profile/sidebar.bmp',
    kind: 'nsisSidebar',
    sha256: 'c'.repeat(64),
    size: 1024,
  },
  windowsIcon: {
    contentType: 'image/x-icon',
    key: 'desktop-build-assets/profile/icon.ico',
    kind: 'windowsIcon',
    sha256: 'd'.repeat(64),
    size: 1024,
  },
};

const buildProfileData = {
  currentDraft: {
    assetManifest: completeAssets,
    id: 'revision-1',
    payload: {
      applicationId: 'com.qingyou.comhub',
      applicationName: 'ComHub',
      description: 'ComHub desktop',
      executableName: 'ComHub',
      homepage: 'https://secsgem.com.cn',
      installerArtifactName: '${productName}-${version}-${arch}.${ext}',
      protocolScheme: 'comhub',
      publisher: 'Qingyou',
      shortcutName: 'ComHub',
      uninstallDisplayName: 'ComHub',
    },
    state: 'draft',
  },
  currentRevision: 1,
  id: '00000000-0000-4000-8000-000000000001',
  identityLocked: false,
  name: 'ComHub',
};

const releaseData: DesktopReleaseHistoryItem[] = [
  {
    actorUserId: 'admin-1',
    artifacts: [
      { fileName: 'ComHub-2.4.0-x64.exe', storageKey: 'desktop-build-releases/setup.exe' },
    ],
    channel: 'canary',
    createdAt: '2026-07-21T00:00:00.000Z',
    errorSummary: null,
    frozenRevisionId: 'revision-1',
    id: '44444444-4444-4444-8444-444444444444',
    profileId: buildProfileData.id,
    status: 'queued',
    version: '2.4.0-canary.1',
    workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1',
  },
];

const useSettingsTestResource = (initialData: typeof defaultSettingsData) => {
  const [data, setData] = useState(initialData);
  setSettingsData = setData;

  return {
    data,
    error: undefined,
    isLoading: false,
    mutate: settingsMutate,
  };
};

const useProfilesTestResource = (initialData: {
  items: Array<typeof buildProfileData>;
  nextCursor?: string;
}) => {
  const [data, setData] = useState(initialData);
  setProfilesData = setData;

  return {
    data,
    error: undefined,
    isLoading: false,
    mutate: profilesMutate,
  };
};

const renderControlCenter = (options?: {
  buildProfileData?: typeof buildProfileData;
  emptyProfiles?: boolean;
  overview?: Record<string, unknown>;
  overviewData?: typeof overviewData;
  releaseData?: typeof releaseData;
  search?: string;
  settingsData?: typeof defaultSettingsData;
}) => {
  vi.mocked(useSearchParams).mockReturnValue([
    new URLSearchParams(options?.search),
    setSearchParams,
  ] as any);
  vi.mocked(useClientDataSWR).mockImplementation(((key: unknown) => {
    if (key === ADMIN_DESKTOP_OVERVIEW_SWR_KEY) {
      return {
        data: options?.overviewData ?? overviewData,
        error: undefined,
        isLoading: false,
        mutate: overviewMutate,
        ...options?.overview,
      };
    }
    if (JSON.stringify(key) === JSON.stringify(ADMIN_SETTINGS_SECTION_SWR_KEY('desktop-update'))) {
      return useSettingsTestResource(options?.settingsData ?? defaultSettingsData);
    }
    if (JSON.stringify(key) === JSON.stringify(['admin-desktop-build-profiles'])) {
      return useProfilesTestResource({
        items: options?.emptyProfiles ? [] : [options?.buildProfileData ?? buildProfileData],
        nextCursor: undefined,
      });
    }
    if (Array.isArray(key) && key[0] === 'admin-desktop-releases') {
      return {
        data: key[1] ? (options?.releaseData ?? releaseData) : [],
        error: undefined,
        isLoading: false,
        mutate: releasesMutate,
      };
    }
    throw new Error(`Unexpected SWR key: ${JSON.stringify(key)}`);
  }) as any);

  const view = render(
    <ConfigProvider motion={m}>
      <DesktopControlCenter />
    </ConfigProvider>,
  );

  return {
    ...view,
    updateProfilesData: (items: Array<typeof buildProfileData>) =>
      act(() => setProfilesData({ items, nextCursor: undefined })),
    updateSettingsData: (data: typeof defaultSettingsData) => act(() => setSettingsData(data)),
  };
};

describe('DesktopControlCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeBlocker.state = 'unblocked';
    confirmModalMock.mockImplementation(({ onOk }) => onOk?.());
    vi.mocked(adminCommercialService.activateDesktopRelease).mockResolvedValue(
      releaseData[0] as any,
    );
    vi.mocked(adminCommercialService.setAppSettingsBatch).mockResolvedValue({ ok: true } as any);
    vi.mocked(adminCommercialService.saveBuildProfileDraft).mockResolvedValue({
      profileId: buildProfileData.id,
      revision: 2,
      revisionId: 'revision-2',
    } as any);
    vi.mocked(adminCommercialService.createDesktopRelease).mockResolvedValue(releaseData[0] as any);
    vi.mocked(adminCommercialService.reconcileDesktopRelease).mockResolvedValue({
      conclusion: null,
      createdAt: '2026-07-22T10:00:02Z',
      state: 'matched',
      status: 'in_progress',
      updatedAt: '2026-07-22T10:01:00Z',
      workflowRunId: '1234567890',
      workflowRunUrl: 'https://github.com/maheshenga/comhub/actions/runs/1234567890',
    } as any);
    vi.mocked(adminCommercialService.retryDesktopRelease).mockResolvedValue({
      ...releaseData[0],
      status: 'building',
    } as any);
  });

  it('lands on overview and renders stable channel health', () => {
    renderControlCenter();

    expect(screen.getByRole('heading', { name: 'admin.desktopControl.title' })).toBeInTheDocument();
    expect(screen.getAllByText('2.3.0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ComHub-2.3.0-setup.exe').length).toBeGreaterThan(0);
    expect(screen.getAllByText('admin.desktopControl.channel.healthy').length).toBeGreaterThan(0);
    expect(screen.getByText('maheshenga/comhub')).toBeInTheDocument();
    expect(screen.getByText('comhub-desktop-release.yml')).toBeInTheDocument();
    expect(screen.getByText('admin.desktopControl.policy.enabled')).toBeInTheDocument();
  });

  it('keeps the control center available when legacy settings omit desktop update config', () => {
    renderControlCenter({
      settingsData: {
        ...defaultSettingsData,
        desktopUpdateConfig: undefined,
      } as any,
    });

    expect(screen.getByRole('heading', { name: 'admin.desktopControl.title' })).toBeInTheDocument();
    expect(screen.getByText('admin.desktopControl.tabs.buildProfile')).toBeInTheDocument();
  });

  it('offers first-use profile creation when no desktop build profile exists', () => {
    renderControlCenter({ emptyProfiles: true, search: 'tab=build-profile' });

    expect(screen.getByText('admin.desktopBuild.empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopBuild.profile.create' }));

    expect(screen.getByLabelText('admin.desktopBuild.applicationName')).toHaveValue(
      '驰拓 AI 助手',
    );
    expect(
      screen.getByRole('combobox', { name: 'admin.desktopBuild.profile.selector' }),
    ).toHaveTextContent('驰拓 AI 助手');
    expect(screen.getByRole('button', { name: 'admin.desktopBuild.saveDraft' })).toBeDisabled();
  });

  it('keeps an unsaved local profile selected when the server profile list arrives', () => {
    const view = renderControlCenter({ emptyProfiles: true, search: 'tab=build-profile' });
    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopBuild.profile.create' }));

    view.updateProfilesData([
      {
        ...buildProfileData,
        currentDraft: {
          ...buildProfileData.currentDraft,
          payload: {
            ...buildProfileData.currentDraft.payload,
            applicationName: 'Server managed profile',
          },
        },
        name: 'Server managed profile',
      },
    ]);

    expect(screen.getByLabelText('admin.desktopBuild.applicationName')).toHaveValue(
      '驰拓 AI 助手',
    );
  });

  it('renders a retry action when diagnostics fail', () => {
    renderControlCenter({
      overview: { data: undefined, error: new Error('offline'), isLoading: false },
    });

    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopControl.retry' }));
    expect(overviewMutate).toHaveBeenCalledTimes(1);
  });

  it('renders an unconfigured state with a link to update settings', () => {
    renderControlCenter({
      overviewData: {
        ...overviewData,
        diagnostics: { ...overviewData.diagnostics, channels: [], configured: false },
      },
    });

    expect(screen.getByText('admin.desktopControl.unconfigured.title')).toBeInTheDocument();
    expect(screen.getByText('admin.desktopControl.policy.title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopControl.configure' }));
    const nextSearchParams = setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(nextSearchParams.get('tab')).toBe('updates');
  });

  it('preserves unrelated query parameters when switching tabs', () => {
    renderControlCenter({ search: 'source=admin-menu' });

    fireEvent.click(screen.getByRole('tab', { name: 'admin.desktopControl.tabs.brand' }));
    const nextSearchParams = setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(nextSearchParams.get('source')).toBe('admin-menu');
    expect(nextSearchParams.get('tab')).toBe('brand');
  });

  it('delegates cache refresh to the settings service after update settings are saved', async () => {
    renderControlCenter({ search: 'tab=updates' });

    fireEvent.change(screen.getByLabelText('admin.desktopUpdate.serverUrl'), {
      target: { value: 'https://new-releases.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopUpdate.save' }));

    await waitFor(() => {
      expect(adminCommercialService.setAppSettingsBatch).toHaveBeenCalledWith({
        updates: [
          {
            key: 'desktop.update.serverUrl',
            value: 'https://new-releases.example.com',
          },
        ],
      });
    });
    expect(settingsMutate).not.toHaveBeenCalled();
    expect(overviewMutate).not.toHaveBeenCalled();
  });

  it('keeps update settings input after a save failure', async () => {
    vi.mocked(adminCommercialService.setAppSettingsBatch).mockRejectedValueOnce(
      new Error('offline'),
    );
    renderControlCenter({ search: 'tab=updates' });

    const serverUrlInput = screen.getByLabelText('admin.desktopUpdate.serverUrl');
    fireEvent.change(serverUrlInput, {
      target: { value: 'https://retry-releases.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopUpdate.save' }));

    await waitFor(() => {
      expect(adminCommercialService.setAppSettingsBatch).toHaveBeenCalledTimes(1);
    });
    expect(serverUrlInput).toHaveValue('https://retry-releases.example.com');
  });

  it('keeps unsaved update settings when SWR data revalidates', () => {
    const options = { search: 'tab=updates', settingsData: defaultSettingsData };
    const view = renderControlCenter(options);
    const serverUrlInput = screen.getByLabelText('admin.desktopUpdate.serverUrl');

    fireEvent.change(serverUrlInput, {
      target: { value: 'https://draft-releases.example.com' },
    });
    view.updateSettingsData({
      ...defaultSettingsData,
      desktopUpdateConfig: {
        ...defaultSettingsData.desktopUpdateConfig,
        serverUrl: 'https://externally-updated.example.com',
      },
    });

    expect(serverUrlInput).toHaveValue('https://draft-releases.example.com');
  });

  it('syncs untouched fields and saves only edited fields after SWR data revalidates', async () => {
    const options = { search: 'tab=updates', settingsData: defaultSettingsData };
    const view = renderControlCenter(options);
    const releaseNotesInput = screen.getByLabelText('admin.desktopUpdate.releaseNotes');

    fireEvent.change(releaseNotesInput, { target: { value: 'Draft release notes' } });
    view.updateSettingsData({
      ...defaultSettingsData,
      desktopUpdateConfig: {
        ...defaultSettingsData.desktopUpdateConfig,
        currentVersion: '2.4.0',
      },
    });

    expect(screen.getByLabelText('admin.desktopUpdate.currentVersion')).toHaveValue('2.4.0');
    expect(releaseNotesInput).toHaveValue('Draft release notes');

    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopUpdate.save' }));

    await waitFor(() => {
      expect(adminCommercialService.setAppSettingsBatch).toHaveBeenCalledWith({
        updates: [{ key: 'desktop.update.releaseNotes', value: 'Draft release notes' }],
      });
    });
  });

  it('stops protecting a field after the user restores its server value', () => {
    const options = { search: 'tab=updates', settingsData: defaultSettingsData };
    const view = renderControlCenter(options);
    const serverUrlInput = screen.getByLabelText('admin.desktopUpdate.serverUrl');

    fireEvent.change(serverUrlInput, { target: { value: 'https://draft.example.com' } });
    fireEvent.change(serverUrlInput, {
      target: { value: defaultSettingsData.desktopUpdateConfig.serverUrl },
    });
    view.updateSettingsData({
      ...defaultSettingsData,
      desktopUpdateConfig: {
        ...defaultSettingsData.desktopUpdateConfig,
        serverUrl: 'https://externally-updated.example.com',
      },
    });

    expect(serverUrlInput).toHaveValue('https://externally-updated.example.com');
  });

  it('does not revalidate resources twice after distribution settings are saved', async () => {
    renderControlCenter({ search: 'tab=distribution' });

    fireEvent.change(screen.getByLabelText('admin.desktopUpdate.downloadLabel'), {
      target: { value: 'Get desktop' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopUpdate.save' }));

    await waitFor(() => {
      expect(adminCommercialService.setAppSettingsBatch).toHaveBeenCalledTimes(1);
    });
    expect(settingsMutate).not.toHaveBeenCalled();
    expect(overviewMutate).not.toHaveBeenCalled();
  });

  it('saves a draft without creating a release', async () => {
    renderControlCenter({ search: 'tab=build-profile' });

    fireEvent.change(screen.getByLabelText('admin.desktopBuild.applicationName'), {
      target: { value: 'ComHub Pro' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopBuild.saveDraft' }));

    await waitFor(() => {
      expect(adminCommercialService.saveBuildProfileDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedRevision: buildProfileData.currentRevision,
          name: 'ComHub Pro',
          profileId: buildProfileData.id,
          payload: expect.objectContaining({ applicationName: 'ComHub Pro' }),
        }),
      );
    });
    expect(adminCommercialService.createDesktopRelease).not.toHaveBeenCalled();
  });

  it('requires confirmation before creating a build', () => {
    renderControlCenter({ search: 'tab=build-profile' });

    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopBuild.createBuild' }));

    expect(screen.getByRole('dialog', { name: 'admin.desktopBuild.release.title' })).toBeVisible();
  });

  it('refreshes release history when initial dispatch delivery is ambiguous', async () => {
    vi.mocked(adminCommercialService.createDesktopRelease).mockRejectedValueOnce(
      new Error('GitHub dispatch delivery is unknown.'),
    );
    renderControlCenter({ search: 'tab=build-profile' });

    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopBuild.createBuild' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopBuild.release.confirm' }));

    await waitFor(() => expect(adminCommercialService.createDesktopRelease).toHaveBeenCalled());
    expect(releasesMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'admin.desktopBuild.release.title' })).toBeVisible();
  });

  it('does not save or release a build profile until Windows assets are complete', () => {
    renderControlCenter({
      buildProfileData: {
        ...buildProfileData,
        currentDraft: {
          ...buildProfileData.currentDraft,
          assetManifest: { appPreview: completeAssets.appPreview } as any,
        },
      },
      search: 'tab=build-profile',
    });

    expect(screen.getByRole('button', { name: 'admin.desktopBuild.saveDraft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'admin.desktopBuild.createBuild' })).toBeDisabled();
  });

  it('reconciles a building release and refreshes the history', async () => {
    renderControlCenter({
      releaseData: [{ ...releaseData[0], status: 'building', workflowRunUrl: null }],
      search: 'tab=build-profile',
    });

    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopBuild.history.reconcile' }));

    await waitFor(() => {
      expect(adminCommercialService.reconcileDesktopRelease).toHaveBeenCalledWith(
        '44444444-4444-4444-8444-444444444444',
      );
    });
    expect(releasesMutate).toHaveBeenCalledTimes(1);
  });

  it('confirms and retries a failed release before refreshing history', async () => {
    renderControlCenter({
      releaseData: [
        {
          ...releaseData[0],
          errorSummary: 'Desktop release build failed.',
          status: 'failed',
        },
      ],
      search: 'tab=build-profile',
    });

    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopBuild.history.retry' }));

    expect(confirmModalMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'admin.desktopBuild.history.retryConfirmTitle' }),
    );
    await waitFor(() => {
      expect(adminCommercialService.retryDesktopRelease).toHaveBeenCalledWith(
        '44444444-4444-4444-8444-444444444444',
      );
    });
    expect(releasesMutate).toHaveBeenCalledTimes(1);
  });

  it('refreshes release history when a retry has ambiguous delivery', async () => {
    vi.mocked(adminCommercialService.retryDesktopRelease).mockRejectedValueOnce(
      new Error('GitHub rerun delivery is unknown.'),
    );
    confirmModalMock.mockImplementationOnce(({ onOk }) => {
      void onOk?.().catch(() => undefined);
    });
    renderControlCenter({
      releaseData: [{ ...releaseData[0], status: 'failed' }],
      search: 'tab=build-profile',
    });

    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopBuild.history.retry' }));

    await waitFor(() => expect(releasesMutate).toHaveBeenCalledTimes(1));
  });

  it('disables every release mutation while one release action is pending', async () => {
    let resolveRetry: (value: unknown) => void = () => undefined;
    vi.mocked(adminCommercialService.retryDesktopRelease).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRetry = resolve;
      }) as any,
    );
    renderControlCenter({
      releaseData: [
        { ...releaseData[0], status: 'failed' },
        {
          ...releaseData[0],
          channel: 'stable',
          id: '55555555-5555-4555-8555-555555555555',
          publishedDownloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.2.0/ComHub.exe',
          publishedServerUrl: 'https://cdn.qingyouai.com/desktop',
          status: 'succeeded',
          version: '2.2.0',
        },
      ],
      search: 'tab=build-profile',
    });

    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopBuild.history.retry' }));

    await waitFor(() => expect(adminCommercialService.retryDesktopRelease).toHaveBeenCalled());
    expect(
      screen.getByRole('button', { name: 'admin.desktopBuild.history.activate' }),
    ).toBeDisabled();

    await act(async () => resolveRetry(releaseData[0]));
  });

  it('confirms and sets a completed historical release as current', async () => {
    renderControlCenter({
      releaseData: [
        {
          ...releaseData[0],
          channel: 'stable',
          publishedDownloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.2.0/ComHub.exe',
          publishedServerUrl: 'https://cdn.qingyouai.com/desktop',
          status: 'succeeded',
          version: '2.2.0',
        },
      ],
      search: 'tab=build-profile',
    });

    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopBuild.history.activate' }));

    expect(confirmModalMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'admin.desktopBuild.history.activateConfirmTitle' }),
    );
    await waitFor(() => {
      expect(adminCommercialService.activateDesktopRelease).toHaveBeenCalledWith(
        '44444444-4444-4444-8444-444444444444',
      );
    });
    expect(releasesMutate).toHaveBeenCalledTimes(1);
    expect(settingsMutate).toHaveBeenCalledTimes(1);
    expect(overviewMutate).toHaveBeenCalledTimes(1);
  });

  it('refreshes current settings even when the post-activation history refresh fails', async () => {
    releasesMutate.mockRejectedValueOnce(new Error('history refresh failed'));
    renderControlCenter({
      releaseData: [
        {
          ...releaseData[0],
          channel: 'stable',
          publishedDownloadUrl: 'https://cdn.qingyouai.com/desktop/stable/2.2.0/ComHub.exe',
          publishedServerUrl: 'https://cdn.qingyouai.com/desktop',
          status: 'succeeded',
          version: '2.2.0',
        },
      ],
      search: 'tab=build-profile',
    });

    fireEvent.click(screen.getByRole('button', { name: 'admin.desktopBuild.history.activate' }));

    await waitFor(() => {
      expect(adminCommercialService.activateDesktopRelease).toHaveBeenCalled();
      expect(settingsMutate).toHaveBeenCalledTimes(1);
      expect(overviewMutate).toHaveBeenCalledTimes(1);
    });
  });
});
