"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useApp } from "../lib/app-context";
import { detectBiometricAvailability } from "../lib/app-lock-client";
import { AVAILABLE_ACCOUNTS_EVENT, AVAILABLE_ACCOUNTS_STORAGE_KEY, readAvailableAccounts, type AvailableAccount } from "../lib/available-accounts";
import type { Order } from "../lib/data";
import { Icon } from "./icon";
import { TrackingHistory } from "./tracking-history";
import { Avatar, Brand, Button, Field, IconButton, Modal, StatusPill } from "./ui";

export function Authentication() {
  const { login, loginWithBiometric, register, preferences, updatePreferences, showToast, openScanner } = useApp();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [tracking, setTracking] = useState("");
  const [trackedOrder, setTrackedOrder] = useState<Order | null>(null);
  const [availableAccounts, setAvailableAccounts] = useState<AvailableAccount[]>([]);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", store: "", email: "", password: "", confirm: "" });

  useEffect(() => {
    const hydrateAccounts = () => setAvailableAccounts(readAvailableAccounts());
    const onStorage = (event: StorageEvent) => {
      if (event.key === AVAILABLE_ACCOUNTS_STORAGE_KEY) hydrateAccounts();
    };

    hydrateAccounts();
    window.addEventListener("storage", onStorage);
    window.addEventListener(AVAILABLE_ACCOUNTS_EVENT, hydrateAccounts);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(AVAILABLE_ACCOUNTS_EVENT, hydrateAccounts);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void detectBiometricAvailability().then((available) => { if (active) setBiometricAvailable(available); });
    return () => { active = false; };
  }, []);

  const loginOperationBusy = busy || biometricBusy;
  const passwordToggle = <button type="button" className="field__action" disabled={loginOperationBusy} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}><Icon name={showPassword ? "eyeOff" : "eye"} size={20} /></button>;

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    if (loginOperationBusy) return;
    setError("");
    if (!email.trim() || !password) return setError("أدخل البريد الإلكتروني وكلمة المرور.");
    setBusy(true);
    try {
      if (!await login(email, password)) setError("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "تعذّر الاتصال بالخادم. حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  async function onRegister(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!form.name.trim() || !form.store.trim()) return setError("أدخل الاسم الكامل واسم المتجر.");
    if (!/^05\d{8}$/.test(form.phone)) return setError("أدخل رقم جوال مكوّن من 10 أرقام ويبدأ بـ 05.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return setError("أدخل بريدًا إلكترونيًا صحيحًا.");
    if (form.password.length < 8) return setError("يجب أن تتكوّن كلمة المرور من 8 أحرف على الأقل.");
    if (form.password !== form.confirm) return setError("كلمتا المرور غير متطابقتين.");
    setBusy(true);
    try {
      const created = await register({ name: form.name.trim(), phone: form.phone, store: form.store.trim(), email: form.email.trim().toLowerCase(), password: form.password });
      if (!created) setError("يوجد حساب مسجل بهذا البريد الإلكتروني.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "تعذّر إنشاء الحساب. حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  async function onBiometricLogin() {
    if (loginOperationBusy) return;
    setError("");
    setBiometricBusy(true);
    try {
      await loginWithBiometric();
    } finally {
      setBiometricBusy(false);
    }
  }

  async function findShipment(value: string) {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return showToast("أدخل رقم تتبع الطرد أولًا.", "error");

    try {
      const response = await fetch(`/api/almadina/track?tracking=${encodeURIComponent(normalized)}`, { cache: "no-store" });
      const result = await response.json() as { order?: Order; error?: string };
      if (!response.ok || !result.order) return showToast(result.error ?? "لم نعثر على طرد بهذا الرقم. تحقق من رقم التتبع.", "error");
      setTrackedOrder(result.order);
    } catch {
      showToast("تعذّر الاتصال بالخادم للبحث عن الطرد.", "error");
    }
  }

  function chooseAvailableAccount(account: AvailableAccount) {
    if (loginOperationBusy) return;
    setEmail(account.email);
    setPassword("");
    setError("");
    setAccountsOpen(false);
    showToast(`تم اختيار حساب ${account.name} وملء بريده لتسجيل الدخول بكلمة المرور. عند استخدام حماية الجهاز سيختار الجهاز الحساب المرتبط بالبصمة.`, "info");
  }

  return (
    <main className="auth-page">
      <div className="auth-page__halo auth-page__halo--one" /><div className="auth-page__halo auth-page__halo--two" />
      <div className="auth-top-controls">
        <div className="theme-switch">
          <IconButton name="sun" label="الوضع الفاتح" className={preferences.theme === "light" ? "is-selected" : ""} onClick={() => updatePreferences({ theme: "light" })} />
          <IconButton name="moon" label="الوضع الداكن" className={preferences.theme === "dark" ? "is-selected" : ""} onClick={() => updatePreferences({ theme: "dark" })} />
        </div>
      </div>

      <div className={`auth-shell ${mode === "register" ? "auth-shell--register" : ""}`}>
        <Brand inverse />
        <section className="auth-card" key={mode}>
          <header className="auth-card__header"><h1>{mode === "login" ? "تسجيل الدخول" : "إنشاء حساب جديد"}</h1><p>{mode === "login" ? "أهلًا بعودتك — أدخل بيانات حسابك للمتابعة" : "سجّل متجرك وابدأ التوصيل مع المدينة إكسبرس"}</p></header>
          {mode === "login" ? (
            <form className="auth-form" onSubmit={onLogin} noValidate>
              <Field icon="mail" type="email" placeholder="البريد الإلكتروني" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" dir="ltr" disabled={loginOperationBusy} />
              <Field icon="lock" type={showPassword ? "text" : "password"} placeholder="كلمة المرور" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" suffix={passwordToggle} disabled={loginOperationBusy} />
              {error && <p className="form-error"><Icon name="alert" size={15} />{error}</p>}
              <Button type="submit" full loading={busy} disabled={biometricBusy}>تسجيل الدخول</Button>
              {biometricAvailable && <Button type="button" variant="secondary" icon="fingerprint" full loading={biometricBusy} disabled={busy} onClick={() => { void onBiometricLogin(); }}>الدخول ببصمة الوجه أو حماية الجهاز</Button>}
              <button
                type="button"
                className="available-accounts-button"
                disabled={availableAccounts.length === 0 || loginOperationBusy}
                aria-haspopup="dialog"
                onClick={() => setAccountsOpen(true)}
              >
                <span className="available-accounts-button__icon"><Icon name="users" size={20} /></span>
                <span className="available-accounts-button__copy"><strong>الحسابات المتاحة</strong><small>{availableAccounts.length ? `${availableAccounts.length.toLocaleString("ar-EG")} حساب على هذا الجهاز` : "لا توجد حسابات مسجلة على هذا الجهاز"}</small></span>
                {availableAccounts.length ? <span className="available-accounts-button__count">{availableAccounts.length.toLocaleString("ar-EG")}</span> : <Icon name="lock" size={17} />}
              </button>
              <div className="auth-divider"><span>أو</span></div>
              <p className="auth-switch">ليس لديك حساب؟ <button type="button" disabled={loginOperationBusy} onClick={() => { setMode("register"); setError(""); }}>أنشئ حسابًا جديدًا</button></p>
            </form>
          ) : (
            <form className="auth-form" onSubmit={onRegister} noValidate>
              <Field icon="user" placeholder="الاسم الكامل" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoComplete="name" />
              <Field icon="phone" placeholder="05xxxxxxxx" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value.replace(/[^\d]/g, "").slice(0, 10) })} inputMode="numeric" autoComplete="tel" dir="ltr" />
              <Field icon="store" placeholder="اسم المتجر (التجاري)" value={form.store} onChange={(event) => setForm({ ...form, store: event.target.value })} />
              <Field icon="mail" placeholder="البريد الإلكتروني" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="email" dir="ltr" />
              <Field icon="lock" placeholder="كلمة المرور (8 أحرف فأكثر)" type={showPassword ? "text" : "password"} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" suffix={passwordToggle} />
              <Field icon="lock" placeholder="تأكيد كلمة المرور" type={showPassword ? "text" : "password"} value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} autoComplete="new-password" />
              {error && <p className="form-error"><Icon name="alert" size={15} />{error}</p>}
              <Button type="submit" full loading={busy}>إنشاء الحساب</Button>
              <p className="auth-switch">لديك حساب بالفعل؟ <button type="button" onClick={() => { setMode("login"); setError(""); }}>سجّل الدخول</button></p>
              <p className="auth-legal">بإنشاء الحساب أنت توافق على شروط الاستخدام وسياسة الخصوصية.</p>
            </form>
          )}

          {mode === "login" && <>
            <div className="tracking-box"><h2>تتبّع طردك بدون تسجيل دخول</h2><div className="tracking-box__row"><Field icon="scan" placeholder="ALX-20200001" value={tracking} onChange={(event) => setTracking(event.target.value.toUpperCase())} dir="ltr" /><IconButton name="camera" label="مسح رمز التتبع" className="tracking-box__camera" onClick={() => openScanner((value) => { setTracking(value); void findShipment(value); })} /></div><Button variant="secondary" full disabled={!tracking.trim()} onClick={() => { void findShipment(tracking); }}>تتبّع الطرد</Button></div>
          </>}
        </section>
        <footer className="auth-footer">توصيل أسرع، متابعة أسهل — إلى كل فلسطين</footer>
      </div>

      {trackedOrder && <Modal onClose={() => setTrackedOrder(null)} title="تتبّع الطرد" className="tracking-modal"><div className="tracking-modal__number"><Icon name="package" size={32} /><div><strong dir="ltr">{trackedOrder.trackingNumber}</strong><span>{trackedOrder.recipientName} · {trackedOrder.city}</span></div><StatusPill status={trackedOrder.status} /></div><TrackingHistory order={trackedOrder} compact /><Button full onClick={() => setTrackedOrder(null)}>حسنًا</Button></Modal>}
      {accountsOpen && (
        <Modal title="الحسابات المتاحة" onClose={() => setAccountsOpen(false)} className="available-accounts-modal" sheet>
          <p className="modal-description">اختيار حساب من هذه القائمة يملأ البريد الإلكتروني لتسجيل الدخول بكلمة المرور فقط. عند الضغط على زر حماية الجهاز، يعرض الجهاز الحسابات المرتبطة بالبصمة ويختار المستخدم منها.</p>
          <div className="account-list available-account-list">
            {availableAccounts.map((account) => {
              const selected = email.trim().toLowerCase() === account.email;
              return (
                <button type="button" key={account.id} className={`account-entry ${selected ? "is-active" : ""}`} disabled={loginOperationBusy} onClick={() => chooseAvailableAccount(account)}>
                  <Avatar name={account.name} color={account.avatarColor} />
                  <span>
                    <strong>{account.name}</strong>
                    <small>{account.role === "admin" ? "حساب الإدارة" : account.role === "courier" ? "حساب موظف · مندوب" : account.store}</small>
                    <em dir="ltr">{account.email}</em>
                  </span>
                  <Icon name={selected ? "check" : "chevronLeft"} size={19} />
                </button>
              );
            })}
          </div>
          <p className="available-accounts-modal__privacy"><Icon name="shield" size={15} />لا يتم حفظ كلمات المرور في قائمة الحسابات المتاحة.</p>
        </Modal>
      )}
    </main>
  );
}
