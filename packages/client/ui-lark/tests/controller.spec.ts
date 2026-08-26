import { describe, expect, it, vi } from 'vitest'
import type { LarkManagementStatus } from '@deepseek-ai/dsh-lark'
import { LarkManagementController } from '../src/client/controller.ts'

const STATUS = { userAuthorizationPending: false } as LarkManagementStatus

describe('Lark managed connection', () => {
  it('continues from application registration into current-user OAuth', async () => {
    const calls: string[] = []
    const remote = {
      completeManagedRegistration: vi.fn(async () => {
        calls.push('application')
        return { ok: true, value: undefined }
      }),
      beginUserAuth: vi.fn(async () => {
        calls.push('user')
        return {
          ok: true,
          value: {
            verificationUrl: 'https://accounts.feishu.cn/oauth/v1/device/verify',
          },
        }
      }),
      status: vi.fn(async () => ({
        ok: true,
        value: { userAuthorizationPending: true } as LarkManagementStatus,
      })),
    }
    const openUrl = vi.fn()
    const controller = new LarkManagementController(
      remote as unknown as ConstructorParameters<typeof LarkManagementController>[0],
      openUrl,
    )
    controller.store.update((draft) => { draft.registrationPending = true })

    await controller.completeManagedRegistration()

    expect(calls).toEqual(['application', 'user'])
    expect(openUrl).toHaveBeenCalledWith('https://accounts.feishu.cn/oauth/v1/device/verify')
    expect(controller.store.getSnapshot()).toMatchObject({
      registrationPending: false,
      authPending: true,
      outcome: 'saved',
    })
  })

  it('restores unfinished current-user authorization from Host status', async () => {
    const remote = {
      status: vi.fn(async () => ({
        ok: true,
        value: { userAuthorizationPending: true } as LarkManagementStatus,
      })),
    }
    const controller = new LarkManagementController(
      remote as unknown as ConstructorParameters<typeof LarkManagementController>[0],
    )

    await controller.refresh()

    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      authPending: true,
    })
  })

  it('completes authorization through the Host-owned pending code', async () => {
    const remote = {
      completeUserAuth: vi.fn(async () => ({ ok: true, value: undefined })),
      status: vi.fn(async () => ({ ok: true, value: STATUS })),
    }
    const controller = new LarkManagementController(
      remote as unknown as ConstructorParameters<typeof LarkManagementController>[0],
    )
    controller.store.update((draft) => { draft.authPending = true })

    await controller.completeUserAuth()

    expect(remote.completeUserAuth).toHaveBeenCalledWith()
    expect(controller.store.getSnapshot()).toMatchObject({
      authPending: false,
      outcome: 'authorized',
    })
  })
})
