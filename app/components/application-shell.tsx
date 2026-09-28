"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDrawerModal } from "../lib/use-drawer-modal";
import { useApp, type View } from "../lib/app-context";
import { DeletionRequestsAdminPage } from "./deletion-admin";
import { AdminDashboard } from "./admin";
import { Dashboard, OrderDetail, Shipments } from "./dashboard";
import { CustomerFollowupsPage } from "./staff-followups";
import { FollowupsPage } from "./followups";
import { EmployeeDashboard } from "./employee";
import { CollectionsPage, ImportPage, NotificationsPage, ProfilePage, RecipientsPage, ReturnsPage, TrashPage } from "./management-pages";
import { ParcelCodeBatchesPage } from "./parcel-code-batches";
import { NewOrder } from "./order-form";
import { ChangePasswordPage, DeleteAccountPage, HelpPage, LinkedDevicesPage, NotificationSettings, PreferencesPage, PrivacyPage, SecurityPage, SettingsPage } from "./settings-pages";
import { Icon, type IconName } from "./icon";
import { RefreshStatus, RequestFailure } from "./server-state";
import { Avatar, Brand, Button, EmptyState, Field, IconButton, Modal, StatusPill } from "./ui";

function NavigationDrawer({ onClose }: { onClose: () => void }) {
  const { user, setView, logout, confirm, openAccountSwitcher } = useApp();
  const drawerRef = useRef<HTMLElement>(null);
  const releaseScroll = useDrawerModal(drawerRef, onClose);
  if (!user || typeof document === "undefined") return null;
  const admin = user.role === "admin";
  const employee = user.role === "courier";
  const links: { icon: IconName; label: string; view: View }[] = admin ? [
    { icon: "home", label: "لوحة التحكم", view: "admin" },
    { icon: "shield", label: "طلبات حذف الحسابات", view: "deletion-requests" },
    { icon: "qrCode", label: "أكواد الطرود للطباعة", view: "parcel-codes" },
    { icon: "bell", label: "الإشعارات", view: "notifications" },
    { icon: "trash", label: "الطرود المحذوفة", view: "trash" },
    { icon: "users", label: "متابعات المستخدمين", view: "customer-followups" },
    { icon: "message", label: "المتابعات", view: "followups" },
    { icon: "settings", label: "الإعدادات", view: "settings" },
  ] : employee ? [
    { icon: "scan", label: "مسح كود الطرد", view: "home" },
    { icon: "layers", label: "طرود المستخدمين", view: "shipments" },
    { icon: "bell", label: "الإشعارات", view: "notifications" },
    { icon: "users", label: "متابعات المستخدمين", view: "customer-followups" },
    { icon: "message", label: "المتابعات", view: "followups" },
    { icon: "settings", label: "إعدادات الموظف", view: "settings" },
  ] : [
    { icon: "home", label: "الرئيسية", view: "home" },
    { icon: "users", label: "المستلمون المفضلون", view: "recipients" },
    { icon: "layers", label: "الطرود", view: "shipments" },
    { icon: "return", label: "الرواجع", view: "returns" },
    { icon: "receipt", label: "التحصيلات", view: "collections" },
    { icon: "message", label: "المتابعات", view: "followups" },
    { icon: "settings", label: "الإعدادات", view: "settings" },
  ];

  return createPortal(<div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside ref={drawerRef} className="navigation-drawer" role="dialog" aria-modal="true" aria-label="القائمة الجانبية" tabIndex={-1}><div className="drawer-profile"><IconButton name="close" label="إغلاق القائمة" onClick={onClose} /><Avatar name={user.name} color="#ffffff" large /><strong>{admin ? "إدارة المدينة إكسبرس" : user.name}</strong><span>{employee ? `حساب موظف · ${user.store}` : user.store}</span><small><Icon name="mapPin" size={14} /> فلسطين</small></div><nav className="drawer-links">{links.map((item) => <button key={`${item.view}-${item.label}`} onClick={() => { releaseScroll(); setView(item.view); onClose(); }}><Icon name={item.icon} size={20} />{item.label}<Icon name="chevronLeft" size={16} /></button>)}</nav><footer className="drawer-footer"><button onClick={() => { onClose(); openAccountSwitcher(); }}><Icon name="switch" size={19} />تبديل الحساب</button><button className="drawer-logout" onClick={() => { onClose(); confirm({ title: "تسجيل الخروج؟", message: "يمكنك العودة إلى حسابك في أي وقت.", confirmLabel: "تسجيل الخروج", onConfirm: logout }); }}><Icon name="logout" size={19} />تسجيل الخروج</button><span>Version 1.0.0</span></footer></aside></div>, document.body);
}

function GlobalSearch({ onClose }: { onClose: () => void }) {
  const { database, user, setView, setSelectedOrderId } = useApp();
  const [query, setQuery] = useState("");
  const orders = query.trim() ? database.orders.filter((order) => !order.deleted && (user?.role === "admin" || order.merchantId === user?.id) && `${order.trackingNumber} ${order.recipientName} ${order.recipientPhone} ${order.city}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8) : [];
  return <Modal onClose={onClose} title="بحث سريع" className="search-modal"><Field icon="search" placeholder="رقم التتبع، اسم المستلم أو رقم الجوال..." value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />{orders.length ? <div className="search-results">{orders.map((order) => <button key={order.id} onClick={() => { setSelectedOrderId(order.id); setView("order-detail"); onClose(); }}><Icon name="package" size={20} /><div><strong>{order.recipientName}</strong><span dir="ltr">{order.trackingNumber}</span></div><StatusPill status={order.status} /></button>)}</div> : query && <EmptyState icon="search" title="لا توجد نتائج" description="جرّب رقم تتبع أو اسمًا مختلفًا." />}</Modal>;
}

function TopBar({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const { database, user, view, setView, openScanner } = useApp();
  const unread = database.notices.filter((notice) => notice.userId === user?.id && !notice.read).length;
  const employee = user?.role === "courier";
  if (view === "settings" || view === "profile") return null;
  if (view === "new-order") return <header className="topbar"><div className="topbar__inner"><Button type="reset" form="new-order-form" variant="ghost" icon="trash">مسح جميع الحقول</Button></div></header>;
  return <header className="topbar"><div className="topbar__inner"><IconButton name="menu" label="فتح القائمة" onClick={onMenu} /><button className="topbar__brand" onClick={() => setView(user?.role === "admin" ? "admin" : "home")}><Brand compact /></button><div className="topbar__actions">{user?.role === "merchant" && <button className="topbar__import" type="button" onClick={() => setView("import")}><Icon name="spreadsheet" size={18} /><span>استيراد Excel</span></button>}{!employee && <IconButton name="search" label="بحث" onClick={onSearch} />}<IconButton name="camera" label={employee ? "مسح كود الطرد بالكاميرا" : "مسح رمز الطرد"} onClick={() => openScanner()} />{!employee && <IconButton name="trash" label="المحذوفات" onClick={() => setView("trash")} />}<IconButton name="bell" label="الإشعارات" badge={unread} onClick={() => setView("notifications")} /></div></div></header>;
}

function NewOrderFloatingButton() {
  const { setView } = useApp();
  return <button type="button" className="new-order-fab" aria-label="إنشاء طرد جديد" title="إنشاء طرد جديد" onClick={() => setView("new-order")}><Icon name="plus" size={32} /></button>;
}

function CurrentPage() {
  const { user, view } = useApp();
  if (view === "admin" && user?.role === "admin") return <AdminDashboard />;
  switch (view) {
    case "home": return user?.role === "admin" ? <AdminDashboard /> : user?.role === "courier" ? <EmployeeDashboard /> : <Dashboard />;
    case "shipments": return <Shipments />;
    case "returns": return <ReturnsPage />;
    case "collections": return <CollectionsPage />;
    case "parcel-codes": return <ParcelCodeBatchesPage />;
    case "new-order": return <NewOrder />;
    case "order-detail": return <OrderDetail />;
    case "followups": return <FollowupsPage />;
    case "customer-followups": return <CustomerFollowupsPage />;
    case "recipients": return <RecipientsPage />;
    case "settings": return <SettingsPage />;
    case "security": return <SecurityPage />;
    case "change-password": return <ChangePasswordPage />;
    case "linked-devices": return <LinkedDevicesPage />;
    case "deletion-requests": return <DeletionRequestsAdminPage />;
    case "delete-account": return <DeleteAccountPage key={user?.id} />;
    case "notification-settings": return <NotificationSettings />;
    case "preferences": return <PreferencesPage />;
    case "help": return <HelpPage />;
    case "privacy": return <PrivacyPage />;
    case "notifications": return <NotificationsPage />;
    case "trash": return <TrashPage />;
    case "import": return <ImportPage />;
    case "profile": return <ProfilePage />;
    default: return user?.role === "courier" ? <EmployeeDashboard /> : <Dashboard />;
  }
}

export function ApplicationShell() {
  const { user, view, preferences, serverSync } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const securityFlow = view === "delete-account" || view === "change-password" || view === "linked-devices";
  const showCreate = user?.role === "merchant" && (view === "home" || view === "shipments");
  return <main className={`application ${user?.role === "admin" ? "application--admin" : ""} ${user?.role === "courier" ? "application--employee" : ""} ${securityFlow ? "application--security-flow" : ""} ${showCreate ? "application--with-create" : ""} ${preferences.compact ? "application--compact" : ""}`}>
    <TopBar onMenu={() => setMenuOpen(true)} onSearch={() => setSearchOpen(true)} />
    <div className="server-connection">{serverSync?.offline ? <RequestFailure compact message="لا يوجد اتصال بالإنترنت. المعروض آخر بيانات تم تحميلها." onRetry={serverSync.retry} busy={serverSync.busy} /> : serverSync?.error ? <RequestFailure compact message={`${serverSync.error} المعروض آخر بيانات تم تحميلها.`} onRetry={serverSync.retry} busy={serverSync.busy} /> : serverSync?.busy ? <RefreshStatus /> : null}</div>
    <CurrentPage />
    {showCreate && !menuOpen && !searchOpen && <NewOrderFloatingButton />}
    {menuOpen && <NavigationDrawer onClose={() => setMenuOpen(false)} />}
    {searchOpen && user?.role !== "courier" && <GlobalSearch onClose={() => setSearchOpen(false)} />}
  </main>;
}
