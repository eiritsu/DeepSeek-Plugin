import Darwin
import Foundation

@_silgen_name("flock")
private func systemFlock(_ descriptor: Int32, _ operation: Int32) -> Int32

enum RuntimeInstanceLockError: LocalizedError, Equatable {
  case alreadyRunning(processIdentifier: pid_t?)
  case system(operation: String, code: Int32)

  var errorDescription: String? {
    switch self {
    case .alreadyRunning:
      return "另一个 DeepSeek Harness 实例正在使用当前数据目录。请先切换到或退出已有实例。"
    case let .system(operation, code):
      return "无法保护 DeepSeek Harness 数据目录（\(operation)，错误码 \(code)）。"
    }
  }
}

final class RuntimeInstanceLock {
  private var descriptor: Int32?

  init(supportRoot: URL) throws {
    try FileManager.default.createDirectory(at: supportRoot, withIntermediateDirectories: true)
    let path = supportRoot.appendingPathComponent("runtime.lock").path
    let descriptor = Darwin.open(path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else {
      throw RuntimeInstanceLockError.system(operation: "open", code: errno)
    }
    guard systemFlock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
      let code = errno
      let processIdentifier = code == EWOULDBLOCK ? Self.readOwner(path) : nil
      Darwin.close(descriptor)
      if code == EWOULDBLOCK {
        throw RuntimeInstanceLockError.alreadyRunning(processIdentifier: processIdentifier)
      }
      throw RuntimeInstanceLockError.system(operation: "flock", code: code)
    }
    self.descriptor = descriptor
    do {
      try Self.writeOwner(descriptor)
    } catch {
      _ = systemFlock(descriptor, LOCK_UN)
      Darwin.close(descriptor)
      throw error
    }
  }

  deinit {
    release()
  }

  func release() {
    guard let descriptor else { return }
    self.descriptor = nil
    _ = systemFlock(descriptor, LOCK_UN)
    Darwin.close(descriptor)
  }

  private static func writeOwner(_ descriptor: Int32) throws {
    guard Darwin.ftruncate(descriptor, 0) == 0, Darwin.lseek(descriptor, 0, SEEK_SET) >= 0 else {
      throw RuntimeInstanceLockError.system(operation: "truncate", code: errno)
    }
    let owner = Data("\(getpid())\n".utf8)
    let result = owner.withUnsafeBytes { bytes in
      Darwin.write(descriptor, bytes.baseAddress, bytes.count)
    }
    guard result == owner.count else {
      throw RuntimeInstanceLockError.system(operation: "write", code: errno)
    }
  }

  private static func readOwner(_ path: String) -> pid_t? {
    guard
      let contents = try? String(contentsOfFile: path, encoding: .utf8),
      let processIdentifier = Int32(contents.trimmingCharacters(in: .whitespacesAndNewlines)),
      processIdentifier > 0
    else {
      return nil
    }
    return processIdentifier
  }
}
