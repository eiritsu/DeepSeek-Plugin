import Darwin
import Foundation

struct DesktopInstalledPlugin: Sendable {
  let name: String
  let displayName: String
  let version: String
  let latestVersion: String?
  let removable: Bool
}

private struct DesktopPluginVersion: Comparable {
  private enum Identifier: Equatable {
    case number(Int)
    case text(String)
  }

  private let core: [Int]
  private let prerelease: [Identifier]?

  init?(_ value: String) {
    let components = value.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
    let core = components[0].split(separator: ".", omittingEmptySubsequences: false)
    guard core.count == 3,
          core.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) }),
          core.compactMap({ Int($0) }).count == 3
    else { return nil }
    self.core = core.compactMap { Int($0) }
    if components.count == 1 {
      prerelease = nil
      return
    }
    let parts = components[1].split(separator: ".", omittingEmptySubsequences: false)
    guard !parts.isEmpty, parts.allSatisfy({ !$0.isEmpty }) else { return nil }
    prerelease = parts.map { part in
      if part.allSatisfy(\.isNumber), let number = Int(part) { return .number(number) }
      return .text(String(part))
    }
  }

  static func < (lhs: DesktopPluginVersion, rhs: DesktopPluginVersion) -> Bool {
    for index in lhs.core.indices where lhs.core[index] != rhs.core[index] {
      return lhs.core[index] < rhs.core[index]
    }
    switch (lhs.prerelease, rhs.prerelease) {
    case (nil, nil): return false
    case (nil, _): return false
    case (_, nil): return true
    case let (.some(left), .some(right)):
      for index in 0..<min(left.count, right.count) where left[index] != right[index] {
        switch (left[index], right[index]) {
        case let (.number(a), .number(b)): return a < b
        case (.number, .text): return true
        case (.text, .number): return false
        case let (.text(a), .text(b)): return a < b
        }
      }
      return left.count < right.count
    }
  }
}

struct DesktopPluginReview: Sendable {
  let reviewID: String?
  let source: String
  let kind: String
  let subject: String
  let category: DesktopPluginCategory
  let installable: Bool
  let requiresForceInstall: Bool
  let packageName: String?
  let findings: [String]
  let risks: [String]
  let expiresAt: String
}

struct DesktopPluginAuditRecord: Codable, Sendable {
  let id: String
  let timestamp: String
  let action: String
  let subject: String
  let status: String
  let message: String
}

struct NormalizedPluginSource: Sendable {
  let source: String
  let installSource: String
  let kind: String
  let subject: String
  let pinFinding: String
}

struct DesktopRecoveryProfile: Sendable {
  let name: String
  let directory: URL
  let disabledPackage: String
}

final class PluginManager: @unchecked Sendable {
  private struct CatalogCacheKey: Hashable {
    let page: Int
    let pageSize: Int
    let query: String
  }

  private struct ThirdPartyCatalogCacheKey: Hashable {
    let page: Int
    let pageSize: Int
    let query: String
    let category: String
    let sort: String
  }

  private struct PendingReview {
    let source: String
    let installSource: String
    let kind: String
    let subject: String
    let requiresForceInstall: Bool
    let expiresAt: Date
  }

  private let queue = DispatchQueue(label: "ai.deepseek.harness.desktop.plugins", qos: .userInitiated)
  private let supportRoot: URL
  private let dshHome: URL
  private let auditURL: URL
  private let catalogClient: PluginCatalogClient
  private var pendingReviews: [String: PendingReview] = [:]
  private var catalogCache: [CatalogCacheKey: (
    expiresAt: Date,
    page: DesktopCatalogPage<DesktopCommunityPlugin>
  )] = [:]
  private var thirdPartyCatalogCache: [ThirdPartyCatalogCacheKey: (
    expiresAt: Date,
    page: DesktopThirdPartyCatalogPage
  )] = [:]
  private var thirdPartyPluginsByID: [String: DesktopThirdPartyPlugin] = [:]

  init(
    supportRoot: URL,
    dshHome: URL,
    catalogClient: PluginCatalogClient = PluginCatalogClient()
  ) {
    self.supportRoot = supportRoot
    self.dshHome = dshHome
    self.auditURL = supportRoot.appendingPathComponent("logs/plugin-audit.jsonl")
    self.catalogClient = catalogClient
  }

  func run(
    sourceRoot: URL,
    arguments: [String],
    progress: @escaping @Sendable (String) -> Void,
    completion: @escaping @Sendable (Result<String, Error>) -> Void
  ) {
    queue.async {
      do {
        let result = try self.runCommand(sourceRoot: sourceRoot, arguments: arguments, progress: progress)
        completion(.success(result.output))
      } catch {
        completion(.failure(error))
      }
    }
  }

  func prepareRecoveryProfile(
    disabling package: String,
    completion: @escaping @Sendable (Result<DesktopRecoveryProfile?, Error>) -> Void
  ) {
    queue.async {
      do {
        completion(.success(try self.makeRecoveryProfile(disabling: package)))
      } catch {
        completion(.failure(error))
      }
    }
  }

  func removeRecoveryProfile(
    _ profile: DesktopRecoveryProfile,
    completion: @escaping @Sendable () -> Void = {}
  ) {
    queue.async {
      do {
        try self.removeRecoveryDirectory(profile.directory)
      } catch {
        LogStore.shared.append("plugin recovery cleanup failed: \(error.localizedDescription)")
      }
      completion()
    }
  }

  func list(
    sourceRoot: URL,
    completion: @escaping @Sendable (Result<[DesktopInstalledPlugin], Error>) -> Void
  ) {
    queue.async {
      do {
        let manifest = self.dshHome.appendingPathComponent("profiles/web/package.json")
        let data = try Data(contentsOf: manifest)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dependencies = root["dependencies"] as? [String: String]
        else {
          throw DesktopError.message("Web profile 的插件清单格式无效。")
        }
        let bundles = ((root["dsh"] as? [String: Any])?["profile"] as? [String: Any])?["bundles"] as? [String] ?? []
        let displayNames = [
          "@deepseek-ai/dsh-file-recognizer-office": "Deepseek-Files",
          "@deepseek-ai/dsh-model-catalog": "dsh-model-catalog",
        ]
        var plugins = dependencies.map { dependency in
          let latestVersion: String?
          if let current = DesktopPluginVersion(dependency.value),
             let latest = try? self.catalogClient.latestNPMVersion(package: dependency.key),
             let candidate = DesktopPluginVersion(latest),
             candidate > current {
            latestVersion = latest
          } else {
            latestVersion = nil
          }
          return DesktopInstalledPlugin(
            name: dependency.key,
            displayName: displayNames[dependency.key] ?? dependency.key,
            version: dependency.value,
            latestVersion: latestVersion,
            removable: true
          )
        }
        let builtInBundles = [
          (
            name: "@deepseek-ai/dsh-file-recognizer-office",
            displayName: "Deepseek-Files",
            manifestPath: "packages/attachment/file-recognizer-office/package.json"
          ),
          (
            name: "@deepseek-ai/dsh-model-catalog",
            displayName: "dsh-model-catalog",
            manifestPath: "packages/llm/model-catalog/package.json"
          ),
        ]
        for bundle in builtInBundles where bundles.contains(bundle.name) && !dependencies.keys.contains(bundle.name) {
          let sourceManifest = sourceRoot
            .appendingPathComponent(bundle.manifestPath)
          let sourceData = try Data(contentsOf: sourceManifest)
          let sourceManifestRoot = try JSONSerialization.jsonObject(with: sourceData) as? [String: Any]
          guard let version = sourceManifestRoot?["version"] as? String else {
            throw DesktopError.message("\(bundle.displayName) 插件清单格式无效。")
          }
          plugins.append(DesktopInstalledPlugin(
            name: bundle.name,
            displayName: bundle.displayName,
            version: version,
            latestVersion: nil,
            removable: false
          ))
        }
        plugins = plugins
          .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        completion(.success(plugins))
      } catch {
        completion(.failure(error))
      }
    }
  }

  func review(source: String, completion: @escaping @Sendable (Result<DesktopPluginReview, Error>) -> Void) {
    queue.async {
      do {
        let report = try self.makeReview(source: source)
        completion(.success(report))
      } catch {
        self.appendAudit(action: "review", subject: source, status: "failure", message: error.localizedDescription)
        completion(.failure(error))
      }
    }
  }

  func reviewUpdate(
    package: String,
    completion: @escaping @Sendable (Result<DesktopPluginReview, Error>) -> Void
  ) {
    queue.async {
      do {
        guard Self.isPackageName(package) else {
          throw DesktopError.message("插件包名格式无效。")
        }
        let manifest = self.dshHome.appendingPathComponent("profiles/web/package.json")
        let data = try Data(contentsOf: manifest)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dependencies = root["dependencies"] as? [String: String],
              let currentText = dependencies[package],
              let current = DesktopPluginVersion(currentText)
        else {
          throw DesktopError.message("该插件不是以 npm 精确版本安装，无法自动检查更新。")
        }
        let latestText = try self.catalogClient.latestNPMVersion(package: package)
        guard let latest = DesktopPluginVersion(latestText), latest > current else {
          throw DesktopError.message("该插件已经是最新版本。")
        }
        let report = try self.makeReview(source: "\(package)@\(latestText)")
        guard report.packageName == package else {
          throw DesktopError.message("更新来源的 package 名称与已安装插件不一致。")
        }
        completion(.success(report))
      } catch {
        self.appendAudit(
          action: "update-review",
          subject: package,
          status: "failure",
          message: error.localizedDescription
        )
        completion(.failure(error))
      }
    }
  }

  static func isNewerVersion(_ candidate: String, than current: String) -> Bool {
    guard let candidate = DesktopPluginVersion(candidate), let current = DesktopPluginVersion(current) else {
      return false
    }
    return candidate > current
  }

  func catalog(
    page: Int,
    pageSize: Int,
    query: String,
    completion: @escaping @Sendable (
      Result<DesktopCatalogPage<DesktopCommunityPlugin>, Error>
    ) -> Void
  ) {
    queue.async {
      do {
        let key = CatalogCacheKey(
          page: max(1, min(page, 50)),
          pageSize: max(1, min(pageSize, 24)),
          query: String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        )
        if let cached = self.catalogCache[key], cached.expiresAt > Date() {
          completion(.success(cached.page))
          return
        }
        let result = try self.catalogClient.catalog(
          page: key.page,
          pageSize: key.pageSize,
          query: key.query
        )
        self.catalogCache = self.catalogCache.filter { $0.value.expiresAt > Date() }
        self.catalogCache[key] = (Date().addingTimeInterval(15 * 60), result)
        completion(.success(result))
      } catch {
        completion(.failure(error))
      }
    }
  }

  func thirdPartyCatalog(
    page: Int,
    pageSize: Int,
    query: String,
    category: String,
    sort: String,
    completion: @escaping @Sendable (
      Result<DesktopThirdPartyCatalogPage, Error>
    ) -> Void
  ) {
    queue.async {
      do {
        let supportedSorts = Set(["stars", "npmDownloads7d", "installs", "newest", "active"])
        let key = ThirdPartyCatalogCacheKey(
          page: max(1, min(page, 10_000)),
          pageSize: max(1, min(pageSize, 100)),
          query: String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)),
          category: String(category.lowercased().prefix(32)),
          sort: supportedSorts.contains(sort) ? sort : "stars"
        )
        if let cached = self.thirdPartyCatalogCache[key], cached.expiresAt > Date() {
          completion(.success(cached.page))
          return
        }
        let result = try self.catalogClient.thirdPartyCatalog(
          page: key.page,
          pageSize: key.pageSize,
          query: key.query,
          category: key.category,
          sort: key.sort
        )
        self.thirdPartyCatalogCache = self.thirdPartyCatalogCache.filter { $0.value.expiresAt > Date() }
        self.thirdPartyCatalogCache[key] = (Date().addingTimeInterval(15 * 60), result)
        for plugin in result.plugins { self.thirdPartyPluginsByID[plugin.id] = plugin }
        completion(.success(result))
      } catch {
        completion(.failure(error))
      }
    }
  }

  func reviewRepository(
    repository: String,
    completion: @escaping @Sendable (Result<DesktopPluginReview, Error>) -> Void
  ) {
    queue.async {
      do {
        guard Self.isRepositoryName(repository) else {
          throw DesktopError.message("社区插件仓库名格式无效。")
        }
        let branch = self.catalogCache.values.lazy
          .flatMap(\.page.plugins)
          .first { $0.repository == repository }?
          .defaultBranch
        let commit = try self.catalogClient.resolveHead(repository: repository, defaultBranch: branch)
        let report = try self.makeReview(source: "https://github.com/\(repository)#\(commit)")
        completion(.success(report))
      } catch {
        self.appendAudit(action: "review", subject: repository, status: "failure", message: error.localizedDescription)
        completion(.failure(error))
      }
    }
  }

  func reviewThirdParty(
    id: String,
    completion: @escaping @Sendable (Result<DesktopPluginReview, Error>) -> Void
  ) {
    queue.async {
      do {
        guard let plugin = self.thirdPartyPluginsByID[id] else {
          throw DesktopError.message("第三方目录条目已过期，请刷新目录后重试。")
        }
        let source = try self.catalogClient.resolveThirdPartySource(plugin: plugin)
        let report = try self.makeReview(source: source)
        completion(.success(report))
      } catch {
        self.appendAudit(action: "review", subject: id, status: "failure", message: error.localizedDescription)
        completion(.failure(error))
      }
    }
  }

  func install(
    sourceRoot: URL,
    reviewID: String,
    force: Bool,
    progress: @escaping @Sendable (String) -> Void,
    completion: @escaping @Sendable (Result<Void, Error>) -> Void
  ) {
    queue.async {
      var auditSubject = reviewID
      do {
        guard let review = self.pendingReviews[reviewID] else {
          throw DesktopError.message("审查记录不存在，请重新审查插件来源。")
        }
        auditSubject = review.subject
        guard review.expiresAt > Date() else {
          self.pendingReviews.removeValue(forKey: reviewID)
          throw DesktopError.message("审查记录已过期，请重新审查插件来源。")
        }
        guard !review.requiresForceInstall || force else {
          throw DesktopError.message("该插件包含审查风险；只有用户明确选择“强制安装”后才能继续。")
        }
        if review.kind == "local" {
          let current = try self.inspect(Self.preflightSource(review.source))
          guard current.installable,
                current.packageName == review.subject,
                !current.risks.isEmpty == review.requiresForceInstall
          else {
            throw DesktopError.message("本地插件目录在审查后发生结构变化，请重新审查。")
          }
        }
        self.pendingReviews.removeValue(forKey: reviewID)
        _ = try self.runCommand(
          sourceRoot: sourceRoot,
          arguments: ["add", "--save-exact", "--ignore-scripts", review.installSource],
          progress: progress
        )
        let message = review.requiresForceInstall && force
          ? "用户确认风险后强制安装固定来源；lifecycle scripts 未执行。"
          : "已安装固定来源；lifecycle scripts 未执行。"
        self.appendAudit(action: "install", subject: review.subject, status: "success", message: message)
        completion(.success(()))
      } catch {
        self.appendAudit(action: "install", subject: auditSubject, status: "failure", message: error.localizedDescription)
        completion(.failure(error))
      }
    }
  }

  func cancelReview(
    reviewID: String,
    completion: @escaping @Sendable (Result<Void, Error>) -> Void
  ) {
    queue.async {
      self.pendingReviews.removeValue(forKey: reviewID)
      completion(.success(()))
    }
  }

  private func makeReview(source: String) throws -> DesktopPluginReview {
    let normalized = try Self.preflightSource(source)
    let inspection = try inspect(normalized)
    let subject = normalized.kind == "local"
      ? inspection.packageName ?? normalized.subject
      : normalized.subject

    let expiry = Date().addingTimeInterval(15 * 60)
    pendingReviews = pendingReviews.filter { $0.value.expiresAt > Date() }
    let reviewID: String?
    let requiresForceInstall = !inspection.risks.isEmpty
    if inspection.installable {
      let id = UUID().uuidString
      pendingReviews[id] = PendingReview(
        source: normalized.source,
        installSource: normalized.installSource,
        kind: normalized.kind,
        subject: subject,
        requiresForceInstall: requiresForceInstall,
        expiresAt: expiry
      )
      reviewID = id
    } else {
      reviewID = nil
    }
    let findings = [normalized.pinFinding]
      + inspection.findings
      + [
        "安装时禁用 dependency lifecycle scripts。",
        "插件仍作为本机代码运行；结构分类不限制网络、文件或子进程访问。",
      ]
    let report = DesktopPluginReview(
      reviewID: reviewID,
      source: normalized.source,
      kind: normalized.kind,
      subject: subject,
      category: inspection.category,
      installable: inspection.installable,
      requiresForceInstall: requiresForceInstall,
      packageName: inspection.packageName,
      findings: findings,
      risks: inspection.risks,
      expiresAt: ISO8601DateFormatter().string(from: expiry)
    )
    appendAudit(
      action: "review",
      subject: subject,
      status: "review",
      message: (findings + inspection.risks).joined(separator: " ")
    )
    return report
  }

  private func inspect(_ source: NormalizedPluginSource) throws -> DesktopPluginInspection {
    if source.kind == "github" {
      let separator = source.source.lastIndex(of: "#")!
      let commit = String(source.source[source.source.index(after: separator)...])
      return try catalogClient.inspectGitHub(repository: source.subject, reference: commit)
    }
    if source.kind == "local" {
      return try catalogClient.inspectLocal(directory: URL(fileURLWithPath: source.source, isDirectory: true))
    }
    let separator = source.source.lastIndex(of: "@")!
    let version = String(source.source[source.source.index(after: separator)...])
    return try catalogClient.inspectNPM(package: source.subject, version: version)
  }

  func remove(
    sourceRoot: URL,
    package: String,
    progress: @escaping @Sendable (String) -> Void,
    completion: @escaping @Sendable (Result<Void, Error>) -> Void
  ) {
    queue.async {
      do {
        guard Self.isPackageName(package) else {
          throw DesktopError.message("插件包名格式无效。")
        }
        _ = try self.runCommand(sourceRoot: sourceRoot, arguments: ["remove", package], progress: progress)
        self.appendAudit(action: "remove", subject: package, status: "success", message: "已从 Web profile 移除。")
        completion(.success(()))
      } catch {
        self.appendAudit(action: "remove", subject: package, status: "failure", message: error.localizedDescription)
        completion(.failure(error))
      }
    }
  }

  func logs(completion: @escaping @Sendable (Result<[DesktopPluginAuditRecord], Error>) -> Void) {
    queue.async {
      do {
        guard FileManager.default.fileExists(atPath: self.auditURL.path) else {
          completion(.success([]))
          return
        }
        let text = try String(contentsOf: self.auditURL, encoding: .utf8)
        let decoder = JSONDecoder()
        let records = try text.split(whereSeparator: \Character.isNewline)
          .suffix(200)
          .map { try decoder.decode(DesktopPluginAuditRecord.self, from: Data($0.utf8)) }
          .reversed()
        completion(.success(Array(records)))
      } catch {
        completion(.failure(error))
      }
    }
  }

  private func runCommand(
    sourceRoot: URL,
    arguments: [String],
    progress: @escaping @Sendable (String) -> Void
  ) throws -> CommandResult {
    let toolchain = try Toolchain.resolve(supportRoot: supportRoot, progress: progress)
    let shimDirectory = try ensurePnpmShim(toolchain: toolchain)
    let cli = sourceRoot.appendingPathComponent("apps/cli/lib/bin.js")
    guard FileManager.default.fileExists(atPath: cli.path) else {
      throw DesktopError.message("缺少 Harness CLI 构建产物。")
    }
    let result = try CommandRunner.run(
      executable: toolchain.node,
      arguments: [cli.path, "plugin", "--profile", "web"] + arguments,
      directory: sourceRoot,
      environment: toolchain.environment(
        overrides: ["DSH_HOME": dshHome.path],
        prepending: [shimDirectory.path]
      ),
      progress: progress
    )
    guard result.status == 0 else {
      throw DesktopError.message("插件命令失败：\n\(result.output)")
    }
    return result
  }

  private func makeRecoveryProfile(disabling package: String) throws -> DesktopRecoveryProfile? {
    guard Self.isPackageName(package) else { return nil }
    let profiles = dshHome.appendingPathComponent("profiles", isDirectory: true)
    try removeStaleRecoveryDirectories(in: profiles)
    let web = profiles.appendingPathComponent("web", isDirectory: true)
    let manifestURL = web.appendingPathComponent("package.json")
    let data = try Data(contentsOf: manifestURL)
    guard var root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let dependencies = root["dependencies"] as? [String: String],
          dependencies[package] != nil,
          var dsh = root["dsh"] as? [String: Any],
          var profile = dsh["profile"] as? [String: Any],
          let bundles = profile["bundles"] as? [String],
          bundles.contains(package)
    else { return nil }

    profile["bundles"] = bundles.filter { $0 != package }
    dsh["profile"] = profile
    root["dsh"] = dsh
    let name = "desktop-recovery-\(UUID().uuidString.lowercased())"
    let directory = profiles.appendingPathComponent(name, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    do {
      let recoveryManifest = try JSONSerialization.data(
        withJSONObject: root,
        options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
      ) + Data("\n".utf8)
      try recoveryManifest.write(to: directory.appendingPathComponent("package.json"), options: .atomic)
      for filename in ["cordis.yml", "cordis.patch.yml"] {
        let source = web.appendingPathComponent(filename)
        let destination = directory.appendingPathComponent(filename)
        if FileManager.default.fileExists(atPath: source.path) {
          try FileManager.default.copyItem(at: source, to: destination)
        } else {
          try Data("[]\n".utf8).write(to: destination, options: .atomic)
        }
      }
      let nodeModules = web.appendingPathComponent("node_modules", isDirectory: true)
      guard FileManager.default.fileExists(atPath: nodeModules.path) else {
        throw DesktopError.message("Web profile 尚未安装插件依赖，无法创建临时恢复环境。")
      }
      try FileManager.default.createSymbolicLink(
        at: directory.appendingPathComponent("node_modules", isDirectory: true),
        withDestinationURL: nodeModules
      )
    } catch {
      try? removeRecoveryDirectory(directory)
      throw error
    }
    appendAudit(
      action: "startup-isolation",
      subject: package,
      status: "success",
      message: "侧载插件仅在本次桌面运行中临时禁用；Web profile 安装与启用状态未修改。"
    )
    return DesktopRecoveryProfile(name: name, directory: directory, disabledPackage: package)
  }

  private func removeStaleRecoveryDirectories(in profiles: URL) throws {
    guard FileManager.default.fileExists(atPath: profiles.path) else { return }
    for item in try FileManager.default.contentsOfDirectory(
      at: profiles,
      includingPropertiesForKeys: nil,
      options: [.skipsHiddenFiles]
    ) where item.lastPathComponent.hasPrefix("desktop-recovery-") {
      try removeRecoveryDirectory(item)
    }
  }

  private func removeRecoveryDirectory(_ directory: URL) throws {
    let profiles = dshHome.appendingPathComponent("profiles", isDirectory: true).standardizedFileURL
    guard directory.deletingLastPathComponent().standardizedFileURL == profiles,
          directory.lastPathComponent.hasPrefix("desktop-recovery-")
    else { throw DesktopError.message("拒绝清理非桌面恢复 Profile。") }
    let modules = directory.appendingPathComponent("node_modules", isDirectory: true)
    if (try? modules.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true {
      try FileManager.default.removeItem(at: modules)
    }
    if FileManager.default.fileExists(atPath: directory.path) {
      try FileManager.default.removeItem(at: directory)
    }
  }

  private func appendAudit(action: String, subject: String, status: String, message: String) {
    do {
      try FileManager.default.createDirectory(
        at: auditURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      let record = DesktopPluginAuditRecord(
        id: UUID().uuidString,
        timestamp: ISO8601DateFormatter().string(from: Date()),
        action: action,
        subject: subject,
        status: status,
        message: message
      )
      let data = try JSONEncoder().encode(record) + Data("\n".utf8)
      if !FileManager.default.fileExists(atPath: auditURL.path) {
        try data.write(to: auditURL, options: .atomic)
        return
      }
      let handle = try FileHandle(forWritingTo: auditURL)
      defer { try? handle.close() }
      try handle.seekToEnd()
      try handle.write(contentsOf: data)
    } catch {
      LogStore.shared.append("plugin audit write failed: \(error.localizedDescription)")
    }
  }

  static func preflightSource(_ raw: String) throws -> NormalizedPluginSource {
    let source = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if let components = URLComponents(string: source), components.scheme == "https", components.host == "github.com" {
      guard components.user == nil, components.password == nil, components.port == nil, components.query == nil else {
        throw DesktopError.message("GitHub URL 不能包含凭据、端口或查询参数。")
      }
      let parts = components.path.split(separator: "/").map(String.init)
      guard parts.count == 2,
            let commit = components.fragment,
            commit.range(of: "^[0-9a-fA-F]{7,40}$", options: .regularExpression) != nil
      else {
        throw DesktopError.message("GitHub URL 必须指向 owner/repository，并用 #commit 固定 7–40 位提交哈希。")
      }
      let repository = parts[1].hasSuffix(".git") ? String(parts[1].dropLast(4)) : parts[1]
      guard isPackageSegment(parts[0]), isPackageSegment(repository) else {
        throw DesktopError.message("GitHub 仓库地址格式无效。")
      }
      let normalized = "https://github.com/\(parts[0])/\(repository).git#\(commit.lowercased())"
      return NormalizedPluginSource(
        source: normalized,
        installSource: normalized,
        kind: "github",
        subject: "\(parts[0])/\(repository)",
        pinFinding: "来源固定到 commit \(commit.lowercased())。"
      )
    }

    let localURL: URL?
    if source.hasPrefix("/") {
      localURL = URL(fileURLWithPath: source, isDirectory: true)
    } else if let fileURL = URL(string: source), fileURL.isFileURL {
      localURL = fileURL
    } else {
      localURL = nil
    }
    if let localURL {
      let normalized = localURL.standardizedFileURL.resolvingSymlinksInPath()
      var isDirectory: ObjCBool = false
      guard FileManager.default.fileExists(atPath: normalized.path, isDirectory: &isDirectory),
            isDirectory.boolValue
      else {
        throw DesktopError.message("本地插件目录不存在或不可读取。")
      }
      return NormalizedPluginSource(
        source: normalized.path,
        installSource: "file:\(normalized.path)",
        kind: "local",
        subject: normalized.lastPathComponent,
        pinFinding: "本地目录已解析为绝对路径；安装前会再次检查插件结构。"
      )
    }

    let pattern = "^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*@[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$"
    guard source.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil,
          let separator = source.lastIndex(of: "@"), separator != source.startIndex
    else {
      throw DesktopError.message("请输入 npm 精确版本、固定 commit 的 HTTPS GitHub URL，或本地插件目录。")
    }
    let package = String(source[..<separator])
    return NormalizedPluginSource(
      source: source,
      installSource: source,
      kind: "npm",
      subject: package,
      pinFinding: "npm 来源固定到精确版本 \(source[source.index(after: separator)...])。"
    )
  }

  private static func isPackageName(_ value: String) -> Bool {
    let pattern = "^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$"
    return value.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
  }

  private static func isPackageSegment(_ value: String) -> Bool {
    value.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]*$", options: .regularExpression) != nil
  }

  private static func isRepositoryName(_ value: String) -> Bool {
    let parts = value.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    return parts.count == 2 && parts.allSatisfy(isPackageSegment)
  }

  private func ensurePnpmShim(toolchain: Toolchain) throws -> URL {
    let directory = supportRoot.appendingPathComponent("tools/bin", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let shim = directory.appendingPathComponent("pnpm")
    let quotedNpx = toolchain.npx.path.replacingOccurrences(of: "'", with: "'\\''")
    let script = "#!/bin/sh\nexec '\(quotedNpx)' --yes pnpm@11.7.0 \"$@\"\n"
    try script.write(to: shim, atomically: true, encoding: .utf8)
    guard chmod(shim.path, 0o700) == 0 else {
      throw DesktopError.message("无法设置 pnpm 包装脚本权限。")
    }
    return directory
  }
}
