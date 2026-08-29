/* AI 移动对话页的壳层契约；页面内部状态留在实现与专用 hook 中。 */

import type {AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import type {WorldCheckDiscussionParams} from '../../../features/project-editor/hooks/useWorldCheckController'
import type {MobileTab} from '../MobileNav'
import type {MobilePage} from '../usePageStack'

export interface MobileAiChatProps {
    aiFocus: AiFocus
    active: boolean
    keyboardVisible: boolean
    /** 第二个参数用于跨 Tab 直达某一页（AI 回复里的词条链接就走这条）。 */
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    conversationDrawerOpen?: boolean
    onOpenConversationDrawer?: () => void
    onCloseConversationDrawer?: () => void
    onStartReportDiscussionReady?: (
        handler: ((params: WorldCheckDiscussionParams) => Promise<void>) | null,
    ) => void
    onStartCharacterConversationReady?: (
        handler: ((params: {projectId: string; entryId: string}) => Promise<void>) | null,
    ) => void
}
