/** Browser navigation helper for OAuth and managed-app verification pages. */

interface VerificationBrowser {
  readonly desktopBridgeAvailable: boolean
  open(url: string): Window | null
  assign(url: string): void
}

function currentBrowser(): VerificationBrowser {
  return {
    desktopBridgeAvailable: Reflect.has(window, 'dshDesktopPluginBridge'),
    open: url => window.open(url, '_blank', 'noopener,noreferrer'),
    assign: url => { window.location.assign(url) },
  }
}

/** Open a verification URL, falling back to same-tab navigation outside the desktop shell. */
export function openVerificationUrl(url: string, browser: VerificationBrowser = currentBrowser()): void {
  const opened = browser.open(url)
  if (opened === null && !browser.desktopBridgeAvailable) browser.assign(url)
}
