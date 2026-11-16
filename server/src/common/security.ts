// Authentication, roles and request checks shared by every controller.
// Session: a random token in an httpOnly cookie; only its SHA-256 is stored, so a database leak gives no session.
// Writes: SameSite=Lax cookie, plus a custom header and an Origin check (a page on another site can send neither).
import {CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, createParamDecorator, ForbiddenException, UnauthorizedException} from '@nestjs/common';
import {Reflector} from '@nestjs/core';
import {createHash, randomBytes} from 'node:crypto';
import {and, eq, gt} from 'drizzle-orm';
import type {Request} from 'express';
import {DB, type Db} from '../db/client.js';
import {sessions, users} from '../db/schema.js';
import {CONFIG} from './tokens.js';
import type {Config} from '../config.js';

export const SESSION_COOKIE = 'ws_session';
export const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export interface AuthUser { id: string; email: string; name: string; role: 'owner' | 'staff'; sessionId: string }
export type AuthedRequest = Request & {user?: AuthUser; device?: string};

const PUBLIC = 'warsha_public', ROLES = 'warsha_roles';
export const Public = () => SetMetadata(PUBLIC, true);
export const Roles = (...r: Array<'owner' | 'staff'>) => SetMetadata(ROLES, r);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => (ctx.switchToHttp().getRequest() as AuthedRequest).user as AuthUser);
// the device a change comes from, for the history ("tablet", "PC atelier"): short, printable, never trusted for anything else
export const Device = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const v = String((ctx.switchToHttp().getRequest() as Request).headers['x-warsha-device'] || '');
  return v.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 60);
});

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, @Inject(DB) private db: Db, @Inject(CONFIG) private cfg: Config) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!SAFE.has(req.method)) {
      if (req.headers['x-warsha'] !== '1') throw new ForbiddenException('missing request header');
      const origin = req.headers.origin;
      if (origin && origin !== new URL(this.cfg.publicUrl).origin) throw new ForbiddenException('bad origin');
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token || typeof token !== 'string') throw new UnauthorizedException();
    const now = new Date();
    const rows = await this.db.select({sid: sessions.id, lastSeen: sessions.lastSeenAt, id: users.id, email: users.email, name: users.name, role: users.role})
      .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now), eq(users.active, true))).limit(1);
    const s = rows[0];
    if (!s) throw new UnauthorizedException();
    if (now.getTime() - s.lastSeen.getTime() > 5 * 60_000) await this.db.update(sessions).set({lastSeenAt: now}).where(eq(sessions.id, s.sid));
    req.user = {id: s.id, email: s.email, name: s.name, role: s.role, sessionId: s.sid};
    const roles = this.reflector.getAllAndOverride<Array<'owner' | 'staff'>>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(s.role)) throw new ForbiddenException();
    return true;
  }
}
