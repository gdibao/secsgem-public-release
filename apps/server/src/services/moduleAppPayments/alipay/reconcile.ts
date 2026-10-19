import type { ModuleAppPaymentService } from '@/business/server/module-apps/payments/service';

import type { AlipayModuleAppClient } from './client';

export const reconcileModuleAppAlipayPayment = async (input: {
  client: AlipayModuleAppClient;
  outTradeNo: string;
  service: ModuleAppPaymentService;
}) => {
  const event = await input.client.query({ outTradeNo: input.outTradeNo });
  if (!event) return null;
  return input.service.handleNormalizedEvent(event);
};

export const reconcilePendingModuleAppAlipayPayments = (input: {
  limit?: number;
  service: ModuleAppPaymentService;
}) => input.service.reconcilePendingPayments({ limit: input.limit });
