// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  getWorkspaceIdFromLocation,
  getWorkspaceSlugFromLocation,
  setWorkspaceSnapshot,
} from './workspaceRuntime';

describe('workspaceRuntime', () => {
  beforeEach(() => {
    setWorkspaceSnapshot([]);
    window.history.replaceState({}, '', '/');
  });

  it('derives only a known workspace from the current route', () => {
    setWorkspaceSnapshot([
      { id: 'workspace-1', name: 'Engineering', slug: 'engineering' } as never,
    ]);
    window.history.replaceState({}, '', '/engineering/agent/agent-1');

    expect(getWorkspaceSlugFromLocation()).toBe('engineering');
    expect(getWorkspaceIdFromLocation()).toBe('workspace-1');
  });

  it('does not treat a personal route as a workspace', () => {
    setWorkspaceSnapshot([
      { id: 'workspace-1', name: 'Engineering', slug: 'engineering' } as never,
    ]);
    window.history.replaceState({}, '', '/agent/agent-1');

    expect(getWorkspaceSlugFromLocation()).toBeNull();
    expect(getWorkspaceIdFromLocation()).toBeNull();
  });
});
