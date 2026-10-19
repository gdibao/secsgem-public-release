import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { mapModuleAppGatewayError } from './errors';

describe('mapModuleAppGatewayError', () => {
  it('maps SDK payload schema errors to a stable bad-request response', () => {
    const validationError = z
      .object({ productId: z.string().uuid() })
      .safeParse({ productId: 'invalid' }).error;

    expect(mapModuleAppGatewayError(validationError)).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'MODULE_APP_INPUT_INVALID',
    });
  });

  it('preserves payment order idempotency conflicts', () => {
    expect(
      mapModuleAppGatewayError(new Error('MODULE_APP_ORDER_IDEMPOTENCY_CONFLICT')),
    ).toMatchObject({
      code: 'CONFLICT',
      message: 'MODULE_APP_ORDER_IDEMPOTENCY_CONFLICT',
    });
  });

  it('reports insufficient managed AI credits as a failed precondition', () => {
    expect(
      mapModuleAppGatewayError(new Error('MODULE_APP_CREDIT_INSUFFICIENT_AVAILABLE_BALANCE')),
    ).toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'MODULE_APP_CREDIT_INSUFFICIENT_AVAILABLE_BALANCE',
    });
  });

  it('maps a revoked module rollout to forbidden', () => {
    expect(mapModuleAppGatewayError(new Error('MODULE_APP_ROLLOUT_NOT_ALLOWED'))).toMatchObject({
      code: 'FORBIDDEN',
      message: 'MODULE_APP_ROLLOUT_NOT_ALLOWED',
    });
  });
});
