import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowProgressView } from './WorkflowProgress';

describe('WorkflowProgressView', () => {
  it('shows persisted node progress and an explicit cancel action', () => {
    render(
      <WorkflowProgressView
        run={{ status: 'running' }}
        nodes={[
          { nodeKey: 'one', status: 'succeeded' },
          { nodeKey: 'two', status: 'skipped' },
          { nodeKey: 'three', status: 'running' },
          { nodeKey: 'four', status: 'pending' },
          { nodeKey: 'five', status: 'pending' },
        ]}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByText('2 / 5')).toBeVisible();
    expect(screen.getByRole('button')).toBeEnabled();
  });
});
