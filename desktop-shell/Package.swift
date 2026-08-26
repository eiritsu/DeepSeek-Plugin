// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "DeepSeekHarnessDesktop",
  platforms: [.macOS(.v13)],
  targets: [
    .executableTarget(
      name: "DeepSeekHarnessDesktop",
      path: "Sources/DeepSeekHarnessDesktop",
      linkerSettings: [
        .linkedFramework("AppKit"),
        .linkedFramework("WebKit"),
      ],
    ),
    .testTarget(
      name: "DeepSeekHarnessDesktopTests",
      dependencies: ["DeepSeekHarnessDesktop"],
      path: "Tests/DeepSeekHarnessDesktopTests",
    ),
  ],
)
