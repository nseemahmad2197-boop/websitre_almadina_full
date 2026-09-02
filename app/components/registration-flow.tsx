"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import type { RegistrationChallenge, RegistrationFormValues } from "../lib/app-context";
import { Icon } from "./icon";
import { Button, Field } from "./ui";

type RegistrationStep = "identity" | "business" | "security" | "review" | "verify";
type PendingOperation = "request" | "verify" | "resend" | null;

type RegistrationFlowProps = {
  onCancel: () => void;
  onRequest: (values: RegistrationFormValues) => Promise<RegistrationChallenge>;
  onVerify: (code: string) => Promise<boolean>;
};

const FORM_STEPS: RegistrationStep[] = ["identity", "business", "security", "review"];
const EMPTY_FORM = { name: "", phone: "", store: "", email: "", password: "", confirm: "" };

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

export function RegistrationFlow({ onCancel, onRequest, onVerify }: RegistrationFlowProps) {
  const [step, setStep] = useState<RegistrationStep>("identity");
  const [form, setForm] = useState(EMPTY_FORM);
  const [accepted, setAccepted] = useState(false);
  const [visiblePassword, setVisiblePassword] = useState(false);
  const [code, setCode] = useState<string[]>(Array(6).fill(""));
  const [pending, setPending] = useState<PendingOperation>(null);
  const [cooldown, setCooldown] = useState(0);
  const [expiresIn, setExpiresIn] = useState(10 * 60);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const codeInputs = useRef<Array<HTMLInputElement | null>>([]);

  const busy = pending !== null;
  const currentFormStep = step === "verify" ? FORM_STEPS.length - 1 : FORM_STEPS.indexOf(step);
  const normalizedEmail = form.email.trim().toLowerCase();
  const codeValue = code.join("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((current) => Math.max(0, current - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

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
    if (target === "security") {
      if (!strongPassword(form.password)) return "يجب أن تحتوي كلمة المرور على 8 أحرف على الأقل وحرف ورقم ورمز.";
      if (form.password !== form.confirm) return "كلمتا المرور غير متطابقتين.";
    }
    if (target === "review" && !accepted) return "اقرأ شروط الاستخدام وسياسة الخصوصية ثم وافق للمتابعة.";
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

  const header = step === "identity"
    ? { title: "لنبدأ بمعلوماتك", subtitle: "أدخل بياناتك الأساسية للانتقال إلى الخطوة التالية" }
    : step === "business"
      ? { title: "بيانات متجرك", subtitle: "سيُستخدم بريدك لتسجيل الدخول وتأكيد الحساب" }
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
          </div>
          <label className="registration-flow__consent">
            <input type="checkbox" checked={accepted} onChange={(event) => { setAccepted(event.target.checked); setError(""); }} disabled={busy} />
            <span><b>أوافق على شروط الاستخدام وسياسة الخصوصية.</b> لن يُنشأ الحساب قبل تأكيد البريد الإلكتروني.</span>
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
          <Button type="submit" icon="send" full loading={pending === "request"} disabled={!accepted || busy}>إرسال رمز التحقق</Button>
        ) : (
          <Button type="submit" icon="chevronLeft" full disabled={busy}>التالي</Button>
        )}

        <button type="button" className="registration-flow__back" disabled={busy} onClick={goBack}><Icon name="chevronLeft" size={17} />{step === "identity" || step === "verify" ? "العودة إلى تسجيل الدخول" : "الخطوة السابقة"}</button>
      </form>
    </div>
  );
}
