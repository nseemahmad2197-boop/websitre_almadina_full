import { governorates, normalizeLocation } from "./data.ts";
import type { ReverseGeocodedAddress } from "./reverse-geocoding.ts";

export type RegistrationMapAddressMatch = {
  governorate?: string;
  city?: string;
  address?: string;
};

function values(...entries: Array<string | undefined>): string[] {
  return [...new Set(entries.map((entry) => entry?.trim()).filter((entry): entry is string => Boolean(entry)))];
}

function variants(value: string): string[] {
  const withoutAdministrativePrefix = value.replace(/^(?:محافظة|لواء|قضاء|منطقة|مدينة)\s+/u, "");
  return [...new Set([normalizeLocation(value), normalizeLocation(withoutAdministrativePrefix)].filter(Boolean))];
}

function withoutAdministrativePrefix(value: string): string {
  return value.replace(/^(?:محافظة|لواء|قضاء|منطقة|مدينة)\s+/u, "").trim();
}

function labelsMatch(first: string, second: string): boolean {
  const firstVariants = variants(first);
  const secondVariants = variants(second);
  return firstVariants.some((left) => secondVariants.some((right) => (
    left === right
    || (Math.min(left.length, right.length) >= 4 && (left.includes(right) || right.includes(left)))
  )));
}

function findGovernorate(address: ReverseGeocodedAddress) {
  const administrativeCandidates = values(
    address.stateDistrict,
    address.county,
    address.state,
    address.municipality,
    address.city,
    address.town,
    address.village,
  );
  const namedRegion = administrativeCandidates
    .flatMap((candidate) => governorates.filter((region) => labelsMatch(region.name, candidate)))
    .at(0);
  if (namedRegion) return namedRegion;

  const localityCandidates = values(
    address.neighbourhood,
    address.suburb,
    address.district,
    address.quarter,
    address.hamlet,
    address.village,
    address.town,
    address.city,
    address.municipality,
  );
  for (const candidate of localityCandidates) {
    const matchingRegions = governorates.filter((region) => region.cities.some((city) => labelsMatch(city, candidate)));
    if (matchingRegions.length === 1) return matchingRegions[0];
  }
  return undefined;
}

export function matchRegistrationMapAddress(address: ReverseGeocodedAddress): RegistrationMapAddressMatch {
  const governorate = findGovernorate(address);
  const administrativeCandidates = values(address.stateDistrict, address.county, address.state, address.municipality);
  const localityCandidates = values(
    address.neighbourhood,
    address.suburb,
    address.district,
    address.quarter,
    address.hamlet,
    address.village,
    address.town,
    address.city,
    address.municipality,
  );
  const city = governorate
    ? localityCandidates.flatMap((candidate) => governorate.cities.filter((entry) => labelsMatch(entry, candidate))).at(0)
      ?? localityCandidates.find((candidate) => !labelsMatch(candidate, governorate.name))
      ?? localityCandidates[0]
    : localityCandidates[0];

  const street = address.street?.trim() || address.addressLine1?.trim() || address.name?.trim() || address.formatted?.trim();
  const houseNumber = address.houseNumber?.trim();
  const automaticAddress = street
    ? houseNumber && !normalizeLocation(street).includes(normalizeLocation(houseNumber))
      ? `${street}، مبنى ${houseNumber}`
      : street
    : undefined;

  return {
    governorate: governorate?.name ?? (administrativeCandidates[0] ? withoutAdministrativePrefix(administrativeCandidates[0]) : undefined),
    city: city?.slice(0, 120),
    address: automaticAddress?.slice(0, 180),
  };
}
