import type { ModuleAppCapabilityClaims } from '@lobechat/types';

import type { ModuleAppDataService } from '../data/service';
import type { ModuleAppTaskService } from '../workflows/taskService';
import type { ModuleAppAiGateway } from './ai';
import {
  assertModuleAppContextScope,
  type ModuleAppContextResolver,
  serializeModuleAppContext,
} from './context';
import type { ModuleAppFileGateway } from './files';
import type { ModuleAppHttpGateway } from './http';
import type { ModuleAppNotificationGateway } from './notifications';
import type { ModuleAppPaymentsGateway } from './payments';
import type { ModuleAppSecretsGateway } from './secrets';

export type ModuleAppGatewayMethod =
  | 'ai.chat'
  | 'ai.models.list'
  | 'context.get'
  | 'data.archive'
  | 'data.get'
  | 'data.insert'
  | 'data.list'
  | 'data.transaction'
  | 'data.update'
  | 'files.createDownload'
  | 'files.createUpload'
  | 'http.fetch'
  | 'notifications.create'
  | 'payments.catalog.list'
  | 'payments.checkout.create'
  | 'payments.methods.list'
  | 'payments.status.get'
  | 'secrets.get'
  | 'tasks.cancel'
  | 'tasks.getRun';

const requiredPermission: Record<ModuleAppGatewayMethod, null | string> = {
  'ai.chat': 'ai.chat',
  'ai.models.list': 'ai.models.read',
  'context.get': null,
  'data.archive': 'data.write',
  'data.get': 'data.read',
  'data.insert': 'data.write',
  'data.list': 'data.read',
  'data.transaction': 'data.write',
  'data.update': 'data.write',
  'files.createDownload': 'files.read',
  'files.createUpload': 'files.write',
  'http.fetch': 'http.fetch',
  'notifications.create': 'notifications.write',
  'payments.catalog.list': 'payments.catalog.read',
  'payments.checkout.create': 'payments.checkout',
  'payments.methods.list': 'payments.methods.read',
  'payments.status.get': 'payments.orders.read',
  'secrets.get': 'secrets.read',
  'tasks.cancel': 'tasks.write',
  'tasks.getRun': 'tasks.read',
};

const mutationMethods = new Set<ModuleAppGatewayMethod>([
  'ai.chat',
  'data.archive',
  'data.insert',
  'data.transaction',
  'data.update',
  'files.createUpload',
  'http.fetch',
  'notifications.create',
  'payments.checkout.create',
  'tasks.cancel',
]);

export class ModuleAppReplayGuard {
  private readonly consumed = new Map<string, number>();
  private readonly backend?: ModuleAppReplayGuardBackend;

  constructor(options: { backend?: ModuleAppReplayGuardBackend } = {}) {
    this.backend = options.backend;
  }

  consume = async (capability: ModuleAppCapabilityClaims, requestId?: string) => {
    if (!requestId || requestId.length < 1 || requestId.length > 160) {
      throw new Error('MODULE_APP_CAPABILITY_REQUEST_ID_REQUIRED');
    }

    const now = Math.floor(Date.now() / 1000);
    const key = `${capability.installationId}:${capability.nonce}:${requestId}`;
    if (this.backend) {
      const consumed = await this.backend.consume(key, Math.max(1, capability.exp - now));
      if (!consumed) throw new Error('MODULE_APP_CAPABILITY_REPLAYED');
      return;
    }

    for (const [key, expiresAt] of this.consumed) {
      if (expiresAt <= now) this.consumed.delete(key);
    }

    if (this.consumed.has(key)) throw new Error('MODULE_APP_CAPABILITY_REPLAYED');
    this.consumed.set(key, capability.exp);
  };
}

export interface ModuleAppReplayGuardBackend {
  consume: (key: string, ttlSeconds: number) => Promise<boolean>;
}

type GatewayOptions = {
  ai: ModuleAppAiGateway;
  context: ModuleAppContextResolver;
  data: ModuleAppDataService;
  files: ModuleAppFileGateway;
  http: ModuleAppHttpGateway;
  notifications: ModuleAppNotificationGateway;
  payments: ModuleAppPaymentsGateway;
  replayGuard: ModuleAppReplayGuard;
  secrets: ModuleAppSecretsGateway;
  tasks: ModuleAppTaskService;
};

export class ModuleAppCapabilityGateway {
  private readonly ai: ModuleAppAiGateway;
  private readonly context: ModuleAppContextResolver;
  private readonly data: ModuleAppDataService;
  private readonly files: ModuleAppFileGateway;
  private readonly http: ModuleAppHttpGateway;
  private readonly notifications: ModuleAppNotificationGateway;
  private readonly payments: ModuleAppPaymentsGateway;
  private readonly replayGuard: ModuleAppReplayGuard;
  private readonly secrets: ModuleAppSecretsGateway;
  private readonly tasks: ModuleAppTaskService;

  constructor(options: GatewayOptions) {
    this.ai = options.ai;
    this.context = options.context;
    this.data = options.data;
    this.files = options.files;
    this.http = options.http;
    this.notifications = options.notifications;
    this.payments = options.payments;
    this.replayGuard = options.replayGuard;
    this.secrets = options.secrets;
    this.tasks = options.tasks;
  }

  call = async (params: {
    capability: ModuleAppCapabilityClaims;
    input?: unknown;
    method: ModuleAppGatewayMethod;
    requestId?: string;
  }) => {
    const permission = requiredPermission[params.method];
    if (permission && !params.capability.permissions.includes(permission)) {
      throw new Error('MODULE_APP_CAPABILITY_DENIED');
    }

    const context = await this.context.resolve(params.capability);
    assertModuleAppContextScope(params.capability, context);
    if (mutationMethods.has(params.method)) {
      await this.replayGuard.consume(params.capability, params.requestId);
    }

    switch (params.method) {
      case 'ai.chat': {
        return this.ai.chat({
          capability: params.capability,
          context,
          payload: params.input,
          requestId: params.requestId!,
        });
      }
      case 'ai.models.list': {
        return this.ai.listModels({
          capability: params.capability,
          context,
          payload: params.input,
        });
      }
      case 'context.get': {
        return serializeModuleAppContext(context);
      }
      case 'data.archive': {
        return this.data.archive({ capability: params.capability, input: params.input });
      }
      case 'data.get': {
        return this.data.get({ capability: params.capability, input: params.input });
      }
      case 'data.insert': {
        return this.data.insert({ capability: params.capability, input: params.input });
      }
      case 'data.list': {
        return this.data.list({ capability: params.capability, input: params.input });
      }
      case 'data.transaction': {
        return this.data.transaction({ capability: params.capability, input: params.input });
      }
      case 'data.update': {
        return this.data.update({ capability: params.capability, input: params.input });
      }
      case 'files.createDownload': {
        return this.files.createDownload(params.capability, params.input);
      }
      case 'files.createUpload': {
        return this.files.createUpload(params.capability, params.input);
      }
      case 'http.fetch': {
        return this.http.request(params.capability, context, params.input);
      }
      case 'notifications.create': {
        return this.notifications.createNotification(
          params.capability,
          params.input,
          params.requestId!,
        );
      }
      case 'payments.catalog.list': {
        return this.payments.listCatalog({
          capability: params.capability,
          context,
          payload: params.input,
        });
      }
      case 'payments.checkout.create': {
        return this.payments.createCheckout({
          capability: params.capability,
          context,
          payload: params.input,
          requestId: params.requestId!,
        });
      }
      case 'payments.methods.list': {
        return this.payments.listMethods({
          capability: params.capability,
          context,
          payload: params.input,
        });
      }
      case 'payments.status.get': {
        return this.payments.getOrderStatus({
          capability: params.capability,
          context,
          payload: params.input,
        });
      }
      case 'secrets.get': {
        return this.secrets.get(params.capability, params.input, context.secretKeys);
      }
      case 'tasks.cancel': {
        return this.tasks.cancel({ capability: params.capability, input: params.input });
      }
      case 'tasks.getRun': {
        return this.tasks.getRun({ capability: params.capability, input: params.input });
      }
    }
  };
}
