import { render } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import SettingsContent from './SettingsContent';

const { businessPageSpy } = vi.hoisted(() => ({ businessPageSpy: vi.fn() }));

vi.mock('@/features/NavHeader', () => ({ default: () => null }));
vi.mock('@/features/Setting/SettingContainer', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: { enableBusinessFeatures: vi.fn() },
  useServerConfigStore: () => false,
}));
vi.mock('./componentMap', () => {
  const businessPage = (tab: string) => (props: { mobile?: boolean }) => {
    businessPageSpy(tab, props);
    return createElement('div', { 'data-testid': `${tab}-page` });
  };

  return {
    componentMap: {
      appearance: () => null,
      billing: businessPage('billing'),
      credits: businessPage('credits'),
      plans: businessPage('plans'),
      referral: businessPage('referral'),
      usage: businessPage('usage'),
    },
  };
});

const businessTabs = [
  SettingsTabs.Plans,
  SettingsTabs.Credits,
  SettingsTabs.Billing,
  SettingsTabs.Referral,
  SettingsTabs.Usage,
];

describe('SettingsContent mobile presentation', () => {
  beforeEach(() => {
    businessPageSpy.mockClear();
  });

  it.each(businessTabs)('forwards mobile presentation to directly opened %s', (tab) => {
    render(<SettingsContent activeTab={tab} mobile />);

    expect(businessPageSpy).toHaveBeenCalledWith(tab, { mobile: true });
  });
});
