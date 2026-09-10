import SwiftUI
import MapKit
import CoreLocation

@MainActor final class LocationPermission: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    @Published var point: CLLocationCoordinate2D?
    @Published var error: String?
    @Published var denied = false
    private var requested = false
    override init() { super.init(); manager.delegate = self; manager.desiredAccuracy = kCLLocationAccuracyHundredMeters }
    func request() {
        guard !requested else { return }
        requested = true
        error = nil
        denied = false
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
        default: denied = true; requested = false; error = "الموقع اختياري. فعّل الإذن من الإعدادات أو حدّد العنوان يدويًا."
        }
    }
    // Delegate requirements are nonisolated. Hop to MainActor before accessing
    // the manager or publishing UI state; never capture CLLocationManager in a Task.
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor [weak self] in self?.authorizationChanged() }
    }
    private func authorizationChanged() {
        guard requested else { return }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: denied = false; manager.requestLocation()
        case .denied, .restricted: denied = true; requested = false; error = "الموقع اختياري. فعّل الإذن من الإعدادات أو حدّد العنوان يدويًا."
        default: break
        }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let coordinate = locations.last?.coordinate else { return }
        let latitude = coordinate.latitude, longitude = coordinate.longitude
        Task { @MainActor [weak self] in
            self?.point = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
            self?.error = nil
            self?.requested = false
        }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor [weak self] in
            self?.error = "تعذّر تحديد موقع الجهاز. اختره بتحريك الخريطة أو استخدم العنوان المكتوب."
            self?.requested = false
        }
    }
    func refreshAuthorization() {
        let blocked = manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted
        if denied && !blocked { error = nil }
        denied = blocked
    }
}

struct LocationPicker: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var location = LocationPermission()
    @State private var region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 31.9, longitude: 35.2), span: MKCoordinateSpan(latitudeDelta: 0.2, longitudeDelta: 0.2))
    let onSelect: (CLLocationCoordinate2D) -> Void
    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Text("حرّك الخريطة حتى يصبح العنوان تحت العلامة.").font(.subheadline).padding(.horizontal)
                Map(coordinateRegion: $region).overlay { Image(systemName: "mappin.circle.fill").font(.largeTitle).foregroundStyle(Color.brand).accessibilityLabel("الموقع المحدد في منتصف الخريطة") }
                if let error = location.error { Text(error).font(.footnote).foregroundStyle(.secondary).padding(.horizontal) }
                if location.denied {
                    Button("فتح إعدادات الموقع") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
                }
                Button { location.request() } label: { Label("استخدام موقع الجهاز", systemImage: "location") }.padding(.bottom)
            }.navigationTitle("اختيار الموقع").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("إلغاء") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("اعتماد الموقع") { onSelect(region.center); dismiss() } }
                }
                .onReceive(location.$point) { if let point = $0 { region.center = point } }
                .onChange(of: scenePhase) { if $0 == .active { location.refreshAuthorization() } }
                .task { location.refreshAuthorization() }
        }.environment(\.layoutDirection, .rightToLeft)
    }
}
