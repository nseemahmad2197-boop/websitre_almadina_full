import UIKit
import UserNotifications
import BackgroundTasks

@MainActor final class NotificationService: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationService()
    static var refreshID: String { (Bundle.main.bundleIdentifier ?? "com.almadinaexpress.ios") + ".refresh" }
    func configure() { UNUserNotificationCenter.current().delegate = self }
    func authorizationGranted() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus)
    }
    func requestPermission() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        // The OS stores the permission independently of the in-app preference.
        // Never request again after a grant or refusal; Settings can change it.
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return true
        case .denied: return false
        case .notDetermined: break
        @unknown default: return false
        }
        do { return try await center.requestAuthorization(options: [.alert, .badge, .sound]) }
        catch { return false }
    }
    func deliverNew(owner: String, previous: [Record]?, current: [Record], enabled: Bool, sounds: Bool) {
        let key = "seen-notices-" + owner
        let saved = (try? KeychainStore.read(key)).flatMap { try? JSONDecoder().decode([String].self, from: $0) }
        let known = Set(previous?.map(\.id) ?? saved ?? current.map(\.id))
        try? KeychainStore.save(JSONEncoder().encode(current.map(\.id)), key: key)
        guard enabled else { return }
        for notice in current.filter({ !known.contains($0.id) && !$0.b("read") }).prefix(10) {
            let content = UNMutableNotificationContent()
            content.title = "المدينة إكسبرس"
            // Do not expose recipient data, invoice codes, or amounts on the lock screen.
            content.body = "لديك تحديث جديد. افتح التطبيق للاطلاع عليه."
            if sounds { content.sound = .default }
            content.userInfo = ["orderId": notice.s("orderId")]
            let request = UNNotificationRequest(identifier: "almadina-" + notice.id, content: content, trigger: nil)
            UNUserNotificationCenter.current().add(request) { _ in }
        }
    }
    func clearAccountNotifications() {
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshID)
    }
    func scheduleRefresh() {
        guard UserDefaults.standard.bool(forKey: "notifications") else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshID)
        request.earliestBeginDate = Date().addingTimeInterval(30 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let id = response.notification.request.content.userInfo["orderId"] as? String
        Task { @MainActor in
            if let id, !id.isEmpty, AppStore.shared.snapshot?.orders.contains(where: { $0.id == id }) == true { AppStore.shared.selectedOrderID = id }
            completionHandler()
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        NotificationService.shared.configure()
        BGTaskScheduler.shared.register(forTaskWithIdentifier: NotificationService.refreshID, using: nil) { task in
            guard let refresh = task as? BGAppRefreshTask else { task.setTaskCompleted(success: false); return }
            let work = Task { @MainActor in
                let store = AppStore.shared
                let success = await store.refresh()
                if store.snapshot != nil { NotificationService.shared.scheduleRefresh() }
                refresh.setTaskCompleted(success: success && !Task.isCancelled)
            }
            refresh.expirationHandler = { work.cancel() }
        }
        return true
    }
}
