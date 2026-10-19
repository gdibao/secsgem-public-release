import { recordUpstashWorkflowEvent } from '@lobechat/observability-otel/modules/upstash-workflow';
import { errorNameFrom } from '@lobechat/utils';
import { Client, type PublishRequest, type PublishResponse, Receiver } from '@upstash/qstash';
import { Client as WorkflowClient, type TriggerOptions } from '@upstash/workflow';
import debug from 'debug';

const log = debug('lobe-server:qstash');

const headers = {
  ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
    'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  }),
};

const normalizeLabel = (label?: string | string[]): string | undefined =>
  Array.isArray(label) ? label.join(',') : label;

type WorkflowTriggerResponse = { workflowRunId: string };

export class OtelQstashClient extends Client {
  override async publishJSON<
    TBody = unknown,
    TRequest extends PublishRequest<TBody> = PublishRequest<TBody>,
  >(request: TRequest): Promise<PublishResponse<TRequest>> {
    try {
      const response = await super.publishJSON(request);
      recordUpstashWorkflowEvent({
        interface: 'qstash',
        label: normalizeLabel(request.label),
        operation: 'trigger',
        retries: request.retries,
        retryDelay: request.retryDelay,
        status: 'success',
        url: request.url,
      });

      return response;
    } catch (error) {
      recordUpstashWorkflowEvent({
        errorType: errorNameFrom(error) ?? typeof error,
        interface: 'qstash',
        label: normalizeLabel(request.label),
        operation: 'trigger',
        retries: request.retries,
        retryDelay: request.retryDelay,
        status: 'error',
        url: request.url,
      });

      throw error;
    }
  }
}

export class OtelWorkflowClient extends WorkflowClient {
  override trigger(params: TriggerOptions): Promise<WorkflowTriggerResponse>;
  override trigger(params: TriggerOptions[]): Promise<WorkflowTriggerResponse[]>;
  override async trigger(
    params: TriggerOptions | TriggerOptions[],
  ): Promise<WorkflowTriggerResponse | WorkflowTriggerResponse[]> {
    const first = Array.isArray(params) ? params[0] : params;
    const count = Array.isArray(params) ? params.length : 1;

    try {
      const response = Array.isArray(params)
        ? await super.trigger(params)
        : await super.trigger(params);

      recordUpstashWorkflowEvent(
        {
          interface: 'workflow',
          label: first?.label,
          operation: 'trigger',
          retries: first?.retries,
          retryDelay: first?.retryDelay,
          status: 'success',
          url: first?.url,
          workflowRunId: Array.isArray(response)
            ? response[0]?.workflowRunId
            : response.workflowRunId,
        },
        count,
      );

      return response;
    } catch (error) {
      recordUpstashWorkflowEvent(
        {
          errorType: errorNameFrom(error) ?? typeof error,
          interface: 'workflow',
          label: first?.label,
          operation: 'trigger',
          retries: first?.retries,
          retryDelay: first?.retryDelay,
          status: 'error',
          url: first?.url,
          workflowRunId: first?.workflowRunId,
        },
        count,
      );

      throw error;
    }
  }
}

type QStashClient = InstanceType<typeof OtelQstashClient>;
type UpstashWorkflowClient = InstanceType<typeof OtelWorkflowClient>;

let cachedQstashClient: QStashClient | undefined;
let cachedQstashClientToken: string | undefined;
let cachedWorkflowClient: UpstashWorkflowClient | undefined;
let cachedWorkflowClientToken: string | undefined;

export const isQstashTokenAvailable = () => Boolean(process.env.QSTASH_TOKEN?.trim());

const getQstashToken = () => {
  const token = process.env.QSTASH_TOKEN?.trim();

  if (!token) {
    throw new Error('QSTASH_TOKEN is required to use QStash clients.');
  }

  return token;
};

const getQstashClient = () => {
  const token = getQstashToken();

  if (!cachedQstashClient || cachedQstashClientToken !== token) {
    cachedQstashClient = new OtelQstashClient({ headers, token });
    cachedQstashClientToken = token;
  }

  return cachedQstashClient;
};

const getWorkflowClient = () => {
  const token = getQstashToken();

  if (!cachedWorkflowClient || cachedWorkflowClientToken !== token) {
    cachedWorkflowClient = new OtelWorkflowClient({ headers, token });
    cachedWorkflowClientToken = token;
  }

  return cachedWorkflowClient;
};

const createLazyClient = <TClient extends object>(getClient: () => TClient): TClient =>
  new Proxy({} as TClient, {
    get(_target, property) {
      const client = getClient();
      const value = Reflect.get(client, property, client);

      return typeof value === 'function' ? value.bind(client) : value;
    },
    has(_target, property) {
      return property in getClient();
    },
    set(_target, property, value) {
      Reflect.set(getClient(), property, value);

      return true;
    },
  });

/**
 * QStash client with Vercel Deployment Protection bypass headers.
 * Use as `qstashClient` option in Upstash Workflow `serve()`.
 */
export const qstashClient = createLazyClient<QStashClient>(getQstashClient);

/**
 * Workflow client with Vercel Deployment Protection bypass headers.
 * Use for triggering workflows via `workflowClient.trigger()`.
 */
export const workflowClient = createLazyClient<UpstashWorkflowClient>(getWorkflowClient);

/**
 * Verify QStash signature using Receiver.
 * Returns false if signing keys or signature are missing, or verification fails.
 */
export async function verifyQStashSignature(request: Request, rawBody: string): Promise<boolean> {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!currentSigningKey || !nextSigningKey) {
    log('QStash signature verification disabled (no signing keys configured)');
    return false;
  }

  const signature = request.headers.get('Upstash-Signature');
  if (!signature) {
    log('Missing Upstash-Signature header');
    return false;
  }

  const receiver = new Receiver({ currentSigningKey, nextSigningKey });

  try {
    return await receiver.verify({ body: rawBody, signature });
  } catch (error) {
    log('QStash signature verification failed: %O', error);
    return false;
  }
}
