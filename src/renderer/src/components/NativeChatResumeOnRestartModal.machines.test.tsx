// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetDialogRegistryForTests } from '../store/dialog-registry-test-state'
import { useDialogRegistry } from '../store/dialog-registry'
import { toast } from 'sonner'
import { useAppStore } from '../store'
import { getDefaultSettings } from '../../../shared/constants'
import { NativeChatResumeOnRestartModal } from './NativeChatResumeOnRestartModal'
import { TooltipProvider } from './ui/tooltip'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import type { ResumeCandidate } from './native-chat-resume-on-restart-grouping'
import {
  consumeNativeChatResumeOnRestartDialogRequest,
  getNativeChatResumeOnRestartDialogRequest,
  requestNativeChatResumeOnRestartDialog
} from './native-chat-resume-on-restart-dialog'
import { requestLaunchResumePrompt } from './native-chat-resume-on-restart-launch-prompt'
import { readNativeChatRestartMachine } from './native-chat-resume-on-restart-store'
import { _resetNativeChatRestartOffer } from './native-chat-restart-offer-triggers'
import { pairedEnvironment } from './native-chat-restart-offer-test-support'
import { lastToastShow } from './native-chat-resume-toast.test-support'
import {
  machineRow,
  machineRowFixture,
  machineToggle
} from './native-chat-resume-machines.test-support'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: rpc,
  pairedRestartOffersSupport: async () => 'supported',
  subscribeStructuredAgentSessionStatus: () => new Promise(() => {})
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { dismiss: vi.fn() }) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement

const row = machineRowFixture

let localRows = [row('l1', 'own')]
const SERVER_ROWS = [row('s1', 'own'), row('s2', 'other-device'), row('s3', 'automation')]
const OTHERS_ONLY = [row('o1', 'other-device')]

async function stage(servers: Record<string, ResumeCandidate[]>): Promise<void> {
  rpc.mockImplementation(async (target, method) => {
    if (method !== 'agentSession.restartResumable') {
      return { continued: [], sessions: [] }
    }
    return {
      sessions: target.kind === 'local' ? localRows : (servers[target.environmentId] ?? [])
    }
  })
  await act(async () => {
    await readNativeChatRestartMachine({ kind: 'local' })
    for (const environmentId of Object.keys(servers)) {
      await readNativeChatRestartMachine({ kind: 'environment', environmentId })
    }
  })
}

/** Reads this computer and the studio server with whatever `rpc` answers now. */
async function stageReads(): Promise<void> {
  await act(async () => {
    await readNativeChatRestartMachine({ kind: 'local' })
    await readNativeChatRestartMachine({ kind: 'environment', environmentId: 'studio' })
  })
}

async function open(focus: string | null): Promise<void> {
  await act(async () =>
    root.render(
      <TooltipProvider>
        <NativeChatResumeOnRestartModal />
      </TooltipProvider>
    )
  )
  await act(async () => requestNativeChatResumeOnRestartDialog('user', focus))
}

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (entry) => entry.textContent?.trim() === text
  )
  if (!found) {
    throw new Error(`Missing button: ${text}`)
  }
  return found
}

function actionCalls(method: string): unknown[] {
  return rpc.mock.calls.filter((call) => call[1] === method).map((call) => [call[0], call[2]])
}

beforeEach(() => {
  // These cases are the offer alone, past the startup checks that go before it.
  resetDialogRegistryForTests({ startupSettled: true })
  rpc.mockReset()
  vi.mocked(toast).mockClear()
  localRows = [row('l1', 'own')]
  _resetNativeChatRestartOffer()
  consumeNativeChatResumeOnRestartDialogRequest()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({
    settings: { ...getDefaultSettings(''), experimentalStructuredNativeChat: false },
    runtimeEnvironments: [
      pairedEnvironment('studio', 'studio-mac'),
      pairedEnvironment('build', 'build-box')
    ]
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  _resetNativeChatRestartOffer()
  consumeNativeChatResumeOnRestartDialogRequest()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

it('lists each machine with only the user’s own chats ticked, opening the one it was asked for', async () => {
  await stage({ studio: SERVER_ROWS })
  await open('environment:studio')
  expect(machineRow('studio-mac').getAttribute('aria-expanded')).toBe('true')
  expect(machineRow('studio-mac').textContent).toContain('1 of 3')
  // This computer's own chats all start ticked, and it stays closed but listed.
  expect(machineRow('Local').getAttribute('aria-expanded')).toBe('false')
  expect(machineToggle('studio-mac').getAttribute('data-state')).toBe('indeterminate')
  expect(document.body.textContent).toContain('Another device')
  expect(document.body.textContent).toContain('Automation')
  expect(button('Resume 2 chats')).toBeTruthy()
})

it('opens a machine with nothing ticked so its empty box is explained', async () => {
  await stage({ studio: SERVER_ROWS, build: OTHERS_ONLY })
  await open(null)
  expect(machineRow('build-box').getAttribute('aria-expanded')).toBe('true')
  expect(machineRow('studio-mac').getAttribute('aria-expanded')).toBe('false')
  expect(machineToggle('build-box').getAttribute('data-state')).toBe('unchecked')
})

it('resumes each machine’s picked chats on that machine, and the machine box picks them all', async () => {
  await stage({ studio: SERVER_ROWS })
  await open('environment:studio')
  await act(async () => machineToggle('studio-mac').click())
  expect(machineToggle('studio-mac').getAttribute('data-state')).toBe('checked')
  await act(async () => button('Resume 4 chats').click())
  expect(actionCalls('agentSession.restartContinue')).toEqual([
    [{ kind: 'local' }, { sessionIds: ['l1'] }],
    [{ kind: 'environment', environmentId: 'studio' }, { sessionIds: ['s1', 's2', 's3'] }]
  ])
})

// Dismiss all clears only the user's own chats, on this computer as on a server; another
// device's, an automation's and the server's own stay for their owner, and the button says so.
it('dismisses only the user’s own chats, on every machine', async () => {
  localRows = [row('l1', 'own'), row('l2', 'other-device'), row('l3', 'automation')]
  await stage({ studio: [...SERVER_ROWS, row('s4', 'server-made')] })
  await open(null)
  await act(async () => button('Dismiss').click())
  const listed = (sessionId: string) => ({ sessionId, recordedAt: 1_800_000_000_000 })
  expect(actionCalls('agentSession.restartResumableDismiss')).toEqual([
    [{ kind: 'local' }, { sessionIds: ['l1'], offers: [listed('l1')] }],
    [
      { kind: 'environment', environmentId: 'studio' },
      { sessionIds: ['s1'], offers: [listed('s1')] }
    ]
  ])
})

// What Dismiss all leaves has its own way out: its row's dismiss forgets exactly that offer.
it('dismisses a chat that is not the user’s from its own row, and offers no such control on theirs', async () => {
  await stage({ studio: [row('s1', 'own'), row('s2', 'automation')] })
  await open('environment:studio')
  const rowDismiss = (prompt: string) =>
    [...document.querySelectorAll('button')].find(
      (entry) =>
        entry.getAttribute('aria-label') === `Dismiss "${prompt}" in workspace-s${prompt.at(-1)}`
    )
  expect(rowDismiss('Prompt s1')).toBeUndefined()
  await act(async () => rowDismiss('Prompt s2')?.click())
  expect(actionCalls('agentSession.restartResumableDismiss')).toEqual([
    [
      { kind: 'environment', environmentId: 'studio' },
      {
        sessionIds: ['s2'],
        offers: [{ sessionId: 's2', recordedAt: 1_800_000_000_000 }]
      }
    ]
  ])
})

it('says "Dismiss all" only when every listed chat is the user’s own', async () => {
  await stage({ studio: [row('s1', 'own')] })
  await open(null)
  expect(button('Dismiss all')).toBeTruthy()
  await stage({ studio: [row('s1', 'own'), row('s2', 'automation')] })
  expect(button('Dismiss')).toBeTruthy()
})

it('reports one resume across machines in one toast', async () => {
  await stage({ studio: SERVER_ROWS })
  rpc.mockImplementation(async (target, method) =>
    method === 'agentSession.restartContinue'
      ? {
          continued: [{ sessionId: target.kind === 'local' ? 'l1' : 's1', outcome: 'continued' }],
          sessions: [],
          failed: []
        }
      : { sessions: [] }
  )
  await open(null)
  await act(async () => button('Resume 2 chats').click())
  await vi.waitFor(() => expect(toast).toHaveBeenCalled())
  expect(vi.mocked(toast).mock.calls.map(([title]) => title)).toEqual(['Resumed 2 chats'])
})

// One slow server must not hold this computer's chats hostage.
it('locks only the machine whose resume is still running', async () => {
  await stage({ studio: SERVER_ROWS })
  rpc.mockImplementation(async (target, method) =>
    method === 'agentSession.restartContinue' && target.kind === 'environment'
      ? new Promise(() => {})
      : { continued: [], sessions: localRows }
  )
  await open('environment:studio')
  await act(async () => machineToggle('studio-mac').click())
  await act(async () => button('Resume 4 chats').click())
  await open(null)
  expect(machineToggle('studio-mac').hasAttribute('disabled')).toBe(true)
  expect(button('Resume 1 chat').disabled).toBe(false)
})

// The launch read joining a dialog the user opened must not move its focus.
it("keeps the user's ticks and open machine when this computer's launch read lands", async () => {
  await stage({ studio: [row('s1', 'own'), row('s2', 'own')] })
  await open('environment:studio')
  expect(button('Resume 3 chats')).toBeTruthy()
  await act(async () => machineToggle('studio-mac').click())
  expect(button('Resume 1 chat')).toBeTruthy()
  await act(async () => requestLaunchResumePrompt('local'))
  expect(getNativeChatResumeOnRestartDialogRequest()).toEqual({
    origin: 'user',
    focus: 'environment:studio'
  })
  expect(button('Resume 1 chat')).toBeTruthy()
  expect(machineRow('studio-mac').getAttribute('aria-expanded')).toBe('true')
})

it('never opens by itself for a paired server once this computer has nothing to offer', async () => {
  await stage({ studio: [row('s1', 'own')] })
  // Another dialog is on screen, so the launch's own offer waits its turn.
  act(() => useDialogRegistry.getState().dialogContentMounted('other:1'))
  await act(async () =>
    root.render(
      <TooltipProvider>
        <NativeChatResumeOnRestartModal />
      </TooltipProvider>
    )
  )
  await act(async () => requestLaunchResumePrompt('local'))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  localRows = []
  await act(async () => {
    await readNativeChatRestartMachine({ kind: 'local' })
  })
  await act(async () => useDialogRegistry.getState().dialogContentUnmounted('other:1'))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(getNativeChatResumeOnRestartDialogRequest()).toBeNull()
})

it('keeps the flat list when only this computer has chats', async () => {
  await stage({})
  await open('local')
  expect(document.querySelector('button[aria-expanded]')).toBeNull()
  expect(button('Resume 1 chat')).toBeTruthy()
})

// A dialog the user opened is never the app's own prompt: another dialog does not hide it.
it('keeps a user-opened dialog on screen when another dialog opens over it', async () => {
  await stage({ studio: SERVER_ROWS })
  await act(async () =>
    root.render(
      <TooltipProvider>
        <NativeChatResumeOnRestartModal />
        <Dialog open>
          <DialogContent>
            <DialogTitle>Another dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </TooltipProvider>
    )
  )
  await act(async () => requestNativeChatResumeOnRestartDialog('user', 'environment:studio'))
  const resume = [...document.querySelectorAll('[role="dialog"]')].find((entry) =>
    entry.textContent?.includes('Resume interrupted chats?')
  )
  expect(resume).toBeTruthy()
})

// Once on screen, a launch-raised dialog stays until the user closes it, whatever this computer's
// list does under it.
it('keeps an open launch dialog when this computer’s chats run out while a server’s remain', async () => {
  await stage({ studio: [row('s1', 'own')] })
  await act(async () =>
    root.render(
      <TooltipProvider>
        <NativeChatResumeOnRestartModal />
      </TooltipProvider>
    )
  )
  await act(async () => requestLaunchResumePrompt('local'))
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  localRows = []
  await act(async () => {
    await readNativeChatRestartMachine({ kind: 'local' })
  })
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(getNativeChatResumeOnRestartDialogRequest()).toMatchObject({ origin: 'launch' })
})

// The workspace rows inside name no host their machine row already names, so the machine row is
// what says where the chats are, this computer's and a server's alike, even alone.
it('names the machine on its row whenever chats are grouped by machine, even a single server', async () => {
  localRows = []
  await stage({ studio: SERVER_ROWS })
  await open(null)
  expect(machineRow('studio-mac').textContent).toContain('studio-mac')
  localRows = [row('l1', 'own')]
  await stage({ studio: SERVER_ROWS })
  expect(machineRow('Local').textContent).toContain('Local')
  expect(machineRow('studio-mac')).toBeTruthy()
})

// With nothing of the user's listed, Dismiss would clear nothing and only close the dialog; it stays
// in place, disabled, and each row's own dismiss is the way out.
it('disables Dismiss when no listed chat is the user’s own', async () => {
  localRows = []
  await stage({ studio: [row('s2', 'other-device'), row('s3', 'automation')] })
  await open(null)
  expect(button('Dismiss').disabled).toBe(true)
  await act(async () => button('Dismiss').click())
  expect(actionCalls('agentSession.restartResumableDismiss')).toEqual([])
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
})

// A restart toast still on screen sits above the dialog's backdrop but cannot be clicked through
// it; the open dialog lists the same chats, so the toast goes.
it('dismisses a server’s restart toast once the dialog listing it opens', async () => {
  await stage({ studio: [row('s1', 'own')] })
  await open('environment:studio')
  expect(toast.dismiss).toHaveBeenCalledWith('native-chat-restart-reconnect:environment:studio')
})

// A launch offer still waiting behind another dialog is not on screen: it may yet be dropped unseen,
// so a server's restart is still announced, and only the dialog reaching the screen takes it down.
it('announces a server restart while the launch offer waits its turn, and takes it down once shown', async () => {
  // Interruptions an earlier case showed are remembered as decided; this one is new.
  window.localStorage.clear()
  vi.mocked(toast.dismiss).mockClear()
  await stage({})
  await act(async () =>
    root.render(
      <TooltipProvider>
        <NativeChatResumeOnRestartModal />
      </TooltipProvider>
    )
  )
  act(() => useDialogRegistry.getState().dialogContentMounted('other:1'))
  await act(async () => requestLaunchResumePrompt('local'))
  await stage({ studio: [row('s1', 'own')] })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(vi.mocked(toast).mock.calls.map(([title]) => title)).toEqual([
    'studio-mac restarted for an update'
  ])
  expect(toast.dismiss).not.toHaveBeenCalled()
  expect(getNativeChatResumeOnRestartDialogRequest()).toEqual({ origin: 'launch', focus: 'local' })

  await act(async () => useDialogRegistry.getState().dialogContentUnmounted('other:1'))
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(toast.dismiss).toHaveBeenCalledWith('native-chat-restart-reconnect:environment:studio')
  expect(getNativeChatResumeOnRestartDialogRequest()).toMatchObject({ shown: true })
})

// The server's provider refused to carry the chat on: the host files the failure and lists it. One
// toast says so and opens that server's list, where the row's Retry ends in one toast of its own.
it('reports a chat a server could not carry on once, opens it on that server, and retries it', async () => {
  localRows = []
  const failed = {
    ...row('s1', 'own'),
    failedAt: 1_800_000_060_000,
    outcome: 'refused',
    reason: 'provider_refused_continuation'
  }
  const others = [row('s2', 'other-device')]
  let phase: 'offered' | 'failed' | 'retried' = 'offered'
  rpc.mockImplementation(async (target, method) => {
    if (target.kind === 'local') {
      return { sessions: [] }
    }
    if (method === 'agentSession.restartResumable') {
      return phase === 'offered'
        ? { sessions: [row('s1', 'own'), ...others], failed: [] }
        : { sessions: others, failed: phase === 'failed' ? [failed] : [] }
    }
    if (phase === 'offered') {
      phase = 'failed'
      return {
        continued: [{ sessionId: 's1', outcome: 'refused' }],
        sessions: others,
        failed: [failed]
      }
    }
    phase = 'retried'
    return { continued: [{ sessionId: 's1', outcome: 'continued' }], sessions: others, failed: [] }
  })
  await stageReads()
  await open('environment:studio')
  await act(async () => button('Resume 1 chat').click())
  await vi.waitFor(() => expect(toast).toHaveBeenCalled())
  expect(vi.mocked(toast).mock.calls).toEqual([
    [
      '1 chat on studio-mac couldn’t be resumed',
      { action: { label: 'Show', onClick: expect.any(Function) } }
    ]
  ])
  expect(document.querySelector('[role="dialog"]')).toBeNull()

  await act(async () => lastToastShow()?.())
  await vi.waitFor(() =>
    expect(getNativeChatResumeOnRestartDialogRequest()).toEqual({
      origin: 'user',
      focus: 'environment:studio'
    })
  )
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog?.textContent).toContain('studio-mac')
  expect(dialog?.textContent).toContain('Prompt s1')

  await act(async () => button('Retry').click())
  await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(2))
  expect(actionCalls('agentSession.restartContinue').at(-1)).toEqual([
    { kind: 'environment', environmentId: 'studio' },
    { sessionIds: ['s1'] }
  ])
  expect(vi.mocked(toast).mock.calls[1]).toEqual(['Resumed 1 chat on studio-mac'])
})
