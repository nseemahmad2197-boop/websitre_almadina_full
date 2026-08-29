import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const almadinaState = sqliteTable("almadina_state", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  revision: integer("revision").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const almadinaSessions = sqliteTable("almadina_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("almadina_sessions_user_id_idx").on(table.userId)]);
