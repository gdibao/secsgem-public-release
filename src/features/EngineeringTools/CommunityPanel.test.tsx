import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import CommunityPanel from './CommunityPanel';

const fixture = vi.hoisted(() => ({
  mutate: vi.fn(),
  startRevision: vi.fn(),
  submitted: [{ id: '00000000-0000-4000-8000-000000000001', version: 3, status: 'published', name: 'Published Tool',
    category: 'CAD', description: 'Tool description', summary: 'Summary', license: 'License', section: 'design',
    shape: 'windows', visibility: 'public', vendorName: 'Vendor', officialWebsiteUrl: 'https://example.com',
    productUrl: 'https://example.com/product', runUrl: null, downloadUrl: null, purchaseUrl: null, pricingType: 'free' }],
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({ useActiveWorkspaceId: () => null }));
vi.mock('@/store/user', () => ({ useUserStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'user-a' } }) }));
vi.mock('./useEngineeringWorkspace', () => ({ useEngineeringWorkspaceScope: () => ({ ready: true }) }));
vi.mock('./SubmissionReviewPanel', () => ({ default: () => <div>审核面板</div> }));
vi.mock('@/libs/trpc/client', () => ({ lambdaClient: { engineeringTools: {
  listMySubmissions: { query: vi.fn() }, saveMyDraft: { mutate: vi.fn() },
  startRevision: { mutate: fixture.startRevision }, submitMyDraft: { mutate: vi.fn() },
} } }));
vi.mock('swr', () => ({ default: () => ({ data: fixture.submitted, error: undefined, isLoading: false, mutate: fixture.mutate }) }));

describe('CommunityPanel', () => {
  it('starts a new draft revision without editing the published record in place', async () => {
    fixture.startRevision.mockResolvedValue({ id: '00000000-0000-4000-8000-000000000002', status: 'draft', version: 1 });
    fixture.mutate.mockResolvedValue(fixture.submitted);
    render(<CommunityPanel onCatalogChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: '我的投稿' }));
    expect(screen.getByText('已发布')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '发起修订' }));
    await waitFor(() => expect(fixture.startRevision).toHaveBeenCalledWith({
      expectedVersion: 3, id: '00000000-0000-4000-8000-000000000001',
    }));
    expect(screen.getByDisplayValue('Published Tool')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存修改' })).toBeInTheDocument();
  });
});
