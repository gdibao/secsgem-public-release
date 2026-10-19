import { ConfigProvider } from '@lobehub/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as m from 'motion/react-m';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_MOBILE_CONFIG, type MobilePublicConfigV1 } from '@/const/mobileConfig';
import type { MobileConfigPublicationState } from '@/const/mobileConfigPublication';
import { refreshMobileConfig } from '@/features/MobileWorkspace/useMobileConfig';
import { adminCommercialService } from '@/services/adminCommercial';
import { discoverService } from '@/services/discover';

import AdminMobileSettingsPage, { createMobileSettingsAsyncGuard } from './AdminMobileSettingsPage';

const routeBlocker = vi.hoisted(() => ({
  proceed: vi.fn(),
  reset: vi.fn(),
  state: 'unblocked' as 'blocked' | 'unblocked',
}));
const confirmModalMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  confirmModal: confirmModalMock,
}));

vi.mock('react-router', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useBlocker: () => routeBlocker,
}));

vi.mock('@/features/MobileWorkspace/useMobileConfig', () => ({
  refreshMobileConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown> | string) => {
    const values = typeof options === 'object' && options ? options : {};
    const template = typeof options === 'string' ? options : String(values.defaultValue ?? key);

    return template.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ''));
  };

  return { useTranslation: () => ({ t }) };
});

vi.mock('@/services/adminCommercial', () => ({
  adminCommercialService: {
    getAiProviderModelCatalogDiagnostics: vi.fn(),
    getMobileSettingsPublication: vi.fn(),
    moduleApps: {
      list: vi.fn(),
    },
    publishMobileSettings: vi.fn(),
    rollbackMobileSettings: vi.fn(),
    saveMobileSettingsDraft: vi.fn(),
  },
}));

vi.mock('@/services/discover', () => ({
  discoverService: {
    getAssistantList: vi.fn(),
  },
}));

const mobileConfig = (patch: Partial<MobilePublicConfigV1> = {}): MobilePublicConfigV1 => ({
  ...DEFAULT_MOBILE_CONFIG,
  ...patch,
  applications: {
    ...DEFAULT_MOBILE_CONFIG.applications,
    ...patch.applications,
  },
  brand: {
    ...DEFAULT_MOBILE_CONFIG.brand,
    ...patch.brand,
  },
  design: {
    ...DEFAULT_MOBILE_CONFIG.design,
    ...patch.design,
  },
  discover: {
    ...DEFAULT_MOBILE_CONFIG.discover,
    ...patch.discover,
  },
  navigation: {
    ...DEFAULT_MOBILE_CONFIG.navigation,
    ...patch.navigation,
  },
});

const publication = (
  config: MobilePublicConfigV1 = mobileConfig(),
  patch: Partial<MobileConfigPublicationState> = {},
): MobileConfigPublicationState => ({
  draft: { config, revision: 0, updatedAt: '2026-07-20T00:00:00.000Z' },
  history: [{ config, revision: 0, updatedAt: '2026-07-20T00:00:00.000Z' }],
  published: { config, revision: 0, updatedAt: '2026-07-20T00:00:00.000Z' },
  ...patch,
});

const setupLoaders = (config: MobilePublicConfigV1 = mobileConfig()) => {
  vi.mocked(adminCommercialService.getMobileSettingsPublication).mockResolvedValue(
    publication(config),
  );
  vi.mocked(adminCommercialService.getAiProviderModelCatalogDiagnostics).mockResolvedValue({
    catalog: [
      {
        model: {
          displayName: 'GPT 4.1',
          id: 'gpt-4.1',
          providerId: 'openai',
          type: 'chat',
        },
        visible: true,
      },
    ],
  } as any);
  vi.mocked(adminCommercialService.moduleApps.list).mockResolvedValue({
    items: [
      {
        appId: 'design-kit',
        displayName: 'Design Kit',
        name: 'Design Kit',
        status: 'published',
      },
    ],
  } as any);
  vi.mocked(discoverService.getAssistantList).mockResolvedValue({
    currentPage: 1,
    items: [
      {
        author: 'ComHub',
        createdAt: '2026-01-01',
        description: 'Planning assistant',
        homepage: '',
        identifier: 'agent-alpha',
        knowledgeCount: 0,
        pluginCount: 0,
        status: 'published',
        title: 'Alpha Assistant',
        tokenUsage: 0,
      },
    ],
    pageSize: 20,
    totalCount: 1,
    totalPages: 1,
  } as any);
};

const renderPage = (ui: ReactElement = <AdminMobileSettingsPage />) =>
  render(<ConfigProvider motion={m}>{ui}</ConfigProvider>);

const createDeferred = <T,>() => {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
};

describe('createMobileSettingsAsyncGuard', () => {
  it('guards duplicate saves, raw draft revisions, and unmounted completions', () => {
    const guard = createMobileSettingsAsyncGuard();
    guard.mount();

    const submittedRevision = guard.beginSave();
    expect(submittedRevision).toBe(0);
    expect(guard.beginSave()).toBeUndefined();
    expect(guard.isCurrent(submittedRevision!)).toBe(true);

    guard.markDraftChanged();
    expect(guard.isCurrent(submittedRevision!)).toBe(false);

    guard.unmount();
    expect(guard.isMounted()).toBe(false);
    expect(guard.isCurrent(submittedRevision!)).toBe(false);

    guard.finishSave();
    expect(guard.beginSave()).toBeUndefined();
  });
});

describe('AdminMobileSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupLoaders();
    vi.mocked(adminCommercialService.saveMobileSettingsDraft).mockImplementation(async (config) =>
      publication(mobileConfig(), {
        draft: {
          config: config as MobilePublicConfigV1,
          revision: 1,
          updatedAt: '2026-07-20T00:30:00.000Z',
        },
      }),
    );
    vi.mocked(adminCommercialService.publishMobileSettings).mockImplementation(async () =>
      publication(mobileConfig(), {
        published: {
          config: mobileConfig(),
          revision: 1,
          updatedAt: '2026-07-20T01:00:00.000Z',
        },
      }),
    );
    confirmModalMock.mockImplementation(({ onOk }) => onOk?.());
    routeBlocker.state = 'unblocked';
  });

  it('loads mobile settings, normalizes values, and renders the live preview', async () => {
    setupLoaders(
      mobileConfig({
        brand: { displayName: 'ComHub App', logoUrl: '/brand/mobile.png' },
        navigation: {
          items: [
            {
              icon: 'not-allowed',
              id: 'slot-1',
              label: 'Chat',
              order: 1,
              path: 'https://external.example.com',
              visible: true,
            },
          ] as any,
        },
      }),
    );

    renderPage();

    expect(await screen.findByDisplayValue('ComHub App')).toBeInTheDocument();
    expect(screen.getByLabelText('Tab slot-1 path')).toHaveValue('/');
    expect(screen.getByTestId('mobile-config-preview')).toHaveTextContent('ComHub App');
    expect(
      within(screen.getByTestId('mobile-config-preview')).getByRole('navigation', {
        name: 'Bottom Navigation',
      }),
    ).toHaveTextContent('Chat设计发现应用');
    expect(screen.getAllByRole('region')).toHaveLength(8);
    expect(adminCommercialService.getMobileSettingsPublication).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: 'Publication history' })).toHaveTextContent(
      'Published revision 0',
    );
  });

  it('tracks dirty state, edits bottom navigation fields, validates icon/path choices, and reorders tabs', async () => {
    renderPage();

    await screen.findByLabelText('Brand display name');
    const saveButton = screen.getByRole('button', { name: 'Save draft' });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Tab slot-1 label'), { target: { value: 'Chats' } });
    fireEvent.change(screen.getByLabelText('Tab slot-1 path'), { target: { value: '/chat' } });
    fireEvent.change(screen.getByLabelText('Tab slot-1 icon'), {
      target: { value: 'message-square-more' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move slot-1 down' }));

    expect(saveButton).toBeEnabled();
    const bottomNav = screen.getByRole('region', { name: 'Bottom Navigation' });
    expect(within(bottomNav).getAllByLabelText(/Tab slot-/)[0]).toHaveAccessibleName(
      'Tab slot-2 label',
    );

    fireEvent.change(screen.getByLabelText('Tab slot-1 path'), {
      target: { value: 'https://evil.example.com' },
    });
    expect(
      await screen.findByText('Visible tab paths must be internal and unique.'),
    ).toBeInTheDocument();
    expect(saveButton).toBeDisabled();
  });

  it('keeps all four primary bottom tabs editable without visibility toggles', async () => {
    renderPage();

    expect(await screen.findByLabelText('Tab slot-1 label')).toBeInTheDocument();
    expect(screen.getByLabelText('Tab slot-2 label')).toBeInTheDocument();
    expect(screen.getByLabelText('Tab slot-3 label')).toBeInTheDocument();
    expect(screen.getByLabelText('Tab slot-4 label')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tab slot-1 visible')).not.toBeInTheDocument();
  });

  it('loads selector choices only when an administrator requests them', async () => {
    renderPage();

    await screen.findByLabelText('Brand display name');

    expect(discoverService.getAssistantList).not.toHaveBeenCalled();
    expect(adminCommercialService.getAiProviderModelCatalogDiagnostics).not.toHaveBeenCalled();
    expect(adminCommercialService.moduleApps.list).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Load assistant options' }));
    await screen.findByRole('option', { name: 'Alpha Assistant' });
    fireEvent.click(screen.getByRole('button', { name: 'Load model options' }));
    await screen.findByRole('option', { name: 'GPT 4.1' });
    fireEvent.click(screen.getByRole('button', { name: 'Load module app options' }));
    await screen.findByRole('option', { name: 'Design Kit' });

    expect(discoverService.getAssistantList).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 100, source: 'new' }),
    );
    expect(adminCommercialService.getAiProviderModelCatalogDiagnostics).toHaveBeenCalledTimes(1);
    expect(adminCommercialService.moduleApps.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200, status: 'published' }),
    );

    fireEvent.change(screen.getByLabelText('Featured assistant'), {
      target: { value: 'agent-alpha' },
    });
    fireEvent.change(screen.getByLabelText('Display model'), {
      target: { value: 'openai/gpt-4.1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add featured assistant' }));
    fireEvent.change(screen.getByLabelText('Featured module app'), {
      target: { value: 'design-kit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add module app' }));

    expect(
      screen.getByRole('button', { name: 'Remove assistant agent-alpha' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove module app design-kit' }),
    ).toBeInTheDocument();
  }, 30_000);

  it('reorders and removes configurable tools, assistants, and app entries', async () => {
    setupLoaders(
      mobileConfig({
        applications: {
          builtins: [
            {
              enabled: true,
              icon: 'shapes',
              id: 'tasks',
              label: 'Tasks',
              order: 1,
              path: '/tasks',
            },
            {
              enabled: true,
              icon: 'compass',
              id: 'community',
              label: 'Community',
              order: 2,
              path: '/community',
            },
          ],
          featuredModuleAppIds: ['app-one', 'app-two'],
        },
        discover: {
          assistants: [
            {
              assistantId: 'agent-one',
              model: 'gpt-4.1',
              order: 1,
              provider: 'openai',
              titleOverride: 'Agent One',
            },
            {
              assistantId: 'agent-two',
              model: 'gpt-4.1',
              order: 2,
              provider: 'openai',
              titleOverride: 'Agent Two',
            },
          ],
          community: { enabled: true, title: 'Community' },
          title: 'Recommended assistants',
        },
      }),
    );
    renderPage();

    await screen.findByLabelText('Brand display name');
    fireEvent.click(screen.getByRole('button', { name: 'Move tool document down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move assistant agent-two up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove assistant agent-one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move module app app-two up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove module app app-one' }));
    const builtinLabelsBefore = screen
      .getAllByLabelText(/Builtin .* label/)
      .map((element) => (element as HTMLInputElement).value);
    const communityIndexBefore = builtinLabelsBefore.indexOf('Community');
    fireEvent.click(screen.getByRole('button', { name: 'Move builtin community up' }));

    expect(
      within(screen.getByRole('region', { name: 'Design Tools' })).getAllByLabelText(
        /Tool .* label/,
      )[0],
    ).toHaveAccessibleName('Tool image label');
    expect(screen.queryByText('Agent One')).not.toBeInTheDocument();
    expect(screen.queryByText('app-one')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move assistant agent-two up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move module app app-two up' })).toBeDisabled();
    await waitFor(() => {
      const builtinLabelsAfter = screen
        .getAllByLabelText(/Builtin .* label/)
        .map((element) => (element as HTMLInputElement).value);
      expect(builtinLabelsAfter.indexOf('Community')).toBe(communityIndexBefore - 1);
    });
  }, 15_000);

  it('does not allow more than four featured assistants', async () => {
    setupLoaders(
      mobileConfig({
        discover: {
          assistants: Array.from({ length: 4 }, (_, index) => ({
            assistantId: `configured-agent-${index + 1}`,
            model: 'gpt-4.1',
            order: index + 1,
            provider: 'openai',
          })),
          community: { enabled: true, title: 'Community' },
          title: 'Recommended assistants',
        },
      }),
    );
    renderPage();

    await screen.findByLabelText('Brand display name');
    fireEvent.click(screen.getByRole('button', { name: 'Load assistant options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load model options' }));
    await screen.findByRole('option', { name: 'Alpha Assistant' });
    fireEvent.change(screen.getByLabelText('Featured assistant'), {
      target: { value: 'agent-alpha' },
    });
    fireEvent.change(screen.getByLabelText('Display model'), {
      target: { value: 'openai/gpt-4.1' },
    });

    expect(screen.getByRole('button', { name: 'Add featured assistant' })).toBeDisabled();
  }, 15_000);

  it('restores normalized defaults after confirmation', async () => {
    renderPage();

    await screen.findByLabelText('Brand display name');
    fireEvent.change(screen.getByLabelText('Brand display name'), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));

    expect(confirmModalMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Restore mobile defaults?' }),
    );
    await waitFor(() => expect(screen.getByLabelText('Brand display name')).toHaveValue(''));
    expect(
      within(screen.getByTestId('mobile-config-preview')).getByRole('navigation', {
        name: 'Bottom Navigation',
      }),
    ).toHaveTextContent('最近设计发现应用');
  });

  it('saves the normalized draft once without refreshing the public configuration', async () => {
    renderPage();

    await screen.findByLabelText('Brand display name');
    fireEvent.change(screen.getByLabelText('Brand display name'), {
      target: { value: 'ComHub App' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => {
      expect(adminCommercialService.saveMobileSettingsDraft).toHaveBeenCalledTimes(1);
      expect(adminCommercialService.saveMobileSettingsDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          brand: expect.objectContaining({ displayName: 'ComHub App' }),
          version: 1,
        }),
        0,
      );
    });
    expect(await screen.findByText('Mobile draft saved.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
    expect(refreshMobileConfig).not.toHaveBeenCalled();

    vi.mocked(adminCommercialService.saveMobileSettingsDraft).mockRejectedValueOnce(
      new Error('nope'),
    );
    fireEvent.change(screen.getByLabelText('Brand display name'), {
      target: { value: 'ComHub Two' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Save draft/ }));

    expect(await screen.findByText('Failed to save mobile settings.')).toBeInTheDocument();
    expect(refreshMobileConfig).not.toHaveBeenCalled();
  });

  it('publishes the saved draft from the current revision and refreshes public mobile config', async () => {
    const draftConfig = mobileConfig({ brand: { displayName: 'ComHub App', logoUrl: null } });
    vi.mocked(adminCommercialService.publishMobileSettings).mockResolvedValue(
      publication(draftConfig, {
        draft: {
          config: draftConfig,
          revision: 2,
          updatedAt: '2026-07-20T01:00:00.000Z',
        },
        history: [
          { config: draftConfig, revision: 1, updatedAt: '2026-07-20T01:00:00.000Z' },
          { config: mobileConfig(), revision: 0, updatedAt: '2026-07-20T00:00:00.000Z' },
        ],
        published: {
          config: draftConfig,
          revision: 1,
          updatedAt: '2026-07-20T01:00:00.000Z',
        },
      }),
    );
    renderPage();

    fireEvent.change(await screen.findByLabelText('Brand display name'), {
      target: { value: 'ComHub App' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Mobile draft saved.');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() =>
      expect(adminCommercialService.publishMobileSettings).toHaveBeenCalledWith({
        expectedDraftRevision: 1,
        expectedRevision: 0,
      }),
    );
    expect(await screen.findByText('Mobile settings published.')).toBeInTheDocument();
    expect(refreshMobileConfig).toHaveBeenCalledTimes(1);
  });

  it('preserves the saved draft when publishing detects a revision conflict', async () => {
    const conflictDraft = mobileConfig({
      brand: { displayName: 'Draft', logoUrl: null },
    });
    vi.mocked(adminCommercialService.getMobileSettingsPublication).mockResolvedValue(
      publication(mobileConfig(), {
        draft: {
          config: conflictDraft,
          revision: 1,
          updatedAt: '2026-07-20T00:30:00.000Z',
        },
      }),
    );
    vi.mocked(adminCommercialService.publishMobileSettings).mockRejectedValue({
      data: { code: 'CONFLICT' },
    });
    renderPage();

    expect(await screen.findByDisplayValue('Draft')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(
      await screen.findByText(
        'A newer mobile revision was published. Your draft was preserved; reload before publishing.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Brand display name')).toHaveValue('Draft');
    expect(refreshMobileConfig).not.toHaveBeenCalled();
  });

  it('rolls a historical snapshot forward using the current published revision', async () => {
    const historicalConfig = mobileConfig({ brand: { displayName: 'Historical', logoUrl: null } });
    const currentConfig = mobileConfig({ brand: { displayName: 'Current', logoUrl: null } });
    vi.mocked(adminCommercialService.getMobileSettingsPublication).mockResolvedValue(
      publication(currentConfig, {
        draft: {
          config: currentConfig,
          revision: 2,
          updatedAt: '2026-07-20T02:00:00.000Z',
        },
        history: [
          { config: currentConfig, revision: 2, updatedAt: '2026-07-20T02:00:00.000Z' },
          { config: historicalConfig, revision: 1, updatedAt: '2026-07-20T01:00:00.000Z' },
        ],
        published: {
          config: currentConfig,
          revision: 2,
          updatedAt: '2026-07-20T02:00:00.000Z',
        },
      }),
    );
    vi.mocked(adminCommercialService.rollbackMobileSettings).mockResolvedValue(
      publication(historicalConfig, {
        draft: {
          config: historicalConfig,
          revision: 3,
          updatedAt: '2026-07-20T03:00:00.000Z',
        },
        history: [{ config: historicalConfig, revision: 3, updatedAt: '2026-07-20T03:00:00.000Z' }],
        published: {
          config: historicalConfig,
          revision: 3,
          updatedAt: '2026-07-20T03:00:00.000Z',
        },
      }),
    );
    renderPage();

    await screen.findByDisplayValue('Current');
    fireEvent.click(screen.getByRole('button', { name: 'Roll back' }));

    await waitFor(() =>
      expect(adminCommercialService.rollbackMobileSettings).toHaveBeenCalledWith({
        expectedDraftRevision: 2,
        expectedRevision: 2,
        targetRevision: 1,
      }),
    );
    expect(await screen.findByText('Mobile settings rolled back.')).toBeInTheDocument();
    expect(screen.getByLabelText('Brand display name')).toHaveValue('Historical');
    expect(refreshMobileConfig).toHaveBeenCalledTimes(1);
  });

  it('protects dirty settings from browser unload and in-app navigation', async () => {
    renderPage();

    fireEvent.change(await screen.findByLabelText('Brand display name'), {
      target: { value: 'Unsaved' },
    });

    const unloadEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unloadEvent);
    expect(unloadEvent.defaultPrevented).toBe(true);

    routeBlocker.state = 'blocked';
    fireEvent.change(screen.getByLabelText('Brand display name'), {
      target: { value: 'Still unsaved' },
    });

    await waitFor(() => expect(routeBlocker.proceed).toHaveBeenCalled());
    expect(confirmModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'You have unsaved mobile settings. Leave this page?',
      }),
    );
  });

  it('uses a synchronous in-flight guard for rapid duplicate saves', async () => {
    const saveDeferred = createDeferred<MobileConfigPublicationState>();
    vi.mocked(adminCommercialService.saveMobileSettingsDraft).mockReturnValue(saveDeferred.promise);
    renderPage();

    await screen.findByLabelText('Brand display name');
    fireEvent.change(screen.getByLabelText('Brand display name'), {
      target: { value: 'ComHub App' },
    });
    const saveButton = screen.getByRole('button', { name: 'Save draft' });

    act(() => {
      saveButton.click();
      saveButton.click();
    });

    expect(adminCommercialService.saveMobileSettingsDraft).toHaveBeenCalledTimes(1);
    saveDeferred.resolve(
      publication(mobileConfig(), {
        draft: {
          config: mobileConfig({ brand: { displayName: 'ComHub App', logoUrl: null } }),
          revision: 1,
          updatedAt: '2026-07-20T00:30:00.000Z',
        },
      }),
    );
    expect(await screen.findByText('Mobile draft saved.')).toBeInTheDocument();
  });

  it('uses a synchronous in-flight guard for rapid duplicate publishes', async () => {
    const draftConfig = mobileConfig({ brand: { displayName: 'Draft', logoUrl: null } });
    vi.mocked(adminCommercialService.getMobileSettingsPublication).mockResolvedValue(
      publication(mobileConfig(), {
        draft: {
          config: draftConfig,
          revision: 1,
          updatedAt: '2026-07-20T00:30:00.000Z',
        },
      }),
    );
    const publishDeferred = createDeferred<MobileConfigPublicationState>();
    vi.mocked(adminCommercialService.publishMobileSettings).mockReturnValue(
      publishDeferred.promise,
    );
    renderPage();

    const publishButton = await screen.findByRole('button', { name: 'Publish' });
    await waitFor(() => expect(publishButton).toBeEnabled());
    act(() => {
      publishButton.click();
      publishButton.click();
    });

    expect(adminCommercialService.publishMobileSettings).toHaveBeenCalledTimes(1);
    publishDeferred.resolve(
      publication(draftConfig, {
        published: {
          config: draftConfig,
          revision: 1,
          updatedAt: '2026-07-20T01:00:00.000Z',
        },
      }),
    );
    expect(await screen.findByText('Mobile settings published.')).toBeInTheDocument();
  });

  it('keeps a normalization-equivalent raw draft edit when an older save resolves', async () => {
    const saveDeferred = createDeferred<MobileConfigPublicationState>();
    vi.mocked(adminCommercialService.saveMobileSettingsDraft).mockReturnValue(saveDeferred.promise);
    renderPage();

    await screen.findByLabelText('Brand display name');
    fireEvent.change(screen.getByLabelText('Brand display name'), {
      target: { value: 'Submitted' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    fireEvent.change(screen.getByLabelText('Tab slot-1 path'), {
      target: { value: 'javascript:alert(1)' },
    });

    await act(async () => {
      saveDeferred.resolve(
        publication(mobileConfig(), {
          draft: {
            config: mobileConfig({ brand: { displayName: 'Submitted', logoUrl: null } }),
            revision: 1,
            updatedAt: '2026-07-20T00:30:00.000Z',
          },
        }),
      );
      await saveDeferred.promise;
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Save draft/ })).not.toHaveAttribute(
        'data-loading',
        'true',
      ),
    );
    expect(screen.getByLabelText('Tab slot-1 path')).toHaveValue('javascript:alert(1)');
    expect(screen.queryByText('Mobile draft saved.')).not.toBeInTheDocument();
  });

  it('blocks saves when an existing built-in app has an unsafe path', async () => {
    setupLoaders(
      mobileConfig({
        applications: {
          builtins: [
            {
              enabled: true,
              icon: 'store',
              id: 'tasks',
              label: 'Tasks',
              order: 1,
              path: '/tasks',
            },
          ],
          featuredModuleAppIds: [],
        },
      }),
    );
    renderPage();

    fireEvent.change(await screen.findByLabelText('Builtin tasks path'), {
      target: { value: 'javascript:alert(1)' },
    });

    expect(screen.getByText('Built-in app paths must be internal.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(adminCommercialService.saveMobileSettingsDraft).not.toHaveBeenCalled();
  });

  it('loads assistant and module app choices beyond the first page', async () => {
    vi.mocked(discoverService.getAssistantList).mockImplementation(
      async ({ page } = {}) =>
        ({
          currentPage: page ?? 1,
          items:
            page === 2
              ? [
                  {
                    identifier: 'agent-page-2',
                    status: 'published',
                    title: 'Paged Assistant',
                  },
                ]
              : [],
          pageSize: 100,
          totalCount: 1,
          totalPages: 2,
        }) as any,
    );
    vi.mocked(adminCommercialService.moduleApps.list).mockImplementation(
      async ({ cursor } = {}) =>
        (cursor
          ? {
              items: [{ appId: 'paged-app', displayName: 'Paged App', status: 'published' }],
              nextCursor: null,
            }
          : { items: [], nextCursor: 'page-2' }) as any,
    );

    renderPage();

    await screen.findByLabelText('Brand display name');
    fireEvent.click(screen.getByRole('button', { name: 'Load assistant options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load module app options' }));
    expect(await screen.findByRole('option', { name: 'Paged Assistant' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Paged App' })).toBeInTheDocument();
    expect(discoverService.getAssistantList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 100 }),
    );
    expect(adminCommercialService.moduleApps.list).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'page-2', limit: 200, status: 'published' }),
    );
  }, 15_000);

  it('does not write state after unmounting with pending load or save requests', async () => {
    const loadDeferred = createDeferred<MobileConfigPublicationState>();
    vi.mocked(adminCommercialService.getMobileSettingsPublication).mockReturnValueOnce(
      loadDeferred.promise,
    );
    const loadConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const loadingRender = renderPage();
    loadingRender.unmount();
    loadDeferred.resolve(
      publication(mobileConfig({ brand: { displayName: 'Unmounted', logoUrl: null } })),
    );
    await Promise.resolve();

    expect(loadConsoleError).not.toHaveBeenCalled();
    loadConsoleError.mockRestore();

    setupLoaders();
    const saveDeferred = createDeferred<MobileConfigPublicationState>();
    vi.mocked(adminCommercialService.saveMobileSettingsDraft).mockReturnValue(saveDeferred.promise);
    const saveConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const savingRender = renderPage();

    await screen.findByLabelText('Brand display name');
    fireEvent.change(screen.getByLabelText('Brand display name'), {
      target: { value: 'Unmount Save' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    savingRender.unmount();
    saveDeferred.resolve(
      publication(mobileConfig(), {
        draft: {
          config: mobileConfig({ brand: { displayName: 'Unmount Save', logoUrl: null } }),
          revision: 1,
          updatedAt: '2026-07-20T00:30:00.000Z',
        },
      }),
    );
    await Promise.resolve();

    expect(saveConsoleError).not.toHaveBeenCalled();
    saveConsoleError.mockRestore();
  });

  it('keeps the core editor editable when one selector fails and retries that selector inline', async () => {
    vi.mocked(discoverService.getAssistantList)
      .mockRejectedValueOnce(new Error('assistant unavailable'))
      .mockResolvedValueOnce({
        currentPage: 1,
        items: [
          {
            author: 'ComHub',
            createdAt: '2026-01-01',
            description: 'Planning assistant',
            homepage: '',
            identifier: 'agent-beta',
            knowledgeCount: 0,
            pluginCount: 0,
            status: 'published',
            title: 'Beta Assistant',
            tokenUsage: 0,
          },
        ],
        pageSize: 20,
        totalCount: 1,
        totalPages: 1,
      } as any);

    renderPage();

    expect(await screen.findByLabelText('Brand display name')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Brand display name'), {
      target: { value: 'Core Edit' },
    });
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Load assistant options' }));
    expect(await screen.findByText('Assistant selector unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add featured assistant' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry assistant selector' }));

    expect(await screen.findByRole('option', { name: 'Beta Assistant' })).toBeInTheDocument();
    expect(screen.queryByText('Assistant selector unavailable.')).not.toBeInTheDocument();
  }, 15_000);

  it('uses a skeleton loading state instead of antd Spin', () => {
    vi.mocked(adminCommercialService.getMobileSettingsPublication).mockReturnValue(
      createDeferred<MobileConfigPublicationState>().promise,
    );

    const { container } = renderPage();

    expect(screen.getByTestId('mobile-settings-loading')).toBeInTheDocument();
    expect(container.querySelector('.ant-spin')).not.toBeInTheDocument();
  });
});
