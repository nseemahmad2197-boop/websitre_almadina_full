/** Shared, additive contract. Follow-ups are persisted separately from database snapshots. */
export const FOLLOWUP_TYPES = [
  { value: "price-change", label: "تعديل سعر طرد" },
  { value: "damaged", label: "طرد تالف" },
  { value: "delivery-delay", label: "تأخير في توصيل الطرد" },
  { value: "lost", label: "طرد مفقود" },
  { value: "return-delay", label: "تأخير في تسليم راجع" },
  { value: "cheque-approval", label: "موافقة على شيك" },
  { value: "address-change", label: "تعديل عنوان المستلم" },
] as const;
export const FOLLOWUP_STATUSES = [
  { value: "open", label: "مفتوحة" },
  { value: "in_progress", label: "قيد المتابعة" },
  { value: "resolved", label: "تم الحل" },
] as const;
export type FollowupType = typeof FOLLOWUP_TYPES[number]["value"];
export type FollowupStatus = typeof FOLLOWUP_STATUSES[number]["value"];
export const FOLLOWUP_LIMITS = {
  title: 120, description: 4_000, response: 4_000,
  files: 5, fileBytes: 10 * 1024 * 1024, totalBytes: 20 * 1024 * 1024,
  chunkBytes: 256 * 1024,
} as const;
export const FOLLOWUP_MIME_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
  "video/mp4", "video/quicktime", "video/webm", "video/ogg", "video/3gpp", "video/3gpp2",
  "audio/mp4", "audio/x-m4a", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "audio/aac", "audio/3gpp", "audio/3gpp2",
] as const;
export type FollowupAttachment = { id: string; name: string; mimeType: string; size: number; chunkCount: number };
export type Followup = {
  id: string; orderId: string; creatorId: string; creatorName: string;
  type: FollowupType; title: string; description: string; status: FollowupStatus;
  response: string; createdAt: string; updatedAt: string; attachments: FollowupAttachment[];
};
export type FollowupList = { followups: Followup[]; nextCursor: string | null };
export type FollowupAttachmentChunk = {
  attachment: FollowupAttachment; index: number; chunkCount: number; dataBase64: string;
};
export const followupTypeLabel = (value: string) => FOLLOWUP_TYPES.find((entry) => entry.value === value)?.label ?? value;
export const followupStatusLabel = (value: string) => FOLLOWUP_STATUSES.find((entry) => entry.value === value)?.label ?? value;
