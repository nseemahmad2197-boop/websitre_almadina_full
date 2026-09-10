import SwiftUI
import UniformTypeIdentifiers

struct ImportView: View {
    @EnvironmentObject var store: AppStore
    @State private var importer = false
    @State private var drafts: [OrderDraft] = []
    @State private var share: SharedPDF?
    var body: some View {
        Page {
            AppCard {
                Text("استيراد طرود من CSV").font(.title2.bold())
                Text("احفظ ورقة Excel بصيغة CSV UTF-8. يمكن استيراد حتى 500 طرد. تُنشأ جميع الطرود دون كود، وتُضاف أكواد QR من التفاصيل بعد الاستيراد.")
                Button("تنزيل قالب الأعمدة") { do { share = SharedPDF(url: try exportText(ParcelCSV.template(), filename: "Almadina-import-template")) } catch { store.report(error.localizedDescription) } }
                AppButton("اختيار ملف CSV", icon: "doc.badge.plus") { importer = true }.disabled(store.busy || !drafts.isEmpty)
                if !drafts.isEmpty {
                    Text("\(drafts.count) طرد جاهز. عند تعذّر تأكيد الحفظ أعد المحاولة بالدفعة نفسها.").font(.headline)
                    AppButton("استيراد الدفعة", icon: "square.and.arrow.down") { submit() }.disabled(store.busy)
                    Button("إلغاء الدفعة المحلية", role: .destructive) { drafts = []; if let key { KeychainStore.remove(key) } }.disabled(store.busy)
                }
            }
            ForEach(Array(drafts.prefix(20)), id: \.id) { draft in AppCard { Text(draft.recipientName).font(.headline); Text(draft.city + " · " + draft.recipientPhone); Text(money(decimalValue(draft.amount) ?? 0)) } }
        }.navigationTitle("استيراد CSV").navigationBarTitleDisplayMode(.inline)
            .fileImporter(isPresented: $importer, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
                do {
                    let url = try result.get(); let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
                    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize
                    guard let size, size <= 5_000_000 else { throw DomainError.message("اختر ملف CSV لا يتجاوز 5 MB.") }
                    let data = try Data(contentsOf: url)
                    guard let text = String(data: data, encoding: .utf8) else { throw DomainError.message("احفظ الملف بترميز UTF-8.") }
                    let parsed = try ParcelCSV.drafts(text)
                    if let key { try KeychainStore.save(JSONEncoder().encode(parsed), key: key) }
                    drafts = parsed
                } catch { store.report(error.localizedDescription) }
            }
            .sheet(item: $share) { item in PDFShareSheet(url: item.url) }
            .onAppear { if let key, let data = try? KeychainStore.read(key), let pending = try? JSONDecoder().decode([OrderDraft].self, from: data) { drafts = pending } }
    }
    private var key: String? { store.user.map { "pending-import-" + $0.id } }
    private func submit() {
        Task {
            let success = await store.perform {
                guard let user = store.user, store.role != .courier, !drafts.isEmpty else { throw DomainError.message("الاستيراد غير متاح.") }
                let orders = try drafts.map { try $0.newOrder(user: user) }
                try await store.postSnapshot("orders", body: ["orders": .array(orders.map(JSONValue.object))])
                let ids = Set(store.snapshot?.orders.map(\.id) ?? [])
                guard drafts.allSatisfy({ ids.contains($0.id) }) else { throw DomainError.message("لم يصل تأكيد كامل. أعد المحاولة بالدفعة نفسها.") }
            }
            if success { drafts = []; if let key { KeychainStore.remove(key) }; store.report("تم استيراد الطرود. افتح تفاصيل كل طرد لإضافة كود QR.") }
        }
    }
}
func exportText(_ text: String, filename: String) throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename + "-" + UUID().uuidString + ".csv")
    try Data(text.utf8).write(to: url, options: [.atomic, .completeFileProtection]); return url
}
