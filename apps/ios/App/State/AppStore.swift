import SwiftUI
import LocalAuthentication
import Security

struct AvailableAccount: Codable, Identifiable, Equatable {
    var id: String, name: String, email: String, store: String
}
struct AppMessage: Identifiable { let id = UUID(); var text: String }
struct PendingBatch: Codable { var owner: String, requestID: String, count: Int, label: String }

@MainActor final class AppStore: ObservableObject {
    static let shared = AppStore()
    let api = APIClient()
    @Published var snapshot: Snapshot?
    @Published var ready = false
    @Published var busy = false
    @Published var offline = false
    @Published var locked = false
    @Published var message: AppMessage?
    @Published var accounts: [AvailableAccount] = []
    @Published var biometricEnabled = false
    @Published var biometricUserID: String?
    @Published var theme = UserDefaults.standard.string(forKey: "theme") ?? "system"
    @Published var sounds = UserDefaults.standard.object(forKey: "sounds") as? Bool ?? true
    @Published var notifications = UserDefaults.standard.bool(forKey: "notifications")
    @Published var notificationPermissionGranted = false
    @Published var requestingNotificationPermission = false
    @Published var selectedOrderID: String?
    private var generation = UUID()
    private var refreshing = false
    private var poll: Task<Void, Never>?

    var user: Record? { snapshot?.currentUser }
    var role: Role? { user?.role }
    var colorScheme: ColorScheme? { theme == "dark" ? .dark : theme == "light" ? .light : nil }
    init() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-test-no-network") {
            theme = "light"
            let adminFixture = ProcessInfo.processInfo.arguments.contains("--ui-test-admin")
            if adminFixture || ProcessInfo.processInfo.arguments.contains("--ui-test-merchant") {
                snapshot = Snapshot(database: [
                    "users": .array([.object(["id": "ui-merchant", "role": .string(adminFixture ? "admin" : "merchant"), "name": "حساب اختبار", "store": "متجر الاختبار", "membership": "standard"])]),
                    "orders": .array([]), "collections": .array([]), "notices": .array([]),
                    "recipients": .array([]), "preferences": .object([:]), "nextOrder": 20200000, "nextCollection": 618000
                ], revision: 0, userId: "ui-merchant")
                if ProcessInfo.processInfo.arguments.contains("--ui-test-invoices") {
                    // Isolated UI records: the no-network gate above and APIClient
                    // prevent the gesture tests from touching customer invoices.
                    let invoices: [JSONValue] = [("ui-paid", "paid", 75), ("ui-paid-company", "paid", -15), ("ui-due", "pending", 75)].map { id, status, amount in
                        .object(["id": .string(id), "invoiceNumber": .string(id), "merchantId": "ui-merchant", "merchantName": "متجر الاختبار", "status": .string(status), "netAmount": .number(Double(amount)), "orderIds": .array([]), "createdAt": "2026-09-07T00:00:00Z"])
                    }
                    snapshot?.database["collections"] = .array(invoices)
                }
            }
            return
        }
        #endif
        snapshot = SnapshotCache.read()
        if let data = try? KeychainStore.read("available-accounts"), let values = try? JSONDecoder().decode([AvailableAccount].self, from: data) { accounts = values }
        biometricEnabled = (try? KeychainStore.read("biometric-enabled")) == Data([1])
        if let data = try? KeychainStore.read("biometric-owner") { biometricUserID = String(data: data, encoding: .utf8) }
        locked = snapshot != nil && biometricEnabled
    }
    func report(_ text: String) { message = AppMessage(text: text) }
    func generationForNewAccount() { generation = UUID() }
    func accept(_ payload: JObject, replacingAccount: Bool = false) throws {
        // Polling the same snapshot must not republish every screen, re-sort all
        // rows or re-encrypt the entire cache while the user types or scrolls.
        if !replacingAccount, let current = snapshot,
           current.userId == payload.text("userId"),
           Double(current.revision) == payload.number("revision"),
           payload["database"] == .object(current.database) {
            if offline { offline = false }; if !ready { ready = true }
            return
        }
        let next = try Snapshot(payload: payload)
        if !replacingAccount, let current = snapshot {
            guard current.userId == next.userId else { throw CancellationError() }
            guard next.revision >= current.revision else { return }
        }
        let previous = snapshot
        snapshot = next; offline = false; ready = true
        SnapshotCache.enqueueSave(next)
        if let user = next.currentUser {
            let account = AvailableAccount(id: user.id, name: user.s("name"), email: user.s("email"), store: user.s("store"))
            let updated = Array(([account] + accounts.filter { $0.id != account.id && $0.email.lowercased() != account.email.lowercased() }).prefix(6))
            if accounts != updated { accounts = updated; saveAccounts() }
        }
        NotificationService.shared.deliverNew(owner: next.userId, previous: previous?.userId == next.userId ? previous?.notices : nil, current: next.notices, enabled: notifications, sounds: sounds)
    }
    func saveAccounts() { try? KeychainStore.save(JSONEncoder().encode(accounts), key: "available-accounts") }
    func forgetAccount(_ account: AvailableAccount) { accounts.removeAll { $0.id == account.id }; saveAccounts() }
    func restore() async { await refresh(); ready = true }
    @discardableResult func refresh() async -> Bool {
        guard !refreshing, !busy else { return false }
        refreshing = true; defer { refreshing = false }
        let currentGeneration = generation
        do {
            let payload = try await api.request("session")
            guard generation == currentGeneration else { return false }
            try accept(payload)
            return true
        } catch {
            guard generation == currentGeneration else { return false }
            if let error = error as? APIError, error.status == 401 { clearSession() }
            else if !(error is CancellationError) { offline = true }
            return false
        }
    }
    func beginPolling() {
        poll?.cancel()
        poll = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                guard !Task.isCancelled, let self else { return }
                if self.snapshot != nil, !self.locked { await self.refresh() }
            }
        }
    }
    func background() { poll?.cancel(); if snapshot != nil && biometricEnabled { locked = true }; if snapshot != nil { NotificationService.shared.scheduleRefresh() } }
    func unlock() async {
        do { _ = try await LocalIdentity.authenticate(reason: "افتح تطبيق المدينة إكسبرس بأمان", biometricsOnly: false); locked = false }
        catch { report("لم يكتمل فتح التطبيق. يمكنك المحاولة أو تسجيل الخروج.") }
    }
    /// Serializes UI mutations. Epoch checks prevent an old callback from
    /// writing into another account after logout or account switching.
    @discardableResult func perform(_ action: () async throws -> Void) async -> Bool {
        guard !busy else { return false }
        busy = true; defer { busy = false }
        do { try await action(); return true }
        catch is CancellationError { return false }
        catch {
            if let apiError = error as? APIError {
                if apiError.status == 409, apiError.payload["database"] != nil { try? accept(apiError.payload) }
                if apiError.status == 401, snapshot != nil { clearSession() }
                if apiError.status == 409, apiError.payload["database"] != nil { report((apiError.errorDescription ?? "") + " راجع البيانات المحدّثة وأعد المحاولة."); return false }
            }
            report(error.localizedDescription); return false
        }
    }
    func login(email: String, password: String) async {
        await perform {
            generation = UUID(); api.clearSession(); snapshot = nil; SnapshotCache.clear()
            let payload = try await api.request("login", method: "POST", body: ["email": .string(email.trimmingCharacters(in: .whitespaces).lowercased()), "password": .string(password)])
            try accept(payload, replacingAccount: true); locked = false
        }
    }
    func biometricLogin() async {
        await perform {
            let context = try await LocalIdentity.authenticate(reason: "الدخول إلى حسابك في المدينة إكسبرس")
            guard let data = try KeychainStore.read("biometric-credential", context: context) else { disableBiometrics(); throw DomainError.message("أعد تفعيل الدخول بالبصمة من الإعدادات.") }
            let credential = try JSONDecoder().decode(BiometricCredential.self, from: data)
            generation = UUID(); api.clearSession(); snapshot = nil; SnapshotCache.clear()
            do {
                let payload = try await api.request("login", method: "POST", body: ["email": .string(credential.email), "password": .string(credential.password)])
                try accept(payload, replacingAccount: true); locked = false
            } catch let error as APIError {
                if error.status == 401 { disableBiometrics() }; throw error
            }
        }
    }
    func enableBiometrics(password: String) async -> Bool {
        await perform {
            guard let user else { throw DomainError.message("سجّل الدخول أولًا.") }
            let payload = try await api.request("login", method: "POST", body: ["email": .string(user.s("email")), "password": .string(password)])
            let verified = try Snapshot(payload: payload)
            guard verified.userId == user.id else { throw DomainError.message("الحساب غير مطابق.") }
            try accept(payload)
            _ = try await LocalIdentity.authenticate(reason: "تفعيل Face ID أو Touch ID للدخول إلى حسابك")
            try KeychainStore.save(JSONEncoder().encode(BiometricCredential(email: user.s("email"), password: password)), key: "biometric-credential", biometric: true)
            try KeychainStore.save(Data(user.id.utf8), key: "biometric-owner")
            try KeychainStore.save(Data([1]), key: "biometric-enabled"); biometricEnabled = true; biometricUserID = user.id
            report("تم تفعيل الدخول بالبصمة على هذا الجهاز.")
        }
    }
    func disableBiometrics() { KeychainStore.remove("biometric-credential"); KeychainStore.remove("biometric-enabled"); KeychainStore.remove("biometric-owner"); biometricEnabled = false; biometricUserID = nil; locked = false }
    func clearSession() {
        generation = UUID(); api.clearSession(); SnapshotCache.clear(); snapshot = nil; locked = false; selectedOrderID = nil; offline = false
        NotificationService.shared.clearAccountNotifications()
    }
    func logout() async {
        await perform { _ = try? await api.request("logout", method: "POST", body: [:]); clearSession() }
    }
    func mutate(_ update: (Snapshot) throws -> JObject) async throws {
        guard let current = snapshot, !offline else { throw DomainError.message("اتصل بالإنترنت وحدّث البيانات قبل الحفظ.") }
        let next = try update(current)
        let payload = try await api.request("database", method: "PUT", body: ["database": .object(next), "revision": .number(Double(current.revision))])
        try accept(payload)
    }
    func postSnapshot(_ path: String, body: JObject) async throws {
        let payload = try await api.request(path, method: "POST", body: body); try accept(payload)
    }
    func createOrder(_ draft: OrderDraft) async -> String? {
        let ok = await perform {
            guard let user, role != .courier else { throw DomainError.message("إنشاء الطرد غير متاح لهذا الحساب.") }
            let raw = try draft.newOrder(user: user)
            try await postSnapshot("orders", body: ["orders": .array([.object(raw)])])
            guard snapshot?.orders.contains(where: { $0.id == draft.id }) == true else { throw DomainError.message("لم يصل تأكيد الإنشاء. أعد المحاولة لاستعادة الطرد نفسه.") }
        }
        return ok ? draft.id : nil
    }
    func assignCode(orderID: String, value: String) async -> Bool {
        await perform {
            guard let order = snapshot?.orders.first(where: { $0.id == orderID }), snapshot?.canAssign(order) == true, validCode(value) else { throw DomainError.message("امسح QR صادرًا من الشركة لطرد بلا كود.") }
            let code = normalizedCode(value)
            try await postSnapshot("orders/assign-code", body: ["orderId": .string(orderID), "trackingNumber": .string(code)])
            guard snapshot?.orders.first(where: { $0.id == orderID })?.s("trackingNumber") == code else { throw DomainError.message("لم يصل تأكيد حفظ الكود. أعد المحاولة.") }
            report("تمت قراءة QR وحفظ كود الطرد.")
        }
    }
    func addNote(_ id: String, note: String) async -> Bool {
        await perform {
            guard !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw DomainError.message("اكتب الملاحظة أولًا.") }
            try await mutate { current in
                try current.database.replacing("orders", id: id) { raw in
                    guard let status = ParcelStatus(rawValue: raw.text("status")), !raw.flag("deleted") else { throw DomainError.message("لا يمكن إضافة الملاحظة لهذا الطرد.") }
                    return raw.setting("trackingEvents", .array(raw.array("trackingEvents") + [.object(trackingEvent(status, current.currentUser?.s("name") ?? "", note, kind: "note"))])).setting("updatedAt", .string(isoNow()))
                }
            }
        }
    }
    func setStatus(_ id: String, status: ParcelStatus, note: String) async -> Bool {
        await perform {
            guard role == .admin else { throw DomainError.message("تغيير الحالة الكامل متاح للمسؤول فقط.") }
            try await mutate { current in
                current.database.replacing("orders", id: id) { raw in
                    var updated = raw.setting("status", .string(status.rawValue)).setting("trackingEvents", .array(raw.array("trackingEvents") + [.object(trackingEvent(status, current.currentUser?.s("name") ?? "", note))])).setting("updatedAt", .string(isoNow()))
                    if status == .shipped && raw.text("status") != "shipped" { updated["shippedAt"] = .string(isoNow()) }
                    return updated
                }
            }
        }
    }
    func saveOrder(_ draft: OrderDraft, courierID: String) async -> Bool {
        await perform {
            guard role == .admin else { throw DomainError.message("تعديل البيانات متاح للمسؤول فقط.") }
            try await mutate { current in
                try current.database.replacing("orders", id: draft.id) { raw in
                    guard let merchant = current.users.first(where: { $0.id == raw.text("merchantId") }), !raw.flag("deleted") else { throw DomainError.message("بيانات الطرد أو صاحبه غير متاحة.") }
                    var updated = raw; updated.merge(try draft.fields(user: merchant)) { _, new in new }
                    if let courier = current.users.first(where: { $0.id == courierID && $0.role == .courier }) {
                        updated["courierId"] = .string(courier.id); updated["courierName"] = .string(courier.s("name"))
                    } else { updated.removeValue(forKey: "courierId"); updated["courierName"] = "بانتظار تعيين المندوب" }
                    updated["updatedAt"] = .string(isoNow()); return updated
                }
            }
        }
    }
    func trashOrder(_ order: Record, restore: Bool = false) async -> Bool {
        await perform {
            guard snapshot?.canTrash(order) == true else { throw DomainError.message("لا تملك صلاحية تعديل هذا الطرد.") }
            if restore && trashExpired(order) { throw DomainError.message("انتهت مدة الاستعادة البالغة 30 يومًا.") }
            try await mutate { current in
                current.database.replacing("orders", id: order.id) { $0.setting("deleted", .bool(!restore)).setting("deletedAt", .string(restore ? "" : isoNow())).setting("updatedAt", .string(isoNow())) }
            }
        }
    }
    func maintainTrash() async {
        guard let snapshot, role != .courier, !offline, !busy else { return }
        let next = applyingTrashRetention(snapshot.database)
        guard next != snapshot.database else { return }
        await perform { try await mutate { applyingTrashRetention($0.database) } }
    }
    func hideCollection(_ id: String, hidden: Bool = true) async -> Bool {
        await perform {
            try await mutate { try collectionVisibilityDatabase($0, id: id, hidden: hidden) }
            guard snapshot?.hiddenCollectionIDs.contains(id) == hidden else {
                throw DomainError.message("لم يصل تأكيد تحديث الفاتورة. حدّث البيانات وأعد المحاولة.")
            }
            report(hidden ? "حُذفت الفاتورة من قائمتك. يمكنك استعادتها من المحذوفات." : "تمت استعادة الفاتورة.")
        }
    }
    func setTheme(_ value: String) { theme = value; UserDefaults.standard.set(value, forKey: "theme") }
    func purgeTrash(orderIDs: Set<String>, invoiceIDs: Set<String>) async -> Bool {
        await perform {
            guard let current = snapshot, !offline else { throw DomainError.message("اتصل بالإنترنت وحدّث المحذوفات أولًا.") }
            try await postSnapshot("trash/purge", body: trashPurgeRequest(current, orderIDs: orderIDs, invoiceIDs: invoiceIDs))
            guard let updated = snapshot, orderIDs.isDisjoint(with: Set(updated.orders.map(\.id))), invoiceIDs.isSubset(of: updated.purgedCollectionIDs) else {
                throw DomainError.message("لم يصل تأكيد الحذف. حدّث المحذوفات قبل المحاولة مجددًا.")
            }
            report("تم حذف العناصر المحددة من سلة المحذوفات.")
        }
    }
    func setSounds(_ value: Bool) { sounds = value; UserDefaults.standard.set(value, forKey: "sounds") }
    func setNotifications(_ value: Bool) async {
        guard !requestingNotificationPermission else { return }
        requestingNotificationPermission = true
        defer { requestingNotificationPermission = false }
        if value {
            let allowed = await NotificationService.shared.requestPermission()
            notificationPermissionGranted = allowed
            guard allowed else {
                report("إذن الإشعارات غير مفعّل. اسمح به من إعدادات الجهاز ثم عد إلى التطبيق.")
                return
            }
            notifications = true
        }
        else { notifications = false; NotificationService.shared.clearAccountNotifications() }
        UserDefaults.standard.set(notifications, forKey: "notifications")
    }
    func refreshNotificationPermission() async {
        let allowed = await NotificationService.shared.authorizationGranted()
        if notificationPermissionGranted != allowed { notificationPermissionGranted = allowed }
        // Keep the user's preference when iOS temporarily blocks notifications.
        // Re-enabling the system permission must not require toggling it again.
    }
}
