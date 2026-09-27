"use client";
import { DeletionRequestPanel } from "./deletion-request";
import type { DeletionResponse } from "../lib/account-deletion";
import { SupportContacts } from "./public-service";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useApp, type View } from "../lib/app-context";
import { formatDate, relativeDate, type LinkedDevice } from "../lib/data";
import { devicePlatformName } from "../lib/linked-devices";
import { applicationPermissionDisclosures, LEGAL_DOCUMENT_VERSION, LEGAL_FINAL_NOTICE, privacyPolicySections, termsOfUseSections } from "../lib/legal";
import { Icon, type IconName } from "./icon";
import { Button, Field, Modal, PageHeader, SectionCard, Toggle } from "./ui";

function SettingsRow({ icon, title, subtitle, onClick, action, danger = false }: { icon: IconName; title: string; subtitle?: string; onClick?: () => void; action?: ReactNode; danger?: boolean }) {
  return <div className={`settings-row ${danger ? "settings-row--danger" : ""}`} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={(event) => { if (onClick && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onClick(); } }}><span className="settings-row__icon"><Icon name={icon} size={20} /></span><div><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>{action ?? <Icon name="chevronLeft" size={19} />}</div>;
}

export function SettingsPage() {
  const { user, setView, preferences, updatePreferences, showToast, logout, confirm } = useApp();
  const route = (view: View) => () => setView(view);
  return <div className="page-content settings-page animate-page"><PageHeader title="الإعدادات" subtitle={user?.email} onBack={() => setView("home")} /><div className="settings-group"><SettingsRow icon="user" title="الملف الشخصي" subtitle={user?.role === "admin" ? "إدارة بيانات حساب المسؤول" : "بيانات حسابك للعرض فقط"} onClick={route("profile")} /><SettingsRow icon="shield" title="الأمان والخصوصية" subtitle="كلمة المرور وقفل التطبيق وحماية الجهاز" onClick={route("security")} /><SettingsRow icon="bell" title="الإشعارات" subtitle="تنبيهات الطرود والعروض" onClick={route("notification-settings")} /><SettingsRow icon="sliders" title="التفضيلات" subtitle="المظهر والعرض" onClick={route("preferences")} /></div><div className="settings-group"><SettingsRow icon="help" title="مركز المساعدة" subtitle="الأسئلة الشائعة" onClick={route("help")} /><SettingsRow icon="file" title="الشروط والخصوصية والأذونات" subtitle="راجع الوثائق والأذونات المستخدمة" onClick={route("privacy")} /></div><SectionCard className="rating-card"><div><Icon name="star" size={20} /><strong>قيّم التطبيق</strong></div><div className="rating-stars">{[1, 2, 3, 4, 5].map((star) => <button key={star} aria-label={`${star} من 5`} className={star <= preferences.rating ? "is-rated" : ""} onClick={() => { updatePreferences({ rating: star }); showToast("شكرًا لك! تم حفظ تقييمك."); }}><Icon name="star" size={28} /></button>)}</div></SectionCard><div className="settings-group"><SettingsRow icon="logout" title="تسجيل الخروج" danger onClick={() => confirm({ title: "تسجيل الخروج؟", message: "يمكنك تسجيل الدخول مرة أخرى في أي وقت.", confirmLabel: "تسجيل الخروج", onConfirm: logout })} /></div><p className="version-label">Almadina Express v1.0.0</p></div>;
}

export function SecurityPage() {
  const { user, appLock, enableAppLock, disableAppLock, enableBiometricUnlock, disableBiometricUnlock, setView, showToast } = useApp();
  const [pin, setPin] = useState("");
  const [pinMode, setPinMode] = useState<"setup" | "disable-lock" | "enable-biometric" | "disable-biometric" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submitPin(value: string) {
    if (!pinMode) return;
    setSubmitting(true);
    const completed = pinMode === "setup"
      ? await enableAppLock(value)
      : pinMode === "disable-lock"
        ? await disableAppLock(value)
        : pinMode === "enable-biometric"
          ? await enableBiometricUnlock(value)
          : await disableBiometricUnlock(value);
    setSubmitting(false);
    setPin("");
    if (completed) setPinMode(null);
  }

  function press(value: string) {
    if (submitting) return;
    if (value === "clear") return setPin("");
    if (value === "delete") return setPin((current) => current.slice(0, -1));
    const next = `${pin}${value}`.slice(0, 4);
    setPin(next);
    if (next.length === 4) void submitPin(next);
  }

  const biometricSubtitle = !appLock.enabled
    ? "فعّل قفل التطبيق وحدد رمزًا أولًا"
    : appLock.biometricEnabled
      ? appLock.biometricLoginReady
        ? "مفعّلة للدخول بعد تسجيل الخروج"
        : "مفعّلة داخل الجلسة؛ أوقفها ثم أعد ربطها للدخول بعد الخروج"
      : appLock.biometricAvailable
        ? "استخدم بصمة أو Face ID أو رمز حماية الجهاز"
        : "متاحة على الهواتف وiPad المدعومة عبر HTTPS";
  const pinTitle = pinMode === "setup"
    ? "أدخل رمز قفل جديدًا (4 أرقام)"
    : pinMode === "disable-lock"
      ? "أدخل رمز القفل لإيقافه"
      : pinMode === "enable-biometric"
        ? "أدخل رمز القفل لتفعيل البصمة"
        : "أدخل رمز القفل لإيقاف البصمة";

  return <div className="page-content animate-page"><PageHeader title="الأمان والخصوصية" onBack={() => setView("settings")} />
    <div className="settings-group">
      <SettingsRow icon="key" title="تغيير كلمة المرور" subtitle="أنشئ كلمة مرور قوية لحسابك" onClick={() => setView("change-password")} />
      <SettingsRow icon="monitor" title="الأجهزة المرتبطة" subtitle="عرض عدد الأجهزة وأسمائها وآخر نشاط" onClick={() => setView("linked-devices")} />
      <SettingsRow icon="lock" title="قفل التطبيق" subtitle={appLock.enabled ? "رمز القفل مفعّل ومشفّر" : "احمِ حسابك برمز دخول"} action={<Toggle checked={appLock.enabled} disabled={!appLock.ready || submitting} onChange={(value) => { setPin(""); setPinMode(value ? "setup" : "disable-lock"); showToast(value ? "أدخل رمزًا جديدًا من 4 أرقام." : "أدخل رمز القفل الحالي للتأكيد.", "info"); }} label="قفل التطبيق" />} />
      <SettingsRow icon="fingerprint" title="الدخول بالبصمة" subtitle={biometricSubtitle} action={<Toggle checked={appLock.biometricEnabled} disabled={!appLock.ready || !appLock.enabled || submitting || (!appLock.biometricAvailable && !appLock.biometricEnabled)} onChange={(value) => { setPin(""); setPinMode(value ? "enable-biometric" : "disable-biometric"); if (value) showToast("أدخل رمز قفل التطبيق لتأكيد ربط حماية الجهاز.", "info"); }} label="الدخول بالبصمة" />} />
    </div>
    {pinMode && <SectionCard title={pinTitle} className="pin-card" action={<Button type="button" variant="ghost" disabled={submitting} onClick={() => { setPinMode(null); setPin(""); }}>إلغاء</Button>}><div className="pin-dots">{[0, 1, 2, 3].map((index) => <span key={index} className={index < pin.length ? "is-filled" : ""} />)}</div><div className="pin-keypad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "delete"].map((value) => <button type="button" disabled={submitting} key={value} onClick={() => press(value)}>{value === "clear" ? "C" : value === "delete" ? <Icon name="arrowLeft" size={20} /> : value}</button>)}</div>{submitting && <p className="pin-card__status"><span className="spinner" /> جارٍ حفظ إعدادات الأمان...</p>}</SectionCard>}
    <SectionCard className="security-note"><p><Icon name="shield" size={18} /> عند تفعيل البصمة وربطها بهذا الجهاز، يمكنك تسجيل الدخول بها بعد الخروج للحسابات العادية والبريميوم والماسية والموظف والمسؤول. تبقى كلمة المرور متاحة دائمًا.</p></SectionCard>
    {user?.role !== "admin" && <div className="settings-group"><SettingsRow icon="trash" title="حذف الحساب" subtitle="راجع الشروط قبل الحذف النهائي" danger onClick={() => setView("delete-account")} /></div>}
  </div>;
}

function linkedDeviceCountLabel(count: number): string {
  const written = count.toLocaleString("ar-PS");
  if (count === 0) return "لا توجد أجهزة مرتبطة";
  if (count === 1) return "جهاز واحد مرتبط";
  if (count === 2) return "جهازان مرتبطان";
  if (count >= 3 && count <= 10) return `${written} أجهزة مرتبطة`;
  return `${written} جهازًا مرتبطًا`;
}

function linkedDeviceDate(value: string): string {
  return new Intl.DateTimeFormat("ar-PS", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function linkedDeviceIcon(device: LinkedDevice): IconName {
  return device.type === "mobile" || device.type === "tablet" ? "phone" : "monitor";
}

export function LinkedDevicesPage() {
  const { user } = useApp();
  // Remount the request scope synchronously on account changes; never display a
  // previous account's session list while the next account's request is pending.
  return user ? <LinkedDevicesContent key={user.id} /> : null;
}

function LinkedDevicesContent() {
  const { setView, listLinkedDevices, revokeLinkedDevice, renameCurrentDevice, confirm } = useApp();
  const [devices, setDevices] = useState<LinkedDevice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const [mutationError, setMutationError] = useState("");
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  const mutationActive = useRef(false);
  const actions = useRef({ listLinkedDevices, revokeLinkedDevice, renameCurrentDevice });
  actions.current = { listLinkedDevices, revokeLinkedDevice, renameCurrentDevice };

  async function loadDevices() {
    if (mutationActive.current) return;
    const version = ++requestVersion.current;
    setLoading(true); setFailed(false);
    try {
      const result = await actions.current.listLinkedDevices();
      if (!mounted.current || version !== requestVersion.current) return;
      if (!result) setFailed(true); else setDevices(result);
    } catch {
      if (mounted.current && version === requestVersion.current) setFailed(true);
    } finally {
      if (mounted.current && version === requestVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void loadDevices();
    return () => { mounted.current = false; requestVersion.current += 1; };
    // Functions read the latest context through actions; this effect owns only
    // the lifetime of this account-keyed page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function mutate(operation: () => Promise<LinkedDevice[] | null>): Promise<boolean> {
    if (!mounted.current || mutationActive.current) return false;
    const version = ++requestVersion.current;
    mutationActive.current = true; setBusy(true); setLoading(false); setMutationError("");
    try {
      const result = await operation();
      if (!mounted.current || version !== requestVersion.current) return false;
      if (!result) { setMutationError("تعذّر تأكيد التغيير. تحقق من الاتصال وحدّث القائمة ثم أعد المحاولة."); return false; }
      setDevices(result); setFailed(false); return true;
    } catch {
      if (mounted.current && version === requestVersion.current) setMutationError("تعذّر حفظ التغيير. أعد المحاولة.");
      return false;
    } finally {
      mutationActive.current = false;
      if (mounted.current && version === requestVersion.current) setBusy(false);
    }
  }

  function requestRevoke(device: LinkedDevice) {
    if (mutationActive.current || device.current) return;
    confirm({
      title: `تسجيل خروج ${device.label || device.name}؟`,
      message: "ستنتهي جلسة هذا الجهاز فقط، ولن تُحذف بيانات الحساب أو الطرود أو التحصيلات.",
      confirmLabel: "تسجيل خروج الجهاز", danger: true,
      onConfirm: () => mutate(() => actions.current.revokeLinkedDevice(device.id)),
    });
  }

  async function saveLabel(event: FormEvent) {
    event.preventDefault();
    if (label.trim().length > 80 || /[\p{Cc}\p{Cf}]/u.test(label.trim())) { setMutationError("اكتب اسمًا واضحًا حتى 80 حرفًا."); return; }
    if (await mutate(() => actions.current.renameCurrentDevice(label.trim()))) setEditing(false);
  }

  const count = devices?.length ?? 0;
  return <div className="page-content linked-devices-page animate-page">
    <PageHeader title="الأجهزة المرتبطة" subtitle="الجلسات المسجّل دخولها إلى حسابك" onBack={() => setView("security")} action={<Button type="button" variant="ghost" icon="refresh" loading={loading} disabled={loading || busy} onClick={() => { void loadDevices(); }}>تحديث</Button>} />
    <section className="linked-devices-summary" aria-live="polite"><span><Icon name="monitor" size={25} /></span><div><strong>{loading && !devices ? "جارٍ حساب الأجهزة..." : linkedDeviceCountLabel(count)}</strong><small>راجع نوع الجهاز ومنطقة اتصاله التقريبية، وسجّل خروج أي جهاز لا تعرفه.</small></div></section>
    {mutationError && !editing && <p className="linked-devices-message" role="alert">{mutationError}</p>}
    {loading && !devices ? <div className="linked-devices-loading" role="status"><span className="spinner" /><p>جارٍ تحميل الأجهزة المرتبطة...</p></div>
      : failed ? <section className="linked-devices-error" role="alert"><Icon name="alert" size={30} /><h2>تعذّر تحميل الأجهزة</h2><p>تحقق من الاتصال ثم أعد المحاولة.</p><Button type="button" variant="outline" icon="refresh" disabled={busy} onClick={() => { void loadDevices(); }}>إعادة المحاولة</Button></section>
        : devices?.length ? <div className="linked-device-list">{devices.map((device) => <article className={`linked-device-card ${device.current ? "is-current" : ""}`} key={device.id}>
          <span className="linked-device-card__icon"><Icon name={linkedDeviceIcon(device)} size={24} /></span>
          <div className="linked-device-card__details"><div><strong><bdi>{device.label || device.name}</bdi></strong>{device.current && <span className="linked-device-current"><Icon name="check" size={13} />هذا الجهاز</span>}</div>
            <p className="linked-device-platform"><bdi>{devicePlatformName(device)}</bdi>{device.model && <> · <bdi>{device.model}</bdi></>}{device.osVersion && <> · <bdi>{device.osVersion}</bdi></>}</p>
            <p>{device.browser === "غير معروف" ? "جلسة قديمة؛ تظهر تفاصيل الجهاز المتاحة عند استخدامها" : <><bdi>{device.browser}</bdi>{device.appVersion && <> · <bdi>{device.appVersion}</bdi></>}</>}</p>
            <dl className="linked-device-facts"><div><dt>المنطقة التقريبية للجلسة</dt><dd><Icon name="mapPin" size={14} />{device.locationSource === "ip" && device.location ? <bdi>{device.location}</bdi> : "غير متاحة"}</dd></div><div><dt>تسجيل الدخول</dt><dd><time dateTime={device.createdAt}>{linkedDeviceDate(device.createdAt)}</time></dd></div><div><dt>آخر نشاط</dt><dd><time dateTime={device.lastActiveAt} title={linkedDeviceDate(device.lastActiveAt)}>{relativeDate(device.lastActiveAt)}</time></dd></div></dl>
            {device.locationSource === "ip" && device.location && device.locationUpdatedAt && <small>وقت تحديد المنطقة: <time dateTime={device.locationUpdatedAt}>{linkedDeviceDate(device.locationUpdatedAt)}</time></small>}
          </div>
          {device.current ? <Button type="button" variant="outline" disabled={busy || loading} onClick={() => { setLabel(device.label ?? ""); setMutationError(""); setEditing(true); }}>تسمية هذا الجهاز</Button> : <Button type="button" variant="outline" icon="logout" disabled={busy || loading} onClick={() => requestRevoke(device)}>تسجيل الخروج</Button>}
        </article>)}</div>
          : <section className="linked-devices-error"><Icon name="monitor" size={34} /><h2>لا توجد أجهزة مرتبطة</h2><p>ستظهر جلسات تسجيل الدخول النشطة هنا.</p></section>}
    <SectionCard className="security-note"><p><Icon name="shield" size={18} /> اسم الجهاز اختياري يكتبه مستخدمه، وليس إثباتًا لهوية مالكه. المنطقة تقريبية من شبكة الاتصال وقد تختلف مع VPN أو شبكة الهاتف؛ لا نستخدم GPS ولا نعرض عنوان IP.</p></SectionCard>
    {editing && <Modal title="تسمية هذا الجهاز" closeDisabled={busy} onClose={() => { if (!mutationActive.current) { setEditing(false); setMutationError(""); } }}><form className="linked-device-name-form" onSubmit={saveLabel}><Field label="اسم الجهاز (اختياري)" aria-label="اسم الجهاز (اختياري)" placeholder="مثل: آيفون نسيم" value={label} onChange={(event) => setLabel(event.target.value)} disabled={busy} maxLength={80} autoComplete="off" hint="اختر اسمًا يساعدك على تمييز هذا الجهاز. اتركه فارغًا لإزالة الاسم المخصص." /><p>يظهر الاسم في حسابك على الموقع والتطبيقين. لا يمكن للتطبيق معرفة اسم المالك الحقيقي تلقائيًا.</p>{mutationError && <p className="linked-devices-message" role="alert">{mutationError}</p>}<Button type="submit" loading={busy} full>حفظ اسم الجهاز</Button></form></Modal>}
  </div>;
}

function isStrongPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 128
    && /\p{L}/u.test(password)
    && /[0-9٠-٩]/.test(password)
    && /[^\p{L}\p{N}\s]/u.test(password);
}

export function ChangePasswordPage() {
  const { setView, changePassword, showToast } = useApp();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signOutAllDevices, setSignOutAllDevices] = useState(true);
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false });
  const [submitting, setSubmitting] = useState(false);
  const strong = isStrongPassword(newPassword);
  const matching = newPassword === confirmPassword;

  function visibilityButton(field: keyof typeof visible, label: string) {
    const shown = visible[field];
    return <button type="button" className="password-visibility-button" aria-label={`${shown ? "إخفاء" : "إظهار"} ${label}`} aria-pressed={shown} disabled={submitting} onClick={() => setVisible((current) => ({ ...current, [field]: !current[field] }))}><Icon name={shown ? "eyeOff" : "eye"} size={21} /></button>;
  }

  async function submitPasswordChange(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!isStrongPassword(newPassword)) {
      showToast("يجب أن تحتوي كلمة المرور الجديدة على 8 أحرف على الأقل وحرف ورقم ورمز.", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("تأكيد كلمة المرور الجديدة غير مطابق.", "error");
      return;
    }
    if (currentPassword === newPassword) {
      showToast("اختر كلمة مرور جديدة مختلفة عن الحالية.", "error");
      return;
    }

    setSubmitting(true);
    const changed = await changePassword(currentPassword, newPassword, confirmPassword, signOutAllDevices);
    setSubmitting(false);
    if (!changed) return;
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    if (!signOutAllDevices) setView("security");
  }

  return <div className="page-content change-password-page animate-page">
    <PageHeader title="تغيير كلمة المرور" onBack={() => setView("security")} />
    <section className="change-password-panel">
      <header className="change-password-intro"><span><Icon name="key" size={27} /></span><div><h2>كلمة مرور جديدة وآمنة</h2><p>أنشئ كلمة مرور قوية مكوّنة من 8 أحرف فأكثر وتحتوي على حروف وأرقام ورمز.</p></div></header>
      <form className="change-password-form" onSubmit={submitPasswordChange}>
        <Field label="كلمة المرور الحالية" icon="lock" type={visible.current ? "text" : "password"} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} maxLength={256} placeholder="كلمة المرور الحالية" suffix={visibilityButton("current", "كلمة المرور الحالية")} disabled={submitting} />
        <Field label="كلمة المرور الجديدة" icon="key" type={visible.next ? "text" : "password"} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={128} placeholder="كلمة المرور الجديدة" suffix={visibilityButton("next", "كلمة المرور الجديدة")} hint={newPassword && !strong ? "أضف حرفًا ورقمًا ورمزًا، وبحد أدنى 8 أحرف." : undefined} disabled={submitting} />
        <Field label="تأكيد كلمة المرور" icon="check" type={visible.confirm ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} maxLength={128} placeholder="تأكيد كلمة المرور" suffix={visibilityButton("confirm", "تأكيد كلمة المرور")} hint={confirmPassword && !matching ? "كلمتا المرور غير متطابقتين." : undefined} disabled={submitting} />
        <label className="password-session-option"><span className="password-session-option__checkbox"><input type="checkbox" checked={signOutAllDevices} disabled={submitting} onChange={(event) => setSignOutAllDevices(event.target.checked)} /><span><Icon name="check" size={17} /></span></span><span><strong>طلب تسجيل الدخول بكلمة المرور الجديدة لجميع الأجهزة</strong><small>سيتم تسجيل الخروج وإيقاف الدخول بالبصمة القديمة حتى تعيد ربطها.</small></span></label>
        <Button type="submit" icon="check" full loading={submitting} disabled={!currentPassword || !strong || !matching || currentPassword === newPassword}>تأكيد</Button>
      </form>
    </section>
  </div>;
}

export function DeleteAccountPage() {
  const { user, setView, deleteAccount, submitDeletionOperation } = useApp();
  const [requestStatus, setRequestStatus] = useState<DeletionResponse | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { activeOrderCount = 0, unsettledCollectionCount = 0, unsettledOrderCount = 0, eligible = false } = requestStatus?.eligibility ?? {};

  async function submitDeletion(event: FormEvent) {
    event.preventDefault();
    if (!eligible || submitting || !password || confirmation !== "حذف حسابي") return;
    setSubmitting(true);
    const deleted = await deleteAccount(password, confirmation);
    if (!deleted) setSubmitting(false);
  }

  function closeConfirmation() {
    if (submitting) return;
    setConfirmationOpen(false);
    setPassword("");
    setConfirmation("");
  }

  if (!user || user.role === "admin") {
    return <div className="page-content animate-page"><PageHeader title="حذف الحساب" onBack={() => setView("settings")} /><SectionCard><p>حذف حساب المسؤول غير متاح من داخل التطبيق.</p></SectionCard></div>;
  }

  return <div className="page-content delete-account-page animate-page">
    <PageHeader title="حذف الحساب" onBack={() => setView("security")} />
    <DeletionRequestPanel onStatus={setRequestStatus} submitRequest={async (password, confirmation) => await submitDeletionOperation("account/deletion-request", { password, confirmation }) as DeletionResponse} />
    <section className="delete-account-panel">
      <header className="delete-account-intro">
        <span><Icon name="trash" size={26} /></span>
        <div><h2>الحذف الفوري بعد التسوية</h2><p>نحترم حقك في التحكم ببياناتك. قبل حذف الحساب نهائيًا، تأكد من استكمال الخطوات التالية:</p></div>
      </header>
      <ol className="delete-account-requirements">
        <li className={unsettledCollectionCount === 0 ? "is-complete" : "is-blocked"}><span><Icon name={unsettledCollectionCount === 0 ? "check" : "alert"} size={18} /></span><p>إكمال جميع معاملات التحصيل والحسابات المالية المعلّقة.</p></li>
        <li className={activeOrderCount === 0 ? "is-complete" : "is-blocked"}><span><Icon name={activeOrderCount === 0 ? "check" : "alert"} size={18} /></span><p>ألا توجد طرود نشطة؛ يجب أن تكون جميع الطرود واصلة أو راجعة.</p></li>
        {user.role === "merchant" && <li className={unsettledOrderCount === 0 ? "is-complete" : "is-blocked"}><span><Icon name={unsettledOrderCount === 0 ? "check" : "alert"} size={18} /></span><p>إدراج كل طرد مكتمل في فاتورة تحصيل تم تسليمها واستلام مستحقاته.</p></li>}
        <li><span><Icon name="download" size={18} /></span><p>تنزيل أي فواتير أو سجلات تحتاج إليها؛ لن تتمكن من استعادتها بعد الحذف.</p></li>
        <li><span><Icon name="shield" size={18} /></span><p>الحذف نهائي وفوري بعد التأكيد، ويزيل الحساب وبياناته المرتبطة ولا يمكن التراجع عنه.</p></li>
      </ol>
      <div className={`delete-account-status ${eligible ? "is-ready" : "is-blocked"}`} role="status">
        <Icon name={eligible ? "check" : "alert"} size={20} />
        <div>{eligible ? <><strong>يمكنك حذف الحساب الآن</strong><small>ستحتاج إلى كلمة المرور وكتابة عبارة التأكيد.</small></> : <><strong>{requestStatus ? "يلزم إتمام التسوية للحذف الفوري؛ يمكنك تقديم الطلب أعلاه" : "جارٍ التحقق من أهلية الحذف الفوري"}</strong><small>{activeOrderCount > 0 && `${activeOrderCount} طرد نشط`}{activeOrderCount > 0 && (unsettledCollectionCount > 0 || unsettledOrderCount > 0) ? " · " : ""}{unsettledCollectionCount > 0 && `${unsettledCollectionCount} فاتورة غير مدفوعة`}{unsettledCollectionCount > 0 && unsettledOrderCount > 0 ? " · " : ""}{unsettledOrderCount > 0 && `${unsettledOrderCount} طرد بلا تحصيل مكتمل`}</small></>}</div>
      </div>
    </section>
    <div className="delete-account-actions">
      <Button variant="danger" icon="trash" full disabled={!eligible} onClick={() => setConfirmationOpen(true)}>حذف الحساب فورًا بعد التسوية</Button>
      <Button variant="outline" icon="phone" full onClick={() => setView("help")}>اتصل بنا</Button>
    </div>
    {confirmationOpen && <Modal title="تأكيد حذف الحساب" className="delete-account-confirmation-modal" closeDisabled={submitting} onClose={closeConfirmation}>
      <form className="delete-account-confirmation" onSubmit={submitDeletion}>
        <div className="delete-account-confirmation__warning"><Icon name="alert" size={22} /><p>سيُحذف حسابك وبياناته المرتبطة نهائيًا. لن تستطيع استعادتها بعد إتمام العملية.</p></div>
        <Field label="كلمة المرور" icon="lock" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="أدخل كلمة مرور حسابك" autoFocus />
        <Field label="اكتب «حذف حسابي» للتأكيد" icon="edit" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="حذف حسابي" />
        <div className="delete-account-confirmation__actions"><Button type="submit" variant="danger" icon="trash" loading={submitting} disabled={!password || confirmation !== "حذف حسابي"}>حذف حسابي نهائيًا</Button><Button type="button" variant="secondary" disabled={submitting} onClick={closeConfirmation}>إلغاء</Button></div>
      </form>
    </Modal>}
  </div>;
}

export function NotificationSettings() {
  const {
    preferences,
    phoneNotifications,
    updatePreferences,
    setNotificationSounds,
    enablePhoneNotifications,
    disablePhoneNotifications,
    testPhoneNotifications,
    setView,
    showToast,
  } = useApp();
  const [phoneBusy, setPhoneBusy] = useState(false);

  const phoneSubtitle = !phoneNotifications.ready
    ? "جارٍ التحقق من دعم هذا الجهاز..."
    : phoneNotifications.requiresHomeScreen
      ? "على iPhone: أضف الموقع إلى الشاشة الرئيسية ثم افتحه من الأيقونة"
      : !phoneNotifications.supported
        ? "هذا المتصفح لا يدعم إشعارات الهاتف"
        : phoneNotifications.permission === "denied"
          ? "الإذن مرفوض؛ فعّله من إعدادات الهاتف أو المتصفح"
          : phoneNotifications.subscribed
            ? "مفعّلة على هذا الجهاز وتصل عند إغلاق التطبيق"
            : phoneNotifications.error
              ? phoneNotifications.error
            : !phoneNotifications.configured
              ? "اضغط تفعيل لإعادة التحقق من خدمة الإشعارات"
              : "فعّلها لاستلام تنبيه الهاتف عند قفل الشاشة";

  async function togglePhoneNotifications() {
    if (phoneBusy) return;
    setPhoneBusy(true);
    try {
      if (phoneNotifications.subscribed) await disablePhoneNotifications();
      else await enablePhoneNotifications();
    } finally {
      setPhoneBusy(false);
    }
  }

  async function runNotificationTest() {
    if (phoneBusy) return;
    setPhoneBusy(true);
    try {
      await testPhoneNotifications();
    } finally {
      setPhoneBusy(false);
    }
  }

  return <div className="page-content animate-page">
    <PageHeader title="إعدادات الإشعارات" subtitle="تحكّم بالتنبيهات التي تصلك" onBack={() => setView("settings")} />
    <div className="settings-group">
      <SettingsRow icon="bell" title="تفعيل الإشعارات" subtitle="تلقي التحديثات المهمة" action={<Toggle checked={preferences.notifications} onChange={(value) => { updatePreferences({ notifications: value }); showToast(value ? "تم تفعيل الإشعارات." : "تم إيقاف الإشعارات."); }} label="الإشعارات" />} />
      <SettingsRow icon="truck" title="تحديثات الطرود" subtitle="تنبيه عند تغير حالة أي طرد" action={<Toggle checked={preferences.orderUpdates} onChange={(value) => updatePreferences({ orderUpdates: value })} label="تحديثات الطرود" />} />
      <SettingsRow icon="bell" title="الأصوات داخل التطبيق" subtitle="تشغيل نغمة واهتزاز عندما يكون التطبيق مفتوحًا" action={<Toggle checked={preferences.sounds} onChange={(value) => { void setNotificationSounds(value); }} label="أصوات الإشعارات" />} />
      <SettingsRow icon="phone" title="إشعارات الهاتف" subtitle={phoneSubtitle} action={<Button type="button" variant={phoneNotifications.subscribed ? "outline" : "primary"} className="notification-setting-button" loading={phoneBusy} disabled={!phoneNotifications.ready || (!phoneNotifications.supported && !phoneNotifications.requiresHomeScreen)} onClick={() => { void togglePhoneNotifications(); }}>{phoneNotifications.subscribed ? "إيقاف" : "تفعيل"}</Button>} />
      <SettingsRow icon="check" title="اختبار الصوت والإشعار" subtitle="شغّل نغمة فورية وأرسل إشعار اختبار إلى هذا الهاتف" action={<Button type="button" variant="secondary" className="notification-setting-button" loading={phoneBusy} onClick={() => { void runNotificationTest(); }}>اختبار</Button>} />
    </div>
    <SectionCard className="phone-notification-help"><p><strong>مهم:</strong> صوت إشعار النظام يتبع مستوى الصوت والوضع الصامت وعدم الإزعاج في الهاتف. على iPhone يجب فتح الموقع من أيقونته بعد إضافته إلى الشاشة الرئيسية.</p></SectionCard>
  </div>;
}

export function PreferencesPage() {
  const { preferences, updatePreferences, setView, showToast } = useApp();
  const themes = [{ id: "light", icon: "sun", title: "فاتح" }, { id: "dark", icon: "moon", title: "داكن" }, { id: "system", icon: "monitor", title: "تلقائي" }] as const;
  return <div className="page-content animate-page"><PageHeader title="التفضيلات" subtitle="اختر المظهر الذي يناسبك" onBack={() => setView("settings")} /><SectionCard title="مظهر التطبيق" icon="sun"><div className="theme-options">{themes.map((theme) => <button key={theme.id} className={preferences.theme === theme.id ? "theme-option is-selected" : "theme-option"} onClick={() => { updatePreferences({ theme: theme.id }); showToast(`تم تفعيل المظهر ${theme.title}.`); }}><Icon name={theme.icon} size={26} /><strong>{theme.title}</strong>{preferences.theme === theme.id && <Icon name="check" size={16} />}</button>)}</div></SectionCard><div className="settings-group"><SettingsRow icon="layers" title="العرض المدمج" subtitle="إظهار مزيد من العناصر في الشاشة" action={<Toggle checked={preferences.compact} onChange={(value) => updatePreferences({ compact: value })} label="العرض المدمج" />} /><SettingsRow icon="globe" title="اللغة" subtitle="العربية" onClick={() => showToast("اللغة العربية مفعلة.", "info")} /><SettingsRow icon="wallet" title="العملة" subtitle="الشيكل الإسرائيلي ₪" onClick={() => showToast("عملة التطبيق: الشيكل ₪.", "info")} /></div></div>;
}

const faqs = [
  { question: "ما هي خدمة المدينة إكسبرس؟", answer: "المدينة إكسبرس شركة توصيل فلسطينية توفر حلول شحن آمنة وسريعة للمتاجر الإلكترونية والأفراد داخل جميع المحافظات، مع خدمة الدفع عند الاستلام وتحديثات مباشرة لحالة الطرد." },
  { question: "كيف أبدأ التعامل مع المدينة إكسبرس؟", answer: "أنشئ حسابًا باسم متجرك ورقم جوالك، ثم أضف أول طرد. سيتولى مندوبنا استلام الطرد وتوصيله إلى العميل." },
  { question: "أين تقع فروعكم؟", answer: "نعمل من خلال شبكة مندوبين تغطي الخليل وبيت لحم ورام الله والقدس ونابلس وجنين وطولكرم وقلقيلية وسلفيت وأريحا وطوباس." },
  { question: "كيف أضيف طردًا جديدًا؟", answer: "اضغط على زر + أسفل الشاشة، أدخل بيانات المستلم والعنوان وقيمة الطرد، ثم اضغط إنشاء الطرد." },
  { question: "متى يصل الطرد للعميل؟", answer: "عادة تصل الطرود داخل المحافظة في اليوم نفسه، وبين المحافظات خلال يوم إلى يومي عمل حسب المنطقة." },
  { question: "كيف أستلم المبالغ المحصلة؟", answer: "تُجمع مبالغ الدفع عند الاستلام وتُضاف إلى رصيد متجرك، ثم تُحوّل بحسب جدول التحويل المتفق عليه." },
  { question: "كيف أستلم مبالغ التحصيل؟", answer: "أنشئ فاتورة من تبويب التحصيلات بعد وصول الطرود. عندما تصبح جاهزة، اعرض رمز التحقق للموظف؛ وبعد قراءة الرمز الصحيح تتغير حالة الفاتورة مباشرة إلى «تم التسليم»." },
];

export function HelpPage() {
  const { setView } = useApp();
  const [active, setActive] = useState(0);
  return <div className="page-content animate-page"><PageHeader title="مركز المساعدة" subtitle="إجابات عن أكثر الأسئلة شيوعًا" onBack={() => setView("settings")} /><section className="help-hero"><Icon name="help" size={38} /><h2>كيف نقدر نساعدك؟</h2><p>تصفح الأسئلة الشائعة أو تواصل مع فريق الشركة.</p><SupportContacts /></section><div className="faq-list">{faqs.map((faq, index) => <article className={`faq-item ${active === index ? "is-open" : ""}`} key={faq.question}><button onClick={() => setActive(active === index ? -1 : index)}><Icon name="help" size={19} /><span>{faq.question}</span><Icon name="chevronDown" size={18} /></button>{active === index && <p>{faq.answer}</p>}</article>)}</div></div>;
}

export function PrivacyPage() {
  const { setView } = useApp();
  return <div className="page-content animate-page"><PageHeader title="الشروط والخصوصية والأذونات" subtitle={`نسخة ${LEGAL_DOCUMENT_VERSION}`} onBack={() => setView("settings")} /><div className="policy-list">
    <h2 className="policy-list__heading"><Icon name="file" size={20} />شروط الاستخدام</h2>
    {termsOfUseSections.map((entry, index) => <SectionCard key={entry.title}><h3>{(index + 1).toLocaleString("ar-EG")}. {entry.title}</h3><p>{entry.body}</p></SectionCard>)}
    <h2 className="policy-list__heading"><Icon name="shield" size={20} />سياسة الخصوصية</h2>
    {privacyPolicySections.map((entry, index) => <SectionCard key={entry.title}><h3>{(index + 1).toLocaleString("ar-EG")}. {entry.title}</h3><p>{entry.body}</p></SectionCard>)}
    <h2 className="policy-list__heading"><Icon name="sliders" size={20} />الأذونات وخصائص الجهاز</h2>
    {applicationPermissionDisclosures.map((permission) => <SectionCard className="policy-permission" key={permission.id}><span><Icon name={permission.icon} size={20} /></span><div><h3>{permission.title}</h3><p>{permission.body}</p></div></SectionCard>)}
    <aside className="legal-final-notice"><Icon name="package" size={21} /><strong>{LEGAL_FINAL_NOTICE}</strong></aside>
  </div></div>;
}
