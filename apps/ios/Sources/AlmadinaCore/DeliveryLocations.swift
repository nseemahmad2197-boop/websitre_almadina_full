import Foundation

public struct DeliveryRegion: Identifiable, Equatable, Sendable {
    public let name: String
    public let zone: Zone
    public let cities: [String]
    public var id: String { name }
}
public enum DeliveryLocations {
    public static func normalize(_ input: String) -> String {
        input.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "[أإآ]", with: "ا", options: .regularExpression)
            .replacingOccurrences(of: "ى", with: "ي").replacingOccurrences(of: "ة", with: "ه")
            .replacingOccurrences(of: "[\\u064B-\\u065F\\u0670ـ]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "[()\\[\\]{}،,./\\\\_–—-]", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }
    public static func resolve(governorate: String, city: String, zone: Zone) -> DeliveryRegion? {
        let governorateName = normalize(governorate), cityName = normalize(city)
        let available = regions.filter { $0.zone == zone }
        if let explicit = regions.first(where: { normalize($0.name) == governorateName }) {
            return explicit.zone == zone && explicit.cities.contains(where: { normalize($0) == cityName }) ? explicit : nil
        }
        let matching = available.filter { region in region.cities.contains { normalize($0) == cityName } }
        // Repeated locality names must retain a specific governorate.
        return matching.count == 1 ? matching[0] : nil
    }
}
