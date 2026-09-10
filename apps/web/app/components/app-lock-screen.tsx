"use client";

import { useState } from "react";
import { useApp } from "../lib/app-context";
import { Icon } from "./icon";
import { Brand, Button } from "./ui";

const keypad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "delete"];

export function AppLockScreen() {
  const { appLock, verifyAppPin, unlockWithBiometric, refreshAppLock, logout } = useApp();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [error, setError] = useState("");
  const operationBusy = busy || logoutBusy;

  async function submitPin(value: string) {
    setBusy(true);
    setError("");
    const verified = await verifyAppPin(value);
    setBusy(false);
    if (!verified) {
      setPin("");
      setError("تعذّر فتح التطبيق. تحقق من الرمز وحاول مجددًا.");
    }
  }

  function press(value: string) {
    if (operationBusy) return;
    if (value === "clear") { setPin(""); setError(""); return; }
    if (value === "delete") { setPin((current) => current.slice(0, -1)); setError(""); return; }
    const next = `${pin}${value}`.slice(0, 4);
    setPin(next);
    setError("");
    if (next.length === 4) void submitPin(next);
  }

  async function handleBiometricUnlock() {
    if (operationBusy) return;
    setBusy(true);
    setError("");
    const verified = await unlockWithBiometric();
    setBusy(false);
    if (!verified) setError("لم يتم التحقق من حماية الجهاز. يمكنك استخدام رمز القفل.");
  }

  async function handleLogout() {
    if (operationBusy) return;
    setLogoutBusy(true);
    setError("");
    const loggedOut = await logout();
    if (!loggedOut) {
      setLogoutBusy(false);
      setError("تعذّر تسجيل الخروج بأمان. تحقق من الاتصال وحاول مجددًا.");
    }
  }

  return <main className="app-lock-screen" dir="rtl">
    <section className="app-lock-panel" aria-labelledby="app-lock-title">
      <Brand />
      <span className="app-lock-panel__icon"><Icon name="lock" size={34} /></span>
      <div className="app-lock-panel__heading"><h1 id="app-lock-title">التطبيق مقفل</h1><p>أدخل رمز القفل المكوّن من 4 أرقام لفتح حسابك.</p></div>
      <div className="pin-dots" aria-label={`تم إدخال ${pin.length} من 4 أرقام`}>{[0, 1, 2, 3].map((index) => <span key={index} className={index < pin.length ? "is-filled" : ""} />)}</div>
      <div className="pin-keypad app-lock-keypad">{keypad.map((value) => <button type="button" key={value} disabled={operationBusy} aria-label={value === "clear" ? "مسح الرمز" : value === "delete" ? "حذف الرقم الأخير" : `الرقم ${value}`} onClick={() => press(value)}>{value === "clear" ? "C" : value === "delete" ? <Icon name="arrowLeft" size={21} /> : value}</button>)}</div>
      {busy && <p className="app-lock-panel__status" aria-live="polite"><span className="spinner" /> جارٍ التحقق...</p>}
      {error && <p className="app-lock-panel__error" role="alert">{error}</p>}
      {appLock.error && <div className="app-lock-panel__recovery"><p>{appLock.error}</p><Button variant="outline" onClick={() => { void refreshAppLock(); }}>إعادة المحاولة</Button></div>}
      {appLock.biometricEnabled && appLock.biometricAvailable && <Button type="button" icon="fingerprint" variant="secondary" full disabled={operationBusy} onClick={() => { void handleBiometricUnlock(); }}>الفتح بحماية الجهاز</Button>}
      <button type="button" className="app-lock-panel__logout" disabled={operationBusy} aria-busy={logoutBusy} onClick={() => { void handleLogout(); }}>{logoutBusy ? "جارٍ تسجيل الخروج..." : "تسجيل الخروج"}</button>
      <small>بعد الخروج يمكنك استخدام كلمة المرور أو حماية الجهاز إذا كانت مفعّلة للدخول.</small>
    </section>
  </main>;
}
