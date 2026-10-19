// @vitest-environment node
import { createHash, createHmac } from 'node:crypto';

import { moduleAppWorkflowDefinitionSchema } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { createModuleAppWebhookHandler } from './route';

const WEBHOOK_ID = '00000000-0000-4000-8000-000000000001';
const secret = 'module-app-webhook-secret';
const secretHash = createHash('sha256').update(secret).digest('hex');
const rawBody = JSON.stringify({ candidateId: 'candidate-1' });
const nowSeconds = 1_783_760_000;
const signature = (timestamp: number) =>
  createHmac('sha256', Buffer.from(secretHash, 'hex'))
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

const request = (timestamp: number, deliveryId = 'delivery-1') =>
  new Request(`https://app.example.com/api/webhooks/module-app/${WEBHOOK_ID}`, {
    body: rawBody,
    headers: {
      'content-type': 'application/json',
      'x-module-app-delivery': deliveryId,
      'x-module-app-signature': `sha256=${signature(timestamp)}`,
      'x-module-app-timestamp': String(timestamp),
    },
    method: 'POST',
  });

const createHandler = (duplicate = false) => {
  const acceptDelivery = vi.fn().mockResolvedValue({ duplicate });
  const assertEntitlement = vi.fn().mockResolvedValue(undefined);
  const dispatch = vi.fn().mockResolvedValue({ workflowRunId: 'qstash-run-1' });
  const failRun = vi.fn().mockResolvedValue({ status: 'failed' });
  const start = vi.fn().mockResolvedValue({ id: 'workflow-run-1' });
  const updateDelivery = vi.fn().mockResolvedValue({ status: 'processed' });
  const handler = createModuleAppWebhookHandler({
    acceptDelivery,
    assertEntitlement,
    dispatch,
    failRun,
    getWebhook: vi.fn().mockResolvedValue({
      installationId: '00000000-0000-4000-8000-000000000010',
      replayWindowSeconds: 300,
      secretHash,
      status: 'active',
      workflow: moduleAppWorkflowDefinitionSchema.parse({
        edges: [],
        key: 'candidate_review',
        nodes: [{ config: {}, key: 'load', type: 'function' }],
        startNodeKey: 'load',
        version: 1,
      }),
    }),
    now: () => new Date(nowSeconds * 1000),
    start,
    updateDelivery,
  });
  return { acceptDelivery, assertEntitlement, dispatch, failRun, handler, start, updateDelivery };
};

describe('module app webhook route', () => {
  it('rejects expired timestamps', async () => {
    const { handler } = createHandler();
    const response = await handler(request(nowSeconds - 301), {
      params: Promise.resolve({ webhookId: WEBHOOK_ID }),
    });
    expect(response.status).toBe(401);
  });

  it('accepts one signed delivery and dispatches its workflow', async () => {
    const { assertEntitlement, dispatch, handler, start } = createHandler();
    const response = await handler(request(nowSeconds), {
      params: Promise.resolve({ webhookId: WEBHOOK_ID }),
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ duplicate: false, runId: 'workflow-run-1' });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: `${WEBHOOK_ID}:delivery-1` }),
    );
    expect(assertEntitlement.mock.invocationCallOrder[0]).toBeLessThan(
      start.mock.invocationCallOrder[0],
    );
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('acknowledges duplicate deliveries without dispatching twice', async () => {
    const { dispatch, handler, start } = createHandler(true);
    const response = await handler(request(nowSeconds), {
      params: Promise.resolve({ webhookId: WEBHOOK_ID }),
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ duplicate: true });
    expect(start).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('marks entitlement-denied deliveries failed before creating a run', async () => {
    const { assertEntitlement, handler, start, updateDelivery } = createHandler();
    assertEntitlement.mockRejectedValue(new Error('MODULE_APP_ENTITLEMENT_LICENSE_EXPIRED'));

    const response = await handler(request(nowSeconds), {
      params: Promise.resolve({ webhookId: WEBHOOK_ID }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'MODULE_APP_WORKFLOW_ENTITLEMENT_DENIED',
    });
    expect(start).not.toHaveBeenCalled();
    expect(updateDelivery).toHaveBeenCalledWith({
      deliveryId: 'delivery-1',
      status: 'failed',
      webhookId: WEBHOOK_ID,
    });
  });

  it('marks a started run and delivery failed when dispatch fails', async () => {
    const { dispatch, failRun, handler, updateDelivery } = createHandler();
    dispatch.mockRejectedValue(new Error('qstash unavailable'));

    const response = await handler(request(nowSeconds), {
      params: Promise.resolve({ webhookId: WEBHOOK_ID }),
    });

    expect(response.status).toBe(500);
    expect(failRun).toHaveBeenCalledWith({
      errorCode: 'MODULE_APP_WORKFLOW_DISPATCH_FAILED',
      installationId: '00000000-0000-4000-8000-000000000010',
      runId: 'workflow-run-1',
    });
    expect(updateDelivery).toHaveBeenCalledWith({
      deliveryId: 'delivery-1',
      status: 'failed',
      webhookId: WEBHOOK_ID,
    });
  });

  it('keeps a dispatched run accepted when processed-delivery bookkeeping fails', async () => {
    const { failRun, handler, updateDelivery } = createHandler();
    updateDelivery.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await handler(request(nowSeconds), {
      params: Promise.resolve({ webhookId: WEBHOOK_ID }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      deliveryStatus: 'accepted',
      runId: 'workflow-run-1',
    });
    expect(failRun).not.toHaveBeenCalled();
  });

  it('records a failed delivery even when failed-run bookkeeping throws', async () => {
    const { dispatch, failRun, handler, updateDelivery } = createHandler();
    dispatch.mockRejectedValue(new Error('qstash unavailable'));
    failRun.mockRejectedValue(new Error('run database unavailable'));

    await expect(handler(request(nowSeconds), {
      params: Promise.resolve({ webhookId: WEBHOOK_ID }),
    })).rejects.toThrow('run database unavailable');
    expect(updateDelivery).toHaveBeenCalledWith({
      deliveryId: 'delivery-1',
      status: 'failed',
      webhookId: WEBHOOK_ID,
    });
  });

  it('propagates infrastructure failures while resolving entitlement', async () => {
    const { assertEntitlement, handler, start, updateDelivery } = createHandler();
    assertEntitlement.mockRejectedValue(new Error('database unavailable'));

    await expect(handler(request(nowSeconds), {
      params: Promise.resolve({ webhookId: WEBHOOK_ID }),
    })).rejects.toThrow('database unavailable');
    expect(start).not.toHaveBeenCalled();
    expect(updateDelivery).not.toHaveBeenCalled();
  });
});
