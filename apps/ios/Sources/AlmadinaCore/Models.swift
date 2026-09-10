import Foundation

/// Preserve unrecognized server fields when editing a snapshot. Never rebuild a
/// database from only the fields shown in a screen.
public enum JSONValue: Codable, Equatable, Sendable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    public var string: String { if case .string(let v) = self { return v }; return "" }
    public var number: Double { if case .number(let v) = self { return v }; return 0 }
    public var bool: Bool { if case .bool(let v) = self { return v }; return false }
    public var object: JObject { if case .object(let v) = self { return v }; return [:] }
    public var array: [JSONValue] { if case .array(let v) = self { return v }; return [] }
}
extension JSONValue: ExpressibleByStringLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
}
extension JSONValue: ExpressibleByIntegerLiteral {
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
}
extension JSONValue: ExpressibleByBooleanLiteral {
    public init(booleanLiteral value: Bool) { self = .bool(value) }
}
public typealias JObject = [String: JSONValue]

/// A deletion request is an acknowledgement, not confirmation of account
/// deletion. Only the dedicated delete endpoint may clear the local account.
public struct AccountDeletionState: Equatable, Sendable {
    public let request: Record?
    public let eligible: Bool
    public let activeOrderCount: Int
    public let unsettledCollectionCount: Int
    public let unsettledOrderCount: Int
    public let reviewTimeline: String
    public let retentionNotice: String

    public init(_ payload: JObject) throws {
        guard case .object(let eligibility)? = payload["eligibility"],
              case .bool(let eligible)? = eligibility["eligible"],
              case .object(let policy)? = payload["policy"],
              !policy.text("reviewTimeline").isEmpty, !policy.text("retentionNotice").isEmpty else {
            throw DomainError.message("لم تصل تفاصيل طلب الحذف كاملة. حدّث الحالة قبل المتابعة.")
        }
        switch payload["request"] {
        case .null?: request = nil
        case .object(let raw)?:
            guard !raw.text("id").isEmpty,
                  ["pending", "processing", "completed"].contains(raw.text("status")),
                  !raw.text("createdAt").isEmpty, !raw.text("reviewDueAt").isEmpty else {
                throw DomainError.message("لم يصل تأكيد طلب الحذف كاملًا. حدّث الحالة قبل إعادة الإرسال.")
            }
            request = Record(raw)
        default: throw DomainError.message("لم تصل حالة طلب الحذف. أعد تحميلها.")
        }
        func count(_ key: String) throws -> Int {
            guard case .number(let value)? = eligibility[key], value.isFinite, value >= 0,
                  value.rounded() == value, value < Double(Int.max) else {
                throw DomainError.message("لم تصل بيانات التسوية كاملة. حدّث حالة الطلب قبل الحذف.")
            }
            return Int(value)
        }
        let active = try count("activeOrderCount")
        let collections = try count("unsettledCollectionCount")
        let orders = try count("unsettledOrderCount")
        activeOrderCount = active
        unsettledCollectionCount = collections
        unsettledOrderCount = orders
        self.eligible = eligible && active == 0 && collections == 0 && orders == 0
        reviewTimeline = policy.text("reviewTimeline")
        retentionNotice = policy.text("retentionNotice")
    }

    public var requestStatusTitle: String {
        switch request?.s("status") {
        case "pending": return "تم استلام الطلب"
        case "processing": return "قيد المعالجة"
        case "completed": return "اكتمل حذف الحساب"
        default: return "لا يوجد طلب مسجل"
        }
    }
}

public extension Dictionary where Key == String, Value == JSONValue {
    func text(_ key: String) -> String { self[key]?.string ?? "" }
    func number(_ key: String) -> Double { self[key]?.number ?? 0 }
    func flag(_ key: String) -> Bool { self[key]?.bool ?? false }
    func array(_ key: String) -> [JSONValue] { self[key]?.array ?? [] }
    func records(_ key: String) -> [Record] { array(key).compactMap { if case .object(let o) = $0 { return Record(o) }; return nil } }
    func setting(_ key: String, _ value: JSONValue) -> JObject { var d = self; d[key] = value; return d }
    func replacing(_ key: String, id: String, update: (JObject) throws -> JObject) rethrows -> JObject {
        var result = self
        result[key] = .array(try array(key).map { item in
            guard case .object(let raw) = item, raw.text("id") == id else { return item }
            return .object(try update(raw))
        })
        return result
    }
}

public struct Record: Identifiable, Codable, Equatable, Sendable {
    public var raw: JObject
    public init(_ raw: JObject) { self.raw = raw }
    public var id: String { raw.text("id") }
    public func s(_ key: String) -> String { raw.text(key) }
    public func n(_ key: String) -> Double { raw.number(key) }
    public func b(_ key: String) -> Bool { raw.flag(key) }
    public var role: Role? { Role(rawValue: s("role")) }
    public var membership: Membership { Membership(rawValue: s("membership")) ?? .standard }
    public var status: ParcelStatus? { ParcelStatus(rawValue: s("status")) }
    public var codeLabel: String { s("trackingNumber").isEmpty ? "بانتظار إضافة كود QR" : s("trackingNumber") }
    public var events: [Record] { raw.records("trackingEvents").sorted { $0.s("createdAt") > $1.s("createdAt") } }
    public var orderIDs: [String] { raw.array("orderIds").map(\.string) }
}

public struct Snapshot: Codable, Equatable, Sendable {
    public var database: JObject { didSet { records = SnapshotRecords(database) } }
    public var revision: Int
    public var userId: String
    private var records: SnapshotRecords
    public init(database: JObject, revision: Int, userId: String) {
        self.database = database; self.revision = revision; self.userId = userId
        records = SnapshotRecords(database)
    }
    private enum CodingKeys: String, CodingKey { case database, revision, userId }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(database: try values.decode(JObject.self, forKey: .database), revision: try values.decode(Int.self, forKey: .revision), userId: try values.decode(String.self, forKey: .userId))
    }
    public init(payload: JObject) throws {
        guard let databaseValue = payload["database"], case .object(let db) = databaseValue,
              let revisionValue = payload["revision"], case .number(let rev) = revisionValue, rev >= 0, rev.rounded() == rev,
              rev < Double(Int.max), !payload.text("userId").isEmpty else {
            throw DomainError.message("استجابة الخادم غير مكتملة. حاول مجددًا.")
        }
        for name in ["users", "orders", "collections", "recipients", "notices"] {
            guard case .array? = db[name] else {
                throw DomainError.message("بيانات الحساب غير مكتملة. حدّثها قبل إجراء أي تعديل.")
            }
        }
        self.init(database: db, revision: Int(rev), userId: payload.text("userId"))
        guard currentUser?.role != nil else { throw DomainError.message("تعذّر التحقق من صلاحية الحساب.") }
    }
    public var users: [Record] { records.users }
    public var currentUser: Record? { users.first { $0.id == userId } }
    public var orders: [Record] { records.orders }
    public var collections: [Record] { records.collections }
    public var hiddenCollectionIDs: Set<String> {
        let requested = Set(database["preferences"]?.object[userId]?.object.array("hiddenCollectionIds").map(\.string) ?? []).union(purgedCollectionIDs)
        return Set(collections.filter { requested.contains($0.id) && canHideCollection($0) }.map(\.id))
    }
    public var purgedCollectionIDs: Set<String> {
        let requested = Set(database["preferences"]?.object[userId]?.object.array("purgedCollectionIds").map(\.string) ?? [])
        return Set(collections.filter { requested.contains($0.id) && canHideCollection($0) }.map(\.id))
    }
    public var trashedCollectionIDs: Set<String> { hiddenCollectionIDs.subtracting(purgedCollectionIDs) }
    public var visibleCollections: [Record] {
        let hidden = hiddenCollectionIDs
        return collections.filter { !hidden.contains($0.id) }
    }
    public func canManageCollectionVisibility(_ invoice: Record) -> Bool {
        currentUser?.role == .admin || (currentUser?.role == .merchant && invoice.s("merchantId") == userId)
    }
    public func canHideCollection(_ invoice: Record) -> Bool {
        invoice.s("status") == "paid" && canManageCollectionVisibility(invoice)
    }
    public var notices: [Record] { records.notices.filter { $0.s("userId") == userId } }
    public var batches: [Record] { records.batches }
    public var claimedCodes: Set<String> { Set(database["parcelCodeClaims"]?.object.keys.map { $0 } ?? []) }
    public func canEdit(_ order: Record) -> Bool { currentUser?.role == .admin && !order.b("deleted") }
    public func canAssign(_ order: Record) -> Bool {
        !order.b("deleted") && order.s("trackingNumber").isEmpty &&
        (currentUser?.role == .admin || (currentUser?.role == .merchant && order.s("merchantId") == userId))
    }
    public func canTrash(_ order: Record) -> Bool {
        currentUser?.role == .admin || (currentUser?.role == .merchant && order.s("merchantId") == userId)
    }
    public func canPurge(_ order: Record) -> Bool {
        order.b("deleted") && canTrash(order) && !collections.contains { $0.s("status") != "paid" && $0.orderIDs.contains(order.id) }
    }
}

/// Build ordered lists once per database change, not once per row or keystroke.
/// These derived values are deliberately excluded from the wire/cache format.
private struct SnapshotRecords: Equatable, Sendable {
    let users, orders, collections, notices, batches: [Record]
    init(_ database: JObject) {
        users = database.records("users")
        func sorted(_ key: String) -> [Record] {
            database.records(key).sorted {
                let lhs = $0.s("createdAt"), rhs = $1.s("createdAt")
                return lhs == rhs ? $0.id < $1.id : lhs > rhs
            }
        }
        orders = sorted("orders"); collections = sorted("collections")
        notices = sorted("notices"); batches = sorted("parcelCodeBatches")
    }
}

public enum Role: String, Codable, CaseIterable, Hashable, Sendable {
    case admin, merchant, courier
    public var title: String { switch self { case .admin: return "المسؤول"; case .merchant: return "المستخدم"; case .courier: return "المندوب / الموظف" } }
}
public enum Membership: String, Codable, CaseIterable, Hashable, Sendable {
    case standard, premium, diamond
    public var title: String { switch self { case .standard: return "عادي"; case .premium: return "بريميوم"; case .diamond: return "ماسي" } }
}
public enum Zone: String, Codable, CaseIterable, Hashable, Sendable {
    case westBank = "west-bank", jerusalem, interior
    public var title: String { switch self { case .westBank: return "الضفة الغربية"; case .jerusalem: return "القدس"; case .interior: return "الداخل" } }
    public static func from(_ text: String) -> Zone {
        if let zone = Zone(rawValue: text) { return zone }
        let value = text.replacingOccurrences(of: "أ", with: "ا").replacingOccurrences(of: "إ", with: "ا")
        if value.contains("القدس") { return .jerusalem }
        if value.contains("الداخل") || value.contains("48") || value.contains("٤٨") || value.contains("الخط الاخضر") { return .interior }
        return .westBank
    }
}
public enum ParcelStatus: String, Codable, CaseIterable, Hashable, Sendable {
    case draft, ready, shipped, processing, delivered, stuck, returned, deferred
    public var title: String {
        switch self { case .draft: return "قيد الإنشاء"; case .ready: return "جاهز للإرسال"; case .shipped: return "مشحون"; case .processing: return "تمت المعالجة"; case .delivered: return "واصل"; case .stuck: return "عالق"; case .returned: return "راجع"; case .deferred: return "مؤجل" }
    }
    public var symbol: String {
        switch self { case .draft: return "square.and.pencil"; case .ready: return "shippingbox"; case .shipped: return "car.fill"; case .processing: return "list.bullet.rectangle"; case .delivered: return "checkmark.circle"; case .stuck: return "exclamationmark.circle"; case .returned: return "arrow.uturn.backward"; case .deferred: return "clock" }
    }
}
public enum DomainError: LocalizedError {
    case message(String)
    public var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}
public func isoNow() -> String { ISO8601DateFormatter().string(from: Date()) }
public func parseDate(_ text: String) -> Date? {
    let fractional = ISO8601DateFormatter(); fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: text) ?? ISO8601DateFormatter().date(from: text)
}
public func normalizedDigits(_ text: String) -> String {
    String(text.map { char in
        if let n = char.wholeNumberValue, (0...9).contains(n) { return Character(String(n)) }
        return char
    })
}
public func normalizedCode(_ value: String) -> String {
    let compact = normalizedDigits(value).filter { !$0.isWhitespace }.uppercased()
    return !compact.isEmpty && compact.allSatisfy({ $0.isASCII && $0.isNumber }) ? "ALX-" + compact : compact
}
public func validCode(_ text: String) -> Bool { normalizedCode(text).range(of: "^ALX-[0-9]{6,20}$", options: .regularExpression) != nil }
public func decimalValue(_ text: String) -> Double? {
    let clean = normalizedDigits(text).trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "٫", with: ".").replacingOccurrences(of: ",", with: ".")
    guard let value = Double(clean), value.isFinite, value >= 0 else { return nil }; return value
}
public func validPhone(_ text: String) -> Bool { normalizedDigits(text).range(of: "^05[0-9]{8}$", options: .regularExpression) != nil }
public func validEmail(_ text: String) -> Bool { text.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) != nil }
public func validPassword(_ text: String) -> Bool {
    text.count >= 8 && text.contains(where: \.isLetter) && text.contains(where: \.isNumber) && text.contains { !$0.isLetter && !$0.isNumber && !$0.isWhitespace }
}
public func money(_ value: Double) -> String { String(format: abs(value).rounded() == abs(value) ? "%.0f ₪" : "%.2f ₪", abs(value)) }
public func dueTitle(_ amount: Double) -> String { amount < 0 ? "مستحق للشركة" : "مستحق للمستخدم" }
public func invoiceTitle(_ status: String) -> String { status == "paid" ? "تم التسليم" : status == "ready" ? "جاهزة للتسليم" : "قيد التجهيز" }

/// Resolve only API paths under the configured HTTPS origin and directory.
public enum APIEndpoint {
    public static func resolve(base: URL, path: String) -> URL? {
        guard let baseParts = URLComponents(url: base, resolvingAgainstBaseURL: true),
              baseParts.scheme?.lowercased() == "https", let host = baseParts.host, !host.isEmpty,
              baseParts.user == nil, baseParts.password == nil, baseParts.query == nil, baseParts.fragment == nil,
              baseParts.path.hasSuffix("/"), !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"),
              !path.contains("://"),
              let relativePath = path.components(separatedBy: "?").first?.removingPercentEncoding,
              !relativePath.contains("\\"), !relativePath.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }),
              let url = URL(string: path, relativeTo: base)?.absoluteURL,
              let result = URLComponents(url: url, resolvingAgainstBaseURL: true),
              result.scheme?.lowercased() == "https", result.host?.lowercased() == host.lowercased(),
              (result.port ?? 443) == (baseParts.port ?? 443), result.user == nil, result.password == nil,
              result.fragment == nil, result.path.hasPrefix(baseParts.path) else { return nil }
        return url
    }
}
