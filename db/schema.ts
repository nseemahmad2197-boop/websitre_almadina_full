import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const almadinaSessionDevices = sqliteTable("almadina_session_devices", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  deviceName: text("device_name").notNull(),
  deviceType: text("device_type").notNull(),
  browserName: text("browser_name").notNull(),
  createdAt: text("created_at").notNull(),
  lastActiveAt: text("last_active_at").notNull(),
}, (table) => [index("almadina_session_devices_user_id_idx").on(table.userId)]);

export const almadinaAppLocks = sqliteTable("almadina_app_locks", {
  userId: text("user_id").primaryKey(),
  pinHash: text("pin_hash").notNull(),
  enabled: integer("enabled").notNull().default(1),
  biometricEnabled: integer("biometric_enabled").notNull().default(0),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: integer("locked_until").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const almadinaWebAuthnCredentials = sqliteTable("almadina_webauthn_credentials", {
  credentialId: text("credential_id").primaryKey(),
  userId: text("user_id").notNull(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  transports: text("transports").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: integer("backed_up").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("almadina_webauthn_credentials_user_id_idx").on(table.userId)]);

export const almadinaPasskeyLoginCredentials = sqliteTable("almadina_passkey_login_credentials", {
  credentialId: text("credential_id").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("almadina_passkey_login_credentials_user_id_idx").on(table.userId)]);

export const almadinaWebAuthnChallenges = sqliteTable("almadina_webauthn_challenges", {
  sessionHash: text("session_hash").notNull(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  challenge: text("challenge").notNull(),
  origin: text("origin").notNull(),
  rpId: text("rp_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.sessionHash, table.kind] })]);

export const almadinaRateLimits = sqliteTable("almadina_rate_limits", {
  keyHash: text("key_hash").primaryKey(),
  action: text("action").notNull(),
  requestCount: integer("request_count").notNull().default(0),
  resetAt: integer("reset_at").notNull(),
}, (table) => [index("almadina_rate_limits_reset_at_idx").on(table.resetAt)]);

export const almadinaPasswordResetRequests = sqliteTable("almadina_password_reset_requests", {
  requestHash: text("request_hash").primaryKey(),
  userId: text("user_id").notNull(),
  channel: text("channel").notNull(),
  codeHash: text("code_hash").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
  verifiedAt: integer("verified_at"),
  resetTokenHash: text("reset_token_hash"),
  resetExpiresAt: integer("reset_expires_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("almadina_password_reset_requests_user_id_idx").on(table.userId),
  index("almadina_password_reset_requests_expires_at_idx").on(table.expiresAt),
  index("almadina_password_reset_requests_reset_token_hash_idx").on(table.resetTokenHash),
]);

export const almadinaRegistrationRequests = sqliteTable("almadina_registration_requests", {
  requestHash: text("request_hash").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  store: text("store").notNull(),
  passwordHash: text("password_hash").notNull(),
  codeHash: text("code_hash").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("almadina_registration_requests_email_idx").on(table.email),
  index("almadina_registration_requests_phone_idx").on(table.phone),
  index("almadina_registration_requests_expires_at_idx").on(table.expiresAt),
]);
