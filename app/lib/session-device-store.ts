import { cleanDeviceText, describeSessionDevice, type DevicePlatform } from './session-device';
import { trustedClientLocation } from './trusted-client';

export type SessionDetailsRow = {
  platform: string; model: string; os_version: string; app_version: string; label: string;
  location: string | null; location_updated_at: string | null;
};

export function sessionDetailsSchema(database: D1Database): D1PreparedStatement[] {
  return [database.prepare(`CREATE TABLE IF NOT EXISTS almadina_session_details (
    token_hash TEXT PRIMARY KEY NOT NULL REFERENCES almadina_sessions(token_hash) ON DELETE CASCADE,
    user_id TEXT NOT NULL, platform TEXT NOT NULL, model TEXT NOT NULL,
    os_version TEXT NOT NULL, app_version TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
    location TEXT, location_updated_at TEXT
  )`), database.prepare('CREATE INDEX IF NOT EXISTS almadina_session_details_user_idx ON almadina_session_details(user_id)')];
}

export function sessionDetailsStatement(database: D1Database, tokenHash: string, userId: string, request: Request, previous?: SessionDetailsRow | null): D1PreparedStatement {
  const descriptor = describeSessionDevice(request);
  const compatible = !previous || descriptor.platform === previous.platform || descriptor.platform === 'unknown';
  const location = previous?.location || trustedClientLocation(request);
  const platform = descriptor.platform === 'unknown' ? previous?.platform || 'unknown' : descriptor.platform;
  const model = descriptor.model || (compatible ? previous?.model : '') || '';
  const osVersion = descriptor.osVersion || (compatible ? previous?.os_version : '') || '';
  const appVersion = descriptor.appVersion || (compatible ? previous?.app_version : '') || '';
  // INSERT SELECT guards races with logout/revocation/account purge: never
  // recreate session metadata after the parent session has been removed.
  return database.prepare(`INSERT INTO almadina_session_details
    (token_hash, user_id, platform, model, os_version, app_version, label, location, location_updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? FROM almadina_sessions WHERE token_hash = ? AND user_id = ?
    ON CONFLICT (token_hash) DO UPDATE SET
      platform = CASE WHEN almadina_session_details.platform = 'unknown' THEN excluded.platform ELSE almadina_session_details.platform END,
      model = CASE WHEN excluded.model <> '' AND (almadina_session_details.platform = 'unknown' OR almadina_session_details.platform = excluded.platform) THEN excluded.model ELSE almadina_session_details.model END,
      os_version = CASE WHEN excluded.os_version <> '' AND (almadina_session_details.platform = 'unknown' OR almadina_session_details.platform = excluded.platform) THEN excluded.os_version ELSE almadina_session_details.os_version END,
      app_version = CASE WHEN excluded.app_version <> '' AND (almadina_session_details.platform = 'unknown' OR almadina_session_details.platform = excluded.platform) THEN excluded.app_version ELSE almadina_session_details.app_version END,
      location = COALESCE(almadina_session_details.location, excluded.location),
      location_updated_at = COALESCE(almadina_session_details.location_updated_at, excluded.location_updated_at)
    WHERE almadina_session_details.user_id = excluded.user_id
      AND (almadina_session_details.platform = 'unknown' AND excluded.platform <> 'unknown'
        OR excluded.model <> '' AND excluded.model <> almadina_session_details.model
        OR excluded.os_version <> '' AND excluded.os_version <> almadina_session_details.os_version
        OR excluded.app_version <> '' AND excluded.app_version <> almadina_session_details.app_version
        OR almadina_session_details.location IS NULL AND excluded.location IS NOT NULL)`)
    .bind(tokenHash, userId, platform, model, osVersion, appVersion, previous?.label || '', location,
      previous?.location_updated_at || (location ? new Date().toISOString() : null), tokenHash, userId);
}

export function readSessionDetails(database: D1Database, tokenHash: string): Promise<SessionDetailsRow | null> {
  return database.prepare('SELECT platform, model, os_version, app_version, label, location, location_updated_at FROM almadina_session_details WHERE token_hash = ?')
    .bind(tokenHash).first<SessionDetailsRow>();
}

export function publicSessionDetails(row: Partial<SessionDetailsRow>) {
  const platform: DevicePlatform = ['android', 'ios', 'ipados', 'windows', 'macos', 'linux'].includes(row.platform || '') ? row.platform as DevicePlatform : 'unknown';
  return {
    platform, model: cleanDeviceText(row.model, 100), osVersion: cleanDeviceText(row.os_version, 40),
    appVersion: cleanDeviceText(row.app_version, 40), label: cleanDeviceText(row.label, 80),
    location: row.location || null, locationUpdatedAt: row.location_updated_at || null,
    locationSource: row.location ? 'ip' as const : 'unknown' as const,
  };
}
