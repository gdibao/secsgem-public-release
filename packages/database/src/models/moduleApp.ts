import type { LobeChatDatabase } from '../type';
import { ModuleAppAuditModel } from './moduleAppAudit';

export class ModuleAppModel extends ModuleAppAuditModel {
  constructor(db: LobeChatDatabase) {
    super(db);
  }
}
