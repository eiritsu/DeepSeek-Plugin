import Darwin
import Foundation

final class StartupState: @unchecked Sendable {
  private let lock = NSLock()
  private let ready = DispatchSemaphore(value: 0)
  private let progress: @Sendable (String) -> Void
  private let log: @Sendable (String) -> Void
  private var readyURL: URL?
  private var startupError: Error?
  private var stdoutBuffer = ""
  private var signalled = false

  init(
    progress: @escaping @Sendable (String) -> Void,
    log: @escaping @Sendable (String) -> Void = { LogStore.shared.append($0) }
  ) {
    self.progress = progress
    self.log = log
  }

  func consume(_ data: Data, isError: Bool) {
    guard !data.isEmpty else { return }
    let text = String(decoding: data, as: UTF8.self)
    log("runtime\(isError ? " stderr" : ""): \(text.trimmingCharacters(in: .newlines))")
    lock.lock()
    if !isError {
      stdoutBuffer.append(text)
      if readyURL == nil,
         let range = stdoutBuffer.range(of: #"dsh web: (http://127\.0\.0\.1:\d+)"#, options: .regularExpression)
      {
        let line = String(stdoutBuffer[range])
        readyURL = URL(string: String(line.dropFirst("dsh web: ".count)))
      }
    }
    let found = readyURL != nil
    let shouldReportProgress = !isError && !found && !signalled
    lock.unlock()
    if shouldReportProgress { progress(text) }
    if found { signalOnce() }
  }

  func terminated(status: Int32) {
    lock.lock()
    if readyURL == nil {
      startupError = DesktopError.message("Harness 在就绪前退出（状态码 \(status)）。详情见桌面日志。")
    }
    lock.unlock()
    signalOnce()
  }

  func wait(timeout: DispatchTime) -> DispatchTimeoutResult { ready.wait(timeout: timeout) }

  func outcome() -> (URL?, Error?) {
    lock.lock()
    defer { lock.unlock() }
    return (readyURL, startupError)
  }

  private func signalOnce() {
    lock.lock()
    if signalled {
      lock.unlock()
      return
    }
    signalled = true
    lock.unlock()
    ready.signal()
  }
}

final class RuntimeController: @unchecked Sendable {
  private let queue = DispatchQueue(label: "ai.deepseek.harness.desktop.runtime", qos: .userInitiated)
  private let lock = NSLock()
  private let supportRoot: URL
  private var process: Process?
  private var stopping = false

  init(supportRoot: URL? = nil) {
    self.supportRoot = supportRoot ?? FileManager.default.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    )[0].appendingPathComponent("DeepSeek Harness Desktop", isDirectory: true)
  }

  func start(
    sourceRoot: URL,
    dshHome: URL,
    progress: @escaping @Sendable (String) -> Void,
    completion: @escaping @Sendable (Result<URL, Error>) -> Void
  ) {
    queue.async {
      do {
        let toolchain = try Toolchain.resolve(supportRoot: self.supportRoot, progress: progress)
        try FileManager.default.createDirectory(at: dshHome, withIntermediateDirectories: true)
        let executable = sourceRoot.appendingPathComponent("apps/cli/lib/bin.js")
        guard FileManager.default.fileExists(atPath: executable.path) else {
          throw DesktopError.message("缺少构建产物 apps/cli/lib/bin.js。请先构建源码，或使用 App 菜单中的“检查并更新源码”。")
        }
        let url = try self.launch(
          toolchain: toolchain,
          executable: executable,
          sourceRoot: sourceRoot,
          dshHome: dshHome,
          progress: progress
        )
        completion(.success(url))
      } catch {
        completion(.failure(error))
      }
    }
  }

  private func launch(
    toolchain: Toolchain,
    executable: URL,
    sourceRoot: URL,
    dshHome: URL,
    progress: @escaping @Sendable (String) -> Void
  ) throws -> URL {
    let child = Process()
    let stdout = Pipe()
    let stderr = Pipe()
    child.executableURL = toolchain.node
    child.arguments = [executable.path, "web", "--no-open", "--port", "0"]
    child.currentDirectoryURL = sourceRoot
    child.environment = toolchain.environment(overrides: [
      "DSH_HOME": dshHome.path,
      "DSH_DESKTOP_SHELL": "1",
    ])
    child.standardInput = FileHandle.nullDevice
    child.standardOutput = stdout
    child.standardError = stderr

    let state = StartupState(progress: progress)
    stdout.fileHandleForReading.readabilityHandler = { state.consume($0.availableData, isError: false) }
    stderr.fileHandleForReading.readabilityHandler = { state.consume($0.availableData, isError: true) }
    child.terminationHandler = { process in
      state.terminated(status: process.terminationStatus)
    }

    lock.lock()
    process = child
    stopping = false
    lock.unlock()
    try child.run()

    if state.wait(timeout: .now() + 120) == .timedOut {
      stopSynchronously()
      throw DesktopError.message("Harness 启动超过 120 秒。详情见桌面日志。")
    }

    let (resolvedURL, resolvedError) = state.outcome()
    if let resolvedError { throw resolvedError }
    guard let resolvedURL else { throw DesktopError.message("Harness 未返回有效的本地地址。") }
    do {
      try waitUntilHTTPReady(resolvedURL, timeout: 15)
    } catch {
      stopSynchronously()
      throw error
    }
    return resolvedURL
  }

  private func waitUntilHTTPReady(_ url: URL, timeout: TimeInterval) throws {
    let deadline = Date().addingTimeInterval(timeout)
    var lastFailure = "未返回 HTTP 响应"

    repeat {
      let outcome = LockedBox<Result<Void, Error>?>(nil)
      let completed = DispatchSemaphore(value: 0)
      var request = URLRequest(url: url)
      request.timeoutInterval = 2
      URLSession.shared.dataTask(with: request) { _, response, error in
        if let error {
          outcome.set(.failure(error))
        } else if (response as? HTTPURLResponse)?.statusCode == 200 {
          outcome.set(.success(()))
        } else {
          let status = (response as? HTTPURLResponse)?.statusCode.description ?? "无状态码"
          outcome.set(.failure(DesktopError.message("HTTP \(status)")))
        }
        completed.signal()
      }.resume()

      if completed.wait(timeout: .now() + 3) == .success, let result = outcome.get() {
        switch result {
        case .success: return
        case let .failure(error): lastFailure = error.localizedDescription
        }
      } else {
        lastFailure = "请求超时"
      }
      if Date() < deadline { usleep(100_000) }
    } while Date() < deadline

    throw DesktopError.message("Harness 已报告本地地址，但 HTTP 服务未就绪（\(lastFailure)）。详情见桌面日志。")
  }

  func stop(completion: @escaping @Sendable () -> Void = {}) {
    queue.async {
      self.stopSynchronously()
      completion()
    }
  }

  private func stopSynchronously() {
    lock.lock()
    guard let child = process, child.isRunning, !stopping else {
      process = nil
      lock.unlock()
      return
    }
    stopping = true
    lock.unlock()

    kill(child.processIdentifier, SIGTERM)
    let deadline = Date().addingTimeInterval(7)
    while child.isRunning && Date() < deadline { usleep(100_000) }
    if child.isRunning { kill(child.processIdentifier, SIGKILL) }
    child.waitUntilExit()
    child.standardOutput.flatMap { $0 as? Pipe }?.fileHandleForReading.readabilityHandler = nil
    child.standardError.flatMap { $0 as? Pipe }?.fileHandleForReading.readabilityHandler = nil

    lock.lock()
    process = nil
    stopping = false
    lock.unlock()
  }

  static func healthCheck(
    sourceRoot: URL,
    dshHome: URL,
    supportRoot: URL,
    progress: @escaping @Sendable (String) -> Void
  ) throws {
    let runtime = RuntimeController(supportRoot: supportRoot)
    let ready = DispatchSemaphore(value: 0)
    let result = LockedBox<Result<URL, Error>?>(nil)
    runtime.start(sourceRoot: sourceRoot, dshHome: dshHome, progress: progress) {
      result.set($0)
      ready.signal()
    }
    guard ready.wait(timeout: .now() + 130) == .success, let result = result.get() else {
      throw DesktopError.message("更新版本健康检查超时。")
    }
    let url = try result.get()
    let response = DispatchSemaphore(value: 0)
    let healthError = LockedBox<Error?>(nil)
    URLSession.shared.dataTask(with: url) { _, reply, error in
      if let error { healthError.set(error) }
      else if (reply as? HTTPURLResponse)?.statusCode != 200 {
        healthError.set(DesktopError.message("更新版本健康检查未返回 HTTP 200。"))
      }
      response.signal()
    }.resume()
    if response.wait(timeout: .now() + 15) == .timedOut {
      healthError.set(DesktopError.message("更新版本 HTTP 健康检查超时。"))
    }
    let stopped = DispatchSemaphore(value: 0)
    runtime.stop { stopped.signal() }
    _ = stopped.wait(timeout: .now() + 10)
    if let healthError = healthError.get() { throw healthError }
  }
}
