import Foundation

struct SourceUpdate: Sendable {
  let sourceRoot: URL
  let commit: String
  let changed: Bool
}

final class SourceManager: @unchecked Sendable {
  private let defaults: UserDefaults
  private let queue = DispatchQueue(label: "ai.deepseek.harness.desktop.source", qos: .userInitiated)
  private let bootstrapArchive: URL?
  private let sourceRepository: String
  private let sourceBranch: String

  let supportRoot: URL
  let dshHome: URL
  let probeHome: URL

  init(
    supportRoot: URL? = nil,
    defaults: UserDefaults = .standard,
    bootstrapArchive: URL? = Bundle.main.url(forResource: "SourceBootstrap", withExtension: "tar.gz"),
    sourceRepository: String = Bundle.main.object(forInfoDictionaryKey: "DSHSourceRepository") as? String
      ?? "https://github.com/deepseek-ai/deepseek-harness.git",
    sourceBranch: String = Bundle.main.object(forInfoDictionaryKey: "DSHSourceBranch") as? String ?? "master"
  ) {
    self.defaults = defaults
    self.bootstrapArchive = bootstrapArchive
    self.sourceRepository = sourceRepository
    self.sourceBranch = sourceBranch
    self.supportRoot = supportRoot ?? FileManager.default.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    )[0].appendingPathComponent("DeepSeek Harness Desktop", isDirectory: true)
    dshHome = self.supportRoot.appendingPathComponent("data", isDirectory: true)
    probeHome = self.supportRoot.appendingPathComponent("probe-data", isDirectory: true)
  }

  func resolveAndPrepare(
    progress: @escaping @Sendable (String) -> Void,
    completion: @escaping @Sendable (Result<URL, Error>) -> Void
  ) {
    queue.async {
      do {
        try FileManager.default.createDirectory(at: self.supportRoot, withIntermediateDirectories: true)
        let source = try self.resolveSource(progress: progress)
        try self.prepare(source, progress: progress)
        completion(.success(source))
      } catch {
        completion(.failure(error))
      }
    }
  }

  private func resolveSource(progress: @escaping @Sendable (String) -> Void) throws -> URL {
    let environment = ProcessInfo.processInfo.environment
    let candidates = [
      environment["DSH_SOURCE_DIR"],
      defaults.string(forKey: "activeSourceRoot"),
      Bundle.main.object(forInfoDictionaryKey: "DSHSourceRoot") as? String,
    ].compactMap { $0 }.map { URL(fileURLWithPath: $0, isDirectory: true) }
    if let source = candidates.first(where: isSourceRoot) { return source }

    let bootstrap = supportRoot.appendingPathComponent("source", isDirectory: true)
    if isSourceRoot(bootstrap) { return bootstrap }
    if let archive = bootstrapArchive {
      progress("正在准备随应用提供的 DeepSeek Harness 源码…\n")
      if FileManager.default.fileExists(atPath: bootstrap.path) {
        try FileManager.default.removeItem(at: bootstrap)
      }
      try FileManager.default.createDirectory(at: bootstrap, withIntermediateDirectories: true)
      let unpack = try CommandRunner.run(
        executable: URL(fileURLWithPath: "/usr/bin/tar"),
        arguments: ["-xzf", archive.path, "-C", bootstrap.path],
        progress: progress
      )
      guard unpack.status == 0, isSourceRoot(bootstrap) else {
        try? FileManager.default.removeItem(at: bootstrap)
        throw DesktopError.message("随应用提供的源码解压失败：\n\(unpack.output)")
      }
      defaults.set(bootstrap.path, forKey: "activeSourceRoot")
      return bootstrap
    }
    progress("正在首次下载 DeepSeek Harness 源码…\n")
    let result = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/git"),
      arguments: ["clone", "--branch", sourceBranch, sourceRepository, bootstrap.path],
      progress: progress
    )
    guard result.status == 0, isSourceRoot(bootstrap) else {
      throw DesktopError.message("源码下载失败：\n\(result.output)")
    }
    defaults.set(bootstrap.path, forKey: "activeSourceRoot")
    return bootstrap
  }

  private func isSourceRoot(_ url: URL) -> Bool {
    FileManager.default.fileExists(atPath: url.appendingPathComponent("apps/cli/package.json").path)
  }

  private func prepare(_ source: URL, progress: @escaping @Sendable (String) -> Void) throws {
    let artifact = source.appendingPathComponent("apps/cli/lib/bin.js")
    let frontend = source.appendingPathComponent("apps/web/dist/index.html")
    if FileManager.default.fileExists(atPath: artifact.path), FileManager.default.fileExists(atPath: frontend.path) { return }

    let toolchain = try Toolchain.resolve(supportRoot: supportRoot, progress: progress)
    progress("正在安装源码依赖…\n")
    let install = try CommandRunner.run(
      executable: toolchain.npx,
      arguments: ["--yes", "pnpm@11.7.0", "install", "--frozen-lockfile"],
      directory: source,
      environment: toolchain.environment(),
      progress: progress
    )
    guard install.status == 0 else { throw DesktopError.message("依赖安装失败：\n\(install.output)") }

    progress("正在构建 DeepSeek Harness…\n")
    let build = try CommandRunner.run(
      executable: toolchain.npx,
      arguments: ["--yes", "pnpm@11.7.0", "run", "build"],
      directory: source,
      environment: toolchain.environment(),
      progress: progress
    )
    guard build.status == 0 else { throw DesktopError.message("源码构建失败：\n\(build.output)") }
  }

  func update(
    current: URL,
    progress: @escaping @Sendable (String) -> Void,
    completion: @escaping @Sendable (Result<SourceUpdate, Error>) -> Void
  ) {
    queue.async {
      do {
        progress("正在获取上游更新…\n")
        let fetch = try CommandRunner.run(
          executable: URL(fileURLWithPath: "/usr/bin/git"),
          arguments: ["-C", current.path, "fetch", "--prune", "origin", self.sourceBranch],
          progress: progress
        )
        guard fetch.status == 0 else { throw DesktopError.message("获取上游更新失败：\n\(fetch.output)") }
        let remote = try self.gitOutput(["-C", current.path, "rev-parse", "origin/\(self.sourceBranch)"])
        let local = try self.gitOutput(["-C", current.path, "rev-parse", "HEAD"])
        if remote == local {
          completion(.success(SourceUpdate(sourceRoot: current, commit: local, changed: false)))
          return
        }

        let releases = self.supportRoot.appendingPathComponent("releases", isDirectory: true)
        try FileManager.default.createDirectory(at: releases, withIntermediateDirectories: true)
        var stage = releases.appendingPathComponent(remote, isDirectory: true)
        if !self.isSourceRoot(stage) {
          if FileManager.default.fileExists(atPath: stage.path) {
            stage = releases.appendingPathComponent("\(remote)-\(Int(Date().timeIntervalSince1970))", isDirectory: true)
          }
          progress("正在创建隔离的更新 worktree…\n")
          let worktree = try CommandRunner.run(
            executable: URL(fileURLWithPath: "/usr/bin/git"),
            arguments: ["-C", current.path, "worktree", "add", "--detach", stage.path, remote],
            progress: progress
          )
          guard worktree.status == 0 else { throw DesktopError.message("创建更新 worktree 失败：\n\(worktree.output)") }
        }

        try self.prepare(stage, progress: progress)
        progress("正在执行本地健康检查…\n")
        try RuntimeController.healthCheck(
          sourceRoot: stage,
          dshHome: self.probeHome,
          supportRoot: self.supportRoot,
          progress: progress
        )
        self.defaults.set(current.path, forKey: "previousSourceRoot")
        self.defaults.set(stage.path, forKey: "activeSourceRoot")
        completion(.success(SourceUpdate(sourceRoot: stage, commit: remote, changed: true)))
      } catch {
        completion(.failure(error))
      }
    }
  }

  func rollback(current: URL) throws -> URL {
    guard let path = defaults.string(forKey: "previousSourceRoot") else {
      throw DesktopError.message("没有可回退的上一个源码版本。")
    }
    let previous = URL(fileURLWithPath: path, isDirectory: true)
    guard isSourceRoot(previous) else { throw DesktopError.message("上一个源码版本已不存在。") }
    defaults.set(current.path, forKey: "previousSourceRoot")
    defaults.set(previous.path, forKey: "activeSourceRoot")
    return previous
  }

  private func gitOutput(_ arguments: [String]) throws -> String {
    let result = try CommandRunner.run(executable: URL(fileURLWithPath: "/usr/bin/git"), arguments: arguments)
    guard result.status == 0 else { throw DesktopError.message("git 命令失败：\n\(result.output)") }
    return result.output.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}
