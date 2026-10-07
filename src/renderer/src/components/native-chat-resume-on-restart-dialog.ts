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
/** This computer's interruptions a resume dialog has shown on screen this launch, by
 *  `restartInterruptionKey`. Another machine's offer shown alone never counts. */
const presentedHere = new Set<string>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** Whether the launch's own ask would only repeat what the user has: a dialog they opened is up
 *  (joining it would move its focus and reset their ticks; it lists this computer anyway), or
 *  every interruption it asks about was already on screen. Without its interruptions named, any of
 *  this computer's having been shown counts. */
function launchAskRedundant(asksAbout: readonly string[] | undefined): boolean {
  if (pending?.origin === 'user') {
    return true
  }
  return asksAbout
    ? asksAbout.length > 0 && asksAbout.every((key) => presentedHere.has(key))
    : presentedHere.size > 0
}

// Why: the launch load, the status-bar entry and a reconnect toast all open this dialog, and any
// can fire before it subscribes. Keeping the request as an external snapshot prevents mount
// ordering from losing it.
export function requestNativeChatResumeOnRestartDialog(
  origin: NativeChatResumeDialogOrigin,
  focus: RestartMachineKey | null = null,
  /** For a launch ask: this computer's interruptions it is about. */
  asksAbout?: readonly string[]
): void {
  if (origin === 'launch' && launchAskRedundant(asksAbout)) {
    return
  }
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

/** A resume dialog on screen listed these interruptions of this computer. */
export function markNativeChatResumeLocalInterruptionsPresented(keys: readonly string[]): void {
  for (const key of keys) {
    presentedHere.add(key)
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
  presentedHere.clear()
}
