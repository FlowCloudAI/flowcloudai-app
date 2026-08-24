/** 移动端新词条占位清理：只由显式路由标记触发，不根据字段内容猜测是否已保存。 */
import {db_delete_entry} from '../../api'
import {invalidateProjectContext} from '../../features/projects/projectContextStore'
import {clearMobileEntryEditDraft} from './stores/mobileEntryEditDraftStore'

export async function discardMobileEntryPlaceholder(projectId: string, entryId: string): Promise<void> {
    await db_delete_entry(entryId, projectId)
    clearMobileEntryEditDraft(projectId, entryId)
    await invalidateProjectContext(projectId)
}
