import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import MeProfilePage from './index';

vi.mock('@/features/Settings/features/SettingsContent', () => ({
  default: ({ activeTab, mobile }: { activeTab?: string; mobile?: boolean }) => (
    <div data-active-tab={activeTab} data-mobile={String(mobile)} data-testid="settings-content" />
  ),
}));

describe('MeProfilePage', () => {
  it('opens the profile content directly in mobile mode', () => {
    render(<MeProfilePage />);

    expect(screen.getByTestId('settings-content')).toHaveAttribute(
      'data-active-tab',
      SettingsTabs.Profile,
    );
    expect(screen.getByTestId('settings-content')).toHaveAttribute('data-mobile', 'true');
  });
});
