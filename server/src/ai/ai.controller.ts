// Optional design assistant. Off unless AI_ENABLED=true and an ANTHROPIC_API_KEY are set on the server: the workshop
// decides, and pays its own API use. Daily and monthly call limits keep the bill predictable. The key never leaves the
// server. Only the text of the request (and an image the user attaches) is sent; never the client list.
import {Body, Controller, Get, HttpCode, Inject, Post, NotFoundException, BadGatewayException, HttpException, HttpStatus, BadRequestException} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import {IsArray, IsIn, IsOptional, IsString, MaxLength, ArrayMaxSize, Matches} from 'class-validator';
import {and, eq, gte, sql} from 'drizzle-orm';
import {DB, type Db} from '../db/client.js';
import {auditLog} from '../db/schema.js';
import {CONFIG} from '../common/tokens.js';
import type {Config} from '../config.js';
import {Audit} from '../common/audit.js';
import {CurrentUser, type AuthUser} from '../common/security.js';

const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
class SampleDto {
  @IsString() @MaxLength(60_000) prompt: string;
  @IsOptional() @IsArray() @ArrayMaxSize(1) @IsString({each: true}) @MaxLength(7_000_000, {each: true}) @Matches(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, {each: true}) images?: string[];
  @IsOptional() @IsIn(['quick', 'default', 'complex']) modelTier?: string;
}

@Controller('api/ai')
export class AiController {
  constructor(@Inject(DB) private db: Db, @Inject(CONFIG) private cfg: Config, private audit: Audit) {}

  private async used() {
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const month = new Date(day.getFullYear(), day.getMonth(), 1);
    const n = async (from: Date) => (await this.db.select({n: sql<number>`count(*)::int`}).from(auditLog).where(and(eq(auditLog.action, 'ai_call'), gte(auditLog.at, from))))[0].n;
    return {today: await n(day), month: await n(month)};
  }

  @Get('limits')
  async limits() {
    const a = this.cfg.ai;
    if (!a.enabled || !a.apiKey) return {enabled: false};
    const u = await this.used();
    return {enabled: true, images: {mediaTypes: IMG_TYPES}, daily: a.dailyLimit, monthly: a.monthlyBudgetCalls, usedToday: u.today, usedMonth: u.month};
  }

  @Throttle({default: {limit: 6, ttl: 60_000}}) @Post('sample') @HttpCode(200)
  async sample(@CurrentUser() me: AuthUser, @Body() b: SampleDto) {
    const a = this.cfg.ai;
    if (!a.enabled || !a.apiKey) throw new NotFoundException('the assistant is not enabled on this server');
    const u = await this.used();
    if (u.today >= a.dailyLimit || u.month >= a.monthlyBudgetCalls) throw new HttpException({code: 'rate_limited', message: 'the assistant limit is reached'}, HttpStatus.TOO_MANY_REQUESTS);
    const content: unknown[] = [];
    for (const img of b.images ?? []) {
      const m = /^data:(image\/\w+);base64,(.+)$/.exec(img);
      if (!m) throw new BadRequestException('bad image');
      content.push({type: 'image', source: {type: 'base64', media_type: m[1], data: m[2]}});
    }
    content.push({type: 'text', text: b.prompt});
    // the audit row counts the call before it is made, so a failing call still counts toward the limit
    await this.audit.log(me.id, 'ai_call', 'ai', '', {tier: b.modelTier ?? 'default', images: content.length - 1});
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 120_000);
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ctl.signal,
        headers: {'content-type': 'application/json', 'x-api-key': a.apiKey, 'anthropic-version': '2023-06-01'},
        body: JSON.stringify({model: a.model, max_tokens: 8000, messages: [{role: 'user', content}]})
      });
      if (r.status === 429) throw new HttpException({code: 'rate_limited', message: 'the API is busy, try again in a minute'}, HttpStatus.TOO_MANY_REQUESTS);
      if (!r.ok) throw new BadGatewayException({code: 'upstream', message: `assistant error ${r.status}`});
      const j = await r.json() as {content?: Array<{type: string; text?: string}>; stop_reason?: string};
      const text = (j.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('');
      return {text, truncated: j.stop_reason === 'max_tokens'};
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new BadGatewayException({code: 'upstream', message: 'the assistant could not be reached'});
    } finally { clearTimeout(timer); }
  }
}
