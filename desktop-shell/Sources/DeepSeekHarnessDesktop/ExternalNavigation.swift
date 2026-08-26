import Foundation
import WebKit

enum ExternalNavigation {
  private static let loopbackHosts = Set(["127.0.0.1", "localhost"])
  private static let authorizationHosts = Set([
    "accounts.feishu.cn",
    "accounts.larksuite.com",
    "open.feishu.cn",
    "open.larksuite.com",
  ])

  static func shouldOpen(_ url: URL, navigationType: WKNavigationType) -> Bool {
    guard let host = url.host?.lowercased(), !loopbackHosts.contains(host) else { return false }
    if navigationType == .linkActivated { return url.scheme == "https" || url.scheme == "http" }
    return url.scheme == "https" && authorizationHosts.contains(host)
  }
}
