"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "./icon";
import { Button, Field } from "./ui";

type RecoveryStep = "identify" | "method" | "code" | "password";
type RecoveryChannel = "email" | "sms";
type PendingOperation = "request" | "resend" | "verify" | "complete" | null;

type RecoveryResponse = {
  success?: boolean;
  error?: string;
  email?: string;
  loginEmail?: string;
  resendAfter?: number;
};

type PasswordRecoveryProps = {
  initialIdentifier?: string;
  onCancel: () => void;
  onComplete: (loginEmail?: string) => void;
};

const STEP_ORDER: RecoveryStep[] = ["identify", "method", "code", "password"];

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

function normalizeIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  return normalizeDigits(trimmed).replace(/[\s()-]/g, "");
}

function validIdentifier(value: string): boolean {
  return /^05\d{8}$/.test(value) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function strongPassword(value: string): boolean {
  return value.length >= 8 && value.length <= 128
    && /\p{L}/u.test(value)
    && /[0-9٠-٩]/.test(value)
    && /[^\p{L}\p{N}\s]/u.test(value);
}

async function recoveryRequest(path: "request" | "verify" | "complete", body: Record<string, unknown>): Promise<RecoveryResponse> {
  const response = await fetch(`/api/almadina/password-reset/${path}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({})) as RecoveryResponse;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error ?? "تعذّر إكمال طلب إعادة تعيين كلمة المرور. حاول مجددًا.");
  }
  return payload;
}

function ErrorMessage({ message }: { message: string }) {
  if (!message) return null;
  return <p className="form-error" id="password-recovery-error" role="alert"><Icon name="alert" size={15} />{message}</p>;
}

export function PasswordRecovery({ initialIdentifier = "", onCancel, onComplete }: PasswordRecoveryProps) {
  const [step, setStep] = useState<RecoveryStep>("identify");
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [channel, setChannel] = useState<RecoveryChannel | null>(null);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [visible, setVisible] = useState({ password: false, confirm: false });
  const [pending, setPending] = useState<PendingOperation>(null);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const busy = pending !== null;
  const stepIndex = STEP_ORDER.indexOf(step);
  const passwordIsStrong = strongPassword(newPassword);
  const passwordsMatch = newPassword === confirmPassword;
  const normalizedCode = normalizeDigits(code).replace(/\D/g, "").slice(0, 6);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((current) => Math.max(0, current - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function updateCooldown(response: RecoveryResponse) {
    const seconds = Number.isSafeInteger(response.resendAfter) && response.resendAfter! > 0
      ? Math.min(response.resendAfter!, 300)
      : 60;
    setCooldown(seconds);
  }

  function submitIdentifier(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const normalized = normalizeIdentifier(identifier);
    setError("");
    setStatusMessage("");
    if (!validIdentifier(normalized)) {
      setError("أدخل بريدًا إلكترونيًا صحيحًا أو رقم جوال من 10 أرقام يبدأ بـ 05.");
      return;
    }
    setIdentifier(normalized);
    setChannel(null);
    setStep("method");
  }

  async function sendCode(operation: "request" | "resend") {
    if (busy || !channel || (operation === "resend" && cooldown > 0)) return;
    setError("");
    setStatusMessage("");
    setPending(operation);
    try {
      const response = await recoveryRequest("request", { identifier: normalizeIdentifier(identifier), channel });
      updateCooldown(response);
      setCode("");
      setStep("code");
      if (operation === "resend") setStatusMessage("تم إرسال رمز تحقق جديد.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "تعذّر إرسال رمز التحقق. حاول مجددًا.");
    } finally {
      setPending(null);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setStatusMessage("");
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError("أدخل رمز التحقق المكوّن من 6 أرقام.");
      return;
    }
    setPending("verify");
    try {
      await recoveryRequest("verify", { code: normalizedCode });
      setCode("");
      setStep("password");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "رمز التحقق غير صحيح أو انتهت صلاحيته.");
    } finally {
      setPending(null);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setStatusMessage("");
    if (!passwordIsStrong) {
      setError("يجب أن تحتوي كلمة المرور على 8 أحرف على الأقل وحرف ورقم ورمز.");
      return;
    }
    if (!passwordsMatch) {
      setError("تأكيد كلمة المرور الجديدة غير مطابق.");
      return;
    }
    setPending("complete");
    try {
      const response = await recoveryRequest("complete", { newPassword, confirmPassword });
      const fallbackEmail = normalizeIdentifier(identifier).includes("@") ? normalizeIdentifier(identifier) : undefined;
      const loginEmail = response.loginEmail ?? response.email ?? fallbackEmail;
      setNewPassword("");
      setConfirmPassword("");
      setCode("");
      onComplete(loginEmail);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "تعذّر حفظ كلمة المرور الجديدة. حاول مجددًا.");
    } finally {
      setPending(null);
    }
  }

  function goBack() {
    if (busy) return;
    setError("");
    setStatusMessage("");
    if (step === "identify") return onCancel();
    if (step === "method") {
      setChannel(null);
      setStep("identify");
      return;
    }
    if (step === "code") {
      setCode("");
      setCooldown(0);
      setStep("method");
      return;
    }
    onCancel();
  }

  function visibilityButton(field: keyof typeof visible, label: string) {
    const shown = visible[field];
    return <button type="button" className="field__action" disabled={busy} aria-label={`${shown ? "إخفاء" : "إظهار"} ${label}`} aria-pressed={shown} onClick={() => setVisible((current) => ({ ...current, [field]: !current[field] }))}><Icon name={shown ? "eyeOff" : "eye"} size={20} /></button>;
  }

  const header = step === "identify"
    ? { title: "إعادة تعيين كلمة المرور", subtitle: "أدخل البريد الإلكتروني أو رقم الجوال المسجّل في حسابك" }
    : step === "method"
      ? { title: "اختر طريقة التحقق", subtitle: "سنرسل إليك رمز تحقق مكوّنًا من 6 أرقام" }
      : step === "code"
        ? { title: "أدخل رمز التحقق", subtitle: channel === "sms" ? "أدخل الرمز المرسل إلى رقم الجوال المسجّل" : "أدخل الرمز المرسل إلى البريد الإلكتروني المسجّل" }
        : { title: "كلمة مرور جديدة", subtitle: "أنشئ كلمة مرور قوية وآمنة لحسابك" };

  const backLabel = step === "identify"
    ? "العودة إلى تسجيل الدخول"
    : step === "method"
      ? "تعديل البريد أو رقم الجوال"
      : step === "code"
        ? "تغيير طريقة الإرسال"
        : "إلغاء والعودة إلى تسجيل الدخول";

  return (
    <div className="password-recovery">
      <header className="auth-card__header password-recovery__header"><h1>{header.title}</h1><p>{header.subtitle}</p></header>
      <div className="password-recovery__progress" aria-label={`الخطوة ${(stepIndex + 1).toLocaleString("ar-EG")} من ${STEP_ORDER.length.toLocaleString("ar-EG")}`}>
        <strong>الخطوة {(stepIndex + 1).toLocaleString("ar-EG")} من {STEP_ORDER.length.toLocaleString("ar-EG")}</strong>
        <div className="password-recovery__steps" aria-hidden="true">
          {STEP_ORDER.map((entry, index) => <span key={entry} className={index <= stepIndex ? "is-active" : ""} />)}
        </div>
      </div>

      {step === "identify" && (
        <form className="auth-form password-recovery__form" onSubmit={submitIdentifier} noValidate aria-busy={busy}>
          <Field icon="user" label="البريد الإلكتروني أو رقم الجوال" placeholder="name@example.com أو 05xxxxxxxx" value={identifier} onChange={(event) => { setIdentifier(event.target.value); setError(""); }} autoComplete="username" autoCapitalize="none" spellCheck={false} dir="ltr" autoFocus disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? "password-recovery-error" : undefined} />
          <p className="password-recovery__notice"><Icon name="shield" size={16} /><span>لن نعرض بيانات الحساب، وسنتابع بنفس الرسالة سواء كانت البيانات مسجّلة أم لا.</span></p>
          <ErrorMessage message={error} />
          <Button type="submit" icon="chevronLeft" full disabled={busy}>متابعة</Button>
          <button type="button" className="password-recovery__back" disabled={busy} onClick={goBack}><Icon name="chevronLeft" size={17} />{backLabel}</button>
        </form>
      )}

      {step === "method" && (
        <form className="auth-form password-recovery__form" onSubmit={(event) => { event.preventDefault(); void sendCode("request"); }} aria-busy={busy}>
          <fieldset className="password-recovery__methods" disabled={busy}>
            <legend>اختر وسيلة استلام الرمز</legend>
            <label className="password-recovery__method">
              <input type="radio" name="recovery-channel" value="email" checked={channel === "email"} onChange={() => { setChannel("email"); setError(""); }} />
              <span className="password-recovery__method-icon"><Icon name="mail" size={21} /></span>
              <span className="password-recovery__method-copy"><strong>البريد الإلكتروني</strong><small>إرسال الرمز إلى البريد المسجّل في الحساب</small></span>
              <Icon name="check" size={18} className="password-recovery__method-check" />
            </label>
            <label className="password-recovery__method">
              <input type="radio" name="recovery-channel" value="sms" checked={channel === "sms"} onChange={() => { setChannel("sms"); setError(""); }} />
              <span className="password-recovery__method-icon"><Icon name="phone" size={21} /></span>
              <span className="password-recovery__method-copy"><strong>رسالة نصية SMS</strong><small>إرسال الرمز إلى رقم الجوال المسجّل في الحساب</small></span>
              <Icon name="check" size={18} className="password-recovery__method-check" />
            </label>
          </fieldset>
          <p className="password-recovery__notice"><Icon name="info" size={16} /><span>إذا كانت البيانات مطابقة لحساب، فسيصل رمز التحقق إلى الوسيلة المختارة.</span></p>
          <ErrorMessage message={error} />
          <Button type="submit" icon="send" full loading={pending === "request"} disabled={!channel || busy}>إرسال رمز التحقق</Button>
          <button type="button" className="password-recovery__back" disabled={busy} onClick={goBack}><Icon name="chevronLeft" size={17} />{backLabel}</button>
        </form>
      )}

      {step === "code" && (
        <form className="auth-form password-recovery__form" onSubmit={submitCode} noValidate aria-busy={busy}>
          <Field wrapperClassName="password-recovery__code-field" className="password-recovery__code-control" label="رمز التحقق" placeholder="000000" value={normalizedCode} onChange={(event) => { setCode(normalizeDigits(event.target.value).replace(/\D/g, "").slice(0, 6)); setError(""); setStatusMessage(""); }} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} dir="ltr" autoFocus disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? "password-recovery-error" : undefined} />
          {statusMessage && <p className="password-recovery__status" role="status"><Icon name="check" size={15} />{statusMessage}</p>}
          <ErrorMessage message={error} />
          <Button type="submit" icon="check" full loading={pending === "verify"} disabled={normalizedCode.length !== 6 || busy}>تحقق من الرمز</Button>
          <div className="password-recovery__resend">
            {cooldown > 0 ? <p><Icon name="clock" size={14} />يمكنك إعادة الإرسال خلال <bdi>{cooldown.toLocaleString("ar-EG")}</bdi> ث</p> : <p>لم يصلك الرمز؟</p>}
            <Button type="button" variant="ghost" icon="refresh" loading={pending === "resend"} disabled={cooldown > 0 || busy} onClick={() => { void sendCode("resend"); }}>إعادة إرسال الرمز</Button>
          </div>
          <button type="button" className="password-recovery__back" disabled={busy} onClick={goBack}><Icon name="chevronLeft" size={17} />{backLabel}</button>
        </form>
      )}

      {step === "password" && (
        <form className="auth-form password-recovery__form" onSubmit={submitPassword} noValidate aria-busy={busy}>
          <Field icon="key" label="كلمة المرور الجديدة" placeholder="8 أحرف على الأقل" type={visible.password ? "text" : "password"} value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setError(""); }} autoComplete="new-password" minLength={8} maxLength={128} suffix={visibilityButton("password", "كلمة المرور الجديدة")} disabled={busy} hint={newPassword && !passwordIsStrong ? "أضف حرفًا ورقمًا ورمزًا، وبحد أدنى 8 أحرف." : undefined} aria-invalid={Boolean(newPassword && !passwordIsStrong)} />
          <Field icon="lock" label="تأكيد كلمة المرور" placeholder="أعد كتابة كلمة المرور" type={visible.confirm ? "text" : "password"} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(""); }} autoComplete="new-password" minLength={8} maxLength={128} suffix={visibilityButton("confirm", "تأكيد كلمة المرور")} disabled={busy} hint={confirmPassword && !passwordsMatch ? "كلمتا المرور غير متطابقتين." : undefined} aria-invalid={Boolean(confirmPassword && !passwordsMatch)} />
          <p className="password-recovery__notice"><Icon name="shield" size={16} /><span>بعد الحفظ ستنتهي الجلسات القديمة، وستحتاج إلى ربط حماية الجهاز مجددًا.</span></p>
          <ErrorMessage message={error} />
          <Button type="submit" icon="check" full loading={pending === "complete"} disabled={!passwordIsStrong || !passwordsMatch || busy}>حفظ كلمة المرور الجديدة</Button>
          <button type="button" className="password-recovery__back" disabled={busy} onClick={goBack}><Icon name="chevronLeft" size={17} />{backLabel}</button>
        </form>
      )}
    </div>
  );
}
