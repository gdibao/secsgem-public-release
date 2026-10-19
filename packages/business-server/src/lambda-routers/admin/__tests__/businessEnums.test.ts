import { describe, expect, it } from 'vitest';

import {
  SubscriptionChangeRequestStatusEnum,
  TopUpOrderStatusEnum,
} from '@lobechat/types';

describe('TopUpOrderStatusEnum', () => {
  it('exposes Expired for maintenance cron', () => {
    expect(TopUpOrderStatusEnum.Expired).toBe('expired');
  });

  it('keeps legacy statuses intact', () => {
    expect(TopUpOrderStatusEnum.Pending).toBe('pending');
    expect(TopUpOrderStatusEnum.Paid).toBe('paid');
    expect(TopUpOrderStatusEnum.Canceled).toBe('canceled');
    expect(TopUpOrderStatusEnum.Failed).toBe('failed');
  });
});

describe('SubscriptionChangeRequestStatusEnum', () => {
  it('exposes Rejected for admin reject flow', () => {
    expect(SubscriptionChangeRequestStatusEnum.Rejected).toBe('rejected');
  });

  it('keeps activation/cancellation statuses', () => {
    expect(SubscriptionChangeRequestStatusEnum.Pending).toBe('pending');
    expect(SubscriptionChangeRequestStatusEnum.Completed).toBe('completed');
    expect(SubscriptionChangeRequestStatusEnum.Canceled).toBe('canceled');
  });
});
