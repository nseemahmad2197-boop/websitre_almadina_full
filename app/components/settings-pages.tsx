"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useApp, type View } from "../lib/app-context";
import { Icon, type IconName } from "./icon";
import { Button, Field, Modal, PageHeader, SectionCard, Toggle } from "./ui";

function SettingsRow({ icon, title, subtitle, onClick, action, danger = false }: { icon: IconName; title: string; subtitle?: string; onClick?: () => void; action?: ReactNode; danger?: boolean }) {
  return <div className={`settings-row ${danger ? "settings-row--danger" : ""}`} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={(event) => { if (onClick && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onClick(); } }}><span className="settings-row__icon"><Icon name={icon} size={20} /></span><div><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>{action ?? <Icon name="chevronLeft" size={19} />}</div>;
}

export function SettingsPage() {
  const { user, setView, preferences, updatePreferences, showToast, logout, confirm } = useApp();
  const route = (view: View) => () => setView(view);
  return <div className="page-content settings-page animate-page"><PageHeader title="الإعدادات" subtitle={user?.email} onBack={() => setView("home")} /><div className="settings-group"><SettingsRow icon="user" title="الملف الشخصي" subtitle={user?.role === "admin" ? "إدارة بيانات حساب المسؤول" : "بيانات حسابك للعرض فقط"} onClick={route("profile")} /><SettingsRow icon="shield" title="الأمان والخصوصية" subtitle="قفل التطبيق وحذف الحساب" onClick={route("security")} /><SettingsRow icon="bell" title="الإشعارات" subtitle="تنبيهات الطرود والعروض" onClick={route("notification-settings")} /><SettingsRow icon="sliders" title="التفضيلات" subtitle="المظهر والعرض" onClick={route("preferences")} /></div><div className="settings-group"><SettingsRow icon="help" title="مركز المساعدة" subtitle="الأسئلة الشائعة" onClick={route("help")} /><SettingsRow icon="file" title="سياسة الخصوصية وشروط الاستخدام" onClick={route("privacy")} /></div><SectionCard className="rating-card"><div><Icon name="star" size={20} /><strong>قيّم التطبيق</strong></div><div className="rating-stars">{[1, 2, 3, 4, 5].map((star) => <button key={star} aria-label={`${star} من 5`} className={star <= preferences.rating ? "is-rated" : ""} onClick={() => { updatePreferences({ rating: star }); showToast("شكرًا لك! تم حفظ تقييمك."); }}><Icon name="star" size={28} /></button>)}</div></SectionCard><div className="settings-group"><SettingsRow icon="logout" title="تسجيل الخروج" danger onClick={() => confirm({ title: "تسجيل الخروج؟", message: "يمكنك تسجيل الدخول مرة أخرى في أي وقت.", confirmLabel: "تسجيل الخروج", onConfirm: logout })} /></div><p className="version-label">Almadina Express v1.0.0</p></div>;
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
      <SettingsRow icon="lock" title="قفل التطبيق" subtitle={appLock.enabled ? "رمز القفل مفعّل ومشفّر" : "احمِ حسابك برمز دخول"} action={<Toggle checked={appLock.enabled} disabled={!appLock.ready || submitting} onChange={(value) => { setPin(""); setPinMode(value ? "setup" : "disable-lock"); showToast(value ? "أدخل رمزًا جديدًا من 4 أرقام." : "أدخل رمز القفل الحالي للتأكيد.", "info"); }} label="قفل التطبيق" />} />
      <SettingsRow icon="fingerprint" title="الدخول بالبصمة" subtitle={biometricSubtitle} action={<Toggle checked={appLock.biometricEnabled} disabled={!appLock.ready || !appLock.enabled || submitting || (!appLock.biometricAvailable && !appLock.biometricEnabled)} onChange={(value) => { setPin(""); setPinMode(value ? "enable-biometric" : "disable-biometric"); if (value) showToast("أدخل رمز قفل التطبيق لتأكيد ربط حماية الجهاز.", "info"); }} label="الدخول بالبصمة" />} />
    </div>
    {pinMode && <SectionCard title={pinTitle} className="pin-card" action={<Button type="button" variant="ghost" disabled={submitting} onClick={() => { setPinMode(null); setPin(""); }}>إلغاء</Button>}><div className="pin-dots">{[0, 1, 2, 3].map((index) => <span key={index} className={index < pin.length ? "is-filled" : ""} />)}</div><div className="pin-keypad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "delete"].map((value) => <button type="button" disabled={submitting} key={value} onClick={() => press(value)}>{value === "clear" ? "C" : value === "delete" ? <Icon name="arrowLeft" size={20} /> : value}</button>)}</div>{submitting && <p className="pin-card__status"><span className="spinner" /> جارٍ حفظ إعدادات الأمان...</p>}</SectionCard>}
    <SectionCard className="security-note"><p><Icon name="shield" size={18} /> عند تفعيل البصمة وربطها بهذا الجهاز، يمكنك تسجيل الدخول بها بعد الخروج للحسابات العادية والبريميوم والموظف والمسؤول. تبقى كلمة المرور متاحة دائمًا.</p></SectionCard>
    {user?.role !== "admin" && <div className="settings-group"><SettingsRow icon="trash" title="حذف الحساب" subtitle="راجع الشروط قبل الحذف النهائي" danger onClick={() => setView("delete-account")} /></div>}
  </div>;
}

export function DeleteAccountPage() {
  const { database, user, setView, deleteAccount } = useApp();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const accountId = user?.id ?? "";
  const assignedOrders = database.orders.filter((order) => !order.deleted && (
    user?.role === "merchant" ? order.merchantId === accountId : order.courierId === accountId
  ));
  const activeOrderCount = assignedOrders.filter((order) => order.status !== "delivered" && order.status !== "returned").length;
  const merchantCollections = user?.role === "merchant" ? database.collections.filter((invoice) => invoice.merchantId === accountId) : [];
  const paidOrderIds = new Set(merchantCollections.filter((invoice) => invoice.status === "paid").flatMap((invoice) => invoice.orderIds));
  const unsettledCollectionCount = merchantCollections.filter((invoice) => invoice.status !== "paid").length;
  const unsettledOrderCount = user?.role === "merchant" ? assignedOrders.filter((order) => (
    (order.status === "delivered" || order.status === "returned") && !paidOrderIds.has(order.id)
  )).length : 0;
  const eligible = Boolean(user && user.role !== "admin" && activeOrderCount === 0 && unsettledCollectionCount === 0 && unsettledOrderCount === 0);

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
    <section className="delete-account-panel">
      <header className="delete-account-intro">
        <span><Icon name="trash" size={26} /></span>
        <div><h2>قبل حذف حسابك</h2><p>نحترم حقك في التحكم ببياناتك. قبل حذف الحساب نهائيًا، تأكد من استكمال الخطوات التالية:</p></div>
      </header>
      <ol className="delete-account-requirements">
        <li className={unsettledCollectionCount === 0 ? "is-complete" : "is-blocked"}><span><Icon name={unsettledCollectionCount === 0 ? "check" : "alert"} size={18} /></span><p>إكمال جميع معاملات التحصيل والحسابات المالية المعلّقة.</p></li>
        <li className={activeOrderCount === 0 ? "is-complete" : "is-blocked"}><span><Icon name={activeOrderCount === 0 ? "check" : "alert"} size={18} /></span><p>ألا توجد طرود نشطة؛ يجب أن تكون جميع الطرود واصلة أو راجعة.</p></li>
        {user.role === "merchant" && <li className={unsettledOrderCount === 0 ? "is-complete" : "is-blocked"}><span><Icon name={unsettledOrderCount === 0 ? "check" : "alert"} size={18} /></span><p>إدراج كل طرد مكتمل في فاتورة تحصيل مدفوعة واستلام مستحقاته.</p></li>}
        <li><span><Icon name="download" size={18} /></span><p>تنزيل أي فواتير أو سجلات تحتاج إليها؛ لن تتمكن من استعادتها بعد الحذف.</p></li>
        <li><span><Icon name="shield" size={18} /></span><p>الحذف نهائي وفوري بعد التأكيد، ويزيل الحساب وبياناته المرتبطة ولا يمكن التراجع عنه.</p></li>
      </ol>
      <div className={`delete-account-status ${eligible ? "is-ready" : "is-blocked"}`} role="status">
        <Icon name={eligible ? "check" : "alert"} size={20} />
        <div>{eligible ? <><strong>يمكنك حذف الحساب الآن</strong><small>ستحتاج إلى كلمة المرور وكتابة عبارة التأكيد.</small></> : <><strong>لا يمكن حذف الحساب الآن</strong><small>{activeOrderCount > 0 && `${activeOrderCount} طرد نشط`}{activeOrderCount > 0 && (unsettledCollectionCount > 0 || unsettledOrderCount > 0) ? " · " : ""}{unsettledCollectionCount > 0 && `${unsettledCollectionCount} فاتورة غير مدفوعة`}{unsettledCollectionCount > 0 && unsettledOrderCount > 0 ? " · " : ""}{unsettledOrderCount > 0 && `${unsettledOrderCount} طرد بلا تحصيل مكتمل`}</small></>}</div>
      </div>
    </section>
    <div className="delete-account-actions">
      <Button variant="danger" icon="trash" full disabled={!eligible} onClick={() => setConfirmationOpen(true)}>حذف الحساب</Button>
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
  const { preferences, updatePreferences, setView, showToast } = useApp();
  return <div className="page-content animate-page"><PageHeader title="إعدادات الإشعارات" subtitle="تحكّم بالتنبيهات التي تصلك" onBack={() => setView("settings")} /><div className="settings-group"><SettingsRow icon="bell" title="تفعيل الإشعارات" subtitle="تلقي التحديثات المهمة" action={<Toggle checked={preferences.notifications} onChange={(value) => { updatePreferences({ notifications: value }); showToast(value ? "تم تفعيل الإشعارات." : "تم إيقاف الإشعارات."); }} label="الإشعارات" />} /><SettingsRow icon="truck" title="تحديثات الطرود" subtitle="تنبيه عند تغير حالة أي طرد" action={<Toggle checked={preferences.orderUpdates} onChange={(value) => updatePreferences({ orderUpdates: value })} label="تحديثات الطرود" />} /><SettingsRow icon="bell" title="الأصوات" subtitle="تشغيل صوت عند وصول إشعار" action={<Toggle checked={preferences.sounds} onChange={(value) => updatePreferences({ sounds: value })} label="أصوات الإشعارات" />} /></div></div>;
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
  { question: "كيف أستلم مبالغ التحصيل؟", answer: "أنشئ فاتورة من تبويب التحصيلات بعد وصول الطرود. عندما تصبح جاهزة، اعرض رمز التحقق للموظف؛ وبعد قراءة الرمز الصحيح تتغير حالة التحصيل مباشرة إلى «مشحون»." },
];

export function HelpPage() {
  const { setView, showToast } = useApp();
  const [active, setActive] = useState(0);
  return <div className="page-content animate-page"><PageHeader title="مركز المساعدة" subtitle="إجابات عن أكثر الأسئلة شيوعًا" onBack={() => setView("settings")} /><section className="help-hero"><Icon name="help" size={38} /><h2>كيف نقدر نساعدك؟</h2><p>تصفح الأسئلة الشائعة أو تواصل مع فريق الدعم على مدار الساعة.</p><Button variant="secondary" icon="phone" onClick={() => showToast("رقم الدعم: 0599000000", "info")}>اتصل بالدعم — 0599000000</Button></section><div className="faq-list">{faqs.map((faq, index) => <article className={`faq-item ${active === index ? "is-open" : ""}`} key={faq.question}><button onClick={() => setActive(active === index ? -1 : index)}><Icon name="help" size={19} /><span>{faq.question}</span><Icon name="chevronDown" size={18} /></button>{active === index && <p>{faq.answer}</p>}</article>)}</div></div>;
}

const policy = [
  { title: "1. البيانات التي نجمعها", body: "نجمع بيانات حسابك مثل الاسم ورقم الجوال والبريد الإلكتروني واسم المتجر، إلى جانب بيانات المستلمين والطرود والعناوين الضرورية لإتمام عمليات التوصيل. لا نطلب بيانات غير لازمة لتقديم الخدمة." },
  { title: "2. استخدام البيانات", body: "نستخدم بياناتك لتنسيق عمليات التوصيل والتحصيل وتحديث حالة الطرود والتواصل معك عند الحاجة. لا نبيع بياناتك أو نشاركها لأغراض إعلانية دون موافقتك." },
  { title: "3. مسؤوليات المرسل", body: "يلتزم المرسل بصحة بيانات الطرد والمستلم وتغليف المحتويات بصورة مناسبة، والإفصاح عن أي محتوى حساس أو قابل للكسر قبل تسليم الطرد." },
  { title: "4. المدفوعات والتحصيل", body: "تُحدد رسوم التوصيل حسب المحافظة وتظهر قبل إنشاء الطرد. تُحصّل قيمة الطلب من المستلم وتُضاف إلى رصيد التاجر وفق الاتفاق." },
  { title: "5. الرواجع والتحصيلات", body: "يمكنك متابعة الطرود الراجعة وفواتير التحصيل من داخل المنصة. تُحتسب الفاتورة من الطرود الواصلة والرواجع ورسوم التوصيل المسجلة." },
  { title: "6. حماية الحساب", body: "أنت مسؤول عن الحفاظ على سرية كلمة المرور ورمز القفل. ننصح بتفعيل خيارات الأمان المتاحة وإبلاغنا فورًا عند الاشتباه بأي دخول غير مصرح به." },
  { title: "7. حقوقك", body: "يمكنك عرض بيانات حسابك وطلب حذف الحساب من صفحة الأمان والخصوصية. حفاظًا على دقة بيانات التشغيل، لا يغيّر بيانات الحساب إلا المسؤول من لوحة الإدارة." },
];

export function PrivacyPage() {
  const { setView } = useApp();
  return <div className="page-content animate-page"><PageHeader title="سياسة الخصوصية وشروط الاستخدام" onBack={() => setView("settings")} /><div className="policy-list">{policy.map((entry) => <SectionCard key={entry.title}><h2>{entry.title}</h2><p>{entry.body}</p></SectionCard>)}</div></div>;
}
