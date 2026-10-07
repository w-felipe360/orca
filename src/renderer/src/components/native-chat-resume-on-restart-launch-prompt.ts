import { LOCAL_RESTART_MACHINE } from './native-chat-restart-machines'
import { restartInterruptionKey } from './native-chat-restart-decided'
import type { ResumeCandidate } from './native-chat-resume-on-restart-grouping'
import { requestNativeChatResumeOnRestartDialog } from './native-chat-resume-on-restart-dialog'

/**
 * The one way the resume dialog opens BY ITSELF: this computer's own launch found chats to resume.
 * It takes its turn among the dialogs that open by themselves; every other opening follows a click
 * (status bar, toast) and shows at once.
 */
export function requestLaunchResumePrompt(
  own: readonly Pick<ResumeCandidate, 'sessionId' | 'recordedAt'>[]
): void {
  requestNativeChatResumeOnRestartDialog(
    'launch',
    LOCAL_RESTART_MACHINE,
    own.map(restartInterruptionKey)
  )
}
