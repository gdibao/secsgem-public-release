import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const rendered = vi.hoisted(() => ({ panel: vi.fn() }));

vi.mock('@/routes/(main)/agent/features/Portal/features/Portal', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/routes/(main)/agent/features/Portal/features/PortalPanel', () => ({
  default: (props: unknown) => {
    rendered.panel(props);
    return null;
  },
}));

import GroupPortal from './index';

describe('GroupPortal', () => {
  it('uses the mobile portal panel when mobile mode is requested', () => {
    render(<GroupPortal mobile />);

    expect(rendered.panel).toHaveBeenCalledWith({ mobile: true });
  });
});
