"use client";

import { useState } from "react";
import { useApp, type View } from "../lib/app-context";
import { AdminDashboard } from "./admin";
import { Dashboard, OrderDetail, Shipments } from "./dashboard";
import { EmployeeDashboard } from "./employee";
import { CollectionsPage, ImportPage, NotificationsPage, ProfilePage, RecipientsPage, ReturnsPage, TrashPage } from "./management-pages";
import { NewOrder } from "./order-form";
import { ChangePasswordPage, DeleteAccountPage, HelpPage, LinkedDevicesPage, NotificationSettings, PreferencesPage, PrivacyPage, SecurityPage, SettingsPage } from "./settings-pages";
import { Icon, type IconName } from "./icon";
import { Avatar, Brand, Button, EmptyState, Field, IconButton, Modal, StatusPill } from "./ui";

function NavigationDrawer({ onClose }: { onClose: () => void }) {
  const { user, setView, logout, confirm, openAccountSwitcher } = useApp();
  if (!user) return null;
  const admin = user.role === "admin";
  const employee = user.role === "courier";
  const links: { icon: IconName; label: string; view: View }[] = admin ? [
    { icon: "home", label: "لوحة التحكم", view: "admin" },
    { icon: "bell", label: "الإشعارات", view: "notifications" },
    { icon: "trash", label: "الطرود المحذوفة", view: "trash" },
    { icon: "settings", label: "الإعدادات", view: "settings" },
  ] : employee ? [
    { icon: "scan", label: "مسح كود الطرد", view: "home" },
    { icon: "bell", label: "الإشعارات", view: "notifications" },
    { icon: "settings", label: "إعدادات الموظف", view: "settings" },
  ] : [
    { icon: "home", label: "الرئيسية", view: "home" },
    { icon: "users", label: "المستلمون المفضلون", view: "recipients" },
    { icon: "layers", label: "الطرود", view: "shipments" },
    { icon: "return", label: "الرواجع", view: "returns" },
    { icon: "receipt", label: "التحصيلات", view: "collections" },
    { icon: "settings", label: "الإعدادات", view: "settings" },
  ];

  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="navigation-drawer"><div className="drawer-profile"><IconButton name="close" label="إغلاق القائمة" onClick={onClose} /><Avatar name={user.name} color="#ffffff" large /><strong>{admin ? "إدارة المدينة إكسبرس" : user.name}</strong><span>{employee ? `حساب موظف · ${user.store}` : user.store}</span><small><Icon name="mapPin" size={14} /> فلسطين</small></div><nav className="drawer-links">{links.map((item) => <button key={`${item.view}-${item.label}`} onClick={() => { setView(item.view); onClose(); }}><Icon name={item.icon} size={20} />{item.label}<Icon name="chevronLeft" size={16} /></button>)}</nav><footer className="drawer-footer"><button onClick={() => { onClose(); openAccountSwitcher(); }}><Icon name="switch" size={19} />تبديل الحساب</button><button className="drawer-logout" onClick={() => { onClose(); confirm({ title: "تسجيل الخروج؟", message: "يمكنك العودة إلى حسابك في أي وقت.", confirmLabel: "تسجيل الخروج", onConfirm: logout }); }}><Icon name="logout" size={19} />تسجيل الخروج</button><span>Version 1.0.0</span></footer></aside></div>;
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

function BottomNavigation() {
  const { view, setView } = useApp();
  const entries: { view: View; label: string; icon: IconName }[] = [{ view: "home", label: "الرئيسية", icon: "home" }, { view: "shipments", label: "الطرود", icon: "layers" }, { view: "returns", label: "الرواجع", icon: "return" }, { view: "collections", label: "التحصيلات", icon: "receipt" }];
  return <nav className="bottom-nav" aria-label="التنقل الرئيسي"><button className={view === entries[0].view ? "is-active" : ""} onClick={() => setView(entries[0].view)}><Icon name={entries[0].icon} size={22} /><span>{entries[0].label}</span></button><button className={view === entries[1].view ? "is-active" : ""} onClick={() => setView(entries[1].view)}><Icon name={entries[1].icon} size={22} /><span>{entries[1].label}</span></button><button className="bottom-nav__create" onClick={() => setView("new-order")} aria-label="إنشاء طرد جديد"><Icon name="plus" size={30} /></button><button className={view === entries[2].view ? "is-active" : ""} onClick={() => setView(entries[2].view)}><Icon name={entries[2].icon} size={22} /><span>{entries[2].label}</span></button><button className={view === entries[3].view ? "is-active" : ""} onClick={() => setView(entries[3].view)}><Icon name={entries[3].icon} size={22} /><span>{entries[3].label}</span></button></nav>;
}

function CurrentPage() {
  const { user, view } = useApp();
  if (view === "admin" && user?.role === "admin") return <AdminDashboard />;
  switch (view) {
    case "home": return user?.role === "admin" ? <AdminDashboard /> : user?.role === "courier" ? <EmployeeDashboard /> : <Dashboard />;
    case "shipments": return <Shipments />;
    case "returns": return <ReturnsPage />;
    case "collections": return <CollectionsPage />;
    case "new-order": return <NewOrder />;
    case "order-detail": return <OrderDetail />;
    case "recipients": return <RecipientsPage />;
    case "settings": return <SettingsPage />;
    case "security": return <SecurityPage />;
    case "change-password": return <ChangePasswordPage />;
    case "linked-devices": return <LinkedDevicesPage />;
    case "delete-account": return <DeleteAccountPage />;
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
  const { user, view, preferences } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const securityFlow = view === "delete-account" || view === "change-password" || view === "linked-devices";
  return <main className={`application ${user?.role === "admin" ? "application--admin" : ""} ${user?.role === "courier" ? "application--employee" : ""} ${securityFlow ? "application--security-flow" : ""} ${preferences.compact ? "application--compact" : ""}`}><TopBar onMenu={() => setMenuOpen(true)} onSearch={() => setSearchOpen(true)} /><CurrentPage />{user?.role === "merchant" && !securityFlow && <BottomNavigation />}{menuOpen && <NavigationDrawer onClose={() => setMenuOpen(false)} />}{searchOpen && user?.role !== "courier" && <GlobalSearch onClose={() => setSearchOpen(false)} />}</main>;
}
