import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {ValidationPipe, Logger} from '@nestjs/common';
import type {NestExpressApplication} from '@nestjs/platform-express';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import {AppModule} from './app.module.js';
import {CONFIG} from './common/tokens.js';
import {DB, type Db, runMigrations} from './db/client.js';
import type {Config} from './config.js';
import {mountWeb} from './web/web.js';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {bodyParser: false, logger: ['error', 'warn', 'log']});
  const cfg = app.get<Config>(CONFIG);
  await runMigrations(app.get<Db>(DB));
  const ex = app.getHttpAdapter().getInstance() as express.Express;
  // behind the reverse proxy of the server: the client address comes from it, never from a header sent by anyone
  ex.set('trust proxy', process.env.TRUST_PROXY || 'loopback, uniquelocal');
  ex.disable('x-powered-by');
  app.use(helmet({contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, strictTransportSecurity: cfg.cookieSecure ? {maxAge: 31536000} : false}));
  app.use(cookieParser());
  app.use('/api/quotes', express.raw({type: 'application/pdf', limit: '25mb'}));
  app.use('/api/ai', express.json({limit: '10mb'}));
  app.use(express.json({limit: '3mb'}));
  app.useGlobalPipes(new ValidationPipe({whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: {enableImplicitConversion: false}}));
  mountWeb(ex, cfg);
  app.enableShutdownHooks();
  return {app, cfg};
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const {app, cfg} = await createApp();
  await app.listen(cfg.port, cfg.host);
  new Logger('warsha').log(`listening on ${cfg.host}:${cfg.port}, public address ${cfg.publicUrl}`);
}
