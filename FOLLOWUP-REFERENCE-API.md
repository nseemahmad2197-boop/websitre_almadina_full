# Followup reference update — shared implementation contract
Implement reference creation/edit/success/details/conversation UX in web, Android, iOS. Preserve current first-entry fixes, role guards, Arabic RTL, brand green/light+dark/adaptive UI and account-scoped cancellation. Do not change actual parcel price/address automatically.

## Additive wire fields on Followup
- ticketNumber?: string — stable readable TK- reference, backend assigned, unique. UI fallback current id for legacy.
- trackingNumber?: string — server derived from current order, read-only to clients.
- requestedPrice?: string | null — canonical decimal string (0..999999999.99, max 2 decimals), only price-change. New forms require it for price-change. Legacy missing fields still readable.
- requestedAddress?: string | null — trimmed max 1000, only address-change. New forms require it for address-change.
- canEdit?: boolean — server authoritative; true for original creator while not resolved and still authorized for parcel. Default false on old server.
Existing enums/status/IDs/attachments remain unchanged. Default title `متابعة طرد ${trackingNumber}`.
Use `detailsVersion: 1` on NEW creation requests to enforce typed required fields and evidence for damaged/lost; old clients' requests without it remain backwards compatible. For detailsVersion 1 damaged/lost require >=1 attachment. Existing limits 5 files/10MiB each/20MiB total stay. Shared limits don't change to reference's 4 without need.

## Create
POST followups {existing requestId,orderId,type,title,description,attachmentIds, detailsVersion:1, requestedPrice?:string, requestedAddress?:string} -> {followup}.
Immutable retry payload and idempotency across later edits must remain safe. Success dialog: green check, تم إنشاء المتابعة بنجاح, ticket number + type, ما الخطوة التالية؟, buttons عرض المتابعة / عرض المتابعات, close. View followups returns collection, view ticket opens saved ticket.

## Edit
POST followups/:id/edit {requestId, expectedUpdatedAt:string, title, description, requestedPrice?:string, requestedAddress?:string, attachmentIds:string[] } -> {followup}.
Server checks original creator & active ticket + latest timestamp. Type/order/creator immutable. Keep selected existing attachment IDs plus new uploaded IDs; exclude removed IDs. No hard delete of ticket or conversation. 409 conflict -> clear message refresh/reopen before editing. Require fields for type, legacy absent structured values can be filled in edit. Mutation idempotency keyed actor+requestId with immutable fingerprint and same result on retry. Existing attachments can only belong to same ticket; never borrow comment attachment or other user's upload. Removed files cannot be downloaded after removal.

## Conversation
FollowupComment {id:string,followupId:string,authorId:string,authorName:string,authorRole:'merchant'|'courier'|'admin',text:string,createdAt:string,attachments:FollowupAttachment[]}
GET followups/:id/comments?cursor= -> {comments:FollowupComment[],nextCursor:string|null}, default MOST RECENT 50 sorted ascending chronologic within response; nextCursor fetches OLDER 50 also ascending. Clients prepend older pages and dedupe; refresh replaces with recent page so latest send stays visible.
POST followups/:id/comments {requestId,text:string,attachmentIds:string[]} -> {comment}.
Text max4000; text or >=1 media required; all accounts authorized for current parcel can comment; scope every GET/POST/download; rate-limit and same upload limits/completeness/signature checks. Immutable retries. Media reused through existing private upload/chunk/download API, same parent followupId. Separate persisted rows (avoid unbounded payload). Correct account purge of comments/attachments and exclude from bulk snapshots.
Display existing staff response as legacy response (not duplicate on every refresh). Keep status/response management for staff separate from new conversation. Refresh comments, retry failure, no cross-account stale data, no duplicates on send/retry.

## Reference UX
- labelled type selector, default editable title, description, read-only parcelnumber helper, conditional price/address, photo/file/audio/video sections, existing attachment count + remove for edit, inline audio preview, clear bottom confirmation
- details: title/type/description/creator/status/ticket ref/created+updated and additional info; private media preview; authorized Edit button, optional share only safe ticket ref (no credentials), clear Back/Close; no destructive close/delete implied by icon
- conversation `تواصل معنا`, media actions, send (explicit), readable thread, no fake actions
- preserve keyboard, large text/small screen/fold adaptive layouts and accessible focus labels



## Followup deletion — Android 2.9.23

- `canDelete` is an optional boolean returned on a live followup. The server grants it to the original creator or an admin. Omission on an older server means false. Deletion is independent of edit permission and is allowed for resolved tickets too.
- `POST followups/{id}/delete` with `{orderId, expectedUpdatedAt}` returns `{deleted:true, followupId:id, orderId}`. The endpoint authorizes the current account and checks the displayed ticket belongs to the supplied parcel. A changed live ticket returns 409 and must be reopened before confirmation. An authorized retry after successful deletion returns the same receipt.
- Deletion removes only the selected followup from visible lists and customer counts and denies subsequent detail, conversation, and attachment access. The parcel and other followups are unchanged. Stored records are retained as a soft deletion; this endpoint does not hard-delete parcel or conversation data.
- Android shows an explicit red «حذف المتابعة» button inside details, then identifies both followup and parcel in a confirmation dialog. It closes the detail only after validating the receipt and filters stale in-flight list responses so they cannot restore the deleted row.
- Deploy the server update before installing Android 2.9.23; an older server has no delete permission/endpoint, so the button remains hidden.
