// Database of one workshop. Nothing here is shared with any other workshop: one installation, one database.
import {pgTable, pgEnum, text, timestamp, boolean, integer, bigint, jsonb, uuid, index, uniqueIndex, customType} from 'drizzle-orm/pg-core';

const bytea = customType<{data: Buffer; driverData: Buffer}>({dataType: () => 'bytea'});

export const userRole = pgEnum('user_role', ['owner', 'staff']);
export const quoteEventType = pgEnum('quote_event_type', ['sent', 'accepted', 'cancelled', 'replaced']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull().default(''),
  role: userRole('role').notNull().default('staff'),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamp('locked_until', {withTimezone: true}),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', {withTimezone: true})
}, t => [uniqueIndex('users_email_uq').on(t.email)]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, {onDelete: 'cascade'}),
  tokenHash: text('token_hash').notNull(),
  device: text('device').notNull().default(''),
  expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
  lastSeenAt: timestamp('last_seen_at', {withTimezone: true}).notNull().defaultNow(),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow()
}, t => [uniqueIndex('sessions_token_uq').on(t.tokenHash)]);

// One global, ever increasing number for every accepted change: a device asks "what changed since n".
// Server order, never the clocks of the devices.

// The editor's designs, field for field (name, phone, note, variant, cfg, thumb, updatedAt), plus the sync state.
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  rev: integer('rev').notNull(),
  seq: bigint('seq', {mode: 'number'}).notNull(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  note: text('note').notNull().default(''),
  variant: text('variant'),
  cfg: jsonb('cfg').notNull(),
  thumb: text('thumb').notNull().default(''),
  clientUpdatedAt: bigint('client_updated_at', {mode: 'number'}).notNull().default(0),
  deletedAt: timestamp('deleted_at', {withTimezone: true}),
  updatedBy: uuid('updated_by').references(() => users.id, {onDelete: 'set null'}),
  device: text('device').notNull().default(''),
  updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow()
}, t => [index('projects_seq_idx').on(t.seq)]);

// every accepted save, restore or deletion, with who, which device and which change id (a change sent twice is applied once)
export const projectVersions = pgTable('project_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: text('project_id').notNull(),
  rev: integer('rev').notNull(),
  kind: text('kind').notNull(),
  changeId: text('change_id').notNull(),
  data: jsonb('data').notNull(),
  userId: uuid('user_id').references(() => users.id, {onDelete: 'set null'}),
  device: text('device').notNull().default(''),
  pinned: boolean('pinned').notNull().default(false),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow()
}, t => [index('versions_project_idx').on(t.projectId, t.rev), uniqueIndex('versions_change_uq').on(t.changeId)]);

// the editor's workshop settings (prices with identity, fabrication settings), one document with its own rev
export const settings = pgTable('settings', {
  id: integer('id').primaryKey(),
  rev: integer('rev').notNull().default(0),
  seq: bigint('seq', {mode: 'number'}).notNull().default(0),
  prices: jsonb('prices').notNull().default({}),
  fab: jsonb('fab').notNull().default({}),
  updatedBy: uuid('updated_by').references(() => users.id, {onDelete: 'set null'}),
  updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow()
});

// A quote, frozen when it is issued: the design, the price lines and totals, the prices and tax used, the workshop's
// identity and legal details, the terms, and the PDF itself with its SHA-256. A database trigger refuses any change.
export const quotes = pgTable('quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: text('number').notNull(),
  year: integer('year').notNull(),
  seqNo: integer('seq_no').notNull(),
  projectId: text('project_id').notNull(),
  projectRev: integer('project_rev').notNull(),
  clientName: text('client_name').notNull().default(''),
  clientPhone: text('client_phone').notNull().default(''),
  currency: text('currency').notNull().default(''),
  total: text('total').notNull().default('0'),
  snapshot: jsonb('snapshot').notNull(),
  pdf: bytea('pdf'),
  pdfSha256: text('pdf_sha256'),
  createdBy: uuid('created_by').references(() => users.id, {onDelete: 'set null'}),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow()
}, t => [uniqueIndex('quotes_number_uq').on(t.number), uniqueIndex('quotes_year_seq_uq').on(t.year, t.seqNo)]);

export const quoteEvents = pgTable('quote_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  quoteId: uuid('quote_id').notNull().references(() => quotes.id),
  type: quoteEventType('type').notNull(),
  data: jsonb('data').notNull().default({}),
  userId: uuid('user_id').references(() => users.id, {onDelete: 'set null'}),
  at: timestamp('at', {withTimezone: true}).notNull().defaultNow()
}, t => [index('quote_events_q_idx').on(t.quoteId)]);

// Client links: only the hash of the token is kept; read only, limited in time, revocable, optional PIN.
export const shareLinks = pgTable('share_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull(),
  projectId: text('project_id').notNull(),
  quoteId: uuid('quote_id').references(() => quotes.id),
  pinHash: text('pin_hash'),
  failedPins: integer('failed_pins').notNull().default(0),
  expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
  revokedAt: timestamp('revoked_at', {withTimezone: true}),
  views: integer('views').notNull().default(0),
  lastViewAt: timestamp('last_view_at', {withTimezone: true}),
  createdBy: uuid('created_by').references(() => users.id, {onDelete: 'set null'}),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow()
}, t => [uniqueIndex('share_token_uq').on(t.tokenHash), index('share_project_idx').on(t.projectId)]);

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull().default(''),
  entityId: text('entity_id').notNull().default(''),
  meta: jsonb('meta').notNull().default({}),
  at: timestamp('at', {withTimezone: true}).notNull().defaultNow()
}, t => [index('audit_at_idx').on(t.at)]);
