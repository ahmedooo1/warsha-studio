// Sign in, first owner setup, sign out, password change; users and sessions for the owner.
import {Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req, Res, UnauthorizedException, BadRequestException, ConflictException} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import {IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, IsBoolean} from 'class-validator';
import {hash, verify} from '@node-rs/argon2';
import {and, count, eq, ne, sql} from 'drizzle-orm';
import type {Response} from 'express';
import {timingSafeEqual} from 'node:crypto';
import {DB, type Db} from '../db/client.js';
import {sessions, users} from '../db/schema.js';
import {CONFIG} from '../common/tokens.js';
import type {Config} from '../config.js';
import {Audit} from '../common/audit.js';
import {AuthedRequest, CurrentUser, Public, Roles, SESSION_COOKIE, randomToken, sha256, type AuthUser} from '../common/security.js';

const MAX_FAILS = 8, LOCK_MIN = 15;
// sign in attempts per minute and per address (the lockout above is per account)
const LOGIN_PER_MIN = Number(process.env.LOGIN_PER_MIN) || 10;
// a valid hash to compare against when the email is unknown, so the answer takes the same time either way
let dummyHash = '';
const dummy = async () => dummyHash || (dummyHash = await hash('not-a-real-password-' + randomToken(8)));

class LoginDto { @IsEmail() @MaxLength(200) email: string; @IsString() @MaxLength(200) password: string; }
class SetupDto {
  @IsString() @MaxLength(200) token: string; @IsEmail() @MaxLength(200) email: string;
  @IsString() @MaxLength(80) name: string; @IsString() @MinLength(10) @MaxLength(200) password: string;
}
class PasswordDto { @IsString() @MaxLength(200) current: string; @IsString() @MinLength(10) @MaxLength(200) next: string; }
class NewUserDto {
  @IsEmail() @MaxLength(200) email: string; @IsString() @MaxLength(80) name: string;
  @IsIn(['owner', 'staff']) role: 'owner' | 'staff'; @IsString() @MinLength(10) @MaxLength(200) password: string;
}
class EditUserDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string; @IsOptional() @IsIn(['owner', 'staff']) role?: 'owner' | 'staff';
  @IsOptional() @IsBoolean() active?: boolean; @IsOptional() @IsString() @MinLength(10) @MaxLength(200) password?: string;
}

const clean = (e: string) => e.trim().toLowerCase();
const publicUser = (u: {id: string; email: string; name: string; role: string}) => ({id: u.id, email: u.email, name: u.name, role: u.role});

@Controller('api/auth')
export class AuthController {
  constructor(@Inject(DB) private db: Db, @Inject(CONFIG) private cfg: Config, private audit: Audit) {}

  private async openSession(res: Response, userId: string, device: string) {
    const token = randomToken(32), days = this.cfg.sessionDays;
    await this.db.insert(sessions).values({userId, tokenHash: sha256(token), device: device.slice(0, 120), expiresAt: new Date(Date.now() + days * 864e5)});
    res.cookie(SESSION_COOKIE, token, {httpOnly: true, secure: this.cfg.cookieSecure, sameSite: 'lax', path: '/', maxAge: days * 864e5});
  }

  @Public() @Get('state')
  async state(@Req() req: AuthedRequest) {
    const [{n}] = await this.db.select({n: count()}).from(users);
    let user = null;
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token) {
      const r = await this.db.select({id: users.id, email: users.email, name: users.name, role: users.role}).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, sha256(token)), sql`${sessions.expiresAt} > now()`, eq(users.active, true))).limit(1);
      user = r[0] ? publicUser(r[0]) : null;
    }
    return {setupNeeded: n === 0, user};
  }

  // first start: the owner account is created with the one-time SETUP_TOKEN from the server's environment
  @Public() @Throttle({default: {limit: 5, ttl: 60_000}}) @Post('setup') @HttpCode(200)
  async setup(@Body() b: SetupDto, @Req() req: AuthedRequest, @Res({passthrough: true}) res: Response) {
    const t = this.cfg.setupToken;
    if (!t || t.length < 16) throw new ForbiddenException('setup is closed');
    const a = Buffer.from(b.token), e = Buffer.from(t);
    if (a.length !== e.length || !timingSafeEqual(a, e)) throw new ForbiddenException('bad setup token');
    const user = await this.db.transaction(async tx => {
      await tx.execute(sql`LOCK TABLE users IN EXCLUSIVE MODE`);
      const [{n}] = await tx.select({n: count()}).from(users);
      if (n > 0) throw new ConflictException('already set up');
      const [u] = await tx.insert(users).values({email: clean(b.email), name: b.name.trim(), role: 'owner', passwordHash: await hash(b.password)}).returning();
      return u;
    });
    await this.openSession(res, user.id, String(req.headers['user-agent'] || ''));
    await this.audit.log(user.id, 'setup', 'user', user.id);
    return {user: publicUser(user)};
  }

  @Public() @Throttle({default: {limit: LOGIN_PER_MIN, ttl: 60_000}}) @Post('login') @HttpCode(200)
  async login(@Body() b: LoginDto, @Req() req: AuthedRequest, @Res({passthrough: true}) res: Response) {
    const [u] = await this.db.select().from(users).where(eq(users.email, clean(b.email))).limit(1);
    const fail = new UnauthorizedException('wrong email or password');
    if (!u || !u.active) { await verify(await dummy(), b.password).catch(() => false); throw fail; }
    if (u.lockedUntil && u.lockedUntil > new Date()) { await verify(await dummy(), b.password).catch(() => false); throw new UnauthorizedException('account locked for a few minutes'); }
    if (!(await verify(u.passwordHash, b.password).catch(() => false))) {
      const fails = u.failedLogins + 1;
      await this.db.update(users).set({failedLogins: fails >= MAX_FAILS ? 0 : fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60_000) : null}).where(eq(users.id, u.id));
      await this.audit.log(u.id, 'login_failed', 'user', u.id);
      throw fail;
    }
    await this.db.update(users).set({failedLogins: 0, lockedUntil: null, lastLoginAt: new Date()}).where(eq(users.id, u.id));
    await this.openSession(res, u.id, String(req.headers['user-agent'] || ''));
    await this.audit.log(u.id, 'login', 'user', u.id);
    return {user: publicUser(u)};
  }

  @Post('logout') @HttpCode(200)
  async logout(@CurrentUser() me: AuthUser, @Res({passthrough: true}) res: Response) {
    await this.db.delete(sessions).where(eq(sessions.id, me.sessionId));
    res.clearCookie(SESSION_COOKIE, {path: '/'});
    return {ok: true};
  }

  @Throttle({default: {limit: 5, ttl: 60_000}}) @Post('password') @HttpCode(200)
  async password(@CurrentUser() me: AuthUser, @Body() b: PasswordDto) {
    const [u] = await this.db.select().from(users).where(eq(users.id, me.id));
    if (!(await verify(u.passwordHash, b.current).catch(() => false))) throw new UnauthorizedException('wrong password');
    await this.db.update(users).set({passwordHash: await hash(b.next)}).where(eq(users.id, me.id));
    // every other session of this user ends
    await this.db.delete(sessions).where(and(eq(sessions.userId, me.id), ne(sessions.id, me.sessionId)));
    await this.audit.log(me.id, 'password_changed', 'user', me.id);
    return {ok: true};
  }
}

@Controller('api/users')
export class UsersController {
  constructor(@Inject(DB) private db: Db, private audit: Audit) {}

  @Get() @Roles('owner')
  async list() {
    return this.db.select({id: users.id, email: users.email, name: users.name, role: users.role, active: users.active, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt}).from(users).orderBy(users.createdAt);
  }

  @Post() @Roles('owner')
  async create(@CurrentUser() me: AuthUser, @Body() b: NewUserDto) {
    const email = clean(b.email);
    const [dup] = await this.db.select({id: users.id}).from(users).where(eq(users.email, email));
    if (dup) throw new ConflictException('email already used');
    const [u] = await this.db.insert(users).values({email, name: b.name.trim(), role: b.role, passwordHash: await hash(b.password)}).returning();
    await this.audit.log(me.id, 'user_created', 'user', u.id, {role: b.role});
    return publicUser(u);
  }

  @Patch(':id') @Roles('owner')
  async edit(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: EditUserDto) {
    return this.db.transaction(async tx => {
      const [u] = await tx.select().from(users).where(eq(users.id, id)).for('update');
      if (!u) throw new BadRequestException('no such user');
      const role = b.role ?? u.role, active = b.active ?? u.active;
      if (u.role === 'owner' && (role !== 'owner' || !active)) {
        const [{n}] = await tx.select({n: count()}).from(users).where(and(eq(users.role, 'owner'), eq(users.active, true), ne(users.id, id)));
        if (n === 0) throw new ConflictException('the workshop must keep one active owner');
      }
      const patch: Partial<typeof users.$inferInsert> = {role, active};
      if (b.name !== undefined) patch.name = b.name.trim();
      if (b.password) patch.passwordHash = await hash(b.password);
      await tx.update(users).set(patch).where(eq(users.id, id));
      if (!active || b.password) await tx.delete(sessions).where(eq(sessions.userId, id));
      await this.audit.log(me.id, 'user_changed', 'user', id, {role, active, password: !!b.password});
      return {ok: true};
    });
  }

  @Get('sessions')
  async mySessions(@CurrentUser() me: AuthUser) {
    const q = this.db.select({id: sessions.id, device: sessions.device, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, userId: sessions.userId, email: users.email})
      .from(sessions).innerJoin(users, eq(users.id, sessions.userId));
    const rows = me.role === 'owner' ? await q : await q.where(eq(sessions.userId, me.id));
    return rows.map(r => ({...r, current: r.id === me.sessionId}));
  }

  // ends a session at once: a lost phone or a former employee
  @Delete('sessions/:id')
  async revoke(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const where = me.role === 'owner' ? eq(sessions.id, id) : and(eq(sessions.id, id), eq(sessions.userId, me.id));
    const r = await this.db.delete(sessions).where(where).returning({id: sessions.id});
    if (!r.length) throw new BadRequestException('no such session');
    await this.audit.log(me.id, 'session_revoked', 'session', id);
    return {ok: true};
  }
}
