import Foundation
import UIKit
import os

struct APIError: LocalizedError {
    let status: Int
    let payload: JObject
    var errorDescription: String? { payload.text("error").isEmpty ? "تعذّر الاتصال بالخادم. حاول مجددًا." : payload.text("error") }
}

private struct SavedCookie: Codable {
    var name: String, value: String, domain: String, path: String
    var expires: Date?
    var secure: Bool
    init(_ cookie: HTTPCookie) {
        name = cookie.name; value = cookie.value; domain = cookie.domain; path = cookie.path
        expires = cookie.expiresDate; secure = cookie.isSecure
    }
    func matches(_ url: URL) -> Bool {
        let host = url.host?.lowercased() ?? ""
        let cookieHost = domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
        return host == cookieHost && url.path.hasPrefix(path) && (!secure || url.scheme == "https") && (expires == nil || expires! > Date()) && !value.isEmpty
    }
}

/// Never forward a session cookie to a redirected endpoint, even on the same
/// host. API routes are configured with their final HTTPS URLs.
private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// All endpoints are confined to the configured HTTPS origin. No arbitrary QR
/// URL is ever opened or used as a network request destination.
@MainActor final class APIClient {
    static var baseURL: URL? {
        let configured = Bundle.main.object(forInfoDictionaryKey: "AlmadinaAPIBaseURL") as? String
        return URL(string: configured ?? "https://almadina-express.onrender.com/api/almadina/")
    }
    private let session: URLSession
    private var cookies: [SavedCookie] = []
    private var epoch = 0
    init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        config.urlCache = nil; config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 35; config.timeoutIntervalForResource = 50
        session = URLSession(configuration: config, delegate: NoRedirectDelegate(), delegateQueue: nil)
        if let data = try? KeychainStore.read("session-cookies"), let saved = try? JSONDecoder().decode([SavedCookie].self, from: data) { cookies = saved }
    }
    func clearSession() {
        epoch += 1; cookies = []; KeychainStore.remove("session-cookies")
    }
    func request(_ path: String, method: String = "GET", body: JObject? = nil) async throws -> JObject {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-test-no-network") { throw DomainError.message("الاتصال معطّل في اختبارات الواجهة.") }
        #endif
        let started = epoch
        guard let base = Self.baseURL, let url = APIEndpoint.resolve(base: base, path: path) else {
            throw DomainError.message("إعداد عنوان الخادم غير صالح.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.2"
        request.setValue("ios-native/\(version)", forHTTPHeaderField: "X-Almadina-Client")
        let device = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        request.setValue("AlmadinaExpress/\(version) (\(device); CPU \(device) OS \(UIDevice.current.systemVersion) like Mac OS X)", forHTTPHeaderField: "User-Agent")
        cookies.removeAll { $0.expires.map { $0 <= Date() } ?? false }
        let header = cookies.filter { $0.matches(url) }.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        if !header.isEmpty { request.setValue(header, forHTTPHeaderField: "Cookie") }
        if let body { request.httpBody = try await Task.detached(priority: .userInitiated) { try JSONEncoder().encode(body) }.value }
        try Task.checkCancellation()
        guard started == epoch else { throw CancellationError() }
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard started == epoch else { throw CancellationError() }
        guard let http = response as? HTTPURLResponse, http.url == url else { throw DomainError.message("استجابة الخادم غير موثوقة.") }
        let headers = http.allHeaderFields.reduce(into: [String: String]()) { result, pair in
            if let key = pair.key as? String { result[key] = String(describing: pair.value) }
        }
        let incoming = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url).map(SavedCookie.init)
        for cookie in incoming {
            cookies.removeAll { $0.name == cookie.name && $0.domain == cookie.domain && $0.path == cookie.path }
            if !cookie.value.isEmpty, cookie.expires == nil || cookie.expires! > Date() { cookies.append(cookie) }
        }
        // A server acknowledgement remains authoritative even if optional local
        // persistence fails; do not report a successful mutation as a failure.
        if !incoming.isEmpty { try? KeychainStore.save(JSONEncoder().encode(cookies), key: "session-cookies") }
        let decoded = try? await Task.detached(priority: .userInitiated) { try JSONDecoder().decode(JObject.self, from: data) }.value
        try Task.checkCancellation()
        guard started == epoch else { throw CancellationError() }
        if !(200...299).contains(http.statusCode) {
            let requestID = http.value(forHTTPHeaderField: "X-Request-ID") ?? ""
            let safeID = requestID.count == 36 && requestID.allSatisfy { $0.isHexDigit || $0 == "-" } ? requestID : "unavailable"
            Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.almadinaexpress.ios", category: "network")
                .error("request_failed status=\(http.statusCode, privacy: .public) requestId=\(safeID, privacy: .public)")
            throw APIError(status: http.statusCode, payload: decoded ?? ["error": "تعذّر الاتصال بالخادم. حاول مجددًا."])
        }
        guard let payload = decoded else { throw DomainError.message("استجابة الخادم غير مكتملة. حدّث البيانات قبل إعادة المحاولة.") }
        return payload
    }
}
