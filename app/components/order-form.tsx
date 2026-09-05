"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "../lib/app-context";
import { createTrackingEvent, deliveryLocalities, getDeliveryFee, getMembershipPrices, getOversizeFee, getWeightFee, governorates, MAX_OVERSIZE_FEE, money, normalizeMembership, OVERSIZE_DIMENSION_LIMIT_CM, OVERSIZE_DIMENSION_STEP_CM, OVERSIZE_FEE, resolveDeliveryRegion, uid, WEIGHT_OPTIONS, type Order } from "../lib/data";
import { Icon } from "./icon";
import { Button, Field, PageHeader, SectionCard, SelectField } from "./ui";

const orderTypes = [
  { id: "standard", title: "طرد عادي", description: "توصيل منتج إلى المستلم وتحصيل المبلغ" },
  { id: "exchange", title: "طرد تبديل", description: "استلام القديم من المستلم وتسليمه البديل" },
  { id: "partial", title: "تجربة أو شراء", description: "معاينة المنتج والدفع عند الاستلام" },
  { id: "return", title: "رجوع", description: "استلام بضاعة من العميل وإعادتها إليك" },
];

const blankForm = {
  type: "standard",
  phone: "",
  name: "",
  governorate: "",
  city: "",
  address: "",
  deliveryDate: "",
  pickup: "",
  amount: "",
  content: "",
  weight: "0 - 5 كغم",
  length: "",
  width: "",
  height: "",
  reference: "",
  notes: "",
  privateNotes: "",
  paymentBy: "recipient",
  favorite: false,
};

function dimensionInput(value: string): string {
  const normalized = value.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".").replace(/[^\d.]/g, "");
  const separator = normalized.indexOf(".");
  const whole = (separator === -1 ? normalized : normalized.slice(0, separator)).slice(0, 3);
  return separator === -1 ? whole : `${whole}.${normalized.slice(separator + 1).replace(/\./g, "").slice(0, 2)}`;
}

export function NewOrder() {
  const { database, user, createParcels, setView, setSelectedOrderId, showToast, confirm } = useApp();
  const [orderId, setOrderId] = useState(() => uid("order"));
  const [form, setForm] = useState(blankForm);
  const [loading, setLoading] = useState(false);
  const [usingSaved, setUsingSaved] = useState(false);
  const region = resolveDeliveryRegion(form.governorate, form.city);
  const membershipPrices = getMembershipPrices(user?.membership);
  const membership = normalizeMembership(user?.membership);
  const baseDeliveryFee = getDeliveryFee(region, user?.membership);
  const selectedWeightFee = getWeightFee(form.weight);
  const dimensionOversizeFee = getOversizeFee(form.length, form.width, form.height);
  const weightFee = region ? selectedWeightFee : 0;
  const oversizeFee = region ? dimensionOversizeFee : 0;
  const deliveryFee = region ? baseDeliveryFee + weightFee + oversizeFee : 0;
  const deliveryZone = region?.name === "القدس" ? "jerusalem" : region?.name === "الداخل" ? "interior" : region ? "west-bank" : "";
  const amount = Math.max(0, Number(form.amount) || 0);
  const contentValue = Math.max(amount - deliveryFee, 0);
  const savedRecipients = database.recipients.filter((recipient) => recipient.merchantId === user?.id);
  const selectedGovernorate = resolveDeliveryRegion(form.governorate);
  const localitySuggestions = selectedGovernorate
    ? deliveryLocalities.filter((item) => item.governorate === selectedGovernorate.name)
    : deliveryLocalities;
  const selectedType = orderTypes.find((type) => type.id === form.type) ?? orderTypes[0];
  const totalCollection = amount;
  const additionalFeeDetails = [
    weightFee > 0 ? `${money(weightFee)} ₪ للوزن` : "",
    oversizeFee > 0 ? `${money(oversizeFee)} ₪ للحجم` : "",
  ].filter(Boolean).join(" و");
  const dimensions = [form.length, form.width, form.height].some(Boolean)
    ? [form.length || "0", form.width || "0", form.height || "0"].join(" × ")
    : "";
  const dirty = (Object.keys(blankForm) as Array<keyof typeof blankForm>).some((key) => form[key] !== blankForm[key]);

  function clearAllFields(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setForm(blankForm);
    setOrderId(uid("order"));
    setUsingSaved(false);
    showToast("تم مسح جميع الحقول.");
  }

  function leaveForm() {
    if (!dirty) return setView("home");
    confirm({ title: "الخروج من إنشاء الطرد؟", message: "سيتم تجاهل البيانات المدخلة في نموذج إنشاء الطرد.", confirmLabel: "الخروج", onConfirm: () => setView("home") });
  }

  function chooseSaved(id: string) {
    const recipient = savedRecipients.find((item) => item.id === id);
    if (!recipient) return;
    const savedGovernorate = recipient.governorate?.trim() ?? "";
    const match = savedGovernorate
      ? resolveDeliveryRegion(savedGovernorate, recipient.city)
      : resolveDeliveryRegion("", recipient.city);
    setForm({ ...form, name: recipient.name, phone: recipient.phone, governorate: savedGovernorate || match?.name || "", city: recipient.city, address: recipient.address, favorite: recipient.favorite });
    showToast("تم تعبئة بيانات المستلم المحفوظ.");
  }

  async function createOrder(event: FormEvent) {
    event.preventDefault();
    if (!user || loading) return;
    if (!/^05\d{8}$/.test(form.phone)) return showToast("أدخل رقم جوال صحيح مكوّن من 10 أرقام.", "error");
    if (!form.name.trim()) return showToast("أدخل اسم المستلم.", "error");
    if (!form.governorate.trim() || !form.city.trim()) return showToast("أدخل المحافظة والمدينة أو المنطقة للتوصيل.", "error");
    if (!region) return showToast("اختر محافظة ومدينة متطابقتين من الاقتراحات، واكتب الحي والشارع في وصف العنوان.", "error");
    if (!form.address.trim()) return showToast("أدخل عنوان التوصيل بالتفصيل.", "error");
    if (!form.amount || Number(form.amount) < 0) return showToast("أدخل قيمة محتويات الطرد.", "error");

    setLoading(true);
    try {
      const now = new Date().toISOString();
      const order: Order = {
        id: orderId, trackingNumber: "", merchantId: user.id, merchantName: user.name, merchantStore: user.store,
        recipientName: form.name.trim(), recipientPhone: form.phone, governorate: form.governorate.trim(), city: form.city.trim(), address: form.address.trim(),
        pickupAddress: form.pickup.trim() || `${user.store} - ${form.governorate.trim()}`, amount, deliveryFee,
        preferredDeliveryDate: form.deliveryDate || undefined,
        content: form.content.trim(), weight: form.weight, dimensions: dimensions ? `${dimensions} سم` : "غير محددة",
        lengthCm: Number(form.length) || undefined, widthCm: Number(form.width) || undefined, heightCm: Number(form.height) || undefined, weightFee, oversizeFee,
        notes: form.notes.trim(), privateNotes: form.privateNotes.trim(), reference: form.reference.trim(),
        type: selectedType.title, status: "draft", courierName: "بانتظار تعيين المندوب",
        trackingEvents: [createTrackingEvent("draft", user.name, { location: "مع المرسل", note: "تم إنشاء الطرد وهو قيد الإنشاء.", createdAt: now })],
        createdAt: now, updatedAt: now, deleted: false,
      };
      const alreadySaved = database.recipients.some((recipient) => recipient.merchantId === user.id && recipient.phone === form.phone);
      const recipients = form.favorite && !alreadySaved ? [{ id: `recipient-${orderId}`, merchantId: user.id, name: form.name.trim(), phone: form.phone, governorate: form.governorate.trim(), city: form.city.trim(), address: form.address.trim(), favorite: true }] : [];
      if (!await createParcels([order], recipients)) return;
      setSelectedOrderId(order.id);
      setView("order-detail");
      showToast("تم إنشاء الطرد وحالته قيد الإنشاء. أدخل كود الملصق من تفاصيل الطرد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form id="new-order-form" className="page-content order-form-page animate-page" onSubmit={createOrder} onReset={clearAllFields} noValidate>
      <PageHeader title="إنشاء طرد جديد" subtitle="أدخل بيانات المستلم والطرد" onBack={leaveForm} />


      <SectionCard title="نوع الطرد" icon="package"><div className="order-type-grid">{orderTypes.map((type) => <button type="button" key={type.id} className={`order-type ${form.type === type.id ? "is-selected" : ""}`} onClick={() => setForm({ ...form, type: type.id })}><span className="radio-indicator" /><div><strong>{type.title}</strong><small>{type.description}</small></div></button>)}</div></SectionCard>

      <SectionCard title="بيانات المستلم" icon="user" action={<button type="button" className={`text-action ${usingSaved ? "is-active" : ""}`} onClick={() => setUsingSaved(!usingSaved)}><Icon name="users" size={16} />{usingSaved ? "إدخال يدوي" : "نسخ سابق"}</button>}>
        {usingSaved && <SelectField label="اختر من المستلمين المحفوظين" defaultValue="" onChange={(event) => chooseSaved(event.target.value)}><option value="">اختر المستلم</option>{savedRecipients.map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.name} — {recipient.phone}</option>)}</SelectField>}
        <div className="form-grid"><Field label="رقم المستلم (الجوال)" placeholder="05xxxxxxxx" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value.replace(/[^\d]/g, "").slice(0, 10) })} inputMode="numeric" dir="ltr" /><Field label="اسم المستلم" placeholder="مثلًا: محمد أحمد" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
        <button type="button" className={`favorite-recipient ${form.favorite ? "is-selected" : ""}`} onClick={() => setForm({ ...form, favorite: !form.favorite })}><Icon name="star" size={18} />إضافة كمستلم مفضل لدي<span className="radio-indicator" /></button>
      </SectionCard>

      <SectionCard title="عنوان التوصيل" icon="mapPin" action={membership === "diamond" ? <span className="membership-badge membership-badge--diamond"><Icon name="sparkles" size={13} />أسعار ماسية</span> : membership === "premium" ? <span className="membership-badge membership-badge--premium"><Icon name="star" size={13} />أسعار بريميوم</span> : undefined}>
        <div className="delivery-rates" aria-label="أسعار التوصيل حسب المنطقة">
          <span className={deliveryZone === "west-bank" ? "delivery-rate is-active" : "delivery-rate"}>الضفة <strong>{membershipPrices.westBank} ₪</strong></span>
          <span className={deliveryZone === "jerusalem" ? "delivery-rate is-active" : "delivery-rate"}>القدس <strong>{membershipPrices.jerusalem} ₪</strong></span>
          <span className={deliveryZone === "interior" ? "delivery-rate is-active" : "delivery-rate"}>الداخل <strong>{membershipPrices.interior} ₪</strong></span>
        </div>
        <div className="form-grid">
          <Field label="المحافظة" placeholder="اكتب أو اختر المحافظة" list="almadina-governorates" value={form.governorate} onChange={(event) => setForm({ ...form, governorate: event.target.value })} autoComplete="address-level1" />
          <Field label="المدينة أو المنطقة" placeholder="ابحث أو اكتب المدينة أو المنطقة" list="almadina-localities" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} autoComplete="address-level2" />
        </div>
        <datalist id="almadina-governorates">{governorates.map((item) => <option key={item.name} value={item.name} />)}</datalist>
        <datalist id="almadina-localities">{localitySuggestions.map((item) => <option key={`${item.governorate}-${item.name}`} value={item.name} label={item.governorate} />)}</datalist>
        <Field label="الشارع / وصف العنوان" placeholder="مثلًا: شارع نابلس، بالقرب من دوار الساعة" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
        <Field
          label="تاريخ التوصيل المفضل (اختياري)"
          type="date"
          min={new Date().toISOString().slice(0, 10)}
          value={form.deliveryDate}
          onChange={(event) => setForm({ ...form, deliveryDate: event.target.value })}
          wrapperClassName={`preferred-date-field ${form.deliveryDate ? "has-value" : ""}`}
          className="preferred-date-control"
          dir="ltr"
          lang="ar"
          aria-label="تاريخ التوصيل المفضل بصيغة يوم شهر سنة"
          suffix={!form.deliveryDate ? <span className="preferred-date-placeholder" aria-hidden="true">يوم / شهر / سنة</span> : undefined}
          hint="اختر التاريخ من التقويم أو اكتبه بصيغة يوم / شهر / سنة."
        />
      </SectionCard>

      <SectionCard title="تفاصيل الطرد" icon="receipt">
        <div className="form-grid"><Field label="سعر الطرد (التحصيل)" placeholder="0" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" suffix={<span className="field__unit">₪</span>} /><Field label="قيمة المحتويات بعد خصم التوصيل" placeholder="تُحسب تلقائيًا" value={form.amount ? money(contentValue) : ""} readOnly aria-live="polite" suffix={<span className="field__unit">₪</span>} /></div>
        <p className={`form-note content-value-note ${amount > 0 && amount < deliveryFee ? "is-warning" : ""}`} aria-live="polite">{region ? form.amount ? `تم خصم ${money(deliveryFee)} ₪ للتوصيل${additionalFeeDetails ? `، منها ${additionalFeeDetails}` : ""}: ${money(amount)} − ${money(deliveryFee)} = ${money(contentValue)} ₪.` : `أدخل سعر الطرد، وسيُخصم منه إجمالي توصيل ${region.name} البالغ ${money(deliveryFee)} ₪ تلقائيًا.` : "أدخل المحافظة أو المدينة أولًا لتحديد رسوم التوصيل وحساب قيمة المحتويات."}</p>
        <Field label="وصف المحتوى" placeholder="مثلًا: ساعة، ملابس، إكسسوارات..." value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} />
        <div className="field"><span className="field__label">الوزن التقديري</span><div className="weight-options">{WEIGHT_OPTIONS.map((option) => <button type="button" key={option.label} className={form.weight === option.label ? "filter-chip is-active" : "filter-chip"} onClick={() => setForm({ ...form, weight: option.label })}><span>{option.label}</span><small>{option.fee ? `+ ${option.fee} ₪` : "بدون إضافة"}</small></button>)}</div></div>
        <div className="dimensions-grid"><Field label="الطول (سم)" placeholder="20" value={form.length} onChange={(event) => setForm({ ...form, length: dimensionInput(event.target.value) })} inputMode="decimal" /><Field label="العرض (سم)" placeholder="15" value={form.width} onChange={(event) => setForm({ ...form, width: dimensionInput(event.target.value) })} inputMode="decimal" /><Field label="الارتفاع (سم)" placeholder="10" value={form.height} onChange={(event) => setForm({ ...form, height: dimensionInput(event.target.value) })} inputMode="decimal" /></div>
        <div className={`oversize-fee-notice ${dimensionOversizeFee ? "is-active" : ""}`} aria-live="polite">
          <span><Icon name="info" size={18} /></span>
          <div><strong>{dimensionOversizeFee ? "حجم الطرد مقبول مع رسوم إضافية" : `الحد القياسي لكل بُعد هو ${OVERSIZE_DIMENSION_LIMIT_CM} سم`}</strong><small>{dimensionOversizeFee ? region ? `الأبعاد المدخلة تضيف الآن ${dimensionOversizeFee} ₪؛ وتزيد رسوم كل بُعد ${OVERSIZE_FEE} ₪ لكل ${OVERSIZE_DIMENSION_STEP_CM} سم إضافية حتى ${MAX_OVERSIZE_FEE} ₪ للبُعد الواحد.` : `الأبعاد المدخلة تضيف ${dimensionOversizeFee} ₪ بعد تحديد منطقة التوصيل.` : `بعد ${OVERSIZE_DIMENSION_LIMIT_CM} سم تزيد رسوم كل بُعد تدريجيًا ${OVERSIZE_FEE} ₪ لكل ${OVERSIZE_DIMENSION_STEP_CM} سم إضافية.`}</small></div>
        </div>
      </SectionCard>

      <SectionCard title="تعليمات إضافية" icon="file"><Field label="رقم المرجع (اختياري)" placeholder="ORD-00000" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} hint="رقم الطلب في متجرك ليسهل عليك ربط التقارير." /><Field label="التعليمات (تظهر للمندوب فقط)" placeholder="مثلًا: الاتصال قبل الوصول بساعة" value={form.notes} maxLength={500} onChange={(event) => setForm({ ...form, notes: event.target.value })} hint="سيصل بها إشعار إلى المندوب الموظف الذي يستلم الطرد بعد مسح الكود." /><Field label="الملاحظة الخاصة (تظهر للمسؤول فقط)" placeholder="ملاحظة داخلية للإدارة..." value={form.privateNotes} maxLength={1000} onChange={(event) => setForm({ ...form, privateNotes: event.target.value })} hint="سيصل بها إشعار للمسؤولين فقط، ولن تظهر للمندوب أو في التتبع العام." /></SectionCard>

      <div className="order-summary"><div><span>سعر الطرد (التحصيل)</span><strong>{money(totalCollection)} ₪</strong></div><div><span>رسوم التوصيل الأساسية المخصومة</span><strong>- {money(baseDeliveryFee)} ₪</strong></div>{weightFee > 0 && <div className="order-summary__weight"><span>رسوم الوزن الإضافية</span><strong>- {money(weightFee)} ₪</strong></div>}{oversizeFee > 0 && <div className="order-summary__oversize"><span>رسوم الحجم الإضافية</span><strong>- {money(oversizeFee)} ₪</strong></div>}<div className="order-summary__total"><span>قيمة المحتويات بعد الخصم</span><strong>{money(contentValue)} ₪</strong></div></div><Button type="submit" icon="package" full loading={loading} className="create-order-button">إنشاء الطرد</Button>
    </form>
  );
}
