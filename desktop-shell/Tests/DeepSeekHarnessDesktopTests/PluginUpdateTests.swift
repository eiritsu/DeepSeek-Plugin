import Foundation
import Testing
@testable import DeepSeekHarnessDesktop

@Test func pluginVersionComparisonFollowsSemanticVersionOrdering() {
  #expect(PluginManager.isNewerVersion("1.3.0", than: "1.2.9"))
  #expect(PluginManager.isNewerVersion("2.0.0", than: "2.0.0-rc.2"))
  #expect(PluginManager.isNewerVersion("2.0.0-rc.10", than: "2.0.0-rc.2"))
  #expect(!PluginManager.isNewerVersion("1.9.0", than: "2.0.0-rc.2"))
  #expect(!PluginManager.isNewerVersion("1.2.3", than: "1.2.3"))
  #expect(!PluginManager.isNewerVersion("latest", than: "1.2.3"))
}

@Test func installedListOffersOnlyNewerExactNPMVersions() async throws {
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-installed-updates-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: temporaryRoot) }
  let profileRoot = temporaryRoot.appendingPathComponent("home/profiles/web", isDirectory: true)
  try FileManager.default.createDirectory(at: profileRoot, withIntermediateDirectories: true)
  try Data(#"{"dependencies":{"@fixture/current":"1.2.3","@fixture/preview":"2.0.0-rc.2","@fixture/local":"file:/tmp/plugin"},"dsh":{"profile":{"bundles":[]}}}"#.utf8)
    .write(to: profileRoot.appendingPathComponent("package.json"))
  let client = PluginCatalogClient { url in
    switch url.path {
    case "/@fixture%2Fcurrent/latest", "/@fixture/current/latest":
      return PluginHTTPPayload(status: 200, data: Data(#"{"version":"1.3.0"}"#.utf8))
    case "/@fixture%2Fpreview/latest", "/@fixture/preview/latest":
      return PluginHTTPPayload(status: 200, data: Data(#"{"version":"1.9.0"}"#.utf8))
    default:
      return PluginHTTPPayload(status: 404, data: Data())
    }
  }
  let manager = PluginManager(
    supportRoot: temporaryRoot.appendingPathComponent("support", isDirectory: true),
    dshHome: temporaryRoot.appendingPathComponent("home", isDirectory: true),
    catalogClient: client
  )

  let plugins = try await withCheckedThrowingContinuation { continuation in
    manager.list(sourceRoot: temporaryRoot) { continuation.resume(with: $0) }
  }
  let byName = Dictionary(uniqueKeysWithValues: plugins.map { ($0.name, $0) })

  #expect(byName["@fixture/current"]?.latestVersion == "1.3.0")
  #expect(byName["@fixture/preview"]?.latestVersion == nil)
  #expect(byName["@fixture/local"]?.latestVersion == nil)
}

@Test func installedUpdateCreatesANewPinnedReview() async throws {
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-installed-update-review-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: temporaryRoot) }
  let profileRoot = temporaryRoot.appendingPathComponent("home/profiles/web", isDirectory: true)
  try FileManager.default.createDirectory(at: profileRoot, withIntermediateDirectories: true)
  try Data(#"{"dependencies":{"@fixture/plugin":"1.2.3"},"dsh":{"profile":{"bundles":[]}}}"#.utf8)
    .write(to: profileRoot.appendingPathComponent("package.json"))
  let manifest = #"{"name":"@fixture/plugin","dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}"#
  let client = PluginCatalogClient { url in
    switch (url.host, url.path) {
    case ("registry.npmjs.org", "/@fixture%2Fplugin/latest"),
         ("registry.npmjs.org", "/@fixture/plugin/latest"):
      return PluginHTTPPayload(status: 200, data: Data(#"{"version":"1.3.0"}"#.utf8))
    case ("registry.npmjs.org", "/@fixture%2Fplugin/1.3.0"),
         ("registry.npmjs.org", "/@fixture/plugin/1.3.0"):
      return PluginHTTPPayload(status: 200, data: Data(manifest.utf8))
    case ("unpkg.com", "/@fixture/plugin@1.3.0/cordis.patch.yml"):
      return PluginHTTPPayload(status: 200, data: Data("plugins: []".utf8))
    default:
      return PluginHTTPPayload(status: 404, data: Data())
    }
  }
  let manager = PluginManager(
    supportRoot: temporaryRoot.appendingPathComponent("support", isDirectory: true),
    dshHome: temporaryRoot.appendingPathComponent("home", isDirectory: true),
    catalogClient: client
  )

  let report = try await withCheckedThrowingContinuation { continuation in
    manager.reviewUpdate(package: "@fixture/plugin") { continuation.resume(with: $0) }
  }

  #expect(report.source == "@fixture/plugin@1.3.0")
  #expect(report.packageName == "@fixture/plugin")
  #expect(report.installable)
  #expect(report.reviewID != nil)
}
