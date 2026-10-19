import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModuleAppProductsPage from './ModuleAppProductsPage';

const { roleState } = vi.hoisted(() => ({ roleState: { canWrite: true } }));

vi.mock('react-router', () => ({
  useOutletContext: () => ({ app: { id: 'app-1' }, refresh: async () => undefined }),
}));

vi.mock('../../ProductManager', () => ({
  default: ({ appId, canWrite }: { appId: string; canWrite: boolean }) =>
    `Products for ${appId} (${canWrite ? 'writable' : 'read-only'})`,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userProfile: () => ({ role: 'admin' }) },
}));
vi.mock('@lobechat/types', async (importOriginal) => ({
  ...(await importOriginal()),
  hasAdminCapability: () => roleState.canWrite,
}));

describe('ModuleAppProductsPage', () => {
  beforeEach(() => {
    roleState.canWrite = true;
  });

  it('always routes products through the outlet application id', () => {
    render(<ModuleAppProductsPage />);

    expect(screen.getByText('Products for app-1 (writable)')).toBeInTheDocument();
  });

  it('passes read-only product access without module app write', () => {
    roleState.canWrite = false;

    render(<ModuleAppProductsPage />);

    expect(screen.getByText('Products for app-1 (read-only)')).toBeInTheDocument();
  });
});
