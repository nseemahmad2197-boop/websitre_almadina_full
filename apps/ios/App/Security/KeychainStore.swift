import Foundation
import Security
import LocalAuthentication
import CryptoKit

enum KeychainStore {
    static let service = (Bundle.main.bundleIdentifier ?? "com.almadinaexpress.ios") + ".secure"
    static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }
    static func save(_ data: Data, key: String, biometric: Bool = false) throws {
        var item = query(key)
        item[kSecValueData as String] = data
        if biometric {
            var error: Unmanaged<CFError>?
            guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error) else {
                throw DomainError.message("يلزم تفعيل رمز قفل الجهاز والبصمة أولًا.")
            }
            item[kSecAttrAccessControl as String] = access
        } else { item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly }
        let status: OSStatus
        if biometric {
            // Enrollment explicitly replaces only this app's biometric item.
            SecItemDelete(query(key) as CFDictionary)
            status = SecItemAdd(item as CFDictionary, nil)
        } else {
            let added = SecItemAdd(item as CFDictionary, nil)
            status = added == errSecDuplicateItem ? SecItemUpdate(query(key) as CFDictionary, [kSecValueData as String: data] as CFDictionary) : added
        }
        guard status == errSecSuccess else { throw DomainError.message("تعذّر حفظ البيانات بأمان على الجهاز (\(status)).") }
    }
    static func read(_ key: String, context: LAContext? = nil) throws -> Data? {
        var item = query(key)
        item[kSecReturnData as String] = true
        item[kSecMatchLimit as String] = kSecMatchLimitOne
        if let context { item[kSecUseAuthenticationContext as String] = context }
        var result: CFTypeRef?
        let status = SecItemCopyMatching(item as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw DomainError.message("تعذّر فتح البيانات الآمنة. استخدم كلمة المرور أو حاول مجددًا.") }
        return result as? Data
    }
    static func remove(_ key: String) { SecItemDelete(query(key) as CFDictionary) }
}

struct BiometricCredential: Codable { var email: String; var password: String }

enum LocalIdentity {
    static func available() -> Bool {
        let context = LAContext(); return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }
    static func authenticate(reason: String, biometricsOnly: Bool = true) async throws -> LAContext {
        let context = LAContext(); context.localizedCancelTitle = "إلغاء"
        context.localizedFallbackTitle = ""
        let policy: LAPolicy = biometricsOnly ? .deviceOwnerAuthenticationWithBiometrics : .deviceOwnerAuthentication
        guard context.canEvaluatePolicy(policy, error: nil) else { throw DomainError.message("فعّل رمز قفل الجهاز وFace ID أو Touch ID من إعدادات الجهاز.") }
        let success = try await context.evaluatePolicy(policy, localizedReason: reason)
        guard success else { throw DomainError.message("لم ينجح التحقق من الهوية.") }; return context
    }
}

/// Cache contains no plaintext personal data, is excluded from backup, and is
/// removed on logout. Device-bound key material never leaves Keychain.
enum SnapshotCache {
    private static let ioQueue = DispatchQueue(label: "com.almadinaexpress.snapshot-cache", qos: .utility)

    /// Enqueue before returning to the UI. Clear uses the same serial queue, so
    /// an older write cannot recreate cached account data after logout.
    static func enqueueSave(_ snapshot: Snapshot) {
        ioQueue.async { try? saveImmediately(snapshot) }
    }
    static func save(_ snapshot: Snapshot) throws {
        try ioQueue.sync { try saveImmediately(snapshot) }
    }
    static func read() -> Snapshot? { ioQueue.sync { readImmediately() } }
    static func clear() { ioQueue.sync { clearImmediately() } }

    static func fileURL() throws -> URL {
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        var folder = directory.appendingPathComponent("AlmadinaCache", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try folder.setResourceValues(values)
        return folder.appendingPathComponent("session.encrypted")
    }
    static func key() throws -> SymmetricKey {
        if let data = try KeychainStore.read("cache-key") { return SymmetricKey(data: data) }
        let key = SymmetricKey(size: .bits256)
        try KeychainStore.save(key.withUnsafeBytes { Data($0) }, key: "cache-key")
        return key
    }
    private static func saveImmediately(_ snapshot: Snapshot) throws {
        let data = try JSONEncoder().encode(snapshot)
        guard let sealed = try AES.GCM.seal(data, using: key()).combined else { return }
        try sealed.write(to: fileURL(), options: [.atomic, .completeFileProtection])
    }
    private static func readImmediately() -> Snapshot? {
        do {
            guard let data = try? Data(contentsOf: fileURL()), let keyData = try KeychainStore.read("cache-key") else { return nil }
            let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: SymmetricKey(data: keyData))
            return try JSONDecoder().decode(Snapshot.self, from: plain)
        } catch { return nil }
    }
    private static func clearImmediately() {
        if let file = try? fileURL() { try? FileManager.default.removeItem(at: file) }
        KeychainStore.remove("cache-key")
    }
}
