import Foundation

enum SessionSelectionBridge {
  static let browserStorageKey = "dsh.sessions.current"
  static let nativeStorageKey = "desktop.session-selection"
  static let messageName = "dshSessionSelection"

  /**
   * A random loopback port gives each desktop launch a different Web origin.
   * Restore the existing browser selection cell before client boot, then
   * mirror only that key back to native preferences as it changes.
   */
  static func scriptSource(restoredSelection: String?) -> String {
    let encoded = restoredSelection.map { Data($0.utf8).base64EncodedString() }
    let encodedLiteral = encoded.map { "\"\($0)\"" } ?? "null"
    return """
    (() => {
      const selectionKey = "\(browserStorageKey)";
      const encodedSelection = \(encodedLiteral);
      const restoredSelection = encodedSelection === null
        ? null
        : new TextDecoder().decode(Uint8Array.from(atob(encodedSelection), character => character.charCodeAt(0)));
      if (restoredSelection !== null) localStorage.setItem(selectionKey, restoredSelection);

      const postSelection = value => window.webkit.messageHandlers.\(messageName).postMessage(value);
      const originalSetItem = Storage.prototype.setItem;
      const originalRemoveItem = Storage.prototype.removeItem;
      const originalClear = Storage.prototype.clear;
      Storage.prototype.setItem = function(key, value) {
        originalSetItem.call(this, key, value);
        if (this === localStorage && key === selectionKey) postSelection(String(value));
      };
      Storage.prototype.removeItem = function(key) {
        originalRemoveItem.call(this, key);
        if (this === localStorage && key === selectionKey) postSelection(null);
      };
      Storage.prototype.clear = function() {
        const hadSelection = this === localStorage && localStorage.getItem(selectionKey) !== null;
        originalClear.call(this);
        if (hadSelection) postSelection(null);
      };
    })();
    """
  }

  static func acceptsMessageHost(_ host: String) -> Bool {
    host == "127.0.0.1" || host == "localhost"
  }
}
