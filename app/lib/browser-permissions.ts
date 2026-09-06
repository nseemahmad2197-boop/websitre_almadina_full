"use client";

// Permission is owned by the browser, never by localStorage. Some browsers
// support geolocation queries but not camera queries; keep their native flow.
export async function readBrowserPermission(name: "camera" | "geolocation"): Promise<PermissionState | undefined> {
  try {
    return (await navigator.permissions.query({ name: name as PermissionName })).state;
  } catch {
    return undefined;
  }
}
