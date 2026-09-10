package com.almadinaexpress.app.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

enum class Role { ADMIN, MERCHANT, COURIER }

data class AvailableAccount(
    val id: String,
    val email: String,
    val name: String,
    val description: String,
)

enum class Membership(val apiValue: String, val arabic: String) {
    STANDARD("standard", "عادي"),
    PREMIUM("premium", "بريميوم"),
    DIAMOND("diamond", "ماسي");

    companion object {
        fun from(value: String) = entries.firstOrNull { it.apiValue == value } ?: STANDARD
    }
}

enum class DeliveryZone(val apiValue: String, val arabic: String, val storedGovernorate: String) {
    WEST_BANK("west-bank", "الضفة الغربية", "الضفة الغربية"),
    JERUSALEM("jerusalem", "القدس", "القدس"),
    INTERIOR("interior", "الداخل", "الداخل");
}

data class OrderPricing(
    val baseFee: Double,
    val weightFee: Double,
    val oversizeFee: Double,
) {
    val deliveryFee: Double get() = baseFee + weightFee + oversizeFee
}

enum class OrderStatus(val apiValue: String, val arabic: String, val color: Long) {
    DRAFT("draft", "قيد الإنشاء", 0xFF5B6470),
    READY("ready", "جاهز للإرسال", 0xFFBC7629),
    SHIPPED("shipped", "مشحون", 0xFF6453B2),
    PROCESSING("processing", "تمت المعالجة", 0xFF218391),
    DELIVERED("delivered", "واصل", 0xFF168653),
    STUCK("stuck", "عالق", 0xFFBB4384),
    RETURNED("returned", "راجع", 0xFFC35A52),
    DEFERRED("deferred", "مؤجل", 0xFF8057B0);

    companion object {
        fun from(value: String) = entries.firstOrNull { it.apiValue == value } ?: DRAFT
    }
}

data class SessionSnapshot(
    val database: JsonObject,
    val revision: Int,
    val userId: String,
) {
    val currentUser: UserItem?
        get() = users.firstOrNull { it.id == userId }
    val users: List<UserItem> by lazy(LazyThreadSafetyMode.PUBLICATION) { database.array("users").objects().map(::userFromJson) }
    val orders: List<OrderItem> by lazy(LazyThreadSafetyMode.PUBLICATION) { database.array("orders").objects().map(::orderFromJson) }
    val collections: List<CollectionItem> by lazy(LazyThreadSafetyMode.PUBLICATION) { database.array("collections").objects().map(::collectionFromJson) }
    val hiddenCollectionIds: Set<String>
        get() {
            val requested = ((database["preferences"] as? JsonObject)?.get(userId) as? JsonObject)
            ?.array("hiddenCollectionIds")?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }?.toSet().orEmpty()
            val combined = requested + purgedCollectionIds
            return collections.filter { it.id in combined && canHideCollection(it) }.map { it.id }.toSet()
        }
    val purgedCollectionIds: Set<String> get() {
        val requested = ((database["preferences"] as? JsonObject)?.get(userId) as? JsonObject)
            ?.array("purgedCollectionIds")?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }?.toSet().orEmpty()
        return collections.filter { it.id in requested && canHideCollection(it) }.map { it.id }.toSet()
    }
    val trashedCollectionIds: Set<String> get() = hiddenCollectionIds - purgedCollectionIds
    val visibleCollections: List<CollectionItem> get() {
        val hidden = hiddenCollectionIds
        return collections.filterNot { it.id in hidden }
    }
    fun canManageCollectionVisibility(invoice: CollectionItem): Boolean =
        currentUser?.role == Role.ADMIN || (currentUser?.role == Role.MERCHANT && invoice.merchantId == userId)
    fun canHideCollection(invoice: CollectionItem): Boolean =
        invoice.status == "paid" && canManageCollectionVisibility(invoice)
    fun canTrash(order: OrderItem): Boolean =
        currentUser?.role == Role.ADMIN || (currentUser?.role == Role.MERCHANT && order.merchantId == userId)
    fun canPurge(order: OrderItem): Boolean = order.deleted && canTrash(order) &&
        collections.none { it.status != "paid" && order.id in it.orderIds }
    val notices: List<NoticeItem> by lazy(LazyThreadSafetyMode.PUBLICATION) { database.array("notices").objects().map(::noticeFromJson) }
    val parcelCodeBatches: List<ParcelCodeBatch>
        get() = database.array("parcelCodeBatches").objects().mapNotNull(::parcelCodeBatchFromJson)
    val claimedParcelCodes: Set<String>
        get() = (database["parcelCodeClaims"] as? JsonObject)?.keys.orEmpty()

}

data class UserItem(
    val id: String,
    val name: String,
    val email: String,
    val phone: String,
    val store: String,
    val role: Role,
    val membership: Membership,
    val joinedAt: String,
    val raw: JsonObject,
)

data class TrackingItem(
    val id: String,
    val kind: String,
    val status: OrderStatus,
    val title: String,
    val location: String,
    val actor: String,
    val note: String,
    val createdAt: String,
    val raw: JsonObject,
)

data class OrderItem(
    val id: String,
    val trackingNumber: String,
    val merchantId: String,
    val merchantName: String,
    val merchantStore: String,
    val recipientName: String,
    val recipientPhone: String,
    val governorate: String,
    val city: String,
    val address: String,
    val pickupAddress: String,
    val amount: Double,
    val deliveryFee: Double,
    val weightFee: Double,
    val oversizeFee: Double,
    val content: String,
    val weight: String,
    val dimensions: String,
    val notes: String,
    val privateNotes: String,
    val reference: String,
    val type: String,
    val status: OrderStatus,
    val courierName: String,
    val deleted: Boolean,
    val deletedAt: String,
    val createdAt: String,
    val updatedAt: String,
    val events: List<TrackingItem>,
    val raw: JsonObject,
)

data class CollectionItem(
    val id: String,
    val merchantId: String,
    val merchantName: String,
    val invoiceNumber: String,
    val orderIds: List<String>,
    val grossAmount: Double,
    val deliveryFees: Double,
    val returnFees: Double,
    val netAmount: Double,
    val deliveredCount: Int,
    val returnedCount: Int,
    val status: String,
    val verificationCode: String,
    val authorizedRecipient: String,
    val createdAt: String,
    val raw: JsonObject,
)

data class NoticeItem(
    val id: String,
    val userId: String,
    val title: String,
    val message: String,
    val read: Boolean,
    val createdAt: String,
    val orderId: String?,
    val raw: JsonObject,
)

data class NewOrderInput(
    val type: String,
    val recipientName: String,
    val recipientPhone: String,
    val governorate: String,
    val city: String,
    val address: String,
    val pickupAddress: String,
    val amount: Double,
    val content: String,
    val weight: String,
    val lengthCm: Double?,
    val widthCm: Double?,
    val heightCm: Double?,
    val instructions: String,
    val privateNote: String,
    val reference: String,
)

data class RegistrationInput(
    val name: String,
    val phone: String,
    val store: String,
    val email: String,
    val governorate: String,
    val city: String,
    val address: String,
    val password: String,
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
    val useMapLocation: Boolean = false,
    val acceptedTerms: Boolean = false,
)

fun JsonObject.string(key: String): String = this[key]?.jsonPrimitive?.contentOrNull.orEmpty()
fun JsonObject.number(key: String): Double = this[key]?.jsonPrimitive?.doubleOrNull ?: 0.0
fun JsonObject.integer(key: String): Int = this[key]?.jsonPrimitive?.intOrNull ?: 0
fun JsonObject.flag(key: String): Boolean = this[key]?.jsonPrimitive?.booleanOrNull ?: false
fun JsonObject.array(key: String): JsonArray = this[key] as? JsonArray ?: JsonArray(emptyList())
fun JsonArray.objects(): List<JsonObject> = mapNotNull { it as? JsonObject }

fun userFromJson(raw: JsonObject) = UserItem(
    id = raw.string("id"),
    name = raw.string("name"),
    email = raw.string("email"),
    phone = raw.string("phone"),
    store = raw.string("store"),
    role = when (raw.string("role")) {
        "admin" -> Role.ADMIN
        "courier" -> Role.COURIER
        else -> Role.MERCHANT
    },
    membership = Membership.from(raw.string("membership")),
    joinedAt = raw.string("joinedAt"),
    raw = raw,
)

fun trackingFromJson(raw: JsonObject) = TrackingItem(
    id = raw.string("id"),
    kind = raw.string("kind").ifBlank { "status" },
    status = OrderStatus.from(raw.string("status")),
    title = raw.string("title"),
    location = raw.string("location"),
    actor = raw.string("actor"),
    note = raw.string("note"),
    createdAt = raw.string("createdAt"),
    raw = raw,
)

fun orderFromJson(raw: JsonObject) = OrderItem(
    id = raw.string("id"),
    trackingNumber = raw.string("trackingNumber"),
    merchantId = raw.string("merchantId"),
    merchantName = raw.string("merchantName"),
    merchantStore = raw.string("merchantStore"),
    recipientName = raw.string("recipientName"),
    recipientPhone = raw.string("recipientPhone"),
    governorate = raw.string("governorate"),
    city = raw.string("city"),
    address = raw.string("address"),
    pickupAddress = raw.string("pickupAddress"),
    amount = raw.number("amount"),
    deliveryFee = raw.number("deliveryFee"),
    weightFee = raw.number("weightFee"),
    oversizeFee = raw.number("oversizeFee"),
    content = raw.string("content"),
    weight = raw.string("weight"),
    dimensions = raw.string("dimensions"),
    notes = raw.string("notes"),
    privateNotes = raw.string("privateNotes"),
    reference = raw.string("reference"),
    type = raw.string("type"),
    status = OrderStatus.from(raw.string("status")),
    courierName = raw.string("courierName"),
    deleted = raw.flag("deleted"),
    deletedAt = raw.string("deletedAt"),
    createdAt = raw.string("createdAt"),
    updatedAt = raw.string("updatedAt"),
    events = raw.array("trackingEvents").objects().map(::trackingFromJson),
    raw = raw,
)

fun collectionFromJson(raw: JsonObject) = CollectionItem(
    id = raw.string("id"),
    merchantId = raw.string("merchantId"),
    merchantName = raw.string("merchantName"),
    invoiceNumber = raw.string("invoiceNumber"),
    orderIds = raw.array("orderIds").mapNotNull { it.jsonPrimitive.contentOrNull },
    grossAmount = raw.number("grossAmount"),
    deliveryFees = raw.number("deliveryFees"),
    returnFees = raw.number("returnFees"),
    netAmount = raw.number("netAmount"),
    deliveredCount = raw.integer("deliveredCount"),
    returnedCount = raw.integer("returnedCount"),
    status = raw.string("status"),
    verificationCode = raw.string("verificationCode"),
    authorizedRecipient = raw.string("authorizedRecipient"),
    createdAt = raw.string("createdAt"),
    raw = raw,
)

fun isOrderInvoicedForCurrentShipment(order: OrderItem, invoices: List<CollectionItem>): Boolean {
    val shippedAt = runCatching { Instant.parse(order.raw.string("shippedAt")) }.getOrNull()
    return invoices.any { invoice ->
        if (order.id !in invoice.orderIds) {
            false
        } else if (invoice.status != "paid" || shippedAt == null) {
            true
        } else {
            val settledTimestamp = invoice.raw.string("paidAt")
                .ifEmpty { invoice.raw.string("verifiedAt") }
                .ifEmpty { invoice.createdAt }
            val settledAt = runCatching { Instant.parse(settledTimestamp) }.getOrNull()
            settledAt == null || !shippedAt.isAfter(settledAt)
        }
    }
}

fun noticeFromJson(raw: JsonObject) = NoticeItem(
    id = raw.string("id"),
    userId = raw.string("userId"),
    title = raw.string("title"),
    message = raw.string("message"),
    read = raw.flag("read"),
    createdAt = raw.string("createdAt"),
    orderId = raw.string("orderId").ifBlank { null },
    raw = raw,
)

fun JsonObject.withArray(key: String, values: List<JsonElement>): JsonObject = JsonObject(toMutableMap().apply {
    put(key, JsonArray(values))
})

fun JsonObject.withObject(key: String, value: JsonObject): JsonObject = JsonObject(toMutableMap().apply {
    put(key, value)
})

fun JsonObject.updated(vararg pairs: Pair<String, JsonElement>): JsonObject = JsonObject(toMutableMap().apply {
    pairs.forEach { (key, value) -> put(key, value) }
})

fun text(value: String): JsonPrimitive = JsonPrimitive(value)
fun number(value: Number): JsonPrimitive = JsonPrimitive(value)
fun bool(value: Boolean): JsonPrimitive = JsonPrimitive(value)
fun nullableNumber(value: Double?): JsonElement = value?.let(::JsonPrimitive) ?: JsonNull

fun newId(prefix: String): String = "$prefix-${UUID.randomUUID()}"

fun newTrackingEvent(status: OrderStatus, actor: String, note: String = "", kind: String = "status"): JsonObject {
    val now = Instant.now().toString()
    val location = when (status) {
        OrderStatus.DRAFT, OrderStatus.READY -> "مع المرسل"
        OrderStatus.SHIPPED -> "مع السائق"
        OrderStatus.PROCESSING -> "مركز الفرز"
        OrderStatus.DELIVERED -> "تم التسليم"
        OrderStatus.RETURNED -> "راجع للمرسل"
        OrderStatus.STUCK -> "بحاجة إلى متابعة"
        OrderStatus.DEFERRED -> "مؤجل"
    }
    return buildJsonObject {
        put("id", newId("tracking"))
        put("kind", kind)
        put("status", status.apiValue)
        put("title", if (kind == "note") "ملاحظة مضافة" else status.arabic)
        put("location", location)
        put("actor", actor)
        put("note", note)
        put("createdAt", now)
    }
}

fun normalizeParcelCode(value: String): String {
    val compact = value.filterNot(Char::isWhitespace).map { character ->
        character.digitToIntOrNull()?.let { ('0'.code + it).toChar() } ?: character
    }.joinToString("").uppercase(java.util.Locale.ROOT)
    return if (compact.isNotEmpty() && compact.all { it in '0'..'9' }) "ALX-$compact" else compact
}

fun isValidParcelCode(value: String): Boolean = Regex("^ALX-[0-9]{6,20}$").matches(normalizeParcelCode(value))

data class ParcelCodeBatch(
    val id: String,
    val label: String,
    val createdAt: String,
    val createdById: String,
    val startNumber: Long,
    val count: Int,
) {
    val codes: List<String> get() = (0 until count).map { "ALX-${(startNumber + it).toString().padStart(6, '0')}" }
}

fun parcelCodeBatchFromJson(raw: JsonObject): ParcelCodeBatch? {
    val start = raw["startNumber"]?.jsonPrimitive?.longOrNull ?: return null
    val count = raw.integer("count")
    if (raw.string("id").isBlank() || start < 0 || count !in 1..500 || start > Long.MAX_VALUE - count) return null
    return ParcelCodeBatch(raw.string("id"), raw.string("label"), raw.string("createdAt"), raw.string("createdById"), start, count)
}

data class ParcelCodeBatchResult(val snapshot: SessionSnapshot, val batchId: String)

fun buildNewOrder(user: UserItem, input: NewOrderInput, orderId: String): JsonObject {
    val now = Instant.now().toString()
    val zone = deliveryZoneFrom(input.governorate, input.city)
    val pricing = orderPricing(user.membership, zone, input.weight, input.lengthCm, input.widthCm, input.heightCm)
    val dimensions = listOf(input.lengthCm, input.widthCm, input.heightCm)
        .takeIf { it.any { value -> value != null && value > 0 } }
        ?.joinToString(" × ") { (it ?: 0).toString().removeSuffix(".0") + " سم" }
        ?: "غير محددة"
    return buildJsonObject {
        put("id", orderId)
        put("trackingNumber", "")
        put("merchantId", user.id)
        put("merchantName", user.name)
        put("merchantStore", user.store)
        put("recipientName", input.recipientName)
        put("recipientPhone", input.recipientPhone)
        put("governorate", input.governorate)
        put("deliveryZone", zone.apiValue)
        put("city", input.city)
        put("address", input.address)
        put("pickupAddress", input.pickupAddress.ifBlank { user.raw.string("address").ifBlank { user.store } })
        put("amount", input.amount)
        put("deliveryFee", pricing.deliveryFee)
        put("weightFee", pricing.weightFee)
        put("oversizeFee", pricing.oversizeFee)
        put("content", input.content)
        put("weight", input.weight)
        put("dimensions", dimensions)
        input.lengthCm?.let { put("lengthCm", it) }
        input.widthCm?.let { put("widthCm", it) }
        input.heightCm?.let { put("heightCm", it) }
        put("notes", input.instructions)
        put("privateNotes", input.privateNote)
        put("reference", input.reference)
        put("type", input.type.ifBlank { "طرد عادي" })
        put("status", "draft")
        put("courierName", "بانتظار تعيين المندوب")
        put("trackingEvents", buildJsonArray { add(newTrackingEvent(OrderStatus.DRAFT, user.name, "تم إنشاء الطرد وهو قيد الإنشاء.")) })
        put("createdAt", now)
        put("updatedAt", now)
        put("deleted", false)
    }
}

fun deliveryZoneFrom(governorate: String, city: String = ""): DeliveryZone {
    val value = "$governorate $city"
        .replace('أ', 'ا')
        .replace('إ', 'ا')
        .replace('آ', 'ا')
        .replace('ى', 'ي')
        .replace('ة', 'ه')
        .lowercase()
    return when {
        "القدس" in value -> DeliveryZone.JERUSALEM
        "الداخل" in value || "الخط الاخضر" in value || "48" in value || "٤٨" in value -> DeliveryZone.INTERIOR
        else -> DeliveryZone.WEST_BANK
    }
}

// BEGIN SHARED PRICING
// Generated from shared/pricing.json; run python3 scripts/sync_shared.py.
// Source SHA256: ca5887f6f4baa65560f91e765b5189054c786561ec61efab5a10f5bf397f3cee
fun baseDeliveryFee(membership: Membership, zone: DeliveryZone): Double = when (membership) {
    Membership.STANDARD -> when (zone) {
        DeliveryZone.WEST_BANK -> 25.0
        DeliveryZone.JERUSALEM -> 35.0
        DeliveryZone.INTERIOR -> 80.0
    }
    Membership.PREMIUM -> when (zone) {
        DeliveryZone.WEST_BANK -> 20.0
        DeliveryZone.JERUSALEM -> 30.0
        DeliveryZone.INTERIOR -> 65.0
    }
    Membership.DIAMOND -> when (zone) {
        DeliveryZone.WEST_BANK -> 15.0
        DeliveryZone.JERUSALEM -> 25.0
        DeliveryZone.INTERIOR -> 55.0
    }
}

fun returnDeliveryFee(membership: Membership, zone: DeliveryZone): Double = when (membership) {
    Membership.STANDARD -> when (zone) {
        DeliveryZone.WEST_BANK -> 20.0
        DeliveryZone.JERUSALEM -> 30.0
        DeliveryZone.INTERIOR -> 50.0
    }
    Membership.PREMIUM -> when (zone) {
        DeliveryZone.WEST_BANK -> 15.0
        DeliveryZone.JERUSALEM -> 25.0
        DeliveryZone.INTERIOR -> 40.0
    }
    Membership.DIAMOND -> when (zone) {
        DeliveryZone.WEST_BANK -> 10.0
        DeliveryZone.JERUSALEM -> 15.0
        DeliveryZone.INTERIOR -> 25.0
    }
}
// END SHARED PRICING

fun weightSurcharge(weight: String): Double = when (weight.trim()) {
    "5 - 10 كغم", "من 5 إلى 10 كغم" -> 5.0
    "10 - 20 كغم", "من 10 إلى 15 كغم", "من 10 إلى 20 كغم" -> 10.0
    "20 - 30 كغم", "من 15 إلى 20 كغم", "من 20 إلى 30 كغم" -> 15.0
    "أكثر من 30 كغم" -> 20.0
    else -> 0.0
}

fun oversizeSurcharge(vararg dimensions: Double?): Double {
    return dimensions.sumOf { dimension ->
        val value = dimension?.takeIf { it.isFinite() && it > 0 } ?: 0.0
        if (value <= 40.0) 0.0
        else (kotlin.math.ceil((value - 40.0) / 20.0) * 7.0).coerceAtMost(28.0)
    }
}

fun orderPricing(
    membership: Membership,
    zone: DeliveryZone,
    weight: String,
    lengthCm: Double?,
    widthCm: Double?,
    heightCm: Double?,
) = OrderPricing(
    baseFee = baseDeliveryFee(membership, zone),
    weightFee = weightSurcharge(weight),
    oversizeFee = oversizeSurcharge(lengthCm, widthCm, heightCm),
)

fun displayMoney(value: Double): String = if (value % 1.0 == 0.0) value.toInt().toString() else "%.2f".format(value)

fun displayDate(value: String): String = runCatching {
    DateTimeFormatter.ofPattern("yyyy/MM/dd  HH:mm")
        .withZone(ZoneId.systemDefault())
        .format(Instant.parse(value))
}.getOrDefault(value.take(10))
