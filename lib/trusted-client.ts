// Network identity is supplied only by a verified deployment boundary, never
// by arbitrary browser-controlled forwarding headers.
const addresses = new WeakMap<Request, string>();
const locations = new WeakMap<Request, string>();

/** Set only at the authenticated deployment boundary. Never accept application
 * payloads, account addresses, browser locale or arbitrary forwarding headers. */
export function setTrustedClientLocation(request: Request, fields: { city?: unknown; region?: unknown; country?: unknown }): void {
  const clean = (value: unknown) => typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 100) : "";
  const country = clean(fields.country).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || ["XX", "T1"].includes(country)) return;
  let countryName = country;
  try { countryName = new Intl.DisplayNames(["ar"], { type: "region" }).of(country) || country; } catch { /* stable ISO fallback */ }
  const parts = [...new Set([clean(fields.city), clean(fields.region), countryName].filter(Boolean))];
  locations.set(request, parts.join("، "));
}

export function trustedClientLocation(request: Request): string | null {
  return locations.get(request) ?? null;
}

export function setTrustedClientAddress(request: Request, address: string): void {
  const value = address.trim().toLowerCase();
  if (value.length <= 64 && /^[0-9a-f:.]+$/.test(value)) addresses.set(request, value);
}

export function trustedClientAddress(request: Request): string {
  return addresses.get(request) ?? "unknown";
}

export function copyTrustedClientAddress(source: Request, target: Request): Request {
  const value = addresses.get(source);
  if (value) addresses.set(target, value);
  const location = locations.get(source);
  if (location) locations.set(target, location);
  return target;
}
