import { and, eq } from 'drizzle-orm';

import { moduleAppPackages, moduleAppPublishers, moduleApps } from '../schemas';
import type { LobeChatDatabase } from '../type';

export class ModuleAppPublisherModel {
  constructor(private readonly db: LobeChatDatabase) {}

  createPublisher = async (input: {
    displayName: string;
    recipientMask?: string;
    userId: string;
  }) => {
    const displayName = input.displayName.trim();
    const recipientMask = input.recipientMask?.trim();
    if (!displayName || (recipientMask && !recipientMask.includes('*'))) {
      throw new Error('MODULE_APP_PUBLISHER_INPUT_INVALID');
    }
    const [publisher] = await this.db
      .insert(moduleAppPublishers)
      .values({ ...input, displayName, recipientMask })
      .onConflictDoNothing({ target: moduleAppPublishers.userId })
      .returning();
    if (publisher) return publisher;
    const existing = await this.db.query.moduleAppPublishers.findFirst({
      where: eq(moduleAppPublishers.userId, input.userId),
    });
    if (!existing) throw new Error('MODULE_APP_PUBLISHER_CREATE_FAILED');
    return existing;
  };

  verifyPublisher = async (input: {
    publisherId: string;
    verificationMetadata?: Record<string, unknown>;
  }) => {
    const now = new Date();
    const [publisher] = await this.db
      .update(moduleAppPublishers)
      .set({
        status: 'verified',
        suspendedAt: null,
        verificationMetadata: input.verificationMetadata ?? {},
        verifiedAt: now,
      })
      .where(
        and(
          eq(moduleAppPublishers.id, input.publisherId),
          eq(moduleAppPublishers.status, 'pending'),
        ),
      )
      .returning();
    if (!publisher) throw new Error('MODULE_APP_PUBLISHER_NOT_VERIFIABLE');
    return publisher;
  };

  suspendPublisher = async (input: { publisherId: string }) => {
    const [publisher] = await this.db
      .update(moduleAppPublishers)
      .set({ status: 'suspended', suspendedAt: new Date() })
      .where(
        and(
          eq(moduleAppPublishers.id, input.publisherId),
          eq(moduleAppPublishers.status, 'verified'),
        ),
      )
      .returning();
    if (!publisher) throw new Error('MODULE_APP_PUBLISHER_NOT_SUSPENDABLE');
    return publisher;
  };

  assignApplication = async (input: { appId: string; publisherId: string }) =>
    this.db.transaction(async (tx) => {
      const publisher = await tx.query.moduleAppPublishers.findFirst({
        where: and(
          eq(moduleAppPublishers.id, input.publisherId),
          eq(moduleAppPublishers.status, 'verified'),
        ),
      });
      if (!publisher) throw new Error('MODULE_APP_PUBLISHER_NOT_VERIFIED');
      const [app] = await tx
        .update(moduleApps)
        .set({ publisherId: publisher.id })
        .where(eq(moduleApps.id, input.appId))
        .returning();
      if (!app) throw new Error('MODULE_APP_NOT_FOUND');
      await tx
        .update(moduleAppPackages)
        .set({ publisherId: publisher.id })
        .where(
          and(
            eq(moduleAppPackages.appId, app.id),
            eq(moduleAppPackages.reviewStatus, 'approved'),
          ),
        );
      return app;
    });

  listPublishers = async (input: {
    cursor?: number;
    limit?: number;
    status?: 'pending' | 'suspended' | 'verified';
  } = {}) => {
    const cursor = Math.max(0, Math.floor(input.cursor ?? 0));
    const limit = Math.min(200, Math.max(1, Math.floor(input.limit ?? 50)));
    const items = await this.db.query.moduleAppPublishers.findMany({
      limit: limit + 1,
      offset: cursor,
      orderBy: (rows, { desc }) => [desc(rows.createdAt), desc(rows.id)],
      where: input.status ? eq(moduleAppPublishers.status, input.status) : undefined,
    });
    return {
      items: items.slice(0, limit),
      nextCursor: items.length > limit ? cursor + limit : null,
    };
  };
}
