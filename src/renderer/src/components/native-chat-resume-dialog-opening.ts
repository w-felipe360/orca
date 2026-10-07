import { useEffect, useSyncExternalStore } from 'react'
import { useAutomaticDialogEntry } from '@/lib/dialog-registry-entry'
import type { DialogPhase } from '@/store/dialog-registry-state'
import { useNativeChatRestartOfferEnabled } from './native-chat-restart-offer-gate'
import {
  getNativeChatResumeOnRestartDialogRequest,
  markNativeChatResumeLaunchRequestShown,
  NATIVE_CHAT_RESUME_DIALOG_TOKEN,
  subscribeNativeChatResumeOnRestartDialog,
  type NativeChatResumeOnRestartDialogRequest
} from './native-chat-resume-on-restart-dialog'
import { dismissReconnectRestartOffers } from './native-chat-restart-reconnect-toast'
import { useNativeChatRestartOffers } from './native-chat-resume-on-restart-store'
import { useMachineViews, type MachineView } from './native-chat-resume-machine-views'
import {
  markNativeChatRestartOffersShown,
  useNativeChatRestartOfferSources
} from './native-chat-restart-offer-triggers'

/**
 * The resume dialog's entry among the app's dialogs, and the machines it lists. Owns every source of
 * offers and this computer's startup discovery, and records what the dialog shows as decided.
 */
export function useNativeChatResumeDialogOpening(): {
  machines: MachineView[]
  request: NativeChatResumeOnRestartDialogRequest | null
  phase: DialogPhase | null
} {
  const localEnabled = useNativeChatRestartOfferEnabled()
  useNativeChatRestartOfferSources(localEnabled, { ownsStartupDiscovery: true })
  const offers = useNativeChatRestartOffers()
  const machines = useMachineViews(offers)
  // Open is an external request, never mirrored into local state: the launch load, the status-bar
  // entry and a reconnect toast all raise it, and a copy here would go stale against the last one.
  const request = useSyncExternalStore(
    subscribeNativeChatResumeOnRestartDialog,
    getNativeChatResumeOnRestartDialogRequest,
    getNativeChatResumeOnRestartDialogRequest
  )
  // Only a dialog that can render holds a place, so a hidden one never holds others back.
  const renderable = machines.length > 0
  // Raised by this computer's launch, it waits its turn among the dialogs that open by themselves;
  // the store drops that request unseen once this computer offers none of the user's own chats, so
  // it never opens by itself for a server, an automation or another device. Opened by the user
  // (status bar, toast), it opens at once.
  const phase = useAutomaticDialogEntry(
    NATIVE_CHAT_RESUME_DIALOG_TOKEN,
    'native-chat-resume',
    !renderable || !request ? null : request.origin === 'user' ? 'user' : 'automatic'
  )
  // On screen: what it shows is decided, so a later read of a paired server does not announce it,
  // and a restart toast still up goes, since the dialog lists its chats and blocks clicks on it.
  const visible = phase === 'visible'
  useEffect(() => {
    if (!visible) {
      return
    }
    markNativeChatResumeLaunchRequestShown()
    markNativeChatRestartOffersShown(
      machines.map((machine) => ({
        machine: machine.machine,
        candidates: machine.offer.candidates
      }))
    )
    dismissReconnectRestartOffers(machines.map((machine) => machine.machine))
  }, [visible, machines])
  return { machines, request, phase }
}
