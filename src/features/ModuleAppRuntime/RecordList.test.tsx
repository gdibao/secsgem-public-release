import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { moduleAppService } from '@/services/moduleApp';

import RecordList from './RecordList';

vi.mock('@/services/moduleApp', () => ({
  moduleAppService: { listRecords: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const renderList = () =>
  render(
    <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
      <RecordList
        appId="00000000-0000-4000-8000-000000000001"
        collectionKey="records"
        createHref="/apps/app-1/app/record_form"
        pageSize={10}
        scopeType="personal"
      />
    </SWRConfig>,
  );

describe('RecordList', () => {
  beforeEach(() => {
    vi.mocked(moduleAppService.listRecords).mockReset();
  });

  it('renders records and paginates without changing the server query scope', async () => {
    vi.mocked(moduleAppService.listRecords).mockImplementation(async (input) => {
      const offset = Number((input as { offset?: number }).offset ?? 0);
      const items = Array.from({ length: offset === 0 ? 10 : 1 }, (_, index) => {
        const rank = offset + index + 1;
        return {
          data: { rank },
          id: `record-${rank}`,
          title: `Record ${rank}`,
          updatedAt: new Date(2026, 6, rank).toISOString(),
        };
      });
      return { items, total: 11 };
    });

    renderList();

    expect(await screen.findByText('Record 1')).toBeInTheDocument();
    expect(screen.queryByText('Record 11')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    expect(await screen.findByText('Record 11')).toBeInTheDocument();
    expect(moduleAppService.listRecords).toHaveBeenNthCalledWith(1, {
      appId: '00000000-0000-4000-8000-000000000001',
      collectionKey: 'records',
      limit: 10,
      offset: 0,
      scopeType: 'personal',
      workspaceId: undefined,
    });
    expect(moduleAppService.listRecords).toHaveBeenNthCalledWith(2, {
      appId: '00000000-0000-4000-8000-000000000001',
      collectionKey: 'records',
      limit: 10,
      offset: 10,
      scopeType: 'personal',
      workspaceId: undefined,
    });
  });

  it('renders an empty state', async () => {
    vi.mocked(moduleAppService.listRecords).mockResolvedValue({ items: [], total: 0 });

    renderList();

    expect(await screen.findByText('moduleApps.runtime.records.empty')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'moduleApps.runtime.records.create' }),
    ).toHaveAttribute('href', '/apps/app-1/app/record_form');
  });

  it('renders a retryable error state', async () => {
    vi.mocked(moduleAppService.listRecords)
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce({ items: [], total: 0 });

    renderList();

    expect(await screen.findByText('moduleApps.runtime.records.loadError')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.runtime.retry' }));
    await waitFor(() => expect(moduleAppService.listRecords).toHaveBeenCalledTimes(2));
  });
});
