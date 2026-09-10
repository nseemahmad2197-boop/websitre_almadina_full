import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var store: AppStore
    @State private var status: ParcelStatus?
    @State private var search = ""
    private var orders: [Record] { store.snapshot?.orders.filter { !$0.b("deleted") } ?? [] }
    var body: some View {
        let orders = self.orders
        let counts = Dictionary(grouping: orders, by: { $0.status }).mapValues(\.count)
        let delivered = counts[.delivered] ?? 0
        let filtered = orders.filter { (status == nil || $0.status == status) && matches($0, search) }
        List {
            AppCard {
                Text("أهلًا \(store.user?.s("name") ?? "")").font(.title2.bold())
                Text(store.user?.s("store") ?? "").foregroundStyle(.secondary)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 12)], spacing: 12) {
                AppCard {
                    Text("نسبة الواصل").foregroundStyle(.secondary)
                    Text("\(orders.isEmpty ? 0 : Int(Double(delivered) / Double(orders.count) * 100))٪").font(.largeTitle.bold())
                    Text("\(delivered) من \(orders.count)").font(.caption)
                }
                AppCard {
                    Text("التحصيلات غير المسلّمة").foregroundStyle(.secondary)
                    Text("\(store.snapshot?.collections.filter { $0.s("status") != "paid" }.count ?? 0)").font(.largeTitle.bold())
                    if store.role == .merchant { NavigationLink("إنشاء فاتورة", value: Route.newInvoice) }
                }
            }
            Text("حالات الطرود").font(.title2.bold())
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 155), spacing: 12)], spacing: 12) {
                ForEach(ParcelStatus.allCases, id: \.self) { item in
                    Button { status = status == item ? nil : item } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            Label(item.title, systemImage: item.symbol).font(.subheadline.weight(.semibold))
                            Text("\(counts[item] ?? 0)").font(.title.bold())
                            if status == item { Label("محددة", systemImage: "checkmark.circle.fill").font(.caption) }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(16).foregroundStyle(item.color)
                            .background(item.color.opacity(status == item ? 0.2 : 0.08), in: RoundedRectangle(cornerRadius: 18))
                            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(status == item ? item.color : .clear, lineWidth: 2))
                    }.buttonStyle(.plain).accessibilityAddTraits(status == item ? [.isSelected] : [])
                }
            }
            Input(title: "بحث في الطرود", value: $search)
            if status != nil || !search.isEmpty {
                Section {
                    HStack { Text(status.map { "طرود حالة «\($0.title)»" } ?? "نتائج البحث").font(.headline); Spacer(); Button("إلغاء التحديد") { status = nil; search = "" } }
                    if filtered.isEmpty { EmptyViewState(title: "لا توجد طرود مطابقة") }
                    ForEach(filtered) { order in ParcelLink(order: order) }
                }
            }
            Section("أحدث الطرود") {
                if orders.isEmpty { EmptyViewState(title: "لا توجد طرود بعد") }
                ForEach(Array(orders.prefix(8))) { order in ParcelLink(order: order) }
            }
        }.refreshable { await store.refresh() }.modifier(NewOrderFloatingButton())
    }
}

func matches(_ order: Record, _ query: String) -> Bool {
    let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return search.isEmpty || [order.s("trackingNumber"), order.s("recipientName"), order.s("recipientPhone"), order.s("city"), order.s("merchantName")].contains { $0.localizedCaseInsensitiveContains(search) }
}

struct ParcelsView: View {
    @EnvironmentObject var store: AppStore
    var onlyReturns = false
    @State private var search = ""
    @State private var status = "all"
    @State private var selecting = false
    @State private var selection: Set<String> = []
    @State private var share: SharedPDF?
    private var orders: [Record] { store.snapshot?.orders.filter { !$0.b("deleted") && (!onlyReturns || $0.status == .returned) && (status == "all" || $0.s("status") == status) && matches($0, search) } ?? [] }
    var body: some View {
        List {
            if !onlyReturns {
                Section {
                    Picker("الحالة", selection: $status) { Text("جميع الحالات").tag("all"); ForEach(ParcelStatus.allCases, id: \.rawValue) { Text($0.title).tag($0.rawValue) } }
                    if store.role != .courier { NavigationLink(value: Route.importCSV) { Label("استيراد ملف CSV", systemImage: "square.and.arrow.down") } }
                }
            }
            if onlyReturns, let user = store.user {
                Section("رسوم الرواجع — مستحق للشركة") { ForEach(Zone.allCases, id: \.rawValue) { zone in DetailLine(title: zone.title, value: money(Pricing.returnFee(user.membership, zone))) } }
            }
            Section {
                Button("تصدير نتائج البحث بصيغة CSV") { do { share = SharedPDF(url: try exportText(ParcelCSV.export(orders), filename: "Almadina-parcels")) } catch { store.report(error.localizedDescription) } }.disabled(orders.isEmpty)
                Toggle("تحديد طرود للطباعة", isOn: $selecting)
                if selecting {
                    Button("تحديد جميع النتائج") { selection = Set(orders.map(\.id)) }
                    Button("طباعة البيانات المحددة (\(selection.count))") { printSelected(labels: false) }.disabled(selection.isEmpty)
                    Button("طباعة ملصقات QR المحددة") { printSelected(labels: true) }.disabled(selection.isEmpty)
                }
            }
            Section(onlyReturns ? "الطرود الراجعة" : "الطرود") {
                if orders.isEmpty { EmptyViewState(title: "لا توجد طرود مطابقة") }
                ForEach(orders) { order in
                    if selecting {
                        Button { if selection.contains(order.id) { selection.remove(order.id) } else { selection.insert(order.id) } } label: { HStack { Image(systemName: selection.contains(order.id) ? "checkmark.circle.fill" : "circle"); OrderRow(order: order) } }.buttonStyle(.plain)
                    } else { ParcelLink(order: order) }
                }
            }
        }.searchable(text: $search, prompt: "الكود أو الاسم أو الجوال").refreshable { await store.refresh() }
            .modifier(NewOrderFloatingButton(enabled: !onlyReturns))
            .sheet(item: $share) { item in PDFShareSheet(url: item.url) }
    }
    private func printSelected(labels: Bool) {
        do {
            let selected = orders.filter { selection.contains($0.id) }
            let url = labels ? try PrintDocuments.labels(codes: selected.map { $0.s("trackingNumber") }.filter { !$0.isEmpty }) : try PrintDocuments.orders(selected, admin: store.role == .admin)
            share = SharedPDF(url: url)
        } catch { store.report(error.localizedDescription) }
    }
}

struct TrashView: View {
    @EnvironmentObject var store: AppStore
    @State private var restoring: Record?
    @State private var selectedOrders: Set<String> = []
    @State private var selectedInvoices: Set<String> = []
    @State private var confirmingPurge = false
    private var orders: [Record] { store.snapshot?.orders.filter { $0.b("deleted") && store.snapshot?.canTrash($0) == true } ?? [] }
    private var invoices: [Record] {
        guard let snapshot = store.snapshot else { return [] }
        let ids = snapshot.trashedCollectionIDs
        return snapshot.collections.filter { ids.contains($0.id) }
    }
    private var eligibleOrders: Set<String> { Set(orders.filter { store.snapshot?.canPurge($0) == true }.map(\.id)) }
    private var eligibleInvoices: Set<String> { Set(invoices.map(\.id)) }
    private var selectedCount: Int { selectedOrders.count + selectedInvoices.count }
    private var locked: Bool { store.busy || store.offline }
    var body: some View {
        let orders = self.orders, invoices = self.invoices
        let allowedOrderIDs = eligibleOrders, allowedInvoiceIDs = eligibleInvoices
        List {
            Section { Text("يمكن استعادة الطرد خلال 30 يومًا من حذفه. تُحذف الطرود المنتهية عند مزامنة البيانات.").font(.subheadline) }
            if !allowedOrderIDs.isEmpty || !invoices.isEmpty {
                Section {
                    Button(selectedCount == allowedOrderIDs.count + invoices.count ? "إلغاء التحديد" : "تحديد الكل") {
                        if selectedCount == allowedOrderIDs.count + invoices.count { selectedOrders = []; selectedInvoices = [] }
                        else { selectedOrders = allowedOrderIDs; selectedInvoices = allowedInvoiceIDs }
                    }.disabled(locked)
                    Button(role: .destructive) { confirmingPurge = true } label: {
                        Label("حذف المحدد (\(selectedCount))", systemImage: "trash")
                    }.disabled(locked || selectedCount == 0).accessibilityIdentifier("trash.delete-selected")
                    Text("\(selectedOrders.count) طرد · \(selectedInvoices.count) فاتورة").font(.caption).foregroundStyle(.secondary)
                }
            }
            if orders.isEmpty && invoices.isEmpty { EmptyViewState(title: "المحذوفات فارغة") }
            ForEach(orders) { order in
                VStack(alignment: .leading, spacing: 8) {
                    Button { toggle(order.id, in: &selectedOrders) } label: {
                        HStack { Image(systemName: selectedOrders.contains(order.id) ? "checkmark.circle.fill" : "circle"); OrderRow(order: order) }
                    }.buttonStyle(.plain).disabled(locked || !allowedOrderIDs.contains(order.id))
                        .accessibilityLabel("تحديد الطرد " + order.codeLabel).accessibilityAddTraits(selectedOrders.contains(order.id) ? [.isSelected] : [])
                        .accessibilityIdentifier("trash.order." + order.id)
                    if !allowedOrderIDs.contains(order.id) { Text("الطرد مرتبط بفاتورة مستحقة").font(.caption).foregroundStyle(.secondary) }
                    Text("الحذف: " + order.s("deletedAt").dateDisplay).font(.caption)
                    Button("استعادة الطرد") { restoring = order }.buttonStyle(.borderless).disabled(locked || trashExpired(order))
                }
            }
            if !invoices.isEmpty {
                Section("الفواتير المحذوفة من قائمتك") {
                    Text("يبقى سجل التسوية محفوظًا بعد حذف الفاتورة من سلة محذوفاتك.").font(.footnote)
                    ForEach(invoices) { invoice in
                        VStack(alignment: .leading, spacing: 8) {
                            Button { toggle(invoice.id, in: &selectedInvoices) } label: {
                                Label(invoice.s("invoiceNumber"), systemImage: selectedInvoices.contains(invoice.id) ? "checkmark.circle.fill" : "circle").font(.headline)
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            }.buttonStyle(.plain).disabled(locked).accessibilityLabel("تحديد الفاتورة " + invoice.s("invoiceNumber"))
                                .accessibilityAddTraits(selectedInvoices.contains(invoice.id) ? [.isSelected] : []).accessibilityIdentifier("trash.invoice." + invoice.id)
                            Button("استعادة الفاتورة") { Task { _ = await store.hideCollection(invoice.id, hidden: false) } }.buttonStyle(.borderless).disabled(locked)
                        }
                    }
                }
            }
        }.navigationTitle("المحذوفات").refreshable { await store.refresh(); await store.maintainTrash() }.task { await store.maintainTrash() }
            .onChange(of: store.snapshot?.revision) { _ in pruneSelection() }
            .onChange(of: store.snapshot?.userId) { _ in selectedOrders = []; selectedInvoices = []; confirmingPurge = false }
            .confirmationDialog("حذف المحدد نهائيًا؟", isPresented: $confirmingPurge, titleVisibility: .visible) {
                Button("حذف المحدد (\(selectedCount))", role: .destructive) {
                    let orderIDs = selectedOrders, invoiceIDs = selectedInvoices
                    Task { if await store.purgeTrash(orderIDs: orderIDs, invoiceIDs: invoiceIDs) { selectedOrders = []; selectedInvoices = [] } }
                }.disabled(locked || selectedCount == 0)
                Button("إلغاء", role: .cancel) { }
            } message: { Text("سيتم حذف \(selectedOrders.count) طرد و\(selectedInvoices.count) فاتورة من سلة محذوفاتك. لن تتمكن من استعادتها.") }
            .confirmationDialog("استعادة الطرد؟", isPresented: Binding(get: { restoring != nil }, set: { if !$0 { restoring = nil } })) {
                Button("استعادة") { if let order = restoring { Task { _ = await store.trashOrder(order, restore: true) } }; restoring = nil }
                Button("إلغاء", role: .cancel) { restoring = nil }
            }
    }
    private func toggle(_ id: String, in selection: inout Set<String>) { if selection.contains(id) { selection.remove(id) } else { selection.insert(id) } }
    private func pruneSelection() { selectedOrders.formIntersection(eligibleOrders); selectedInvoices.formIntersection(eligibleInvoices) }
}
