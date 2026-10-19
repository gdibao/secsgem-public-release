import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AppIdentityModal from './AppIdentityModal';

vi.mock('@lobehub/ui/base-ui', () => ({
  Input: ({ ...props }: any) => <input data-component="base-input" {...props} />,
  Modal: ({ children, okButtonProps, onOk, open, title }: any) =>
    open ? (
      <div>
        <h2>{title}</h2>
        {children}
        <button disabled={okButtonProps?.disabled} type="button" onClick={onOk}>
          submit
        </button>
      </div>
    ) : null,
  Select: ({ options, ...props }: any) => (
    <select data-component="base-select" {...props}>
      {options.map((option: { label: string; value: string }) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  TextArea: ({ ...props }: any) => <textarea data-component="base-textarea" {...props} />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('AppIdentityModal', () => {
  it('uses styled controls for identity fields', () => {
    render(
      <AppIdentityModal
        open
        draft={{
          category: 'office',
          description: 'A useful application.',
          displayName: 'Draft app',
          slug: 'draft-app',
        }}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByTestId('module-app-identity-form')).toBeInTheDocument();
    expect(screen.getByLabelText('moduleApps.admin.apps.identity.displayName')).toHaveAttribute(
      'data-component',
      'base-input',
    );
    expect(screen.getByLabelText('moduleApps.admin.apps.identity.status')).toHaveAttribute(
      'data-component',
      'base-select',
    );
    expect(screen.getByLabelText('moduleApps.admin.apps.identity.description')).toHaveAttribute(
      'data-component',
      'base-textarea',
    );
  });

  it('starts new applications from the non-sensitive identity draft', () => {
    const onDraftChange = vi.fn();
    render(
      <AppIdentityModal
        open
        draft={{ category: 'office', displayName: 'Draft app', slug: 'draft-app' }}
        onCancel={vi.fn()}
        onDraftChange={onDraftChange}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue('Draft app')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Draft app'), { target: { value: 'Changed app' } });
    expect(onDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ displayName: 'Changed app', slug: 'draft-app' }),
    );
  });

  it('requires category and description before submitting the identity', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AppIdentityModal
        open
        draft={{ displayName: 'Draft app', slug: 'draft-app' }}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const submit = screen.getByRole('button', { name: 'submit' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('moduleApps.admin.apps.identity.category'), {
      target: { value: 'office' },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('moduleApps.admin.apps.identity.description'), {
      target: { value: 'A useful application.' },
    });
    expect(submit).toBeEnabled();
  });

  it('surfaces server errors without discarding entered values', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Server rejected identity'));
    render(
      <AppIdentityModal
        open
        draft={{
          category: 'office',
          description: 'A useful application.',
          displayName: 'Draft app',
          slug: 'draft-app',
        }}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Server rejected identity');
    expect(screen.getByDisplayValue('Draft app')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A useful application.')).toBeInTheDocument();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});
