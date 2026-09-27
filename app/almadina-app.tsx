"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { requestApiJSON, validSnapshotEnvelope, canAcceptPolledSnapshot } from "./lib/api-transport";
import type { IScannerControls } from "@zxing/browser";
import { readBrowserPermission } from "./lib/browser-permissions";
import { LinkedDevicesError, requestLinkedDevices } from "./lib/linked-devices";
import { AppLockScreen } from "./components/app-lock-screen";
import { ApplicationShell } from "./components/application-shell";
import { Authentication } from "./components/auth";
import { Icon } from "./components/icon";
import { Avatar, Brand, Button, Field, IconButton, Modal } from "./components/ui";
import { AppContext, type ConfirmOptions, type RegistrationChallenge, type RegistrationFormValues, type ScannerPurpose, type ToastKind, type View } from "./lib/app-context";
import { forgetAvailableAccount, rememberAvailableAccount } from "./lib/available-accounts";
import { AppLockApiError, authenticateWithBiometric, createAppLock, detectBiometricAvailability, getAppLockStatus, registerBiometricUnlock, removeAppLock, removeBiometricUnlock, startSignedOutBiometricAuthentication, verifyAppLockPin, verifySignedOutBiometricAuthentication, type AppLockState } from "./lib/app-lock-client";
import { createSeedDatabase, defaultPreferences, uid, type Database, type LinkedDevice, type Notice, type NoticeAudience, type Preferences, type Order, type Recipient } from "./lib/data";
import {
  PhoneNotificationError,
  disablePhoneNotifications as disableSystemNotifications,
  enablePhoneNotifications as enableSystemNotifications,
  initialPhoneNotificationState,
  inspectPhoneNotifications,
  sendPhoneNotificationTest,
  type PhoneNotificationState,
} from "./lib/phone-notifications";

type Toast = { id: string; message: string; kind: ToastKind };
type SharedSnapshot = { database: Database; revision: number; userId: string; recipientCount?: number; removedCount?: number; prepared?: boolean };
type DatabaseUpdater = (current: Database) => Database;
type ThemePreference = Preferences["theme"];
type WebkitAudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

const THEME_STORAGE_KEY = "almadina-express-theme";
const BACKGROUND_LOCK_DELAY = 15_000;
const EMPTY_APP_LOCK: AppLockState = {
  ready: false,
  enabled: false,
  locked: false,
  biometricEnabled: false,
  biometricLoginReady: false,
  biometricAvailable: false,
};

function rememberSnapshotAccount(snapshot: SharedSnapshot): void {
  const account = snapshot.database.users.find((entry) => entry.id === snapshot.userId);
  if (account) rememberAvailableAccount({ id: account.id, name: account.name, email: account.email, store: account.store, role: account.role, avatarColor: account.avatarColor });
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function acknowledgedNoticeIdsForUser(notices: Notice[], userId: string): Set<string> {
  return new Set(notices.filter((notice) => notice.userId === userId && notice.read).map((notice) => notice.id));
}

async function prepareNotificationAudio(context: AudioContext): Promise<boolean> {
  if (context.state === "closed") return false;

  try {
    if (context.state !== "running") await context.resume();
    if (context.state !== "running") return false;

    // Safari on iPhone requires an audio source to start inside a user gesture,
    // even when resume() reports that the context is running.
    const buffer = context.createBuffer(1, 1, context.sampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    return true;
  } catch {
    return false;
  }
}

async function playNotificationChime(context: AudioContext | null): Promise<boolean> {
  if (!context || context.state === "closed") return false;

  try {
    if (context.state !== "running") await context.resume();
    if (context.state !== "running") return false;

    const now = context.currentTime;
    const playTone = (frequency: number, offset: number, duration: number, volume: number) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + offset;
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    };

    playTone(720, 0, 0.2, 0.24);
    playTone(960, 0.16, 0.28, 0.2);
    return true;
  } catch {
    return false;
  }
}

class SharedApiError extends Error {
  status: number;
  snapshot?: SharedSnapshot;

  constructor(message: string, status: number, snapshot?: SharedSnapshot) {
    super(message);
    this.status = status;
    this.snapshot = snapshot;
  }
}

function readableAppLockError(error: unknown, fallback: string): string {
  if (error instanceof AppLockApiError) return error.message;
  return fallback;
}

async function sharedRequest(path: string, options: RequestInit = {}): Promise<SharedSnapshot> {
  const result = await requestApiJSON(path, options);
  const response = result.response;
  const payload = result.payload as Partial<SharedSnapshot> & { error?: string };
  if (!response.ok) {
    const snapshot = validSnapshotEnvelope(payload) && payload.database && typeof payload.revision === "number" && payload.userId
      ? { database: payload.database, revision: payload.revision, userId: payload.userId }
      : undefined;
    throw new SharedApiError(payload.error ?? "تعذّر الاتصال بخادم المدينة إكسبرس.", response.status, snapshot);
  }

  if (!validSnapshotEnvelope(payload) || !payload.database || typeof payload.revision !== "number" || !payload.userId) {
    throw new SharedApiError("استجابة خادم المدينة إكسبرس غير مكتملة.", 500);
  }

  return {
    database: payload.database,
    revision: payload.revision,
    userId: payload.userId,
    ...(typeof payload.recipientCount === "number" ? { recipientCount: payload.recipientCount } : {}),
    ...(typeof payload.removedCount === "number" ? { removedCount: payload.removedCount } : {}),
    ...(typeof payload.prepared === "boolean" ? { prepared: payload.prepared } : {}),
  };
}

export function ScannerOverlay({ employeeMode = false, purpose = "lookup", onClose, onDetected }: { employeeMode?: boolean; purpose?: ScannerPurpose; onClose: () => void; onDetected: (value: string) => void }) {
  const cameraOnly = purpose === "assign-parcel-code";
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const handledRef = useRef(false);
  const stopCameraRef = useRef<() => void>(() => {});
  const [manual, setManual] = useState("");
  const [cameraFailed, setCameraFailed] = useState(false);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [message, setMessage] = useState("جارٍ تشغيل الكاميرا...");

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    const video = videoRef.current;
    let controls: IScannerControls | null = null;
    let stream: MediaStream | null = null;
    let active = true;
    let failed = false;
    handledRef.current = false;

    function stopCamera() {
      active = false;
      controls?.stop();
      stream?.getTracks().forEach((track) => {
        track.removeEventListener("ended", cameraEnded);
        track.stop();
      });
      if (video) { video.pause(); video.srcObject = null; }
    }

    function cameraEnded() {
      if (!active || handledRef.current) return;
      failed = true;
      stopCamera();
      setCameraFailed(true);
      setMessage("توقفت الكاميرا. أعد تشغيلها لمتابعة قراءة كود QR.");
    }

    stopCameraRef.current = stopCamera;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraFailed(true);
        setMessage(cameraOnly ? "تعذّر الوصول للكاميرا. افتح الموقع برابط آمن واسمح باستخدام الكاميرا." : "الكاميرا تحتاج HTTPS أو localhost — أدخل رقم التتبع يدويًا.");
        return;
      }
      try {
        if (!video) return;
        const permission = await readBrowserPermission("camera");
        if (!active) return;
        if (permission === "denied") {
          setCameraFailed(true);
          setMessage("إذن الكاميرا مرفوض. اسمح به من إعدادات الموقع في المتصفح ثم عد إلى الماسح.");
          return;
        }
        const { CameraQrReader, isQrFrameMiss } = await import("./lib/qr-camera-reader");
        if (!active) return;

        const reader = new CameraQrReader(undefined, {
          delayBetweenScanAttempts: 180,
          delayBetweenScanSuccess: 500,
          tryPlayVideoTimeout: 5_000,
        });
        // Keep ownership while the permission prompt is pending. The reader's
        // decodeFromConstraints otherwise attaches a late stream after close.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
        stream.getVideoTracks().forEach((track) => track.addEventListener("ended", cameraEnded));
        const nextControls = await reader.decodeFromStream(stream, video, (result, error, scannerControls) => {
          if (!active || handledRef.current) return;
          if (error) {
            // These three results mean the current frame has no readable QR.
            // Other errors terminate ZXing's loop and need an explicit retry.
            if (isQrFrameMiss(error)) return;
            failed = true;
            scannerControls.stop();
            stopCamera();
            setCameraFailed(true);
            setMessage("تعذّرت قراءة صورة الكاميرا. أعد تشغيلها وحاول مجددًا.");
            return;
          }
          if (!result) return;
          const value = result.getText().trim();
          if (!value) return;
          handledRef.current = true;
          scannerControls.stop();
          stopCamera();
          onDetectedRef.current(value);
        });

        if (!active || failed || handledRef.current) { nextControls.stop(); return; }
        controls = nextControls;
        setMessage(cameraOnly ? "امسح كود QR المطبوع لإضافته إلى الطرد" : employeeMode ? "ضع كود QR للطرد داخل الإطار" : "ضع رمز QR داخل الإطار");
      } catch (error) {
        if (!active) return;
        stopCamera();
        setCameraFailed(true);
        const errorName = error instanceof Error ? error.name : "";
        if (errorName === "NotAllowedError" || errorName === "SecurityError") {
          setMessage("تم رفض إذن الكاميرا — اسمح للموقع باستخدامها ثم حاول مجددًا.");
        } else if (errorName === "NotFoundError" || errorName === "OverconstrainedError") {
          setMessage(cameraOnly ? "لم يتم العثور على كاميرا. افتح تفاصيل الطرد من جهاز مزوّد بكاميرا." : "لم يتم العثور على كاميرا مناسبة — أدخل رقم التتبع يدويًا.");
        } else if (errorName === "NotReadableError") {
          setMessage("الكاميرا مستخدمة في تطبيق آخر — أغلقه ثم حاول مجددًا.");
        } else {
          setMessage(cameraOnly ? "تعذّر تشغيل قارئ QR. أعد تشغيل الكاميرا وحاول مجددًا." : "تعذّر تشغيل قارئ QR — يمكنك إدخال الرقم يدويًا.");
        }
      }
    }

    void start();
    return stopCamera;
  }, [employeeMode, cameraOnly, cameraAttempt]);

  useEffect(() => {
    if (!cameraFailed) return;
    let active = true;
    let restarted = false;
    const checkAfterSettings = async () => {
      if (document.visibilityState !== "visible") return;
      const permission = await readBrowserPermission("camera");
      if (!active || restarted || permission !== "granted") return;
      restarted = true;
      setCameraFailed(false);
      setMessage("جارٍ تشغيل الكاميرا...");
      setCameraAttempt((attempt) => attempt + 1);
    };
    window.addEventListener("focus", checkAfterSettings);
    document.addEventListener("visibilitychange", checkAfterSettings);
    return () => {
      active = false;
      window.removeEventListener("focus", checkAfterSettings);
      document.removeEventListener("visibilitychange", checkAfterSettings);
    };
  }, [cameraFailed]);

  function finishManualEntry() {
    if (handledRef.current || !manual.trim()) return;
    handledRef.current = true;
    stopCameraRef.current();
    onDetectedRef.current(manual.trim());
  }

  return <div role="dialog" aria-modal="true" aria-label="مسح كود QR" className={`scanner-overlay ${employeeMode ? "scanner-overlay--employee" : ""}`}><video key={`${cameraOnly}-${employeeMode}-${cameraAttempt}`} ref={videoRef} autoPlay playsInline muted className="scanner-overlay__video" /><IconButton name="close" label="إغلاق الماسح" className="scanner-overlay__close" onClick={() => { stopCameraRef.current(); onClose(); }} /><div className="scanner-frame"><i /><i /><i /><i /><span /></div><div className="scanner-overlay__footer"><h2 aria-live="polite">{message}</h2><p>{cameraOnly ? "وجّه الكاميرا إلى ملصق الأكواد الذي استلمته من الشركة. سيُحفظ الكود لهذا الطرد بعد التحقق منه." : employeeMode ? "ضع كود QR الموجود على ملصق الشحن داخل الإطار. يقبل النظام الطرود الجاهزة للإرسال والطرود الراجعة." : "ضع رمز QR داخل الإطار ليُقرأ تلقائيًا."}</p>{cameraFailed && <Button icon="camera" onClick={() => { setCameraFailed(false); setMessage("جارٍ تشغيل الكاميرا..."); setCameraAttempt((attempt) => attempt + 1); }}>إعادة تشغيل الكاميرا</Button>}{!cameraOnly && <div className="scanner-manual"><Field aria-label="رقم التتبع" placeholder="ALX-20200001" value={manual} onChange={(event) => setManual(event.target.value.toUpperCase())} dir="ltr" /><Button disabled={!manual.trim()} onClick={finishManualEntry}>{employeeMode ? "تأكيد الشحن" : "بحث"}</Button></div>}</div></div>;
}

function ConfirmModal({ options, onClose }: { options: ConfirmOptions; onClose: () => void }) {
  const [submitting, setSubmitting] = useState(false);

  async function confirmAction() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const completed = await options.onConfirm();
      if (completed === false) return setSubmitting(false);
      onClose();
    } catch {
      setSubmitting(false);
    }
  }

  return <Modal closeDisabled={submitting} onClose={onClose} className={`confirm-modal ${options.danger ? "confirm-modal--danger" : ""}`}><span className="confirm-modal__icon"><Icon name={options.danger ? "alert" : "info"} size={29} /></span><h2>{options.title}</h2><p>{options.message}</p><div className="confirm-modal__actions"><Button loading={submitting} variant={options.danger ? "danger" : "primary"} onClick={() => { void confirmAction(); }}>{options.confirmLabel ?? "تأكيد"}</Button><Button variant="secondary" disabled={submitting} onClick={onClose}>إلغاء</Button></div></Modal>;
}

export default function AlmadinaApplication() {
  const [database, setDatabase] = useState<Database>(() => createSeedDatabase());
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [appLock, setAppLock] = useState<AppLockState>(EMPTY_APP_LOCK);
  const [view, setViewState] = useState<View>("home");
  const [anonymousPreferences, setAnonymousPreferences] = useState<Preferences>(defaultPreferences);
  const [phoneNotifications, setPhoneNotifications] = useState<PhoneNotificationState>(initialPhoneNotificationState);
  const notificationStateVersion = useRef(0);
  const notificationPermissionAction = useRef(false);
  const [activeTheme, setActiveTheme] = useState<ThemePreference>(defaultPreferences.theme);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions | null>(null);
  const [accountSwitcher, setAccountSwitcher] = useState(false);
  const [accountSwitcherLogoutBusy, setAccountSwitcherLogoutBusy] = useState(false);
  const [scanner, setScanner] = useState<{ callback?: (value: string) => void; purpose?: ScannerPurpose; epoch: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const authoritativeDatabase = useRef<Database | null>(null);
  const visibleDatabase = useRef<Database>(database);
  const serverRevision = useRef(0);
  const pendingUpdates = useRef<DatabaseUpdater[]>([]);
  const broadcastRequestIds = useRef<Map<string, string>>(new Map());
  const remoteMutationInFlight = useRef(false);
  const savingUpdates = useRef(false);
  const logoutInFlight = useRef(false);
  const sessionEpoch = useRef(0);
  const storedThemePreference = useRef<ThemePreference | null>(null);
  const knownNoticeIds = useRef<Set<string>>(new Set());
  const noticeBaselineUserId = useRef<string | null>(null);
  const notificationAudioContext = useRef<AudioContext | null>(null);
  const notificationSoundEnabled = useRef(false);
  const pendingNotificationChime = useRef(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    let unlocking = false;
    const unlock = () => {
      if (unlocking) return;

      try {
        const AudioContextConstructor = window.AudioContext ?? (window as WebkitAudioWindow).webkitAudioContext;
        if (!AudioContextConstructor) return;
        const context = notificationAudioContext.current?.state === "closed"
          ? new AudioContextConstructor()
          : notificationAudioContext.current ?? new AudioContextConstructor();
        notificationAudioContext.current = context;

        unlocking = true;
        void prepareNotificationAudio(context).then(async (ready) => {
          unlocking = false;
          if (!ready || !pendingNotificationChime.current) return;

          if (!notificationSoundEnabled.current) {
            pendingNotificationChime.current = false;
            return;
          }

          pendingNotificationChime.current = false;
          const played = await playNotificationChime(context);
          if (!played) pendingNotificationChime.current = true;
        }).catch(() => {
          unlocking = false;
        });
      } catch {
        unlocking = false;
        // Audio support is optional and must never interrupt the application.
      }
    };

    document.addEventListener("pointerdown", unlock, { passive: true });
    document.addEventListener("touchend", unlock, { passive: true });
    document.addEventListener("keydown", unlock);
    const recoverPendingSound = () => {
      if (document.visibilityState === "visible" && pendingNotificationChime.current) unlock();
    };
    document.addEventListener("visibilitychange", recoverPendingSound);
    window.addEventListener("pageshow", recoverPendingSound);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("touchend", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", recoverPendingSound);
      window.removeEventListener("pageshow", recoverPendingSound);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let hydratedTheme: ThemePreference | null = null;
    try {
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemePreference(storedTheme)) {
        storedThemePreference.current = storedTheme;
        hydratedTheme = storedTheme;
      }
      localStorage.removeItem("almadina-express-database-v2");
      localStorage.removeItem("almadina-express-session-v2");
    } catch { /* Browser storage is optional for appearance preferences. */ }

    const preferenceHydration = window.setTimeout(() => {
      if (!active || !hydratedTheme) return;
      setActiveTheme(hydratedTheme);
      setAnonymousPreferences((current) => ({ ...current, theme: hydratedTheme! }));
    }, 0);

    async function restoreSession() {
      try {
        const snapshot = await sharedRequest("session");
        if (!active) return;
        const account = snapshot.database.users.find((entry) => entry.id === snapshot.userId);
        if (!account) return;
        rememberSnapshotAccount(snapshot);

        const biometricAvailable = await detectBiometricAvailability();
        let restoredLock: AppLockState;
        try {
          const status = await getAppLockStatus();
          restoredLock = { ...status, ready: true, locked: status.enabled, biometricAvailable };
        } catch {
          restoredLock = {
            ready: true,
            enabled: true,
            locked: true,
            biometricEnabled: false,
            biometricLoginReady: false,
            biometricAvailable,
            error: "تعذّر التحقق من حالة قفل التطبيق. أعد المحاولة أو سجّل الخروج.",
          };
        }

        const accountTheme = snapshot.database.preferences[account.id]?.theme;
        if (!storedThemePreference.current && isThemePreference(accountTheme)) {
          storedThemePreference.current = accountTheme;
          setActiveTheme(accountTheme);
          setAnonymousPreferences((current) => ({ ...current, theme: accountTheme }));
          try { localStorage.setItem(THEME_STORAGE_KEY, accountTheme); } catch { /* Browser storage is optional. */ }
        }

        sessionEpoch.current += 1;
        authoritativeDatabase.current = snapshot.database;
        visibleDatabase.current = snapshot.database;
        serverRevision.current = snapshot.revision;
        noticeBaselineUserId.current = account.id;
        knownNoticeIds.current = acknowledgedNoticeIdsForUser(snapshot.database.notices, account.id);
        setDatabase(snapshot.database);
        setUserId(account.id);
        setAppLock(restoredLock);
        setViewState(account.role === "admin" ? "admin" : "home");
      } catch {
        // An anonymous visitor simply remains on the sign-in screen.
      } finally {
        if (active) setSessionReady(true);
      }
    }

    void restoreSession();
    return () => { active = false; window.clearTimeout(preferenceHydration); };
  }, []);

  const user = useMemo(() => database.users.find((entry) => entry.id === userId) ?? null, [database.users, userId]);
  const storedPreferences = user ? { ...defaultPreferences, ...(database.preferences[user.id] ?? {}) } : anonymousPreferences;
  const preferences = { ...storedPreferences, theme: activeTheme };
  const currentUserRole = user?.role;

  useEffect(() => {
    if (!userId) {
      const resetTimer = window.setTimeout(() => setPhoneNotifications(initialPhoneNotificationState), 0);
      return () => window.clearTimeout(resetTimer);
    }

    let active = true;
    let checking = false;
    const refreshPermission = async () => {
      if (checking || notificationPermissionAction.current || document.visibilityState !== "visible") return;
      checking = true;
      const version = notificationStateVersion.current;
      try {
        const state = await inspectPhoneNotifications(true);
        if (active && version === notificationStateVersion.current) setPhoneNotifications(state);
      } finally { checking = false; }
    };
    void refreshPermission();
    window.addEventListener("focus", refreshPermission);
    document.addEventListener("visibilitychange", refreshPermission);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshPermission);
      document.removeEventListener("visibilitychange", refreshPermission);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const navigationTimer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const notificationOrderId = params.get("notificationOrder")?.trim();
      if (notificationOrderId) {
        setSelectedOrderId(notificationOrderId);
        setViewState("order-detail");
      } else if (params.get("openNotifications") === "1") {
        setViewState("notifications");
      } else {
        return;
      }
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
    }, 0);
    return () => window.clearTimeout(navigationTimer);
  }, [userId]);

  useEffect(() => {
    notificationSoundEnabled.current = Boolean(userId && preferences.notifications && preferences.sounds);
    if (!notificationSoundEnabled.current) pendingNotificationChime.current = false;
  }, [userId, preferences.notifications, preferences.sounds]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { const dark = preferences.theme === "dark" || (preferences.theme === "system" && media.matches); document.documentElement.dataset.theme = dark ? "dark" : "light"; document.documentElement.style.colorScheme = dark ? "dark" : "light"; };
    apply(); media.addEventListener("change", apply); return () => media.removeEventListener("change", apply);
  }, [preferences.theme]);

  useEffect(() => {
    if (!userId || !appLock.enabled) {
      backgroundedAt.current = null;
      return;
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        backgroundedAt.current = Date.now();
        return;
      }
      if (backgroundedAt.current && Date.now() - backgroundedAt.current >= BACKGROUND_LOCK_DELAY) {
        setAppLock((current) => current.enabled ? { ...current, locked: true } : current);
      }
      backgroundedAt.current = null;
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [userId, appLock.enabled]);

  useEffect(() => {
    if (!userId || !currentUserRole) {
      noticeBaselineUserId.current = null;
      knownNoticeIds.current = new Set();
      pendingNotificationChime.current = false;
      return;
    }

    if (noticeBaselineUserId.current !== userId) {
      noticeBaselineUserId.current = userId;
      knownNoticeIds.current = acknowledgedNoticeIdsForUser(database.notices, userId);
      return;
    }

    const newNotices = database.notices.filter((notice) => notice.userId === userId && !knownNoticeIds.current.has(notice.id));
    if (!newNotices.length) return;
    newNotices.forEach((notice) => knownNoticeIds.current.add(notice.id));

    if (preferences.notifications && preferences.sounds && newNotices.some((notice) => !notice.read)) {
      const context = notificationAudioContext.current;
      if (!context) {
        pendingNotificationChime.current = true;
        return;
      }

      pendingNotificationChime.current = false;
      void playNotificationChime(context).then((played) => {
        if (!played) pendingNotificationChime.current = true;
        else navigator.vibrate?.([120, 70, 120]);
      });
    }
  }, [database.notices, userId, currentUserRole, preferences.notifications, preferences.sounds]);

  useEffect(() => {
    if (!userId || !("serviceWorker" in navigator)) return;
    const receiveForegroundPush = (event: MessageEvent) => {
      const payload = event.data as { type?: unknown; noticeId?: unknown } | null;
      if (!payload || payload.type !== "almadina-push-received" || typeof payload.noticeId !== "string") return;
      knownNoticeIds.current.add(payload.noticeId);
      if (document.visibilityState !== "visible" || !preferences.notifications || !preferences.sounds) return;
      const context = notificationAudioContext.current;
      if (!context) {
        pendingNotificationChime.current = true;
        return;
      }
      void playNotificationChime(context).then((played) => {
        if (!played) pendingNotificationChime.current = true;
        else navigator.vibrate?.([120, 70, 120]);
      });
    };
    navigator.serviceWorker.addEventListener("message", receiveForegroundPush);
    return () => navigator.serviceWorker.removeEventListener("message", receiveForegroundPush);
  }, [userId, preferences.notifications, preferences.sounds]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let inFlight = false;
    let pendingController: AbortController | null = null;
    const operationEpoch = sessionEpoch.current;

    async function synchronize() {
      if (!active || inFlight || document.visibilityState === "hidden" || savingUpdates.current || remoteMutationInFlight.current || pendingUpdates.current.length) return;
      inFlight = true;
      pendingController = new AbortController();
      try {
        const snapshot = await sharedRequest("database", { signal: pendingController.signal });
        if (!active || operationEpoch !== sessionEpoch.current || savingUpdates.current || remoteMutationInFlight.current || pendingUpdates.current.length || !canAcceptPolledSnapshot(userId!, serverRevision.current, snapshot)) return;
        rememberSnapshotAccount(snapshot);
        authoritativeDatabase.current = snapshot.database;
        visibleDatabase.current = snapshot.database;
        serverRevision.current = snapshot.revision;
        setDatabase(snapshot.database);
      } catch (error) {
        if (active && operationEpoch === sessionEpoch.current && error instanceof SharedApiError && error.status === 401) {
          sessionEpoch.current += 1;
          authoritativeDatabase.current = null;
          pendingUpdates.current = [];
          setUserId(null);
          setViewState("home");
          setSelectedOrderId(null);
        }
      } finally {
        inFlight = false;
        pendingController = null;
      }
    }

    const timer = window.setInterval(() => { void synchronize(); }, 6_000);
    const onVisible = () => { if (document.visibilityState === "visible") void synchronize(); };
    const onFocus = () => { void synchronize(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      pendingController?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [userId]);

  async function savePendingUpdates(): Promise<void> {
    if (savingUpdates.current || remoteMutationInFlight.current || logoutInFlight.current || !authoritativeDatabase.current) return;
    const operationEpoch = sessionEpoch.current;
    savingUpdates.current = true;

    try {
      while (pendingUpdates.current.length && authoritativeDatabase.current && !logoutInFlight.current) {
        const update = pendingUpdates.current[0];
        const next = update(authoritativeDatabase.current);

        try {
          const snapshot = await sharedRequest("database", {
            method: "PUT",
            body: JSON.stringify({ database: next, revision: serverRevision.current }),
          });
          if (operationEpoch !== sessionEpoch.current) return;

          rememberSnapshotAccount(snapshot);
          authoritativeDatabase.current = snapshot.database;
          serverRevision.current = snapshot.revision;
          pendingUpdates.current.shift();
          visibleDatabase.current = pendingUpdates.current.reduce((current, pending) => pending(current), snapshot.database);
          setDatabase(visibleDatabase.current);
        } catch (error) {
          if (operationEpoch !== sessionEpoch.current || logoutInFlight.current) return;
          if (error instanceof SharedApiError && error.status === 409 && error.snapshot) {
            authoritativeDatabase.current = error.snapshot.database;
            serverRevision.current = error.snapshot.revision;
            visibleDatabase.current = pendingUpdates.current.reduce((current, pending) => pending(current), error.snapshot!.database);
            setDatabase(visibleDatabase.current);
            continue;
          }

          if (error instanceof SharedApiError && error.status === 401) {
            pendingUpdates.current = [];
            authoritativeDatabase.current = null;
            setUserId(null);
            setViewState("home");
            showToast("انتهت الجلسة. سجّل الدخول مرة أخرى.", "error");
            return;
          }

          if (
            error instanceof SharedApiError
            && error.status >= 400
            && error.status < 500
            && error.status !== 408
            && error.status !== 429
          ) {
            pendingUpdates.current = [];
            visibleDatabase.current = authoritativeDatabase.current;
            setDatabase(authoritativeDatabase.current);
            showToast(`${error.message} لم يُطبّق التعديل وأُعيدت آخر بيانات محفوظة.`, "error");
            return;
          }

          showToast(error instanceof Error ? error.message : "تعذّر حفظ التغييرات على الخادم.", "error");
          window.setTimeout(() => { void savePendingUpdates(); }, 2_500);
          return;
        }
      }
    } finally {
      savingUpdates.current = false;
    }
  }

  function updateDatabase(updater: DatabaseUpdater) {
    if (logoutInFlight.current) return showToast("جارٍ تسجيل الخروج؛ لم يتم تطبيق تعديل جديد.", "info");
    if (!authoritativeDatabase.current) return showToast("يجب تسجيل الدخول قبل تعديل البيانات.", "error");
    visibleDatabase.current = updater(visibleDatabase.current);
    setDatabase(visibleDatabase.current);
    pendingUpdates.current.push(updater);
    void savePendingUpdates();
  }

  async function waitForPendingUpdates(): Promise<boolean> {
    if (logoutInFlight.current) return false;
    const deadline = Date.now() + 6_000;
    while ((savingUpdates.current || remoteMutationInFlight.current || pendingUpdates.current.length) && Date.now() < deadline) {
      if (!savingUpdates.current && pendingUpdates.current.length) void savePendingUpdates();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    }
    return !savingUpdates.current && !remoteMutationInFlight.current && pendingUpdates.current.length === 0;
  }

  async function saveParcelRequest(path: string, payload: unknown | (() => unknown)): Promise<boolean> {
    if (!await waitForPendingUpdates()) {
      showToast("انتظر اكتمال الحفظ ثم أعد المحاولة.", "error");
      return false;
    }
    const operationEpoch = sessionEpoch.current;
    remoteMutationInFlight.current = true;
    try {
      const snapshot = await sharedRequest(path, { method: "POST", body: JSON.stringify(typeof payload === "function" ? payload() : payload) });
      if (operationEpoch !== sessionEpoch.current) return false;
      authoritativeDatabase.current = snapshot.database;
      serverRevision.current = snapshot.revision;
      visibleDatabase.current = pendingUpdates.current.reduce((current, update) => update(current), snapshot.database);
      setDatabase(visibleDatabase.current);
      return true;
    } catch (error) {
      if (operationEpoch !== sessionEpoch.current) return false;
      if (error instanceof SharedApiError && error.status === 401) clearLocalSession();
      if (error instanceof SharedApiError && error.status === 409 && error.snapshot) {
        authoritativeDatabase.current = error.snapshot.database;
        serverRevision.current = error.snapshot.revision;
        visibleDatabase.current = pendingUpdates.current.reduce((current, update) => update(current), error.snapshot!.database);
        setDatabase(visibleDatabase.current);
      }
      showToast(error instanceof Error ? error.message : "تعذّر حفظ البيانات. أعد المحاولة.", "error");
      return false;
    } finally {
      remoteMutationInFlight.current = false;
      if (pendingUpdates.current.length) void savePendingUpdates();
    }
  }

  async function createParcels(orders: Order[], recipients: Recipient[] = []): Promise<boolean> {
    return saveParcelRequest("orders", { orders, recipients });
  }

  async function purgeTrash(orderIds: string[], invoiceIds: string[]): Promise<boolean> {
    const saved = await saveParcelRequest("trash/purge", () => ({ revision: serverRevision.current, orderIds, invoiceIds }));
    if (saved) showToast("تم حذف العناصر المحددة من سلة المحذوفات.");
    return saved;
  }

  async function assignParcelCode(orderId: string, trackingNumber: string): Promise<boolean> {
    return saveParcelRequest("orders/assign-code", { orderId, trackingNumber });
  }

  async function generateParcelCodes(requestId: string, count: number, label: string): Promise<boolean> {
    if (user?.role !== "admin") return false;
    return saveParcelRequest("parcel-code-batches", { requestId, count, label });
  }

  async function verifyCollectionCode(invoiceId: string, verificationCode: string): Promise<boolean> {
    if (!await waitForPendingUpdates()) {
      showToast("انتظر اكتمال حفظ التغييرات ثم أعد قراءة الكود.", "error");
      return false;
    }

    const operationEpoch = sessionEpoch.current;
    try {
      const snapshot = await sharedRequest("collections/verify", {
        method: "POST",
        body: JSON.stringify({ invoiceId, verificationCode }),
      });
      if (operationEpoch !== sessionEpoch.current) return false;
      authoritativeDatabase.current = snapshot.database;
      visibleDatabase.current = snapshot.database;
      serverRevision.current = snapshot.revision;
      pendingUpdates.current = [];
      setDatabase(snapshot.database);
      showToast("تم التحقق من الكود وتحديث حالة الفاتورة إلى «تم التسليم».");
      return true;
    } catch (error) {
      if (operationEpoch !== sessionEpoch.current) return false;
      if (error instanceof SharedApiError) {
        if (error.status === 401) clearLocalSession();
        showToast(error.message, "error");
        return false;
      }
      showToast("تعذّر التحقق من الكود. حاول مجددًا.", "error");
      return false;
    }
  }

  async function prepareCollectionInvoice(invoiceId: string): Promise<boolean> {
    if (!await waitForPendingUpdates()) {
      showToast("انتظر اكتمال حفظ التغييرات ثم أعد تجهيز الفاتورة.", "error");
      return false;
    }

    const operationEpoch = sessionEpoch.current;
    remoteMutationInFlight.current = true;
    try {
      const snapshot = await sharedRequest("collections/prepare", {
        method: "POST",
        body: JSON.stringify({ invoiceId }),
      });
      if (operationEpoch !== sessionEpoch.current) return false;
      authoritativeDatabase.current = snapshot.database;
      visibleDatabase.current = snapshot.database;
      serverRevision.current = snapshot.revision;
      pendingUpdates.current = [];
      setDatabase(snapshot.database);
      showToast(snapshot.prepared === false ? "الفاتورة مجهزة بالفعل." : "تم تجهيز فاتورة التحصيل للمستخدم.");
      return true;
    } catch (error) {
      if (operationEpoch !== sessionEpoch.current) return false;
      if (error instanceof SharedApiError) {
        if (error.status === 401) clearLocalSession();
        showToast(error.message, "error");
        return false;
      }
      showToast("تعذّر تجهيز الفاتورة. حاول مجددًا.", "error");
      return false;
    } finally {
      remoteMutationInFlight.current = false;
      if (pendingUpdates.current.length) void savePendingUpdates();
    }
  }

  async function broadcastNotice(values: { audience: NoticeAudience; recipientUserId?: string; title: string; message: string }): Promise<number | null> {
    if (!user || user.role !== "admin") {
      showToast("هذه الميزة متاحة للمسؤول فقط.", "error");
      return null;
    }
    if (!await waitForPendingUpdates()) {
      showToast("انتظر اكتمال حفظ التغييرات ثم أعد إرسال الإشعار.", "error");
      return null;
    }

    const requestKey = JSON.stringify([values.audience, values.recipientUserId ?? "", values.title.trim(), values.message.trim()]);
    const requestId = broadcastRequestIds.current.get(requestKey) ?? uid("broadcast");
    broadcastRequestIds.current.set(requestKey, requestId);
    const operationEpoch = sessionEpoch.current;
    remoteMutationInFlight.current = true;

    try {
      const snapshot = await sharedRequest("notices/broadcast", {
        method: "POST",
        body: JSON.stringify({ requestId, ...values }),
      });
      if (operationEpoch !== sessionEpoch.current) return null;
      authoritativeDatabase.current = snapshot.database;
      serverRevision.current = snapshot.revision;
      visibleDatabase.current = pendingUpdates.current.reduce((current, update) => update(current), snapshot.database);
      setDatabase(visibleDatabase.current);
      const recipientCount = snapshot.recipientCount ?? snapshot.database.notices.filter((notice) => notice.broadcastId === requestId).length;
      broadcastRequestIds.current.delete(requestKey);
      return recipientCount;
    } catch (error) {
      if (operationEpoch !== sessionEpoch.current) return null;
      if (error instanceof SharedApiError) {
        if (error.snapshot) {
          authoritativeDatabase.current = error.snapshot.database;
          serverRevision.current = error.snapshot.revision;
          visibleDatabase.current = pendingUpdates.current.reduce((current, update) => update(current), error.snapshot.database);
          setDatabase(visibleDatabase.current);
        }
        if (error.status === 401) clearLocalSession();
        showToast(error.message, "error");
        return null;
      }
      showToast("تعذّر إرسال الإشعار. حاول مجددًا.", "error");
      return null;
    } finally {
      remoteMutationInFlight.current = false;
      if (pendingUpdates.current.length) void savePendingUpdates();
    }
  }

  async function clearNotices(noticeIds: string[]): Promise<number | null> {
    if (!user || !noticeIds.length) return 0;
    if (!await waitForPendingUpdates()) {
      showToast("انتظر اكتمال حفظ التغييرات ثم أعد مسح الإشعارات.", "error");
      return null;
    }

    const operationEpoch = sessionEpoch.current;
    remoteMutationInFlight.current = true;
    try {
      const snapshot = await sharedRequest("notices/clear", {
        method: "POST",
        body: JSON.stringify({ noticeIds }),
      });
      if (operationEpoch !== sessionEpoch.current) return null;
      authoritativeDatabase.current = snapshot.database;
      serverRevision.current = snapshot.revision;
      visibleDatabase.current = pendingUpdates.current.reduce((current, update) => update(current), snapshot.database);
      setDatabase(visibleDatabase.current);
      return snapshot.removedCount ?? 0;
    } catch (error) {
      if (operationEpoch !== sessionEpoch.current) return null;
      if (error instanceof SharedApiError) {
        if (error.snapshot) {
          authoritativeDatabase.current = error.snapshot.database;
          serverRevision.current = error.snapshot.revision;
          visibleDatabase.current = pendingUpdates.current.reduce((current, update) => update(current), error.snapshot.database);
          setDatabase(visibleDatabase.current);
        }
        if (error.status === 401) clearLocalSession();
        showToast(error.message, "error");
        return null;
      }
      showToast("تعذّر مسح الإشعارات. حاول مجددًا.", "error");
      return null;
    } finally {
      remoteMutationInFlight.current = false;
      if (pendingUpdates.current.length) void savePendingUpdates();
    }
  }

  async function shipScannedOrder(trackingNumber: string): Promise<boolean> {
    const operationEpoch = sessionEpoch.current;
    const normalizedTrackingNumber = trackingNumber.trim().toUpperCase();
    try {
      const snapshot = await sharedRequest("orders/scan", {
        method: "POST",
        body: JSON.stringify({ trackingNumber }),
      });
      if (operationEpoch !== sessionEpoch.current) return false;
      authoritativeDatabase.current = snapshot.database;
      visibleDatabase.current = snapshot.database;
      serverRevision.current = snapshot.revision;
      pendingUpdates.current = [];
      setDatabase(snapshot.database);
      showToast(`تم تحديث الطرد ${normalizedTrackingNumber} إلى حالة «مشحون».`);
      return true;
    } catch (error) {
      if (operationEpoch !== sessionEpoch.current) return false;
      if (error instanceof SharedApiError) {
        if (error.status === 401) clearLocalSession();
        showToast(error.message, "error");
        return false;
      }
      showToast("تعذّر تحديث حالة الطرد. حاول مسح الكود مجددًا.", "error");
      return false;
    }
  }

  function showToast(message: string, kind: ToastKind = "success") {
    const id = uid("toast"); setToasts((current) => [...current, { id, message, kind }]); window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3_200);
  }

  function setView(next: View) { setViewState(next); window.scrollTo({ top: 0, behavior: "smooth" }); }

  async function refreshAppLock(): Promise<void> {
    try {
      const [status, biometricAvailable] = await Promise.all([getAppLockStatus(), detectBiometricAvailability()]);
      setAppLock((current) => ({ ...status, ready: true, locked: status.enabled && current.locked, biometricAvailable }));
    } catch (error) {
      const message = readableAppLockError(error, "تعذّر التحقق من حالة قفل التطبيق.");
      setAppLock((current) => ({ ...current, ready: true, locked: true, error: message }));
      showToast(message, "error");
    }
  }

  async function enableAppLock(pin: string): Promise<boolean> {
    try {
      const [status, biometricAvailable] = await Promise.all([createAppLock(pin), detectBiometricAvailability()]);
      setAppLock({ ...status, ready: true, locked: false, biometricAvailable });
      showToast("تم تفعيل قفل التطبيق وحفظ الرمز بصورة مشفّرة.");
      return true;
    } catch (error) {
      showToast(readableAppLockError(error, "تعذّر تفعيل قفل التطبيق."), "error");
      return false;
    }
  }

  async function disableAppLock(pin: string): Promise<boolean> {
    try {
      const status = await removeAppLock(pin);
      setAppLock((current) => ({ ...status, ready: true, locked: false, biometricAvailable: current.biometricAvailable }));
      showToast("تم إيقاف قفل التطبيق وإزالة حماية الجهاز المرتبطة به.");
      return true;
    } catch (error) {
      showToast(readableAppLockError(error, "تعذّر إيقاف قفل التطبيق."), "error");
      return false;
    }
  }

  async function enableBiometricUnlock(pin: string): Promise<boolean> {
    const biometricAvailable = await detectBiometricAvailability();
    setAppLock((current) => ({ ...current, biometricAvailable }));
    if (!appLock.enabled) {
      showToast("فعّل قفل التطبيق وحدد رمزًا أولًا.", "info");
      return false;
    }
    if (!biometricAvailable) {
      showToast("حماية الجهاز غير متاحة هنا. استخدم هاتفًا أو iPad يدعمها عبر HTTPS.", "error");
      return false;
    }

    try {
      const status = await registerBiometricUnlock(pin);
      setAppLock((current) => ({ ...status, ready: true, locked: false, biometricAvailable: current.biometricAvailable }));
      showToast("تم ربط قفل التطبيق بحماية هذا الجهاز.");
      return true;
    } catch (error) {
      showToast(readableAppLockError(error, "تعذّر تفعيل حماية الجهاز."), "error");
      return false;
    }
  }

  async function disableBiometricUnlock(pin: string): Promise<boolean> {
    try {
      const status = await removeBiometricUnlock(pin);
      setAppLock((current) => ({ ...status, ready: true, locked: false, biometricAvailable: current.biometricAvailable }));
      showToast("تم إيقاف الدخول بحماية الجهاز.");
      return true;
    } catch (error) {
      showToast(readableAppLockError(error, "تعذّر إيقاف حماية الجهاز."), "error");
      return false;
    }
  }

  async function verifyAppPin(pin: string): Promise<boolean> {
    try {
      await verifyAppLockPin(pin);
      setAppLock((current) => ({ ...current, locked: false, error: undefined }));
      return true;
    } catch (error) {
      showToast(readableAppLockError(error, "رمز القفل غير صحيح."), "error");
      return false;
    }
  }

  async function unlockWithBiometric(): Promise<boolean> {
    try {
      await authenticateWithBiometric();
      setAppLock((current) => ({ ...current, locked: false, error: undefined }));
      return true;
    } catch (error) {
      showToast(readableAppLockError(error, "تعذّر فتح التطبيق بحماية الجهاز."), "error");
      return false;
    }
  }

  function activateSession(snapshot: SharedSnapshot, greeting: string) {
    const account = snapshot.database.users.find((entry) => entry.id === snapshot.userId);
    if (!account) throw new Error("تعذّر تحميل بيانات الحساب من الخادم.");
    rememberSnapshotAccount(snapshot);

    const accountTheme = snapshot.database.preferences[account.id]?.theme;
    if (!storedThemePreference.current && isThemePreference(accountTheme)) {
      storedThemePreference.current = accountTheme;
      setActiveTheme(accountTheme);
      setAnonymousPreferences((current) => ({ ...current, theme: accountTheme }));
      try { localStorage.setItem(THEME_STORAGE_KEY, accountTheme); } catch { /* Browser storage is optional. */ }
    }

    sessionEpoch.current += 1;
    authoritativeDatabase.current = snapshot.database;
    visibleDatabase.current = snapshot.database;
    serverRevision.current = snapshot.revision;
    pendingUpdates.current = [];
    noticeBaselineUserId.current = account.id;
    knownNoticeIds.current = acknowledgedNoticeIdsForUser(snapshot.database.notices, account.id);
    setDatabase(snapshot.database);
    setUserId(account.id);
    setSessionReady(true);
    setAppLock({ ...EMPTY_APP_LOCK, ready: true, locked: false });
    setSelectedOrderId(null);
    setViewState(account.role === "admin" ? "admin" : "home");
    setAccountSwitcher(false);
    void refreshAppLock();
    showToast(greeting);
  }

  async function login(email: string, password: string): Promise<boolean> {
    try {
      const snapshot = await sharedRequest("login", { method: "POST", body: JSON.stringify({ email, password }) });
      const account = snapshot.database.users.find((entry) => entry.id === snapshot.userId);
      activateSession(snapshot, `أهلًا بك، ${account?.name ?? "بك"}.`);
      return true;
    } catch (error) {
      if (error instanceof SharedApiError && error.status === 401) return false;
      throw error;
    }
  }

  async function loginWithBiometric(): Promise<boolean> {
    try {
      const credential = await startSignedOutBiometricAuthentication();
      const snapshot = await verifySignedOutBiometricAuthentication<SharedSnapshot>(credential);
      const account = snapshot.database.users.find((entry) => entry.id === snapshot.userId);
      activateSession(snapshot, `أهلًا بك، ${account?.name ?? "بك"}.`);
      return true;
    } catch (error) {
      showToast(readableAppLockError(error, "تعذّر تسجيل الدخول بحماية الجهاز. استخدم كلمة المرور."), "error");
      return false;
    }
  }

  function clearLocalSession() {
    setScanner(null);
    sessionEpoch.current += 1;
    authoritativeDatabase.current = null;
    pendingUpdates.current = [];
    broadcastRequestIds.current.clear();
    noticeBaselineUserId.current = null;
    knownNoticeIds.current = new Set();
    const anonymous = createSeedDatabase();
    visibleDatabase.current = anonymous;
    setDatabase(anonymous);
    setUserId(null);
    setSessionReady(true);
    setAppLock({ ...EMPTY_APP_LOCK, ready: true });
    setViewState("home");
    setSelectedOrderId(null);
    setAccountSwitcher(false);
  }

  async function logout(): Promise<boolean> {
    if (logoutInFlight.current) return false;
    logoutInFlight.current = true;
    try {
      const response = await fetch("/api/almadina/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("Logout request failed");
      clearLocalSession();
      return true;
    } catch {
      showToast("تعذّر تسجيل الخروج بأمان. تحقق من الاتصال ثم حاول مجددًا.", "error");
      return false;
    } finally {
      logoutInFlight.current = false;
      if (pendingUpdates.current.length) void savePendingUpdates();
    }
  }

  async function logoutFromAccountSwitcher(): Promise<void> {
    if (accountSwitcherLogoutBusy) return;
    setAccountSwitcherLogoutBusy(true);
    const loggedOut = await logout();
    setAccountSwitcherLogoutBusy(false);
    if (loggedOut) setAccountSwitcher(false);
  }

  async function changePassword(currentPassword: string, newPassword: string, confirmPassword: string, signOutAllDevices: boolean): Promise<boolean> {
    if (!user) {
      showToast("يجب تسجيل الدخول أولًا.", "error");
      return false;
    }
    if (!await waitForPendingUpdates()) {
      showToast("انتظر اكتمال حفظ التغييرات ثم حاول تغيير كلمة المرور.", "error");
      return false;
    }

    remoteMutationInFlight.current = true;
    try {
      const response = await fetch("/api/almadina/account/password", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword, signOutAllDevices }),
      });
      const payload = await response.json() as Partial<SharedSnapshot> & { success?: boolean; signedOut?: boolean; error?: string };
      if (!response.ok || !payload.success) {
        throw new SharedApiError(payload.error ?? "تعذّر تغيير كلمة المرور.", response.status);
      }

      if (payload.signedOut) {
        clearLocalSession();
        showToast("تم تغيير كلمة المرور. سجّل الدخول الآن بكلمة المرور الجديدة.");
      } else {
        if (!payload.database || !Number.isSafeInteger(payload.revision) || payload.userId !== user.id) {
          throw new SharedApiError("تم تغيير كلمة المرور، لكن تعذّر تحديث الجلسة. سجّل الدخول مجددًا.", 401);
        }
        authoritativeDatabase.current = payload.database;
        visibleDatabase.current = payload.database;
        serverRevision.current = payload.revision!;
        setDatabase(payload.database);
        showToast("تم تغيير كلمة المرور بنجاح.");
      }
      return true;
    } catch (error) {
      if (error instanceof SharedApiError) {
        if (error.status === 401) clearLocalSession();
        showToast(error.message, "error");
        return false;
      }
      showToast("تعذّر تغيير كلمة المرور. تحقق من الاتصال وحاول مجددًا.", "error");
      return false;
    } finally {
      remoteMutationInFlight.current = false;
    }
  }

  async function listLinkedDevices(): Promise<LinkedDevice[] | null> {
    const operationEpoch = sessionEpoch.current;
    if (!user || logoutInFlight.current) return null;
    try {
      const devices = await requestLinkedDevices({ action: "list" }, user.id);
      return operationEpoch === sessionEpoch.current ? devices : null;
    } catch (error) {
      if (operationEpoch !== sessionEpoch.current) return null;
      if (error instanceof LinkedDevicesError && error.status === 401) clearLocalSession();
      showToast(error instanceof LinkedDevicesError ? error.message : "تعذّر تحميل الأجهزة المرتبطة. تحقق من الاتصال.", "error");
      return null;
    }
  }

  async function mutateLinkedDevice(operation: { action: "revoke"; deviceId: string } | { action: "rename"; label: string }): Promise<LinkedDevice[] | null> {
    const operationEpoch = sessionEpoch.current;
    if (!user || logoutInFlight.current || remoteMutationInFlight.current) return null;
    if (!await waitForPendingUpdates()) {
      if (operationEpoch === sessionEpoch.current) showToast("انتظر اكتمال حفظ التغييرات ثم أعد المحاولة.", "error");
      return null;
    }
    if (operationEpoch !== sessionEpoch.current || logoutInFlight.current || remoteMutationInFlight.current) return null;
    remoteMutationInFlight.current = true;
    try {
      const devices = await requestLinkedDevices(operation, user.id);
      if (operationEpoch !== sessionEpoch.current) return null;
      showToast(operation.action === "rename" ? "تم حفظ اسم هذا الجهاز." : "تم تسجيل خروج الجهاز من حسابك.");
      return devices;
    } catch (error) {
      if (operationEpoch !== sessionEpoch.current) return null;
      if (error instanceof LinkedDevicesError && error.status === 401) clearLocalSession();
      showToast(error instanceof LinkedDevicesError ? error.message : "تعذّر حفظ التغيير. تحقق من الاتصال وأعد المحاولة.", "error");
      return null;
    } finally {
      remoteMutationInFlight.current = false;
      if (operationEpoch === sessionEpoch.current && pendingUpdates.current.length) void savePendingUpdates();
    }
  }

  function revokeLinkedDevice(deviceId: string): Promise<LinkedDevice[] | null> {
    return mutateLinkedDevice({ action: "revoke", deviceId });
  }

  function renameCurrentDevice(label: string): Promise<LinkedDevice[] | null> {
    return mutateLinkedDevice({ action: "rename", label });
  }

  async function submitDeletionOperation(path: "account/deletion-request" | "admin/deletion-requests", payload: Record<string, unknown>): Promise<unknown> {
    if (!await waitForPendingUpdates()) throw new Error("انتظر اكتمال حفظ التغييرات ثم أعد المحاولة.");
    const operationEpoch = sessionEpoch.current;
    remoteMutationInFlight.current = true;
    try {
      const response = await fetch(`/api/almadina/${path}`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "تعذّر حفظ الطلب.");
      if (operationEpoch !== sessionEpoch.current) throw new Error("تغيّر الحساب. افتح حالة الطلب في حسابه.");
      // The request endpoint uses the same CAS state as parcels; sync its new revision before further writes.
      try {
        const snapshot = await sharedRequest("database");
        if (operationEpoch === sessionEpoch.current) {
          authoritativeDatabase.current = snapshot.database;
          serverRevision.current = snapshot.revision;
          visibleDatabase.current = pendingUpdates.current.reduce((current, update) => update(current), snapshot.database);
          setDatabase(visibleDatabase.current);
        }
      } catch { /* A committed deletion request remains successful if the follow-up snapshot is offline. */ }
      return result;
    } finally {
      remoteMutationInFlight.current = false;
      if (pendingUpdates.current.length) void savePendingUpdates();
    }
  }

  async function deleteAccount(password: string, confirmation: string): Promise<boolean> {
    if (!user || user.role === "admin") {
      showToast("لا يمكن حذف حساب المسؤول من داخل التطبيق.", "error");
      return false;
    }
    if (!await waitForPendingUpdates()) {
      showToast("انتظر اكتمال حفظ التغييرات ثم حاول حذف الحساب.", "error");
      return false;
    }

    remoteMutationInFlight.current = true;
    try {
      const response = await fetch("/api/almadina/account/delete", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmation }),
      });
      const payload = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !payload.success) {
        throw new SharedApiError(payload.error ?? "تعذّر حذف الحساب.", response.status);
      }

      forgetAvailableAccount(user.id);
      clearLocalSession();
      showToast("تم حذف حسابك وبياناته المرتبطة نهائيًا.");
      return true;
    } catch (error) {
      if (error instanceof SharedApiError) {
        if (error.status === 401) clearLocalSession();
        showToast(error.message, "error");
        return false;
      }
      showToast("تعذّر حذف الحساب. حاول مجددًا بعد قليل.", "error");
      return false;
    } finally {
      remoteMutationInFlight.current = false;
    }
  }

  async function requestRegistration(values: RegistrationFormValues): Promise<RegistrationChallenge> {
    const response = await fetch("/api/almadina/register/request", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const payload = await response.json().catch(() => ({})) as Partial<RegistrationChallenge> & { success?: boolean; error?: string };
    if (!response.ok || !payload.success) {
      throw new SharedApiError(payload.error ?? "تعذّر إرسال رمز تأكيد البريد الإلكتروني.", response.status);
    }
    if (typeof payload.email !== "string" || !Number.isFinite(payload.expiresIn) || !Number.isFinite(payload.resendAfter)) {
      throw new SharedApiError("استجابة خادم التسجيل غير مكتملة.", 500);
    }
    return { email: payload.email, expiresIn: payload.expiresIn!, resendAfter: payload.resendAfter! };
  }

  async function verifyRegistration(code: string): Promise<boolean> {
    const snapshot = await sharedRequest("register/verify", { method: "POST", body: JSON.stringify({ code }) });
    activateSession(snapshot, "تم تأكيد بريدك وإنشاء حسابك بنجاح. أهلًا بك!");
    return true;
  }

  function updatePreferences(values: Partial<Preferences>) {
    if (values.theme) {
      storedThemePreference.current = values.theme;
      setActiveTheme(values.theme);
      try { localStorage.setItem(THEME_STORAGE_KEY, values.theme); } catch { /* Browser storage is optional. */ }
      if (user) setAnonymousPreferences((current) => ({ ...current, theme: values.theme! }));
    }
    if (user) updateDatabase((current) => ({ ...current, preferences: { ...current.preferences, [user.id]: { ...defaultPreferences, ...(current.preferences[user.id] ?? {}), ...values } } }));
    else setAnonymousPreferences((current) => ({ ...current, ...values }));
  }

  function getNotificationAudioContext(): AudioContext | null {
    try {
      const AudioContextConstructor = window.AudioContext ?? (window as WebkitAudioWindow).webkitAudioContext;
      if (!AudioContextConstructor) return null;
      const context = notificationAudioContext.current?.state === "closed"
        ? new AudioContextConstructor()
        : notificationAudioContext.current ?? new AudioContextConstructor();
      notificationAudioContext.current = context;
      return context;
    } catch {
      return null;
    }
  }

  async function playLocalNotificationFeedback(): Promise<boolean> {
    const context = getNotificationAudioContext();
    if (!context || !await prepareNotificationAudio(context)) return false;
    const played = await playNotificationChime(context);
    if (played) navigator.vibrate?.([120, 70, 120]);
    return played;
  }

  async function setNotificationSounds(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      updatePreferences({ sounds: false });
      showToast("تم إيقاف صوت الإشعارات داخل التطبيق.", "info");
      return true;
    }

    if (!await playLocalNotificationFeedback()) {
      showToast("تعذّر تشغيل الصوت. تأكد من إيقاف الوضع الصامت وارفع مستوى صوت الهاتف، ثم حاول مجددًا.", "error");
      return false;
    }
    updatePreferences({ sounds: true });
    showToast("تم تفعيل صوت الإشعارات داخل التطبيق.");
    return true;
  }

  async function enablePhoneNotifications(): Promise<boolean> {
    if (notificationPermissionAction.current) return false;
    notificationPermissionAction.current = true;
    notificationStateVersion.current += 1;
    try {
      const state = await enableSystemNotifications();
      setPhoneNotifications(state);
      updatePreferences({ notifications: true });
      showToast("تم تفعيل إشعارات الهاتف لهذا الحساب والجهاز.");
      return true;
    } catch (error) {
      showToast(error instanceof PhoneNotificationError ? error.message : "تعذّر تفعيل إشعارات الهاتف.", "error");
      return false;
    } finally {
      notificationPermissionAction.current = false;
      notificationStateVersion.current += 1;
    }
  }

  async function disablePhoneNotifications(): Promise<boolean> {
    if (notificationPermissionAction.current) return false;
    notificationPermissionAction.current = true;
    notificationStateVersion.current += 1;
    try {
      const state = await disableSystemNotifications();
      setPhoneNotifications(state);
      showToast("تم إيقاف إشعارات الهاتف على هذا الجهاز.", "info");
      return true;
    } catch (error) {
      showToast(error instanceof PhoneNotificationError ? error.message : "تعذّر إيقاف إشعارات الهاتف.", "error");
      return false;
    } finally {
      notificationPermissionAction.current = false;
      notificationStateVersion.current += 1;
    }
  }

  async function testPhoneNotifications(): Promise<boolean> {
    const localSoundPlayed = await playLocalNotificationFeedback();
    if (!phoneNotifications.subscribed) {
      showToast(
        localSoundPlayed
          ? "تم تشغيل صوت الاختبار داخل التطبيق. فعّل إشعارات الهاتف لاختبارها عند إغلاق التطبيق."
          : "تعذّر تشغيل الصوت. أوقف الوضع الصامت وارفع مستوى الصوت ثم حاول مجددًا.",
        localSoundPlayed ? "info" : "error",
      );
      return localSoundPlayed;
    }

    try {
      await sendPhoneNotificationTest();
      showToast("تم إرسال إشعار اختبار إلى هذا الهاتف.");
      return true;
    } catch (error) {
      showToast(error instanceof PhoneNotificationError ? error.message : "تعذّر إرسال إشعار الاختبار.", "error");
      return false;
    }
  }

  function notify(values: Omit<Notice, "id" | "read" | "createdAt">) {
    const notice: Notice = { ...values, id: uid("notice"), read: false, createdAt: new Date().toISOString() };
    knownNoticeIds.current.add(notice.id);
    updateDatabase((current) => ({ ...current, notices: [notice, ...current.notices] }));
  }

  function onScan(value: string) {
    const currentScanner = scanner; setScanner(null);
    if (!value.trim() || !currentScanner || currentScanner.epoch !== sessionEpoch.current) return;
    if (currentScanner.callback) return currentScanner.callback(value);
    if (user?.role === "courier") { void shipScannedOrder(value.trim().toUpperCase()); return; }
    const order = database.orders.find((entry) => entry.trackingNumber.toUpperCase() === value.trim().toUpperCase() && !entry.deleted);
    if (!order) return showToast("لم نعثر على طرد بهذا الرقم.", "error");
    if (user && user.role !== "admin" && order.merchantId !== user.id) return showToast("هذا الطرد غير مرتبط بحسابك.", "error");
    if (user) { setSelectedOrderId(order.id); setView("order-detail"); showToast("تم العثور على الطرد."); } else showToast(`الطرد ${order.trackingNumber}: ${order.recipientName}.`, "info");
  }

  const content = !sessionReady
    ? <main className="session-loading"><Brand /><span className="spinner" /><p>جارٍ التحقق من الجلسة الآمنة...</p></main>
    : user
      ? appLock.locked ? <AppLockScreen /> : <ApplicationShell />
      : <Authentication />;

  return <AppContext.Provider value={{ database, user, view, preferences, phoneNotifications, appLock, selectedOrderId, setSelectedOrderId, setView, updateDatabase, createParcels, assignParcelCode, generateParcelCodes, purgeTrash, updatePreferences, setNotificationSounds, enablePhoneNotifications, disablePhoneNotifications, testPhoneNotifications, enableAppLock, disableAppLock, enableBiometricUnlock, disableBiometricUnlock, verifyAppPin, unlockWithBiometric, refreshAppLock, login, loginWithBiometric, logout, requestRegistration, verifyRegistration, changePassword, listLinkedDevices, revokeLinkedDevice, renameCurrentDevice, deleteAccount, submitDeletionOperation, prepareCollectionInvoice, verifyCollectionCode, broadcastNotice, clearNotices, shipScannedOrder, showToast, confirm: setConfirmOptions, notify, openScanner: (callback, options) => setScanner({ callback, purpose: options?.purpose, epoch: sessionEpoch.current }), openAccountSwitcher: () => setAccountSwitcher(true) }}>
    {content}
    {!appLock.locked && confirmOptions && <ConfirmModal options={confirmOptions} onClose={() => setConfirmOptions(null)} />}
    {!appLock.locked && accountSwitcher && user && <Modal title="تبديل الحساب" closeDisabled={accountSwitcherLogoutBusy} onClose={() => setAccountSwitcher(false)} sheet><p className="modal-description">لحماية خصوصيتك، سجّل الخروج ثم استخدم كلمة المرور أو بصمة الجهاز المفعّلة للحساب الآخر.</p><div className="account-list"><div className="account-entry is-active"><Avatar name={user.name} color={user.avatarColor} /><span><strong>{user.name}</strong><small>{user.role === "admin" ? "حساب الإدارة" : user.role === "courier" ? "حساب موظف · مندوب" : user.store}</small></span><Icon name="check" size={20} /></div></div><Button variant="outline" icon="logout" full loading={accountSwitcherLogoutBusy} onClick={() => { void logoutFromAccountSwitcher(); }}>{accountSwitcherLogoutBusy ? "جارٍ تسجيل الخروج..." : "تسجيل الخروج وتبديل الحساب"}</Button></Modal>}
    {!appLock.locked && scanner && <ScannerOverlay purpose={scanner.purpose} employeeMode={user?.role === "courier"} onClose={() => setScanner(null)} onDetected={onScan} />}
    <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`toast toast--${toast.kind}`}><Icon name={toast.kind === "error" ? "alert" : toast.kind === "info" ? "info" : "check"} size={19} />{toast.message}</div>)}</div>
  </AppContext.Provider>;
}
