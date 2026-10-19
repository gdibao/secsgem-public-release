import { and, eq, like, sql } from 'drizzle-orm';

import { appSettings } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

export const ENGINEERING_TOOL_PREFIX = 'engineeringTools.item.';
export const ENGINEERING_MENU_KEY = 'engineeringTools.menu';
export const ENGINEERING_FACET_VOCABULARY_KEY = 'engineeringTools.facetVocabulary';
export const ENGINEERING_FACET_BATCH_PREFIX = 'engineeringTools.facetBatch.';

type ToolDatabase = LobeChatDatabase | Transaction;

export class EngineeringToolsModel {
  constructor(private readonly db: ToolDatabase) {}

  async list() {
    return this.db.query.appSettings.findMany({
      where: like(appSettings.key, `${ENGINEERING_TOOL_PREFIX}%`),
    });
  }

  async get(id: string) {
    return this.db.query.appSettings.findFirst({
      where: eq(appSettings.key, `${ENGINEERING_TOOL_PREFIX}${id}`),
    });
  }

  async getForUpdate(id: string) {
    const rows = await this.db.select().from(appSettings)
      .where(eq(appSettings.key, `${ENGINEERING_TOOL_PREFIX}${id}`)).for('update');
    return rows[0];
  }

  async getMenu() {
    return this.db.query.appSettings.findFirst({ where: eq(appSettings.key, ENGINEERING_MENU_KEY) });
  }

  async getMenuForUpdate() {
    const rows = await this.db.select().from(appSettings)
      .where(eq(appSettings.key, ENGINEERING_MENU_KEY)).for('update');
    return rows[0];
  }

  async getFacetVocabulary() {
    return this.db.query.appSettings.findFirst({ where: eq(appSettings.key, ENGINEERING_FACET_VOCABULARY_KEY) });
  }

  async getFacetVocabularyForUpdate() {
    const rows = await this.db.select().from(appSettings)
      .where(eq(appSettings.key, ENGINEERING_FACET_VOCABULARY_KEY)).for('update');
    return rows[0];
  }

  async getFacetBatchForUpdate(batchId: string) {
    const rows = await this.db.select().from(appSettings)
      .where(eq(appSettings.key, `${ENGINEERING_FACET_BATCH_PREFIX}${batchId}`)).for('update');
    return rows[0];
  }

  async save(id: string, value: unknown) {
    await this.db
      .insert(appSettings)
      .values({ key: `${ENGINEERING_TOOL_PREFIX}${id}`, value })
      .onConflictDoUpdate({
        set: { updatedAt: new Date(), value },
        target: appSettings.key,
      });
  }

  async insertIfMissing(id: string, value: unknown) {
    return this.db
      .insert(appSettings)
      .values({ key: `${ENGINEERING_TOOL_PREFIX}${id}`, value })
      .onConflictDoNothing({ target: appSettings.key })
      .returning({ key: appSettings.key });
  }

  async saveMenu(value: unknown) {
    await this.db
      .insert(appSettings)
      .values({ key: ENGINEERING_MENU_KEY, value })
      .onConflictDoUpdate({
        set: { updatedAt: new Date(), value },
        target: appSettings.key,
      });
  }

  async insertMenuIfMissing(value: unknown) {
    return this.db
      .insert(appSettings)
      .values({ key: ENGINEERING_MENU_KEY, value })
      .onConflictDoNothing({ target: appSettings.key })
      .returning({ key: appSettings.key });
  }

  async saveFacetVocabulary(value: unknown) {
    await this.db
      .insert(appSettings)
      .values({ key: ENGINEERING_FACET_VOCABULARY_KEY, value })
      .onConflictDoUpdate({
        set: { updatedAt: new Date(), value },
        target: appSettings.key,
      });
  }

  async insertFacetVocabularyIfMissing(value: unknown) {
    return this.db
      .insert(appSettings)
      .values({ key: ENGINEERING_FACET_VOCABULARY_KEY, value })
      .onConflictDoNothing({ target: appSettings.key })
      .returning({ key: appSettings.key });
  }

  async insertFacetBatchIfMissing(batchId: string, value: unknown) {
    return this.db.insert(appSettings)
      .values({ key: `${ENGINEERING_FACET_BATCH_PREFIX}${batchId}`, value })
      .onConflictDoNothing({ target: appSettings.key })
      .returning({ key: appSettings.key });
  }

  async saveFacetBatch(batchId: string, value: unknown) {
    await this.db.update(appSettings).set({ updatedAt: new Date(), value })
      .where(eq(appSettings.key, `${ENGINEERING_FACET_BATCH_PREFIX}${batchId}`));
  }

  async removeFacetVocabulary() {
    return this.db.delete(appSettings)
      .where(eq(appSettings.key, ENGINEERING_FACET_VOCABULARY_KEY))
      .returning({ key: appSettings.key });
  }

  async remove(id: string) {
    return this.db
      .delete(appSettings)
      .where(eq(appSettings.key, `${ENGINEERING_TOOL_PREFIX}${id}`))
      .returning({ key: appSettings.key });
  }

  async removeImported(batchId: string) {
    return this.db
      .delete(appSettings)
      .where(
        and(
          like(appSettings.key, `${ENGINEERING_TOOL_PREFIX}%`),
          sql`${appSettings.value}->>'importBatchId' = ${batchId}`,
        ),
      )
      .returning({ key: appSettings.key });
  }

  async removeImportedMenu(batchId: string) {
    return this.db
      .delete(appSettings)
      .where(
        and(
          eq(appSettings.key, ENGINEERING_MENU_KEY),
          sql`${appSettings.value}->>'importBatchId' = ${batchId}`,
        ),
      )
      .returning({ key: appSettings.key });
  }
}
