import SwiftUI

enum MainTab: String, CaseIterable, Identifiable, Hashable {
    case home, parcels, collections, returns
    var id: String { rawValue }
    var title: String { switch self { case .home: return "الرئيسية"; case .parcels: return "الطرود"; case .collections: return "التحصيلات"; case .returns: return "الرواجع" } }
    var icon: String { switch self { case .home: return "house"; case .parcels: return "shippingbox"; case .collections: return "list.bullet.rectangle"; case .returns: return "arrow.uturn.backward" } }
}
enum Route: Hashable {
    case order(String), newOrder, invoice(String), newInvoice, settings, profile, legal, help, notifications, trash, scan, accounts, account(String), newAccount, broadcast, batches, recipients, importCSV
}

struct ApplicationView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var tab = MainTab.home
    @State private var paths: [MainTab: [Route]] = [:]
    @State private var showLogout = false
    private var path: [Route] {
        get { paths[tab] ?? [] }
        nonmutating set { paths[tab] = newValue }
    }
    var body: some View {
        Group {
            if sizeClass == .regular {
                NavigationSplitView {
                    List {
                        accountHeader
                        Section { ForEach(MainTab.allCases) { item in Button { tab = item; path = [] } label: { Label(item.title, systemImage: item.icon).foregroundStyle(tab == item ? Color.brand : Color.primary) }.padding(.vertical, 6) } }
                        sideLinks
                        Section { Button("تسجيل الخروج", role: .destructive) { showLogout = true } }
                    }.navigationTitle("المدينة إكسبرس").navigationSplitViewColumnWidth(min: 230, ideal: 275, max: 350)
                } detail: { navigation(tab) }
            } else {
                // Each tab keeps a stable navigation/scroll hierarchy. Sharing a
                // stack around TabView made rapid tab changes relayout its root.
                TabView(selection: $tab) {
                    ForEach(MainTab.allCases) { item in
                        navigation(item).tabItem { Label(item.title, systemImage: item.icon) }.tag(item)
                    }
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) { MessageBanner() }
        .confirmationDialog("تسجيل الخروج من هذا الجهاز؟", isPresented: $showLogout) { Button("تسجيل الخروج", role: .destructive) { Task { await store.logout() } }; Button("إلغاء", role: .cancel) {} }
        .onChange(of: store.selectedOrderID) { id in
            guard let id else { return }; tab = .home; path = [.order(id)]; store.selectedOrderID = nil
        }
        .task { await store.maintainTrash() }
    }
    @ViewBuilder private var accountHeader: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "person.crop.circle.fill").font(.largeTitle).foregroundStyle(Color.brand)
                Text(store.user?.s("name") ?? "").font(.headline)
                Text(store.user?.s("store") ?? "").foregroundStyle(.secondary)
                Text(store.role == .merchant ? store.user?.membership.title ?? "" : store.role?.title ?? "").font(.caption).foregroundStyle(Color.brand)
                Button { path = [.profile] } label: { Label("الملف الشخصي", systemImage: "person.crop.circle") }.padding(.top, 4)
            }.padding(.vertical, 8)
        }
    }
    @ViewBuilder private var sideLinks: some View {
        Section {
            Button { path = [.settings] } label: { Label("الإعدادات", systemImage: "gearshape") }
            Button { path = [.help] } label: { Label("مركز المساعدة", systemImage: "questionmark.circle") }
            if store.role == .merchant { Button { path = [.recipients] } label: { Label("المستلمون", systemImage: "person.2") } }
            if store.role == .admin {
                Button { path = [.accounts] } label: { Label("إدارة الحسابات", systemImage: "person.2") }
                Button { path = [.batches] } label: { Label("أكواد الطرود للطباعة", systemImage: "qrcode") }
                Button { path = [.broadcast] } label: { Label("إرسال تحديث", systemImage: "megaphone") }
            }
        }
    }
    private func navigation(_ item: MainTab) -> some View {
        NavigationStack(path: Binding(get: { paths[item] ?? [] }, set: { paths[item] = $0 })) {
            tabPage(item)
            .navigationTitle(item == .home ? "لوحة المتابعة" : item.title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Menu {
                        Text(store.user?.s("name") ?? "")
                        Text(store.role == .merchant ? store.user?.membership.title ?? "" : store.role?.title ?? "")
                        Button { path.append(.profile) } label: { Label("الملف الشخصي", systemImage: "person.crop.circle") }
                        Button { path.append(.settings) } label: { Label("الإعدادات", systemImage: "gearshape") }.accessibilityIdentifier("navigation.settings")
                        Button { path.append(.help) } label: { Label("مركز المساعدة", systemImage: "questionmark.circle") }
                        if store.role == .merchant { Button("المستلمون") { path.append(.recipients) } }
                        if store.role == .admin {
                            Button("إدارة الحسابات") { path.append(.accounts) }
                            Button("حجز أكواد الطرود") { path.append(.batches) }
                            Button("إرسال تحديث") { path.append(.broadcast) }
                        }
                        Button("تسجيل الخروج", role: .destructive) { showLogout = true }
                    } label: { Image(systemName: "line.3.horizontal").padding(6) }.accessibilityLabel("القائمة الجانبية")
                }
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    Button { path.append(.notifications) } label: { Image(systemName: (store.snapshot?.notices.contains { !$0.b("read") } ?? false) ? "bell.badge" : "bell") }.accessibilityLabel("الإشعارات")
                    if store.role != .courier { Button { path.append(.trash) } label: { Image(systemName: "trash") }.accessibilityLabel("المحذوفات") }
                    Button { path.append(.scan) } label: { Image(systemName: "qrcode.viewfinder") }.accessibilityLabel("قراءة كود الطرد")
                }
            }
            .navigationDestination(for: Route.self) { route in destination(route).toolbar(.visible, for: .tabBar) }
        }
        .toolbar(.visible, for: .tabBar)
    }
    @ViewBuilder private func tabPage(_ item: MainTab) -> some View {
        switch item { case .home: DashboardView(); case .parcels: ParcelsView(); case .collections: CollectionsView(); case .returns: ParcelsView(onlyReturns: true) }
    }
    @ViewBuilder private func destination(_ route: Route) -> some View {
        switch route {
        case .order(let id): OrderDetailView(id: id)
        case .newOrder: OrderFormView()
        case .invoice(let id): InvoiceDetailView(id: id)
        case .newInvoice: NewInvoiceView()
        case .settings: SettingsView()
        case .profile: ProfileView()
        case .legal: LegalView()
        case .help: HelpView()
        case .notifications: NoticesView()
        case .trash: TrashView()
        case .scan: ScanLookupView()
        case .accounts: AccountsView()
        case .account(let id): AccountEditorView(id: id)
        case .newAccount: AccountEditorView()
        case .broadcast: BroadcastView()
        case .batches: BatchesView()
        case .recipients: RecipientsView()
        case .importCSV: ImportView()
        }
    }
}
