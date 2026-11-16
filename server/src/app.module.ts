import {Module, Inject, Injectable, OnModuleDestroy, OnModuleInit, Controller, Get, Logger} from '@nestjs/common';
import {APP_GUARD} from '@nestjs/core';
import {ThrottlerGuard, ThrottlerModule} from '@nestjs/throttler';
import {lt, sql} from 'drizzle-orm';
import type pg from 'pg';
import {loadConfig, type Config} from './config.js';
import {CONFIG} from './common/tokens.js';
import {DB, POOL, createDb, createPool, type Db} from './db/client.js';
import {sessions} from './db/schema.js';
import {AuthGuard, Public} from './common/security.js';
import {Audit} from './common/audit.js';
import {AuthController, UsersController} from './auth/auth.controller.js';
import {SyncService} from './sync/sync.service.js';
import {SyncController} from './sync/sync.controller.js';
import {QuotesController} from './quotes/quotes.controller.js';
import {ShareController, PublicShareController} from './share/share.controller.js';
import {AdminController} from './admin/admin.controller.js';
import {AiController} from './ai/ai.controller.js';

@Controller('api')
class HealthController {
  constructor(@Inject(DB) private db: Db, @Inject(CONFIG) private cfg: Config) {}
  @Public() @Get('health')
  async health() { await this.db.execute(sql`SELECT 1`); return {ok: true, ai: this.cfg.ai.enabled && !!this.cfg.ai.apiKey}; }
}

// housekeeping twice a day: expired sessions go, the trash is emptied past its keeping time
@Injectable()
class Maintenance implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout; private log = new Logger('maintenance');
  constructor(@Inject(DB) private db: Db, private sync: SyncService, @Inject(POOL) private pool: pg.Pool) {}
  onModuleInit() { this.timer = setInterval(() => this.run().catch(e => this.log.error(e)), 12 * 36e5); this.timer.unref(); }
  async run() {
    await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
    const n = await this.sync.purgeTrash(); if (n) this.log.log(`trash: ${n} designs purged`);
  }
  async onModuleDestroy() { clearInterval(this.timer); await this.pool.end(); }
}

@Module({
  imports: [ThrottlerModule.forRoot([{name: 'default', ttl: 60_000, limit: 600}])],
  controllers: [HealthController, AuthController, UsersController, SyncController, QuotesController, ShareController, PublicShareController, AdminController, AiController],
  providers: [
    {provide: CONFIG, useFactory: () => loadConfig()},
    {provide: POOL, useFactory: (c: Config) => createPool(c.databaseUrl), inject: [CONFIG]},
    {provide: DB, useFactory: (p: pg.Pool) => createDb(p), inject: [POOL]},
    {provide: APP_GUARD, useClass: ThrottlerGuard},
    {provide: APP_GUARD, useClass: AuthGuard},
    Audit, SyncService, Maintenance
  ]
})
export class AppModule {}
