import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable('rooms', { code: text('code').primaryKey(), version: integer('version').notNull(), data: text('data').notNull(), expires: integer('expires').notNull() });
export const limits = sqliteTable('limits', { key: text('key').primaryKey(), count: integer('count').notNull(), expires: integer('expires').notNull() });
