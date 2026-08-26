import CryptoKit
import Foundation

enum DesktopError: LocalizedError {
  case message(String)

  var errorDescription: String? {
    switch self {
    case let .message(message): message
    }
  }
}

final class LogStore: @unchecked Sendable {
  static let shared = LogStore()

  private let lock = NSLock()
  let fileURL: URL

  private init() {
    let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("DeepSeek Harness Desktop", isDirectory: true)
      .appendingPathComponent("logs", isDirectory: true)
    try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    fileURL = root.appendingPathComponent("desktop.log")
  }

  func append(_ message: String) {
    lock.lock()
    defer { lock.unlock() }
    let timestamp = ISO8601DateFormatter().string(from: Date())
    let data = Data("[\(timestamp)] \(message)\n".utf8)
    if !FileManager.default.fileExists(atPath: fileURL.path) {
      FileManager.default.createFile(atPath: fileURL.path, contents: data)
      return
    }
    guard let handle = try? FileHandle(forWritingTo: fileURL) else { return }
    defer { try? handle.close() }
    do {
      try handle.seekToEnd()
      try handle.write(contentsOf: data)
    } catch {}
  }
}

struct Toolchain: Sendable {
  struct ManagedDistribution: Sendable {
    let archiveURL: URL
    let directoryName: String
    let sha256: String
  }

  static let managedDistribution = ManagedDistribution(
    archiveURL: URL(string: "https://nodejs.org/dist/v24.16.0/node-v24.16.0-darwin-arm64.tar.gz")!,
    directoryName: "node-v24.16.0-darwin-arm64",
    sha256: "39189dab4eeb15706c424af0ac08a3044c9e48f7db12a7d77f6b7aafc7dd5df6"
  )

  let node: URL
  let npx: URL

  static func locate(supportRoot: URL? = nil, candidateDirectories: [String]? = nil) throws -> Toolchain {
    let environment = ProcessInfo.processInfo.environment
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let pathDirectories = (environment["PATH"] ?? "").split(separator: ":").map(String.init)
    let managed = supportRoot?.appendingPathComponent("tools/node/bin", isDirectory: true).path
    let hostCandidates = candidateDirectories ?? [
      "\(home)/.local/bin",
      "\(home)/.hermes/node/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
    ] + pathDirectories
    let candidates = [managed].compactMap { $0 } + hostCandidates

    for directory in candidates {
      let root = URL(fileURLWithPath: directory, isDirectory: true)
      let node = root.appendingPathComponent("node")
      let npx = root.appendingPathComponent("npx")
      guard FileManager.default.isExecutableFile(atPath: node.path),
            FileManager.default.isExecutableFile(atPath: npx.path),
            supports(node: node)
      else { continue }
      return Toolchain(node: node, npx: npx)
    }
    throw DesktopError.message("未找到兼容的 Node.js / npx。应用将尝试安装受管理的 Node.js 24。")
  }

  static func resolve(
    supportRoot: URL,
    progress: @escaping @Sendable (String) -> Void,
    distribution: ManagedDistribution = managedDistribution,
    candidateDirectories: [String]? = nil
  ) throws -> Toolchain {
    if let toolchain = try? locate(supportRoot: supportRoot, candidateDirectories: candidateDirectories) {
      return toolchain
    }
    return try installManaged(
      supportRoot: supportRoot,
      progress: progress,
      distribution: distribution,
      candidateDirectories: candidateDirectories
    )
  }

  static func installManaged(
    supportRoot: URL,
    progress: @escaping @Sendable (String) -> Void,
    distribution: ManagedDistribution,
    candidateDirectories: [String]? = nil
  ) throws -> Toolchain {
    let fileManager = FileManager.default
    let toolsRoot = supportRoot.appendingPathComponent("tools", isDirectory: true)
    try fileManager.createDirectory(at: toolsRoot, withIntermediateDirectories: true)
    let stage = toolsRoot.appendingPathComponent("node-install-\(UUID().uuidString)", isDirectory: true)
    try fileManager.createDirectory(at: stage, withIntermediateDirectories: false)
    defer { try? fileManager.removeItem(at: stage) }
    let archive = stage.appendingPathComponent("node.tar.gz")

    progress("正在下载受管理的 Node.js 24…\n")
    let download = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/curl"),
      arguments: ["--fail", "--location", "--show-error", "--output", archive.path, distribution.archiveURL.absoluteString],
      progress: progress
    )
    guard download.status == 0 else {
      throw DesktopError.message("Node.js 下载失败：\n\(download.output)")
    }
    let digest = SHA256.hash(data: try Data(contentsOf: archive)).map { String(format: "%02x", $0) }.joined()
    guard digest == distribution.sha256 else {
      throw DesktopError.message("Node.js 下载文件校验失败，已拒绝安装。")
    }

    progress("正在安装受管理的 Node.js 24…\n")
    let unpack = try CommandRunner.run(
      executable: URL(fileURLWithPath: "/usr/bin/tar"),
      arguments: ["-xzf", archive.path, "-C", stage.path],
      progress: progress
    )
    guard unpack.status == 0 else {
      throw DesktopError.message("Node.js 解压失败：\n\(unpack.output)")
    }
    let extracted = stage.appendingPathComponent(distribution.directoryName, isDirectory: true)
    let extractedNode = extracted.appendingPathComponent("bin/node")
    let extractedNpx = extracted.appendingPathComponent("bin/npx")
    guard fileManager.isExecutableFile(atPath: extractedNode.path),
          fileManager.isExecutableFile(atPath: extractedNpx.path),
          supports(node: extractedNode)
    else {
      throw DesktopError.message("Node.js 下载文件缺少兼容的 node 或 npx 可执行文件。")
    }

    let target = toolsRoot.appendingPathComponent("node", isDirectory: true)
    let previous = toolsRoot.appendingPathComponent("node-previous-\(UUID().uuidString)", isDirectory: true)
    let hadPrevious = fileManager.fileExists(atPath: target.path)
    if hadPrevious { try fileManager.moveItem(at: target, to: previous) }
    var installedNew = false
    do {
      try fileManager.moveItem(at: extracted, to: target)
      installedNew = true
      if hadPrevious { try fileManager.removeItem(at: previous) }
    } catch {
      if installedNew { try? fileManager.removeItem(at: target) }
      if hadPrevious { try? fileManager.moveItem(at: previous, to: target) }
      if !hadPrevious, let installedByAnotherProcess = try? locate(
        supportRoot: supportRoot,
        candidateDirectories: candidateDirectories
      ) {
        return installedByAnotherProcess
      }
      throw error
    }
    return try locate(supportRoot: supportRoot, candidateDirectories: candidateDirectories)
  }

  static func supports(node: URL) -> Bool {
    guard let result = try? CommandRunner.run(executable: node, arguments: ["--version"]), result.status == 0 else {
      return false
    }
    let value = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
    let fields = value.drop(while: { $0 == "v" }).split(separator: ".")
    guard fields.count >= 2, let major = Int(fields[0]), let minor = Int(fields[1]) else { return false }
    return (major == 22 && minor >= 19) || major >= 24
  }

  func environment(overrides: [String: String] = [:], prepending paths: [String] = []) -> [String: String] {
    var result = ProcessInfo.processInfo.environment
    let directories = paths + [node.deletingLastPathComponent().path, npx.deletingLastPathComponent().path]
    result["PATH"] = (directories + [(result["PATH"] ?? "")]).joined(separator: ":")
    for (key, value) in overrides { result[key] = value }
    return result
  }
}

struct CommandResult: Sendable {
  let status: Int32
  let output: String
}

final class LockedBox<Value>: @unchecked Sendable {
  private let lock = NSLock()
  private var value: Value

  init(_ value: Value) { self.value = value }

  func get() -> Value {
    lock.lock()
    defer { lock.unlock() }
    return value
  }

  func set(_ value: Value) {
    lock.lock()
    self.value = value
    lock.unlock()
  }

  func update(_ body: (inout Value) -> Void) {
    lock.lock()
    defer { lock.unlock() }
    body(&value)
  }
}

enum CommandRunner {
  static func run(
    executable: URL,
    arguments: [String],
    directory: URL? = nil,
    environment: [String: String]? = nil,
    progress: (@Sendable (String) -> Void)? = nil
  ) throws -> CommandResult {
    let process = Process()
    let output = Pipe()
    process.executableURL = executable
    process.arguments = arguments
    process.currentDirectoryURL = directory
    process.environment = environment
    process.standardOutput = output
    process.standardError = output
    try process.run()

    var collected = Data()
    while true {
      let chunk = output.fileHandleForReading.availableData
      if chunk.isEmpty { break }
      collected.append(chunk)
      if let line = String(data: chunk, encoding: .utf8) {
        LogStore.shared.append(line.trimmingCharacters(in: .newlines))
        progress?(line)
      }
    }
    process.waitUntilExit()
    return CommandResult(status: process.terminationStatus, output: String(decoding: collected, as: UTF8.self))
  }
}
