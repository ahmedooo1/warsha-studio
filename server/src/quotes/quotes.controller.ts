// Quotes. Issuing one is two steps, so the number can be printed on the PDF:
//  1. reserve: the server takes the next number of the year and freezes the quote: the saved design at its rev, the
//     workshop settings at their rev (prices, tax, identity, legal details, terms) and the lines and totals computed
//     by the editor. The design and settings must be the ones on the server, or the quote is refused (409): what the
//     PDF says always matches what is kept.
//  2. pdf: the editor sends the PDF it built with that number; it is kept with its SHA-256, once.
// After that nothing can change (database trigger). Accepting, cancelling or replacing a quote adds an event.
import {Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req, Res, BadRequestException, ConflictException, NotFoundException, Query} from '@nestjs/common';
import {IsIn, IsInt, IsObject, IsOptional, IsString, Matches, MaxLength, Min} from 'class-validator';
import {and, desc, eq, sql, lt} from 'drizzle-orm';
import type {Request, Response} from 'express';
import {DB, type Db} from '../db/client.js';
import {projects, projectVersions, quoteEvents, quotes, settings} from '../db/schema.js';
import {Audit} from '../common/audit.js';
import {CurrentUser, sha256, type AuthUser} from '../common/security.js';
import {PROJECT_ID} from '../sync/sync.controller.js';

class ReserveDto {
  @IsString() @Matches(PROJECT_ID) projectId: string;
  @IsInt() @Min(1) projectRev: number;
  @IsInt() @Min(0) settingsRev: number;
  @IsObject() figures: Record<string, unknown>;   // lines, subtotal, tax, total, deposit as the editor computed them
  @IsString() @MaxLength(12) currency: string;
  @IsString() @Matches(/^-?\d+(\.\d+)?$/) @MaxLength(24) total: string;
}
class EventDto {
  @IsIn(['accepted', 'cancelled', 'replaced']) type: 'accepted' | 'cancelled' | 'replaced';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsString() @MaxLength(40) replacedBy?: string;
}

export const quoteStatus = (events: Array<{type: string}>, hasPdf: boolean) => {
  const last = [...events].reverse().find(e => e.type !== 'sent');
  return last ? last.type : hasPdf ? 'sent' : 'reserved';
};
const listCols = {id: quotes.id, number: quotes.number, projectId: quotes.projectId, projectRev: quotes.projectRev, clientName: quotes.clientName, clientPhone: quotes.clientPhone,
  currency: quotes.currency, total: quotes.total, hasPdf: sql<boolean>`${quotes.pdf} IS NOT NULL`, pdfSha256: quotes.pdfSha256, createdAt: quotes.createdAt};

@Controller('api/quotes')
export class QuotesController {
  constructor(@Inject(DB) private db: Db, private audit: Audit) {}

  @Post('reserve') @HttpCode(200)
  async reserve(@CurrentUser() me: AuthUser, @Body() b: ReserveDto) {
    if (JSON.stringify(b.figures).length > 200_000) throw new BadRequestException('figures too large');
    const q = await this.db.transaction(async tx => {
      const [p] = await tx.select().from(projects).where(eq(projects.id, b.projectId));
      if (!p || p.deletedAt) throw new ConflictException({code: 'not_synced', message: 'save the design to the server first'});
      if (p.rev !== b.projectRev) throw new ConflictException({code: 'project_changed', message: 'the design on the server is not the one on screen', serverRev: p.rev});
      const [s] = await tx.select().from(settings).where(eq(settings.id, 1));
      if (s.rev !== b.settingsRev) throw new ConflictException({code: 'settings_changed', message: 'the workshop settings changed on another device', serverRev: s.rev});
      // numbers follow each other without a gap within a year; the lock keeps two devices from taking the same one
      await tx.execute(sql`LOCK TABLE quotes IN SHARE ROW EXCLUSIVE MODE`);
      const year = new Date().getFullYear();
      const [{m}] = await tx.select({m: sql<number>`coalesce(max(${quotes.seqNo}), 0)`}).from(quotes).where(eq(quotes.year, year));
      const seqNo = Number(m) + 1, pr = s.prices as Record<string, unknown>;
      const prefix = String(pr.quotePrefix || 'D').replace(/[^A-Za-z]/g, '').slice(0, 4) || 'D';
      const number = `${prefix}${year}-${String(seqNo).padStart(4, '0')}`;
      const snapshot = {
        format: 'warsha-quote', v: 1, number, issuedAt: new Date().toISOString(), issuedBy: {id: me.id, name: me.name},
        project: {id: p.id, rev: p.rev, name: p.name, phone: p.phone, note: p.note, variant: p.variant, cfg: p.cfg, thumb: p.thumb},
        settings: {rev: s.rev, prices: s.prices, fab: s.fab},
        figures: b.figures
      };
      const [row] = await tx.insert(quotes).values({number, year, seqNo, projectId: p.id, projectRev: p.rev, clientName: p.name, clientPhone: p.phone, currency: b.currency, total: b.total, snapshot, createdBy: me.id}).returning(listCols);
      // the design version the quote points to is never pruned from the history
      await tx.update(projectVersions).set({pinned: true}).where(and(eq(projectVersions.projectId, p.id), eq(projectVersions.rev, p.rev)));
      return row;
    });
    await this.audit.log(me.id, 'quote_reserved', 'quote', q.id, {number: q.number});
    return q;
  }

  // the PDF arrives as the raw body (application/pdf)
  @Put(':id/pdf')
  async pdf(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 100 || body.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BadRequestException('not a PDF');
    const digest = sha256(body);
    const [q] = await this.db.select({id: quotes.id, number: quotes.number, sha: quotes.pdfSha256}).from(quotes).where(eq(quotes.id, id));
    if (!q) throw new NotFoundException();
    if (q.sha) { if (q.sha === digest) return {ok: true, sha256: digest, again: true}; throw new ConflictException('this quote already has its PDF'); }
    await this.db.update(quotes).set({pdf: body, pdfSha256: digest}).where(eq(quotes.id, id));
    await this.db.insert(quoteEvents).values({quoteId: id, type: 'sent', data: {bytes: body.length}, userId: me.id});
    await this.audit.log(me.id, 'quote_issued', 'quote', id, {number: q.number, sha256: digest});
    return {ok: true, sha256: digest};
  }

  @Get()
  async list(@Query('projectId') projectId?: string, @Query('before') before?: string, @Query('limit') limit = '100') {
    const l = Math.min(500, Math.max(1, Number(limit) || 100));
    const w = [projectId ? eq(quotes.projectId, projectId) : undefined, before ? lt(quotes.createdAt, new Date(before)) : undefined].filter(Boolean);
    const rows = await this.db.select(listCols).from(quotes).where(w.length ? and(...w) : undefined).orderBy(desc(quotes.createdAt)).limit(l);
    const ev = rows.length ? await this.db.select({quoteId: quoteEvents.quoteId, type: quoteEvents.type, at: quoteEvents.at}).from(quoteEvents)
      .where(sql`${quoteEvents.quoteId} IN (${sql.join(rows.map(r => sql`${r.id}`), sql`, `)})`).orderBy(quoteEvents.at) : [];
    return rows.map(r => { const e = ev.filter(x => x.quoteId === r.id); return {...r, status: quoteStatus(e, r.hasPdf), events: e}; });
  }

  @Get(':id')
  async one(@Param('id', ParseUUIDPipe) id: string) {
    const [q] = await this.db.select({...listCols, snapshot: quotes.snapshot}).from(quotes).where(eq(quotes.id, id));
    if (!q) throw new NotFoundException();
    const events = await this.db.select().from(quoteEvents).where(eq(quoteEvents.quoteId, id)).orderBy(quoteEvents.at);
    return {...q, status: quoteStatus(events, q.hasPdf), events};
  }

  // the stored PDF, checked against its SHA-256 before it leaves
  @Get(':id/pdf')
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const [q] = await this.db.select({number: quotes.number, pdf: quotes.pdf, sha: quotes.pdfSha256}).from(quotes).where(eq(quotes.id, id));
    if (!q?.pdf) throw new NotFoundException();
    if (sha256(q.pdf) !== q.sha) throw new ConflictException('the stored PDF does not match its fingerprint');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${q.number}.pdf"`);
    res.setHeader('X-Content-SHA256', q.sha);
    res.send(q.pdf);
  }

  @Post(':id/events') @HttpCode(200)
  async event(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: EventDto) {
    const [q] = await this.db.select({id: quotes.id, number: quotes.number, hasPdf: listCols.hasPdf}).from(quotes).where(eq(quotes.id, id));
    if (!q) throw new NotFoundException();
    const events = await this.db.select({type: quoteEvents.type}).from(quoteEvents).where(eq(quoteEvents.quoteId, id)).orderBy(quoteEvents.at);
    const st = quoteStatus(events, q.hasPdf);
    if (st === 'reserved') throw new ConflictException('the quote has no PDF yet');
    if (st === 'cancelled' || st === 'replaced') throw new ConflictException(`the quote is already ${st}`);
    if (b.type === 'accepted' && st === 'accepted') throw new ConflictException('already accepted');
    await this.db.insert(quoteEvents).values({quoteId: id, type: b.type, data: {note: b.note ?? '', replacedBy: b.replacedBy ?? '', via: 'workshop'}, userId: me.id});
    await this.audit.log(me.id, 'quote_' + b.type, 'quote', id, {number: q.number});
    return {ok: true};
  }
}
