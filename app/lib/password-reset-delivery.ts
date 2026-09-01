export type PasswordResetChannel = "email" | "sms";

export type PasswordResetDeliveryMessage = {
  channel: PasswordResetChannel;
  destination: string;
  code: string;
  expiresInMinutes: number;
};

export type PasswordResetSender = (message: PasswordResetDeliveryMessage) => Promise<void>;

export type PasswordResetDeliveryConfig = {
  resendApiKey?: string;
  resendFromEmail?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioMessagingServiceSid?: string;
  sender?: PasswordResetSender;
  defer?: (promise: Promise<void>) => void;
};

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function latinDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
}

/**
 * Converts stored Palestinian/Israeli mobile numbers to the E.164 form required
 * by the SMS provider. Existing local accounts use 05xxxxxxxx: the Palestinian
 * mobile allocations 056/059 use +970 and the remaining 05 prefixes use +972.
 * Newer records may already contain +970 or +972.
 */
export function normalizeSmsDestination(value: string): string | null {
  const normalized = latinDigits(value).trim().replace(/[\s().-]/g, "");
  const international = normalized.startsWith("00") ? `+${normalized.slice(2)}` : normalized;

  if (/^\+(?:970|972)\d{8,9}$/.test(international) && international.length <= 16) {
    return international;
  }

  if (!/^05\d{8}$/.test(international)) return null;
  const countryCode = /^(?:056|059)/.test(international) ? "+970" : "+972";
  return `${countryCode}${international.slice(1)}`;
}

export function isPasswordResetChannelConfigured(config: PasswordResetDeliveryConfig, channel: PasswordResetChannel): boolean {
  if (config.sender) return true;
  if (channel === "email") return Boolean(config.resendApiKey?.trim() && config.resendFromEmail?.trim());
  return Boolean(
    config.twilioAccountSid?.trim()
      && config.twilioAuthToken?.trim()
      && config.twilioMessagingServiceSid?.trim(),
  );
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
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${config.resendApiKey!.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.resendFromEmail!.trim(),
      to: [message.destination],
      subject: "رمز إعادة تعيين كلمة المرور | المدينة إكسبرس",
      text: `رمز إعادة تعيين كلمة مرور المدينة إكسبرس هو: ${message.code}. الرمز صالح لمدة ${message.expiresInMinutes} دقائق. لا تشاركه مع أي شخص.`,
      html: resetEmailHtml(message.code, message.expiresInMinutes),
    }),
  });

  if (response.status !== 200) throw new Error(`Resend rejected the password reset message with status ${response.status}.`);
}

async function deliverSms(config: PasswordResetDeliveryConfig, message: PasswordResetDeliveryMessage): Promise<void> {
  const form = new URLSearchParams({
    To: message.destination,
    MessagingServiceSid: config.twilioMessagingServiceSid!.trim(),
    Body: `رمز إعادة تعيين كلمة مرور المدينة إكسبرس: ${message.code}. صالح لمدة ${message.expiresInMinutes} دقائق. لا تشاركه مع أحد.`,
  });
  const accountSid = config.twilioAccountSid!.trim();
  const credentials = btoa(`${accountSid}:${config.twilioAuthToken!.trim()}`);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: form,
  });

  if (response.status !== 201) throw new Error(`Twilio rejected the password reset message with status ${response.status}.`);
}

export async function deliverPasswordResetCode(config: PasswordResetDeliveryConfig, message: PasswordResetDeliveryMessage): Promise<void> {
  if (!isPasswordResetChannelConfigured(config, message.channel)) throw new Error("Password reset delivery is not configured.");
  if (config.sender) return config.sender(message);
  if (message.channel === "email") return deliverEmail(config, message);
  return deliverSms(config, message);
}
