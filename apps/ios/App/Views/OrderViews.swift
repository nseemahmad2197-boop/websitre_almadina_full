import SwiftUI
import UIKit

struct OrderFormView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let editing: Record?
    @State private var draft: OrderDraft
    @State private var courierID: String
    @State private var loaded = false
    @State private var completed = false
    @State private var clearConfirmation = false
    @State private var savedRecipients = false
    @State private var locality = false
    @State private var scheduled = false
    @State private var date = Date()
    init(editing: Record? = nil) {
        self.editing = editing
        _draft = State(initialValue: editing.map(OrderDraft.init(order:)) ?? OrderDraft())
        _courierID = State(initialValue: editing?.s("courierId") ?? "")
    }
    private var pricingUser: Record? { editing.flatMap { order in store.snapshot?.users.first { $0.id == order.s("merchantId") } } ?? store.user }
    var body: some View {
        Page {
            AppCard {
                Text("نوع الطرد").font(.headline)
                Picker("نوع الطرد", selection: $draft.type) { ForEach(OrderDraft.types, id: \.self) { Text($0).tag($0) } }.pickerStyle(.menu)
            }
            AppCard {
                Text("بيانات المستلم").font(.headline)
                if editing == nil { Button { savedRecipients = true } label: { Label("اختيار مستلم محفوظ", systemImage: "person.crop.circle.badge.checkmark") } }
                Input(title: "اسم المستلم", value: $draft.recipientName)
                Input(title: "رقم جوال المستلم", value: $draft.recipientPhone, keyboard: .phonePad)
                Picker("نطاق التوصيل", selection: $draft.zone) { ForEach(Zone.allCases, id: \.self) { Text($0.title).tag($0) } }
                Button { locality = true } label: { Label(draft.city.isEmpty ? "اختيار المدينة / القرية" : draft.governorate + " · " + draft.city, systemImage: "mappin.and.ellipse") }
                Input(title: "المنطقة / الشارع / وصف العنوان", value: $draft.address, multiline: true)
            }
            AppCard {
                Text("تفاصيل الطرد").font(.headline)
                Input(title: "سعر الطرد", value: $draft.amount, keyboard: .decimalPad)
                contentValueField
                Input(title: "وصف المحتوى", value: $draft.content, multiline: true)
                Picker("الوزن", selection: $draft.weight) { ForEach(Pricing.weights, id: \.self) { Text($0).tag($0) } }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 180))], spacing: 12) {
                    Input(title: "الطول (سم)", value: $draft.length, keyboard: .decimalPad)
                    Input(title: "العرض (سم)", value: $draft.width, keyboard: .decimalPad)
                    Input(title: "الارتفاع (سم)", value: $draft.height, keyboard: .decimalPad)
                }
                Input(title: "مرجع المتجر (اختياري)", value: $draft.reference)
                Toggle("تاريخ توصيل مفضّل", isOn: $scheduled).tint(.brand)
                if scheduled { DatePicker("تاريخ التوصيل", selection: $date, displayedComponents: .date).datePickerStyle(.compact) }
                if editing == nil {
                    Input(title: "تعليمات للمندوب", value: $draft.instructions, multiline: true)
                    Input(title: "ملاحظة خاصة للمسؤول", value: $draft.privateNote, multiline: true)
                } else {
                    DetailLine(title: "تعليمات المرسل", value: draft.instructions)
                    DetailLine(title: "ملاحظة المرسل الخاصة", value: draft.privateNote)
                    Text("تعليمات المرسل محفوظة كما أُنشئت. يمكن إضافة متابعة من سجل الطرد.").font(.footnote).foregroundStyle(.secondary)
                    Picker("المندوب المعيّن", selection: $courierID) {
                        Text("بانتظار تعيين المندوب").tag("")
                        ForEach(store.snapshot?.users.filter { $0.role == .courier } ?? []) { Text($0.s("name")).tag($0.id) }
                    }
                }
            }
            if let user = pricingUser {
                let price = draft.pricing(user)
                AppCard {
                    Text("ملخص الرسوم").font(.headline)
                    DetailLine(title: "رسوم النطاق", value: money(price.base))
                    DetailLine(title: "إضافة الوزن", value: money(price.weight))
                    DetailLine(title: "إضافة المقاسات", value: money(price.size))
                    DetailLine(title: "إجمالي رسوم التوصيل", value: money(price.total))
                    if let amount = decimalValue(draft.amount), amount <= 1_000_000 {
                        let net = amount - price.total
                        DetailLine(title: net < 0 ? "فرق الرسوم المستحق للشركة" : "قيمة المحتويات بعد خصم التوصيل", value: money(net))
                    }
                    Text("القياسات حتى 40 سم دون إضافة. تُحسب الزيادة لكل بُعد مستقلًا وفق رسوم الحساب.").font(.footnote).foregroundStyle(.secondary)
                }
            }
            AppButton(editing == nil ? "إنشاء الطرد" : "حفظ التعديلات", icon: "checkmark.circle") { save() }
            if editing == nil { Text("بعد إنشاء الطرد، أضف كوده من التفاصيل بمسح QR الخاص بملصق الشركة.").font(.footnote).foregroundStyle(.secondary) }
        }.disabled(store.busy).navigationTitle(editing == nil ? "إنشاء طرد" : "تعديل الطرد").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if editing == nil { ToolbarItem(placement: .navigationBarTrailing) { Button { clearConfirmation = true } label: { Label("مسح جميع الحقول", systemImage: "eraser") }.disabled(store.busy).accessibilityIdentifier("order.clear.open") } }
            }
            .confirmationDialog("مسح جميع الحقول؟", isPresented: $clearConfirmation) {
                Button("مسح جميع الحقول", role: .destructive) { clearForm() }
                    .accessibilityIdentifier("order.clear.confirm")
                Button("إلغاء", role: .cancel) {}
            }
            .sheet(isPresented: $savedRecipients) {
                NavigationStack {
                    List(store.snapshot?.database.records("recipients") ?? []) { recipient in
                        Button {
                            draft.recipientName = recipient.s("name"); draft.recipientPhone = recipient.s("phone"); draft.city = recipient.s("city"); draft.governorate = recipient.s("governorate"); draft.zone = Zone.from(recipient.s("governorate")); draft.address = recipient.s("address"); savedRecipients = false
                        } label: { VStack(alignment: .leading) { Text(recipient.s("name")); Text(recipient.s("city")).font(.caption) } }
                    }.navigationTitle("المستلمون").toolbar { ToolbarItem(placement: .cancellationAction) { Button("إغلاق") { savedRecipients = false } } }
                }.environment(\.layoutDirection, .rightToLeft)
            }
            .sheet(isPresented: $locality) { LocalityPicker(zone: draft.zone) { governorate, city in draft.governorate = governorate; draft.city = city } }
            .onChange(of: draft.zone) { _ in if DeliveryLocations.resolve(governorate: draft.governorate, city: draft.city, zone: draft.zone) == nil { draft.governorate = ""; draft.city = "" } }
            .onAppear {
                guard !loaded else { return }; loaded = true
                if editing == nil, let key = draftKey, let data = try? KeychainStore.read(key), let saved = try? JSONDecoder().decode(OrderDraft.self, from: data), store.snapshot?.orders.contains(where: { $0.id == saved.id }) != true { draft = saved }
                scheduled = !draft.preferredDate.isEmpty
                let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
                if let storedDate = formatter.date(from: draft.preferredDate) { date = storedDate }
            }
            .onDisappear { if editing == nil && !completed { persistDraft() } }
    }
    private func clearForm() {
        // Commit any active UIKit/IME edit before replacing the draft. A later
        // didEndEditing callback must not put the old text back after reset.
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        draft = OrderDraft(); scheduled = false; date = Date()
        if let key = draftKey { KeychainStore.remove(key) }
    }
    private var contentValueField: some View {
        let value = pricingUser.flatMap { draft.contentValue($0) }
        return VStack(alignment: .leading, spacing: 8) {
            Text("قيمة المحتويات بعد خصم التوصيل").font(.subheadline).foregroundStyle(.secondary)
            Text(value.map(money) ?? "تُحسب تلقائيًا")
                .font(.body.weight(.semibold)).monospacedDigit()
                .foregroundStyle(value == nil ? Color.secondary : Color.primary)
                .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
                .padding(12)
                .background(Color(uiColor: .tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("order.content-value")
                .accessibilityLabel("قيمة المحتويات بعد خصم التوصيل")
                .accessibilityValue(value.map(money) ?? "تُحسب تلقائيًا")
            if let user = pricingUser {
                let fee = draft.pricing(user).total
                Text("رسوم توصيل \(draft.zone.title) لحساب \(user.membership.title): \(money(fee))")
                    .font(.footnote).foregroundStyle(.secondary)
                if let amount = decimalValue(draft.amount), amount < fee {
                    Text("رسوم التوصيل تتجاوز سعر الطرد بمقدار \(money(fee - amount))، وهو فرق مستحق للشركة.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }
    private var draftKey: String? { store.user.map { "order-draft-" + $0.id } }
    private func persistDraft() { if let key = draftKey { try? KeychainStore.save(JSONEncoder().encode(draft), key: key) } }
    private func save() {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        draft.preferredDate = scheduled ? formatter.string(from: date) : ""
        Task {
            if editing == nil {
                // Persist before sending, including the stable ID used for retry.
                do {
                    guard let key = draftKey else { throw DomainError.message("سجّل الدخول قبل إنشاء الطرد.") }
                    try KeychainStore.save(JSONEncoder().encode(draft), key: key)
                } catch { store.report(error.localizedDescription); return }
                if let id = await store.createOrder(draft) {
                    completed = true; if let key = draftKey { KeychainStore.remove(key) }; store.selectedOrderID = id
                }
            } else if await store.saveOrder(draft, courierID: courierID) { completed = true; dismiss() }
        }
    }
}

struct OrderDetailView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var section = "details"
    @State private var scanner = false
    @State private var scanned = ""
    @State private var showQR = false
    @State private var note = ""
    @State private var newStatus = ParcelStatus.draft
    @State private var statusNote = ""
    @State private var deleteConfirmation = false
    @State private var share: SharedPDF?
    private var order: Record? { store.snapshot?.orders.first { $0.id == id } }
    var body: some View {
        Page {
            if let order {
                AppCard {
                    Text(order.codeLabel).font(.title2.bold()).textSelection(.enabled)
                    StatusBadge(status: order.status)
                    Text(order.s("createdAt").dateDisplay).font(.caption).foregroundStyle(.secondary)
                    if store.snapshot?.canAssign(order) == true {
                        AppButton(scanned.isEmpty ? "إضافة كود QR" : "قراءة QR آخر", icon: "qrcode.viewfinder") { scanner = true }.disabled(store.busy)
                        Text("امسح ملصق QR الصادر من صفحة حجز الأكواد. يُحفظ الكود تلقائيًا بعد التحقق منه.").font(.subheadline).foregroundStyle(.secondary)
                        if !scanned.isEmpty {
                            Text(scanned).font(.headline).environment(\.layoutDirection, .leftToRight)
                            Button("إعادة محاولة الحفظ") { Task { _ = await store.assignCode(orderID: id, value: scanned) } }.disabled(store.busy)
                        }
                    }
                    if !order.s("trackingNumber").isEmpty {
                        HStack {
                            Button { UIPasteboard.general.setValue(order.s("trackingNumber"), forPasteboardType: "public.utf8-plain-text") } label: { Label("نسخ الرقم", systemImage: "doc.on.doc") }
                            Spacer(); Button { showQR.toggle() } label: { Label("إظهار QR", systemImage: "qrcode") }
                        }.buttonStyle(.bordered)
                        if showQR { QRImage(value: order.s("trackingNumber")).frame(maxWidth: .infinity) }
                    }
                    Button { do { share = SharedPDF(url: try PrintDocuments.orders([order], admin: store.role == .admin)) } catch { store.report(error.localizedDescription) } } label: { Label("طباعة البيانات / مشاركة PDF", systemImage: "printer") }
                }
                Picker("القسم", selection: $section) { Text("تفاصيل الطرد").tag("details"); Text("التتبع").tag("tracking") }.pickerStyle(.segmented)
                if section == "details" {
                    AppCard {
                        Text("بيانات المستلم").font(.title3.bold())
                        DetailLine(title: "الاسم", value: order.s("recipientName"))
                        if let url = URL(string: "tel:" + order.s("recipientPhone").filter { $0.isNumber || $0 == "+" }) { Link(order.s("recipientPhone"), destination: url).environment(\.layoutDirection, .leftToRight) }
                        DetailLine(title: "العنوان", value: order.s("governorate") + " · " + order.s("city") + " · " + order.s("address"))
                    }
                    AppCard {
                        Text("تفاصيل الطرد").font(.title3.bold())
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 220))], alignment: .leading, spacing: 20) {
                            DetailLine(title: "نوع الطرد", value: order.s("type"))
                            DetailLine(title: "المحتوى", value: order.s("content"))
                            DetailLine(title: "سعر الطرد", value: money(order.n("amount")))
                            DetailLine(title: "رسوم التوصيل", value: money(order.n("deliveryFee")))
                            DetailLine(title: "إضافة الوزن / الحجم", value: money(order.n("weightFee")) + " / " + money(order.n("oversizeFee")))
                            DetailLine(title: "الوزن", value: order.s("weight"))
                            DetailLine(title: "المقاسات", value: order.s("dimensions"))
                            DetailLine(title: "التوصيل المفضّل", value: order.s("preferredDeliveryDate"))
                            DetailLine(title: "المرجع", value: order.s("reference"))
                            DetailLine(title: "المندوب", value: order.s("courierName"))
                            DetailLine(title: "تعليمات", value: order.s("notes"))
                            if store.role == .admin { DetailLine(title: "ملاحظة خاصة", value: order.s("privateNotes")) }
                        }
                    }
                } else { AppCard { Text("سجل الطرد").font(.title3.bold()); Timeline(order: order) } }
                if !order.b("deleted") {
                    AppCard {
                        Input(title: "إضافة ملاحظة إلى حالة الطرد", value: $note, multiline: true)
                        AppButton("إضافة الملاحظة", icon: "text.bubble") { Task { if await store.addNote(id, note: note) { note = "" } } }.disabled(store.busy || note.isEmpty)
                    }
                    if store.role == .admin {
                        AppCard {
                            NavigationLink { OrderFormView(editing: order) } label: { Label("تعديل بيانات الطرد", systemImage: "square.and.pencil") }
                            Picker("الحالة الجديدة", selection: $newStatus) { ForEach(ParcelStatus.allCases, id: \.self) { Text($0.title).tag($0) } }
                            Input(title: "ملاحظة تغيير الحالة", value: $statusNote, multiline: true)
                            AppButton("اعتماد الحالة") { Task { if await store.setStatus(id, status: newStatus, note: statusNote) { statusNote = "" } } }.disabled(store.busy || newStatus == order.status)
                        }
                    }
                    if store.snapshot?.canTrash(order) == true { Button("حذف الطرد", role: .destructive) { deleteConfirmation = true }.buttonStyle(.bordered).disabled(store.busy) }
                }
            } else { EmptyViewState(title: "الطرد غير موجود", description: "قد يكون حُذف أو لم يعد متاحًا لحسابك.") }
        }.navigationTitle("تفاصيل الطرد").navigationBarTitleDisplayMode(.inline).refreshable { await store.refresh() }
            .onAppear { newStatus = order?.status ?? .draft }
            .sheet(isPresented: $scanner) { ScannerSheet(title: "إضافة كود QR") { value in scanned = normalizedCode(value); Task { _ = await store.assignCode(orderID: id, value: value) } } }
            .sheet(item: $share) { item in PDFShareSheet(url: item.url) }
            .confirmationDialog("نقل الطرد إلى المحذوفات؟", isPresented: $deleteConfirmation) {
                Button("حذف الطرد", role: .destructive) { if let order { Task { if await store.trashOrder(order) { dismiss() } } } }
                Button("إلغاء", role: .cancel) {}
            }
    }
}

struct ScanLookupView: View {
    @EnvironmentObject var store: AppStore
    @State private var scanner = false
    @State private var code = ""
    var body: some View {
        Page {
            AppCard {
                Image(systemName: "qrcode.viewfinder").font(.system(size: 80)).foregroundStyle(Color.brand).frame(maxWidth: .infinity).padding()
                Text(store.role == .courier ? "قراءة كود طرد جاهز للإرسال أو راجع تحوّل حالته إلى «مشحون»." : "اقرأ الكود لفتح تفاصيل الطرد المطابق.").multilineTextAlignment(.center)
                AppButton("فتح الكاميرا", icon: "camera") { scanner = true }.disabled(store.busy)
                Divider()
                Input(title: "رقم التتبع للبحث (اختياري)", value: $code)
                AppButton(store.role == .courier ? "اعتماد الشحن" : "بحث") { handle(code) }.disabled(store.busy || code.isEmpty)
            }
        }.navigationTitle("قراءة كود الطرد").navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $scanner) { ScannerSheet(title: "قراءة كود الطرد") { code = normalizedCode($0); handle($0) } }
    }
    private func handle(_ value: String) {
        guard validCode(value) else { store.report("امسح كود طرد صحيحًا."); return }
        if store.role == .courier { Task { _ = await store.shipCode(normalizedCode(value)) } }
        else if let order = store.snapshot?.orders.first(where: { !$0.b("deleted") && !$0.s("trackingNumber").isEmpty && $0.s("trackingNumber") == normalizedCode(value) }) { store.selectedOrderID = order.id }
        else { store.report("لم نعثر على هذا الطرد ضمن حسابك. لإضافة ملصق جديد، افتح تفاصيل الطرد ثم اختر «إضافة كود QR».") }
    }
}
