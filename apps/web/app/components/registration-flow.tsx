"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import type { RegistrationChallenge, RegistrationFormValues } from "../lib/app-context";
import { governorates, normalizeLocation } from "../lib/data";
import { applicationPermissionDisclosures, LEGAL_DOCUMENT_VERSION, LEGAL_FINAL_NOTICE, privacyPolicySections, termsOfUseSections } from "../lib/legal";
import { matchRegistrationMapAddress } from "../lib/registration-map-address";
import type { ReverseGeocodedAddress } from "../lib/reverse-geocoding";
import { Icon } from "./icon";
import { DEFAULT_REGISTRATION_MAP_POINT, REGISTRATION_REGION_CENTERS, RegistrationLocationMap } from "./registration-location-map";
import { Button, Field, Modal } from "./ui";

type RegistrationStep = "identity" | "business" | "location" | "security" | "review" | "verify";
type PendingOperation = "request" | "verify" | "resend" | null;
type LocationPicker = "governorate" | "city" | null;
type RegistrationFormState = Omit<RegistrationFormValues, "acceptedTerms"> & { confirm: string };

type RegistrationFlowProps = {
  onCancel: () => void;
  onRequest: (values: RegistrationFormValues) => Promise<RegistrationChallenge>;
  onVerify: (code: string) => Promise<boolean>;
};

const FORM_STEPS: RegistrationStep[] = ["identity", "business", "location", "security", "review"];
const EMPTY_FORM: RegistrationFormState = {
  name: "",
  phone: "",
  store: "",
  email: "",
  governorate: "",
  city: "",
  address: "",
  latitude: DEFAULT_REGISTRATION_MAP_POINT.latitude,
  longitude: DEFAULT_REGISTRATION_MAP_POINT.longitude,
  locationMethod: "manual",
  password: "",
  confirm: "",
};

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function strongPassword(value: string): boolean {
  return value.length >= 8 && value.length <= 128
    && /\p{L}/u.test(value)
    && /[0-9٠-٩]/.test(value)
    && /[^\p{L}\p{N}\s]/u.test(value);
}

function maskedEmail(value: string): string {
  const [local = "", domain = ""] = value.split("@");
  if (!local || !domain) return value;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, Math.min(7, local.length - visible.length)))}@${domain}`;
}

function RegistrationError({ message }: { message: string }) {
  if (!message) return null;
  return <p className="form-error" id="registration-error" role="alert"><Icon name="alert" size={15} />{message}</p>;
}

function LocationPickerButton({ label, value, placeholder, disabled, onClick }: { label: string; value: string; placeholder: string; disabled?: boolean; onClick: () => void }) {
  return <div className="field registration-location-field"><span className="field__label">{label}</span><button type="button" className="field__control registration-location-field__button" disabled={disabled} onClick={onClick}><Icon name="mapPin" size={19} className="field__icon" /><span className={value ? "" : "is-placeholder"}>{value || placeholder}</span><Icon name="chevronDown" size={18} /></button></div>;
}

export function RegistrationFlow({ onCancel, onRequest, onVerify }: RegistrationFlowProps) {
  const [step, setStep] = useState<RegistrationStep>("identity");
  const [form, setForm] = useState(EMPTY_FORM);
  const [accepted, setAccepted] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  const [legalReviewed, setLegalReviewed] = useState(false);
  const [legalScrollProgress, setLegalScrollProgress] = useState(0);
  const [mapConfirmed, setMapConfirmed] = useState(false);
  const [locationPicker, setLocationPicker] = useState<LocationPicker>(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [visiblePassword, setVisiblePassword] = useState(false);
  const [code, setCode] = useState<string[]>(Array(6).fill(""));
  const [pending, setPending] = useState<PendingOperation>(null);
  const [cooldown, setCooldown] = useState(0);
  const [expiresIn, setExpiresIn] = useState(10 * 60);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const codeInputs = useRef<Array<HTMLInputElement | null>>([]);
  const legalBody = useRef<HTMLDivElement | null>(null);

  const busy = pending !== null;
  const currentFormStep = step === "verify" ? FORM_STEPS.length - 1 : FORM_STEPS.indexOf(step);
  const normalizedEmail = form.email.trim().toLowerCase();
  const codeValue = code.join("");
  const selectedGovernorate = governorates.find((entry) => entry.name === form.governorate);
  const pickerOptions = locationPicker === "governorate"
    ? governorates.map((entry) => entry.name)
    : locationPicker === "city"
      ? selectedGovernorate?.cities ?? []
      : [];
  const normalizedLocationQuery = normalizeLocation(locationQuery);
  const filteredPickerOptions = normalizedLocationQuery
    ? pickerOptions.filter((entry) => normalizeLocation(entry).includes(normalizedLocationQuery))
    : pickerOptions;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((current) => Math.max(0, current - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!legalOpen || legalReviewed) return;
    const frame = window.requestAnimationFrame(() => {
      if (legalBody.current) updateLegalReadProgress(legalBody.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [legalOpen, legalReviewed]);

  function openLegalDetails() {
    setLegalScrollProgress(legalReviewed ? 100 : 0);
    setLegalOpen(true);
  }

  function updateLegalReadProgress(element: HTMLDivElement) {
    const scrollDistance = Math.max(0, element.scrollHeight - element.clientHeight);
    const reachedEnd = scrollDistance <= 1 || element.scrollTop >= scrollDistance - 12;
    const progress = reachedEnd
      ? 100
      : Math.min(99, Math.max(0, Math.round((element.scrollTop / Math.max(1, scrollDistance)) * 100)));
    setLegalScrollProgress(progress);
    if (reachedEnd) {
      setLegalReviewed(true);
      setError("");
    }
  }

  function updateField<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
    setStatus("");
  }

  function validateStep(target: RegistrationStep): string | null {
    if (target === "identity") {
      if (form.name.trim().length < 2) return "أدخل اسمك الكامل بصورة صحيحة.";
      if (!/^05\d{8}$/.test(form.phone)) return "أدخل رقم جوال مكوّنًا من 10 أرقام ويبدأ بـ 05.";
    }
    if (target === "business") {
      if (!form.store.trim()) return "أدخل اسم المتجر.";
      if (!validEmail(normalizedEmail)) return "أدخل بريدًا إلكترونيًا صحيحًا؛ سيصل إليه رمز التحقق.";
    }
    if (target === "location") {
      if (!form.governorate) return "اختر المدينة أو المحافظة.";
      if (!form.city) return "اختر المنطقة التابعة للمدينة.";
      if (form.address.trim().length < 2 || form.address.trim().length > 180) return "أدخل اسم الشارع أو وصف العنوان بصورة صحيحة.";
      if (form.locationMethod === "map" && !mapConfirmed) return "حرّك الخريطة إلى عنوانك ثم اضغط «تثبيت وقراءة العنوان»، أو اختر الإدخال اليدوي.";
      if (form.locationMethod === "map" && (form.latitude < 29.35 || form.latitude > 33.55 || form.longitude < 34.1 || form.longitude > 35.95)) return "اختر نقطة داخل نطاق التوصيل على الخريطة.";
    }
    if (target === "security") {
      if (!strongPassword(form.password)) return "يجب أن تحتوي كلمة المرور على 8 أحرف على الأقل وحرف ورقم ورمز.";
      if (form.password !== form.confirm) return "كلمتا المرور غير متطابقتين.";
    }
    if (target === "review" && !legalReviewed) return "افتح شروط الاستخدام وسياسة الخصوصية والأذونات واقرأها أولًا.";
    if (target === "review" && !accepted) return "فعّل الموافقة على الشروط وسياسة الخصوصية للمتابعة.";
    return null;
  }

  function goNext() {
    if (busy || step === "review" || step === "verify") return;
    const validationError = validateStep(step);
    if (validationError) return setError(validationError);
    setError("");
    const index = FORM_STEPS.indexOf(step);
    setStep(FORM_STEPS[index + 1]);
  }

  function goBack() {
    if (busy) return;
    setError("");
    setStatus("");
    if (step === "identity") return onCancel();
    if (step === "verify") return onCancel();
    const index = FORM_STEPS.indexOf(step);
    setStep(FORM_STEPS[index - 1]);
  }

  function applyChallenge(challenge: RegistrationChallenge) {
    setCooldown(Number.isFinite(challenge.resendAfter) ? Math.max(1, Math.min(300, Math.round(challenge.resendAfter))) : 60);
    setExpiresIn(Number.isFinite(challenge.expiresIn) ? Math.max(60, Math.round(challenge.expiresIn)) : 10 * 60);
    setCode(Array(6).fill(""));
  }

  async function requestCode(operation: "request" | "resend") {
    if (busy || (operation === "resend" && cooldown > 0)) return;
    const validationError = FORM_STEPS.map(validateStep).find(Boolean);
    if (validationError) return setError(validationError);
    setPending(operation);
    setError("");
    setStatus("");
    try {
      const challenge = await onRequest({
        name: form.name.trim(),
        phone: form.phone,
        store: form.store.trim(),
        email: normalizedEmail,
        governorate: form.governorate,
        city: form.city,
        address: form.address.trim(),
        latitude: form.latitude,
        longitude: form.longitude,
        locationMethod: form.locationMethod,
        password: form.password,
        acceptedTerms: accepted,
      });
      setForm((current) => ({ ...current, email: challenge.email }));
      applyChallenge(challenge);
      setStep("verify");
      if (operation === "resend") setStatus("أرسلنا رمزًا جديدًا إلى بريدك الإلكتروني.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "تعذّر إرسال رمز التحقق. حاول مجددًا.");
    } finally {
      setPending(null);
    }
  }

  async function verifyCode() {
    if (busy) return;
    if (!/^\d{6}$/.test(codeValue)) return setError("أدخل رمز التحقق المكوّن من 6 أرقام.");
    setPending("verify");
    setError("");
    setStatus("");
    try {
      await onVerify(codeValue);
    } catch (verificationError) {
      setError(verificationError instanceof Error ? verificationError.message : "رمز التحقق غير صحيح أو انتهت صلاحيته.");
    } finally {
      setPending(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (step === "review") void requestCode("request");
    else if (step === "verify") void verifyCode();
    else goNext();
  }

  function fillCode(value: string) {
    const digits = normalizeDigits(value).replace(/\D/g, "").slice(0, 6).split("");
    setCode(Array.from({ length: 6 }, (_, index) => digits[index] ?? ""));
    setError("");
    setStatus("");
    codeInputs.current[Math.min(digits.length, 5)]?.focus();
  }

  function updateCode(index: number, value: string) {
    const digits = normalizeDigits(value).replace(/\D/g, "");
    if (digits.length > 1) return fillCode(digits);
    setCode((current) => current.map((entry, entryIndex) => entryIndex === index ? digits.slice(-1) : entry));
    setError("");
    setStatus("");
    if (digits && index < 5) codeInputs.current[index + 1]?.focus();
  }

  function handleCodeKey(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !code[index] && index > 0) codeInputs.current[index - 1]?.focus();
    if (event.key === "ArrowLeft" && index > 0) codeInputs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < 5) codeInputs.current[index + 1]?.focus();
  }

  function pasteCode(event: ClipboardEvent<HTMLDivElement>) {
    const digits = normalizeDigits(event.clipboardData.getData("text")).replace(/\D/g, "").slice(0, 6);
    if (!digits) return;
    event.preventDefault();
    fillCode(digits);
  }

  function passwordToggle() {
    return <button type="button" className="field__action" disabled={busy} aria-label={visiblePassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} aria-pressed={visiblePassword} onClick={() => setVisiblePassword((current) => !current)}><Icon name={visiblePassword ? "eyeOff" : "eye"} size={20} /></button>;
  }

  function openLocationPicker(picker: Exclude<LocationPicker, null>) {
    if (busy || (picker === "city" && !selectedGovernorate)) return;
    setLocationQuery("");
    setLocationPicker(picker);
  }

  function chooseLocation(value: string) {
    if (locationPicker === "governorate") {
      const point = REGISTRATION_REGION_CENTERS[value] ?? DEFAULT_REGISTRATION_MAP_POINT;
      setForm((current) => ({
        ...current,
        governorate: value,
        city: "",
        ...(current.locationMethod === "manual" ? { latitude: point.latitude, longitude: point.longitude } : {}),
      }));
    } else if (locationPicker === "city") {
      setForm((current) => ({ ...current, city: value }));
    }
    setError("");
    setStatus("");
    setLocationPicker(null);
    setLocationQuery("");
  }

  function chooseLocationMethod(method: "manual" | "map") {
    setForm((current) => ({ ...current, locationMethod: method }));
    if (method === "manual") setMapConfirmed(false);
    setError("");
    setStatus(method === "manual"
      ? "أدخل العنوان يدويًا؛ لن يُطلب منك تثبيت دبوس على الخريطة."
      : "حرّك الدبوس أو استخدم موقع الجهاز، ثم ثبّت الموقع لقراءة العنوان تلقائيًا.");
  }

  async function confirmMapLocation(point: { latitude: number; longitude: number }) {
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/almadina/geocode/reverse", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(point),
      });
      const payload = await response.json().catch(() => ({})) as { success?: boolean; address?: ReverseGeocodedAddress; error?: string };
      if (!response.ok || !payload.success || !payload.address) {
        throw new Error(payload.error ?? "تعذّرت قراءة العنوان من الخريطة. يمكنك إكماله يدويًا.");
      }

      const matched = matchRegistrationMapAddress(payload.address);
      setForm((current) => {
        const governorate = matched.governorate ?? current.governorate;
        const city = matched.city ?? (governorate === current.governorate ? current.city : "");
        return {
          ...current,
          ...point,
          locationMethod: "map",
          governorate,
          city,
          address: matched.address ?? current.address,
        };
      });
      setMapConfirmed(true);

      const matchedFields = [matched.governorate, matched.city, matched.address].filter(Boolean).length;
      if (matchedFields === 3) setStatus("تم اختيار المدينة والمنطقة والشارع من الخريطة. يمكنك تعديلها يدويًا.");
      else if (matchedFields > 0) setStatus("تمت تعبئة بيانات العنوان المتاحة من الخريطة. أكمل أي حقل ناقص أو عدّله يدويًا.");
      else setError("تم تثبيت النقطة، لكن لم نجد تفاصيل عنوان مطابقة. اختر المدينة والمنطقة والشارع يدويًا.");
    } catch (lookupError) {
      setMapConfirmed(true);
      setError(lookupError instanceof Error ? lookupError.message : "تم تثبيت النقطة، لكن تعذّرت قراءة العنوان. أكمله يدويًا.");
    }
  }

  const header = step === "identity"
    ? { title: "لنبدأ بمعلوماتك", subtitle: "أدخل بياناتك الأساسية للانتقال إلى الخطوة التالية" }
    : step === "business"
      ? { title: "بيانات متجرك", subtitle: "سيُستخدم بريدك لتسجيل الدخول وتأكيد الحساب" }
      : step === "location"
        ? { title: "العنوان الخاص بك", subtitle: "اختر الإدخال اليدوي أو دع الخريطة تقرأ تفاصيل العنوان" }
        : step === "security"
          ? { title: "حماية حسابك", subtitle: "اختر كلمة مرور قوية لا تستخدمها في موقع آخر" }
          : step === "review"
            ? { title: "لم يتبقَّ الكثير", subtitle: "راجع بياناتك ووافق على الشروط قبل إرسال الرمز" }
            : { title: "تأكيد بريدك الإلكتروني", subtitle: `أدخل الرمز المرسل إلى ${maskedEmail(normalizedEmail)}` };

  return (
    <div className="registration-flow">
      <header className="auth-card__header registration-flow__header"><h1>{header.title}</h1><p>{header.subtitle}</p></header>
      <div className="registration-flow__progress" aria-label={step === "verify" ? "اكتملت خطوات البيانات؛ تأكيد البريد الإلكتروني" : `الخطوة ${(currentFormStep + 1).toLocaleString("ar-EG")} من ${FORM_STEPS.length.toLocaleString("ar-EG")}`}>
        <div className="registration-flow__dots" aria-hidden="true">
          {FORM_STEPS.map((entry, index) => <span key={entry} className={index <= currentFormStep ? "is-active" : ""} />)}
        </div>
        <strong>{step === "verify" ? "التحقق النهائي" : `الخطوة ${(currentFormStep + 1).toLocaleString("ar-EG")} من ${FORM_STEPS.length.toLocaleString("ar-EG")}`}</strong>
      </div>

      <form className="auth-form registration-flow__form" onSubmit={submit} noValidate aria-busy={busy}>
        {step === "identity" && <div className="registration-flow__stage">
          <Field icon="user" label="الاسم الكامل" placeholder="الاسم كما تريد ظهوره في الحساب" value={form.name} onChange={(event) => updateField("name", event.target.value)} autoComplete="name" autoFocus disabled={busy} aria-invalid={Boolean(error)} />
          <Field icon="phone" label="رقم الجوال" placeholder="05xxxxxxxx" value={form.phone} onChange={(event) => updateField("phone", normalizeDigits(event.target.value).replace(/\D/g, "").slice(0, 10))} inputMode="numeric" autoComplete="tel" dir="ltr" disabled={busy} hint="10 أرقام ويبدأ بـ 05" />
        </div>}

        {step === "business" && <div className="registration-flow__stage">
          <Field icon="store" label="اسم المتجر" placeholder="الاسم التجاري لمتجرك" value={form.store} onChange={(event) => updateField("store", event.target.value)} autoComplete="organization" autoFocus disabled={busy} />
          <Field icon="mail" label="البريد الإلكتروني" placeholder="name@example.com" type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} dir="ltr" disabled={busy} hint="سنرسل رمز تأكيد إلى هذا البريد" />
        </div>}

        {step === "location" && <div className="registration-flow__stage registration-flow__location">
          <div className="registration-flow__location-method" role="group" aria-label="طريقة إدخال العنوان">
            <button type="button" className={form.locationMethod === "manual" ? "is-active" : ""} aria-pressed={form.locationMethod === "manual"} disabled={busy} onClick={() => chooseLocationMethod("manual")}><Icon name="edit" size={17} />إدخال يدوي</button>
            <button type="button" className={form.locationMethod === "map" ? "is-active" : ""} aria-pressed={form.locationMethod === "map"} disabled={busy} onClick={() => chooseLocationMethod("map")}><Icon name="mapPin" size={17} />تحديد بالخريطة</button>
          </div>
          <div className="registration-flow__location-fields">
            <LocationPickerButton label="المدينة" value={form.governorate} placeholder="اختر المدينة أو المحافظة" disabled={busy} onClick={() => openLocationPicker("governorate")} />
            <LocationPickerButton label="المنطقة" value={form.city} placeholder={form.governorate ? "اختر المنطقة" : "اختر المدينة أولًا"} disabled={busy || !form.governorate} onClick={() => openLocationPicker("city")} />
          </div>
          <Field icon="mapPin" label="الشارع / وصف العنوان" placeholder="مثلًا: شارع فيصل، قرب الدوار" value={form.address} onChange={(event) => updateField("address", event.target.value.slice(0, 180))} autoComplete="street-address" disabled={busy} hint={form.locationMethod === "manual" ? "يكفي إكمال الحقول الثلاثة؛ الخريطة غير مطلوبة." : "يمكنك تصحيح النص بعد تعبئته من الخريطة."} />
          {form.locationMethod === "map" && <RegistrationLocationMap
            latitude={form.latitude}
            longitude={form.longitude}
            confirmed={mapConfirmed}
            confirmDisabled={busy}
            onChange={(point) => {
              setForm((current) => ({ ...current, ...point }));
              setMapConfirmed(false);
              setError("");
              setStatus("");
            }}
            onConfirm={confirmMapLocation}
            onError={setError}
          />}
          {status && <p className="registration-flow__location-status" role="status"><Icon name="check" size={15} />{status}</p>}
        </div>}

        {step === "security" && <div className="registration-flow__stage">
          <Field icon="lock" label="كلمة المرور" placeholder="8 أحرف على الأقل" type={visiblePassword ? "text" : "password"} value={form.password} onChange={(event) => updateField("password", event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} suffix={passwordToggle()} autoFocus disabled={busy} hint={form.password && !strongPassword(form.password) ? "أضف حرفًا ورقمًا ورمزًا." : undefined} />
          <Field icon="shield" label="تأكيد كلمة المرور" placeholder="أعد كتابة كلمة المرور" type={visiblePassword ? "text" : "password"} value={form.confirm} onChange={(event) => updateField("confirm", event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} disabled={busy} hint={form.confirm && form.password !== form.confirm ? "كلمتا المرور غير متطابقتين." : undefined} />
          <p className="registration-flow__secure-note"><Icon name="shield" size={16} />تُشفّر كلمة المرور ولا تُرسل في رسالة البريد.</p>
        </div>}

        {step === "review" && <div className="registration-flow__stage">
          <div className="registration-flow__summary">
            <div><span>صاحب الحساب</span><strong>{form.name.trim()}</strong></div>
            <div><span>المتجر</span><strong>{form.store.trim()}</strong></div>
            <div><span>رقم الجوال</span><strong dir="ltr">{form.phone}</strong></div>
            <div><span>بريد التحقق</span><strong dir="ltr">{normalizedEmail}</strong></div>
            <div className="registration-flow__summary-address"><span>عنوان الحساب · {form.locationMethod === "map" ? "من الخريطة" : "إدخال يدوي"}</span><strong>{form.governorate} · {form.city} · {form.address.trim()}</strong></div>
          </div>
          <button type="button" className={`registration-flow__legal-open ${legalReviewed ? "is-reviewed" : ""}`} disabled={busy} onClick={openLegalDetails}>
            <span className="registration-flow__legal-open-icon"><Icon name={legalReviewed ? "check" : "file"} size={21} /></span>
            <span className="registration-flow__legal-open-copy">
              <strong>الشروط وسياسة الخصوصية والأذونات</strong>
              <small>{legalReviewed ? "اكتملت قراءتها — يمكنك عرضها مرة أخرى" : "مرّر التفاصيل من البداية إلى النهاية لتفعيل الموافقة"}</small>
            </span>
            <Icon name="chevronLeft" size={18} />
          </button>
          <label className="registration-flow__consent">
            <input type="checkbox" checked={accepted} onChange={(event) => { setAccepted(event.target.checked); setError(""); }} disabled={busy || !legalReviewed} />
            <span><b>لقد قرأت وأوافق على شروط الاستخدام وسياسة الخصوصية.</b> الأذونات الاختيارية لا تمنع إنشاء الحساب، ولن يُنشأ الحساب قبل تأكيد البريد الإلكتروني.</span>
          </label>
        </div>}

        {step === "verify" && <div className="registration-flow__stage registration-flow__verification">
          <span className="registration-flow__mail-icon"><Icon name="mail" size={28} /></span>
          <p>أرسلنا رمزًا من 6 أرقام إلى <strong dir="ltr">{normalizedEmail}</strong>. الرمز صالح لمدة {Math.max(1, Math.round(expiresIn / 60)).toLocaleString("ar-EG")} دقائق.</p>
          <div className="registration-flow__code" dir="ltr" onPaste={pasteCode}>
            {code.map((digit, index) => <input
              key={index}
              ref={(element) => { codeInputs.current[index] = element; }}
              aria-label={`الرقم ${(index + 1).toLocaleString("ar-EG")} من رمز التحقق`}
              value={digit}
              onChange={(event) => updateCode(index, event.target.value)}
              onKeyDown={(event) => handleCodeKey(index, event)}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              autoComplete={index === 0 ? "one-time-code" : "off"}
              autoFocus={index === 0}
              disabled={busy}
            />)}
          </div>
          {status && <p className="registration-flow__status" role="status"><Icon name="check" size={15} />{status}</p>}
          <div className="registration-flow__resend">
            {cooldown > 0 ? <span><Icon name="clock" size={14} />إعادة الإرسال خلال <bdi>{cooldown.toLocaleString("ar-EG")}</bdi> ث</span> : <span>لم يصلك الرمز؟</span>}
            <Button type="button" variant="ghost" icon="refresh" loading={pending === "resend"} disabled={cooldown > 0 || busy} onClick={() => { void requestCode("resend"); }}>إعادة إرسال الرمز</Button>
          </div>
        </div>}

        <RegistrationError message={error} />

        {step === "verify" ? (
          <Button type="submit" icon="check" full loading={pending === "verify"} disabled={codeValue.length !== 6 || busy}>تأكيد البريد وإنشاء الحساب</Button>
        ) : step === "review" ? (
          <Button type="submit" icon="send" full loading={pending === "request"} disabled={!legalReviewed || !accepted || busy}>إرسال رمز التحقق</Button>
        ) : (
          <Button type="submit" icon="chevronLeft" full disabled={busy}>التالي</Button>
        )}

        <button type="button" className="registration-flow__back" disabled={busy} onClick={goBack}><Icon name="chevronLeft" size={17} />{step === "identity" || step === "verify" ? "العودة إلى تسجيل الدخول" : "الخطوة السابقة"}</button>
      </form>

      {locationPicker && <Modal title={locationPicker === "governorate" ? "اختر المدينة" : "اختر المنطقة"} onClose={() => setLocationPicker(null)} className="registration-location-modal" sheet>
        <Field icon="search" placeholder={locationPicker === "governorate" ? "ابحث عن المدينة أو المحافظة" : "ابحث عن المنطقة"} value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} autoFocus autoComplete="off" />
        <div className="registration-location-modal__list" role="listbox" aria-label={locationPicker === "governorate" ? "المدن والمحافظات" : "المناطق"}>
          {filteredPickerOptions.map((entry) => <button type="button" role="option" aria-selected={entry === (locationPicker === "governorate" ? form.governorate : form.city)} className={entry === (locationPicker === "governorate" ? form.governorate : form.city) ? "is-selected" : ""} key={entry} onClick={() => chooseLocation(entry)}><Icon name="mapPin" size={17} /><span>{entry}</span>{entry === (locationPicker === "governorate" ? form.governorate : form.city) && <Icon name="check" size={17} />}</button>)}
          {!filteredPickerOptions.length && <p className="registration-location-modal__empty"><Icon name="search" size={24} />لا توجد نتيجة مطابقة.</p>}
        </div>
      </Modal>}

      {legalOpen && <Modal title="الشروط والخصوصية والأذونات" ariaLabel="تفاصيل شروط الاستخدام وسياسة الخصوصية والأذونات المستخدمة" onClose={() => setLegalOpen(false)} className="registration-legal-modal" sheet>
        <p className="registration-legal-modal__intro">مرّر القائمة من أعلاها إلى نهايتها لتفعيل مربع الموافقة. يطلب التطبيق الأذونات الاختيارية فقط عند استخدام الميزة المرتبطة بها.</p>
        <div ref={legalBody} className="registration-legal-modal__body" tabIndex={0} aria-label="محتوى الشروط وسياسة الخصوصية والأذونات" onScroll={(event) => updateLegalReadProgress(event.currentTarget)}>
          <section className="registration-legal-modal__section" aria-labelledby="registration-terms-title">
            <header><span><Icon name="file" size={20} /></span><div><h3 id="registration-terms-title">شروط الاستخدام</h3><p>القواعد الأساسية لاستخدام حساب المدينة إكسبرس.</p></div></header>
            <div className="registration-legal-modal__entries">
              {termsOfUseSections.map((entry, index) => <article key={entry.title}><h4>{(index + 1).toLocaleString("ar-EG")}. {entry.title}</h4><p>{entry.body}</p></article>)}
            </div>
          </section>

          <section className="registration-legal-modal__section" aria-labelledby="registration-privacy-title">
            <header><span><Icon name="shield" size={20} /></span><div><h3 id="registration-privacy-title">سياسة الخصوصية</h3><p>ما نجمعه، ولماذا نستخدمه، وكيف تتحكم في بياناتك.</p></div></header>
            <div className="registration-legal-modal__entries">
              {privacyPolicySections.map((entry, index) => <article key={entry.title}><h4>{(index + 1).toLocaleString("ar-EG")}. {entry.title}</h4><p>{entry.body}</p></article>)}
            </div>
          </section>

          <section className="registration-legal-modal__section" aria-labelledby="registration-permissions-title">
            <header><span><Icon name="sliders" size={20} /></span><div><h3 id="registration-permissions-title">الأذونات وخصائص الجهاز</h3><p>كل إذن اختياري وله بديل يدوي متى كان ذلك ممكنًا.</p></div></header>
            <div className="registration-legal-modal__permissions">
              {applicationPermissionDisclosures.map((permission) => <article key={permission.id}><span><Icon name={permission.icon} size={19} /></span><div><h4>{permission.title}</h4><p>{permission.body}</p></div></article>)}
            </div>
          </section>
          <aside className="legal-final-notice"><Icon name="package" size={21} /><strong>{LEGAL_FINAL_NOTICE}</strong></aside>
        </div>
        <footer className="registration-legal-modal__footer">
          <small>نسخة الوثائق: <bdi dir="ltr">{LEGAL_DOCUMENT_VERSION}</bdi></small>
          <div className={`registration-legal-modal__scroll-status ${legalReviewed ? "is-complete" : ""}`} role="progressbar" aria-label="تقدم قراءة الشروط والخصوصية والأذونات" aria-valuemin={0} aria-valuemax={100} aria-valuenow={legalScrollProgress}>
            <div><Icon name={legalReviewed ? "check" : "download"} size={16} /><span>{legalReviewed ? "وصلت إلى نهاية المحتوى؛ يمكنك تفعيل الموافقة." : "مرّر حتى نهاية المحتوى لتفعيل الموافقة."}</span><b>{legalScrollProgress.toLocaleString("ar-EG")}٪</b></div>
            <span><i style={{ width: `${legalScrollProgress}%` }} /></span>
          </div>
          <Button type="button" icon="check" full disabled={!legalReviewed} onClick={() => { setLegalOpen(false); setError(""); }}>{legalReviewed ? "تمت القراءة — متابعة للموافقة" : "أكمل التمرير أولًا"}</Button>
        </footer>
      </Modal>}
    </div>
  );
}
