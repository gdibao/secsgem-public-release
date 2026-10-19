import { fireEvent, render, screen } from '@testing-library/react';
import { Search } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import {
  MobileContentFrame,
  MobileIconGrid,
  MobileListSkeleton,
  MobileSection,
  MobileStateView,
  MobileWorkspaceHeader,
} from './index';

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ 'aria-label': ariaLabel, onClick, size, title }: any) => (
    <button
      aria-label={ariaLabel ?? title}
      data-block-size={size?.blockSize}
      type="button"
      onClick={onClick}
    />
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, htmlType, icon, loading, size, type, ...rest }: any) => (
    <button
      {...rest}
      data-button-type={type}
      data-loading={loading ? 'true' : 'false'}
      data-size={size}
      type={htmlType}
    >
      {icon}
      {children}
    </button>
  ),
}));

vi.mock('@lobehub/ui/mobile', () => {
  const ChatHeader = (({ center, left, right }: any) => (
    <header>
      {left}
      {center}
      {right}
    </header>
  )) as any;

  ChatHeader.Title = ({ title }: any) => <div>{title}</div>;

  return { ChatHeader };
});

describe('mobile workspace shared components', () => {
  it('renders semantic section headings and owns a 44px trailing action', () => {
    const onManage = vi.fn();

    render(
      <MobileSection action={{ label: 'Manage', onClick: onManage }} title="Shortcuts">
        <div>Content</div>
      </MobileSection>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Shortcuts' })).toBeInTheDocument();
    const action = screen.getByRole('button', { name: 'Manage' });
    expect(action).toHaveStyle({ minHeight: '44px', minWidth: '44px' });
    fireEvent.click(action);
    expect(onManage).toHaveBeenCalledOnce();
  });

  it('uses 44px header actions and calls their handlers', () => {
    const onSearch = vi.fn();

    render(
      <MobileWorkspaceHeader
        actions={[{ icon: Search, label: 'Search', onClick: onSearch }]}
        title="Workspace"
      />,
    );

    const action = screen.getByRole('button', { name: 'Search' });
    expect(action).toHaveAttribute('data-block-size', '44');
    fireEvent.click(action);
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it('calls state actions and renders only one primary action', () => {
    const onClick = vi.fn();

    render(
      <MobileStateView
        action={{ label: 'Retry', onClick, primary: true }}
        actions={[{ label: 'Dismiss', onClick: vi.fn(), primary: true }]}
        description="Connection failed"
        title="Unable to load"
        variant="error"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { level: 2, name: 'Unable to load' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute(
      'data-button-type',
      'primary',
    );
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveAttribute(
      'data-button-type',
      'default',
    );
    expect(screen.getAllByTestId('mobile-state-primary-action')).toHaveLength(1);
    for (const stateAction of screen.getAllByRole('button')) {
      expect(stateAction).toHaveStyle({ minHeight: '44px', minWidth: '44px' });
    }
  });

  it('exposes responsive frame and grid contract attributes', () => {
    render(
      <MobileContentFrame>
        <MobileIconGrid minCellSize={112}>
          <div>One</div>
        </MobileIconGrid>
      </MobileContentFrame>,
    );

    expect(screen.getByTestId('mobile-content-frame')).toHaveAttribute(
      'data-mobile-content-max-width',
      '640',
    );
    expect(screen.getByTestId('mobile-icon-grid')).toHaveAttribute(
      'data-mobile-grid-min-cell',
      '112',
    );
  });

  it('keeps the default list skeleton geometry for existing callers', () => {
    render(<MobileListSkeleton label="Loading conversations" rows={3} />);

    const status = screen.getByRole('status', { name: 'Loading conversations' });
    expect(status).toHaveStyle({
      '--mobile-list-skeleton-avatar-size': '40px',
      '--mobile-list-skeleton-min-row-height': '64px',
      '--mobile-list-skeleton-trailing-width': '20px',
    });
    expect(screen.getAllByTestId('mobile-list-skeleton-row')).toHaveLength(3);
  });

  it('applies explicit list geometry and layout class to the status root', () => {
    render(
      <MobileListSkeleton
        avatarSize={44}
        className="responsive-assistant-list"
        label="Loading assistants"
        minRowHeight={76}
        trailingWidth={88}
      />,
    );

    expect(screen.getByRole('status', { name: 'Loading assistants' })).toHaveClass(
      'responsive-assistant-list',
    );
    expect(screen.getByRole('status', { name: 'Loading assistants' })).toHaveStyle({
      '--mobile-list-skeleton-avatar-size': '44px',
      '--mobile-list-skeleton-min-row-height': '76px',
      '--mobile-list-skeleton-trailing-width': '88px',
    });
  });
});
