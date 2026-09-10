import Foundation

extension AppStore {
    func register(_ fields: JObject) async -> Bool {
        await perform { _ = try await api.request("register/request", method: "POST", body: fields) }
    }
    func verifyRegistration(_ code: String) async -> Bool {
        await perform {
            let payload = try await api.request("register/verify", method: "POST", body: ["code": .string(normalizedDigits(code))])
            generationForNewAccount(); try accept(payload, replacingAccount: true); locked = false
        }
    }
    func changePassword(current: String, next: String, allDevices: Bool) async -> Bool {
        await perform {
            guard validPassword(next) else { throw DomainError.message("استخدم 8 أحرف على الأقل مع حرف ورقم ورمز.") }
            let payload = try await api.request("account/password", method: "POST", body: ["currentPassword": .string(current), "newPassword": .string(next), "confirmPassword": .string(next), "signOutAllDevices": .bool(allDevices)])
            disableBiometrics()
            if payload.flag("signedOut") { clearSession() }
            report("تم تغيير كلمة المرور. أعد تفعيل البصمة إذا رغبت.")
        }
    }
    func deleteOwnAccount(_ password: String) async -> Bool {
        await perform {
            let oldID = user?.id
            _ = try await api.request("account/delete", method: "POST", body: ["password": .string(password), "confirmation": "حذف حسابي"])
            accounts.removeAll { $0.id == oldID }; saveAccounts()
            if let oldID {
                for prefix in ["order-draft-", "pending-import-", "pending-batch-", "seen-notices-"] { KeychainStore.remove(prefix + oldID) }
            }
            disableBiometrics(); clearSession(); report("تم حذف الحساب وبياناته.")
        }
    }
    func loadAccountDeletionState() async -> AccountDeletionState? {
        var state: AccountDeletionState?
        let success = await perform {
            let payload = try await api.request("account/deletion-request")
            state = try AccountDeletionState(payload)
        }
        return success ? state : nil
    }
    func requestAccountDeletion(_ password: String) async -> AccountDeletionState? {
        var state: AccountDeletionState?
        let success = await perform {
            let payload = try await api.request("account/deletion-request", method: "POST", body: ["password": .string(password), "confirmation": "حذف حسابي"])
            let received = try AccountDeletionState(payload)
            guard received.request != nil else { throw DomainError.message("لم يصل رقم طلب الحذف. حدّث الحالة قبل إعادة الإرسال.") }
            state = received
        }
        // Registering a request must preserve the session, receipts and
        // financial records until the server confirms actual completion.
        return success ? state : nil
    }
    func markNotice(_ notice: Record) async {
        guard !notice.b("read") else { return }
        await perform { try await mutate { $0.database.replacing("notices", id: notice.id) { $0.setting("read", true) } } }
    }
    func clearNotices(_ ids: [String]) async {
        await perform { try await postSnapshot("notices/clear", body: ["noticeIds": .array(ids.map(JSONValue.string))]) }
    }
    func sendBroadcast(audience: String, recipient: String, title: String, text: String, requestID: String) async -> Bool {
        await perform {
            guard role == .admin, (3...80).contains(title.count), (5...500).contains(text.count) else { throw DomainError.message("عنوان الإشعار من 3 إلى 80 حرفًا والنص من 5 إلى 500 حرف.") }
            var body: JObject = ["requestId": .string(requestID), "audience": .string(audience), "title": .string(title), "message": .string(text)]
            if audience == "user" { body["recipientUserId"] = .string(recipient) }
            try await postSnapshot("notices/broadcast", body: body)
        }
    }
    func updateAccount(id: String, name: String, email: String, phone: String, shop: String, membership: Membership) async -> Bool {
        await perform {
            guard role == .admin, name.count >= 2, validEmail(email), validPhone(phone), !shop.isEmpty else { throw DomainError.message("راجع الاسم والبريد ورقم الجوال واسم المتجر.") }
            try await mutate { current in
                current.database.replacing("users", id: id) { raw in
                    var updated = raw
                    updated.merge(["name": .string(name), "email": .string(email.lowercased()), "phone": .string(normalizedDigits(phone)), "store": .string(shop)]) { _, new in new }
                    if raw.text("role") == "merchant" { updated["membership"] = .string(membership.rawValue) }; return updated
                }
            }
        }
    }
    func createAccount(id: String, name: String, email: String, phone: String, password: String, role targetRole: Role, membership: Membership) async -> Bool {
        await perform {
            guard role == .admin, targetRole != .admin, name.count >= 2, validEmail(email), validPhone(phone), validPassword(password) else { throw DomainError.message("راجع بيانات الحساب وكلمة المرور: حرف ورقم ورمز و8 أحرف على الأقل.") }
            try await mutate { current in
                if current.users.contains(where: { $0.id == id }) { return current.database }
                let raw: JObject = ["id": .string(id), "name": .string(name), "email": .string(email.lowercased()), "phone": .string(normalizedDigits(phone)), "store": .string(name), "password": .string(password), "role": .string(targetRole.rawValue), "membership": .string(membership.rawValue), "joinedAt": .string(isoNow()), "avatarColor": "#087C45"]
                return current.database.setting("users", .array(current.database.array("users") + [.object(raw)]))
            }
        }
    }
    func deleteAccountByAdmin(_ id: String) async -> Bool {
        await perform {
            guard role == .admin, id != user?.id else { throw DomainError.message("لا يمكن حذف الحساب الحالي من هذه الصفحة.") }
            try await mutate { $0.database.setting("users", .array($0.database.array("users").filter { $0.object.text("id") != id })) }
        }
    }
    func createInvoice(orderIDs: Set<String>, id: String, code: String) async -> Bool {
        await perform {
            // Retry with the same local ID; never mint a second invoice when an
            // acknowledgement was lost after a successful server commit.
            try await mutate { current in
                if current.collections.contains(where: { $0.id == id }) { return current.database }
                return try collectionDatabase(current, selectedIDs: orderIDs, id: id, code: code)
            }
        }
    }
    func prepareInvoice(_ id: String) async -> Bool {
        await perform { try await postSnapshot("collections/prepare", body: ["invoiceId": .string(id)]) }
    }
    func verifyInvoice(_ id: String, code: String) async -> Bool {
        await perform {
            let normalized = normalizedDigits(code).trimmingCharacters(in: .whitespacesAndNewlines)
            guard normalized.range(of: "^[0-9]{4}$", options: .regularExpression) != nil else { throw DomainError.message("كود تحقق الفاتورة مكوّن من 4 أرقام.") }
            try await postSnapshot("collections/verify", body: ["invoiceId": .string(id), "verificationCode": .string(normalized)])
            report("تم التحقق وتسليم التحصيل.")
        }
    }
    func regenerateInvoiceCode(_ id: String) async {
        await perform {
            try await mutate { current in
                guard current.currentUser?.role == .merchant else { throw DomainError.message("الكود متاح لصاحب الفاتورة فقط.") }
                return try current.database.replacing("collections", id: id) { raw in
                    guard raw.text("merchantId") == current.userId, raw.text("status") != "paid" else { throw DomainError.message("لا يمكن تغيير كود هذه الفاتورة.") }
                    return raw.setting("verificationCode", .string(String(Int.random(in: 1000...9999)))).setting("updatedAt", .string(isoNow()))
                }
            }
        }
    }
    func shipCode(_ code: String) async -> Bool {
        await perform {
            guard role == .courier, validCode(code) else { throw DomainError.message("امسح كود طرد صحيحًا من حساب المندوب / الموظف.") }
            try await postSnapshot("orders/scan", body: ["trackingNumber": .string(normalizedCode(code))])
            report("تم شحن الطرد وإرسال التحديث.")
        }
    }
    func reserveBatch(count: Int, label: String) async -> String? {
        var batchID: String?
        let ok = await perform {
            guard role == .admin, let owner = user?.id, (1...500).contains(count) else { throw DomainError.message("اختر من 1 إلى 500 كود من حساب المسؤول.") }
            let key = "pending-batch-" + owner
            let saved = (try? KeychainStore.read(key)).flatMap { try? JSONDecoder().decode(PendingBatch.self, from: $0) }
            let pending = saved ?? PendingBatch(owner: owner, requestID: "ios-batch-" + UUID().uuidString, count: count, label: label)
            guard pending.owner == owner else { throw DomainError.message("طلب الحجز لا يخص الحساب الحالي.") }
            try KeychainStore.save(JSONEncoder().encode(pending), key: key)
            let payload = try await api.request("parcel-code-batches", method: "POST", body: ["requestId": .string(pending.requestID), "count": .number(Double(pending.count)), "label": .string(pending.label)])
            try accept(payload)
            guard payload.text("batchId") == pending.requestID, snapshot?.batches.contains(where: { $0.id == pending.requestID }) == true else { throw DomainError.message("لم يصل تأكيد الحجز. أعد المحاولة لاستعادة الدفعة نفسها.") }
            batchID = pending.requestID; KeychainStore.remove(key)
        }
        return ok ? batchID : nil
    }
}
