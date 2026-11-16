// Who did what and when. Never personal data in it (ids and actions only), so it can stay append only.
import {Inject, Injectable} from '@nestjs/common';
import {DB, type Db} from '../db/client.js';
import {auditLog} from '../db/schema.js';

@Injectable()
export class Audit {
  constructor(@Inject(DB) private db: Db) {}
  async log(userId: string | null, action: string, entity = '', entityId = '', meta: Record<string, unknown> = {}): Promise<void> {
    await this.db.insert(auditLog).values({userId, action, entity, entityId, meta});
  }
}
