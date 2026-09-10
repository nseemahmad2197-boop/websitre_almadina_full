// Network identity is supplied only by a verified deployment boundary, never
// by arbitrary browser-controlled forwarding headers.
const addresses = new WeakMap<Request, string>();

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
  return target;
}
