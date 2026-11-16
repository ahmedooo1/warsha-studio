// Two way sync between the devices of the workshop and the server.
//
// Every project and the settings document carry a rev. A device sends "save this over rev n" with a unique change id.
//  - rev on the server is n: accepted, rev n+1, the previous state stays in the history.
//  - the same change id again (lost answer, retry): the first result is returned, nothing is applied twice.
//  - rev on the server is not n (another device saved first): refused with the server's copy (409). The device keeps
//    both; nothing is ever written over a change it has not seen.
// Every accepted change takes the next number of one global sequence; a device asks "what changed since n".
import {ConflictException, Inject, Injectable, NotFoundException, BadRequestException} from '@nestjs/common';
import {and, asc, desc, eq, gt, isNotNull, lt, notInArray, sql} from 'drizzle-orm';
import {DB, type Db} from '../db/client.js';
import {projects, projectVersions, settings, users, quotes} from '../db/schema.js';
import {CONFIG} from '../common/tokens.js';
import type {Config} from '../config.js';

export const SETTINGS_ID = '__settings__';
export interface ProjectData { name: string; phone: string; note: string; variant?: string | null; cfg: Record<string, unknown>; thumb: string; updatedAt: number }
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const row2data = (p: typeof projects.$inferSelect): ProjectData => ({name: p.name, phone: p.phone, note: p.note, variant: p.variant, cfg: p.cfg as Record<string, unknown>, thumb: p.thumb, updatedAt: p.clientUpdatedAt});
export const row2wire = (p: typeof projects.$inferSelect) => ({id: p.id, rev: p.rev, seq: p.seq, deleted: !!p.deletedAt, deletedAt: p.deletedAt, ...row2data(p), device: p.device, serverUpdatedAt: p.updatedAt});

@Injectable()
export class SyncService {
  constructor(@Inject(DB) private db: Db, @Inject(CONFIG) private cfg: Config) {}

  private nextSeq = async (tx: Tx) => Number((await tx.execute<{n: string}>(sql`SELECT nextval('change_seq') AS n`)).rows[0].n);

  // a change already applied (same change id) gives back its result instead of applying it again
  private async replay(tx: Tx, changeId: string) {
    const [v] = await tx.select({rev: projectVersions.rev, projectId: projectVersions.projectId}).from(projectVersions).where(eq(projectVersions.changeId, changeId));
    return v ? {ok: true as const, rev: v.rev, replayed: true} : null;
  }

  private async keepHistory(tx: Tx, projectId: string, rev: number, kind: string, changeId: string, data: unknown, userId: string, device: string) {
    await tx.insert(projectVersions).values({projectId, rev, kind, changeId, data, userId, device});
    // only the last KEEP_VERSIONS of a project stay, except versions a quote points to (pinned)
    await tx.execute(sql`DELETE FROM project_versions WHERE project_id = ${projectId} AND pinned = false AND id NOT IN (
      SELECT id FROM project_versions WHERE project_id = ${projectId} ORDER BY rev DESC, created_at DESC LIMIT ${this.cfg.keepVersions})`);
  }

  async changes(since: number, limit: number) {
    const rows = await this.db.select().from(projects).where(gt(projects.seq, since)).orderBy(asc(projects.seq)).limit(limit + 1);
    const more = rows.length > limit, list = rows.slice(0, limit);
    const [s] = await this.db.select().from(settings).where(eq(settings.id, 1));
    let cursor = list.length ? list[list.length - 1].seq : since;
    // settings travel with the feed when they changed after "since" and, if the page is cut, not after its end
    const withSettings = s.seq > since && (!more || s.seq <= cursor);
    if (withSettings && !more) cursor = Math.max(cursor, s.seq);
    return {projects: list.map(row2wire), settings: withSettings ? {rev: s.rev, prices: s.prices, fab: s.fab} : null, cursor, more};
  }

  async put(id: string, baseRev: number, changeId: string, data: ProjectData, userId: string, device: string) {
    return this.db.transaction(async tx => {
      const again = await this.replay(tx, changeId); if (again) return again;
      const [cur] = await tx.select().from(projects).where(eq(projects.id, id)).for('update');
      const curRev = cur?.rev ?? 0;
      if (curRev !== baseRev) throw new ConflictException({conflict: true, server: cur ? row2wire(cur) : null});
      const rev = curRev + 1, seq = await this.nextSeq(tx);
      const vals = {rev, seq, name: data.name, phone: data.phone, note: data.note, variant: data.variant ?? null, cfg: data.cfg, thumb: data.thumb, clientUpdatedAt: data.updatedAt, deletedAt: null, updatedBy: userId, device, updatedAt: new Date()};
      if (cur) await tx.update(projects).set(vals).where(eq(projects.id, id));
      else await tx.insert(projects).values({id, ...vals});
      await this.keepHistory(tx, id, rev, cur?.deletedAt ? 'restore' : 'save', changeId, data, userId, device);
      return {ok: true as const, rev, seq};
    });
  }

  // deleting keeps the project in the trash (TRASH_DAYS) with its history; a later save on another device brings it back
  async remove(id: string, baseRev: number, changeId: string, userId: string, device: string) {
    return this.db.transaction(async tx => {
      const again = await this.replay(tx, changeId); if (again) return again;
      const [cur] = await tx.select().from(projects).where(eq(projects.id, id)).for('update');
      if (!cur) throw new NotFoundException();
      if (cur.rev !== baseRev) throw new ConflictException({conflict: true, server: row2wire(cur)});
      if (cur.deletedAt) return {ok: true as const, rev: cur.rev};
      const rev = cur.rev + 1, seq = await this.nextSeq(tx);
      await tx.update(projects).set({rev, seq, deletedAt: new Date(), updatedBy: userId, device, updatedAt: new Date()}).where(eq(projects.id, id));
      await this.keepHistory(tx, id, rev, 'delete', changeId, row2data(cur), userId, device);
      return {ok: true as const, rev, seq};
    });
  }

  async versions(id: string) {
    return this.db.select({id: projectVersions.id, rev: projectVersions.rev, kind: projectVersions.kind, device: projectVersions.device, pinned: projectVersions.pinned, createdAt: projectVersions.createdAt, user: users.name})
      .from(projectVersions).leftJoin(users, eq(users.id, projectVersions.userId)).where(eq(projectVersions.projectId, id)).orderBy(desc(projectVersions.rev), desc(projectVersions.createdAt));
  }
  async version(id: string, vid: string) {
    const [v] = await this.db.select().from(projectVersions).where(and(eq(projectVersions.projectId, id), eq(projectVersions.id, vid)));
    if (!v) throw new NotFoundException();
    return v;
  }

  // going back to a version makes a new version with its content: the history only grows
  async restore(id: string, vid: string, changeId: string, userId: string, device: string) {
    const v = await this.version(id, vid);
    if (id === SETTINGS_ID) throw new BadRequestException('use the settings history');
    return this.db.transaction(async tx => {
      const again = await this.replay(tx, changeId); if (again) return again;
      const [cur] = await tx.select().from(projects).where(eq(projects.id, id)).for('update');
      const d = v.data as ProjectData, rev = (cur?.rev ?? 0) + 1, seq = await this.nextSeq(tx);
      const vals = {rev, seq, name: d.name, phone: d.phone, note: d.note, variant: d.variant ?? null, cfg: d.cfg, thumb: d.thumb, clientUpdatedAt: Date.now(), deletedAt: null, updatedBy: userId, device, updatedAt: new Date()};
      if (cur) await tx.update(projects).set(vals).where(eq(projects.id, id)); else await tx.insert(projects).values({id, ...vals});
      await this.keepHistory(tx, id, rev, 'restore', changeId, {...d, updatedAt: vals.clientUpdatedAt}, userId, device);
      return {ok: true as const, rev, seq};
    });
  }

  async trash() {
    return this.db.select({id: projects.id, name: projects.name, variant: projects.variant, rev: projects.rev, deletedAt: projects.deletedAt, thumb: projects.thumb})
      .from(projects).where(isNotNull(projects.deletedAt)).orderBy(desc(projects.deletedAt));
  }

  async putSettings(baseRev: number, changeId: string, prices: Record<string, unknown>, fab: Record<string, unknown>, userId: string, device: string) {
    return this.db.transaction(async tx => {
      const again = await this.replay(tx, changeId); if (again) return again;
      const [cur] = await tx.select().from(settings).where(eq(settings.id, 1)).for('update');
      if (cur.rev !== baseRev) throw new ConflictException({conflict: true, server: {rev: cur.rev, prices: cur.prices, fab: cur.fab}});
      const rev = cur.rev + 1, seq = await this.nextSeq(tx);
      await tx.update(settings).set({rev, seq, prices, fab, updatedBy: userId, updatedAt: new Date()}).where(eq(settings.id, 1));
      await this.keepHistory(tx, SETTINGS_ID, rev, 'settings', changeId, {prices, fab}, userId, device);
      return {ok: true as const, rev, seq};
    });
  }

  // the trash is emptied after TRASH_DAYS; projects a quote points to are never purged (their quote must stay readable)
  async purgeTrash(): Promise<number> {
    const before = new Date(Date.now() - this.cfg.trashDays * 864e5);
    const held = this.db.select({p: quotes.projectId}).from(quotes);
    const gone = await this.db.delete(projects).where(and(isNotNull(projects.deletedAt), lt(projects.deletedAt, before), notInArray(projects.id, held))).returning({id: projects.id});
    for (const g of gone) await this.db.delete(projectVersions).where(and(eq(projectVersions.projectId, g.id), eq(projectVersions.pinned, false)));
    return gone.length;
  }
}
