"use client";

import { useState, type ReactNode } from "react";
import { useApp, type View } from "../lib/app-context";
import { Icon, type IconName } from "./icon";
import { Button, PageHeader, SectionCard, Toggle } from "./ui";

function SettingsRow({ icon, title, subtitle, onClick, action, danger = false }: { icon: IconName; title: string; subtitle?: string; onClick?: () => void; action?: ReactNode; danger?: boolean }) {
  return <div className={`settings-row ${danger ? "settings-row--danger" : ""}`} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={(event) => { if (onClick && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onClick(); } }}><span className="settings-row__icon"><Icon name={icon} size={20} /></span><div><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>{action ?? <Icon name="chevronLeft" size={19} />}</div>;
}

export function SettingsPage() {
  const { user, setView, preferences, updatePreferences, showToast, logout, confirm } = useApp();
  const route = (view: View) => () => setView(view);
  return <div className="page-content settings-page animate-page"><PageHeader title="الإعدادات" subtitle={user?.email} onBack={() => setView("home")} /><div className="settings-group"><SettingsRow icon="user" title="الملف الشخصي" subtitle={user?.role === "admin" ? "إدارة بيانات حساب المسؤول" : "بيانات حسابك للعرض فقط"} onClick={route("profile")} /><SettingsRow icon="shield" title="الأمان والخصوصية" subtitle="قفل التطبيق وحذف الحساب" onClick={route("security")} /><SettingsRow icon="bell" title="الإشعارات" subtitle="تنبيهات الطرود والعروض" onClick={route("notification-settings")} /><SettingsRow icon="sliders" title="التفضيلات" subtitle="المظهر والعرض" onClick={route("preferences")} /></div><div className="settings-group"><SettingsRow icon="help" title="مركز المساعدة" subtitle="الأسئلة الشائعة" onClick={route("help")} /><SettingsRow icon="file" title="سياسة الخصوصية وشروط الاستخدام" onClick={route("privacy")} /></div><SectionCard className="rating-card"><div><Icon name="star" size={20} /><strong>قيّم التطبيق</strong></div><div className="rating-stars">{[1, 2, 3, 4, 5].map((star) => <button key={star} aria-label={`${star} من 5`} className={star <= preferences.rating ? "is-rated" : ""} onClick={() => { updatePreferences({ rating: star }); showToast("شكرًا لك! تم حفظ تقييمك."); }}><Icon name="star" size={28} /></button>)}</div></SectionCard><div className="settings-group"><SettingsRow icon="logout" title="تسجيل الخروج" danger onClick={() => confirm({ title: "تسجيل الخروج؟", message: "يمكنك تسجيل الدخول مرة أخرى في أي وقت.", confirmLabel: "تسجيل الخروج", onConfirm: logout })} /></div><p className="version-label">Almadina Express v1.0.0</p></div>;
}

export function SecurityPage() {
  const { user, preferences, updatePreferences, setView, updateDatabase, logout, showToast, confirm } = useApp();
  const [pin, setPin] = useState("");

  function press(value: string) {
    if (value === "clear") return setPin("");
    if (value === "delete") return setPin((current) => current.slice(0, -1));
    const next = `${pin}${value}`.slice(0, 4);
    setPin(next);
    if (next.length === 4) { updatePreferences({ pin: next }); showToast("تم تفعيل رمز قفل التطبيق."); window.setTimeout(() => setPin(""), 300); }
  }

  function deleteAccount() {
    if (!user) return;
    confirm({ title: "حذف الحساب نهائيًا؟", message: "سيتم حذف حسابك وجميع بياناتك وطرودك المحفوظة. لا يمكن التراجع عن هذا الإجراء.", confirmLabel: "حذف حسابي", danger: true, onConfirm: () => { updateDatabase((current) => ({ ...current, users: current.users.filter((entry) => entry.id !== user.id), orders: current.orders.filter((order) => order.merchantId !== user.id), recipients: current.recipients.filter((entry) => entry.merchantId !== user.id), collections: current.collections.filter((invoice) => invoice.merchantId !== user.id), notices: current.notices.filter((notice) => notice.userId !== user.id), preferences: Object.fromEntries(Object.entries(current.preferences).filter(([accountId]) => accountId !== user.id)) })); logout(); showToast("تم حذف الحساب وبياناته."); } });
  }

  return <div className="page-content animate-page"><PageHeader title="الأمان والخصوصية" onBack={() => setView("settings")} /><div className="settings-group"><SettingsRow icon="lock" title="قفل التطبيق" subtitle={preferences.pin ? "رمز القفل مفعّل" : "احمِ حسابك برمز دخول"} action={<Toggle checked={Boolean(preferences.pin)} onChange={(value) => { if (!value) { updatePreferences({ pin: "" }); showToast("تم إيقاف قفل التطبيق."); } else showToast("أدخل رمزًا جديدًا من 4 أرقام.", "info"); }} label="قفل التطبيق" />} /><SettingsRow icon="fingerprint" title="الدخول بالبصمة" subtitle="تسجيل دخول أسرع وأكثر أمانًا" action={<Toggle checked={preferences.biometric} onChange={(value) => { updatePreferences({ biometric: value }); showToast(value ? "تم تفعيل الدخول بالبصمة." : "تم إيقاف الدخول بالبصمة."); }} label="الدخول بالبصمة" />} /></div><SectionCard title="أدخل رمز قفل جديد (4 أرقام)" className="pin-card"><div className="pin-dots">{[0, 1, 2, 3].map((index) => <span key={index} className={index < pin.length ? "is-filled" : ""} />)}</div><div className="pin-keypad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "delete"].map((value) => <button key={value} onClick={() => press(value)}>{value === "clear" ? "C" : value === "delete" ? <Icon name="arrowLeft" size={20} /> : value}</button>)}</div></SectionCard>{user?.role !== "admin" && <div className="settings-group"><SettingsRow icon="trash" title="حذف الحساب" subtitle="حذف نهائي لجميع بياناتك وطلباتك" danger onClick={deleteAccount} /></div>}</div>;
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
