export type PasswordResetDeliveryMessage = {
  destination: string;
  code: string;
  expiresInMinutes: number;
};

export type PasswordResetSender = (message: PasswordResetDeliveryMessage) => Promise<void>;

export type PasswordResetDeliveryConfig = {
  brevoApiKey?: string;
  brevoFromEmail?: string;
  brevoFromName?: string;
  sender?: PasswordResetSender;
  defer?: (promise: Promise<void>) => void;
};

export function isPasswordResetDeliveryConfigured(config: PasswordResetDeliveryConfig): boolean {
  if (config.sender) return true;
  return Boolean(config.brevoApiKey?.trim() && config.brevoFromEmail?.trim());
}

function resetEmailHtml(code: string, expiresInMinutes: number): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <body style="margin:0;background:#f2f5f3;font-family:Arial,sans-serif;color:#17231d">
    <div style="max-width:520px;margin:0 auto;padding:28px 16px">
      <div style="background:#ffffff;border-radius:18px;padding:28px;text-align:center;border:1px solid #dfe8e3">
        <div style="font-size:22px;font-weight:800;color:#087c45">المدينة إكسبرس</div>
        <h1 style="font-size:20px;margin:24px 0 8px">إعادة تعيين كلمة المرور</h1>
        <p style="font-size:14px;line-height:1.8;color:#65736c;margin:0">استخدم رمز التحقق التالي لإكمال طلبك:</p>
        <div dir="ltr" style="margin:22px 0;padding:16px;border-radius:14px;background:#eef8f2;color:#075f37;font-size:32px;font-weight:800;letter-spacing:8px">${code}</div>
        <p style="font-size:13px;line-height:1.8;color:#65736c;margin:0">الرمز صالح لمدة ${expiresInMinutes} دقائق. لا تشاركه مع أي شخص.</p>
        <p style="font-size:12px;line-height:1.8;color:#8a9690;margin:18px 0 0">إذا لم تطلب إعادة تعيين كلمة المرور، تجاهل هذه الرسالة.</p>
      </div>
    </div>
  </body>
</html>`;
}

async function deliverEmail(config: PasswordResetDeliveryConfig, message: PasswordResetDeliveryMessage): Promise<void> {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "api-key": config.brevoApiKey!.trim(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: config.brevoFromName?.trim() || "المدينة إكسبرس",
        email: config.brevoFromEmail!.trim(),
      },
      to: [{ email: message.destination }],
      subject: "رمز إعادة تعيين كلمة المرور | المدينة إكسبرس",
      textContent: `رمز إعادة تعيين كلمة مرور المدينة إكسبرس هو: ${message.code}. الرمز صالح لمدة ${message.expiresInMinutes} دقائق. لا تشاركه مع أي شخص.`,
      htmlContent: resetEmailHtml(message.code, message.expiresInMinutes),
    }),
  });

  if (!response.ok) throw new Error(`Brevo rejected the password reset message with status ${response.status}.`);
}

export async function deliverPasswordResetCode(config: PasswordResetDeliveryConfig, message: PasswordResetDeliveryMessage): Promise<void> {
  if (!isPasswordResetDeliveryConfigured(config)) throw new Error("Password reset delivery is not configured.");
  if (config.sender) return config.sender(message);
  return deliverEmail(config, message);
}
