"use client";

import { requestApiJSON } from "./api-transport";

import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

export type ServerAppLockStatus = {
  enabled: boolean;
  biometricEnabled: boolean;
  biometricLoginReady: boolean;
};

export type AppLockState = ServerAppLockStatus & {
  ready: boolean;
  locked: boolean;
  biometricAvailable: boolean;
  error?: string;
};

export class AppLockApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AppLockApiError";
  }
}

async function appLockRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { response, payload } = await requestApiJSON(`security/${path}`, options);
  if (!response.ok) throw new AppLockApiError(typeof payload.error === "string" ? payload.error : "تعذّر التحقق من قفل التطبيق.", response.status);
  return payload as T;
}

async function passkeyLoginRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { response, payload } = await requestApiJSON(`passkey/login/${path}`, options);
  if (!response.ok) throw new AppLockApiError(typeof payload.error === "string" ? payload.error : "تعذّر تسجيل الدخول بحماية الجهاز.", response.status);
  return payload as T;
}

export async function detectBiometricAvailability(): Promise<boolean> {
  if (typeof window === "undefined" || !window.isSecureContext || !browserSupportsWebAuthn()) return false;
  const touchFirst = navigator.maxTouchPoints > 0 && (
    window.matchMedia("(pointer: coarse)").matches
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
  const shortestScreenSide = Math.min(window.screen.width || window.innerWidth, window.screen.height || window.innerHeight);
  if (!touchFirst || shortestScreenSide > 1024) return false;

  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

export function getAppLockStatus(signal?: AbortSignal): Promise<ServerAppLockStatus> {
  return appLockRequest<ServerAppLockStatus>("status", { signal });
}

export function createAppLock(pin: string): Promise<ServerAppLockStatus> {
  return appLockRequest<ServerAppLockStatus>("pin", { method: "POST", body: JSON.stringify({ pin }) });
}

export function verifyAppLockPin(pin: string): Promise<{ verified: true }> {
  return appLockRequest<{ verified: true }>("pin/verify", { method: "POST", body: JSON.stringify({ pin }) });
}

export function removeAppLock(pin: string): Promise<ServerAppLockStatus> {
  return appLockRequest<ServerAppLockStatus>("disable", { method: "POST", body: JSON.stringify({ pin }) });
}

export async function registerBiometricUnlock(pin: string): Promise<ServerAppLockStatus> {
  const optionsJSON = await appLockRequest<PublicKeyCredentialCreationOptionsJSON>("webauthn/register/options", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
  try {
    const credential = await startRegistration({ optionsJSON });
    return await appLockRequest<ServerAppLockStatus>("webauthn/register/verify", {
      method: "POST",
      body: JSON.stringify(credential),
    });
  } catch (error) {
    if (error instanceof AppLockApiError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "NotAllowedError") throw new AppLockApiError("أُلغيت عملية حماية الجهاز أو انتهى وقتها.", 400);
    if (name === "InvalidStateError") throw new AppLockApiError("حماية هذا الجهاز مسجلة مسبقًا لهذا الحساب.", 409);
    throw new AppLockApiError("لم يتمكن الجهاز من تفعيل البصمة أو حماية الجهاز.", 400);
  }
}

export async function startSignedOutBiometricAuthentication(): Promise<AuthenticationResponseJSON> {
  const optionsJSON = await passkeyLoginRequest<PublicKeyCredentialRequestOptionsJSON>("options", { method: "POST" });
  try {
    return await startAuthentication({ optionsJSON });
  } catch (error) {
    if (error instanceof AppLockApiError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "NotAllowedError") throw new AppLockApiError("أُلغيت عملية الدخول أو انتهى وقتها. استخدم كلمة المرور عند الحاجة.", 400);
    throw new AppLockApiError("تعذّر تسجيل الدخول بحماية الجهاز. استخدم كلمة المرور.", 400);
  }
}

export function verifySignedOutBiometricAuthentication<T>(credential: AuthenticationResponseJSON): Promise<T> {
  return passkeyLoginRequest<T>("verify", { method: "POST", body: JSON.stringify(credential) });
}

export async function authenticateWithBiometric(): Promise<{ verified: true }> {
  const optionsJSON = await appLockRequest<PublicKeyCredentialRequestOptionsJSON>("webauthn/authenticate/options", { method: "POST" });
  try {
    const credential = await startAuthentication({ optionsJSON });
    return await appLockRequest<{ verified: true }>("webauthn/authenticate/verify", {
      method: "POST",
      body: JSON.stringify(credential),
    });
  } catch (error) {
    if (error instanceof AppLockApiError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "NotAllowedError") throw new AppLockApiError("أُلغيت عملية التحقق أو انتهى وقتها. استخدم رمز القفل عند الحاجة.", 400);
    throw new AppLockApiError("تعذّر فتح التطبيق بحماية الجهاز. استخدم رمز القفل.", 400);
  }
}

export function removeBiometricUnlock(pin: string): Promise<ServerAppLockStatus> {
  return appLockRequest<ServerAppLockStatus>("webauthn/disable", { method: "POST", body: JSON.stringify({ pin }) });
}
