import SwiftUI

struct CollectionsView: View {
    @EnvironmentObject var store: AppStore
    @State private var search = ""
    var body: some View {
        List {
            if store.role == .merchant { Section { NavigationLink(value: Route.newInvoice) { Label("إنشاء فاتورة تحصيل", systemImage: "plus.circle") } } }
            let invoices = store.snapshot?.visibleCollections.filter { search.isEmpty || ($0.s("invoiceNumber") + " " + $0.s("merchantName")).localizedCaseInsensitiveContains(search) } ?? []
            if invoices.isEmpty { EmptyViewState(title: "لا توجد فواتير", icon: "list.bullet.rectangle") }
            ForEach(invoices) { invoice in
                // One native List row per card keeps the entire invoice swipeable.
                Section { InvoiceLink(invoice: invoice) }
            }
        }.listStyle(.insetGrouped).searchable(text: $search, prompt: "رقم الفاتورة أو المستخدم").refreshable { await store.refresh() }
    }
}

struct InvoiceLink: View {
    @EnvironmentObject var store: AppStore
    let invoice: Record
    private var canDelete: Bool {
        guard let snapshot = store.snapshot else { return false }
        return !store.busy && !store.offline && snapshot.canHideCollection(invoice)
    }
    var body: some View {
        NavigationLink(value: Route.invoice(invoice.id)) {
            VStack(alignment: .leading, spacing: 9) {
                HStack { Text(invoice.s("invoiceNumber")).font(.headline); Spacer(); Text(invoiceTitle(invoice.s("status"))).font(.caption).foregroundStyle(Color.brand) }
                Text(invoice.s("merchantName"))
                Text(dueTitle(invoice.n("netAmount")) + ": " + money(invoice.n("netAmount"))).font(.headline)
                Text(invoice.s("createdAt").dateDisplay).font(.caption).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8).contentShape(Rectangle())
        }
        .accessibilityIdentifier("invoice.row." + invoice.id)
        .modifier(RowDeleteActions(title: "حذف الفاتورة من قائمتك؟", message: "يمكن استعادتها من المحذوفات. يبقى سجل التسوية محفوظًا ولا تتكرر فوترة طرودها.", enabled: canDelete, buttonTitle: "حذف الفاتورة") {
            Task { _ = await store.hideCollection(invoice.id) }
        })
    }
}

struct NewInvoiceView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = []
    @State private var invoiceID = "collection-ios-" + UUID().uuidString
    @State private var code = String(Int.random(in: 1000...9999))
    var body: some View {
        List {
            Section { Text("اختر الطرود الواصلة أو الراجعة التي لم تتم تسوية محاولة شحنها الحالية.") }
            let candidates = store.snapshot.map(collectionCandidates) ?? []
            Section {
                Button("تحديد جميع الطرود المتاحة") { selected = Set(candidates.map(\.id)) }
                if candidates.isEmpty { EmptyViewState(title: "لا توجد طرود مؤهلة للتحصيل") }
                ForEach(candidates) { order in
                    Button { if selected.contains(order.id) { selected.remove(order.id) } else { selected.insert(order.id) } } label: {
                        HStack { Image(systemName: selected.contains(order.id) ? "checkmark.circle.fill" : "circle").foregroundStyle(Color.brand); OrderRow(order: order) }
                    }.buttonStyle(.plain).accessibilityAddTraits(selected.contains(order.id) ? [.isSelected] : [])
                }
            }
            if let snapshot = store.snapshot, let next = try? collectionDatabase(snapshot, selectedIDs: selected, id: invoiceID, code: code), let invoice = next.records("collections").first {
                Section("ملخص الفاتورة") {
                    DetailLine(title: "إجمالي الطرود الواصلة", value: money(invoice.n("grossAmount")))
                    DetailLine(title: "رسوم التوصيل", value: money(invoice.n("deliveryFees")))
                    DetailLine(title: "رسوم الرواجع", value: money(invoice.n("returnFees")))
                    DetailLine(title: dueTitle(invoice.n("netAmount")), value: money(invoice.n("netAmount")))
                }
            }
            Section { AppButton("إنشاء الفاتورة (\(selected.count))", icon: "checkmark.circle") { Task { if await store.createInvoice(orderIDs: selected, id: invoiceID, code: code) { dismiss() } } }.disabled(store.busy || selected.isEmpty) }
        }.navigationTitle("فاتورة تحصيل جديدة").navigationBarTitleDisplayMode(.inline).refreshable { await store.refresh() }
    }
}

struct InvoiceDetailView: View {
    @EnvironmentObject var store: AppStore
    let id: String
    @State private var code = ""
    @State private var scanner = false
    @State private var regenerate = false
    @State private var recipient = ""
    @State private var share: SharedPDF?
    private var invoice: Record? { store.snapshot?.collections.first { $0.id == id } }
    var body: some View {
        Page {
            if let invoice {
                AppCard {
                    Text(invoice.s("invoiceNumber")).font(.title.bold())
                    Text(invoice.s("merchantName")).font(.headline)
                    Text(invoiceTitle(invoice.s("status"))).font(.headline).foregroundStyle(Color.brand)
                    Text(invoice.s("createdAt").dateDisplay).font(.caption).foregroundStyle(.secondary)
                    DetailLine(title: "إجمالي الطرود", value: money(invoice.n("grossAmount")))
                    DetailLine(title: "رسوم التوصيل", value: money(invoice.n("deliveryFees")))
                    DetailLine(title: "رسوم الرواجع — مستحق للشركة", value: money(invoice.n("returnFees")))
                    Divider()
                    DetailLine(title: dueTitle(invoice.n("netAmount")), value: money(invoice.n("netAmount")))
                    Text("\(Int(invoice.n("deliveredCount"))) واصل · \(Int(invoice.n("returnedCount"))) راجع").font(.subheadline)
                    Button { do { share = SharedPDF(url: try PrintDocuments.invoice(invoice)) } catch { store.report(error.localizedDescription) } } label: { Label("طباعة / مشاركة الفاتورة", systemImage: "printer") }
                }
                if store.role == .merchant, invoice.s("merchantId") == store.user?.id, invoice.s("status") != "paid" {
                    AppCard {
                        Text("كود تحقق الفاتورة").font(.title2.bold())
                        let verification = invoice.s("verificationCode")
                        if verification.range(of: "^[0-9]{4}$", options: .regularExpression) != nil {
                            Text(verification).font(.largeTitle.monospacedDigit().bold()).environment(\.layoutDirection, .leftToRight).frame(maxWidth: .infinity)
                            QRImage(value: verification).frame(maxWidth: .infinity)
                            Button { UIPasteboard.general.setItems([["public.utf8-plain-text": verification]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)]) } label: { Label("نسخ كود التحقق", systemImage: "doc.on.doc") }
                            Text("لا تعطِ الرمز إلا للموظف عند استلام المبلغ. قراءة الرمز الصحيح تؤكد تسليم التحصيل.").font(.footnote).foregroundStyle(.secondary)
                        } else { Text("الكود غير متاح. حدّث البيانات أو أنشئ رمزًا جديدًا.") }
                        Button("إنشاء كود تحقق جديد") { regenerate = true }.disabled(store.busy)
                        Input(title: "المستلم المفوّض (اختياري)", value: $recipient)
                        Button("حفظ اسم المستلم") {
                            Task {
                                await store.perform {
                                    try await store.mutate { snapshot in
                                        snapshot.database.replacing("collections", id: id) { raw in
                                            raw.setting("authorizedRecipient", .string(recipient)).setting("updatedAt", .string(isoNow()))
                                        }
                                    }
                                }
                            }
                        }.disabled(store.busy)
                    }
                } else if store.role == .admin || store.role == .courier {
                    if invoice.s("status") != "paid" {
                        AppCard {
                            if invoice.s("status") == "pending" { AppButton("تجهيز الفاتورة", icon: "checkmark.seal") { Task { _ = await store.prepareInvoice(id) } }.disabled(store.busy) }
                            if invoice.s("status") == "ready" {
                                AppButton("قراءة كود تحقق المستخدم", icon: "qrcode.viewfinder") { scanner = true }.disabled(store.busy)
                                Input(title: "رمز التحقق المكوّن من 4 أرقام", value: $code, keyboard: .numberPad)
                                AppButton("التحقق وتأكيد التسليم") { Task { if await store.verifyInvoice(id, code: code) { code = "" } } }.disabled(store.busy || code.count != 4)
                            }
                            DetailLine(title: "المستلم المفوّض", value: invoice.s("authorizedRecipient"))
                        }
                    }
                }
                AppCard {
                    Text("طرود الفاتورة").font(.headline)
                    ForEach(store.snapshot?.orders.filter { invoice.orderIDs.contains($0.id) } ?? []) { order in NavigationLink(value: Route.order(order.id)) { OrderRow(order: order) }.buttonStyle(.plain) }
                }
            } else { EmptyViewState(title: "الفاتورة غير موجودة") }
        }.navigationTitle("تفاصيل التحصيل").navigationBarTitleDisplayMode(.inline).refreshable { await store.refresh() }
            .onAppear { recipient = invoice?.s("authorizedRecipient") ?? "" }
            .sheet(isPresented: $scanner) { ScannerSheet(title: "تأكيد استلام التحصيل") { value in code = normalizedDigits(value); Task { _ = await store.verifyInvoice(id, code: value) } } }
            .sheet(item: $share) { item in PDFShareSheet(url: item.url) }
            .confirmationDialog("إنشاء كود جديد وإبطال الكود السابق؟", isPresented: $regenerate) { Button("إنشاء كود جديد") { Task { await store.regenerateInvoiceCode(id) } }; Button("إلغاء", role: .cancel) {} }
    }
}

struct NoticesView: View {
    @EnvironmentObject var store: AppStore
    @State private var clear = false
    var body: some View {
        List {
            let notices = store.snapshot?.notices ?? []
            if notices.isEmpty { EmptyViewState(title: "لا توجد إشعارات", icon: "bell") }
            ForEach(notices) { notice in
                Button {
                    Task { await store.markNotice(notice); if !notice.s("orderId").isEmpty { store.selectedOrderID = notice.s("orderId") } }
                } label: {
                    HStack(alignment: .top) {
                        Image(systemName: notice.b("read") ? "bell" : "bell.badge.fill").foregroundStyle(Color.brand)
                        VStack(alignment: .leading, spacing: 8) { Text(notice.s("title")).font(.headline); Text(notice.s("message")); Text(notice.s("createdAt").dateDisplay).font(.caption).foregroundStyle(.secondary) }
                    }.padding(.vertical, 6)
                }.buttonStyle(.plain).swipeActions { Button("حذف", role: .destructive) { Task { await store.clearNotices([notice.id]) } } }
            }
        }.navigationTitle("الإشعارات").refreshable { await store.refresh() }
            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button("مسح الكل") { clear = true }.disabled(store.busy || store.snapshot?.notices.isEmpty != false) } }
            .confirmationDialog("حذف جميع الإشعارات؟", isPresented: $clear) { Button("حذف الكل", role: .destructive) { Task { await store.clearNotices(store.snapshot?.notices.map(\.id) ?? []) } }; Button("إلغاء", role: .cancel) {} }
    }
}
