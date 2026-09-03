"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useApp } from "../lib/app-context";
import { detectBiometricAvailability } from "../lib/app-lock-client";
import { AVAILABLE_ACCOUNTS_EVENT, AVAILABLE_ACCOUNTS_STORAGE_KEY, forgetAvailableAccount, readAvailableAccounts, type AvailableAccount } from "../lib/available-accounts";
import type { TrackableOrder } from "../lib/data";
import { Icon } from "./icon";
import { PasswordRecovery } from "./password-recovery";
import { RegistrationFlow } from "./registration-flow";
import { TrackingHistory } from "./tracking-history";
import { Avatar, Brand, Button, Field, IconButton, Modal, StatusPill } from "./ui";

export function Authentication() {
  const { login, loginWithBiometric, requestRegistration, verifyRegistration, preferences, updatePreferences, showToast, confirm, openScanner } = useApp();
  const [mode, setMode] = useState<"login" | "register" | "recover">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [tracking, setTracking] = useState("");
  const [trackedOrder, setTrackedOrder] = useState<TrackableOrder | null>(null);
  const [availableAccounts, setAvailableAccounts] = useState<AvailableAccount[]>([]);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);

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
      const result = await response.json() as { order?: TrackableOrder; error?: string };
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

  function removeAvailableAccount(account: AvailableAccount) {
    if (loginOperationBusy) return;
    confirm({
      title: "إزالة الحساب من هذا الجهاز؟",
      message: `سيُزال حساب ${account.name} من قائمة الحسابات المتاحة على هذا الجهاز فقط. لن يُحذف الحساب أو بياناته، ويمكن تسجيل الدخول إليه لاحقًا بالبريد الإلكتروني وكلمة المرور.`,
      confirmLabel: "إزالة من الجهاز",
      danger: true,
      onConfirm: () => {
        forgetAvailableAccount(account.id);
        setAvailableAccounts((current) => current.filter((entry) => entry.id !== account.id));
        if (email.trim().toLowerCase() === account.email.trim().toLowerCase()) {
          setEmail("");
          setPassword("");
          setError("");
        }
        if (availableAccounts.length === 1) setAccountsOpen(false);
        showToast("تمت إزالة الحساب من قائمة هذا الجهاز.");
      },
    });
  }

  function openPasswordRecovery() {
    if (loginOperationBusy) return;
    setPassword("");
    setShowPassword(false);
    setError("");
    setMode("recover");
  }

  function closePasswordRecovery() {
    setPassword("");
    setShowPassword(false);
    setError("");
    setMode("login");
  }

  function completePasswordRecovery(loginEmail?: string) {
    setEmail(loginEmail ?? "");
    closePasswordRecovery();
    showToast("تم تعيين كلمة المرور الجديدة بنجاح. يمكنك تسجيل الدخول الآن.");
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
          {mode === "recover" ? (
            <PasswordRecovery initialIdentifier={email} onCancel={closePasswordRecovery} onComplete={completePasswordRecovery} />
          ) : (
            <>
              {mode === "login" && <header className="auth-card__header"><h1>تسجيل الدخول</h1><p>أهلًا بعودتك — أدخل بيانات حسابك للمتابعة</p></header>}
              {mode === "login" ? (
                <form className="auth-form" onSubmit={onLogin} noValidate>
                  <Field icon="mail" type="email" placeholder="البريد الإلكتروني" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" dir="ltr" disabled={loginOperationBusy} />
                  <Field icon="lock" type={showPassword ? "text" : "password"} placeholder="كلمة المرور" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" suffix={passwordToggle} disabled={loginOperationBusy} />
                  <button type="button" className="auth-forgot-link" disabled={loginOperationBusy} onClick={openPasswordRecovery}>نسيت كلمة المرور؟</button>
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
              ) : <RegistrationFlow onCancel={() => { setMode("login"); setError(""); }} onRequest={requestRegistration} onVerify={verifyRegistration} />}

              {mode === "login" && <div className="tracking-box"><h2>تتبّع طردك بدون تسجيل دخول</h2><div className="tracking-box__row"><Field icon="scan" placeholder="ALX-20200001" value={tracking} onChange={(event) => setTracking(event.target.value.toUpperCase())} dir="ltr" /><IconButton name="camera" label="مسح رمز التتبع" className="tracking-box__camera" onClick={() => openScanner((value) => { setTracking(value); void findShipment(value); })} /></div><Button variant="secondary" full disabled={!tracking.trim()} onClick={() => { void findShipment(tracking); }}>تتبّع الطرد</Button></div>}
            </>
          )}
        </section>
        <footer className="auth-footer">توصيل أسرع، متابعة أسهل — إلى كل فلسطين</footer>
      </div>

      {trackedOrder && <Modal onClose={() => setTrackedOrder(null)} title="تتبّع الطرد" className="tracking-modal"><div className="tracking-modal__number"><Icon name="package" size={32} /><div><strong dir="ltr">{trackedOrder.trackingNumber}</strong><span>بيانات المستلم محمية</span></div><StatusPill status={trackedOrder.status} /></div><TrackingHistory order={trackedOrder} compact /><Button full onClick={() => setTrackedOrder(null)}>حسنًا</Button></Modal>}
      {accountsOpen && (
        <Modal title="الحسابات المتاحة" onClose={() => setAccountsOpen(false)} className="available-accounts-modal" sheet>
          <p className="modal-description">اختيار حساب من هذه القائمة يملأ البريد الإلكتروني لتسجيل الدخول بكلمة المرور فقط. عند الضغط على زر حماية الجهاز، يعرض الجهاز الحسابات المرتبطة بالبصمة ويختار المستخدم منها.</p>
          <div className="account-list available-account-list">
            {availableAccounts.map((account) => {
              const selected = email.trim().toLowerCase() === account.email;
              return (
                <div className="available-account-row" key={account.id}>
                  <button type="button" className={`account-entry ${selected ? "is-active" : ""}`} disabled={loginOperationBusy} onClick={() => chooseAvailableAccount(account)}>
                    <Avatar name={account.name} color={account.avatarColor} />
                    <span>
                      <strong>{account.name}</strong>
                      <small>{account.role === "admin" ? "حساب الإدارة" : account.role === "courier" ? "حساب موظف · مندوب" : account.store}</small>
                      <em dir="ltr">{account.email}</em>
                    </span>
                    <Icon name={selected ? "check" : "chevronLeft"} size={19} />
                  </button>
                  <IconButton type="button" name="trash" label={`إزالة حساب ${account.name} من الحسابات المتاحة`} className="available-account-remove is-danger" disabled={loginOperationBusy} onClick={() => removeAvailableAccount(account)} />
                </div>
              );
            })}
          </div>
          <p className="available-accounts-modal__privacy"><Icon name="shield" size={15} /><span>لا يتم حفظ كلمات المرور هنا. زر الإزالة ينسى الحساب من قائمة هذا الجهاز فقط ولا يحذف الحساب أو بياناته.</span></p>
        </Modal>
      )}
    </main>
  );
}
