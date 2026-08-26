import AppKit
import Foundation
import WebKit

@main
enum DeepSeekHarnessDesktopApp {
  static func main() {
    let application = NSApplication.shared
    let delegate = AppDelegate()
    application.delegate = delegate
    application.setActivationPolicy(.regular)
    application.run()
  }
}

@MainActor
func makeDesktopWindow() -> NSWindow {
  let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 1240, height: 820),
    styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
    backing: .buffered,
    defer: false
  )
  window.titlebarAppearsTransparent = true
  window.isMovableByWindowBackground = true
  return window
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate,
  WKUIDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply
{
  private let sources = SourceManager()
  private lazy var runtime = RuntimeController(supportRoot: sources.supportRoot)
  private lazy var plugins = PluginManager(supportRoot: sources.supportRoot, dshHome: sources.dshHome)
  private var sourceRoot: URL?
  private var runtimeURL: URL?
  private var activeRecoveryProfile: DesktopRecoveryProfile?
  private var recoveredPluginNotice: String?
  private var terminating = false
  private var updating = false

  private let window = makeDesktopWindow()
  private let webContent = WKUserContentController()
  private lazy var webView: WKWebView = {
    installSelectionBridgeScript(
      UserDefaults.standard.string(forKey: SessionSelectionBridge.nativeStorageKey)
    )
    webContent.add(self, name: SessionSelectionBridge.messageName)
    webContent.addScriptMessageHandler(self, contentWorld: .page, name: DesktopPluginBridge.messageName)
    let configuration = WKWebViewConfiguration()
    configuration.userContentController = webContent
    return WKWebView(frame: .zero, configuration: configuration)
  }()
  private let statusLabel = NSTextField(wrappingLabelWithString: "正在启动…")
  private let spinner = NSProgressIndicator()
  private let windowDragRegion = WindowDragRegionView()

  func applicationDidFinishLaunching(_ notification: Notification) {
    configureWindow()
    configureMenu()
    start()
  }

  private func configureWindow() {
    window.title = "DeepSeek Harness"
    window.center()
    window.minSize = NSSize(width: 860, height: 600)
    window.delegate = self

    let content = NSView(frame: window.contentView?.bounds ?? .zero)
    content.autoresizingMask = [.width, .height]
    webView.frame = content.bounds
    webView.autoresizingMask = [.width, .height]
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.isHidden = true
    content.addSubview(webView)

    spinner.style = .spinning
    spinner.controlSize = .regular
    spinner.translatesAutoresizingMaskIntoConstraints = false
    spinner.startAnimation(nil)
    statusLabel.alignment = .center
    statusLabel.font = .systemFont(ofSize: 14)
    statusLabel.textColor = .secondaryLabelColor
    statusLabel.maximumNumberOfLines = 8
    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    content.addSubview(spinner)
    content.addSubview(statusLabel)
    NSLayoutConstraint.activate([
      spinner.centerXAnchor.constraint(equalTo: content.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: content.centerYAnchor, constant: -22),
      statusLabel.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 14),
      statusLabel.centerXAnchor.constraint(equalTo: content.centerXAnchor),
      statusLabel.widthAnchor.constraint(lessThanOrEqualTo: content.widthAnchor, multiplier: 0.72),
    ])
    window.contentView = content
    if let titlebar = window.standardWindowButton(.closeButton)?.superview {
      windowDragRegion.frame = NSRect(
        x: 300,
        y: 0,
        width: max(0, titlebar.bounds.width - 300),
        height: titlebar.bounds.height
      )
      windowDragRegion.autoresizingMask = [.width, .height]
      titlebar.addSubview(windowDragRegion)
    }
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  private func installSelectionBridgeScript(_ selection: String?) {
    webContent.removeAllUserScripts()
    webContent.addUserScript(WKUserScript(
      source: SessionSelectionBridge.scriptSource(restoredSelection: selection),
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    ))
    webContent.addUserScript(WKUserScript(
      source: DesktopPluginBridge.scriptSource,
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    ))
  }

  private func configureMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem()
    main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "关于 DeepSeek Harness", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "检查并更新源码…", action: #selector(checkForUpdates), keyEquivalent: "u")
    appMenu.addItem(withTitle: "回退到上一个源码版本…", action: #selector(rollbackSource), keyEquivalent: "")
    appMenu.addItem(.separator())
    let pluginItem = NSMenuItem(title: "插件", action: nil, keyEquivalent: "")
    let pluginMenu = NSMenu(title: "插件")
    pluginMenu.addItem(withTitle: "安装插件…", action: #selector(installPlugin), keyEquivalent: "")
    pluginMenu.addItem(withTitle: "更新插件…", action: #selector(updatePlugin), keyEquivalent: "")
    pluginMenu.addItem(withTitle: "移除插件…", action: #selector(removePlugin), keyEquivalent: "")
    pluginMenu.addItem(.separator())
    pluginMenu.addItem(withTitle: "列出已安装插件", action: #selector(listPlugins), keyEquivalent: "")
    pluginItem.submenu = pluginMenu
    appMenu.addItem(pluginItem)
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "打开源码目录", action: #selector(openSourceDirectory), keyEquivalent: "")
    appMenu.addItem(withTitle: "打开桌面日志", action: #selector(openLog), keyEquivalent: "l")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "退出 DeepSeek Harness", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu

    let editItem = NSMenuItem()
    main.addItem(editItem)
    let editMenu = NSMenu(title: "编辑")
    editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
    let redoItem = editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "z")
    redoItem.keyEquivalentModifierMask = [.command, .shift]
    editMenu.addItem(.separator())
    editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    editMenu.addItem(.separator())
    editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = editMenu

    let viewItem = NSMenuItem()
    main.addItem(viewItem)
    let viewMenu = NSMenu(title: "显示")
    viewMenu.addItem(withTitle: "重新载入", action: #selector(reload), keyEquivalent: "r")
    viewMenu.addItem(withTitle: "切换全屏", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
    viewItem.submenu = viewMenu
    NSApp.mainMenu = main
  }

  private func showStatus(_ message: String, busy: Bool = true) {
    webView.isHidden = true
    statusLabel.isHidden = false
    statusLabel.stringValue = message
    spinner.isHidden = !busy
    if busy { spinner.startAnimation(nil) } else { spinner.stopAnimation(nil) }
  }

  private func start(source: URL? = nil) {
    if let recovery = activeRecoveryProfile {
      activeRecoveryProfile = nil
      plugins.removeRecoveryProfile(recovery) { [weak self] in
        DispatchQueue.main.async { self?.start(source: source) }
      }
      return
    }
    showStatus("正在准备 DeepSeek Harness…")
    let progress: @Sendable (String) -> Void = { text in
      let line = text.split(whereSeparator: \Character.isNewline).last.map(String.init) ?? text
      DispatchQueue.main.async { [weak self] in self?.showStatus(line) }
    }
    let ready: @Sendable (Result<URL, Error>) -> Void = { [weak self] result in
      DispatchQueue.main.async {
        guard let self else { return }
        switch result {
        case let .success(root):
          self.sourceRoot = root
          self.startRuntime(source: root, progress: progress)
        case let .failure(error): self.showFailure(error)
        }
      }
    }
    if let source { ready(.success(source)) }
    else { sources.resolveAndPrepare(progress: progress, completion: ready) }
  }

  private func startRuntime(
    source: URL,
    profile: String = "web",
    allowPluginRecovery: Bool = true,
    progress: @escaping @Sendable (String) -> Void
  ) {
    runtime.start(
      sourceRoot: source,
      dshHome: sources.dshHome,
      profile: profile,
      progress: progress
    ) { [weak self] result in
      DispatchQueue.main.async {
        guard let self else { return }
        switch result {
        case let .success(url):
          self.runtimeURL = url
          self.statusLabel.isHidden = true
          self.spinner.isHidden = true
          self.webView.isHidden = false
          self.webView.load(URLRequest(url: url))
          if let package = self.recoveredPluginNotice {
            self.recoveredPluginNotice = nil
            self.alert(
              title: "已临时禁用故障插件",
              message: "\(package) 仅在本次运行中被跳过，安装和 Web profile 均未修改。下次启动会再次尝试加载它。"
            )
          }
        case let .failure(error):
          guard allowPluginRecovery,
                let package = (error as? RuntimeStartupFailure)?.failingPluginPackage
          else {
            self.showFailure(error)
            return
          }
          self.recoverFromPluginFailure(
            package: package,
            originalError: error,
            source: source,
            progress: progress
          )
        }
      }
    }
  }

  private func recoverFromPluginFailure(
    package: String,
    originalError: Error,
    source: URL,
    progress: @escaping @Sendable (String) -> Void
  ) {
    showStatus("侧载插件 \(package) 启动失败，正在临时禁用并重试…")
    plugins.prepareRecoveryProfile(disabling: package) { [weak self] result in
      DispatchQueue.main.async {
        guard let self else { return }
        switch result {
        case let .success(recovery?):
          self.activeRecoveryProfile = recovery
          self.recoveredPluginNotice = package
          LogStore.shared.append("desktop recovery: temporarily disabled \(package) for profile \(recovery.name)")
          self.startRuntime(
            source: source,
            profile: recovery.name,
            allowPluginRecovery: false,
            progress: progress
          )
        case .success(nil):
          self.showFailure(originalError)
        case let .failure(recoveryError):
          LogStore.shared.append("desktop recovery failed: \(recoveryError.localizedDescription)")
          self.showFailure(originalError)
        }
      }
    }
  }

  private func showFailure(_ error: Error) {
    LogStore.shared.append("desktop error: \(error.localizedDescription)")
    showStatus("启动失败\n\n\(error.localizedDescription)\n\n可从菜单打开桌面日志。", busy: false)
  }

  @objc private func checkForUpdates() {
    guard !updating, let current = sourceRoot else { return }
    updating = true
    showStatus("正在检查源码更新…")
    let progress: @Sendable (String) -> Void = { text in
      let line = text.split(whereSeparator: \Character.isNewline).last.map(String.init) ?? text
      DispatchQueue.main.async { [weak self] in self?.showStatus(line) }
    }
    sources.update(current: current, progress: progress) { [weak self] result in
      DispatchQueue.main.async {
        guard let self else { return }
        self.updating = false
        switch result {
        case let .success(update) where !update.changed:
          self.restoreWebView()
          self.alert(title: "已经是最新版本", message: "当前源码提交：\(update.commit.prefix(12))")
        case let .success(update):
          self.showStatus("更新已通过健康检查，正在切换版本…")
          self.runtime.stop {
            DispatchQueue.main.async {
              self.sourceRoot = update.sourceRoot
              self.start(source: update.sourceRoot)
            }
          }
        case let .failure(error):
          self.restoreWebView()
          self.alert(title: "源码更新失败", message: error.localizedDescription)
        }
      }
    }
  }

  @objc private func rollbackSource() {
    guard let current = sourceRoot else { return }
    let confirmation = NSAlert()
    confirmation.messageText = "回退源码版本？"
    confirmation.informativeText = "会保留会话与设置，只切换运行源码。"
    confirmation.addButton(withTitle: "回退")
    confirmation.addButton(withTitle: "取消")
    guard confirmation.runModal() == .alertFirstButtonReturn else { return }
    do {
      let previous = try sources.rollback(current: current)
      showStatus("正在回退源码版本…")
      runtime.stop { DispatchQueue.main.async { self.start(source: previous) } }
    } catch { alert(title: "无法回退", message: error.localizedDescription) }
  }

  @objc private func installPlugin() {
    guard let package = prompt(
      title: "安装插件",
      message: "输入 npm 包、Git URL 或本地路径。第三方插件会作为可信本机代码运行。",
      placeholder: "@scope/dsh-plugin"
    ) else { return }
    runPluginCommand(["add", package], title: "正在安装插件…")
  }

  @objc private func updatePlugin() {
    guard let package = prompt(
      title: "更新插件",
      message: "输入已安装插件的包名。",
      placeholder: "@scope/dsh-plugin"
    ) else { return }
    runPluginCommand(["update", package], title: "正在更新插件…")
  }

  @objc private func removePlugin() {
    guard let package = prompt(
      title: "移除插件",
      message: "输入已安装插件的包名。",
      placeholder: "@scope/dsh-plugin"
    ) else { return }
    runPluginCommand(["remove", package], title: "正在移除插件…")
  }

  @objc private func listPlugins() {
    runPluginCommand(["list", "--depth", "0"], title: "正在读取插件列表…", restart: false, showOutput: true)
  }

  private func runPluginCommand(
    _ arguments: [String],
    title: String,
    restart: Bool = true,
    showOutput: Bool = false
  ) {
    guard !updating, let source = sourceRoot else { return }
    updating = true
    showStatus(title)
    let execute: @MainActor @Sendable () -> Void = {
      let progress: @Sendable (String) -> Void = { text in
        let line = text.split(whereSeparator: \Character.isNewline).last.map(String.init) ?? text
        DispatchQueue.main.async { [weak self] in self?.showStatus(line) }
      }
      self.plugins.run(sourceRoot: source, arguments: arguments, progress: progress) { [weak self] result in
        DispatchQueue.main.async {
          guard let self else { return }
          self.updating = false
          switch result {
          case let .success(output):
            if restart { self.start(source: source) }
            else { self.restoreWebView() }
            if showOutput {
              self.alert(title: "已安装插件", message: output.isEmpty ? "没有列出插件。" : output)
            }
          case let .failure(error):
            if restart { self.start(source: source) }
            else { self.restoreWebView() }
            self.alert(title: "插件操作失败", message: error.localizedDescription)
          }
        }
      }
    }
    if restart { runtime.stop { DispatchQueue.main.async { execute() } } }
    else { execute() }
  }

  private func prompt(title: String, message: String, placeholder: String) -> String? {
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
    field.placeholderString = placeholder
    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = message
    alert.accessoryView = field
    alert.addButton(withTitle: "继续")
    alert.addButton(withTitle: "取消")
    guard alert.runModal() == .alertFirstButtonReturn else { return nil }
    let value = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? nil : value
  }

  private func restoreWebView() {
    statusLabel.isHidden = true
    spinner.isHidden = true
    webView.isHidden = false
  }

  private func alert(title: String, message: String) {
    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = message
    alert.runModal()
  }

  @objc private func reload() {
    if let runtimeURL { webView.load(URLRequest(url: runtimeURL)) }
  }

  @objc private func openSourceDirectory() {
    if let sourceRoot { NSWorkspace.shared.open(sourceRoot) }
  }

  @objc private func openLog() {
    NSWorkspace.shared.open(LogStore.shared.fileURL)
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url,
          ExternalNavigation.shouldOpen(url, navigationType: navigationAction.navigationType)
    else {
      decisionHandler(.allow)
      return
    }
    NSWorkspace.shared.open(url)
    decisionHandler(.cancel)
  }

  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    guard navigationAction.targetFrame == nil,
          let url = navigationAction.request.url,
          ExternalNavigation.shouldOpen(url, navigationType: navigationAction.navigationType)
    else { return nil }
    NSWorkspace.shared.open(url)
    return nil
  }

  func webView(
    _ webView: WKWebView,
    runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void
  ) {
    guard frame.isMainFrame else {
      completionHandler(nil)
      return
    }
    let panel = NSOpenPanel()
    panel.canChooseFiles = true
    panel.canChooseDirectories = true
    panel.allowsMultipleSelection = true
    panel.canCreateDirectories = false
    panel.beginSheetModal(for: window) { response in
      completionHandler(response == .OK ? panel.urls : nil)
    }
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == SessionSelectionBridge.messageName,
          message.frameInfo.isMainFrame,
          SessionSelectionBridge.acceptsMessageHost(message.frameInfo.securityOrigin.host)
    else { return }

    let defaults = UserDefaults.standard
    let selection = message.body as? String
    if selection == defaults.string(forKey: SessionSelectionBridge.nativeStorageKey) { return }
    if let selection {
      defaults.set(selection, forKey: SessionSelectionBridge.nativeStorageKey)
    } else if message.body is NSNull {
      defaults.removeObject(forKey: SessionSelectionBridge.nativeStorageKey)
    } else {
      return
    }
    installSelectionBridgeScript(selection)
  }

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage,
    replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
  ) {
    guard message.name == DesktopPluginBridge.messageName,
          message.frameInfo.isMainFrame,
          SessionSelectionBridge.acceptsMessageHost(message.frameInfo.securityOrigin.host),
          let request = message.body as? [String: Any],
          let action = request["action"] as? String
    else {
      replyHandler(nil, "插件请求只接受 loopback 主 frame 的结构化消息。")
      return
    }

    switch action {
    case "list":
      guard let source = sourceRoot else {
        replyHandler(nil, "Harness 源码目录尚未就绪。")
        return
      }
      plugins.list(sourceRoot: source) { result in
        DispatchQueue.main.async {
          switch result {
          case let .success(installed):
            replyHandler(["plugins": installed.map {
              var payload: [String: Any] = [
                "name": $0.name,
                "displayName": $0.displayName,
                "version": $0.version,
                "removable": $0.removable,
              ]
              if let latestVersion = $0.latestVersion { payload["latestVersion"] = latestVersion }
              return payload
            }], nil)
          case let .failure(error):
            replyHandler(nil, error.localizedDescription)
          }
        }
      }
    case "logs":
      plugins.logs { result in
        DispatchQueue.main.async {
          switch result {
          case let .success(records):
            replyHandler(["records": records.map {
              [
                "id": $0.id,
                "timestamp": $0.timestamp,
                "action": $0.action,
                "subject": $0.subject,
                "status": $0.status,
                "message": $0.message,
              ]
            }], nil)
          case let .failure(error):
            replyHandler(nil, error.localizedDescription)
          }
        }
      }
    case "catalog":
      let page = request["page"] as? Int ?? 1
      let pageSize = request["pageSize"] as? Int ?? 12
      let query = request["query"] as? String ?? ""
      plugins.catalog(page: page, pageSize: pageSize, query: query) { result in
        DispatchQueue.main.async {
          switch result {
          case let .success(result):
            replyHandler(["plugins": result.plugins.map {
              var item: [String: Any] = [
                "repository": $0.repository,
                "stars": $0.stars,
                "updatedAt": $0.updatedAt,
                "htmlUrl": $0.htmlURL,
                "category": $0.category.rawValue,
                "installable": $0.installable,
              ]
              if let description = $0.description { item["description"] = description }
              if let language = $0.language { item["language"] = language }
              return item
            }, "hasMore": result.hasMore], nil)
          case let .failure(error):
            replyHandler(nil, error.localizedDescription)
          }
        }
      }
    case "thirdPartyCatalog":
      let page = request["page"] as? Int ?? 1
      let pageSize = request["pageSize"] as? Int ?? 12
      let query = request["query"] as? String ?? ""
      let category = request["category"] as? String ?? ""
      let sort = request["sort"] as? String ?? "stars"
      plugins.thirdPartyCatalog(
        page: page,
        pageSize: pageSize,
        query: query,
        category: category,
        sort: sort
      ) { result in
        DispatchQueue.main.async {
          switch result {
          case let .success(result):
            replyHandler([
              "plugins": result.plugins.map {
              [
                "id": $0.id,
                "name": $0.name,
                "repository": $0.repository,
                "englishDescription": $0.englishDescription,
                "chineseDescription": $0.chineseDescription,
                "stars": $0.stars,
                "categoryId": $0.categoryID,
                "detailUrl": $0.detailURL,
                "repositoryUrl": $0.repositoryURL,
              ]
            },
              "hasMore": result.hasMore,
              "total": result.total,
              "catalogTotal": result.catalogTotal,
              "categories": result.categories.map {
                [
                  "id": $0.id,
                  "englishName": $0.englishName,
                  "chineseName": $0.chineseName,
                  "count": $0.count,
                ]
              },
            ], nil)
          case let .failure(error):
            replyHandler(nil, error.localizedDescription)
          }
        }
      }
    case "review":
      guard let source = request["source"] as? String else {
        replyHandler(nil, "插件审查请求缺少 source。")
        return
      }
      plugins.review(source: source) { result in
        DispatchQueue.main.async {
          switch result {
          case let .success(report):
            replyHandler(["report": self.pluginReviewPayload(report)], nil)
          case let .failure(error):
            replyHandler(nil, error.localizedDescription)
          }
        }
      }
    case "reviewUpdate":
      guard let package = request["package"] as? String else {
        replyHandler(nil, "插件更新审查请求缺少 package。")
        return
      }
      plugins.reviewUpdate(package: package) { result in
        DispatchQueue.main.async {
          switch result {
          case let .success(report):
            replyHandler(["report": self.pluginReviewPayload(report)], nil)
          case let .failure(error):
            replyHandler(nil, error.localizedDescription)
          }
        }
      }
    case "selectDirectory":
      let panel = NSOpenPanel()
      panel.canChooseFiles = false
      panel.canChooseDirectories = true
      panel.allowsMultipleSelection = false
      panel.canCreateDirectories = false
      panel.prompt = "选择插件目录"
      panel.beginSheetModal(for: window) { response in
        guard response == .OK, let directory = panel.url else {
          replyHandler([:], nil)
          return
        }
        replyHandler(["path": directory.standardizedFileURL.resolvingSymlinksInPath().path], nil)
      }
    case "reviewRepository":
      guard let repository = request["repository"] as? String else {
        replyHandler(nil, "社区插件审查请求缺少 repository。")
        return
      }
      plugins.reviewRepository(repository: repository) { result in
        DispatchQueue.main.async {
          switch result {
          case let .success(report):
            replyHandler(["report": self.pluginReviewPayload(report)], nil)
          case let .failure(error):
            replyHandler(nil, error.localizedDescription)
          }
        }
      }
    case "reviewThirdParty":
      guard let id = request["id"] as? String else {
        replyHandler(nil, "第三方插件审查请求缺少 id。")
        return
      }
      plugins.reviewThirdParty(id: id) { result in
        DispatchQueue.main.async {
          switch result {
          case let .success(report):
            replyHandler(["report": self.pluginReviewPayload(report)], nil)
          case let .failure(error):
            replyHandler(nil, error.localizedDescription)
          }
        }
      }
    case "install":
      guard let reviewID = request["reviewId"] as? String else {
        replyHandler(nil, "插件安装请求缺少 reviewId。")
        return
      }
      let force = request["force"] as? Bool ?? false
      runBridgeMutation(replyHandler: replyHandler) { source, progress, completion in
        self.plugins.install(
          sourceRoot: source,
          reviewID: reviewID,
          force: force,
          progress: progress,
          completion: completion
        )
      }
    case "cancelReview":
      guard let reviewID = request["reviewId"] as? String else {
        replyHandler(nil, "取消插件审查请求缺少 reviewId。")
        return
      }
      plugins.cancelReview(reviewID: reviewID) { result in
        DispatchQueue.main.async {
          switch result {
          case .success:
            replyHandler(["ok": true], nil)
          case let .failure(error):
            replyHandler(nil, error.localizedDescription)
          }
        }
      }
    case "remove":
      guard let package = request["package"] as? String else {
        replyHandler(nil, "插件卸载请求缺少 package。")
        return
      }
      runBridgeMutation(replyHandler: replyHandler) { source, progress, completion in
        self.plugins.remove(
          sourceRoot: source,
          package: package,
          progress: progress,
          completion: completion
        )
      }
    default:
      replyHandler(nil, "不支持的插件操作：\(action)")
    }
  }

  private func pluginReviewPayload(_ report: DesktopPluginReview) -> [String: Any] {
    var payload: [String: Any] = [
      "source": report.source,
      "kind": report.kind,
      "subject": report.subject,
      "category": report.category.rawValue,
      "installable": report.installable,
      "requiresForceInstall": report.requiresForceInstall,
      "findings": report.findings,
      "risks": report.risks,
      "expiresAt": report.expiresAt,
    ]
    if let reviewID = report.reviewID { payload["reviewId"] = reviewID }
    if let packageName = report.packageName { payload["packageName"] = packageName }
    return payload
  }

  private func runBridgeMutation(
    replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void,
    operation: @escaping @MainActor @Sendable (
      URL,
      @escaping @Sendable (String) -> Void,
      @escaping @Sendable (Result<Void, Error>) -> Void
    ) -> Void
  ) {
    guard !updating, let source = sourceRoot else {
      replyHandler(nil, "桌面运行时正在执行其他维护操作。")
      return
    }
    updating = true
    runtime.stop {
      DispatchQueue.main.async {
        operation(source, { _ in }) { [weak self] result in
          DispatchQueue.main.async {
            guard let self else {
              replyHandler(nil, "桌面应用已关闭。")
              return
            }
            self.updating = false
            switch result {
            case .success:
              replyHandler(["ok": true], nil)
            case let .failure(error):
              replyHandler(nil, error.localizedDescription)
            }
            self.start(source: source)
          }
        }
      }
    }
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    NSApp.terminate(nil)
    return false
  }

  func windowDidEnterFullScreen(_ notification: Notification) {
    windowDragRegion.isHidden = true
  }

  func windowDidExitFullScreen(_ notification: Notification) {
    windowDragRegion.isHidden = false
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    if terminating { return .terminateNow }
    terminating = true
    let recovery = activeRecoveryProfile
    activeRecoveryProfile = nil
    runtime.stop {
      DispatchQueue.main.async {
        guard let recovery else {
          sender.reply(toApplicationShouldTerminate: true)
          return
        }
        self.plugins.removeRecoveryProfile(recovery) {
          DispatchQueue.main.async { sender.reply(toApplicationShouldTerminate: true) }
        }
      }
    }
    return .terminateLater
  }
}
