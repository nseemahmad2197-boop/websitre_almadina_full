// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AlmadinaCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "AlmadinaCore", targets: ["AlmadinaCore"])],
    targets: [
        .target(name: "AlmadinaCore"),
        .testTarget(name: "AlmadinaCoreTests", dependencies: ["AlmadinaCore"])
    ]
)
