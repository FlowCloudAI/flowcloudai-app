/** 词条编辑下级页的离开闸门：栈内返回保留草稿，跨 Tab 离开才确认并清理会话。 */
import {useEffect} from 'react'
import {useAlert} from 'flowcloudai-ui'
import type {MobileBeforeLeave} from '../mobileBackNavigation'
import {
    clearMobileEntryEditDraft,
    isMobileEntryEditDraftDirty,
} from '../stores/mobileEntryEditDraftStore'
import {discardMobileEntryPlaceholder} from '../mobileEntryPlaceholder'

interface Options {
    projectId: string
    entryId: string
    setBeforeLeave: (handler: MobileBeforeLeave | null) => void
    beforeBack?: () => void
    isPlaceholder?: boolean
}

export default function useMobileEntryEditLeaveGuard({
    projectId,
    entryId,
    setBeforeLeave,
    beforeBack,
    isPlaceholder = false,
}: Options): void {
    const {showAlert} = useAlert()

    useEffect(() => {
        setBeforeLeave(async intent => {
            if (intent === 'back') {
                beforeBack?.()
                return true
            }
            if (isMobileEntryEditDraftDirty(projectId, entryId)) {
                const result = await showAlert('未保存的更改将丢失，是否继续？', 'warning', 'confirm')
                if (result !== 'yes') return false
            }
            try {
                if (isPlaceholder) await discardMobileEntryPlaceholder(projectId, entryId)
                else clearMobileEntryEditDraft(projectId, entryId)
                return true
            } catch (error) {
                await showAlert(`清理未保存的新词条失败：${String(error)}`, 'error', 'nonInvasive', 3000)
                return false
            }
        })
        return () => setBeforeLeave(null)
    }, [beforeBack, entryId, isPlaceholder, projectId, setBeforeLeave, showAlert])
}
