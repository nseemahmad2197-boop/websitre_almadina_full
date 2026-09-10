export type DeletionRequestStatus = "pending" | "processing" | "completed";

/** Server-owned; never accepted from or included in a database snapshot. */
export type AccountDeletionRequestRecord = {
  id: string;
  userId: string;
  status: DeletionRequestStatus;
  createdAt: string;
  updatedAt: string;
  reviewDueAt: string;
  completedAt?: string;
  message: string;
  receiptToken: string;
};

export type AccountDeletionRequest = Omit<AccountDeletionRequestRecord, "userId" | "receiptToken"> & { receiptUrl: string };
export type DeletionEligibility = {
  activeOrderCount: number;
  unsettledCollectionCount: number;
  unsettledOrderCount: number;
  eligible: boolean;
};
export const deletionPolicy = {
  reviewDays: 7,
  reviewTimeline: "تُراجع طلبات الحذف خلال 7 أيام تقويمية من تقديمها. إذا وُجدت التزامات، تظهر إجراءات التسوية وموعد المتابعة في حالة الطلب. لا يلزم الاتصال بالدعم لتقديم الطلب.",
  retentionNotice: "تظل بيانات الحساب والطرود والفواتير اللازمة محفوظة أثناء التسوية. بعد اكتمال الحذف تُزال بيانات الحساب والمستلمين والطرود والتحصيلات التابعة له، وتُلغى جلساته ووسائل دخوله. تبقى أرقام ملصقات الطرود المستهلكة لمنع إعادة استخدامها دون بيانات المستلمين. يحتفظ رابط المتابعة برقم الطلب وحالته فقط لمدة 30 يومًا بعد الإتمام، ثم ينتهي. عند حذف حساب مندوب، تبقى طرود التجار وتُفصل عنه.",
} as const;
export type DeletionResponse = { request: AccountDeletionRequest | null; eligibility: DeletionEligibility; policy: typeof deletionPolicy };

export const deletionStatusLabels: Record<DeletionRequestStatus, string> = {
  pending: "بانتظار المراجعة", processing: "قيد المعالجة", completed: "اكتمل الحذف",
};

export function retainDeletionRequests(records: AccountDeletionRequestRecord[] = [], now = Date.now()): AccountDeletionRequestRecord[] {
  return records.filter((entry) => entry.status !== "completed" || Boolean(entry.completedAt && now - Date.parse(entry.completedAt) < 30 * 86400_000));
}
