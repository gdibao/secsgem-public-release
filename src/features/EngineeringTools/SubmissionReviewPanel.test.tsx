import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import SubmissionReviewPanel from './SubmissionReviewPanel';

const fixture = vi.hoisted(() => ({
  mutate: vi.fn(),
  review: vi.fn(),
  submitted: [{
    id: '00000000-0000-4000-8000-000000000001', version: 3, name: 'Submitted Tool',
    category: 'CAD', description: 'Description', summary: 'Summary', license: 'License',
    section: 'design', shape: 'web', visibility: 'public', pricingType: 'free',
    officialWebsiteUrl: 'https://example.com', productUrl: 'https://example.com/product',
    runUrl: null, downloadUrl: null, purchaseUrl: null,
  }],
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({ useActiveWorkspaceId: () => null }));
vi.mock('@/store/user', () => ({ useUserStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'user-a' } }) }));
vi.mock('./useEngineeringWorkspace', () => ({ useEngineeringWorkspaceScope: () => ({ ready: true }) }));
vi.mock('@/libs/trpc/client', () => ({ lambdaClient: { engineeringTools: {
  adminListPending: { query: vi.fn() }, adminReview: { mutate: fixture.review },
} } }));
vi.mock('swr', () => ({ default: () => ({ data: fixture.submitted, error: undefined, isLoading: false, mutate: fixture.mutate }) }));

describe('SubmissionReviewPanel', () => {
  it('requires each published URL to be verified and sends evidence with the review', async () => {
    fixture.review.mockResolvedValue({ status: 'published' });
    fixture.mutate.mockResolvedValue([]);
    render(<SubmissionReviewPanel />);
    const publish = screen.getByRole('button', { name: '审核通过并发布' });
    await userEvent.type(screen.getByLabelText('Submitted Tool 审核原因'), '来源核实');
    await userEvent.type(screen.getByLabelText('Submitted Tool 发布来源证据链接'), 'https://example.com/evidence');
    expect(publish).toBeDisabled();
    const confirmations = screen.getAllByRole('checkbox');
    expect(confirmations).toHaveLength(2);
    await userEvent.click(confirmations[0]);
    expect(publish).toBeDisabled();
    await userEvent.click(confirmations[1]);
    expect(publish).toBeEnabled();
    await userEvent.click(publish);
    await waitFor(() => expect(fixture.review).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'publish', expectedVersion: 3, id: fixture.submitted[0].id,
      evidence: expect.objectContaining({
        reference: 'https://example.com/evidence',
        verifiedUrls: ['https://example.com', 'https://example.com/product'],
      }),
      reason: '来源核实',
    })));
  });
});
