import type { RestartMachineKey } from './native-chat-restart-machines'

/** Who asked: the launch read raises it by itself and takes a turn; the user opens it at once. */
export type NativeChatResumeDialogOrigin = 'launch' | 'user'

/** The offer's one dialog entry, whoever asked: the user asking takes over a queued launch offer. */
export const NATIVE_CHAT_RESUME_DIALOG_TOKEN = 'native-chat-resume'

/** An open request: who asked, and the machine it was opened for (that row starts expanded). */
export type NativeChatResumeOnRestartDialogRequest = Readonly<{
  origin: NativeChatResumeDialogOrigin
  focus: RestartMachineKey | null
  /** A launch request already on screen: the user is looking at it, so it is no longer dropped
   *  when this computer's own chats run out. */
  shown?: true
}>

let pending: NativeChatResumeOnRestartDialogRequest | null = null
let userAsked = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

// Why: the launch load, the status-bar entry and a reconnect toast all open this dialog, and any
// can fire before it subscribes. Keeping the request as an external snapshot prevents mount
// ordering from losing it.
export function requestNativeChatResumeOnRestartDialog(
  origin: NativeChatResumeDialogOrigin,
  focus: RestartMachineKey | null = null
): void {
  // The user already has the offer in hand, so the launch's own ask would repeat it; joining an
  // open dialog it would also move its focus, resetting the user's ticks.
  if (origin === 'launch' && userAsked) {
    return
  }
  userAsked ||= origin === 'user'
  // The same request again keeps the opening it already made, and with it the user's ticks.
  if (pending?.origin === origin && pending.focus === focus) {
    return
  }
  pending = { origin, focus }
  notify()
}

export function consumeNativeChatResumeOnRestartDialogRequest(): void {
  if (!pending) {
    return
  }
  pending = null
  notify()
}

/** Drops a request only this computer's launch raised and nobody has seen yet. */
export function consumeNativeChatResumeOnRestartLaunchRequest(): void {
  if (pending?.origin === 'launch' && !pending.shown) {
    consumeNativeChatResumeOnRestartDialogRequest()
  }
}

/** The launch-raised dialog reached the screen. */
export function markNativeChatResumeLaunchRequestShown(): void {
  if (pending?.origin === 'launch' && !pending.shown) {
    pending = { ...pending, shown: true }
    notify()
  }
}

export function getNativeChatResumeOnRestartDialogRequest(): NativeChatResumeOnRestartDialogRequest | null {
  return pending
}

export function subscribeNativeChatResumeOnRestartDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** @internal - tests need a clean module between cases. */
export function _resetNativeChatResumeOnRestartDialog(): void {
  pending = null
  userAsked = false
}
