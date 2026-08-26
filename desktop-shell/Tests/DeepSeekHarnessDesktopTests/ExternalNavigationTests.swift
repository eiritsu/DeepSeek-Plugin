import Foundation
import Testing
import WebKit
@testable import DeepSeekHarnessDesktop

@Suite("External navigation")
struct ExternalNavigationTests {
  @Test("opens explicit external links")
  func externalLink() throws {
    let url = try #require(URL(string: "https://github.com/eiritsu/DeepSeek-Plugin"))
    #expect(ExternalNavigation.shouldOpen(url, navigationType: .linkActivated))
  }

  @Test("opens programmatic Feishu and Lark authorization windows")
  func authorizationWindow() throws {
    for value in [
      "https://accounts.feishu.cn/oauth/v1/device/verify",
      "https://accounts.larksuite.com/oauth/v1/device/verify",
      "https://open.feishu.cn/page/cli",
      "https://open.larksuite.com/page/cli",
    ] {
      let url = try #require(URL(string: value))
      #expect(ExternalNavigation.shouldOpen(url, navigationType: .other))
    }
  }

  @Test("rejects programmatic untrusted and loopback navigation")
  func rejectedNavigation() throws {
    let external = try #require(URL(string: "https://example.com/popup"))
    let loopback = try #require(URL(string: "http://127.0.0.1:62540/settings"))
    #expect(!ExternalNavigation.shouldOpen(external, navigationType: .other))
    #expect(!ExternalNavigation.shouldOpen(loopback, navigationType: .linkActivated))
  }
}
