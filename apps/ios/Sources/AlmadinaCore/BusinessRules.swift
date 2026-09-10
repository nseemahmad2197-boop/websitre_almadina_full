import Foundation

/// Deleting a list entry must not erase the settlement or allow a second invoice
/// for the same shipment. Only this account's list visibility is changed.
public func collectionVisibilityDatabase(_ snapshot: Snapshot, id: String, hidden: Bool) throws -> JObject {
    guard let invoice = snapshot.collections.first(where: { $0.id == id }), snapshot.canManageCollectionVisibility(invoice) else {
        throw DomainError.message("حذف الفاتورة متاح لصاحبها أو المسؤول فقط.")
    }
    guard !hidden || snapshot.canHideCollection(invoice) else {
        throw DomainError.message("لا يمكن حذف فاتورة مستحقة. يُسمح بالحذف بعد تسليم التحصيل فقط.")
    }
    guard !snapshot.purgedCollectionIDs.contains(id) else { throw DomainError.message("حُذفت الفاتورة نهائيًا من سلة محذوفاتك.") }
    var ids = snapshot.hiddenCollectionIDs
    if hidden { ids.insert(id) } else { ids.remove(id) }
    var preferences = snapshot.database["preferences"]?.object ?? [:]
    var own = preferences[snapshot.userId]?.object ?? [:]
    own["hiddenCollectionIds"] = .array(ids.sorted().map(JSONValue.string))
    preferences[snapshot.userId] = .object(own)
    return snapshot.database.setting("preferences", .object(preferences))
}

/// The server validates again against this revision and applies the entire selection atomically.
public func trashPurgeRequest(_ snapshot: Snapshot, orderIDs: Set<String>, invoiceIDs: Set<String>) throws -> JObject {
    guard !orderIDs.isEmpty || !invoiceIDs.isEmpty else { throw DomainError.message("اختر العناصر المطلوب حذفها من السلة.") }
    let allowedOrders = Set(snapshot.orders.filter { snapshot.canPurge($0) }.map(\.id))
    guard orderIDs.isSubset(of: allowedOrders), invoiceIDs.isSubset(of: snapshot.trashedCollectionIDs) else {
        throw DomainError.message("تغيّرت المحذوفات. راجع التحديد؛ لا يمكن حذف فاتورة مستحقة أو طرد مرتبط بها.")
    }
    return ["revision": .number(Double(snapshot.revision)), "orderIds": .array(orderIDs.sorted().map(JSONValue.string)), "invoiceIds": .array(invoiceIDs.sorted().map(JSONValue.string))]
}

public struct Pricing: Equatable, Sendable {
    public var base: Double, weight: Double, size: Double
    public var total: Double { base + weight + size }
    public static let weights = ["أقل من 5 كغم", "5 - 10 كغم", "10 - 20 كغم", "20 - 30 كغم", "أكثر من 30 كغم"]
    // BEGIN SHARED PRICING
    // Generated from shared/pricing.json; run python3 scripts/sync_shared.py.
    // Source SHA256: ca5887f6f4baa65560f91e765b5189054c786561ec61efab5a10f5bf397f3cee
    public static func baseFee(_ membership: Membership, _ zone: Zone) -> Double {
        let amounts: [Membership: [Double]] = [.standard: [25,35,80], .premium: [20,30,65], .diamond: [15,25,55]]
        return amounts[membership]![zone == .westBank ? 0 : zone == .jerusalem ? 1 : 2]
    }
    public static func returnFee(_ membership: Membership, _ zone: Zone) -> Double {
        let amounts: [Membership: [Double]] = [.standard: [20,30,50], .premium: [15,25,40], .diamond: [10,15,25]]
        return amounts[membership]![zone == .westBank ? 0 : zone == .jerusalem ? 1 : 2]
    }
    // END SHARED PRICING
    public static func sizeFee(_ dimensions: [Double?]) -> Double {
        dimensions.reduce(0) { sum, dimension in
            guard let d = dimension, d.isFinite, d > 40 else { return sum }
            return sum + min(28, ceil((d - 40) / 20) * 7)
        }
    }
    public static func calculate(_ membership: Membership, _ zone: Zone, _ weight: String, _ dimensions: [Double?]) -> Pricing {
        let extra: Double
        switch weight {
        case "5 - 10 كغم", "من 5 إلى 10 كغم": extra = 5
        case "10 - 20 كغم", "من 10 إلى 15 كغم", "من 10 إلى 20 كغم": extra = 10
        case "20 - 30 كغم", "من 15 إلى 20 كغم", "من 20 إلى 30 كغم": extra = 15
        case "أكثر من 30 كغم": extra = 20
        default: extra = 0
        }
        return Pricing(base: baseFee(membership, zone), weight: extra, size: sizeFee(dimensions))
    }
}

public struct OrderDraft: Codable, Equatable {
    public var id = "order-ios-" + UUID().uuidString
    public var recipientName = "", recipientPhone = "", city = "", address = "", amount = "", content = ""
    public var zone = Zone.westBank
    public var governorate = ""
    public var type = "طرد عادي", weight = Pricing.weights[0]
    public var length = "", width = "", height = "", instructions = "", privateNote = "", reference = "", preferredDate = ""
    public static let types = ["طرد عادي", "طرد تبديل", "تجربة أو شراء", "رجوع"]
    public init() {}
    public init(order: Record) {
        self.init(); id = order.id
        recipientName = order.s("recipientName"); recipientPhone = order.s("recipientPhone")
        city = order.s("city"); address = order.s("address"); amount = String(order.n("amount"))
        content = order.s("content"); zone = Zone.from(order.s("deliveryZone").isEmpty ? order.s("governorate") : order.s("deliveryZone"))
        governorate = order.s("governorate")
        type = order.s("type"); weight = order.s("weight")
        length = order.n("lengthCm") > 0 ? String(order.n("lengthCm")) : ""
        width = order.n("widthCm") > 0 ? String(order.n("widthCm")) : ""
        height = order.n("heightCm") > 0 ? String(order.n("heightCm")) : ""
        instructions = order.s("notes"); privateNote = order.s("privateNotes"); reference = order.s("reference")
        preferredDate = order.s("preferredDeliveryDate")
    }
    public var dimensions: [Double?] { [decimalValue(length), decimalValue(width), decimalValue(height)] }
    public func pricing(_ user: Record) -> Pricing { Pricing.calculate(user.membership, zone, weight, dimensions) }
    /// A display-only value; the collected amount sent to the server is unchanged.
    public func contentValue(_ user: Record) -> Double? {
        guard let collected = decimalValue(amount), collected <= 1_000_000 else { return nil }
        return max(0, collected - pricing(user).total)
    }
    public func validate() throws {
        guard recipientName.trimmingCharacters(in: .whitespaces).count >= 2, validPhone(recipientPhone), !city.trimmingCharacters(in: .whitespaces).isEmpty, !address.trimmingCharacters(in: .whitespaces).isEmpty, let value = decimalValue(amount), value <= 1_000_000 else {
            throw DomainError.message("أكمل اسم المستلم ورقم جوال صحيحًا يبدأ بـ 05 والمدينة والعنوان وسعر الطرد.")
        }
        for value in [length, width, height] where !value.isEmpty {
            guard let n = decimalValue(value), n > 0, n <= 10000 else { throw DomainError.message("أدخل قياسات صحيحة وموجبة بالسنتيمتر.") }
        }
        guard DeliveryLocations.resolve(governorate: governorate, city: city, zone: zone) != nil else { throw DomainError.message("اختر مدينة ومحافظة من نطاق التوصيل المحدد. الأسماء المتكررة تحتاج تحديد المحافظة.") }
    }
    public func fields(user: Record) throws -> JObject {
        try validate()
        let p = pricing(user)
        let description = dimensions.contains { $0 != nil } ? dimensions.map { String(format: "%g سم", $0 ?? 0) }.joined(separator: " × ") : "غير محددة"
        var raw: JObject = ["recipientName": .string(recipientName.trimmingCharacters(in: .whitespaces)), "recipientPhone": .string(normalizedDigits(recipientPhone)), "governorate": .string(zone.title), "deliveryZone": .string(zone.rawValue), "city": .string(city), "address": .string(address), "amount": .number(decimalValue(amount)!), "deliveryFee": .number(p.total), "weightFee": .number(p.weight), "oversizeFee": .number(p.size), "content": .string(content), "type": .string(type), "weight": .string(weight), "dimensions": .string(description), "notes": .string(instructions), "privateNotes": .string(privateNote), "reference": .string(reference), "preferredDeliveryDate": .string(preferredDate)]
        for (key, n) in zip(["lengthCm", "widthCm", "heightCm"], dimensions) { raw[key] = n.map(JSONValue.number) ?? .null }
        raw["governorate"] = .string(DeliveryLocations.resolve(governorate: governorate, city: city, zone: zone)!.name)
        return raw
    }
    public func newOrder(user: Record) throws -> JObject {
        var raw = try fields(user: user)
        raw.merge(["id": .string(id), "trackingNumber": "", "merchantId": .string(user.id), "merchantName": .string(user.s("name")), "merchantStore": .string(user.s("store")), "pickupAddress": .string(user.s("address").isEmpty ? user.s("store") : user.s("address")), "status": "draft", "courierName": "بانتظار تعيين المندوب", "trackingEvents": .array([.object(trackingEvent(.draft, user.s("name"), "تم إنشاء الطرد وهو قيد الإنشاء."))]), "createdAt": .string(isoNow()), "updatedAt": .string(isoNow()), "deleted": false]) { _, new in new }
        return raw
    }
}

public func trackingEvent(_ status: ParcelStatus, _ actor: String, _ note: String, kind: String = "status") -> JObject {
    let places: [ParcelStatus: String] = [.draft: "مع المرسل", .ready: "مع المرسل", .shipped: "مع السائق", .processing: "مركز الفرز", .delivered: "تم التسليم", .returned: "راجع للمرسل", .stuck: "بحاجة إلى متابعة", .deferred: "مؤجل"]
    return ["id": .string("tracking-ios-" + UUID().uuidString), "kind": .string(kind), "status": .string(status.rawValue), "title": .string(kind == "note" ? "ملاحظة مضافة" : status.title), "location": .string(places[status] ?? ""), "actor": .string(actor), "note": .string(String(note.prefix(500))), "createdAt": .string(isoNow())]
}
public func alreadyInvoiced(_ order: Record, invoices: [Record]) -> Bool {
    invoices.contains { invoice in
        guard invoice.orderIDs.contains(order.id) else { return false }
        guard invoice.s("status") == "paid", let shipped = parseDate(order.s("shippedAt")) else { return true }
        let timestamp = ["paidAt", "verifiedAt", "createdAt"].map { invoice.s($0) }.first { !$0.isEmpty } ?? ""
        guard let settled = parseDate(timestamp) else { return true }; return shipped <= settled
    }
}
public func collectionCandidates(_ snapshot: Snapshot) -> [Record] {
    snapshot.orders.filter { $0.s("merchantId") == snapshot.userId && !$0.b("deleted") && ($0.status == .delivered || $0.status == .returned) && !alreadyInvoiced($0, invoices: snapshot.collections) }
}
public func collectionDatabase(_ snapshot: Snapshot, selectedIDs: Set<String>, id: String, code: String) throws -> JObject {
    guard let user = snapshot.currentUser, user.role == .merchant else { throw DomainError.message("إنشاء الفاتورة متاح للمستخدم.") }
    let selected = collectionCandidates(snapshot).filter { selectedIDs.contains($0.id) }
    guard !selected.isEmpty, selected.count == selectedIDs.count else { throw DomainError.message("تغيّرت أهلية بعض الطرود. راجع التحديد وحاول مجددًا.") }
    let delivered = selected.filter { $0.status == .delivered }, returned = selected.filter { $0.status == .returned }
    let gross = delivered.reduce(0) { $0 + $1.n("amount") }, delivery = delivered.reduce(0) { $0 + $1.n("deliveryFee") }
    let details = returned.map { order -> JObject in
        let zone = Zone.from(order.s("deliveryZone").isEmpty ? order.s("governorate") : order.s("deliveryZone"))
        return ["orderId": .string(order.id), "fee": .number(Pricing.returnFee(user.membership, zone))]
    }
    let returns = details.reduce(0) { $0 + $1.number("fee") }
    let next = max(618000, Int(snapshot.database.number("nextCollection")))
    let raw: JObject = ["id": .string(id), "merchantId": .string(user.id), "merchantName": .string(user.s("name")), "invoiceNumber": .string("#\(next)"), "orderIds": .array(selected.map { .string($0.id) }), "grossAmount": .number(gross), "deliveryFees": .number(delivery), "returnFees": .number(returns), "returnFeeDetails": .array(details.map(JSONValue.object)), "netAmount": .number(gross - delivery - returns), "deliveredCount": .number(Double(delivered.count)), "returnedCount": .number(Double(returned.count)), "status": "pending", "verificationCode": .string(code), "authorizedRecipient": "", "createdAt": .string(isoNow()), "updatedAt": .string(isoNow()), "scheduledAt": .string(ISO8601DateFormatter().string(from: Date().addingTimeInterval(86400)))]
    return snapshot.database.setting("collections", .array([.object(raw)] + snapshot.database.array("collections"))).setting("nextCollection", .number(Double(next + 1)))
}
public func batchCodes(_ batch: Record) throws -> [String] {
    let start = batch.n("startNumber"), count = batch.n("count")
    guard start >= 0, start.rounded() == start, count.rounded() == count, (1...500).contains(count), start + count < 9007199254740991 else { throw DomainError.message("بيانات دفعة الأكواد غير صالحة.") }
    return (0..<Int(count)).map { "ALX-" + String(format: "%06lld", Int64(start) + Int64($0)) }
}
public func trashExpired(_ order: Record, now: Date = Date()) -> Bool {
    guard order.b("deleted"), let date = parseDate(order.s("deletedAt")) else { return false }
    return now.timeIntervalSince(date) >= 30 * 86400
}
public func applyingTrashRetention(_ database: JObject, now: Date = Date()) -> JObject {
    let timestamp = ISO8601DateFormatter().string(from: now)
    let values = database.records("orders").compactMap { order -> JSONValue? in
        guard order.b("deleted") else { return .object(order.raw) }
        if trashExpired(order, now: now) { return nil }
        if parseDate(order.s("deletedAt")) == nil { return .object(order.raw.setting("deletedAt", .string(timestamp))) }
        return .object(order.raw)
    }
    return database.setting("orders", .array(values))
}
