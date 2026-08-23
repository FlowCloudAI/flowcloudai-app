/* AI 移动对话页的壳层契约；页面内部状态留在实现与专用 hook 中。 */

import type {AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import type {WorldCheckDiscussionParams} from '../../../features/project-editor/hooks/useWorldCheckController'
import type {MobileTab} from '../MobileNav'

export interface MobileAiChatProps {
    aiFocus: AiFocus
    active: boolean
    navigateToTab: (tab: MobileTab) => void
    conversationDrawerOpen?: boolean
    onOpenConversationDrawer?: () => void
    onCloseConversationDrawer?: () => void
    onStartReportDiscussionReady?: (
        handler: ((params: WorldCheckDiscussionParams) => Promise<void>) | null,
    ) => void
}
