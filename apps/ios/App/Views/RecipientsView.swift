import SwiftUI

struct RecipientsView: View {
    @EnvironmentObject var store: AppStore
    @State private var editing: Record?
    @State private var adding = false
    @State private var deleting: Record?
    @State private var search = ""
    var body: some View {
        List {
            if store.role == .merchant {
                Button { adding = true } label: { Label("إضافة مستلم", systemImage: "person.badge.plus") }
                ForEach(store.snapshot?.database.records("recipients").filter { search.isEmpty || ($0.s("name") + $0.s("phone")).localizedCaseInsensitiveContains(search) } ?? []) { recipient in
                    Button { editing = recipient } label: {
                        HStack { if recipient.b("favorite") { Image(systemName: "star.fill").foregroundStyle(.orange) }; VStack(alignment: .leading) { Text(recipient.s("name")).font(.headline); Text(recipient.s("phone") + " · " + recipient.s("city")).font(.caption) } }
                    }.swipeActions { Button("حذف", role: .destructive) { deleting = recipient } }
                }
            }
        }.navigationTitle("المستلمون").searchable(text: $search)
            .sheet(isPresented: $adding) { RecipientEditor() }
            .sheet(item: $editing) { RecipientEditor(existing: $0) }
            .confirmationDialog("حذف المستلم المحفوظ؟", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
                Button("حذف", role: .destructive) {
                    guard let item = deleting else { return }; deleting = nil
                    Task { await store.perform { try await store.mutate { $0.database.setting("recipients", .array($0.database.array("recipients").filter { $0.object.text("id") != item.id })) } } }
                }
                Button("إلغاء", role: .cancel) { deleting = nil }
            }
    }
}
struct RecipientEditor: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    var existing: Record? = nil
    @State private var id = "recipient-ios-" + UUID().uuidString
    @State private var name = ""
    @State private var phone = ""
    @State private var city = ""
    @State private var zone = Zone.westBank
    @State private var governorate = ""
    @State private var locality = false
    @State private var address = ""
    @State private var favorite = false
    var body: some View {
        NavigationStack {
            Page {
                AppCard {
                    Input(title: "الاسم", value: $name)
                    Input(title: "الجوال", value: $phone, keyboard: .phonePad)
                    Picker("نطاق التوصيل", selection: $zone) { ForEach(Zone.allCases, id: \.self) { Text($0.title).tag($0) } }
                    Button { locality = true } label: { Label(city.isEmpty ? "اختيار المدينة / القرية" : governorate + " · " + city, systemImage: "mappin.and.ellipse") }
                    Input(title: "العنوان", value: $address, multiline: true)
                    Toggle("مستلم مفضّل", isOn: $favorite)
                    AppButton("حفظ المستلم") { save() }.disabled(store.busy)
                }
            }.navigationTitle(existing == nil ? "إضافة مستلم" : "تعديل المستلم").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("إلغاء") { dismiss() } } }
                .safeAreaInset(edge: .top) { MessageBanner() }
                .sheet(isPresented: $locality) { LocalityPicker(zone: zone) { region, name in governorate = region; city = name } }
                .onAppear { if let existing { id = existing.id; name = existing.s("name"); phone = existing.s("phone"); city = existing.s("city"); governorate = existing.s("governorate"); zone = Zone.from(existing.s("governorate")); address = existing.s("address"); favorite = existing.b("favorite") } }
        }.environment(\.layoutDirection, .rightToLeft)
    }
    private func save() {
        Task {
            let success = await store.perform {
                guard name.count >= 2, validPhone(phone), !city.isEmpty, !address.isEmpty, store.role == .merchant else { throw DomainError.message("راجع الاسم والجوال والمدينة والعنوان.") }
                guard let region = DeliveryLocations.resolve(governorate: governorate, city: city, zone: zone) else { throw DomainError.message("اختر مدينة ومحافظة من النطاق المحدد.") }
                try await store.mutate { current in
                    var raw = existing?.raw ?? ["id": .string(id), "merchantId": .string(current.userId)]
                    raw.merge(["name": .string(name), "phone": .string(normalizedDigits(phone)), "governorate": .string(region.name), "city": .string(city), "address": .string(address), "favorite": .bool(favorite)]) { _, value in value }
                    let values = current.database.array("recipients").filter { $0.object.text("id") != id } + [.object(raw)]
                    return current.database.setting("recipients", .array(values))
                }
            }
            if success { dismiss() }
        }
    }
}
