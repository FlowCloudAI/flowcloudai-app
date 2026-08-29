import type {AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import type {MobileBeforeLeave} from '../mobileBackNavigation'
import type {MobileTab} from '../MobileNav'
import type {MobileEntryDetailPageParams, MobilePage} from '../usePageStack'

export interface MobileEntryDetailProps {
    push: (page: MobilePage) => void
    pop: () => void
    replace: (page: MobilePage) => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    setBeforeLeave: (handler: MobileBeforeLeave | null) => void
    setAiFocus: (focus: AiFocus) => void
    startCharacterConversation: (params: {projectId: string; entryId: string}) => Promise<void>
    params: MobileEntryDetailPageParams
}
