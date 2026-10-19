import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type MobilePublicConfigV1 } from '@/const/mobileConfig';

import MobileConfigPreview from './MobileConfigPreview';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      ({
        'admin.mobile.preview.apps': 'Apps',
        'admin.mobile.preview.builtinApps': 'Built-in apps',
        'admin.mobile.preview.design': 'Design',
        'admin.mobile.preview.discover': 'Discover',
        'admin.mobile.preview.moduleApps': 'Module apps',
        'admin.mobile.preview.recent': 'Recent',
        'admin.mobile.preview.recent.sample': 'Preview sample',
        'admin.mobile.preview.recent.sampleTitleOne': 'Project planning',
        'admin.mobile.preview.recent.sampleTitleTwo': 'Content outline',
        'admin.mobile.preview.recentTitle': 'Recent preview',
        'admin.mobile.previewMode': 'Preview mode',
        'admin.mobile.bottomNavigation': 'Bottom Navigation',
      })[key] ??
      options?.defaultValue ??
      key,
  }),
}));

const config = {
  applications: {
    builtins: [
      {
        enabled: true,
        icon: 'store',
        id: 'tasks',
        label: 'Tasks',
        order: 2,
        path: '/tasks',
      },
      {
        enabled: false,
        icon: 'store',
        id: 'community',
        label: 'Community',
        order: 1,
        path: '/community',
      },
      {
        enabled: true,
        icon: 'store',
        id: 'settings',
        label: 'Settings',
        order: 1,
        path: '/settings',
      },
      {
        enabled: false,
        icon: 'sparkles',
        id: 'membership',
        label: 'Membership',
        order: 3,
        path: '/settings/plans',
      },
      {
        enabled: false,
        icon: 'coins',
        id: 'credits',
        label: 'Credits',
        order: 4,
        path: '/settings/credits',
      },
      {
        enabled: false,
        icon: 'chart-no-axes-column-increasing',
        id: 'usage',
        label: 'Usage',
        order: 5,
        path: '/settings/usage',
      },
    ],
    featuredModuleAppIds: ['design-kit', 'copy-kit'],
  },
  brand: { displayName: 'ComHub App', logoUrl: '/brand/mobile.png' },
  design: {
    tools: [
      { enabled: true, icon: 'presentation', id: 'ppt', label: 'Slides', order: 2 },
      { enabled: false, icon: 'image', id: 'image', label: 'Images', order: 1 },
      { enabled: true, icon: 'file-text', id: 'document', label: 'Docs', order: 1 },
    ],
  },
  discover: {
    assistants: [
      {
        assistantId: 'agent-beta',
        model: 'claude-sonnet',
        order: 2,
        provider: 'anthropic',
      },
      {
        assistantId: 'agent-alpha',
        model: 'gpt-4.1',
        modelLabelOverride: 'Recommended',
        order: 1,
        provider: 'openai',
        titleOverride: 'Alpha Bot',
      },
    ],
    community: { enabled: true, title: 'Community' },
    title: 'Featured',
  },
  navigation: {
    items: [
      {
        icon: 'shapes',
        id: 'slot-4',
        label: 'Apps',
        order: 4,
        path: '/apps',
        visible: true,
      },
      {
        icon: 'message-square-more',
        id: 'slot-1',
        label: 'Recent',
        order: 1,
        path: '/',
        visible: true,
      },
      {
        icon: 'compass',
        id: 'slot-3',
        label: 'Discover',
        order: 3,
        path: '/discover',
        visible: true,
      },
      {
        icon: 'palette',
        id: 'slot-2',
        label: 'Design',
        order: 2,
        path: '/design',
        visible: true,
      },
    ],
  },
  version: 1,
} satisfies MobilePublicConfigV1;

const switchMode = (mode: 'recent' | 'design' | 'discover' | 'apps') => {
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(mode, 'i') }));
};

describe('MobileConfigPreview', () => {
  it('defaults to a clearly labelled recent preview with representative row geometry', () => {
    render(<MobileConfigPreview config={config} />);

    const preview = screen.getByTestId('mobile-config-preview');
    expect(preview).toHaveStyle({ maxWidth: '360px', minHeight: '560px' });
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('radio', { name: /recent/i })).toBeChecked();
    expect(screen.getAllByTestId('mobile-preview-recent-row')).toHaveLength(2);
    expect(preview).toHaveTextContent('Preview sample');
    expect(preview).not.toHaveTextContent(/live data/i);
  });

  it.each([
    ['recent', 'Preview sample'],
    ['design', 'Docs'],
    ['discover', 'Alpha Bot'],
    ['apps', 'Settings'],
  ] as const)(
    'keeps configured brand and ordered navigation visible in %s mode',
    (mode, content) => {
      render(<MobileConfigPreview config={config} />);

      switchMode(mode);

      const preview = screen.getByTestId('mobile-config-preview');
      const navigation = screen.getByRole('navigation', { name: 'Bottom Navigation' });
      expect(preview).toHaveTextContent('ComHub App');
      expect(screen.getByRole('img', { name: 'ComHub App' })).toHaveAttribute(
        'src',
        '/brand/mobile.png',
      );
      expect(navigation).toHaveTextContent('RecentDesignDiscoverApps');
      expect(preview).toHaveTextContent(content);
    },
  );

  it('replaces the prior mode body when the preview mode changes', () => {
    render(<MobileConfigPreview config={config} />);

    expect(screen.getAllByTestId('mobile-preview-recent-row')).toHaveLength(2);

    switchMode('design');

    expect(screen.getByTestId('mobile-preview-design-tools')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-preview-recent-row')).not.toBeInTheDocument();
  });

  it('renders only enabled design tools in configured order', () => {
    render(<MobileConfigPreview config={config} />);

    switchMode('design');

    const tools = within(screen.getByTestId('mobile-preview-design-tools')).getAllByTestId(
      'mobile-preview-grid-item',
    );
    expect(tools.map((tool) => tool.textContent)).toEqual(['Docs', 'Slides']);
    expect(tools).toHaveLength(2);
    for (const tool of tools) {
      expect(tool).toHaveAttribute('data-preview-cell-height', '88');
      expect(tool).toHaveAttribute('data-preview-label-lines', '1');
    }
    expect(document.querySelector('[data-preview-cell-kind="app"]')).toBeNull();
    expect(screen.queryByText('Images')).not.toBeInTheDocument();
  });

  it('renders discover title overrides and configured model labels in order', () => {
    render(<MobileConfigPreview config={config} />);

    switchMode('discover');

    const assistants = within(screen.getByTestId('mobile-preview-discover-list')).getAllByTestId(
      'mobile-preview-assistant-row',
    );
    expect(assistants).toHaveLength(2);
    expect(within(assistants[0]).getByText('Alpha Bot')).toBeInTheDocument();
    expect(within(assistants[0]).getByText('Recommended')).toBeInTheDocument();
    expect(within(assistants[1]).getByText('agent-beta')).toBeInTheDocument();
    expect(within(assistants[1]).getByText('推荐')).toBeInTheDocument();
    expect(screen.getByText('Featured')).toBeInTheDocument();
    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-preview-community')).toHaveTextContent(
      'Recommended assistants',
    );
  });

  it('renders separate built-in and module app sections in configured order', () => {
    render(<MobileConfigPreview config={config} />);

    switchMode('apps');

    const builtins = within(screen.getByTestId('mobile-preview-apps-builtins')).getAllByTestId(
      'mobile-preview-grid-item',
    );
    const modules = within(screen.getByTestId('mobile-preview-apps-modules')).getAllByTestId(
      'mobile-preview-grid-item',
    );
    expect(builtins.map((app) => app.textContent)).toEqual(['Settings', 'Tasks']);
    expect(modules.map((app) => app.textContent)).toEqual(['design-kit', 'copy-kit']);
    for (const app of [...builtins, ...modules]) {
      expect(app).toHaveAttribute('data-preview-cell-height', '104');
      expect(app).toHaveAttribute('data-preview-label-lines', '2');
    }
    expect(document.querySelector('[data-preview-cell-kind="design"]')).toBeNull();
    expect(screen.getByText('Built-in apps')).toBeInTheDocument();
    expect(screen.getByText('Module apps')).toBeInTheDocument();
    expect(screen.queryByText('Community')).not.toBeInTheDocument();
  });

  it('switches modes through visible Discover and Apps bottom-tab buttons', () => {
    render(<MobileConfigPreview config={config} />);

    const navigation = screen.getByRole('navigation', { name: 'Bottom Navigation' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Discover' }));
    expect(screen.getByRole('radio', { name: 'Discover' })).toBeChecked();
    expect(within(navigation).getByRole('button', { name: 'Discover' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    fireEvent.click(within(navigation).getByRole('button', { name: 'Apps' }));
    expect(screen.getByRole('radio', { name: 'Apps' })).toBeChecked();
    expect(within(navigation).getByRole('button', { name: 'Apps' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByTestId('mobile-preview-apps-builtins')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-preview-discover-list')).not.toBeInTheDocument();
  });

  it('keeps all four primary bottom tabs available after legacy hidden settings', () => {
    const hiddenDiscover = {
      ...config,
      navigation: {
        items: config.navigation.items.map((item) =>
          item.id === 'slot-3' ? { ...item, visible: false } : item,
        ),
      },
    } satisfies MobilePublicConfigV1;
    render(<MobileConfigPreview config={hiddenDiscover} />);

    const navigation = screen.getByRole('navigation', { name: 'Bottom Navigation' });
    expect(within(navigation).getByRole('button', { name: 'Recent' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    switchMode('design');
    expect(within(navigation).getByRole('button', { name: 'Design' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    switchMode('discover');
    expect(within(navigation).getByTestId('mobile-preview-nav-slot-3')).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: 'Discover' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(navigation.querySelector('[aria-current="page"]')).not.toBeNull();
    expect(screen.getByTestId('mobile-preview-discover-list')).toBeInTheDocument();
  });
});
