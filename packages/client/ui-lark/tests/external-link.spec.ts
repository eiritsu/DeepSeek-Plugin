import { describe, expect, it, vi } from 'vitest'
import { openVerificationUrl } from '../src/client/external-link.ts'

describe('Lark verification navigation', () => {
  it('uses the new window when the browser accepts it', () => {
    const open = vi.fn(() => ({}) as Window)
    const assign = vi.fn()
    openVerificationUrl('https://accounts.feishu.cn/oauth/v1/device/verify', {
      desktopBridgeAvailable: false,
      open,
      assign,
    })
    expect(open).toHaveBeenCalledOnce()
    expect(assign).not.toHaveBeenCalled()
  })

  it('falls back to the current tab when a normal browser blocks the popup', () => {
    const assign = vi.fn()
    openVerificationUrl('https://accounts.feishu.cn/oauth/v1/device/verify', {
      desktopBridgeAvailable: false,
      open: () => null,
      assign,
    })
    expect(assign).toHaveBeenCalledWith('https://accounts.feishu.cn/oauth/v1/device/verify')
  })

  it('lets the desktop navigation delegate handle a nil popup result', () => {
    const assign = vi.fn()
    openVerificationUrl('https://accounts.feishu.cn/oauth/v1/device/verify', {
      desktopBridgeAvailable: true,
      open: () => null,
      assign,
    })
    expect(assign).not.toHaveBeenCalled()
  })
})
