import Foundation

enum DesktopPluginCategory: String, Sendable {
  case profileBundle = "profile-bundle"
  case needsAdapter = "needs-adapter"
  case externalProject = "external-project"
  case blocked = "blocked"
}

struct DesktopCommunityPlugin: Sendable {
  let repository: String
  let description: String?
  let stars: Int
  let language: String?
  let updatedAt: String
  let htmlURL: String
  let defaultBranch: String
  let category: DesktopPluginCategory
  let installable: Bool
}

struct DesktopThirdPartyPlugin: Sendable {
  let id: String
  let name: String
  let repository: String
  let englishDescription: String
  let chineseDescription: String
  let stars: Int
  let categoryID: String
  let detailURL: String
  let repositoryURL: String
}

struct DesktopThirdPartyCategory: Sendable {
  let id: String
  let englishName: String
  let chineseName: String
  let count: Int
}

struct DesktopThirdPartyCatalogPage: Sendable {
  let plugins: [DesktopThirdPartyPlugin]
  let hasMore: Bool
  let total: Int
  let catalogTotal: Int
  let categories: [DesktopThirdPartyCategory]
}

struct DesktopCatalogPage<Item: Sendable>: Sendable {
  let plugins: [Item]
  let hasMore: Bool
}

struct DesktopPluginInspection: Sendable {
  let category: DesktopPluginCategory
  let installable: Bool
  let packageName: String?
  let findings: [String]
  let risks: [String]
}

enum DesktopPluginManifestOrigin {
  case repository
  case npmRegistry
  case localDirectory
}

struct PluginHTTPPayload: Sendable {
  let status: Int
  let data: Data
}

final class PluginCatalogClient: @unchecked Sendable {
  typealias Fetch = @Sendable (URL) throws -> PluginHTTPPayload

  private struct GitHubSearchResponse: Decodable {
    let totalCount: Int
    let items: [GitHubRepository]

    enum CodingKeys: String, CodingKey {
      case totalCount = "total_count"
      case items
    }
  }

  private struct GitHubRepository: Decodable {
    let fullName: String
    let description: String?
    let stargazersCount: Int
    let language: String?
    let htmlURL: String
    let defaultBranch: String
    let pushedAt: String

    enum CodingKeys: String, CodingKey {
      case fullName = "full_name"
      case description
      case stargazersCount = "stargazers_count"
      case language
      case htmlURL = "html_url"
      case defaultBranch = "default_branch"
      case pushedAt = "pushed_at"
    }
  }

  private struct GitHubCommit: Decodable {
    let sha: String
  }

  private struct GitHubRepositoryDetails: Decodable {
    let defaultBranch: String

    enum CodingKeys: String, CodingKey {
      case defaultBranch = "default_branch"
    }
  }

  private struct NPMLatest: Decodable {
    let version: String
  }

  private struct ThirdPartyCatalogResponse: Decodable {
    let page: Int
    let total: Int
    let totalPages: Int
    let catalogTotal: Int
    let categories: [ThirdPartyCategory]
    let plugins: [ThirdPartyPlugin]
  }

  private struct ThirdPartyCategory: Decodable {
    let id: String
    let en: String
    let zh: String
    let count: Int
  }

  private struct ThirdPartyDescription: Decodable {
    let en: String
    let zh: String
  }

  private struct ThirdPartyPlugin: Decodable {
    let id: String
    let name: String
    let owner: String
    let url: String
    let repository: String
    let category: String
    let description: ThirdPartyDescription
    let stars: Int?
  }

  private let fetch: Fetch

  init(fetch: @escaping Fetch = PluginCatalogClient.fetchRemote) {
    self.fetch = fetch
  }

  func catalog(
    page: Int = 1,
    pageSize: Int = 12,
    query: String = ""
  ) throws -> DesktopCatalogPage<DesktopCommunityPlugin> {
    let safePage = max(1, min(page, 50))
    let safePageSize = max(1, min(pageSize, 24))
    let normalizedQuery = String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
    var components = URLComponents(string: "https://api.github.com/search/repositories")!
    components.queryItems = [
      URLQueryItem(
        name: "q",
        value: normalizedQuery.isEmpty ? "topic:dsh-plugin" : "topic:dsh-plugin \(normalizedQuery)"
      ),
      URLQueryItem(name: "sort", value: "updated"),
      URLQueryItem(name: "order", value: "desc"),
      URLQueryItem(name: "per_page", value: String(safePageSize)),
      URLQueryItem(name: "page", value: String(safePage)),
    ]
    let response: GitHubSearchResponse = try decodeGitHub(components.url!)
    let plugins = LockedBox<[DesktopCommunityPlugin?]>(
      Array(repeating: nil, count: response.items.count)
    )
    let inspectionSlots = DispatchSemaphore(value: 4)
    DispatchQueue.concurrentPerform(iterations: response.items.count) { index in
      inspectionSlots.wait()
      defer { inspectionSlots.signal() }
      let repository = response.items[index]
      let inspection: DesktopPluginInspection
      do {
        inspection = try inspectGitHub(
          repository: repository.fullName,
          reference: repository.defaultBranch,
          validateCommit: false
        )
      } catch {
        inspection = DesktopPluginInspection(
          category: .blocked,
          installable: false,
          packageName: nil,
          findings: ["暂时无法读取仓库清单，已阻止直接安装：\(error.localizedDescription)"],
          risks: []
        )
      }
      let plugin = DesktopCommunityPlugin(
        repository: repository.fullName,
        description: repository.description,
        stars: repository.stargazersCount,
        language: repository.language,
        updatedAt: repository.pushedAt,
        htmlURL: repository.htmlURL,
        defaultBranch: repository.defaultBranch,
        category: inspection.category,
        installable: inspection.installable
      )
      plugins.update { $0[index] = plugin }
    }
    return DesktopCatalogPage(
      plugins: plugins.get().compactMap { $0 },
      hasMore: safePage * safePageSize < min(response.totalCount, 1_000)
    )
  }

  func thirdPartyCatalog(
    page: Int = 1,
    pageSize: Int = 12,
    query: String = "",
    category: String = "",
    sort: String = "stars"
  ) throws -> DesktopThirdPartyCatalogPage {
    let safePage = max(1, min(page, 10_000))
    let safePageSize = max(1, min(pageSize, 100))
    let normalizedQuery = String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
    let normalizedCategory = String(category.lowercased().prefix(32))
    let supportedSorts = Set(["stars", "npmDownloads7d", "installs", "newest", "active"])
    let normalizedSort = supportedSorts.contains(sort) ? sort : "stars"
    var components = URLComponents(string: "https://deepseek1024.com/api/v2/plugins")!
    components.queryItems = [
      URLQueryItem(name: "page", value: String(safePage)),
      URLQueryItem(name: "limit", value: String(safePageSize)),
      URLQueryItem(name: "sort", value: normalizedSort),
    ]
    if !normalizedQuery.isEmpty {
      components.queryItems?.append(URLQueryItem(name: "q", value: normalizedQuery))
    }
    if normalizedCategory.range(of: "^[a-z0-9-]+$", options: .regularExpression) != nil {
      components.queryItems?.append(URLQueryItem(name: "category", value: normalizedCategory))
    }
    let response = try fetch(components.url!)
    guard response.status == 200 else {
      throw DesktopError.message("第三方社区返回 HTTP \(response.status)，暂时无法读取目录。")
    }
    let decoded: ThirdPartyCatalogResponse
    do {
      decoded = try JSONDecoder().decode(ThirdPartyCatalogResponse.self, from: response.data)
    } catch {
      throw DesktopError.message("第三方社区目录响应格式无效。")
    }
    let plugins = decoded.plugins.map { plugin in
      DesktopThirdPartyPlugin(
        id: plugin.id,
        name: plugin.name,
        repository: "\(plugin.owner)/\(plugin.repository)",
        englishDescription: plugin.description.en,
        chineseDescription: plugin.description.zh,
        stars: plugin.stars ?? 0,
        categoryID: plugin.category,
        detailURL: "https://deepseek1024.com/plugins/\(plugin.id)",
        repositoryURL: plugin.url
      )
    }
    return DesktopThirdPartyCatalogPage(
      plugins: plugins,
      hasMore: decoded.page < decoded.totalPages,
      total: decoded.total,
      catalogTotal: decoded.catalogTotal,
      categories: decoded.categories.map {
        DesktopThirdPartyCategory(id: $0.id, englishName: $0.en, chineseName: $0.zh, count: $0.count)
      }
    )
  }

  func resolveThirdPartySource(plugin: DesktopThirdPartyPlugin) throws -> String {
    guard let detailURL = URL(string: plugin.detailURL),
          detailURL.scheme == "https",
          detailURL.host == "deepseek1024.com",
          detailURL.path.hasPrefix("/plugins/")
    else {
      throw DesktopError.message("第三方社区详情地址无效。")
    }
    let detail = try fetch(detailURL)
    guard detail.status == 200, let html = String(data: detail.data, encoding: .utf8) else {
      throw DesktopError.message("第三方社区详情不可读，未生成安装来源。")
    }
    let pattern = #"dsh\s+plugin\s+--profile\s+web\s+add\s+([^<\s\"']+)"#
    guard let match = Self.firstMatch(pattern, in: html), match.count > 1 else {
      throw DesktopError.message("第三方条目没有可验证的 DSH npm 安装目标；请打开详情后手动检查来源。")
    }
    let candidate = Self.htmlText(match[1])
    let exactPattern = "^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*@[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$"
    if candidate.range(of: exactPattern, options: [.regularExpression, .caseInsensitive]) != nil {
      return candidate
    }
    guard Self.isNPMName(candidate) else {
      throw DesktopError.message("第三方条目的安装目标不是受支持的 npm package，未生成安装来源。")
    }
    return "\(candidate)@\(try latestNPMVersion(package: candidate))"
  }

  func latestNPMVersion(package: String) throws -> String {
    let encoded = package.addingPercentEncoding(
      withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))
    ) ?? package
    let response = try fetch(requireURL("https://registry.npmjs.org/\(encoded)/latest"))
    guard response.status == 200 else {
      throw DesktopError.message("npm registry 返回 HTTP \(response.status)，无法检查 \(package) 的最新版本。")
    }
    guard let latest = try? JSONDecoder().decode(NPMLatest.self, from: response.data),
          latest.version.range(
            of: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$",
            options: .regularExpression
          ) != nil
    else {
      throw DesktopError.message("npm registry 没有返回 \(package) 的有效精确版本。")
    }
    return latest.version
  }

  func resolveHead(repository: String, defaultBranch: String?) throws -> String {
    let branch: String
    if let defaultBranch {
      branch = defaultBranch
    } else {
      let details: GitHubRepositoryDetails = try decodeGitHub(
        githubAPI(path: "repos/\(repository)")
      )
      branch = details.defaultBranch
    }
    let commit: GitHubCommit = try decodeGitHub(
      githubAPI(path: "repos/\(repository)/commits/\(branch)")
    )
    return commit.sha
  }

  func inspectGitHub(
    repository: String,
    reference: String,
    validateCommit: Bool = true
  ) throws -> DesktopPluginInspection {
    if validateCommit {
      let _: GitHubCommit = try decodeGitHub(
        githubAPI(path: "repos/\(repository)/commits/\(reference)")
      )
    }
    let base = "https://raw.githubusercontent.com/\(repository)/\(reference)"
    let manifest = try fetch(requireURL("\(base)/package.json"))
    return try Self.inspectManifest(
      manifest.status == 200 ? manifest.data : nil,
      origin: .repository
    ) { patch in
      let response = try self.fetch(self.requireURL("\(base)/\(patch)"))
      return response.status == 200
    }
  }

  func inspectNPM(package: String, version: String) throws -> DesktopPluginInspection {
    let encoded = package.addingPercentEncoding(
      withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))
    ) ?? package
    let manifest = try fetch(requireURL("https://registry.npmjs.org/\(encoded)/\(version)"))
    guard manifest.status == 200 else {
      throw DesktopError.message("npm registry 返回 HTTP \(manifest.status)，无法检查 \(package)@\(version)。")
    }
    return try Self.inspectManifest(manifest.data, origin: .npmRegistry) { patch in
      let response = try self.fetch(self.requireURL("https://unpkg.com/\(package)@\(version)/\(patch)"))
      return response.status == 200
    }
  }

  func inspectLocal(directory: URL) throws -> DesktopPluginInspection {
    let root = directory.standardizedFileURL.resolvingSymlinksInPath()
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: root.path, isDirectory: &isDirectory), isDirectory.boolValue else {
      throw DesktopError.message("本地插件目录不存在或不可读取。")
    }
    let manifestURL = root.appendingPathComponent("package.json", isDirectory: false)
    let manifest = try? Data(contentsOf: manifestURL)
    return try Self.inspectManifest(manifest, origin: .localDirectory) { patch in
      let candidate = root.appendingPathComponent(patch, isDirectory: false)
        .standardizedFileURL.resolvingSymlinksInPath()
      let rootPrefix = root.path.hasSuffix("/") ? root.path : "\(root.path)/"
      guard candidate.path.hasPrefix(rootPrefix) else { return false }
      var patchIsDirectory: ObjCBool = false
      return FileManager.default.fileExists(atPath: candidate.path, isDirectory: &patchIsDirectory)
        && !patchIsDirectory.boolValue
    }
  }

  static func inspectManifest(
    _ data: Data?,
    origin: DesktopPluginManifestOrigin,
    patchExists: (String) throws -> Bool
  ) throws -> DesktopPluginInspection {
    guard let data else {
      let location = origin == .localDirectory ? "本地目录" : "仓库根目录"
      return DesktopPluginInspection(
        category: .externalProject,
        installable: false,
        packageName: nil,
        findings: ["\(location)没有 package.json，不能作为 DSH Profile Bundle 直接安装。"],
        risks: []
      )
    }
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return DesktopPluginInspection(
        category: .blocked,
        installable: false,
        packageName: nil,
        findings: ["package.json 不是有效的 JSON 对象，已阻止安装。"],
        risks: []
      )
    }
    let packageName = root["name"] as? String
    guard let packageName, !packageName.isEmpty else {
      return DesktopPluginInspection(
        category: .blocked,
        installable: false,
        packageName: nil,
        findings: ["package.json 缺少有效 name，已阻止安装。"],
        risks: []
      )
    }
    let risks = origin == .repository ? [] : publishedWorkspaceDependencyRisks(root)
    guard let dsh = root["dsh"] as? [String: Any],
          let bundle = dsh["bundle"] as? [String: Any],
          let patch = bundle["patch"] as? String
    else {
      return DesktopPluginInspection(
        category: .needsAdapter,
        installable: false,
        packageName: packageName,
        findings: ["package 未声明 dsh.bundle.patch；安装后只会成为普通依赖，不会激活为 Profile Bundle。"],
        risks: risks
      )
    }
    guard let normalizedPatch = safePatchPath(patch) else {
      return DesktopPluginInspection(
        category: .blocked,
        installable: false,
        packageName: packageName,
        findings: ["dsh.bundle.patch 必须是包内相对 YAML 路径，已阻止安装。"],
        risks: risks
      )
    }
    guard try patchExists(normalizedPatch) else {
      return DesktopPluginInspection(
        category: .blocked,
        installable: false,
        packageName: packageName,
        findings: ["dsh.bundle.patch 指向的 \(normalizedPatch) 不存在，已阻止安装。"],
        risks: risks
      )
    }
    let scripts = (root["scripts"] as? [String: Any]) ?? [:]
    let lifecycleNames = Set(["preinstall", "install", "postinstall", "prepare"])
    let lifecycleCount = scripts.keys.filter(lifecycleNames.contains).count
    var findings = [
      "识别为可直接安装的 DSH Profile Bundle（\(packageName)）。",
      "组合入口 \(normalizedPatch) 存在。",
    ]
    if lifecycleCount > 0 {
      findings.append("清单声明了 \(lifecycleCount) 个安装 lifecycle script；安装时会强制禁用。")
    } else {
      findings.append("清单未声明安装 lifecycle script。")
    }
    return DesktopPluginInspection(
      category: .profileBundle,
      installable: true,
      packageName: packageName,
      findings: findings,
      risks: risks
    )
  }

  private static func publishedWorkspaceDependencyRisks(_ root: [String: Any]) -> [String] {
    let fields = ["dependencies", "optionalDependencies", "peerDependencies"]
    let entries = fields.flatMap { field -> [(field: String, package: String, specifier: String)] in
      guard let dependencies = root[field] as? [String: Any] else { return [] }
      return dependencies.compactMap { package, value in
        guard let specifier = value as? String, specifier.hasPrefix("workspace:") else { return nil }
        return (field, package, specifier)
      }
    }.sorted { lhs, rhs in
      lhs.field == rhs.field ? lhs.package < rhs.package : lhs.field < rhs.field
    }
    var risks = entries.prefix(12).map { entry in
      "\(entry.field) 中的 \(entry.package) 使用 \(entry.specifier)；已发布 npm 包无法从用户 workspace 解析该依赖，发布者应改为 registry 版本并重新发布。强制安装仍可能被 pnpm 拒绝。"
    }
    if entries.count > 12 {
      risks.append("该 npm 发布清单还有 \(entries.count - 12) 项 workspace: 运行时依赖未逐项显示。")
    }
    return risks
  }

  private static func safePatchPath(_ value: String) -> String? {
    guard value.hasPrefix("./"), !value.contains("\\") else { return nil }
    let components = value.dropFirst(2).split(separator: "/", omittingEmptySubsequences: false)
    guard !components.isEmpty,
          components.allSatisfy({ component in
            !component.isEmpty
              && component != "."
              && component != ".."
              && String(component).range(
                of: "^[A-Za-z0-9._-]+$",
                options: .regularExpression
              ) != nil
          }),
          let last = components.last,
          last.hasSuffix(".yml") || last.hasSuffix(".yaml")
    else { return nil }
    return components.joined(separator: "/")
  }

  private static func isNPMName(_ value: String) -> Bool {
    value.range(
      of: "^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$",
      options: [.regularExpression, .caseInsensitive]
    ) != nil
  }

  private static func firstMatch(_ pattern: String, in text: String) -> [String]? {
    guard let expression = try? NSRegularExpression(pattern: pattern),
          let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
    else { return nil }
    return (0..<match.numberOfRanges).compactMap { index in
      guard let range = Range(match.range(at: index), in: text) else { return nil }
      return String(text[range])
    }
  }

  private static func htmlText(_ value: String) -> String {
    value
      .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
      .replacingOccurrences(of: "&amp;", with: "&")
      .replacingOccurrences(of: "&quot;", with: "\"")
      .replacingOccurrences(of: "&#39;", with: "'")
      .replacingOccurrences(of: "&lt;", with: "<")
      .replacingOccurrences(of: "&gt;", with: ">")
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func decodeGitHub<Value: Decodable>(_ url: URL) throws -> Value {
    let response = try fetch(url)
    guard response.status == 200 else {
      throw DesktopError.message("GitHub 返回 HTTP \(response.status)，暂时无法读取社区插件目录。")
    }
    return try JSONDecoder().decode(Value.self, from: response.data)
  }

  private func githubAPI(path: String) -> URL {
    requireURL("https://api.github.com/\(path)")
  }

  private func requireURL(_ value: String) -> URL {
    guard let url = URL(string: value) else { preconditionFailure("invalid internal URL: \(value)") }
    return url
  }

  private static func fetchRemote(_ url: URL) throws -> PluginHTTPPayload {
    var request = URLRequest(
      url: url,
      cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
      timeoutInterval: 15
    )
    request.setValue("DeepSeek-Harness-Desktop/0.1", forHTTPHeaderField: "User-Agent")
    if url.host == "api.github.com" {
      request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
    } else if url.host == "registry.npmjs.org" {
      request.setValue("application/json", forHTTPHeaderField: "Accept")
    } else {
      request.setValue("text/html,application/json;q=0.9,*/*;q=0.8", forHTTPHeaderField: "Accept")
    }
    let result = LockedBox<Result<PluginHTTPPayload, Error>?>(nil)
    let settled = DispatchSemaphore(value: 0)
    let task = URLSession.shared.dataTask(with: request) { data, response, error in
      defer { settled.signal() }
      if let error {
        result.set(.failure(error))
        return
      }
      guard let response = response as? HTTPURLResponse else {
        result.set(.failure(DesktopError.message("远程插件检查没有收到 HTTP 响应。")))
        return
      }
      let payload = data ?? Data()
      guard payload.count <= 2 * 1024 * 1024 else {
        result.set(.failure(DesktopError.message("远程插件清单超过 2 MiB 检查上限。")))
        return
      }
      result.set(.success(PluginHTTPPayload(status: response.statusCode, data: payload)))
    }
    task.resume()
    guard settled.wait(timeout: .now() + 20) == .success else {
      task.cancel()
      throw DesktopError.message("远程插件检查超时。")
    }
    guard let outcome = result.get() else {
      throw DesktopError.message("远程插件检查未返回结果。")
    }
    return try outcome.get()
  }
}
