import AppKit
import CryptoKit
import Foundation
import Testing
@testable import DeepSeekHarnessDesktop

@Test func runtimeInstanceLockRejectsSecondOwnerUntilRelease() throws {
  let root = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-runtime-lock-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: root) }
  var first: RuntimeInstanceLock? = try RuntimeInstanceLock(supportRoot: root)

  #expect(throws: RuntimeInstanceLockError.alreadyRunning(processIdentifier: getpid())) {
    try RuntimeInstanceLock(supportRoot: root)
  }

  first?.release()
  first = nil
  #expect(throws: Never.self) {
    try RuntimeInstanceLock(supportRoot: root)
  }
  _ = first
}

@Test @MainActor func fullSizeTitlebarRetainsNativeWindowMovement() {
  let window = makeDesktopWindow()
  let region = WindowDragRegionView()

  #expect(window.styleMask.contains(.titled))
  #expect(window.styleMask.contains(.fullSizeContentView))
  #expect(window.isMovableByWindowBackground)
  #expect(region.mouseDownCanMoveWindow)
}

@Test func stderrIsLoggedWithoutReplacingStartupProgress() {
  let progress = LockedBox<[String]>([])
  let logged = LockedBox<[String]>([])
  let state = StartupState(
    progress: { text in progress.set(progress.get() + [text]) },
    log: { text in logged.set(logged.get() + [text]) }
  )

  state.consume(Data("ExperimentalWarning\n".utf8), isError: true)

  #expect(progress.get() == [])
  #expect(logged.get() == ["runtime stderr: ExperimentalWarning"])
}

@Test func readinessLineEndsStartupProgress() {
  let progress = LockedBox<[String]>([])
  let state = StartupState(
    progress: { text in progress.set(progress.get() + [text]) },
    log: { _ in }
  )

  state.consume(Data("Preparing profile\n".utf8), isError: false)
  state.consume(Data("dsh web: http://127.0.0.1:43210\n".utf8), isError: false)
  state.consume(Data("late stdout\n".utf8), isError: false)

  #expect(state.wait(timeout: .now()) == .success)
  #expect(state.outcome().0 == URL(string: "http://127.0.0.1:43210"))
  #expect(progress.get() == ["Preparing profile\n"])
}

@Test func startupFailureIdentifiesTheRootSideloadedPackage() {
  let state = StartupState(progress: { _ in }, log: { _ in })
  state.consume(Data("failed to import loader entry ui-lark (@deepseek-ai/dsh-lark/ui)\n".utf8), isError: true)
  state.terminated(status: 1)

  let failure = state.outcome().1 as? RuntimeStartupFailure
  #expect(failure?.status == 1)
  #expect(failure?.failingPluginPackage == "@deepseek-ai/dsh-lark")

  let bundleFailure = RuntimeStartupFailure(
    status: 1,
    stderr: "dsh: profile bundle \"plain-plugin\" declares no dsh.bundle"
  )
  #expect(bundleFailure.failingPluginPackage == "plain-plugin")
}

@Test func compatibleHostNodeSkipsManagedInstallation() throws {
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-host-node-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: temporaryRoot) }
  let bin = temporaryRoot.appendingPathComponent("host/bin", isDirectory: true)
  try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
  try writeExecutable("#!/bin/sh\necho v24.16.0\n", to: bin.appendingPathComponent("node"))
  try writeExecutable("#!/bin/sh\nexit 0\n", to: bin.appendingPathComponent("npx"))
  let progress = LockedBox<[String]>([])
  let unavailable = Toolchain.ManagedDistribution(
    archiveURL: URL(string: "https://127.0.0.1:1/unavailable.tar.gz")!,
    directoryName: "unavailable",
    sha256: "unavailable"
  )

  let toolchain = try Toolchain.resolve(
    supportRoot: temporaryRoot.appendingPathComponent("support", isDirectory: true),
    progress: { progress.set(progress.get() + [$0]) },
    distribution: unavailable,
    candidateDirectories: [bin.path]
  )

  #expect(toolchain.node == bin.appendingPathComponent("node"))
  #expect(progress.get().isEmpty)
}

@Test func missingHostNodeInstallsVerifiedManagedDistribution() throws {
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-managed-node-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: temporaryRoot) }
  let fixture = temporaryRoot.appendingPathComponent("fixture/node-test/bin", isDirectory: true)
  try FileManager.default.createDirectory(at: fixture, withIntermediateDirectories: true)
  try writeExecutable("#!/bin/sh\necho v24.16.0\n", to: fixture.appendingPathComponent("node"))
  try writeExecutable("#!/bin/sh\nexit 0\n", to: fixture.appendingPathComponent("npx"))
  let archive = temporaryRoot.appendingPathComponent("node.tar.gz")
  let tar = Process()
  tar.executableURL = URL(fileURLWithPath: "/usr/bin/tar")
  tar.arguments = ["-czf", archive.path, "-C", temporaryRoot.appendingPathComponent("fixture").path, "node-test"]
  try tar.run()
  tar.waitUntilExit()
  #expect(tar.terminationStatus == 0)
  let digest = SHA256.hash(data: try Data(contentsOf: archive)).map { String(format: "%02x", $0) }.joined()
  let progress = LockedBox<[String]>([])
  let support = temporaryRoot.appendingPathComponent("support", isDirectory: true)

  let toolchain = try Toolchain.installManaged(
    supportRoot: support,
    progress: { progress.set(progress.get() + [$0]) },
    distribution: Toolchain.ManagedDistribution(
      archiveURL: archive,
      directoryName: "node-test",
      sha256: digest
    ),
    candidateDirectories: []
  )

  #expect(toolchain.node == support.appendingPathComponent("tools/node/bin/node"))
  #expect(progress.get().contains { $0.contains("下载受管理的 Node.js") })
  #expect(progress.get().contains { $0.contains("安装受管理的 Node.js") })
}

@Test func managedNodeRejectsAnInvalidArchiveDigest() throws {
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-managed-node-digest-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: temporaryRoot) }
  try FileManager.default.createDirectory(at: temporaryRoot, withIntermediateDirectories: true)
  let archive = temporaryRoot.appendingPathComponent("node.tar.gz")
  try Data("not a node archive".utf8).write(to: archive)
  let support = temporaryRoot.appendingPathComponent("support", isDirectory: true)

  #expect(throws: (any Error).self) {
    try Toolchain.installManaged(
      supportRoot: support,
      progress: { _ in },
      distribution: Toolchain.ManagedDistribution(
        archiveURL: archive,
        directoryName: "node-test",
        sha256: String(repeating: "0", count: 64)
      ),
      candidateDirectories: []
    )
  }
  #expect(!FileManager.default.fileExists(atPath: support.appendingPathComponent("tools/node").path))
}

@Test func nodeCompatibilityMatchesTheRepositoryEngineRange() throws {
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-node-range-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: temporaryRoot) }
  try FileManager.default.createDirectory(at: temporaryRoot, withIntermediateDirectories: true)
  let node = temporaryRoot.appendingPathComponent("node")

  for (version, supported) in [("22.18.0", false), ("22.19.0", true), ("23.11.0", false), ("24.0.0", true)] {
    try writeExecutable("#!/bin/sh\necho v\(version)\n", to: node)
    #expect(Toolchain.supports(node: node) == supported)
  }
}

private func writeExecutable(_ contents: String, to url: URL) throws {
  try Data(contents.utf8).write(to: url)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
}

private func writePreparedSource(at root: URL, revision: String) throws {
  for path in ["apps/cli/lib", "apps/web/dist"] {
    try FileManager.default.createDirectory(
      at: root.appendingPathComponent(path, isDirectory: true),
      withIntermediateDirectories: true
    )
  }
  try Data("{}\n".utf8).write(to: root.appendingPathComponent("apps/cli/package.json"))
  try Data("export {}\n".utf8).write(to: root.appendingPathComponent("apps/cli/lib/bin.js"))
  try Data("<!doctype html>\n".utf8).write(to: root.appendingPathComponent("apps/web/dist/index.html"))
  try Data("\(revision)\n".utf8).write(to: root.appendingPathComponent("revision.txt"))
}

private func createSourceArchive(from source: URL, at archive: URL) throws {
  let tar = Process()
  tar.executableURL = URL(fileURLWithPath: "/usr/bin/tar")
  tar.arguments = ["-czf", archive.path, "-C", source.path, "."]
  try tar.run()
  tar.waitUntilExit()
  guard tar.terminationStatus == 0 else {
    throw CocoaError(.fileWriteUnknown)
  }
}

@Test func sessionSelectionBridgeRestoresAndMirrorsOnlyTheSelectionCell() {
  let selection = #"{"sessionId":"会话-1"}"#
  let source = SessionSelectionBridge.scriptSource(restoredSelection: selection)

  #expect(source.contains(Data(selection.utf8).base64EncodedString()))
  #expect(source.contains("const selectionKey = \"dsh.sessions.current\""))
  #expect(source.contains("key === selectionKey"))
  #expect(!source.contains(selection))
  #expect(SessionSelectionBridge.scriptSource(restoredSelection: nil).contains("const encodedSelection = null"))
}

@Test func sessionSelectionBridgeAcceptsOnlyLoopbackHosts() {
  #expect(SessionSelectionBridge.acceptsMessageHost("127.0.0.1"))
  #expect(SessionSelectionBridge.acceptsMessageHost("localhost"))
  #expect(!SessionSelectionBridge.acceptsMessageHost("example.com"))
}

@Test func desktopPluginPreflightAcceptsPinnedNetworkSourcesAndLocalDirectories() throws {
  let npm = try PluginManager.preflightSource("@fixture/dsh-plugin@1.2.3")
  #expect(npm.kind == "npm")
  #expect(npm.subject == "@fixture/dsh-plugin")

  let github = try PluginManager.preflightSource("https://github.com/owner/repository#A1B2C3D")
  #expect(github.source == "https://github.com/owner/repository.git#a1b2c3d")
  #expect(github.subject == "owner/repository")

  let localDirectory = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-local-plugin-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: localDirectory) }
  try FileManager.default.createDirectory(at: localDirectory, withIntermediateDirectories: true)
  let local = try PluginManager.preflightSource(localDirectory.path)
  #expect(local.kind == "local")
  #expect(local.source == localDirectory.path)
  #expect(local.installSource == "file:\(localDirectory.path)")

  #expect(throws: (any Error).self) {
    try PluginManager.preflightSource("@fixture/dsh-plugin@latest")
  }
  #expect(throws: (any Error).self) {
    try PluginManager.preflightSource("https://github.com/owner/repository")
  }
  #expect(throws: (any Error).self) {
    try PluginManager.preflightSource("https://token@github.com/owner/repository#abcdef0")
  }
}

@Test func installedListExposesDefaultBundles() async throws {
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-installed-list-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: temporaryRoot) }
  let packageRoot = temporaryRoot
    .appendingPathComponent("packages/attachment/file-recognizer-office", isDirectory: true)
  try FileManager.default.createDirectory(at: packageRoot, withIntermediateDirectories: true)
  try Data(#"{"name":"@deepseek-ai/dsh-file-recognizer-office","version":"1.2.3"}"#.utf8)
    .write(to: packageRoot.appendingPathComponent("package.json"))
  let catalogRoot = temporaryRoot
    .appendingPathComponent("packages/llm/model-catalog", isDirectory: true)
  try FileManager.default.createDirectory(at: catalogRoot, withIntermediateDirectories: true)
  try Data(#"{"name":"@deepseek-ai/dsh-model-catalog","version":"2.3.4"}"#.utf8)
    .write(to: catalogRoot.appendingPathComponent("package.json"))
  let profileRoot = temporaryRoot.appendingPathComponent("home/profiles/web", isDirectory: true)
  try FileManager.default.createDirectory(at: profileRoot, withIntermediateDirectories: true)
  try Data(#"{"dependencies":{},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-file-recognizer-office","@deepseek-ai/dsh-model-catalog"]}}}"#.utf8)
    .write(to: profileRoot.appendingPathComponent("package.json"))
  let manager = PluginManager(
    supportRoot: temporaryRoot.appendingPathComponent("support", isDirectory: true),
    dshHome: temporaryRoot.appendingPathComponent("home", isDirectory: true)
  )

  let plugins = try await withCheckedThrowingContinuation { continuation in
    manager.list(sourceRoot: temporaryRoot) { continuation.resume(with: $0) }
  }

  #expect(plugins.count == 2)
  #expect(plugins[0].name == "@deepseek-ai/dsh-file-recognizer-office")
  #expect(plugins[0].displayName == "Deepseek-Files")
  #expect(plugins[0].version == "1.2.3")
  #expect(!plugins[0].removable)
  #expect(plugins[1].name == "@deepseek-ai/dsh-model-catalog")
  #expect(plugins[1].displayName == "dsh-model-catalog")
  #expect(plugins[1].version == "2.3.4")
  #expect(!plugins[1].removable)
}

@Test func recoveryProfileTemporarilySkipsOnlyTheFailingSideloadedBundle() async throws {
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-plugin-recovery-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: temporaryRoot) }
  let home = temporaryRoot.appendingPathComponent("home", isDirectory: true)
  let web = home.appendingPathComponent("profiles/web", isDirectory: true)
  try FileManager.default.createDirectory(
    at: web.appendingPathComponent("node_modules", isDirectory: true),
    withIntermediateDirectories: true
  )
  let manifest = #"{"dependencies":{"broken-plugin":"1.0.0","healthy-plugin":"1.0.0"},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","broken-plugin","healthy-plugin"]}}}"#
  try Data(manifest.utf8).write(to: web.appendingPathComponent("package.json"))
  try Data("[]\n".utf8).write(to: web.appendingPathComponent("cordis.yml"))
  try Data("[]\n".utf8).write(to: web.appendingPathComponent("cordis.patch.yml"))
  let manager = PluginManager(
    supportRoot: temporaryRoot.appendingPathComponent("support", isDirectory: true),
    dshHome: home
  )

  let recovery = try #require(try await withCheckedThrowingContinuation { continuation in
    manager.prepareRecoveryProfile(disabling: "broken-plugin") { continuation.resume(with: $0) }
  })
  let recoveryData = try Data(contentsOf: recovery.directory.appendingPathComponent("package.json"))
  let recoveryRoot = try #require(JSONSerialization.jsonObject(with: recoveryData) as? [String: Any])
  let recoveryDsh = try #require(recoveryRoot["dsh"] as? [String: Any])
  let recoveryProfile = try #require(recoveryDsh["profile"] as? [String: Any])
  let recoveryBundles = try #require(recoveryProfile["bundles"] as? [String])
  let originalData = try Data(contentsOf: web.appendingPathComponent("package.json"))

  #expect(recoveryBundles == ["@deepseek-ai/dsh-base", "healthy-plugin"])
  #expect(originalData == Data(manifest.utf8))
  #expect(try recovery.directory.appendingPathComponent("node_modules").resourceValues(
    forKeys: [.isSymbolicLinkKey]
  ).isSymbolicLink == true)

  await withCheckedContinuation { continuation in
    manager.removeRecoveryProfile(recovery) { continuation.resume() }
  }
  #expect(!FileManager.default.fileExists(atPath: recovery.directory.path))

  let builtIn = try await withCheckedThrowingContinuation { continuation in
    manager.prepareRecoveryProfile(disabling: "@deepseek-ai/dsh-base") { continuation.resume(with: $0) }
  }
  #expect(builtIn == nil)
}

@Test func bundledSourceArchiveBootstrapsWithoutADeveloperPath() async throws {
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-source-bootstrap-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: temporaryRoot) }
  let fixture = temporaryRoot.appendingPathComponent("fixture", isDirectory: true)
  for path in ["apps/cli/lib", "apps/web/dist"] {
    try FileManager.default.createDirectory(
      at: fixture.appendingPathComponent(path, isDirectory: true),
      withIntermediateDirectories: true
    )
  }
  try Data("{}\n".utf8).write(to: fixture.appendingPathComponent("apps/cli/package.json"))
  try Data("export {}\n".utf8).write(to: fixture.appendingPathComponent("apps/cli/lib/bin.js"))
  try Data("<!doctype html>\n".utf8).write(to: fixture.appendingPathComponent("apps/web/dist/index.html"))
  let archive = temporaryRoot.appendingPathComponent("SourceBootstrap.tar.gz")
  let tar = Process()
  tar.executableURL = URL(fileURLWithPath: "/usr/bin/tar")
  tar.arguments = ["-czf", archive.path, "-C", fixture.path, "."]
  try tar.run()
  tar.waitUntilExit()
  #expect(tar.terminationStatus == 0)
  let suiteName = "dsh-source-bootstrap-\(UUID().uuidString)"
  let defaults = try #require(UserDefaults(suiteName: suiteName))
  defer { defaults.removePersistentDomain(forName: suiteName) }
  let support = temporaryRoot.appendingPathComponent("support", isDirectory: true)
  let manager = SourceManager(
    supportRoot: support,
    defaults: defaults,
    bootstrapArchive: archive,
    bootstrapVersion: "0.1.2"
  )

  let source = try await withCheckedThrowingContinuation { continuation in
    manager.resolveAndPrepare(progress: { _ in }) { continuation.resume(with: $0) }
  }

  #expect(source == support.appendingPathComponent("source", isDirectory: true))
  #expect(FileManager.default.fileExists(atPath: source.appendingPathComponent("apps/cli/lib/bin.js").path))
  #expect(try String(contentsOf: source.appendingPathComponent(".dsh-desktop-bootstrap-version"), encoding: .utf8) == "0.1.2\n")
}

@Test func bootstrapIdentityChangesWithEveryApplicationBuild() {
  #expect(SourceManager.bootstrapIdentity(version: "0.1.3", build: "20260826070000") == "0.1.3+20260826070000")
  #expect(SourceManager.bootstrapIdentity(version: "0.1.3", build: "20260826070001") == "0.1.3+20260826070001")
  #expect(SourceManager.bootstrapIdentity(version: nil, build: "1") == nil)
  #expect(SourceManager.bootstrapIdentity(version: "0.1.3", build: nil) == nil)
}

@Test func newerApplicationReplacesAnOlderManagedSourceSnapshot() async throws {
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-source-upgrade-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: temporaryRoot) }
  let support = temporaryRoot.appendingPathComponent("support", isDirectory: true)
  let installed = support.appendingPathComponent("source", isDirectory: true)
  try writePreparedSource(at: installed, revision: "old")
  try "0.1.1\n".write(
    to: installed.appendingPathComponent(".dsh-desktop-bootstrap-version"),
    atomically: true,
    encoding: .utf8
  )
  let fixture = temporaryRoot.appendingPathComponent("fixture", isDirectory: true)
  try writePreparedSource(at: fixture, revision: "new")
  let archive = temporaryRoot.appendingPathComponent("SourceBootstrap.tar.gz")
  try createSourceArchive(from: fixture, at: archive)
  let suiteName = "dsh-source-upgrade-\(UUID().uuidString)"
  let defaults = try #require(UserDefaults(suiteName: suiteName))
  defer { defaults.removePersistentDomain(forName: suiteName) }
  defaults.set(installed.path, forKey: "activeSourceRoot")
  let manager = SourceManager(
    supportRoot: support,
    defaults: defaults,
    bootstrapArchive: archive,
    bootstrapVersion: "0.1.2"
  )

  let source = try await withCheckedThrowingContinuation { continuation in
    manager.resolveAndPrepare(progress: { _ in }) { continuation.resume(with: $0) }
  }

  #expect(try String(contentsOf: source.appendingPathComponent("revision.txt"), encoding: .utf8) == "new\n")
  #expect(try String(contentsOf: source.appendingPathComponent(".dsh-desktop-bootstrap-version"), encoding: .utf8) == "0.1.2\n")
}

@Test func desktopPluginInspectionClassifiesBundleEligibility() throws {
  let bundleManifest = """
  {
    "name": "@fixture/direct",
    "dsh": {"bundle": {"patch": "./dsh/cordis.patch.yml"}},
    "scripts": {"prepare": "build"}
  }
  """
  let bundle = try PluginCatalogClient.inspectManifest(
    Data(bundleManifest.utf8),
    origin: .repository
  ) { path in
    path == "dsh/cordis.patch.yml"
  }
  #expect(bundle.category == .profileBundle)
  #expect(bundle.installable)
  #expect(bundle.packageName == "@fixture/direct")
  #expect(bundle.findings.contains { $0.contains("lifecycle script") })

  let adapter = try PluginCatalogClient.inspectManifest(
    Data(#"{"name":"fixture-library"}"#.utf8),
    origin: .repository
  ) { _ in
    false
  }
  #expect(adapter.category == .needsAdapter)
  #expect(!adapter.installable)

  let external = try PluginCatalogClient.inspectManifest(nil, origin: .repository) { _ in false }
  #expect(external.category == .externalProject)

  let blockedManifest = """
  {
    "name": "fixture-broken",
    "dsh": {"bundle": {"patch": "../outside.yml"}}
  }
  """
  let blocked = try PluginCatalogClient.inspectManifest(
    Data(blockedManifest.utf8),
    origin: .repository
  ) { _ in true }
  #expect(blocked.category == .blocked)
  #expect(!blocked.installable)

  let ambiguousURLManifest = """
  {
    "name": "fixture-ambiguous-url",
    "dsh": {"bundle": {"patch": "./dsh/entry#fragment.yml"}}
  }
  """
  let ambiguousURL = try PluginCatalogClient.inspectManifest(
    Data(ambiguousURLManifest.utf8),
    origin: .repository
  ) { _ in true }
  #expect(ambiguousURL.category == .blocked)
  #expect(!ambiguousURL.installable)
}

@Test func npmWorkspaceRuntimeDependenciesBecomeExplicitOverrideRisks() throws {
  let manifest = """
  {
    "name": "@fixture/risky",
    "dsh": {"bundle": {"patch": "./cordis.patch.yml"}},
    "dependencies": {"@fixture/events": "workspace:*"},
    "optionalDependencies": {"@fixture/optional": "workspace:^"},
    "peerDependencies": {"@fixture/cordis": "workspace:~"},
    "devDependencies": {"@fixture/build-only": "workspace:*"}
  }
  """
  let published = try PluginCatalogClient.inspectManifest(
    Data(manifest.utf8),
    origin: .npmRegistry
  ) { _ in true }
  #expect(published.category == .profileBundle)
  #expect(published.installable)
  #expect(published.risks.count == 3)
  #expect(published.risks.contains { $0.contains("dependencies 中的 @fixture/events") })
  #expect(published.risks.contains { $0.contains("optionalDependencies 中的 @fixture/optional") })
  #expect(published.risks.contains { $0.contains("peerDependencies 中的 @fixture/cordis") })
  #expect(!published.risks.contains { $0.contains("build-only") })

  let repository = try PluginCatalogClient.inspectManifest(
    Data(manifest.utf8),
    origin: .repository
  ) { _ in true }
  #expect(repository.installable)
  #expect(repository.risks.isEmpty)

  let local = try PluginCatalogClient.inspectManifest(
    Data(manifest.utf8),
    origin: .localDirectory
  ) { _ in true }
  #expect(local.installable)
  #expect(local.risks.count == 3)
}

@Test func localPluginDirectoryReviewChecksTheBundleEntry() async throws {
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-local-review-\(UUID().uuidString)", isDirectory: true)
  defer { try? FileManager.default.removeItem(at: temporaryRoot) }
  let pluginRoot = temporaryRoot.appendingPathComponent("plugin", isDirectory: true)
  try FileManager.default.createDirectory(at: pluginRoot, withIntermediateDirectories: true)
  try Data(#"{"name":"@fixture/local","dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}"#.utf8)
    .write(to: pluginRoot.appendingPathComponent("package.json"))
  try Data("[]\n".utf8).write(to: pluginRoot.appendingPathComponent("cordis.patch.yml"))
  let manager = PluginManager(
    supportRoot: temporaryRoot.appendingPathComponent("support", isDirectory: true),
    dshHome: temporaryRoot.appendingPathComponent("home", isDirectory: true)
  )

  let report = try await withCheckedThrowingContinuation { continuation in
    manager.review(source: pluginRoot.path) { continuation.resume(with: $0) }
  }

  #expect(report.kind == "local")
  #expect(report.subject == "@fixture/local")
  #expect(report.category == .profileBundle)
  #expect(report.installable)
  #expect(report.reviewID != nil)
}

@Test func thirdPartyCatalogCarriesServerPaginationCategoriesAndSorting() throws {
  let requestedURL = LockedBox<URL?>(nil)
  let response = """
  {
    "page": 3,
    "limit": 1,
    "total": 271,
    "totalPages": 271,
    "catalogTotal": 9222,
    "categories": [{"id":"memory","en":"Memory","zh":"记忆","count":271}],
    "plugins": [{
      "id":"MemTensor/MemOS/apps/memos-local-plugin",
      "name":"memos-local-plugin",
      "owner":"MemTensor",
      "url":"https://github.com/MemTensor/MemOS",
      "repository":"MemOS",
      "category":"memory",
      "description":{"en":"Persistent memory.","zh":"持久记忆。"},
      "stars":10930
    }]
  }
  """
  let client = PluginCatalogClient { url in
    requestedURL.set(url)
    return PluginHTTPPayload(status: 200, data: Data(response.utf8))
  }
  let page = try client.thirdPartyCatalog(
    page: 3,
    pageSize: 1,
    query: "memory",
    category: "memory",
    sort: "active"
  )
  let url = try #require(requestedURL.get())
  let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
  let queryItems = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })

  #expect(page.plugins.count == 1)
  #expect(page.plugins[0].repository == "MemTensor/MemOS")
  #expect(page.plugins[0].categoryID == "memory")
  #expect(page.plugins[0].chineseDescription == "持久记忆。")
  #expect(page.catalogTotal == 9_222)
  #expect(page.categories[0].chineseName == "记忆")
  #expect(page.hasMore)
  #expect(queryItems["page"] == "3")
  #expect(queryItems["limit"] == "1")
  #expect(queryItems["q"] == "memory")
  #expect(queryItems["category"] == "memory")
  #expect(queryItems["sort"] == "active")
}

@Test func thirdPartyReviewResolvesAnExactNPMVersionBeforeInspection() async throws {
  let catalogJSON = """
  {
    "page":1,"limit":12,"total":1,"totalPages":1,"catalogTotal":9222,
    "categories":[{"id":"tools","en":"Tools & Capabilities","zh":"工具与能力","count":2841}],
    "plugins":[{
      "id":"owner/repository/packages/plugin","name":"plugin","owner":"owner",
      "url":"https://github.com/owner/repository","repository":"repository","category":"tools",
      "description":{"en":"Fixture.","zh":"Fixture."},"stars":7
    }]
  }
  """
  let manifest = #"{"name":"@fixture/plugin","dsh":{"bundle":{"patch":"./dsh/cordis.patch.yml"}},"dependencies":{"@fixture/events":"workspace:*"}}"#
  let client = PluginCatalogClient { url in
    switch (url.host, url.path) {
    case ("deepseek1024.com", "/api/v2/plugins"):
      return PluginHTTPPayload(status: 200, data: Data(catalogJSON.utf8))
    case ("deepseek1024.com", "/plugins/owner/repository/packages/plugin"):
      return PluginHTTPPayload(
        status: 200,
        data: Data("<code>dsh plugin --profile web add @fixture/plugin</code>".utf8)
      )
    case ("registry.npmjs.org", "/@fixture%2Fplugin/latest"),
         ("registry.npmjs.org", "/@fixture/plugin/latest"):
      return PluginHTTPPayload(status: 200, data: Data(#"{"version":"1.2.3"}"#.utf8))
    case ("registry.npmjs.org", "/@fixture%2Fplugin/1.2.3"),
         ("registry.npmjs.org", "/@fixture/plugin/1.2.3"):
      return PluginHTTPPayload(status: 200, data: Data(manifest.utf8))
    case ("unpkg.com", "/@fixture/plugin@1.2.3/dsh/cordis.patch.yml"):
      return PluginHTTPPayload(status: 200, data: Data("plugins: []".utf8))
    default:
      return PluginHTTPPayload(status: 404, data: Data())
    }
  }
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-third-party-review-\(UUID().uuidString)", isDirectory: true)
  let manager = PluginManager(
    supportRoot: temporaryRoot,
    dshHome: temporaryRoot.appendingPathComponent("data", isDirectory: true),
    catalogClient: client
  )
  let catalog = try await withCheckedThrowingContinuation { continuation in
    manager.thirdPartyCatalog(page: 1, pageSize: 12, query: "", category: "", sort: "stars") {
      continuation.resume(with: $0)
    }
  }
  let report = try await withCheckedThrowingContinuation { continuation in
    manager.reviewThirdParty(id: catalog.plugins[0].id) { continuation.resume(with: $0) }
  }

  #expect(report.source == "@fixture/plugin@1.2.3")
  #expect(report.category == .profileBundle)
  #expect(report.installable)
  #expect(report.requiresForceInstall)
  #expect(report.risks.count == 1)
  #expect(report.risks[0].contains("@fixture/events"))
  #expect(report.reviewID != nil)

  let reviewID = try #require(report.reviewID)
  let denied = await withCheckedContinuation { continuation in
    manager.install(
      sourceRoot: temporaryRoot,
      reviewID: reviewID,
      force: false,
      progress: { _ in }
    ) { continuation.resume(returning: $0) }
  }
  switch denied {
  case .success:
    Issue.record("risk-bearing review must require explicit force installation")
  case let .failure(error):
    #expect(error.localizedDescription.contains("强制安装"))
  }

  let cancelled = await withCheckedContinuation { continuation in
    manager.cancelReview(reviewID: reviewID) { continuation.resume(returning: $0) }
  }
  if case let .failure(error) = cancelled {
    Issue.record("review cancellation failed: \(error.localizedDescription)")
  }
  let afterCancellation = await withCheckedContinuation { continuation in
    manager.install(
      sourceRoot: temporaryRoot,
      reviewID: reviewID,
      force: true,
      progress: { _ in }
    ) { continuation.resume(returning: $0) }
  }
  switch afterCancellation {
  case .success:
    Issue.record("cancelled review token must not remain installable")
  case let .failure(error):
    #expect(error.localizedDescription.contains("审查记录不存在"))
  }
}

@Test func githubCatalogCarriesSearchAndPaginationThroughTheNativeRequest() throws {
  let requestedURL = LockedBox<URL?>(nil)
  let client = PluginCatalogClient { url in
    if url.host == "api.github.com" {
      requestedURL.set(url)
      let response = """
      {
        "total_count": 3,
        "items": [{
          "full_name": "fixture/memory-plugin",
          "description": "Memory",
          "stargazers_count": 2,
          "language": "TypeScript",
          "html_url": "https://github.com/fixture/memory-plugin",
          "default_branch": "main",
          "pushed_at": "2026-08-23T08:00:00Z"
        }]
      }
      """
      return PluginHTTPPayload(status: 200, data: Data(response.utf8))
    }
    return PluginHTTPPayload(status: 404, data: Data())
  }

  let page = try client.catalog(page: 2, pageSize: 1, query: "memory")
  let url = try #require(requestedURL.get())
  let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
  let queryItems = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })

  #expect(page.plugins.count == 1)
  #expect(page.hasMore)
  #expect(queryItems["page"] == "2")
  #expect(queryItems["per_page"] == "1")
  #expect(queryItems["q"] == "topic:dsh-plugin memory")
}

@Test func desktopPluginReviewDoesNotIssueTokenForExternalProject() async throws {
  let client = PluginCatalogClient { url in
    if url.host == "api.github.com" {
      return PluginHTTPPayload(status: 200, data: Data(#"{"sha":"abcdef0"}"#.utf8))
    }
    return PluginHTTPPayload(status: 404, data: Data())
  }
  let temporaryRoot = FileManager.default.temporaryDirectory
    .appendingPathComponent("dsh-plugin-review-\(UUID().uuidString)", isDirectory: true)
  let manager = PluginManager(
    supportRoot: temporaryRoot,
    dshHome: temporaryRoot.appendingPathComponent("data", isDirectory: true),
    catalogClient: client
  )

  let report = try await withCheckedThrowingContinuation { continuation in
    manager.review(source: "https://github.com/fixture/python-service#abcdef0") {
      continuation.resume(with: $0)
    }
  }

  #expect(report.category == .externalProject)
  #expect(!report.installable)
  #expect(report.reviewID == nil)
}
