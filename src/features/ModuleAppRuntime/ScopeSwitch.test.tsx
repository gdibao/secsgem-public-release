import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ScopeSwitch from './ScopeSwitch';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ScopeSwitch', () => {
  it('switches between personal and workspace scopes when a workspace is available', () => {
    const onChange = vi.fn();
    render(
      <ScopeSwitch
        scopeType="personal"
        workspaceId="workspace-1"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText('moduleApps.runtime.scope.workspace'));
    expect(onChange).toHaveBeenCalledWith('workspace');
  });

  it('keeps workspace scope unavailable without a workspace context', () => {
    render(<ScopeSwitch scopeType="personal" onChange={vi.fn()} />);

    expect(screen.getByText('moduleApps.runtime.scope.workspace').closest('label')).toHaveClass(
      'ant-segmented-item-disabled',
    );
  });
});
