import type { Role } from "./data";

export type AvailableAccount = {
  id: string;
  name: string;
  email: string;
  store: string;
  role: Role;
  avatarColor: string;
  lastUsedAt: string;
};

export const AVAILABLE_ACCOUNTS_STORAGE_KEY = "almadina-express-available-accounts-v1";
export const AVAILABLE_ACCOUNTS_EVENT = "almadina-available-accounts-changed";

function isAvailableAccount(value: unknown): value is AvailableAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<AvailableAccount>;
  return typeof account.id === "string"
    && typeof account.name === "string"
    && typeof account.email === "string"
    && typeof account.store === "string"
    && (account.role === "admin" || account.role === "merchant" || account.role === "courier")
    && typeof account.avatarColor === "string"
    && typeof account.lastUsedAt === "string";
}

export function readAvailableAccounts(): AvailableAccount[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = JSON.parse(localStorage.getItem(AVAILABLE_ACCOUNTS_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(stored)) return [];
    return stored.filter(isAvailableAccount)
      .sort((first, second) => second.lastUsedAt.localeCompare(first.lastUsedAt))
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function rememberAvailableAccount(account: Omit<AvailableAccount, "lastUsedAt">): void {
  if (typeof window === "undefined") return;

  const remembered: AvailableAccount = {
    id: account.id,
    name: account.name,
    email: account.email.trim().toLowerCase(),
    store: account.store,
    role: account.role,
    avatarColor: account.avatarColor,
    lastUsedAt: new Date().toISOString(),
  };

  try {
    const previous = readAvailableAccounts().filter((entry) => entry.id !== remembered.id && entry.email !== remembered.email);
    localStorage.setItem(AVAILABLE_ACCOUNTS_STORAGE_KEY, JSON.stringify([remembered, ...previous].slice(0, 8)));
    window.dispatchEvent(new Event(AVAILABLE_ACCOUNTS_EVENT));
  } catch {
    // The shortcut is optional when browser storage is unavailable.
  }
}
