import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var store: AppStore
    @State private var logout = false
    private var appVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "غير متاح" }
    private var appBuild: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "غير متاح" }
    var body: some View {
        List {
            Section("المظهر") {
                Picker("المظهر", selection: Binding(get: { store.theme }, set: store.setTheme)) { Text("حسب الجهاز").tag("system"); Text("فاتح").tag("light"); Text("داكن").tag("dark") }
                Text("يدعم التطبيق تكبير النص والوضع الداكن واتجاه القراءة العربي.").font(.footnote).foregroundStyle(.secondary)
            }
            Section("الخصوصية والأمان") {
                NavigationLink { BiometricSettingsView() } label: { Label("Face ID / Touch ID", systemImage: "faceid") }
                NavigationLink { ChangePasswordView() } label: { Label("تغيير كلمة المرور", systemImage: "key") }
                NavigationLink { DevicesView() } label: { Label("الأجهزة المرتبطة", systemImage: "iphone.and.ipad") }
                NavigationLink(value: Route.legal) { Label("الشروط والخصوصية والأذونات", systemImage: "hand.raised") }
            }
            Section("الإشعارات") {
                Toggle("إشعارات الهاتف", isOn: Binding(get: { store.notifications }, set: { value in Task { await store.setNotifications(value) } }))
                    .disabled(store.requestingNotificationPermission)
                Text(store.notificationPermissionGranted ? "إذن الإشعارات مسموح على هذا الجهاز." : "السماح بالإشعارات يُدار من إعدادات الجهاز.")
                    .font(.footnote).foregroundStyle(.secondary)
                Toggle("أصوات الإشعارات", isOn: Binding(get: { store.sounds }, set: store.setSounds))
                Button("فتح إعدادات إشعارات الجهاز") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
                Text("تظهر التحديثات أثناء الاستخدام، وقد يُحدّث iOS البيانات في الخلفية عندما يسمح النظام. التحديث في الخلفية ليس فوريًا أو مضمونًا بعد إغلاق التطبيق.").font(.footnote).foregroundStyle(.secondary)
            }
            Section {
                NavigationLink(value: Route.help) { Label("مركز المساعدة", systemImage: "questionmark.circle") }
                NavigationLink(value: Route.profile) { Label("الملف الشخصي", systemImage: "person.crop.circle") }
                Button("تسجيل الخروج", role: .destructive) { logout = true }
                if store.role != .admin { NavigationLink { DeleteAccountView() } label: { Label("حذف الحساب", systemImage: "person.crop.circle.badge.minus").foregroundStyle(.red) } }
            }
            Section {
                Text("المدينة إكسبرس · تطبيق iPhone وiPad أصلي\nالإصدار \(appVersion) · رقم البناء \(appBuild)")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }.navigationTitle("الإعدادات").navigationBarTitleDisplayMode(.inline)
            .task { await store.refreshNotificationPermission() }
            .confirmationDialog("تسجيل الخروج من هذا الجهاز؟", isPresented: $logout) { Button("تسجيل الخروج", role: .destructive) { Task { await store.logout() } }; Button("إلغاء", role: .cancel) {} }
    }
}

struct ProfileView: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        Page {
            if let user = store.user {
                AppCard {
                    Image(systemName: "person.crop.circle.fill").font(.system(size: 70)).foregroundStyle(Color.brand).frame(maxWidth: .infinity)
                    Text(user.s("name")).font(.title.bold()).frame(maxWidth: .infinity)
                    Text(user.role == .merchant ? user.membership.title : user.role?.title ?? "").foregroundStyle(Color.brand).frame(maxWidth: .infinity)
                    DetailLine(title: "المتجر", value: user.s("store"))
                    DetailLine(title: "البريد الإلكتروني", value: user.s("email"))
                    DetailLine(title: "رقم الجوال", value: user.s("phone"))
                    DetailLine(title: "المدينة والمنطقة", value: user.s("governorate") + " · " + user.s("city"))
                    DetailLine(title: "العنوان", value: user.s("address"))
                    DetailLine(title: "تاريخ التسجيل", value: user.s("joinedAt").dateDisplay)
                    if user.role == .admin { NavigationLink(value: Route.account(user.id)) { Label("تعديل الملف الشخصي", systemImage: "square.and.pencil") } }
                }
            }
        }.navigationTitle("الملف الشخصي").navigationBarTitleDisplayMode(.inline)
    }
}

struct BiometricSettingsView: View {
    @EnvironmentObject var store: AppStore
    @State private var password = ""
    @State private var confirmDisable = false
    var body: some View {
        Page {
            AppCard {
                Image(systemName: "faceid").font(.largeTitle).foregroundStyle(Color.brand)
                Text(store.biometricEnabled && store.biometricUserID == store.user?.id ? "الدخول بالبصمة مفعّل لهذا الحساب" : "الدخول بالبصمة غير مفعّل لهذا الحساب").font(.headline)
                Text("يُستخدم Face ID أو Touch ID الخاص بالجهاز لفتح بيانات الدخول المحمية في Keychain. لا يقرأ التطبيق صورة الوجه أو بصمة الإصبع ولا يرسلها للخادم.")
                Text("بعد التفعيل تستطيع الدخول بالبصمة حتى بعد تسجيل الخروج. تُلغى بيانات البصمة عند تغيير كلمة المرور، أو تغيير البصمات المسجّلة على الجهاز.").font(.subheadline).foregroundStyle(.secondary)
                if store.biometricEnabled && store.biometricUserID == store.user?.id { Button("إلغاء تفعيل الدخول بالبصمة", role: .destructive) { confirmDisable = true } }
                else {
                    if store.biometricEnabled { Text("البصمة مرتبطة حاليًا بحساب محفوظ آخر. تفعيلها هنا يستبدل حساب الدخول بالبصمة على هذا الجهاز.").font(.footnote) }
                    Input(title: "كلمة المرور الحالية للتأكيد", value: $password, secure: true)
                    AppButton("تفعيل Face ID / Touch ID", icon: "faceid") { Task { if await store.enableBiometrics(password: password) { password = "" } } }.disabled(store.busy || password.isEmpty)
                }
            }
        }.navigationTitle("الدخول بالبصمة").navigationBarTitleDisplayMode(.inline)
            .confirmationDialog("إزالة بيانات الدخول بالبصمة من هذا الجهاز؟", isPresented: $confirmDisable) { Button("إلغاء التفعيل", role: .destructive) { store.disableBiometrics() }; Button("رجوع", role: .cancel) {} }
    }
}

struct ChangePasswordView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var next = ""
    @State private var confirm = ""
    @State private var allDevices = true
    var body: some View {
        Page {
            AppCard {
                Input(title: "كلمة المرور الحالية", value: $current, secure: true)
                Input(title: "كلمة المرور الجديدة", value: $next, secure: true, contentType: .newPassword)
                Input(title: "تأكيد كلمة المرور الجديدة", value: $confirm, secure: true, contentType: .newPassword)
                Toggle("تسجيل الخروج من جميع الأجهزة", isOn: $allDevices)
                Text("8 أحرف على الأقل مع حرف ورقم ورمز. يُلغى تفعيل البصمة بعد التغيير.").font(.footnote)
                AppButton("تغيير كلمة المرور", icon: "lock.rotation") {
                    guard next == confirm else { store.report("تأكيد كلمة المرور غير مطابق."); return }
                    Task { if await store.changePassword(current: current, next: next, allDevices: allDevices) { current = ""; next = ""; confirm = ""; dismiss() } }
                }.disabled(store.busy || current.isEmpty || next.isEmpty)
            }
        }.navigationTitle("تغيير كلمة المرور").navigationBarTitleDisplayMode(.inline)
    }
}

struct DeleteAccountView: View {
    @EnvironmentObject var store: AppStore
    @State private var password = ""
    @State private var phrase = ""
    @State private var deletionState: AccountDeletionState?
    @State private var loading = false
    @State private var loadFailed = false
    @State private var confirmingRequest = false
    @State private var confirmingImmediate = false
    private var credentialsReady: Bool { !store.busy && !password.isEmpty && phrase == "حذف حسابي" }
    var body: some View {
        Page {
            AppCard {
                Label("طلب حذف الحساب وبياناته", systemImage: "person.crop.circle.badge.minus").font(.title2.bold()).foregroundStyle(.red)
                Text("يمكنك تقديم الطلب الآن حتى مع وجود طرود نشطة أو فواتير مستحقة. لا يلزم الاتصال بالدعم لتقديمه، ولا يحذف الطلب الفواتير أو يلغي الالتزامات المالية.")
                Text(deletionState?.reviewTimeline ?? "تُراجع طلبات الحذف خلال 7 أيام تقويمية من تقديمها. تظهر إجراءات التسوية وموعد المتابعة في حالة الطلب عند وجود التزامات.").font(.subheadline).foregroundStyle(.secondary)
                NavigationLink { HelpView() } label: { Label("التواصل مع الدعم", systemImage: "questionmark.circle") }
                    .accessibilityIdentifier("account.support")
                if let url = Company.deletionURL { Link("طلب الحذف ومتابعته عبر الموقع", destination: url) }
                if let url = Company.privacyURL { Link("سياسة الخصوصية والاحتفاظ بالبيانات", destination: url) }
            }
            if let state = deletionState, let request = state.request {
                AppCard {
                    Label(state.requestStatusTitle, systemImage: "doc.text.magnifyingglass").font(.headline)
                        .accessibilityIdentifier("account.deletion.status")
                    DetailLine(title: "رقم الطلب", value: request.id)
                    DetailLine(title: "تاريخ التقديم", value: request.s("createdAt").dateDisplay)
                    DetailLine(title: "موعد المراجعة والمتابعة", value: request.s("reviewDueAt").dateDisplay)
                    if !request.s("updatedAt").isEmpty { DetailLine(title: "آخر تحديث", value: request.s("updatedAt").dateDisplay) }
                    if !request.s("completedAt").isEmpty { DetailLine(title: "اكتمال الحذف", value: request.s("completedAt").dateDisplay) }
                    if !request.s("message").isEmpty { Text(request.s("message")) }
                    if let url = Company.receiptURL(request.s("receiptUrl")) {
                        Link("فتح متابعة طلب الحذف", destination: url)
                        Button { UIPasteboard.general.url = url; store.report("تم نسخ رابط متابعة الطلب.") } label: { Label("نسخ رابط المتابعة", systemImage: "doc.on.doc") }
                        ShareLink(item: url) { Label("حفظ أو مشاركة رابط المتابعة", systemImage: "square.and.arrow.up") }
                        Text("احتفظ بالرابط لتأكيد النتيجة بعد حذف الحساب؛ يبقى متاحًا لمدة 30 يومًا بعد الإكمال. الرابط خاص بطلبك، فلا تشاركه إلا مع جهة موثوقة.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            if let state = deletionState {
                AppCard {
                    Text("التسوية والاحتفاظ بالبيانات").font(.headline)
                    if state.activeOrderCount > 0 { DetailLine(title: "طرود نشطة", value: String(state.activeOrderCount)) }
                    if state.unsettledCollectionCount > 0 { DetailLine(title: "فواتير غير مسوّاة", value: String(state.unsettledCollectionCount)) }
                    if state.unsettledOrderCount > 0 { DetailLine(title: "طرود بانتظار التسوية", value: String(state.unsettledOrderCount)) }
                    Text(state.retentionNotice).font(.subheadline)
                }
            }
            if deletionState?.request == nil || (deletionState?.eligible == true && !loadFailed) {
                AppCard {
                    Input(title: "كلمة المرور الحالية", value: $password, secure: true)
                    Input(title: "اكتب: حذف حسابي", value: $phrase)
                    if deletionState?.request == nil {
                        Button("تقديم طلب حذف الحساب", role: .destructive) { confirmingRequest = true }
                            .buttonStyle(.borderedProminent).disabled(!credentialsReady)
                            .accessibilityIdentifier("account.deletion.request")
                    }
                    if deletionState?.eligible == true && !loadFailed {
                        Text("لا توجد التزامات تمنع الحذف الفوري حسب آخر تحقق من الخادم. يمكنك تنفيذه الآن بدل انتظار معالجة الطلب. الحذف نهائي ولا يمكن التراجع عنه.").font(.footnote)
                        Button("حذف الحساب الآن", role: .destructive) { confirmingImmediate = true }
                            .buttonStyle(.bordered).disabled(!credentialsReady)
                            .accessibilityIdentifier("account.deletion.immediate")
                    }
                }
            }
            if loading { ProgressView("جارٍ تحديث حالة الطلب…") }
            if loadFailed { Text("تعذّر تحديث الحالة. أعد المحاولة أو افتح رابط المتابعة إن كنت حفظته. لا يعني تعذّر الاتصال أن طلبًا سابقًا لم يُسجّل.").font(.footnote).foregroundStyle(.secondary) }
            Button { Task { await load() } } label: { Label("تحديث حالة طلب الحذف", systemImage: "arrow.clockwise") }.disabled(store.busy || loading)
        }.navigationTitle("حذف الحساب").navigationBarTitleDisplayMode(.inline)
            .task { await load() }.refreshable { await load() }
            .confirmationDialog("تقديم طلب حذف الحساب؟", isPresented: $confirmingRequest, titleVisibility: .visible) {
                Button("إرسال الطلب", role: .destructive) {
                    Task {
                        if let updated = await store.requestAccountDeletion(password) {
                            deletionState = updated; loadFailed = false; password = ""; phrase = ""
                        }
                    }
                }
                Button("إلغاء", role: .cancel) {}
            } message: { Text("يسجل الطلب للمراجعة حتى مع التزامات معلّقة. لا يُحذف الحساب بمجرد تقديم الطلب، وتستطيع متابعة حالته ورقم مرجعه هنا.") }
            .confirmationDialog("تأكيد حذف الحساب نهائيًا؟", isPresented: $confirmingImmediate, titleVisibility: .visible) {
                Button("حذف نهائي", role: .destructive) { Task { if await store.deleteOwnAccount(password) { password = ""; phrase = "" } else { await load() } } }
                Button("إلغاء", role: .cancel) {}
            } message: { Text("يتحقق الخادم من التسوية مرة أخرى، ثم يحذف الحساب وبياناته التي لا يلزم الاحتفاظ بها وفق السياسة المنشورة. لا يمكن التراجع عن الحذف.") }
    }
    private func load() async {
        guard !loading, !store.busy else { return }
        loading = true; defer { loading = false }
        if let updated = await store.loadAccountDeletionState() { deletionState = updated; loadFailed = false }
        else { loadFailed = true }
    }
}

struct DevicesView: View {
    @EnvironmentObject var store: AppStore
    @State private var devices: [Record] = []
    @State private var selected: Record?
    var body: some View {
        List {
            Section("الأجهزة المرتبطة (\(devices.count))") {
                ForEach(devices) { device in
                    VStack(alignment: .leading, spacing: 8) {
                        Label(device.s("name"), systemImage: device.s("type") == "tablet" ? "ipad" : device.s("type") == "desktop" ? "desktopcomputer" : "iphone").font(.headline)
                        Text(device.s("browser")).font(.subheadline)
                        Text("آخر نشاط: " + device.s("lastActiveAt").dateDisplay).font(.caption).foregroundStyle(.secondary)
                        if device.b("current") { Text("هذا الجهاز").foregroundStyle(Color.brand) }
                        else { Button("إنهاء جلسة هذا الجهاز", role: .destructive) { selected = device }.disabled(store.busy) }
                    }.padding(.vertical, 6)
                }
            }
        }.navigationTitle("الأجهزة المرتبطة").navigationBarTitleDisplayMode(.inline)
            .task { await load() }.refreshable { await load() }
            .confirmationDialog("إنهاء جلسة الجهاز المحدد؟", isPresented: Binding(get: { selected != nil }, set: { if !$0 { selected = nil } })) {
                Button("إنهاء الجلسة", role: .destructive) {
                    guard let device = selected else { return }; selected = nil
                    Task { await store.perform { let payload = try await store.api.request("security/devices/revoke", method: "POST", body: ["deviceId": .string(device.id)]); devices = payload.records("devices") } }
                }
                Button("إلغاء", role: .cancel) { selected = nil }
            }
    }
    private func load() async { await store.perform { devices = try await store.api.request("security/devices").records("devices") } }
}
