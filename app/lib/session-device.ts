/** Device descriptions are client hints, not proof of a person's identity. */
export type DevicePlatform = 'android' | 'ios' | 'ipados' | 'windows' | 'macos' | 'linux' | 'unknown';
export type SessionDeviceDescriptor = {
  name: string; type: 'mobile' | 'tablet' | 'desktop' | 'unknown'; browser: string;
  platform: DevicePlatform; model: string; osVersion: string; appVersion: string;
};

export function cleanDeviceText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, limit) : '';
}

function header(request: Request, name: string, limit: number, encoded = false): string {
  const raw = request.headers.get(name) ?? '';
  if (raw.length > limit * 12) return '';
  try { return cleanDeviceText(encoded ? decodeURIComponent(raw) : raw, limit); } catch { return ''; }
}

export function describeSessionDevice(request: Request): SessionDeviceDescriptor {
  const userAgent = (request.headers.get('user-agent') ?? '').slice(0, 1024);
  const hint = (request.headers.get('sec-ch-ua-platform') ?? '').replace(/["']/g, '').toLowerCase();
  const native = header(request, 'x-almadina-platform', 16).toLowerCase();
  if (native === 'android' || native === 'ios' || native === 'ipados') {
    const model = header(request, 'x-almadina-device-model', 100, true);
    const platformName = native === 'android' ? 'Android' : native === 'ipados' ? 'iPad' : 'iPhone';
    return {
      name: model && model !== platformName ? `${platformName} — ${model}` : platformName,
      type: native === 'ipados' ? 'tablet' : 'mobile', browser: 'تطبيق المدينة إكسبرس',
      platform: native, model,
      osVersion: header(request, 'x-almadina-os-version', 40),
      appVersion: header(request, 'x-almadina-app-version', 40),
    };
  }
  const browser = /EdgiOS|EdgA|Edg\//i.test(userAgent) ? 'Edge'
    : /OPiOS|OPR\//i.test(userAgent) ? 'Opera' : /SamsungBrowser/i.test(userAgent) ? 'Samsung Internet'
      : /FxiOS|Firefox\//i.test(userAgent) ? 'Firefox' : /CriOS|Chrome\//i.test(userAgent) ? 'Chrome'
        : /Safari\//i.test(userAgent) && /Version\//i.test(userAgent) ? 'Safari' : 'متصفح';
  const mobileHint = request.headers.get('sec-ch-ua-mobile') === '?1';
  let name = 'جهاز غير معروف';
  let platform: DevicePlatform = 'unknown';
  let type: SessionDeviceDescriptor['type'] = 'unknown';
  if (/iPad/i.test(userAgent) || hint === 'ipados') { platform = 'ipados'; name = 'iPad'; type = 'tablet'; }
  else if (/iPhone|iPod/i.test(userAgent) || hint === 'ios') { platform = 'ios'; name = 'iPhone'; type = 'mobile'; }
  else if (/Android/i.test(userAgent) || hint === 'android') {
    platform = 'android'; type = !/Mobile/i.test(userAgent) && !mobileHint ? 'tablet' : 'mobile';
    name = type === 'tablet' ? 'جهاز Android لوحي' : 'هاتف Android';
  } else if (/Windows/i.test(userAgent) || hint === 'windows') { platform = 'windows'; name = 'Windows'; type = 'desktop'; }
  else if (/Macintosh|Mac OS X/i.test(userAgent) || hint === 'macos') { platform = 'macos'; name = 'Mac'; type = 'desktop'; }
  else if (/Linux/i.test(userAgent) || hint === 'linux') { platform = 'linux'; name = 'Linux'; type = mobileHint ? 'mobile' : 'desktop'; }
  else if (mobileHint) { name = 'هاتف'; type = 'mobile'; }
  return { name: browser === 'متصفح' ? name : `${browser} على ${name}`, type, browser, platform, model: '', osVersion: '', appVersion: '' };
}
