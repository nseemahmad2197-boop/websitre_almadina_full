/** Same-tab reload continuity only. This is not an authentication credential. */
export const APP_LOCK_BACKGROUND_DELAY = 15_000;
export const APP_LOCK_RELOAD_KEY = "almadina-app-lock-reload-v1";
export const APP_LOCK_AUTH_GENERATION_KEY = "almadina-app-lock-auth-generation-v1";
export type ReloadHandoff = { version: 1; state: "unlocked"; userId: string; authGeneration: string; departedAt: number };

export function reloadNavigationType(timing: { getEntriesByType?: (type: string) => readonly unknown[]; navigation?: { type?: number } }): string {
  try {
    const current = (timing.getEntriesByType?.("navigation")[0] as { type?: string } | undefined)?.type;
    if (current) return current;
    return timing.navigation?.type === 1 ? "reload" : "unknown";
  } catch { return "unknown"; }
}

export function backgroundLockDue(hiddenAt: number | null, now = Date.now()): boolean {
  return hiddenAt !== null && (!Number.isFinite(hiddenAt) || hiddenAt > now || now - hiddenAt >= APP_LOCK_BACKGROUND_DELAY);
}

export function parseReloadHandoff(raw: string | null, navigation: string, now: number, authGeneration: string | null): ReloadHandoff | null {
  if (!raw || navigation !== "reload" || !authGeneration || !Number.isFinite(now)) return null;
  try {
    const entry = JSON.parse(raw) as Partial<ReloadHandoff> | null;
    if (!entry || entry.version !== 1 || entry.state !== "unlocked" || typeof entry.userId !== "string" || !entry.userId || entry.userId.length > 160
      || entry.authGeneration !== authGeneration || typeof entry.departedAt !== "number" || !Number.isFinite(entry.departedAt)
      || entry.departedAt > now || now - entry.departedAt >= APP_LOCK_BACKGROUND_DELAY) return null;
    return entry as ReloadHandoff;
  } catch { return null; }
}

export function appLockAuthGeneration(): string | null {
  try { const value = window.localStorage.getItem(APP_LOCK_AUTH_GENERATION_KEY); return value && /^[a-zA-Z0-9_-]{16,100}$/.test(value) ? value : null; }
  catch { return null; }
}

export function clearReloadHandoff(): void {
  try { window.sessionStorage.removeItem(APP_LOCK_RELOAD_KEY); } catch { /* Storage is optional; absence never unlocks. */ }
}

export function invalidateReloadAuthentication(): void {
  clearReloadHandoff();
  try { window.localStorage.removeItem(APP_LOCK_AUTH_GENERATION_KEY); window.localStorage.setItem(APP_LOCK_AUTH_GENERATION_KEY, crypto.randomUUID()); } catch { /* A failed write cannot keep the previous generation valid. */ }
}

export function ensureAppLockAuthGeneration(): string | null {
  try {
    if (!appLockAuthGeneration()) window.localStorage.setItem(APP_LOCK_AUTH_GENERATION_KEY, crypto.randomUUID());
    return appLockAuthGeneration();
  } catch { return null; }
}

/** Consume before fetching the server so an active, slow reload stays valid. */
export function consumeReloadHandoff(now = Date.now()): ReloadHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(APP_LOCK_RELOAD_KEY);
    window.sessionStorage.removeItem(APP_LOCK_RELOAD_KEY);
    return parseReloadHandoff(raw, reloadNavigationType(window.performance), now, appLockAuthGeneration());
  } catch { return null; }
}

export function saveReloadHandoff(userId: string, authGeneration: string | null, departedAt: number, now = Date.now()): void {
  clearReloadHandoff();
  if (!userId || !authGeneration || authGeneration !== appLockAuthGeneration() || backgroundLockDue(departedAt, now)) return;
  try {
    const handoff: ReloadHandoff = { version: 1, state: "unlocked", userId, authGeneration, departedAt };
    window.sessionStorage.setItem(APP_LOCK_RELOAD_KEY, JSON.stringify(handoff));
  } catch { clearReloadHandoff(); }
}

export function canRestoreReloadHandoff(handoff: ReloadHandoff | null, userId: string, hiddenAt: number | null, now = Date.now()): boolean {
  return !!handoff && handoff.userId === userId && handoff.authGeneration === appLockAuthGeneration() && !backgroundLockDue(hiddenAt, now);
}
