"use client";

import { createContext, useContext } from "react";
import type { Database, Notice, NoticeAudience, Preferences, User } from "./data";

export type View =
  | "home"
  | "shipments"
  | "returns"
  | "collections"
  | "new-order"
  | "order-detail"
  | "recipients"
  | "settings"
  | "security"
  | "delete-account"
  | "notification-settings"
  | "preferences"
  | "help"
  | "privacy"
  | "notifications"
  | "trash"
  | "import"
  | "profile"
  | "admin";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
};

export type ToastKind = "success" | "error" | "info";

export type AppContextValue = {
  database: Database;
  user: User | null;
  view: View;
  preferences: Preferences;
  selectedOrderId: string | null;
  setSelectedOrderId: (id: string | null) => void;
  setView: (view: View) => void;
  updateDatabase: (updater: (current: Database) => Database) => void;
  updatePreferences: (values: Partial<Preferences>) => void;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  register: (values: Omit<User, "id" | "role" | "joinedAt" | "avatarColor">) => Promise<boolean>;
  deleteAccount: (password: string, confirmation: string) => Promise<boolean>;
  verifyCollectionCode: (invoiceId: string, verificationCode: string) => Promise<boolean>;
  shipScannedOrder: (trackingNumber: string) => Promise<boolean>;
  showToast: (message: string, kind?: ToastKind) => void;
  confirm: (options: ConfirmOptions) => void;
  notify: (notice: Omit<Notice, "id" | "read" | "createdAt">) => void;
  broadcastNotice: (notice: { audience: NoticeAudience; recipientUserId?: string; title: string; message: string }) => Promise<number | null>;
  clearNotices: (noticeIds: string[]) => Promise<number | null>;
  openScanner: (callback?: (value: string) => void) => void;
  openAccountSwitcher: () => void;
};

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be called within AppContext.Provider");
  return context;
}
