import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import RatingControl from './RatingControl';

const fixture = vi.hoisted(() => ({ upsert: vi.fn(), remove: vi.fn() }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({ useActiveWorkspaceId: () => null }));
vi.mock('@/store/user', () => ({ useUserStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'user-a' } }) }));
vi.mock('./useEngineeringWorkspace', () => ({ useEngineeringWorkspaceScope: () => ({ ready: true }) }));
vi.mock('@/libs/trpc/client', () => ({ lambdaClient: { engineeringTools: {
  getMyRating: { query: vi.fn() }, getRatingSummary: { query: vi.fn() },
  removeMyRating: { mutate: fixture.remove }, upsertMyRating: { mutate: fixture.upsert },
} } }));
vi.mock('swr', () => ({ default: (key: string[]) => ({
  data: key[0] === 'engineering-rating-mine' ? { score: null, version: 7 } : { average: null, count: 0 },
  error: undefined, isLoading: false, mutate: vi.fn(),
}) }));

describe('RatingControl', () => {
  it('re-rates from the tombstone version, not a stale first-write version', async () => {
    fixture.upsert.mockResolvedValue({ score: 4, version: 8 });
    render(<RatingControl toolId="PG001" />);
    expect(screen.queryByRole('button', { name: '撤销评分' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: '我的评分' }));
    await userEvent.click(screen.getByRole('option', { name: '4 星' }));
    await userEvent.click(screen.getByRole('button', { name: '提交评分' }));
    expect(fixture.upsert).toHaveBeenCalledWith({ expectedVersion: 7, score: 4, toolId: 'PG001' });
  });
});
