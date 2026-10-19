import { createHash } from 'node:crypto';

import { and, eq, like, sql } from 'drizzle-orm';

import { appSettings } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

type Database = LobeChatDatabase | Transaction;
type Family = 'endpoint' | 'panel' | 'personal' | 'rating' | 'shared' | 'submission';

const root = 'engineeringWorkspace.';
const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

export class EngineeringToolsWorkspaceModel {
  constructor(private readonly db: Database) {}

  prefix(family: Family, owner: string) {
    return `${root}${family}.${digest(owner)}.`;
  }

  key(family: Family, owner: string, id: string) {
    return `${this.prefix(family, owner)}${id}`;
  }

  list(family: Family, owner: string) {
    return this.db.query.appSettings.findMany({ where: like(appSettings.key, `${this.prefix(family, owner)}%`) });
  }

  get(family: Family, owner: string, id: string) {
    return this.db.query.appSettings.findFirst({ where: eq(appSettings.key, this.key(family, owner, id)) });
  }

  async create(family: Family, owner: string, id: string, value: unknown) {
    const rows = await this.db.insert(appSettings).values({ key: this.key(family, owner, id), value })
      .onConflictDoNothing({ target: appSettings.key }).returning({ key: appSettings.key });
    return rows.length === 1;
  }

  async replace(family: Family, owner: string, id: string, expectedVersion: number, value: unknown) {
    const rows = await this.db.update(appSettings).set({ updatedAt: new Date(), value })
      .where(and(eq(appSettings.key, this.key(family, owner, id)), sql`(${appSettings.value}->>'version')::integer = ${expectedVersion}`))
      .returning({ key: appSettings.key });
    return rows.length === 1;
  }

  async remove(family: Family, owner: string, id: string, expectedVersion: number) {
    const rows = await this.db.delete(appSettings)
      .where(and(eq(appSettings.key, this.key(family, owner, id)), sql`(${appSettings.value}->>'version')::integer = ${expectedVersion}`))
      .returning({ key: appSettings.key });
    return rows.length === 1;
  }
}
