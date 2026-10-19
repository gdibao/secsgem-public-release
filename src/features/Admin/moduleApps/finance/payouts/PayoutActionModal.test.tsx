import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PayoutActionModal from './PayoutActionModal';

const baseUi = vi.hoisted(() => ({ modal: vi.fn() }));

vi.mock('@lobehub/ui/base-ui', () => ({
  Input: (props: any) => <input {...props} />,
  Modal: (props: any) => {
    baseUi.modal(props);
    return props.open ? (
      <div>
        {props.children}
        <button disabled={props.okButtonProps?.disabled} type="button" onClick={props.onOk}>
          {props.okText}
        </button>
      </div>
    ) : null;
  },
  Select: ({ options, onChange, ...props }: any) => (
    <select {...props} onChange={(event) => onChange?.(event.target.value)}>
      {options?.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  TextArea: (props: any) => <textarea {...props} />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('PayoutActionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('creates a payout batch with normalized revenue IDs', async () => {
    const service = {
      createPayoutBatch: vi.fn().mockResolvedValue({ id: 'payout-1' }),
      recordManualAlipayPayout: vi.fn(),
      transitionPayoutBatch: vi.fn(),
    };
    const onSuccess = vi.fn();
    render(
      <PayoutActionModal
        open
        mode="create"
        service={service}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByLabelText('moduleApps.admin.payouts.form.publisherId'), {
      target: { value: '00000000-0000-4000-8000-000000000001' },
    });
    fireEvent.change(screen.getByLabelText('moduleApps.admin.payouts.form.requestedAmount'), {
      target: { value: '80' },
    });
    fireEvent.change(screen.getByLabelText('moduleApps.admin.payouts.form.revenueEntryIds'), {
      target: {
        value: '00000000-0000-4000-8000-000000000011, 00000000-0000-4000-8000-000000000012',
      },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'moduleApps.admin.payouts.confirm.create' }),
    );

    await waitFor(() =>
      expect(service.createPayoutBatch).toHaveBeenCalledWith({
        publisherId: '00000000-0000-4000-8000-000000000001',
        requestedAmount: 80,
        revenueEntryIds: [
          '00000000-0000-4000-8000-000000000011',
          '00000000-0000-4000-8000-000000000012',
        ],
      }),
    );
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('keeps manual Alipay evidence after failure without local persistence', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const service = {
      createPayoutBatch: vi.fn(),
      recordManualAlipayPayout: vi.fn().mockRejectedValue(new Error('evidence rejected')),
      transitionPayoutBatch: vi.fn(),
    };
    render(
      <PayoutActionModal
        open
        mode="manage"
        service={service}
        payout={{
          auditEventIds: [],
          currency: 'CNY',
          id: '00000000-0000-4000-8000-000000000021',
          publisherId: 'publisher-1',
          publisherName: 'Studio',
          recipientMask: 'ali***@example.com',
          revenueEntryIds: [],
          status: 'processing',
          totalAmount: 80,
        }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('moduleApps.admin.payouts.form.operation'), {
      target: { value: 'manual' },
    });
    fireEvent.change(screen.getByLabelText('moduleApps.admin.payouts.form.transactionNo'), {
      target: { value: 'alipay-1' },
    });
    fireEvent.change(screen.getByLabelText('moduleApps.admin.payouts.form.recipientMask'), {
      target: { value: 'ali***@example.com' },
    });
    fireEvent.change(screen.getByLabelText('moduleApps.admin.payouts.form.evidenceReference'), {
      target: { value: 'receipt-1' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'moduleApps.admin.payouts.confirm.manual' }),
    );

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('evidence rejected'));
    expect(screen.getByLabelText('moduleApps.admin.payouts.form.transactionNo')).toHaveValue(
      'alipay-1',
    );
    expect(storageWrite).not.toHaveBeenCalled();
    storageWrite.mockRestore();
  });
});
