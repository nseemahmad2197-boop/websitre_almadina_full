import SwiftUI

struct AccountsView: View {
    @EnvironmentObject var store: AppStore
    @State private var search = ""
    var body: some View {
        List {
            if store.role == .admin {
                Section { NavigationLink(value: Route.newAccount) { Label("إنشاء حساب مستخدم أو مندوب", systemImage: "person.badge.plus") } }
                ForEach(store.snapshot?.users.filter { search.isEmpty || ($0.s("name") + " " + $0.s("email") + " " + $0.s("store")).localizedCaseInsensitiveContains(search) } ?? []) { account in
                    NavigationLink(value: Route.account(account.id)) {
                        VStack(alignment: .leading, spacing: 7) { Text(account.s("name")).font(.headline); Text(account.s("store")); Text(account.role == .merchant ? account.membership.title : account.role?.title ?? "").font(.caption).foregroundStyle(Color.brand) }.padding(.vertical, 6)
                    }
                }
            } else { EmptyViewState(title: "هذه الصفحة للمسؤول فقط") }
        }.navigationTitle("إدارة الحسابات").searchable(text: $search, prompt: "اسم الحساب أو المتجر").refreshable { await store.refresh() }
    }
}

struct AccountEditorView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    var id: String? = nil
    @State private var newID = "account-ios-" + UUID().uuidString
    @State private var name = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var shop = ""
    @State private var password = ""
    @State private var membership = Membership.standard
    @State private var role = Role.merchant
    @State private var loaded = false
    @State private var deleting = false
    var body: some View {
        Page {
            if store.role == .admin {
                AppCard {
                    Input(title: "الاسم", value: $name)
                    Input(title: "البريد الإلكتروني", value: $email, keyboard: .emailAddress)
                    Input(title: "رقم الجوال", value: $phone, keyboard: .phonePad)
                    if id != nil { Input(title: "اسم المتجر / الحساب", value: $shop) }
                    else {
                        Input(title: "كلمة المرور الأولية", value: $password, secure: true, contentType: .newPassword)
                        Picker("الدور", selection: $role) { Text("مستخدم").tag(Role.merchant); Text("مندوب / موظف").tag(Role.courier) }
                    }
                    if role == .merchant { Picker("تصنيف الحساب", selection: $membership) { ForEach(Membership.allCases, id: \.self) { Text($0.title).tag($0) } } }
                    AppButton("حفظ الحساب", icon: "checkmark.circle") { save() }.disabled(store.busy)
                }
                if let id, id != store.user?.id { Button("حذف الحساب", role: .destructive) { deleting = true }.disabled(store.busy) }
            } else { EmptyViewState(title: "هذه الصفحة للمسؤول فقط") }
        }.navigationTitle(id == nil ? "حساب جديد" : "تعديل الحساب").navigationBarTitleDisplayMode(.inline)
            .onAppear {
                guard !loaded else { return }; loaded = true
                if let account = store.snapshot?.users.first(where: { $0.id == id }) { name = account.s("name"); email = account.s("email"); phone = account.s("phone"); shop = account.s("store"); role = account.role ?? .merchant; membership = account.membership }
            }
            .confirmationDialog("حذف الحساب وبياناته؟ لا يمكن التراجع عن هذا الإجراء.", isPresented: $deleting) {
                Button("حذف نهائي", role: .destructive) { if let id { Task { if await store.deleteAccountByAdmin(id) { dismiss() } } } }
                Button("إلغاء", role: .cancel) {}
            }
    }
    private func save() {
        Task {
            let ok: Bool
            if let id { ok = await store.updateAccount(id: id, name: name, email: email, phone: phone, shop: shop, membership: membership) }
            else { ok = await store.createAccount(id: newID, name: name, email: email, phone: phone, password: password, role: role, membership: membership) }
            if ok { password = ""; dismiss() }
        }
    }
}

struct BroadcastView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var audience = "all"
    @State private var recipient = ""
    @State private var title = ""
    @State private var text = ""
    @State private var requestID = "broadcast-ios-" + UUID().uuidString
    private let audiences = [("all", "الجميع"), ("merchants", "جميع المستخدمين"), ("couriers", "المندوبون"), ("standard", "عادي"), ("premium", "بريميوم"), ("diamond", "ماسي"), ("user", "حساب محدد")]
    var body: some View {
        Page {
            if store.role == .admin {
                AppCard {
                    Picker("المستلمون", selection: $audience) { ForEach(audiences, id: \.0) { Text($0.1).tag($0.0) } }
                    if audience == "user" { Picker("الحساب", selection: $recipient) { Text("اختر الحساب").tag(""); ForEach(store.snapshot?.users ?? []) { Text($0.s("name")).tag($0.id) } } }
                    Input(title: "عنوان الإشعار", value: $title)
                    Input(title: "نص الإشعار", value: $text, multiline: true)
                    AppButton("إرسال التحديث", icon: "paperplane") { Task { if await store.sendBroadcast(audience: audience, recipient: recipient, title: title, text: text, requestID: requestID) { dismiss() } } }.disabled(store.busy || (audience == "user" && recipient.isEmpty))
                }
            } else { EmptyViewState(title: "هذه الصفحة للمسؤول فقط") }
        }.navigationTitle("إرسال تحديث").navigationBarTitleDisplayMode(.inline)
    }
}

struct BatchesView: View {
    @EnvironmentObject var store: AppStore
    @State private var count = "50"
    @State private var label = ""
    @State private var unusedOnly = true
    @State private var share: SharedPDF?
    var body: some View {
        Page {
            if store.role == .admin {
                AppCard {
                    Text("دفعة أكواد جديدة").font(.title2.bold())
                    Input(title: "عدد الأكواد (1–500)", value: $count, keyboard: .numberPad)
                    Input(title: "اسم الدفعة (اختياري)", value: $label)
                    Text("احجز الأكواد ثم اطبعها للزبائن. تُقرأ الملصقات بالكاميرا من تفاصيل الطرد؛ الحجز وحده لا ينشئ طرودًا.").font(.subheadline).foregroundStyle(.secondary)
                    AppButton("حجز أكواد جديدة", icon: "plus") { Task {
                        if let number = Int(normalizedDigits(count)), await store.reserveBatch(count: number, label: label) != nil { label = "" }
                        else if Int(normalizedDigits(count)) == nil { store.report("أدخل عددًا صحيحًا من 1 إلى 500.") }
                    } }.disabled(store.busy)
                }
                AppCard {
                    Toggle("طباعة الأكواد غير المستخدمة فقط", isOn: $unusedOnly).tint(.brand)
                    Text("تُحدّث حالة الاستخدام قبل الطباعة. A4 مع 24 ملصقًا لكل ورقة. لا توزّع نسختين من الكود نفسه.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(store.snapshot?.batches ?? []) { batch in
                    AppCard {
                        Text(batch.s("label").isEmpty ? "دفعة أكواد الطرود" : batch.s("label")).font(.headline)
                        let codes = (try? batchCodes(batch)) ?? []
                        Text((codes.first ?? "") + " — " + (codes.last ?? "")).font(.subheadline).environment(\.layoutDirection, .leftToRight)
                        Text("\(codes.count) كود · " + batch.s("createdAt").dateDisplay).font(.caption).foregroundStyle(.secondary)
                        Button { printBatch(batch.id) } label: { Label("طباعة / حفظ PDF", systemImage: "printer") }.buttonStyle(.borderedProminent).disabled(store.busy)
                    }
                }
            } else { EmptyViewState(title: "هذه الصفحة للمسؤول فقط") }
        }.navigationTitle("حجز الأكواد").navigationBarTitleDisplayMode(.inline).refreshable { await store.refresh() }
            .sheet(item: $share) { item in PDFShareSheet(url: item.url) }
    }
    private func printBatch(_ id: String) {
        Task {
            await store.perform {
                let payload = try await store.api.request("session"); try store.accept(payload)
                guard let current = store.snapshot, let batch = current.batches.first(where: { $0.id == id }) else { throw DomainError.message("الدفعة غير موجودة.") }
                let codes = try batchCodes(batch).filter { !unusedOnly || !current.claimedCodes.contains($0) }
                share = SharedPDF(url: try PrintDocuments.labels(codes: codes))
            }
        }
    }
}
