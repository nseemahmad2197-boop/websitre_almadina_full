"use client";

import { createContext, useContext } from "react";
import type { Database, LinkedDevice, Notice, NoticeAudience, Preferences, User, Order, Recipient } from "./data";
import type { AppLockState } from "./app-lock-client";
import type { PhoneNotificationState } from "./phone-notifications";

export type View =
  | "home"
  | "shipments"
  | "returns"
  | "collections"
  | "new-order"
  | "order-detail"
  | "followups"
  | "customer-followups"
  | "recipients"
  | "settings"
  | "security"
  | "change-password"
  | "linked-devices"
  | "delete-account"
  | "deletion-requests"
  | "notification-settings"
  | "preferences"
  | "help"
  | "privacy"
  | "notifications"
  | "trash"
  | "import"
  | "profile"
  | "admin"
  | "parcel-codes";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | boolean | Promise<void | boolean>;
};

export type ScannerPurpose = "lookup" | "assign-parcel-code";

export type ToastKind = "success" | "error" | "info";

export type RegistrationFormValues = Pick<User, "name" | "phone" | "store" | "email" | "password">
  & Required<Pick<User, "governorate" | "city" | "address" | "latitude" | "longitude">>
  & { acceptedTerms: boolean; locationMethod: "manual" | "map" };
export type RegistrationChallenge = { expiresIn: number; resendAfter: number; email: string };

export type AppContextValue = {
  serverSync?: { busy: boolean; error: string; offline: boolean; retry: () => void };
  database: Database;
  user: User | null;
  view: View;
  preferences: Preferences;
  phoneNotifications: PhoneNotificationState;
  appLock: AppLockState;
  selectedOrderId: string | null;
  setSelectedOrderId: (id: string | null) => void;
  setView: (view: View) => void;
  updateDatabase: (updater: (current: Database) => Database) => void;
  createParcels: (orders: Order[], recipients?: Recipient[]) => Promise<boolean>;
  assignParcelCode: (orderId: string, trackingNumber: string) => Promise<boolean>;
  generateParcelCodes: (requestId: string, count: number, label: string) => Promise<boolean>;
  purgeTrash: (orderIds: string[], invoiceIds: string[]) => Promise<boolean>;
  updatePreferences: (values: Partial<Preferences>) => void;
  setNotificationSounds: (enabled: boolean) => Promise<boolean>;
  enablePhoneNotifications: () => Promise<boolean>;
  disablePhoneNotifications: () => Promise<boolean>;
  testPhoneNotifications: () => Promise<boolean>;
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
  renameCurrentDevice: (label: string) => Promise<LinkedDevice[] | null>;
  submitDeletionOperation: (path: "account/deletion-request" | "admin/deletion-requests", payload: Record<string, unknown>) => Promise<unknown>;
  deleteAccount: (password: string, confirmation: string) => Promise<boolean>;
  prepareCollectionInvoice: (invoiceId: string) => Promise<boolean>;
  verifyCollectionCode: (invoiceId: string, verificationCode: string) => Promise<boolean>;
  shipScannedOrder: (trackingNumber: string) => Promise<boolean>;
  showToast: (message: string, kind?: ToastKind) => void;
  confirm: (options: ConfirmOptions) => void;
  notify: (notice: Omit<Notice, "id" | "read" | "createdAt">) => void;
  broadcastNotice: (notice: { audience: NoticeAudience; recipientUserId?: string; title: string; message: string }) => Promise<number | null>;
  clearNotices: (noticeIds: string[]) => Promise<number | null>;
  openScanner: (callback?: (value: string) => void, options?: { purpose?: ScannerPurpose }) => void;
  openAccountSwitcher: () => void;
};

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be called within AppContext.Provider");
  return context;
}
