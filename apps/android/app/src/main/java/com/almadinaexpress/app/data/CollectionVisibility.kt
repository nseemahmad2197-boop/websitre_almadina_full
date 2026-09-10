package com.almadinaexpress.app.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Remove from this account's list while retaining the settlement ledger. */
fun collectionVisibilityDatabase(snapshot: SessionSnapshot, invoiceId: String, hidden: Boolean): JsonObject {
    val invoice = snapshot.collections.firstOrNull { it.id == invoiceId }
    require(invoice != null && snapshot.canManageCollectionVisibility(invoice)) { "لا تملك صلاحية تعديل قائمة هذه الفاتورة." }
    require(!hidden || snapshot.canHideCollection(invoice)) { "لا يمكن حذف فاتورة مستحقة. يُسمح بالحذف بعد تسليم التحصيل فقط." }
    require(invoiceId !in snapshot.purgedCollectionIds) { "حُذفت الفاتورة نهائيًا من سلة محذوفاتك." }
    val ids = snapshot.hiddenCollectionIds.toMutableSet()
    if (hidden) ids.add(invoiceId) else ids.remove(invoiceId)
    val preferences = snapshot.database["preferences"] as? JsonObject ?: JsonObject(emptyMap())
    val own = preferences[snapshot.userId] as? JsonObject ?: JsonObject(emptyMap())
    return snapshot.database.updated("preferences" to preferences.updated(
        snapshot.userId to own.updated("hiddenCollectionIds" to JsonArray(ids.sorted().map(::JsonPrimitive))),
    ))
}

/** A revision-checked request, not a client-side deletion of financial records. */
fun trashPurgeRequest(snapshot: SessionSnapshot, orderIds: Set<String>, invoiceIds: Set<String>): JsonObject {
    require(orderIds.isNotEmpty() || invoiceIds.isNotEmpty()) { "اختر العناصر المطلوب حذفها من السلة." }
    val allowedOrders = snapshot.orders.filter(snapshot::canPurge).map { it.id }.toSet()
    require(allowedOrders.containsAll(orderIds) && snapshot.trashedCollectionIds.containsAll(invoiceIds)) {
        "تغيّرت المحذوفات. راجع التحديد؛ لا يمكن حذف فاتورة مستحقة أو طرد مرتبط بها."
    }
    return JsonObject(mapOf(
        "revision" to JsonPrimitive(snapshot.revision),
        "orderIds" to JsonArray(orderIds.sorted().map(::JsonPrimitive)),
        "invoiceIds" to JsonArray(invoiceIds.sorted().map(::JsonPrimitive)),
    ))
}
