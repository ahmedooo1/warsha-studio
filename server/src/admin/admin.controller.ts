// Owner pages: backups, audit, the workshop's data rights tools (RGPD) and the full export.
//
// RGPD: the workshop is the controller of its clients' data; whoever runs the server is its processor.
//  - search: every design and quote that carries a name or phone number
//  - export: everything kept about that person, in one JSON file (right of access and portability)
//  - erase: designs, their history and their links are deleted at once. Designs a quote points to are kept: a quote is
//    a commercial document the workshop must keep (legal hold), so erasing it is refused and the answer says why.
//  - retention: a list of what has passed its keeping time, for the owner to decide. Nothing is deleted on its own.
import {Body, Controller, Get, HttpCode, Inject, Post, Query, Res, BadRequestException} from '@nestjs/common';
import {ArrayMaxSize, ArrayMinSize, IsArray, IsString, Matches, MaxLength} from 'class-validator';
import {and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql} from 'drizzle-orm';
import {readFile} from 'node:fs/promises';
import type {Response} from 'express';
import {DB, type Db} from '../db/client.js';
import {auditLog, projectVersions, projects, quoteEvents, quotes, settings, shareLinks, users} from '../db/schema.js';
import {CONFIG} from '../common/tokens.js';
import type {Config} from '../config.js';
import {Audit} from '../common/audit.js';
import {CurrentUser, Roles, type AuthUser} from '../common/security.js';
import {PROJECT_ID} from '../sync/sync.controller.js';
import {SETTINGS_ID, SyncService} from '../sync/sync.service.js';
import {csv, zip} from '../common/zip.js';

class IdsDto { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({each: true}) @Matches(PROJECT_ID, {each: true}) ids: string[]; }
class EraseDto extends IdsDto { @IsString() @MaxLength(40) confirm: string; }

const like = (q: string) => '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';
const YEAR = 365.25 * 864e5;

@Controller('api/admin')
@Roles('owner')
export class AdminController {
  constructor(@Inject(DB) private db: Db, @Inject(CONFIG) private cfg: Config, private audit: Audit, private sync: SyncService) {}

  // written by the backup job after each run and each restore test (see deploy/backup)
  @Get('backup-status')
  async backupStatus() {
    try {
      const s = JSON.parse(await readFile(this.cfg.backupStatusFile, 'utf8'));
      const age = s.lastBackupAt ? (Date.now() - new Date(s.lastBackupAt).getTime()) / 36e5 : null;
      return {...s, warn: age === null || age > 30 || s.lastBackupOk === false || s.lastRestoreTestOk === false};
    } catch { return {known: false, warn: true, message: 'no backup report found on the server'}; }
  }

  @Get('audit')
  async auditList(@Query('before') before?: string, @Query('limit') limit = '200') {
    const l = Math.min(1000, Math.max(1, Number(limit) || 200));
    return this.db.select({id: auditLog.id, at: auditLog.at, action: auditLog.action, entity: auditLog.entity, entityId: auditLog.entityId, meta: auditLog.meta, user: users.name})
      .from(auditLog).leftJoin(users, eq(users.id, auditLog.userId)).where(before ? lt(auditLog.at, new Date(before)) : undefined).orderBy(desc(auditLog.at)).limit(l);
  }

  @Get('people')
  async people(@Query('q') q = '') {
    const t = q.trim();
    if (t.length < 2) throw new BadRequestException('type at least two characters');
    const digits = t.replace(/\D/g, '');
    const designs = await this.db.select({id: projects.id, name: projects.name, phone: projects.phone, variant: projects.variant, deletedAt: projects.deletedAt, updatedAt: projects.updatedAt})
      .from(projects).where(or(ilike(projects.name, like(t)), ilike(projects.phone, like(t)), ilike(projects.note, like(t)), digits.length >= 4 ? sql`regexp_replace(${projects.phone}, '\\D', '', 'g') LIKE ${'%' + digits + '%'}` : undefined)).limit(200);
    const qs = await this.db.select({id: quotes.id, number: quotes.number, projectId: quotes.projectId, clientName: quotes.clientName, clientPhone: quotes.clientPhone, createdAt: quotes.createdAt})
      .from(quotes).where(or(ilike(quotes.clientName, like(t)), ilike(quotes.clientPhone, like(t)), digits.length >= 4 ? sql`regexp_replace(${quotes.clientPhone}, '\\D', '', 'g') LIKE ${'%' + digits + '%'}` : undefined)).limit(200);
    const held = new Set((await this.db.select({p: quotes.projectId}).from(quotes)).map(r => r.p));
    return {designs: designs.map(d => ({...d, legalHold: held.has(d.id)})), quotes: qs};
  }

  @Post('people/export') @HttpCode(200)
  async peopleExport(@CurrentUser() me: AuthUser, @Body() b: IdsDto, @Res() res: Response) {
    const ps = await this.db.select().from(projects).where(inArray(projects.id, b.ids));
    const vs = await this.db.select({projectId: projectVersions.projectId, rev: projectVersions.rev, kind: projectVersions.kind, createdAt: projectVersions.createdAt, data: projectVersions.data}).from(projectVersions).where(inArray(projectVersions.projectId, b.ids)).orderBy(asc(projectVersions.rev));
    const qs = await this.db.select({id: quotes.id, number: quotes.number, projectId: quotes.projectId, clientName: quotes.clientName, clientPhone: quotes.clientPhone, total: quotes.total, currency: quotes.currency, createdAt: quotes.createdAt}).from(quotes).where(inArray(quotes.projectId, b.ids));
    const ev = qs.length ? await this.db.select({quoteId: quoteEvents.quoteId, type: quoteEvents.type, at: quoteEvents.at, data: quoteEvents.data}).from(quoteEvents).where(inArray(quoteEvents.quoteId, qs.map(q => q.id))) : [];
    const links = await this.db.select({projectId: shareLinks.projectId, createdAt: shareLinks.createdAt, expiresAt: shareLinks.expiresAt, revokedAt: shareLinks.revokedAt, views: shareLinks.views}).from(shareLinks).where(inArray(shareLinks.projectId, b.ids));
    const out = {format: 'warsha-person-export', exportedAt: new Date().toISOString(), designs: ps.map(p => ({id: p.id, name: p.name, phone: p.phone, note: p.note, variant: p.variant, cfg: p.cfg, createdAt: p.createdAt, updatedAt: p.updatedAt, deletedAt: p.deletedAt})),
      history: vs, quotes: qs.map(q => ({...q, events: ev.filter(e => e.quoteId === q.id)})), links};
    await this.audit.log(me.id, 'person_exported', 'project', '', {count: ps.length});
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="person-export.json"');
    res.send(JSON.stringify(out, null, 1));
  }

  // erasing is final: the owner types ERASE to confirm. Backups still hold the data until they age out (see the
  // retention of backups in the documentation); the client is told so in the answer to the request.
  @Post('people/erase') @HttpCode(200)
  async erase(@CurrentUser() me: AuthUser, @Body() b: EraseDto) {
    if (b.confirm !== 'ERASE') throw new BadRequestException('type ERASE to confirm');
    const held = new Set((await this.db.select({p: quotes.projectId}).from(quotes).where(inArray(quotes.projectId, b.ids))).map(r => r.p));
    const free = b.ids.filter(id => !held.has(id));
    if (free.length) await this.db.transaction(async tx => {
      await tx.delete(shareLinks).where(inArray(shareLinks.projectId, free));
      await tx.delete(projectVersions).where(inArray(projectVersions.projectId, free));
      await tx.delete(projects).where(inArray(projects.id, free));
    });
    await this.audit.log(me.id, 'person_erased', 'project', '', {erased: free.length, held: held.size});
    return {erased: free, legalHold: [...held]};
  }

  @Get('retention')
  async retention(@Query('prospectYears') py = '3', @Query('clientYears') cy = '3') {
    const now = Date.now(), pY = Math.max(1, Number(py) || 3), cY = Math.max(1, Number(cy) || 3);
    const ps = await this.db.select({id: projects.id, name: projects.name, updatedAt: projects.updatedAt, deletedAt: projects.deletedAt}).from(projects);
    const lastQuote = new Map<string, number>();
    const qs = await this.db.select({p: quotes.projectId, at: sql<Date>`max(greatest(${quotes.createdAt}, coalesce((SELECT max(at) FROM quote_events e WHERE e.quote_id = ${quotes.id}), ${quotes.createdAt})))`}).from(quotes).groupBy(quotes.projectId);
    for (const q of qs) lastQuote.set(q.p, new Date(q.at).getTime());
    const prospects = ps.filter(p => !lastQuote.has(p.id) && now - p.updatedAt.getTime() > pY * YEAR);
    const clients = ps.filter(p => lastQuote.has(p.id) && now - lastQuote.get(p.id)! > cY * YEAR);
    const [{n: oldQuotes}] = await this.db.select({n: sql<number>`count(*)::int`}).from(quotes).where(lt(quotes.createdAt, new Date(now - 10 * YEAR)));
    return {
      rules: {prospectYears: pY, clientYears: cY, quotesYears: 10},
      prospects: prospects.map(p => ({id: p.id, name: p.name, lastActivity: p.updatedAt})),
      // designs with a quote stay while the quote must be kept; past that, they go with the quote (maintenance procedure)
      clientsPastKeeping: clients.map(p => ({id: p.id, name: p.name, lastActivity: new Date(lastQuote.get(p.id)!), legalHold: true})),
      quotesPastTenYears: oldQuotes,
      trashPurgedAfterDays: this.cfg.trashDays
    };
  }

  @Post('trash/purge') @HttpCode(200)
  async purge(@CurrentUser() me: AuthUser) {
    const n = await this.sync.purgeTrash();
    await this.audit.log(me.id, 'trash_purged', 'project', '', {count: n});
    return {purged: n};
  }

  // Everything the workshop owns, in one ZIP: the backup file the editor itself imports (designs, prices, identity,
  // fabrication settings), every quote PDF with its frozen record, the history, the links, the audit, and CSV copies.
  @Get('export')
  async exportAll(@CurrentUser() me: AuthUser, @Res() res: Response) {
    const ps = await this.db.select().from(projects).where(isNull(projects.deletedAt)).orderBy(desc(projects.updatedAt));
    const trash = await this.db.select().from(projects).where(sql`${projects.deletedAt} IS NOT NULL`);
    const [s] = await this.db.select().from(settings).where(eq(settings.id, 1));
    const qs = await this.db.select().from(quotes).orderBy(asc(quotes.year), asc(quotes.seqNo));
    const ev = await this.db.select().from(quoteEvents).orderBy(asc(quoteEvents.at));
    const vs = await this.db.select().from(projectVersions).orderBy(asc(projectVersions.projectId), asc(projectVersions.rev));
    const links = await this.db.select({id: shareLinks.id, projectId: shareLinks.projectId, quoteId: shareLinks.quoteId, createdAt: shareLinks.createdAt, expiresAt: shareLinks.expiresAt, revokedAt: shareLinks.revokedAt, views: shareLinks.views}).from(shareLinks);
    const au = await this.db.select().from(auditLog).orderBy(asc(auditLog.at));
    const us = await this.db.select({id: users.id, email: users.email, name: users.name, role: users.role, active: users.active, createdAt: users.createdAt}).from(users);
    const wire = (p: typeof projects.$inferSelect) => ({id: p.id, name: p.name, phone: p.phone, note: p.note, ...(p.variant ? {variant: p.variant} : {}), cfg: p.cfg, thumb: p.thumb, updatedAt: p.clientUpdatedAt || p.updatedAt.getTime()});
    const date = new Date().toISOString().slice(0, 10);
    const backup = {app: 'warsha-studio', v: 1, kind: 'backup', exportedAt: new Date().toISOString(), projects: ps.map(wire), prices: s.prices, fab: s.fab};
    const files: Array<{name: string; data: Buffer | string}> = [
      {name: 'LISEZ-MOI.txt', data: README(date, ps.length, qs.length)},
      {name: 'warsha-backup.json', data: JSON.stringify(backup)},
      {name: 'corbeille.json', data: JSON.stringify({app: 'warsha-studio', v: 1, kind: 'backup', projects: trash.map(wire)})},
      {name: 'historique-projets.json', data: JSON.stringify(vs.filter(v => v.projectId !== SETTINGS_ID))},
      {name: 'historique-parametres.json', data: JSON.stringify(vs.filter(v => v.projectId === SETTINGS_ID))},
      {name: 'devis.csv', data: csv(qs.map(q => ({...q, status: undefined})), ['number', 'createdAt', 'clientName', 'clientPhone', 'currency', 'total', 'projectId', 'projectRev', 'pdfSha256'])},
      {name: 'devis-evenements.csv', data: csv(ev.map(e => ({...e, number: qs.find(q => q.id === e.quoteId)?.number})), ['number', 'at', 'type', 'data'])},
      {name: 'clients.csv', data: csv(ps.map(p => ({...p})), ['id', 'name', 'variant', 'phone', 'note', 'createdAt', 'updatedAt'])},
      {name: 'liens-clients.csv', data: csv(links, ['id', 'projectId', 'quoteId', 'createdAt', 'expiresAt', 'revokedAt', 'views'])},
      {name: 'journal.csv', data: csv(au, ['at', 'userId', 'action', 'entity', 'entityId', 'meta'])},
      {name: 'utilisateurs.csv', data: csv(us, ['id', 'email', 'name', 'role', 'active', 'createdAt'])}
    ];
    for (const q of qs) {
      files.push({name: `devis/${q.number}.json`, data: JSON.stringify({number: q.number, createdAt: q.createdAt, pdfSha256: q.pdfSha256, events: ev.filter(e => e.quoteId === q.id), snapshot: q.snapshot})});
      if (q.pdf) files.push({name: `devis/${q.number}.pdf`, data: q.pdf});
    }
    const body = zip(files);
    await this.audit.log(me.id, 'full_export', 'workshop', '', {designs: ps.length, quotes: qs.length, bytes: body.length});
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="warsha-export-${date}.zip"`);
    res.send(body);
  }
}

const README = (date: string, nd: number, nq: number) => `Warsha Studio, export complet de l'atelier (${date})
${nd} projets, ${nq} devis.

warsha-backup.json       Tous les projets, les prix, l'identite de l'atelier et les reglages de fabrication.
                         C'est le format "nouvelle sauvegarde complete" de l'editeur : dans la version autonome,
                         ouvrir Clients > Importer un fichier et choisir ce fichier.
corbeille.json           Les projets supprimes encore dans la corbeille (meme format).
devis/NUMERO.pdf         Chaque devis tel qu'il a ete envoye. Son empreinte SHA-256 est dans devis.csv et devis/NUMERO.json.
devis/NUMERO.json        Le devis fige : projet, prix, taxes, identite et mentions au moment de l'emission, et ses evenements.
historique-*.json        Toutes les versions gardees des projets et des parametres.
*.csv                    Les memes donnees pour un tableur (separateur point-virgule).

Verifier un PDF : sha256sum devis/NUMERO.pdf doit donner la valeur de devis.csv.
`;
