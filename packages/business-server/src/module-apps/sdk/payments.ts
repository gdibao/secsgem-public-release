import {
  type ModuleAppCapabilityClaims,
  type ModuleAppPaymentCatalog,
  moduleAppPaymentCatalogSchema,
  type ModuleAppPaymentCheckoutInput,
  moduleAppPaymentCheckoutInputSchema,
  type ModuleAppPaymentCheckoutResult,
  moduleAppPaymentCheckoutResultSchema,
  type ModuleAppPaymentOrderStatusInput,
  moduleAppPaymentOrderStatusInputSchema,
  type ModuleAppPaymentOrderStatusResult,
  moduleAppPaymentOrderStatusResultSchema,
  type PaymentMethod,
  paymentMethodSchema,
} from '@lobechat/types';
import { z } from 'zod';

import type { ModuleAppGatewayContext } from './context';

const emptyInputSchema = z.object({}).strict();
const methodsSchema = z.array(paymentMethodSchema).max(10);

export type ModuleAppPaymentsGatewayAdapter = {
  createCheckout: (input: {
    capability: ModuleAppCapabilityClaims;
    context: ModuleAppGatewayContext;
    input: ModuleAppPaymentCheckoutInput;
    requestId: string;
  }) => Promise<ModuleAppPaymentCheckoutResult>;
  getOrderStatus: (input: {
    capability: ModuleAppCapabilityClaims;
    context: ModuleAppGatewayContext;
    input: ModuleAppPaymentOrderStatusInput;
  }) => Promise<ModuleAppPaymentOrderStatusResult>;
  listCatalog: (input: {
    capability: ModuleAppCapabilityClaims;
    context: ModuleAppGatewayContext;
  }) => Promise<ModuleAppPaymentCatalog>;
  listMethods: (input: {
    capability: ModuleAppCapabilityClaims;
    context: ModuleAppGatewayContext;
  }) => Promise<PaymentMethod[]>;
};

export class ModuleAppPaymentsGateway {
  constructor(private readonly adapter: ModuleAppPaymentsGatewayAdapter) {}

  createCheckout = async (input: {
    capability: ModuleAppCapabilityClaims;
    context: ModuleAppGatewayContext;
    payload: unknown;
    requestId: string;
  }) => {
    const payload = moduleAppPaymentCheckoutInputSchema.parse(input.payload);
    return moduleAppPaymentCheckoutResultSchema.parse(
      await this.adapter.createCheckout({
        capability: input.capability,
        context: input.context,
        input: payload,
        requestId: input.requestId,
      }),
    );
  };

  getOrderStatus = async (input: {
    capability: ModuleAppCapabilityClaims;
    context: ModuleAppGatewayContext;
    payload: unknown;
  }) => {
    const payload = moduleAppPaymentOrderStatusInputSchema.parse(input.payload);
    return moduleAppPaymentOrderStatusResultSchema.parse(
      await this.adapter.getOrderStatus({
        capability: input.capability,
        context: input.context,
        input: payload,
      }),
    );
  };

  listCatalog = async (input: {
    capability: ModuleAppCapabilityClaims;
    context: ModuleAppGatewayContext;
    payload: unknown;
  }) => {
    if (input.payload !== undefined) emptyInputSchema.parse(input.payload);
    return moduleAppPaymentCatalogSchema.parse(
      await this.adapter.listCatalog({ capability: input.capability, context: input.context }),
    );
  };

  listMethods = async (input: {
    capability: ModuleAppCapabilityClaims;
    context: ModuleAppGatewayContext;
    payload: unknown;
  }) => {
    if (input.payload !== undefined) emptyInputSchema.parse(input.payload);
    return methodsSchema.parse(
      await this.adapter.listMethods({ capability: input.capability, context: input.context }),
    );
  };
}
