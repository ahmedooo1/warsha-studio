// Client links: read only, limited in time, revocable, optional PIN. Only the SHA-256 of the token is stored.
// A link to a quote shows the design frozen in that quote; a link without a quote shows the design as it is saved now.
// The client sees the design, the workshop's identity and, for a quote, its PDF and total. Never the phone or the
// workshop's notes, never the cut lists or the prices per board.
import {Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Res, BadRequestException, ConflictException, ForbiddenException, GoneException, NotFoundException} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import {IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min} from 'class-validator';
import {hash, verify} from '@node-rs/argon2';
import {and, desc, eq, sql} from 'drizzle-orm';
import type {Response} from 'express';
import {DB, type Db} from '../db/client.js';
import {projects, quoteEvents, quotes, settings, shareLinks} from '../db/schema.js';
import {CONFIG} from '../common/tokens.js';
import type {Config} from '../config.js';
import {Audit} from '../common/audit.js';
import {CurrentUser, Public, randomToken, sha256, type AuthUser} from '../common/security.js';
import {PROJECT_ID} from '../sync/sync.controller.js';
import {quoteStatus} from '../quotes/quotes.controller.js';

const MAX_PIN_FAILS = 5;
const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;

class CreateDto {
  @IsString() @Matches(PROJECT_ID) projectId: string;
  @IsOptional() @IsUUID() quoteId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(366) days?: number;
  @IsOptional() @IsString() @Matches(/^\d{4,8}$/) pin?: string;
}
class OpenDto { @IsOptional() @IsString() @MaxLength(8) pin?: string; }
class AcceptDto { @IsOptional() @IsString() @MaxLength(8) pin?: string; @IsString() @MaxLength(80) name: string; }

// the identity the client may see, from the workshop settings
const shopOf = (prices: Record<string, unknown>) => {
  const k = ['shop', 'shopPhone', 'shopAddr', 'shopEmail', 'shopLegal', 'brand', 'shopLogo', 'cur'];
  return Object.fromEntries(k.filter(x => typeof prices[x] === 'string' && prices[x]).map(x => [x, prices[x]]));
};

@Controller('api/share')
export class ShareController {
  constructor(@Inject(DB) private db: Db, @Inject(CONFIG) private cfg: Config, private audit: Audit) {}

  @Post() @HttpCode(200)
  async create(@CurrentUser() me: AuthUser, @Body() b: CreateDto) {
    const [p] = await this.db.select({id: projects.id, deletedAt: projects.deletedAt}).from(projects).where(eq(projects.id, b.projectId));
    if (!p || p.deletedAt) throw new ConflictException({code: 'not_synced', message: 'save the design to the server first'});
    if (b.quoteId) {
      const [q] = await this.db.select({projectId: quotes.projectId, sha: quotes.pdfSha256}).from(quotes).where(eq(quotes.id, b.quoteId));
      if (!q || q.projectId !== b.projectId) throw new BadRequestException('the quote is not for this design');
      if (!q.sha) throw new ConflictException('the quote has no PDF yet');
    }
    const days = Math.min(b.days ?? this.cfg.shareDefaultDays, this.cfg.shareMaxDays);
    const token = randomToken(32);
    const [l] = await this.db.insert(shareLinks).values({tokenHash: sha256(token), projectId: b.projectId, quoteId: b.quoteId ?? null, pinHash: b.pin ? await hash(b.pin) : null,
      expiresAt: new Date(Date.now() + days * 864e5), createdBy: me.id}).returning({id: shareLinks.id, expiresAt: shareLinks.expiresAt});
    await this.audit.log(me.id, 'link_created', 'share', l.id, {days, pin: !!b.pin, quote: !!b.quoteId});
    // the token is shown once; the server cannot show it again
    return {id: l.id, url: `${this.cfg.publicUrl}/v/${token}`, expiresAt: l.expiresAt};
  }

  @Get()
  async list(@Query('projectId') projectId?: string) {
    const rows = await this.db.select({id: shareLinks.id, projectId: shareLinks.projectId, quoteId: shareLinks.quoteId, name: projects.name, pin: sql<boolean>`${shareLinks.pinHash} IS NOT NULL`,
      expiresAt: shareLinks.expiresAt, revokedAt: shareLinks.revokedAt, views: shareLinks.views, lastViewAt: shareLinks.lastViewAt, createdAt: shareLinks.createdAt, failedPins: shareLinks.failedPins})
      .from(shareLinks).leftJoin(projects, eq(projects.id, shareLinks.projectId)).where(projectId ? eq(shareLinks.projectId, projectId) : undefined).orderBy(desc(shareLinks.createdAt)).limit(500);
    const now = Date.now();
    return rows.map(r => ({...r, state: r.revokedAt ? 'revoked' : r.failedPins >= MAX_PIN_FAILS ? 'locked' : r.expiresAt.getTime() < now ? 'expired' : 'active'}));
  }

  @Post(':id/revoke') @HttpCode(200)
  async revoke(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.db.update(shareLinks).set({revokedAt: new Date()}).where(and(eq(shareLinks.id, id), sql`${shareLinks.revokedAt} IS NULL`)).returning({id: shareLinks.id});
    if (!r.length) throw new NotFoundException();
    await this.audit.log(me.id, 'link_revoked', 'share', id);
    return {ok: true};
  }
}

@Controller('api/public/share')
export class PublicShareController {
  constructor(@Inject(DB) private db: Db, private audit: Audit) {}

  // every answer for a link that cannot be opened is the same, so a guessed token learns nothing
  private async link(token: string, pin: string | undefined) {
    if (!TOKEN.test(token)) throw new NotFoundException('link not found');
    const [l] = await this.db.select().from(shareLinks).where(eq(shareLinks.tokenHash, sha256(token)));
    if (!l) throw new NotFoundException('link not found');
    if (l.revokedAt || l.expiresAt < new Date()) throw new GoneException('this link has ended');
    if (l.failedPins >= MAX_PIN_FAILS) throw new GoneException('this link is locked, ask the workshop for a new one');
    if (l.pinHash) {
      if (!pin) return {l, pinRequired: true as const};
      if (!(await verify(l.pinHash, pin).catch(() => false))) {
        await this.db.update(shareLinks).set({failedPins: sql`${shareLinks.failedPins} + 1`}).where(eq(shareLinks.id, l.id));
        throw new ForbiddenException('wrong code');
      }
      if (l.failedPins) await this.db.update(shareLinks).set({failedPins: 0}).where(eq(shareLinks.id, l.id));
    }
    return {l, pinRequired: false as const};
  }

  @Public() @Throttle({default: {limit: 30, ttl: 60_000}}) @Post(':token') @HttpCode(200)
  async open(@Param('token') token: string, @Body() b: OpenDto) {
    const {l, pinRequired} = await this.link(token, b.pin);
    if (pinRequired) return {pinRequired: true};
    const [s] = await this.db.select({prices: settings.prices}).from(settings).where(eq(settings.id, 1));
    let design: Record<string, unknown>, quote: Record<string, unknown> | null = null, shop = shopOf(s.prices as Record<string, unknown>);
    if (l.quoteId) {
      const [q] = await this.db.select({id: quotes.id, number: quotes.number, currency: quotes.currency, total: quotes.total, snapshot: quotes.snapshot, createdAt: quotes.createdAt}).from(quotes).where(eq(quotes.id, l.quoteId));
      const snap = q.snapshot as {project: Record<string, unknown>; settings: {prices: Record<string, unknown>}};
      const events = await this.db.select({type: quoteEvents.type, at: quoteEvents.at}).from(quoteEvents).where(eq(quoteEvents.quoteId, q.id)).orderBy(quoteEvents.at);
      design = snap.project; shop = shopOf(snap.settings.prices);
      quote = {number: q.number, currency: q.currency, total: q.total, issuedAt: q.createdAt, status: quoteStatus(events, true)};
    } else {
      const [p] = await this.db.select().from(projects).where(eq(projects.id, l.projectId));
      if (!p || p.deletedAt) throw new GoneException('this link has ended');
      design = {name: p.name, variant: p.variant, cfg: p.cfg, thumb: p.thumb};
    }
    await this.db.update(shareLinks).set({views: sql`${shareLinks.views} + 1`, lastViewAt: new Date()}).where(eq(shareLinks.id, l.id));
    return {pinRequired: false, expiresAt: l.expiresAt, shop, quote, design: {name: design.name, variant: design.variant ?? null, cfg: design.cfg}};
  }

  @Public() @Throttle({default: {limit: 20, ttl: 60_000}}) @Post(':token/pdf') @HttpCode(200)
  async pdf(@Param('token') token: string, @Body() b: OpenDto, @Res() res: Response) {
    const {l, pinRequired} = await this.link(token, b.pin);
    if (pinRequired) throw new ForbiddenException('code required');
    if (!l.quoteId) throw new NotFoundException();
    const [q] = await this.db.select({number: quotes.number, pdf: quotes.pdf, sha: quotes.pdfSha256}).from(quotes).where(eq(quotes.id, l.quoteId));
    if (!q?.pdf || sha256(q.pdf) !== q.sha) throw new NotFoundException();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${q.number}.pdf"`);
    res.send(q.pdf);
  }

  // the client accepts the quote from the link: one event with the name typed and the time
  @Public() @Throttle({default: {limit: 5, ttl: 60_000}}) @Post(':token/accept') @HttpCode(200)
  async accept(@Param('token') token: string, @Body() b: AcceptDto) {
    const {l, pinRequired} = await this.link(token, b.pin);
    if (pinRequired) throw new ForbiddenException('code required');
    if (!l.quoteId) throw new BadRequestException('this link has no quote');
    const name = b.name.trim();
    if (name.length < 2) throw new BadRequestException('name required');
    const events = await this.db.select({type: quoteEvents.type}).from(quoteEvents).where(eq(quoteEvents.quoteId, l.quoteId)).orderBy(quoteEvents.at);
    const st = quoteStatus(events, true);
    if (st !== 'sent') throw new ConflictException(st === 'accepted' ? 'already accepted' : 'this quote can no longer be accepted');
    await this.db.insert(quoteEvents).values({quoteId: l.quoteId, type: 'accepted', data: {via: 'link', link: l.id, name}});
    await this.audit.log(null, 'quote_accepted_by_client', 'quote', l.quoteId, {link: l.id});
    return {ok: true};
  }
}
