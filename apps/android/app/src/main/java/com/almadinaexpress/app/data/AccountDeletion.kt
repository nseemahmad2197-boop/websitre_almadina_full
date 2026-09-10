package com.almadinaexpress.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import java.net.URI

data class AccountDeletionRequest(
    val id: String,
    val status: String,
    val createdAt: String,
    val updatedAt: String,
    val reviewDueAt: String,
    val message: String,
    val receiptUrl: String,
) {
    val statusLabel: String get() = when (status) {
        "pending" -> "تم استلام الطلب"
        "processing" -> "قيد المعالجة"
        "completed" -> "اكتمل الحذف"
        else -> "بانتظار تحديث الحالة"
    }
}

data class AccountDeletionInfo(
    val request: AccountDeletionRequest?,
    val eligible: Boolean,
    val activeOrderCount: Int,
    val unsettledCollectionCount: Int,
    val unsettledOrderCount: Int,
    val reviewTimeline: String,
    val retentionNotice: String,
)

/** Never infer immediate-deletion eligibility from missing fields or cached parcels. */
fun accountDeletionInfo(payload: JsonObject): AccountDeletionInfo {
    val eligibility = payload["eligibility"] as? JsonObject
        ?: throw IllegalArgumentException("تعذر تحميل خدمة طلب حذف الحساب. أعد المحاولة بعد تحديث الموقع.")
    val policy = payload["policy"] as? JsonObject
        ?: throw IllegalArgumentException("استجابة سياسة حذف الحساب غير مكتملة. أعد المحاولة.")
    fun JsonObject.requiredText(name: String): String = (get(name) as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
        ?.takeIf { it.isNotBlank() } ?: throw IllegalArgumentException("استجابة طلب حذف الحساب غير مكتملة. أعد المحاولة.")
    fun JsonObject.count(name: String): Int = (get(name) as? JsonPrimitive)?.intOrNull?.takeIf { it >= 0 }
        ?: throw IllegalArgumentException("تعذر التحقق من التزامات الحساب. أعد المحاولة.")
    val activeOrders = eligibility.count("activeOrderCount")
    val unsettledCollections = eligibility.count("unsettledCollectionCount")
    val unsettledOrders = eligibility.count("unsettledOrderCount")
    val serverEligible = (eligibility["eligible"] as? JsonPrimitive)?.booleanOrNull == true
    require(payload.containsKey("request") && (payload["request"] is JsonObject || payload["request"] == JsonNull)) {
        "استجابة حالة طلب الحذف غير مكتملة. حدّث الحالة قبل إعادة المحاولة."
    }
    val request = (payload["request"] as? JsonObject)?.let {
        AccountDeletionRequest(
            id = it.requiredText("id"), status = it.requiredText("status"),
            createdAt = it.requiredText("createdAt"), updatedAt = it.requiredText("updatedAt"),
            reviewDueAt = it.requiredText("reviewDueAt"), message = it.requiredText("message"),
            receiptUrl = it.requiredText("receiptUrl"),
        )
    }
    return AccountDeletionInfo(
        request = request,
        eligible = serverEligible && activeOrders == 0 && unsettledCollections == 0 && unsettledOrders == 0,
        activeOrderCount = activeOrders, unsettledCollectionCount = unsettledCollections,
        unsettledOrderCount = unsettledOrders,
        reviewTimeline = policy.requiredText("reviewTimeline"),
        retentionNotice = policy.requiredText("retentionNotice"),
    )
}

/** A receipt may open only on the configured service, never an arbitrary API-provided destination. */
fun safeDeletionReceiptUrl(value: String, websiteOrigin: String): String? = runCatching {
    val receipt = URI(value)
    val origin = URI(websiteOrigin)
    value.takeIf {
        receipt.scheme == "https" && receipt.host == origin.host && receipt.port == origin.port &&
            receipt.userInfo == null && receipt.path == "/delete-account" &&
            receipt.rawFragment?.startsWith("receipt=") == true
    }
}.getOrNull()
