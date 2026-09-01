"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { ApplicationShell } from "./components/application-shell";
import { Authentication } from "./components/auth";
import { Icon } from "./components/icon";
import { Avatar, Button, Field, IconButton, Modal } from "./components/ui";
import { AppContext, type ConfirmOptions, type ToastKind, type View } from "./lib/app-context";
import { forgetAvailableAccount, rememberAvailableAccount } from "./lib/available-accounts";
import { createSeedDatabase, defaultPreferences, uid, type Database, type Notice, type NoticeAudience, type Preferences, type User } from "./lib/data";

type Toast = { id: string; message: string; kind: ToastKind };
type SharedSnapshot = { database: Database; revision: number; userId: string; recipientCount?: number };
type DatabaseUpdater = (current: Database) => Database;
type ThemePreference = Preferences["theme"];
type WebkitAudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

const THEME_STORAGE_KEY = "almadina-express-theme";

function rememberSnapshotAccount(snapshot: SharedSnapshot): void {
  const account = snapshot.database.users.find((entry) => entry.id === snapshot.userId);
  if (account) rememberAvailableAccount({ id: account.id, name: account.name, email: account.email, store: account.store, role: account.role, avatarColor: account.avatarColor });
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function noticeIdsForUser(notices: Notice[], userId: string): Set<string> {
  return new Set(notices.filter((notice) => notice.userId === userId).map((notice) => notice.id));
}

async function playNotificationChime(context: AudioContext | null): Promise<void> {
  if (!context || context.state === "closed") return;

  try {
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") return;

    const now = context.currentTime;
    const playTone = (frequency: number, offset: number, duration: number, volume: number) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + offset;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    };

    playTone(720, 0, 0.2, 0.11);
    playTone(960, 0.16, 0.28, 0.085);
  } catch {
    // Some browsers block audio until the first user interaction; notifications must remain usable without sound.
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

async function sharedRequest(path: string, options: RequestInit = {}): Promise<SharedSnapshot> {
  const response = await fetch(`/api/almadina/${path}`, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options.headers },
  });

  const payload = await response.json() as Partial<SharedSnapshot> & { error?: string };
  if (!response.ok) {
    const snapshot = payload.database && typeof payload.revision === "number" && payload.userId
      ? { database: payload.database, revision: payload.revision, userId: payload.userId }
      : undefined;
    throw new SharedApiError(payload.error ?? "تعذّر الاتصال بخادم المدينة إكسبرس.", response.status, snapshot);
  }

  if (!payload.database || typeof payload.revision !== "number" || !payload.userId) {
    throw new SharedApiError("استجابة خادم المدينة إكسبرس غير مكتملة.", 500);
  }

  return {
    database: payload.database,
    revision: payload.revision,
    userId: payload.userId,
    ...(typeof payload.recipientCount === "number" ? { recipientCount: payload.recipientCount } : {}),
  };
}

function ScannerOverlay({ employeeMode = false, onClose, onDetected }: { employeeMode?: boolean; onClose: () => void; onDetected: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const handledRef = useRef(false);
  const [manual, setManual] = useState("");
  const [message, setMessage] = useState("جارٍ تشغيل الكاميرا...");

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    const video = videoRef.current;
    let controls: IScannerControls | null = null;
    let active = true;
    handledRef.current = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setMessage("الكاميرا تحتاج HTTPS أو localhost — أدخل رقم التتبع يدويًا."); return; }
      try {
        if (!video) return;
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (!active) return;

        const reader = new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 180,
          delayBetweenScanSuccess: 500,
          tryPlayVideoTimeout: 5_000,
        });
        const nextControls = await reader.decodeFromConstraints({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        }, video, (result, _error, scannerControls) => {
          if (!active || handledRef.current || !result) return;
          const value = result.getText().trim();
          if (!value) return;
          handledRef.current = true;
          scannerControls.stop();
          onDetectedRef.current(value);
        });

        if (!active) { nextControls.stop(); return; }
        controls = nextControls;
        setMessage(employeeMode ? "ضع كود QR للطرد داخل الإطار" : "ضع رمز QR داخل الإطار");
      } catch (error) {
        if (!active) return;
        const errorName = error instanceof DOMException ? error.name : "";
        if (errorName === "NotAllowedError" || errorName === "SecurityError") {
          setMessage("تم رفض إذن الكاميرا — اسمح للموقع باستخدامها ثم حاول مجددًا.");
        } else if (errorName === "NotFoundError" || errorName === "OverconstrainedError") {
          setMessage("لم يتم العثور على كاميرا مناسبة — أدخل رقم التتبع يدويًا.");
        } else if (errorName === "NotReadableError") {
          setMessage("الكاميرا مستخدمة في تطبيق آخر — أغلقه ثم حاول مجددًا.");
        } else {
          setMessage("تعذّر تشغيل قارئ QR — يمكنك إدخال الرقم يدويًا.");
        }
      }
    }

    void start();
    return () => {
      active = false;
      controls?.stop();
      const stream = video?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [employeeMode]);

  return <div className={`scanner-overlay ${employeeMode ? "scanner-overlay--employee" : ""}`}><video ref={videoRef} playsInline muted className="scanner-overlay__video" /><IconButton name="close" label="إغلاق الماسح" className="scanner-overlay__close" onClick={onClose} /><div className="scanner-frame"><i /><i /><i /><i /><span /></div><div className="scanner-overlay__footer"><h2 aria-live="polite">{message}</h2><p>{employeeMode ? "ضع كود QR الموجود على ملصق الشحن داخل الإطار. يقبل النظام فقط الطرود الجاهزة للإرسال." : "ضع رمز QR داخل الإطار ليُقرأ تلقائيًا."}</p><div className="scanner-manual"><Field placeholder="ALX-20200001" value={manual} onChange={(event) => setManual(event.target.value.toUpperCase())} dir="ltr" /><Button disabled={!manual.trim()} onClick={() => onDetectedRef.current(manual.trim())}>{employeeMode ? "تأكيد الشحن" : "بحث"}</Button></div></div></div>;
}

function ConfirmModal({ options, onClose }: { options: ConfirmOptions; onClose: () => void }) {
  return <Modal onClose={onClose} className={`confirm-modal ${options.danger ? "confirm-modal--danger" : ""}`}><span className="confirm-modal__icon"><Icon name={options.danger ? "alert" : "info"} size={29} /></span><h2>{options.title}</h2><p>{options.message}</p><div className="confirm-modal__actions"><Button variant={options.danger ? "danger" : "primary"} onClick={() => { onClose(); options.onConfirm(); }}>{options.confirmLabel ?? "تأكيد"}</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></div></Modal>;
}

export default function AlmadinaApplication() {
  const [database, setDatabase] = useState<Database>(() => createSeedDatabase());
  const [userId, setUserId] = useState<string | null>(null);
  const [view, setViewState] = useState<View>("home");
  const [anonymousPreferences, setAnonymousPreferences] = useState<Preferences>(defaultPreferences);
  const [activeTheme, setActiveTheme] = useState<ThemePreference>(defaultPreferences.theme);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions | null>(null);
  const [accountSwitcher, setAccountSwitcher] = useState(false);
  const [scanner, setScanner] = useState<{ callback?: (value: string) => void } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const authoritativeDatabase = useRef<Database | null>(null);
  const visibleDatabase = useRef<Database>(database);
  const serverRevision = useRef(0);
  const pendingUpdates = useRef<DatabaseUpdater[]>([]);
  const broadcastRequestIds = useRef<Map<string, string>>(new Map());
  const remoteMutationInFlight = useRef(false);
  const savingUpdates = useRef(false);
  const storedThemePreference = useRef<ThemePreference | null>(null);
  const knownNoticeIds = useRef<Set<string>>(new Set());
  const noticeBaselineUserId = useRef<string | null>(null);
  const notificationAudioContext = useRef<AudioContext | null>(null);

  useEffect(() => {
    let unlocking = false;
    const removeUnlockListeners = () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
    const unlock = () => {
      if (unlocking) return;

      try {
        const AudioContextConstructor = window.AudioContext ?? (window as WebkitAudioWindow).webkitAudioContext;
        if (!AudioContextConstructor) {
          removeUnlockListeners();
          return;
        }
        const context = notificationAudioContext.current?.state === "closed"
          ? new AudioContextConstructor()
          : notificationAudioContext.current ?? new AudioContextConstructor();
        notificationAudioContext.current = context;
        if (context.state === "running") {
          removeUnlockListeners();
          return;
        }

        unlocking = true;
        void context.resume().then(() => {
          unlocking = false;
          if (context.state === "running") removeUnlockListeners();
        }).catch(() => {
          unlocking = false;
        });
      } catch {
        unlocking = false;
        // Audio support is optional and must never interrupt the application.
      }
    };

    document.addEventListener("pointerdown", unlock, { passive: true });
    document.addEventListener("keydown", unlock);
    return removeUnlockListeners;
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

        const accountTheme = snapshot.database.preferences[account.id]?.theme;
        if (!storedThemePreference.current && isThemePreference(accountTheme)) {
          storedThemePreference.current = accountTheme;
          setActiveTheme(accountTheme);
          setAnonymousPreferences((current) => ({ ...current, theme: accountTheme }));
          try { localStorage.setItem(THEME_STORAGE_KEY, accountTheme); } catch { /* Browser storage is optional. */ }
        }

        authoritativeDatabase.current = snapshot.database;
        visibleDatabase.current = snapshot.database;
        serverRevision.current = snapshot.revision;
        noticeBaselineUserId.current = account.id;
        knownNoticeIds.current = noticeIdsForUser(snapshot.database.notices, account.id);
        setDatabase(snapshot.database);
        setUserId(account.id);
        setViewState(account.role === "admin" ? "admin" : "home");
      } catch {
        // An anonymous visitor simply remains on the sign-in screen.
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
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { const dark = preferences.theme === "dark" || (preferences.theme === "system" && media.matches); document.documentElement.dataset.theme = dark ? "dark" : "light"; document.documentElement.style.colorScheme = dark ? "dark" : "light"; };
    apply(); media.addEventListener("change", apply); return () => media.removeEventListener("change", apply);
  }, [preferences.theme]);

  useEffect(() => {
    if (!userId || !currentUserRole) {
      noticeBaselineUserId.current = null;
      knownNoticeIds.current = new Set();
      return;
    }

    if (noticeBaselineUserId.current !== userId) {
      noticeBaselineUserId.current = userId;
      knownNoticeIds.current = noticeIdsForUser(database.notices, userId);
      return;
    }

    const newNotices = database.notices.filter((notice) => notice.userId === userId && !knownNoticeIds.current.has(notice.id));
    if (!newNotices.length) return;
    newNotices.forEach((notice) => knownNoticeIds.current.add(notice.id));

    if (currentUserRole !== "admin" && preferences.notifications && preferences.sounds && newNotices.some((notice) => !notice.read)) {
      void playNotificationChime(notificationAudioContext.current);
    }
  }, [database.notices, userId, currentUserRole, preferences.notifications, preferences.sounds]);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    async function synchronize() {
      if (!active || savingUpdates.current || remoteMutationInFlight.current || pendingUpdates.current.length) return;

      try {
        const snapshot = await sharedRequest("database");
        if (!active || savingUpdates.current || remoteMutationInFlight.current || pendingUpdates.current.length || snapshot.revision === serverRevision.current) return;
        rememberSnapshotAccount(snapshot);
        authoritativeDatabase.current = snapshot.database;
        visibleDatabase.current = snapshot.database;
        serverRevision.current = snapshot.revision;
        setDatabase(snapshot.database);
      } catch (error) {
        if (active && error instanceof SharedApiError && error.status === 401) {
          authoritativeDatabase.current = null;
          pendingUpdates.current = [];
          setUserId(null);
          setViewState("home");
          setSelectedOrderId(null);
        }
      }
    }

    const timer = window.setInterval(() => { void synchronize(); }, 6_000);
    const onVisible = () => { if (document.visibilityState === "visible") void synchronize(); };
    const onFocus = () => { void synchronize(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [userId]);

  async function savePendingUpdates(): Promise<void> {
    if (savingUpdates.current || remoteMutationInFlight.current || !authoritativeDatabase.current) return;
    savingUpdates.current = true;

    try {
      while (pendingUpdates.current.length && authoritativeDatabase.current) {
        const update = pendingUpdates.current[0];
        const next = update(authoritativeDatabase.current);

        try {
          const snapshot = await sharedRequest("database", {
            method: "PUT",
            body: JSON.stringify({ database: next, revision: serverRevision.current }),
          });

          rememberSnapshotAccount(snapshot);
          authoritativeDatabase.current = snapshot.database;
          serverRevision.current = snapshot.revision;
          pendingUpdates.current.shift();
          visibleDatabase.current = pendingUpdates.current.reduce((current, pending) => pending(current), snapshot.database);
          setDatabase(visibleDatabase.current);
        } catch (error) {
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
    if (!authoritativeDatabase.current) return showToast("يجب تسجيل الدخول قبل تعديل البيانات.", "error");
    visibleDatabase.current = updater(visibleDatabase.current);
    setDatabase(visibleDatabase.current);
    pendingUpdates.current.push(updater);
    void savePendingUpdates();
  }

  async function waitForPendingUpdates(): Promise<boolean> {
    const deadline = Date.now() + 6_000;
    while ((savingUpdates.current || pendingUpdates.current.length) && Date.now() < deadline) {
      if (!savingUpdates.current && pendingUpdates.current.length) void savePendingUpdates();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    }
    return !savingUpdates.current && pendingUpdates.current.length === 0;
  }

  async function verifyCollectionCode(invoiceId: string, verificationCode: string): Promise<boolean> {
    if (!await waitForPendingUpdates()) {
      showToast("انتظر اكتمال حفظ التغييرات ثم أعد قراءة الكود.", "error");
      return false;
    }

    try {
      const snapshot = await sharedRequest("collections/verify", {
        method: "POST",
        body: JSON.stringify({ invoiceId, verificationCode }),
      });
      authoritativeDatabase.current = snapshot.database;
      visibleDatabase.current = snapshot.database;
      serverRevision.current = snapshot.revision;
      pendingUpdates.current = [];
      setDatabase(snapshot.database);
      showToast("تم التحقق من الكود وتحديث حالة التحصيل إلى «مشحون».");
      return true;
    } catch (error) {
      if (error instanceof SharedApiError) {
        if (error.status === 401) logout();
        showToast(error.message, "error");
        return false;
      }
      showToast("تعذّر التحقق من الكود. حاول مجددًا.", "error");
      return false;
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
    remoteMutationInFlight.current = true;

    try {
      const snapshot = await sharedRequest("notices/broadcast", {
        method: "POST",
        body: JSON.stringify({ requestId, ...values }),
      });
      authoritativeDatabase.current = snapshot.database;
      serverRevision.current = snapshot.revision;
      visibleDatabase.current = pendingUpdates.current.reduce((current, update) => update(current), snapshot.database);
      setDatabase(visibleDatabase.current);
      const recipientCount = snapshot.recipientCount ?? snapshot.database.notices.filter((notice) => notice.broadcastId === requestId).length;
      broadcastRequestIds.current.delete(requestKey);
      return recipientCount;
    } catch (error) {
      if (error instanceof SharedApiError) {
        if (error.snapshot) {
          authoritativeDatabase.current = error.snapshot.database;
          serverRevision.current = error.snapshot.revision;
          visibleDatabase.current = pendingUpdates.current.reduce((current, update) => update(current), error.snapshot.database);
          setDatabase(visibleDatabase.current);
        }
        if (error.status === 401) logout();
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

  async function shipScannedOrder(trackingNumber: string): Promise<boolean> {
    try {
      const snapshot = await sharedRequest("orders/scan", {
        method: "POST",
        body: JSON.stringify({ trackingNumber }),
      });
      authoritativeDatabase.current = snapshot.database;
      visibleDatabase.current = snapshot.database;
      serverRevision.current = snapshot.revision;
      pendingUpdates.current = [];
      setDatabase(snapshot.database);
      showToast(`تم تحديث الطرد ${trackingNumber.trim().toUpperCase()} من «جاهز للإرسال» إلى «مشحون».`);
      return true;
    } catch (error) {
      if (error instanceof SharedApiError) {
        if (error.status === 401) logout();
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

    authoritativeDatabase.current = snapshot.database;
    visibleDatabase.current = snapshot.database;
    serverRevision.current = snapshot.revision;
    pendingUpdates.current = [];
    noticeBaselineUserId.current = account.id;
    knownNoticeIds.current = noticeIdsForUser(snapshot.database.notices, account.id);
    setDatabase(snapshot.database);
    setUserId(account.id);
    setSelectedOrderId(null);
    setViewState(account.role === "admin" ? "admin" : "home");
    setAccountSwitcher(false);
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

  function clearLocalSession() {
    authoritativeDatabase.current = null;
    pendingUpdates.current = [];
    broadcastRequestIds.current.clear();
    noticeBaselineUserId.current = null;
    knownNoticeIds.current = new Set();
    const anonymous = createSeedDatabase();
    visibleDatabase.current = anonymous;
    setDatabase(anonymous);
    setUserId(null);
    setViewState("home");
    setSelectedOrderId(null);
    setAccountSwitcher(false);
  }

  function logout() {
    void fetch("/api/almadina/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    clearLocalSession();
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

  async function register(values: Omit<User, "id" | "role" | "joinedAt" | "avatarColor">): Promise<boolean> {
    try {
      const snapshot = await sharedRequest("register", { method: "POST", body: JSON.stringify(values) });
      activateSession(snapshot, "تم إنشاء حسابك بنجاح. أهلًا بك!");
      return true;
    } catch (error) {
      if (error instanceof SharedApiError && error.status === 409) return false;
      throw error;
    }
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

  function notify(values: Omit<Notice, "id" | "read" | "createdAt">) {
    const notice: Notice = { ...values, id: uid("notice"), read: false, createdAt: new Date().toISOString() };
    knownNoticeIds.current.add(notice.id);
    updateDatabase((current) => ({ ...current, notices: [notice, ...current.notices] }));
  }

  function onScan(value: string) {
    const currentScanner = scanner; setScanner(null);
    if (currentScanner?.callback) return currentScanner.callback(value);
    if (user?.role === "courier") { void shipScannedOrder(value.trim().toUpperCase()); return; }
    const order = database.orders.find((entry) => entry.trackingNumber.toUpperCase() === value.trim().toUpperCase() && !entry.deleted);
    if (!order) return showToast("لم نعثر على طرد بهذا الرقم.", "error");
    if (user && user.role !== "admin" && order.merchantId !== user.id) return showToast("هذا الطرد غير مرتبط بحسابك.", "error");
    if (user) { setSelectedOrderId(order.id); setView("order-detail"); showToast("تم العثور على الطرد."); } else showToast(`الطرد ${order.trackingNumber}: ${order.recipientName}.`, "info");
  }

  return <AppContext.Provider value={{ database, user, view, preferences, selectedOrderId, setSelectedOrderId, setView, updateDatabase, updatePreferences, login, logout, register, deleteAccount, verifyCollectionCode, broadcastNotice, shipScannedOrder, showToast, confirm: setConfirmOptions, notify, openScanner: (callback) => setScanner({ callback }), openAccountSwitcher: () => setAccountSwitcher(true) }}>{user ? <ApplicationShell /> : <Authentication />}{confirmOptions && <ConfirmModal options={confirmOptions} onClose={() => setConfirmOptions(null)} />}{accountSwitcher && user && <Modal title="تبديل الحساب" onClose={() => setAccountSwitcher(false)} sheet><p className="modal-description">لحماية خصوصيتك، سجّل الخروج ثم أدخل بيانات الحساب الآخر.</p><div className="account-list"><div className="account-entry is-active"><Avatar name={user.name} color={user.avatarColor} /><span><strong>{user.name}</strong><small>{user.role === "admin" ? "حساب الإدارة" : user.role === "courier" ? "حساب موظف · مندوب" : user.store}</small></span><Icon name="check" size={20} /></div></div><Button variant="outline" icon="logout" full onClick={logout}>تسجيل الخروج وتبديل الحساب</Button></Modal>}{scanner && <ScannerOverlay employeeMode={user?.role === "courier"} onClose={() => setScanner(null)} onDetected={onScan} />}<div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`toast toast--${toast.kind}`}><Icon name={toast.kind === "error" ? "alert" : toast.kind === "info" ? "info" : "check"} size={19} />{toast.message}</div>)}</div></AppContext.Provider>;
}
