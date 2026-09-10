# Existing backend contract

Reference: existing Almadina Express API with the accompanying website/server v43 account deletion request extension. Native iOS 1.0.8 requires v43 to be deployed first. The earlier trash selection extension requires website/server v39 or newer; no live server deployment is performed while preparing this package.

Base URL is configured in Info.plist. Default: `https://almadina-express.onrender.com/api/almadina/`.

Successful authenticated snapshot: `{ database: object, revision: integer, userId: string }`.
Database snapshots are role-filtered by the server. Keep every unknown field and submit the supplied revision when updating. Do not construct a replacement database solely from UI models. Never ship administrator/session secrets in the client.

| Method and path | Request / effect |
|---|---|
| GET session | Restore role-filtered snapshot |
| POST login | email, password; session cookie + snapshot |
| POST logout | End current session |
| POST register/request | name, phone, store, email, governorate, city, address, password, optional selected coordinates, locationMethod, acceptedTerms |
| POST register/verify | 6-digit email code; challenge cookie retained |
| POST password-reset/request | identifier |
| POST password-reset/verify | email code |
| POST password-reset/complete | newPassword, confirmPassword |
| GET track?tracking=… | Sanitized public order, no authenticated private database |
| POST orders | orders array; persistent client IDs; blank trackingNumber |
| PUT database | database, revision; server merges and authorizes per role |
| POST orders/assign-code | orderId, trackingNumber; reserved unused code, owner/admin only, immutable association |
| POST orders/scan | trackingNumber; staff scan ready/returned into shipped |
| POST parcel-code-batches | requestId, count 1–500, label; response snapshot + batchId |
| POST collections/prepare | invoiceId; pending → ready |
| POST collections/verify | invoiceId, verificationCode (4 digits); ready → paid |
| POST trash/purge | revision, orderIds, invoiceIds; owner/admin; selected trashed parcels removed, selected paid invoice visibility purged per account; ledger and code claims retained. 409 includes the latest snapshot; refresh and review instead of automatic retry. |
| POST notices/clear | noticeIds |
| POST notices/broadcast | requestId, audience, optional recipientUserId, title, message |
| POST account/password | currentPassword, newPassword, confirmPassword, signOutAllDevices |
| POST account/delete | password, confirmation = حذف حسابي; server checks obligations |
| GET account/deletion-request | Current authenticated deletion request, eligibility and policy, without modifying account data |
| POST account/deletion-request | password, confirmation = حذف حسابي; registers or returns the existing request even with unsettled obligations; never implies immediate deletion or logs out |
| GET security/devices | devices array |
| POST security/devices/revoke | deviceId; updated devices |

Courier and merchant permissions are enforced by the server, not just navigation. Cookies are kept in device-bound Keychain, requests are confined to HTTPS, and redirects are not followed. No QR URL becomes a network request destination.

`preferredDeliveryDate` is the actual server field. `preferredDate` is only a local form property. Governorate and locality combinations come from the bundled canonical list, including disambiguation of repeated names. All monetary settlement acknowledgements are taken from the server, not from the local preview.

APNs registration and delivery endpoints do not exist in this reference contract. Local notifications plus opportunistic BGAppRefresh are provided; they are not an APNs substitute. A true remote-push implementation must use a per-user, revocable installation-token registration endpoint and server-side APNs provider credentials. Do not embed APNs private keys in this app.

`preferences[userId].purgedCollectionIds` is server-owned. It is included in effective hidden IDs, excluded from trash, and preserved when older clients omit it in a general database update. Outstanding invoices are never eligible. A parcel referenced by an outstanding invoice is not eligible for permanent deletion. The entire selection is validated before a revision-checked write.

## Account deletion request response

Both request endpoints return an object separate from the database snapshot:

```json
{
  "request": null,
  "eligibility": { "activeOrderCount": 0, "unsettledCollectionCount": 0, "unsettledOrderCount": 0, "eligible": true },
  "policy": { "reviewDays": 7, "reviewTimeline": "Server policy text", "retentionNotice": "Server retention text" }
}
```

When registered, `request` is `{id,status,createdAt,updatedAt,reviewDueAt,completedAt?,message,receiptUrl}`. Status is `pending`, `processing` or `completed`. `reviewDueAt` is the review/follow-up deadline, not a promised account deletion completion date. Display `message`, `reviewTimeline` and `retentionNotice` from the server. POST is authenticated, password-confirmed, idempotent for the account and rate limited (6 requests per 10 minutes).

Never call `clearSession` after submitting this request. Immediate `POST account/delete` remains a separate, confirmed action offered after authoritative `eligibility.eligible=true`; the server validates obligations again. Native iOS does not modify the server's request queue through a generic database snapshot. The administrator processes requests in the accompanying website.

`receiptUrl` uses the configured origin and `/delete-account#receipt=…`. Treat the fragment token as private: it grants access to that request's non-PII status after account deletion for 30 days, then expires; do not log it or insert it in analytics. Native iOS checks HTTPS, the configured API host/port and the expected receipt page before opening or sharing it.

Completion after settlement purges the customer's account, owned parcels/invoices/recipients and session credentials. Courier account deletion unassigns parcels, retaining them for their merchants. Used parcel-label numbers remain unusable without recipient data. The receipt retains only the request ID, status, timestamps and a generic completed message; it does not retain the account owner's personal details. An active request does not remove unsettled financial data.

Public `/privacy`, `/delete-account` and `/support` pages do not require the app to be installed. Info.plist supports explicit HTTPS URLs; missing or empty settings derive the same paths from the configured API origin. Verify the pages are deployed and company policy/contact details are correct before submission. No email or telephone contact is invented by the client.
