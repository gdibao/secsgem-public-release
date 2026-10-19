import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PublisherFormModal from './PublisherFormModal';

vi.mock('@lobehub/ui/base-ui', () => ({
  Input: (props: any) => <input {...props} />,
  Modal: ({ children, okButtonProps, okText, onOk, open }: any) =>
    open ? (
      <div>
        {children}
        <button disabled={okButtonProps?.disabled} type="button" onClick={onOk}>
          {okText}
        </button>
      </div>
    ) : null,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('PublisherFormModal', () => {
  it('submits trimmed publisher identity with an optional masked recipient', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PublisherFormModal open onCancel={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('moduleApps.admin.publishers.displayName'), {
      target: { value: ' Studio ' },
    });
    fireEvent.change(screen.getByLabelText('moduleApps.admin.publishers.ownerUserId'), {
      target: { value: ' owner-1 ' },
    });
    fireEvent.change(screen.getByLabelText('moduleApps.admin.publishers.recipientMask'), {
      target: { value: ' ali***@example.com ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'moduleApps.admin.publishers.create' }));

    expect(onSubmit).toHaveBeenCalledWith({
      displayName: 'Studio',
      recipientMask: 'ali***@example.com',
      userId: 'owner-1',
    });
  });

  it('rejects a recipient mask shorter than the backend minimum', () => {
    render(<PublisherFormModal open onCancel={vi.fn()} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('moduleApps.admin.publishers.displayName'), {
      target: { value: 'Studio' },
    });
    fireEvent.change(screen.getByLabelText('moduleApps.admin.publishers.ownerUserId'), {
      target: { value: 'owner-1' },
    });
    fireEvent.change(screen.getByLabelText('moduleApps.admin.publishers.recipientMask'), {
      target: { value: '*' },
    });

    expect(
      screen.getByRole('button', { name: 'moduleApps.admin.publishers.create' }),
    ).toBeDisabled();
  });

  it('enforces the backend display name and owner ID limits', () => {
    render(<PublisherFormModal open onCancel={vi.fn()} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('moduleApps.admin.publishers.displayName'), {
      target: { value: 'a'.repeat(201) },
    });
    fireEvent.change(screen.getByLabelText('moduleApps.admin.publishers.ownerUserId'), {
      target: { value: 'u'.repeat(256) },
    });

    expect(
      screen.getByRole('button', { name: 'moduleApps.admin.publishers.create' }),
    ).toBeDisabled();
    expect(screen.getByLabelText('moduleApps.admin.publishers.displayName')).toHaveAttribute(
      'maxLength',
      '200',
    );
    expect(screen.getByLabelText('moduleApps.admin.publishers.ownerUserId')).toHaveAttribute(
      'maxLength',
      '255',
    );
  });
});
