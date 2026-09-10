import SwiftUI

struct LocalityPicker: View {
    @Environment(\.dismiss) private var dismiss
    let zone: Zone
    let onSelect: (String, String) -> Void
    @State private var search = ""
    private var regions: [DeliveryRegion] { DeliveryLocations.regions.filter { $0.zone == zone } }
    var body: some View {
        NavigationStack {
            List {
                ForEach(regions) { region in
                    let cities = region.cities.filter { search.isEmpty || DeliveryLocations.normalize($0).contains(DeliveryLocations.normalize(search)) || DeliveryLocations.normalize(region.name).contains(DeliveryLocations.normalize(search)) }
                    if !cities.isEmpty {
                        Section(region.name) {
                            ForEach(cities, id: \.self) { city in Button(city) { onSelect(region.name, city); dismiss() } }
                        }
                    }
                }
            }.searchable(text: $search, prompt: "ابحث عن المدينة أو القرية أو المحافظة")
                .navigationTitle("مدن " + zone.title).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("إلغاء") { dismiss() } } }
        }.environment(\.layoutDirection, .rightToLeft)
    }
}
