import type { ModuleAppCapabilityClaims } from '@lobechat/types';

type CreateNotification = (input: {
  actionUrl?: string;
  category: string;
  content: string;
  dedupeKey: string;
  title: string;
  type: string;
}) => Promise<null | { id: string }>;

export class ModuleAppNotificationGateway {
  private readonly create: CreateNotification;
  private readonly rateLimiter: ModuleAppNotificationRateLimiter;

  constructor(options: {
    create: CreateNotification;
    rateLimiter?: ModuleAppNotificationRateLimiter;
  }) {
    this.create = options.create;
    this.rateLimiter = options.rateLimiter ?? new ModuleAppNotificationRateLimiter();
  }

  createNotification = async (
    capability: ModuleAppCapabilityClaims,
    input: unknown,
    requestId: string,
  ) => {
    if (
      !input ||
      typeof input !== 'object' ||
      !('title' in input) ||
      typeof input.title !== 'string' ||
      !('content' in input) ||
      typeof input.content !== 'string' ||
      input.title.length < 1 ||
      input.title.length > 120 ||
      input.content.length < 1 ||
      input.content.length > 2000
    ) {
      throw new Error('MODULE_APP_NOTIFICATION_INPUT_INVALID');
    }

    const actionUrl =
      'actionUrl' in input && typeof input.actionUrl === 'string' ? input.actionUrl : undefined;
    if (actionUrl && (!actionUrl.startsWith('/') || actionUrl.startsWith('//'))) {
      throw new Error('MODULE_APP_NOTIFICATION_ACTION_DENIED');
    }

    await this.rateLimiter.consume(capability.installationId);

    const created = await this.create({
      actionUrl,
      category: 'module_app',
      content: input.content,
      dedupeKey: `${capability.installationId}:${requestId}`,
      title: input.title,
      type: 'module_app_event',
    });

    return { id: created?.id ?? null };
  };
}

export class ModuleAppNotificationRateLimiter {
  private readonly recent = new Map<string, number[]>();
  private readonly backend?: ModuleAppNotificationRateLimitBackend;

  constructor(options: { backend?: ModuleAppNotificationRateLimitBackend } = {}) {
    this.backend = options.backend;
  }

  consume = async (installationId: string) => {
    if (this.backend) {
      const consumed = await this.backend.consume(installationId, 10, 60_000);
      if (!consumed) throw new Error('MODULE_APP_NOTIFICATION_RATE_LIMITED');
      return;
    }

    const now = Date.now();
    const recent = (this.recent.get(installationId) ?? []).filter(
      (timestamp) => timestamp > now - 60_000,
    );
    if (recent.length >= 10) throw new Error('MODULE_APP_NOTIFICATION_RATE_LIMITED');
    recent.push(now);
    this.recent.set(installationId, recent);
  };
}

export interface ModuleAppNotificationRateLimitBackend {
  consume: (installationId: string, limit: number, windowMs: number) => Promise<boolean>;
}
