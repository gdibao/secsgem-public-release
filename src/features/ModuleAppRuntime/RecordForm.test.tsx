import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { moduleAppService } from '@/services/moduleApp';

import RecordForm from './RecordForm';

vi.mock('@/services/moduleApp', () => ({
  moduleAppService: {
    createRecord: vi.fn(),
    getRecord: vi.fn(),
    updateRecord: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const fields = [
  { key: 'title', label: 'Title', required: true, type: 'text' as const },
  {
    key: 'priority',
    label: 'Priority',
    options: [
      { label: 'High', value: 'high' },
      { label: 'Low', value: 'low' },
    ],
    required: false,
    type: 'select' as const,
  },
  { key: 'notes', label: 'Notes', required: false, type: 'textarea' as const },
  { key: 'estimate', label: 'Estimate', required: false, type: 'number' as const },
  { key: 'active', label: 'Active', required: false, type: 'boolean' as const },
  { key: 'due_date', label: 'Due date', required: false, type: 'date' as const },
];

const renderForm = (recordId?: string, onSaved = vi.fn()) =>
  render(
    <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
      <RecordForm
        appId="00000000-0000-4000-8000-000000000001"
        collectionKey="records"
        fields={fields}
        recordId={recordId}
        scopeType="personal"
        onSaved={onSaved}
      />
    </SWRConfig>,
  );

describe('RecordForm', () => {
  beforeEach(() => {
    vi.mocked(moduleAppService.createRecord).mockReset();
    vi.mocked(moduleAppService.getRecord).mockReset();
    vi.mocked(moduleAppService.updateRecord).mockReset();
  });

  it('creates a record from schema-driven fields', async () => {
    const onSaved = vi.fn();
    vi.mocked(moduleAppService.createRecord).mockResolvedValue({ id: 'record-1' });

    renderForm(undefined, onSaved);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Candidate A' } });
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'Strong fit' } });
    fireEvent.change(screen.getByLabelText(/Estimate/), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText(/Due date/), { target: { value: '2026-08-01' } });
    fireEvent.mouseDown(screen.getByLabelText(/Priority/));
    fireEvent.click(await screen.findByText('High'));
    fireEvent.click(screen.getByLabelText(/Active/));
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.runtime.records.create' }));

    await waitFor(() =>
      expect(moduleAppService.createRecord).toHaveBeenCalledWith({
        appId: '00000000-0000-4000-8000-000000000001',
        collectionKey: 'records',
        data: {
          active: true,
          due_date: '2026-08-01',
          estimate: 8,
          notes: 'Strong fit',
          priority: 'high',
          title: 'Candidate A',
        },
        scopeType: 'personal',
        title: 'Candidate A',
        workspaceId: undefined,
      }),
    );
    expect(onSaved).toHaveBeenCalledWith({ id: 'record-1' });
    expect(screen.getByText('moduleApps.runtime.records.saved')).toBeInTheDocument();
  });

  it('loads and updates an existing record', async () => {
    vi.mocked(moduleAppService.getRecord).mockResolvedValue({
      data: { title: 'Before' },
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Before',
    });
    vi.mocked(moduleAppService.updateRecord).mockResolvedValue({ id: 'record-1' });

    renderForm('00000000-0000-4000-8000-000000000010');

    const title = await screen.findByDisplayValue('Before');
    fireEvent.change(title, { target: { value: 'After' } });
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.runtime.records.update' }));

    await waitFor(() =>
      expect(moduleAppService.updateRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'After' }),
          recordId: '00000000-0000-4000-8000-000000000010',
          title: 'After',
        }),
      ),
    );
  });

  it('shows a retryable load error for an existing record', async () => {
    vi.mocked(moduleAppService.getRecord)
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce({ data: { title: 'Recovered' }, id: 'record-1' });

    renderForm('00000000-0000-4000-8000-000000000010');

    expect(await screen.findByText('moduleApps.runtime.records.loadError')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.runtime.retry' }));
    expect(await screen.findByDisplayValue('Recovered')).toBeInTheDocument();
  });

  it('keeps entered values and shows an error when saving fails', async () => {
    vi.mocked(moduleAppService.createRecord).mockRejectedValue(new Error('failed'));

    renderForm();

    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Unsaved candidate' } });
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.runtime.records.create' }));

    expect(await screen.findByText('moduleApps.runtime.records.saveError')).toBeInTheDocument();
    expect(title).toHaveValue('Unsaved candidate');
  });
});
