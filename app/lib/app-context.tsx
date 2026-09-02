"use client";

import { createContext, useContext } from "react";
import type { Database, LinkedDevice, Notice, NoticeAudience, Preferences, User } from "./data";
import type { AppLockState } from "./app-lock-client";

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
  | "change-password"
  | "linked-devices"
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
  onConfirm: () => void | boolean | Promise<void | boolean>;
};

export type ToastKind = "success" | "error" | "info";

export type RegistrationFormValues = Pick<User, "name" | "phone" | "store" | "email" | "password">
  & Required<Pick<User, "governorate" | "city" | "address" | "latitude" | "longitude">>
  & { acceptedTerms: boolean; locationMethod: "manual" | "map" };
export type RegistrationChallenge = { expiresIn: number; resendAfter: number; email: string };

export type AppContextValue = {
  database: Database;
  user: User | null;
  view: View;
  preferences: Preferences;
  appLock: AppLockState;
  selectedOrderId: string | null;
  setSelectedOrderId: (id: string | null) => void;
  setView: (view: View) => void;
  updateDatabase: (updater: (current: Database) => Database) => void;
  updatePreferences: (values: Partial<Preferences>) => void;
  enableAppLock: (pin: string) => Promise<boolean>;
  disableAppLock: (pin: string) => Promise<boolean>;
  enableBiometricUnlock: (pin: string) => Promise<boolean>;
  disableBiometricUnlock: (pin: string) => Promise<boolean>;
  verifyAppPin: (pin: string) => Promise<boolean>;
  unlockWithBiometric: () => Promise<boolean>;
  refreshAppLock: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  loginWithBiometric: () => Promise<boolean>;
  logout: () => Promise<boolean>;
  requestRegistration: (values: RegistrationFormValues) => Promise<RegistrationChallenge>;
  verifyRegistration: (code: string) => Promise<boolean>;
  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string, signOutAllDevices: boolean) => Promise<boolean>;
  listLinkedDevices: () => Promise<LinkedDevice[] | null>;
  revokeLinkedDevice: (deviceId: string) => Promise<LinkedDevice[] | null>;
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
