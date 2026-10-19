import { TRPCError } from '@trpc/server';
import { z } from 'zod';

const getErrorIdentifier = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  return error instanceof Error ? error.message : 'module_app_runtime_failed';
};

export const mapModuleAppGatewayError = (error: unknown) => {
  if (error instanceof TRPCError) return error;
  if (error instanceof z.ZodError) {
    return new TRPCError({
      cause: error,
      code: 'BAD_REQUEST',
      message: 'MODULE_APP_INPUT_INVALID',
    });
  }

  const identifier = getErrorIdentifier(error);

  if (
    identifier === 'MODULE_APP_CAPABILITY_REPLAYED' ||
    identifier === 'MODULE_APP_ORDER_IDEMPOTENCY_CONFLICT'
  ) {
    return new TRPCError({ cause: error, code: 'CONFLICT', message: identifier });
  }
  if (identifier === 'MODULE_APP_NOTIFICATION_RATE_LIMITED') {
    return new TRPCError({ cause: error, code: 'TOO_MANY_REQUESTS', message: identifier });
  }
  if (
    identifier === 'MODULE_APP_CAPABILITY_DENIED' ||
    identifier === 'MODULE_APP_CAPABILITY_SCOPE_MISMATCH' ||
    identifier === 'MODULE_APP_FILE_SCOPE_DENIED' ||
    identifier === 'MODULE_APP_HTTP_HOST_DENIED' ||
    identifier === 'MODULE_APP_UNSAFE_API_URL' ||
    identifier === 'MODULE_APP_AI_PROVIDER_DENIED' ||
    identifier === 'MODULE_APP_PAYMENT_SCOPE_DENIED' ||
    identifier === 'MODULE_APP_ROLLOUT_NOT_ALLOWED' ||
    identifier === 'MODULE_APP_WORKSPACE_ADMIN_REQUIRED'
  ) {
    return new TRPCError({ cause: error, code: 'FORBIDDEN', message: identifier });
  }
  if (
    identifier === 'MODULE_APP_NEWAPI_PROVIDER_REQUIRED' ||
    identifier === 'MODULE_APP_NEWAPI_ROUTE_NOT_AVAILABLE' ||
    identifier === 'MODULE_APP_CREDIT_INSUFFICIENT_AVAILABLE_BALANCE' ||
    identifier === 'MODULE_APP_PAYMENT_DISABLED' ||
    identifier === 'MODULE_APP_PAYMENT_PUBLIC_URL_REQUIRED' ||
    identifier === 'PAYMENT_METHOD_NOT_AVAILABLE'
  ) {
    return new TRPCError({ cause: error, code: 'PRECONDITION_FAILED', message: identifier });
  }
  if (
    identifier.startsWith('MODULE_APP_FILE_') ||
    identifier.startsWith('MODULE_APP_DATA_') ||
    identifier.startsWith('MODULE_APP_HTTP_') ||
    identifier.startsWith('MODULE_APP_NOTIFICATION_') ||
    identifier.startsWith('MODULE_APP_SECRET_') ||
    identifier.startsWith('MODULE_APP_TASK_') ||
    identifier.startsWith('MODULE_APP_AI_') ||
    identifier.startsWith('MODULE_APP_PAYMENT_') ||
    identifier === 'MODULE_APP_CAPABILITY_REQUEST_ID_REQUIRED'
  ) {
    return new TRPCError({ cause: error, code: 'BAD_REQUEST', message: identifier });
  }
  if (
    identifier === 'MODULE_APP_PRODUCT_NOT_FOUND' ||
    identifier === 'MODULE_APP_ORDER_NOT_FOUND'
  ) {
    return new TRPCError({ cause: error, code: 'NOT_FOUND', message: identifier });
  }

  return new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'module_app_gateway_failed',
  });
};
