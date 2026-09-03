"use client";

import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { useApp } from "../lib/app-context";
import { appendOrderTrackingEvent, formatDate, getStatus, money, normalizeMembership, relativeDate, statusDefinitions, uid, type Membership, type NoticeAudience, type OrderStatus, type User } from "../lib/data";
import { Icon } from "./icon";
import { TrackingNoteComposer } from "./tracking-history";
import { Avatar, Button, CollectionAmount, EmptyState, Field, IconButton, Modal, Segmented, SelectField, StatusPill } from "./ui";

type AdminTab = "orders" | "users" | "collections" | "couriers";
type AccountEditor = { id: string; name: string; email: string; phone: string; store: string; role: "merchant" | "courier" };

function membershipLabel(membership: Membership): string {
  return membership === "diamond" ? "ماسي" : membership === "premium" ? "بريميوم" : "عادي";
}

export function AdminDashboard() {
  const { database, user, updateDatabase, prepareCollectionInvoice, verifyCollectionCode, broadcastNotice, confirm, showToast, notify, setView, setSelectedOrderId } = useApp();
  const [tab, setTab] = useState<AdminTab>("orders");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [statusUpdate, setStatusUpdate] = useState<{ orderId: string; status: OrderStatus; note: string } | null>(null);
  const [collectionVerification, setCollectionVerification] = useState<{ invoiceId: string; invoiceNumber: string; code: string } | null>(null);
  const [verifyingCollection, setVerifyingCollection] = useState(false);
  const [preparingCollectionId, setPreparingCollectionId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<AccountEditor | null>(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", store: "", password: "", role: "merchant" as "merchant" | "courier", membership: "standard" as Membership });
  const [announcement, setAnnouncement] = useState({ title: "", message: "", audience: "all" as NoticeAudience, recipientUserId: "" });
  const merchants = database.users.filter((user) => user.role === "merchant");
  const couriers = database.users.filter((user) => user.role === "courier");
  const notificationUsers = [...merchants, ...couriers].sort((first, second) => first.name.localeCompare(second.name, "ar"));
  const orders = database.orders.filter((order) => !order.deleted);
  const collectionAmount = database.collections.filter((invoice) => invoice.status !== "paid").reduce((sum, invoice) => sum + invoice.netAmount, 0);

  const visibleOrders = useMemo(() => orders.filter((order) => (status === "all" || order.status === status) && (!query || `${order.trackingNumber} ${order.recipientName} ${order.merchantName} ${order.merchantStore} ${order.recipientPhone}`.toLowerCase().includes(query.toLowerCase()))), [orders, query, status]);
  const visibleUsers = merchants.filter((user) => !query || `${user.name} ${user.email} ${user.phone} ${user.store}`.toLowerCase().includes(query.toLowerCase()));
  const visibleCouriers = couriers.filter((user) => !query || `${user.name} ${user.email} ${user.phone}`.toLowerCase().includes(query.toLowerCase()));

  function deleteUser(user: User) {
    confirm({ title: "حذف الحساب نهائيًا؟", message: `سيتم حذف حساب ${user.name} وجميع طلباته وبياناته المرتبطة. لا يمكن التراجع عن هذا الإجراء.`, confirmLabel: "نعم، احذف الحساب", danger: true, onConfirm: () => { updateDatabase((current) => ({ ...current, users: current.users.filter((entry) => entry.id !== user.id), orders: current.orders.filter((order) => order.merchantId !== user.id), recipients: current.recipients.filter((recipient) => recipient.merchantId !== user.id), collections: current.collections.filter((invoice) => invoice.merchantId !== user.id), notices: current.notices.filter((notice) => notice.userId !== user.id), preferences: Object.fromEntries(Object.entries(current.preferences).filter(([accountId]) => accountId !== user.id)) })); showToast("تم حذف الحساب وكل متعلقاته."); } });
  }

  function changeOrderStatus(id: string, nextStatus: OrderStatus) {
    const order = database.orders.find((entry) => entry.id === id);
    if (!order || order.status === nextStatus) return;
    setStatusUpdate({ orderId: id, status: nextStatus, note: "" });
  }

  function saveOrderStatus() {
    if (!statusUpdate) return;
    const order = database.orders.find((entry) => entry.id === statusUpdate.orderId);
    if (!order || order.status === statusUpdate.status) return setStatusUpdate(null);
    const nextStatus = statusUpdate.status;
    const writtenNote = statusUpdate.note.trim();
    updateDatabase((current) => ({ ...current, orders: current.orders.map((entry) => entry.id === order.id ? appendOrderTrackingEvent(entry, nextStatus, user?.name ?? "إدارة المدينة إكسبرس", writtenNote || `تم تغيير حالة الطرد من «${getStatus(entry.status).label}» إلى «${getStatus(nextStatus).label}».`) : entry) }));
    setStatusUpdate(null);
    showToast(`تم تغيير الحالة إلى ${getStatus(nextStatus).label}.`);
  }

  function changeMembership(account: User, membership: Membership) {
    if (account.role !== "merchant" || (account.membership ?? "standard") === membership) return;

    updateDatabase((current) => ({
      ...current,
      users: current.users.map((entry) => entry.id === account.id ? { ...entry, membership } : entry),
    }));

    const label = membershipLabel(membership);
    notify({
      userId: account.id,
      title: "تم تحديث نوع حسابك",
      message: `تم تغيير نوع حسابك إلى ${label} من قبل الإدارة.`,
      icon: membership === "diamond" ? "sparkles" : membership === "premium" ? "star" : "user",
    });
    showToast(`تم تغيير حساب ${account.name} إلى ${label}.`);
  }

  function createUser(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.store.trim()) return showToast(form.role === "courier" ? "أدخل جميع حقول الاسم المطلوبة." : "أدخل الاسم واسم المتجر.", "error");
    if (!/^05\d{8}$/.test(form.phone)) return showToast("أدخل رقم جوال صحيحًا من 10 أرقام.", "error");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return showToast("أدخل بريدًا إلكترونيًا صحيحًا.", "error");
    if (database.users.some((user) => user.email.toLowerCase() === form.email.toLowerCase())) return showToast("هذا البريد الإلكتروني مسجل مسبقًا.", "error");
    if (database.users.some((user) => user.phone === form.phone)) return showToast("رقم الجوال مسجل لحساب آخر.", "error");
    const user: User = { id: uid(form.role), name: form.name.trim(), email: form.email.trim().toLowerCase(), phone: form.phone, store: form.store.trim(), password: form.password || "User@123", role: form.role, ...(form.role === "merchant" ? { membership: form.membership } : {}), joinedAt: new Date().toISOString(), avatarColor: form.role === "courier" ? "#6655a6" : "#187a50" };
    updateDatabase((current) => ({ ...current, users: [...current.users, user] })); setAddUserOpen(false); setForm({ name: "", email: "", phone: "", store: "", password: "", role: "merchant", membership: "standard" }); showToast(`تمت إضافة ${user.role === "courier" ? "المندوب" : "المستخدم"} بنجاح.`);
  }

  function openAccountEditor(account: User) {
    if (account.role !== "merchant" && account.role !== "courier") return;
    setEditingAccount({ id: account.id, name: account.name, email: account.email, phone: account.phone, store: account.store, role: account.role });
  }

  function saveAccount(event: FormEvent) {
    event.preventDefault();
    if (!editingAccount) return;
    const name = editingAccount.name.trim();
    const phone = editingAccount.phone.trim();
    const store = editingAccount.store.trim();
    const email = editingAccount.email.trim().toLowerCase();
    if (!name || !store) return showToast(editingAccount.role === "courier" ? "أدخل جميع حقول الاسم المطلوبة." : "أدخل الاسم واسم المتجر.", "error");
    if (!/^05\d{8}$/.test(phone)) return showToast("أدخل رقم جوال صحيحًا من 10 أرقام.", "error");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast("أدخل بريدًا إلكترونيًا صحيحًا.", "error");
    if (database.users.some((account) => account.id !== editingAccount.id && account.email.toLowerCase() === email)) return showToast("هذا البريد الإلكتروني مسجل لحساب آخر.", "error");
    const savedAccount = database.users.find((account) => account.id === editingAccount.id);
    if (savedAccount?.phone !== phone && database.users.some((account) => account.id !== editingAccount.id && account.phone === phone)) return showToast("رقم الجوال مسجل لحساب آخر.", "error");

    updateDatabase((current) => ({
      ...current,
      users: current.users.map((account) => account.id === editingAccount.id ? { ...account, name, phone, store, email } : account),
    }));
    setEditingAccount(null);
    showToast("تم تحديث بيانات الحساب بواسطة المسؤول.");
  }

  async function prepareCollection(id: string) {
    if (preparingCollectionId) return;
    setPreparingCollectionId(id);
    await prepareCollectionInvoice(id);
    setPreparingCollectionId(null);
  }

  async function submitCollectionVerification(event: FormEvent) {
    event.preventDefault();
    if (!collectionVerification || collectionVerification.code.length !== 4) return;
    setVerifyingCollection(true);
    const verified = await verifyCollectionCode(collectionVerification.invoiceId, collectionVerification.code);
    setVerifyingCollection(false);
    if (verified) setCollectionVerification(null);
  }

  function submitAnnouncement(event: FormEvent) {
    event.preventDefault();
    const title = announcement.title.trim();
    const message = announcement.message.trim();
    const audience = announcement.audience;
    const recipientUserId = audience === "user" ? announcement.recipientUserId : "";
    const recipients = database.users.filter((account) => account.role !== "admin" && (
      (audience === "user" && account.id === recipientUserId)
        || audience === "all"
        || (audience === "merchants" && account.role === "merchant")
        || (audience === "couriers" && account.role === "courier")
        || (audience === "premium" && account.role === "merchant" && account.membership === "premium")
        || (audience === "diamond" && account.role === "merchant" && account.membership === "diamond")
        || (audience === "standard" && account.role === "merchant" && normalizeMembership(account.membership) === "standard")
    ));

    if (title.length < 3) return showToast("أدخل عنوانًا واضحًا للإشعار.", "error");
    if (message.length < 5) return showToast("أدخل تفاصيل التحديث قبل الإرسال.", "error");
    if (!recipients.length) return showToast("لا توجد حسابات ضمن الفئة المحددة.", "error");

    const audienceLabel = audience === "merchants" ? "التجار" : audience === "couriers" ? "المندوبين" : audience === "premium" ? "حسابات التجار البريميوم" : audience === "diamond" ? "حسابات التجار الماسية" : audience === "standard" ? "حسابات التجار العادية" : "جميع المستخدمين";
    confirm({
      title: "إرسال إشعار التحديث؟",
      message: audience === "user"
        ? `سيصل الإشعار إلى ${recipients[0].name} (${recipients[0].email}).`
        : `سيصل الإشعار إلى ${audienceLabel} (${recipients.length.toLocaleString("ar-EG")} حسابات).`,
      confirmLabel: "إرسال الآن",
      onConfirm: () => { void sendAnnouncement(audience, recipientUserId, title, message); },
    });
  }

  async function sendAnnouncement(audience: NoticeAudience, recipientUserId: string, title: string, message: string) {
    setSendingAnnouncement(true);
    const recipientCount = await broadcastNotice({ audience, ...(audience === "user" ? { recipientUserId } : {}), title, message });
    setSendingAnnouncement(false);
    if (recipientCount === null) return;

    setNotificationOpen(false);
    setAnnouncement({ title: "", message: "", audience: "all", recipientUserId: "" });
    showToast(`تم إرسال الإشعار إلى ${recipientCount.toLocaleString("ar-EG")} حسابًا.`);
  }

  const searchPlaceholders = { orders: "بحث برقم التتبع أو المستلم...", users: "بحث باسم أو بريد المستخدم...", couriers: "بحث باسم أو رقم المندوب...", collections: "بحث برقم الفاتورة أو اسم التاجر..." };
  const selectedAnnouncementRecipient = announcement.audience === "user"
    ? notificationUsers.find((account) => account.id === announcement.recipientUserId)
    : undefined;
  const announcementRecipientCount = announcement.audience === "user" ? (selectedAnnouncementRecipient ? 1 : 0) : announcement.audience === "merchants" ? merchants.length : announcement.audience === "couriers" ? couriers.length : announcement.audience === "premium" ? merchants.filter((account) => account.membership === "premium").length : announcement.audience === "diamond" ? merchants.filter((account) => account.membership === "diamond").length : announcement.audience === "standard" ? merchants.filter((account) => normalizeMembership(account.membership) === "standard").length : merchants.length + couriers.length;

  return <div className="page-content admin-page animate-page"><header className="admin-title"><div><h1>لوحة الإدارة</h1><p>المدينة إكسبرس — تحكم كامل</p></div><Button type="button" icon="send" className="admin-notification-button" onClick={() => setNotificationOpen(true)}>إرسال تحديث</Button></header><div className="admin-stats"><button className="admin-stat" onClick={() => setTab("users")}><span style={{ color: "#187a50", background: "#e6f4ed" }}><Icon name="users" size={21} /></span><strong>{merchants.length}</strong><small>تاجر</small></button><button className="admin-stat" onClick={() => setTab("orders")}><span style={{ color: "#6257ad", background: "#efedff" }}><Icon name="package" size={21} /></span><strong>{orders.length}</strong><small>طرد</small></button><button className="admin-stat" onClick={() => setTab("collections")}><span style={{ color: "#bf862d", background: "#fff4dc" }}><Icon name="receipt" size={21} /></span><strong><CollectionAmount amount={collectionAmount} /></strong><small>تحصيلات مستحقة</small></button><button className="admin-stat admin-stat--courier" onClick={() => setTab("couriers")}><span style={{ color: "#218391", background: "#e4f4f5" }}><Icon name="bike" size={21} /></span><strong>{couriers.length}</strong><small>مندوب</small></button></div><Segmented className="admin-tabs" value={tab} onChange={(value) => { setTab(value as AdminTab); setQuery(""); setStatus("all"); }} items={[{ value: "orders", label: "الطرود" }, { value: "users", label: "المستخدمون" }, { value: "collections", label: "التحصيلات" }, { value: "couriers", label: "المندوبون" }]} /><div className="admin-toolbar"><Field icon="search" placeholder={searchPlaceholders[tab]} value={query} onChange={(event) => setQuery(event.target.value)} wrapperClassName="admin-search" />{(tab === "users" || tab === "couriers") && <IconButton name="plus" label={tab === "users" ? "إضافة مستخدم" : "إضافة مندوب"} className="admin-add-button" onClick={() => { setForm({ ...form, role: tab === "couriers" ? "courier" : "merchant" }); setAddUserOpen(true); }} />}</div>

  {tab === "orders" && <><div className="filter-scroll admin-filters"><button className={status === "all" ? "filter-chip is-active" : "filter-chip"} onClick={() => setStatus("all")}>الكل</button>{statusDefinitions.map((entry) => <button className={status === entry.id ? "filter-chip is-active" : "filter-chip"} key={entry.id} onClick={() => setStatus(entry.id)}>{entry.label}</button>)}</div>{visibleOrders.length ? <div className="admin-order-list">{visibleOrders.map((order) => <article className="admin-order-card" key={order.id}><button className="admin-order-card__headline" onClick={() => { setSelectedOrderId(order.id); setView("order-detail"); }}><div><strong>{order.merchantName}</strong><span dir="ltr">{order.trackingNumber}</span></div><StatusPill status={order.status} /></button><div className="admin-order-card__meta"><span><Icon name="user" size={14} />{order.recipientName}</span><span><Icon name="mapPin" size={14} />{order.city}</span><span>{money(order.amount)} ₪</span><span>{relativeDate(order.createdAt)}</span></div><div className="admin-status-buttons">{statusDefinitions.map((entry) => <button key={entry.id} className={order.status === entry.id ? "is-active" : ""} disabled={order.status === entry.id} style={{ "--status-color": entry.color } as CSSProperties} onClick={() => changeOrderStatus(order.id, entry.id)}>{entry.label}</button>)}<button className="admin-delete-order" onClick={() => confirm({ title: "حذف الطرد؟", message: `سيُنقل الطرد ${order.trackingNumber} إلى المحذوفات.`, confirmLabel: "حذف الطرد", danger: true, onConfirm: () => { updateDatabase((current) => ({ ...current, orders: current.orders.map((entry) => entry.id === order.id ? { ...entry, deleted: true } : entry) })); showToast("تم نقل الطرد إلى المحذوفات."); } })}><Icon name="trash" size={13} />حذف</button></div></article>)}</div> : <EmptyState icon="package" title="لا توجد طرود" description="ستظهر هنا جميع الطرود التي ينشئها التجار." />}</>}

  {tab === "users" && (visibleUsers.length ? (
    <div className="admin-user-list">
      {visibleUsers.map((user) => {
        const membership = normalizeMembership(user.membership);

        return (
          <article className="admin-user-card admin-user-card--merchant" key={user.id}>
            <Avatar name={user.name} color={user.avatarColor} />

            <div className="admin-user-card__body">
              <div className="admin-user-card__identity">
                <strong>{user.name}</strong>
                <span className={`membership-badge membership-badge--${membership}`}>
                  <Icon name={membership === "diamond" ? "sparkles" : membership === "premium" ? "star" : "user"} size={13} />
                  {membershipLabel(membership)}
                </span>
              </div>
              <a href={`mailto:${user.email}`}>{user.email}</a>
              <span>{user.store} · <bdi>{user.phone}</bdi></span>
              <small>عضو منذ {formatDate(user.joinedAt)}</small>
            </div>

            <div className="admin-user-card__actions">
              <div className="membership-switch" role="group" aria-label={`تغيير نوع حساب ${user.name}`}>
                <button
                  type="button"
                  className={membership === "standard" ? "membership-switch__option is-selected" : "membership-switch__option"}
                  aria-pressed={membership === "standard"}
                  onClick={() => changeMembership(user, "standard")}
                >عادي</button>
                <button
                  type="button"
                  className={membership === "premium" ? "membership-switch__option membership-switch__option--premium is-selected" : "membership-switch__option membership-switch__option--premium"}
                  aria-pressed={membership === "premium"}
                  onClick={() => changeMembership(user, "premium")}
                ><Icon name="star" size={13} />بريميوم</button>
                <button
                  type="button"
                  className={membership === "diamond" ? "membership-switch__option membership-switch__option--diamond is-selected" : "membership-switch__option membership-switch__option--diamond"}
                  aria-pressed={membership === "diamond"}
                  onClick={() => changeMembership(user, "diamond")}
                ><Icon name="sparkles" size={13} />ماسي</button>
              </div>
              <IconButton name="edit" label={`تعديل بيانات حساب ${user.name}`} className="admin-account-edit" onClick={() => openAccountEditor(user)} />
              <IconButton name="trash" label={`حذف حساب ${user.name}`} className="is-danger" onClick={() => deleteUser(user)} />
            </div>
          </article>
        );
      })}
    </div>
  ) : <EmptyState icon="users" title="لا يوجد مستخدمون" description="أضف أول تاجر لبدء إدارة الحسابات." action="إضافة مستخدم" onAction={() => setAddUserOpen(true)} />)}

  {tab === "couriers" && (visibleCouriers.length ? <div className="admin-user-list">{visibleCouriers.map((courier) => <article className="admin-user-card admin-user-card--courier" key={courier.id}><Avatar name={courier.name} color={courier.avatarColor} /><div className="admin-user-card__body"><strong>{courier.name}</strong><a href={`mailto:${courier.email}`}>{courier.email}</a><span>حساب موظف · مندوب توصيل · <bdi>{courier.phone}</bdi></span><small>{orders.filter((order) => order.courierId === courier.id).length} طرود مسندة</small></div><div className="admin-user-card__actions admin-user-card__actions--courier"><IconButton name="edit" label={`تعديل بيانات المندوب ${courier.name}`} className="admin-account-edit" onClick={() => openAccountEditor(courier)} /><IconButton name="trash" label={`حذف المندوب ${courier.name}`} className="is-danger" onClick={() => deleteUser(courier)} /></div></article>)}</div> : <EmptyState icon="bike" title="لا يوجد موظفون / مندوبون" description="أضف مندوبًا ليحصل على حساب موظف لمسح الطرود ومتابعة التوصيل." action="إضافة مندوب" onAction={() => { setForm({ ...form, role: "courier" }); setAddUserOpen(true); }} />)}

  {tab === "collections" && (database.collections.filter((invoice) => !query || `${invoice.invoiceNumber} ${invoice.merchantName}`.includes(query)).length ? (
    <div className="admin-collections">
      {database.collections.filter((invoice) => !query || `${invoice.invoiceNumber} ${invoice.merchantName}`.includes(query)).map((invoice) => {
        const statusLabel = invoice.status === "pending" ? "قيد التجهيز" : invoice.status === "ready" ? "جاهزة للتحويل" : "تم التسليم";
        const completedAt = invoice.paidAt ?? invoice.verifiedAt ?? invoice.updatedAt;
        return (
          <article className="admin-collection-card" key={invoice.id}>
            <div><Avatar name={invoice.merchantName} color="#bc862d" /><div><strong>{invoice.merchantName}</strong><span dir="ltr">{invoice.invoiceNumber}</span></div><span className={`collection-status collection-status--${invoice.status}`}>{statusLabel}</span></div>
            <p>{invoice.deliveredCount} طرد واصل · {invoice.returnedCount} راجع · أُنشئت {relativeDate(invoice.createdAt)}</p>
            <footer>
              <strong><CollectionAmount amount={invoice.netAmount} /></strong>
              {invoice.status === "pending" ? <Button loading={preparingCollectionId === invoice.id} disabled={preparingCollectionId !== null} onClick={() => { void prepareCollection(invoice.id); }}>تجهيز للتحويل</Button> : invoice.status === "ready" ? <Button icon="key" onClick={() => setCollectionVerification({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, code: "" })}>قراءة كود التحقق</Button> : <span>تم التسليم في {formatDate(completedAt)}</span>}
            </footer>
          </article>
        );
      })}
    </div>
  ) : <EmptyState icon="receipt" title="لا توجد فواتير تحصيل" description="ستظهر هنا الفواتير التي ينشئها التجار بعد وصول طرودهم." />)}

  {notificationOpen && <Modal title="إرسال إشعار تحديث" onClose={() => setNotificationOpen(false)} closeDisabled={sendingAnnouncement} className="admin-notification-modal" sheet><form className="modal-form" onSubmit={submitAnnouncement} aria-busy={sendingAnnouncement}><div className="admin-notification-intro"><span><Icon name="sparkles" size={24} /></span><div><h3>أخبر المستخدمين بآخر تحديثات التطبيق</h3><p>سيظهر الإشعار في أيقونة الجرس وصفحة الإشعارات لكل حساب تختاره.</p></div></div><Field icon="bell" label="عنوان الإشعار" placeholder="مثال: تحديث جديد في المدينة إكسبرس" value={announcement.title} onChange={(event) => setAnnouncement({ ...announcement, title: event.target.value.slice(0, 80) })} minLength={3} maxLength={80} required hint={<bdi dir="ltr">{announcement.title.length.toLocaleString("ar-EG")} / ٨٠</bdi>} autoFocus /><label className="field admin-notification-message"><span className="field__label">تفاصيل التحديث</span><span className="field__control"><textarea aria-label="تفاصيل التحديث" placeholder="اكتب تفاصيل الميزة أو التحديث الجديد..." value={announcement.message} onChange={(event) => setAnnouncement({ ...announcement, message: event.target.value.slice(0, 500) })} minLength={5} maxLength={500} rows={5} required /></span><span className="field__hint" dir="ltr">{announcement.message.length.toLocaleString("ar-EG")} / ٥٠٠</span></label><SelectField label="المستلمون" value={announcement.audience} onChange={(event) => { const audience = event.target.value as NoticeAudience; setAnnouncement({ ...announcement, audience, recipientUserId: audience === "user" ? announcement.recipientUserId : "" }); }}><option value="all">جميع المستخدمين</option><option value="merchants">التجار فقط</option><option value="premium">حسابات البريميوم فقط</option><option value="diamond">الحسابات الماسية فقط</option><option value="standard">الحسابات العادية فقط</option><option value="couriers">المندوبون فقط</option><option value="user">مستخدم محدد</option></SelectField>{announcement.audience === "user" && <><SelectField label="اختر المستخدم" value={announcement.recipientUserId} onChange={(event) => setAnnouncement({ ...announcement, recipientUserId: event.target.value })} required><option value="">اختر حسابًا...</option>{merchants.length > 0 && <optgroup label="التجار">{merchants.map((account) => <option key={account.id} value={account.id}>{account.name} — {account.store}</option>)}</optgroup>}{couriers.length > 0 && <optgroup label="المندوبون">{couriers.map((account) => <option key={account.id} value={account.id}>{account.name} — {account.store}</option>)}</optgroup>}</SelectField>{selectedAnnouncementRecipient && <div className="admin-notification-recipient"><Avatar name={selectedAnnouncementRecipient.name} color={selectedAnnouncementRecipient.avatarColor} /><div><strong>{selectedAnnouncementRecipient.name}</strong><span>{selectedAnnouncementRecipient.role === "courier" ? "مندوب" : "تاجر"} · {selectedAnnouncementRecipient.store}</span><small dir="ltr">{selectedAnnouncementRecipient.email}</small></div><Icon name="check" size={19} /></div>}</>}<footer className="admin-notification-summary" aria-live="polite"><div><strong>{announcementRecipientCount.toLocaleString("ar-EG")}</strong><span>عدد الحسابات المستلمة</span></div><Button type="submit" icon="send" loading={sendingAnnouncement} disabled={!announcementRecipientCount}>{sendingAnnouncement ? "جارٍ الإرسال…" : "مراجعة وإرسال"}</Button></footer></form></Modal>}

  {statusUpdate && <Modal title="تحديث حالة الطرد" onClose={() => setStatusUpdate(null)} className="tracking-status-modal" sheet><p className="modal-description">اخترت حالة «{getStatus(statusUpdate.status).label}». أضف ملاحظة اختيارية توضح هذا التحديث للمستخدم.</p><TrackingNoteComposer status={statusUpdate.status} value={statusUpdate.note} onChange={(note) => setStatusUpdate({ ...statusUpdate, note })} onSubmit={saveOrderStatus} submitLabel="حفظ الحالة والملاحظة" optional /></Modal>}

  {collectionVerification && <Modal title="قراءة كود التحقق" onClose={() => !verifyingCollection && setCollectionVerification(null)} className="employee-verification-modal" sheet><form className="modal-form employee-verification-form" onSubmit={submitCollectionVerification}><div className="employee-verification-form__intro"><span><Icon name="key" size={24} /></span><div><strong dir="ltr">{collectionVerification.invoiceNumber}</strong><p>أدخل الكود المكوّن من 4 أرقام الذي يعرضه الزبون. عند صحته تصبح حالة الفاتورة «تم التسليم» مباشرة.</p></div></div><Field icon="key" label="كود التحقق" aria-label="كود تحقق فاتورة التحصيل" placeholder="0000" value={collectionVerification.code} onChange={(event) => setCollectionVerification({ ...collectionVerification, code: event.target.value.replace(/[^\d]/g, "").slice(0, 4) })} inputMode="numeric" autoComplete="one-time-code" maxLength={4} dir="ltr" autoFocus /><p className="employee-verification-form__note"><Icon name="shield" size={16} />لن تتغير الحالة إذا كان الكود غير صحيح.</p><Button type="submit" icon="check" full loading={verifyingCollection} disabled={collectionVerification.code.length !== 4}>تحقق وتسليم التحصيل</Button></form></Modal>}

  {editingAccount && <Modal title={editingAccount.role === "courier" ? "تعديل بيانات المندوب" : "تعديل بيانات المستخدم"} onClose={() => setEditingAccount(null)} className="admin-account-edit-modal" sheet><form className="modal-form" onSubmit={saveAccount}><p className="modal-description"><Icon name="shield" size={16} />المسؤول فقط يستطيع حفظ التغييرات على بيانات هذا الحساب.</p><Field icon="user" label="الاسم الكامل" value={editingAccount.name} onChange={(event) => setEditingAccount({ ...editingAccount, name: event.target.value })} autoFocus /><Field icon="phone" label="رقم الجوال" value={editingAccount.phone} onChange={(event) => setEditingAccount({ ...editingAccount, phone: event.target.value.replace(/[^\d]/g, "").slice(0, 10) })} inputMode="numeric" dir="ltr" /><Field icon={editingAccount.role === "courier" ? "user" : "store"} label={editingAccount.role === "courier" ? "الاسم" : "اسم المتجر"} value={editingAccount.store} onChange={(event) => setEditingAccount({ ...editingAccount, store: event.target.value })} /><Field icon="mail" label="البريد الإلكتروني" type="email" value={editingAccount.email} onChange={(event) => setEditingAccount({ ...editingAccount, email: event.target.value })} dir="ltr" /><Button type="submit" icon="check" full>حفظ التغييرات</Button></form></Modal>}

  {addUserOpen && <Modal title={form.role === "courier" ? "إضافة مندوب جديد" : "إضافة مستخدم جديد"} onClose={() => setAddUserOpen(false)} sheet><form className="modal-form" onSubmit={createUser}><SelectField label="نوع الحساب" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as "merchant" | "courier" })}><option value="merchant">تاجر</option><option value="courier">مندوب توصيل</option></SelectField>{form.role === "merchant" && <SelectField label="نوع الاشتراك" value={form.membership} onChange={(event) => setForm({ ...form, membership: event.target.value as Membership })}><option value="standard">عادي</option><option value="premium">بريميوم</option><option value="diamond">ماسي</option></SelectField>}<Field icon="user" label="الاسم الكامل" placeholder="اسم المستخدم" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><Field icon="phone" label="رقم الجوال" placeholder="05xxxxxxxx" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value.replace(/[^\d]/g, "").slice(0, 10) })} dir="ltr" /><Field icon={form.role === "courier" ? "user" : "store"} label={form.role === "courier" ? "الاسم" : "اسم المتجر"} placeholder={form.role === "courier" ? "الاسم" : "اسم المتجر"} value={form.store} onChange={(event) => setForm({ ...form, store: event.target.value })} /><Field icon="mail" label="البريد الإلكتروني" type="email" placeholder="name@example.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} dir="ltr" /><Field icon="lock" label="كلمة المرور" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /><Button type="submit" icon="plus" full>إضافة الحساب</Button></form></Modal>}</div>;
}
