import Foundation

enum DesktopPluginBridge {
  static let messageName = "dshDesktopPlugins"

  /** Expose only one promise-returning request method to the loopback main frame. */
  static let scriptSource = """
  (() => {
    const handler = window.webkit?.messageHandlers?.\(messageName);
    if (handler === undefined) return;
    Object.defineProperty(window, "dshDesktopPluginBridge", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({
        request(request) {
          return handler.postMessage(request);
        },
      }),
    });
  })();
  """
}
