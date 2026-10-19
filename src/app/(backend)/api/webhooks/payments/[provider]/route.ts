import { type PaymentProvider, paymentProviderSchema } from '@lobechat/types';

import { getServerDB } from '@/database/server';
import { handlePaymentWebhook } from '@/server/services/payments/webhook';

const MAX_NOTIFICATION_BYTES = 256 * 1024;

const plainText = (body: 'failure' | 'success') =>
  new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    status: 200,
  });

const wechatResponse = (success: boolean) =>
  Response.json(
    success ? { code: 'SUCCESS', message: '成功' } : { code: 'FAIL', message: '处理失败' },
    { status: success ? 200 : 500 },
  );

export const createPaymentWebhookHandler =
  (dependencies: {
    handle: (input: {
      body: string;
      headers: Record<string, string>;
      provider: PaymentProvider;
    }) => Promise<unknown>;
    onError?: (error: unknown, context: { method: string; provider: PaymentProvider }) => void;
  }) =>
  async (request: Request, context: { params: Promise<{ provider: string }> }) => {
    const parsedProvider = paymentProviderSchema.safeParse((await context.params).provider);
    if (!parsedProvider.success) return new Response('Not Found', { status: 404 });
    const provider = parsedProvider.data;
    if (request.method === 'GET' && provider !== 'zpay') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_NOTIFICATION_BYTES) {
      return new Response('Payload Too Large', { status: 413 });
    }
    const body =
      request.method === 'GET'
        ? new URL(request.url).searchParams.toString()
        : await request.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_NOTIFICATION_BYTES) {
      return new Response('Payload Too Large', { status: 413 });
    }
    try {
      await dependencies.handle({
        body,
        headers: Object.fromEntries(request.headers.entries()),
        provider,
      });
      return provider === 'wechat_pay' ? wechatResponse(true) : plainText('success');
    } catch (error) {
      dependencies.onError?.(error, { method: request.method, provider });
      return provider === 'wechat_pay' ? wechatResponse(false) : plainText('failure');
    }
  };

const handler = createPaymentWebhookHandler({
  handle: async (input) => {
    const db = await getServerDB();
    return handlePaymentWebhook({ ...input, db });
  },
  onError: (error, context) => {
    console.error('[payment-webhook] processing failed', context, error);
  },
});

export const GET = handler;
export const POST = handler;
