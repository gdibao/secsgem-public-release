import { ConfigProvider } from '@lobehub/ui';
import { render, screen } from '@testing-library/react';
import * as m from 'motion/react-m';
import { type ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import AppCard from './AppCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) => {
      if (key === 'moduleApps.market.openFor') return `Open ${values?.name ?? ''}`;
      if (key === 'moduleApps.market.viewDetailsFor') {
        return `View details for ${values?.name ?? ''}`;
      }

      return key;
    },
  }),
}));

const renderCard = (ui: ReactElement) =>
  render(
    <ConfigProvider motion={m}>
      <MemoryRouter>{ui}</MemoryRouter>
    </ConfigProvider>,
  );

describe('ModuleAppCard', () => {
  it('links to the app detail and shows installation state', () => {
    renderCard(
      <AppCard
        installed
        updateAvailable
        category="business"
        id="app-1"
        name="Recruiting Desk"
        publishedVersion="2.0.0"
        version="1.0.0"
        installationReadiness={{
          configuration: 'required',
          missingSecretCount: 2,
          runtime: 'ready',
        }}
      />,
    );

    const card = screen.getByRole('article', { name: 'Recruiting Desk' });
    expect(card).toHaveStyle({ borderRadius: '8px', minWidth: '0' });
    expect(screen.getByText('moduleApps.market.installed')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.market.updateAvailable')).toBeInTheDocument();
    expect(screen.getByText('moduleApps.readiness.configurationRequired')).toBeInTheDocument();
    expect(card).toHaveTextContent('moduleApps.market.version 1.0.0');
    expect(card).toHaveTextContent('moduleApps.market.latestVersion 2.0.0');
    expect(screen.getByRole('link', { name: 'Open Recruiting Desk' })).toHaveAttribute(
      'href',
      '/apps/app-1/app',
    );
    expect(screen.getByRole('link', { name: 'View details for Recruiting Desk' })).toHaveAttribute(
      'href',
      '/apps/app-1',
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('keeps details available but disables opening an unavailable runtime', () => {
    renderCard(
      <AppCard
        installed
        id="app-3"
        name="Runtime Desk"
        installationReadiness={{
          configuration: 'ready',
          missingSecretCount: 0,
          runtime: 'unavailable',
        }}
      />,
    );

    expect(screen.getByText('moduleApps.readiness.runtimeUnavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Runtime Desk' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Open Runtime Desk' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View details for Runtime Desk' })).toHaveAttribute(
      'href',
      '/apps/app-3',
    );
  });

  it('wraps metadata and preserves an encoded workspace detail URL', () => {
    renderCard(
      <AppCard
        category="creative tools"
        description="A long description that remains inside the card."
        id="app-2"
        name="Studio"
        version="2.4.0"
        workspaceId="workspace/team 1"
      />,
    );

    const card = screen.getByRole('article', { name: 'Studio' });
    expect(card).toHaveTextContent('creative tools');
    expect(card).toHaveTextContent('2.4.0');
    expect(card).toHaveTextContent('A long description that remains inside the card.');
    expect(screen.getByRole('link', { name: 'View details for Studio' })).toHaveAttribute(
      'href',
      '/apps/app-2?workspaceId=workspace%2Fteam%201',
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});
