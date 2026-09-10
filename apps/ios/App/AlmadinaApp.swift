import SwiftUI

@main struct AlmadinaApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var store = AppStore.shared
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            Group {
                if !store.ready { VStack(spacing: 20) { BrandView(); ProgressView("جارٍ التحقق من الجلسة…") }.padding() }
                else if store.snapshot == nil { LoginView() }
                else if store.locked { LockView() }
                else { ApplicationView().id(store.snapshot?.userId) }
            }
            .environmentObject(store).environment(\.layoutDirection, .rightToLeft)
            .environment(\.locale, Locale(identifier: "ar_PS"))
            .preferredColorScheme(store.colorScheme).tint(.brand)
            .overlay {
                if scenePhase != .active { Color(uiColor: .systemBackground).ignoresSafeArea().overlay { BrandView() }.accessibilityHidden(true) }
            }
            .task {
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--ui-test-no-network") { store.ready = true; return }
                #endif
                await store.refreshNotificationPermission()
                await store.restore(); store.beginPolling()
            }
            .onChange(of: scenePhase) { phase in
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--ui-test-no-network") { return }
                #endif
                if phase == .background { store.background() }
                if phase == .active { store.beginPolling(); Task { await store.refreshNotificationPermission(); if store.ready { await store.refresh() } } }
            }
        }
    }
}

struct LockView: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        Page {
            BrandView()
            AppCard {
                Text("التطبيق مقفل").font(.title2.bold())
                Text("تحقق من هويتك لعرض بيانات الطرود والتحصيلات.")
                AppButton("فتح التطبيق", icon: "faceid") { Task { await store.unlock() } }
                Button("تسجيل الخروج", role: .destructive) { Task { await store.logout() } }.disabled(store.busy)
            }
            MessageBanner()
        }
    }
}
