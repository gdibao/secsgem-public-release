// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { moduleAppPackages, moduleAppPublishers, moduleApps, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ModuleAppPublisherModel } from '../moduleAppPublisher';

const serverDB: LobeChatDatabase = await getTestDB();
const PUBLISHER_USER_ID = 'module-app-publisher-user';

beforeEach(async () => {
  await serverDB.delete(moduleAppPackages);
  await serverDB.delete(moduleApps);
  await serverDB.delete(moduleAppPublishers);
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: PUBLISHER_USER_ID });
});

describe('ModuleAppPublisherModel', () => {
  it('verifies, assigns, and suspends a stable publisher identity', async () => {
    const model = new ModuleAppPublisherModel(serverDB);
    const publisher = await model.createPublisher({
      displayName: 'Verified Studio',
      recipientMask: 'ali***@example.com',
      userId: PUBLISHER_USER_ID,
    });
    expect(publisher.status).toBe('pending');
    await expect(model.verifyPublisher({ publisherId: publisher.id })).resolves.toMatchObject({
      status: 'verified',
    });
    const [app] = await serverDB.insert(moduleApps).values({
      appType: 'standard_app',
      category: 'commerce',
      description: 'Publisher app',
      displayName: 'Publisher app',
      icon: 'Store',
      slug: `publisher-${crypto.randomUUID()}`,
      status: 'published',
    }).returning();
    const [approvedPackage] = await serverDB.insert(moduleAppPackages).values({
      appId: app.id,
      archive: {
        fileName: 'publisher.zip',
        mimeType: 'application/zip',
        sha256: 'a'.repeat(64),
        sizeBytes: 100,
        storageKey: 'module-app-packages/publisher.zip',
      },
      manifestSnapshot: {
        app: {
          appType: 'standard_app',
          category: 'commerce',
          description: 'Publisher app',
          displayName: 'Publisher app',
          icon: 'Store',
          slug: app.slug,
          status: 'published',
          tags: [],
        },
        packageVersion: '1.0.0',
      } as never,
      reviewStatus: 'approved',
      submittedByUserId: PUBLISHER_USER_ID,
    }).returning();
    await expect(model.assignApplication({ appId: app.id, publisherId: publisher.id })).resolves.toMatchObject({
      publisherId: publisher.id,
    });
    await expect(
      serverDB.query.moduleAppPackages.findFirst({
        where: (rows, { eq }) => eq(rows.id, approvedPackage.id),
      }),
    ).resolves.toMatchObject({ publisherId: publisher.id });
    await expect(model.suspendPublisher({ publisherId: publisher.id })).resolves.toMatchObject({
      status: 'suspended',
    });
    await expect(model.assignApplication({ appId: app.id, publisherId: publisher.id })).rejects.toThrow(
      'MODULE_APP_PUBLISHER_NOT_VERIFIED',
    );
  });
});
