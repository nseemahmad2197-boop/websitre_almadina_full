export type ReverseGeocodedAddress = {
  name?: string;
  state?: string;
  stateDistrict?: string;
  county?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  suburb?: string;
  district?: string;
  neighbourhood?: string;
  quarter?: string;
  hamlet?: string;
  street?: string;
  houseNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  formatted?: string;
};

export type ReverseGeocoder = (point: { latitude: number; longitude: number }) => Promise<ReverseGeocodedAddress>;

export type ReverseGeocodingConfig = {
  geoapifyApiKey?: string;
  reverseGeocoder?: ReverseGeocoder;
};

function cleanText(value: unknown, maximumLength = 180): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, maximumLength);
  return cleaned || undefined;
}

function normalizedAddress(properties: Record<string, unknown>): ReverseGeocodedAddress {
  return {
    name: cleanText(properties.name),
    state: cleanText(properties.state),
    stateDistrict: cleanText(properties.state_district),
    county: cleanText(properties.county),
    city: cleanText(properties.city),
    town: cleanText(properties.town),
    village: cleanText(properties.village),
    municipality: cleanText(properties.municipality),
    suburb: cleanText(properties.suburb),
    district: cleanText(properties.district),
    neighbourhood: cleanText(properties.neighbourhood),
    quarter: cleanText(properties.quarter),
    hamlet: cleanText(properties.hamlet),
    street: cleanText(properties.street),
    houseNumber: cleanText(properties.housenumber, 40),
    addressLine1: cleanText(properties.address_line1),
    addressLine2: cleanText(properties.address_line2),
    formatted: cleanText(properties.formatted, 300),
  };
}

export function isReverseGeocodingConfigured(config: ReverseGeocodingConfig): boolean {
  return Boolean(config.reverseGeocoder || config.geoapifyApiKey?.trim());
}

export async function reverseGeocode(
  config: ReverseGeocodingConfig,
  point: { latitude: number; longitude: number },
): Promise<ReverseGeocodedAddress> {
  if (config.reverseGeocoder) return config.reverseGeocoder(point);

  const apiKey = config.geoapifyApiKey?.trim();
  if (!apiKey) throw new Error("Reverse geocoding is not configured.");

  const endpoint = new URL("https://api.geoapify.com/v1/geocode/reverse");
  endpoint.searchParams.set("lat", String(point.latitude));
  endpoint.searchParams.set("lon", String(point.longitude));
  endpoint.searchParams.set("lang", "ar");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("limit", "1");
  endpoint.searchParams.set("apiKey", apiKey);

  const response = await fetch(endpoint, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Geoapify rejected reverse geocoding with status ${response.status}.`);

  const payload = await response.json() as { results?: unknown[]; features?: Array<{ properties?: unknown }> };
  const result = Array.isArray(payload.results)
    ? payload.results[0]
    : Array.isArray(payload.features)
      ? payload.features[0]?.properties
      : undefined;
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("No reverse geocoding result was found.");
  return normalizedAddress(result as Record<string, unknown>);
}
