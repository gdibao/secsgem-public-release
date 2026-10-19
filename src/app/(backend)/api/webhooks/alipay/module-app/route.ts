import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { handlePaymentWebhook } from '@/server/services/payments/webhook';

const MAX_NOTIFICATION_BYTES = 256 * 1024;

const plainText = (body: 'failure' | 'success') =>
  new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' }, status: 200 });

export const createAlipayModuleAppWebhookHandler =
  (dependencies: {
    autoSettlementEnabled: boolean;
    handleNotification: (input: {
      body: string;
      headers: Record<string, string>;
    }) => Promise<unknown>;
  }) =>
  async (request: Request) => {
    if (!dependencies.autoSettlementEnabled) return plainText('failure');
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_NOTIFICATION_BYTES) {
      return new Response('Payload Too Large', { status: 413 });
    }
    const body = await request.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_NOTIFICATION_BYTES) {
      return new Response('Payload Too Large', { status: 413 });
    }
    try {
      await dependencies.handleNotification({
        body,
        headers: Object.fromEntries(request.headers.entries()),
      });
      return plainText('success');
    } catch {
      return plainText('failure');
    }
  };

export const POST = createAlipayModuleAppWebhookHandler({
  autoSettlementEnabled: appEnv.MODULE_APP_ALIPAY_AUTO_SETTLEMENT_ENABLED,
  handleNotification: async (input) => {
    const db = await getServerDB();
    return handlePaymentWebhook({ ...input, db, provider: 'alipay' });
  },
});
