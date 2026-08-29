/*
 * AI 消息上的即时动作：复制与重说。
 *
 * 这两条一直只在桌面端存在——移动端的 MessageBox 一个动作 prop 都没传，
 * regenerateMessage 只挂在报错后的「重试」上，正常回复既不能复制也不能重说。
 */
import {useCallback} from 'react'
import {useAlert} from 'flowcloudai-ui'
import {copyTextToClipboard} from '../../../shared/clipboard'

interface MobileAiMessageActionsOptions {
    isArchivedConversation: boolean
    regenerateMessage: (messageId: string) => Promise<void>
}

export function useMobileAiMessageActions({
    isArchivedConversation,
    regenerateMessage,
}: MobileAiMessageActionsOptions) {
    const {showAlert} = useAlert()

    const handleCopyMessage = useCallback(async (content: string) => {
        const text = content.trim()
        if (!text) {
            await showAlert('这条消息没有可复制的文本。', 'warning', 'nonInvasive', 1600)
            return
        }
        if (await copyTextToClipboard(text)) {
            await showAlert('已复制', 'success', 'nonInvasive', 1200)
            return
        }
        await showAlert('复制失败', 'error', 'nonInvasive', 1800)
    }, [showAlert])

    const handleRegenerateMessage = useCallback(async (messageId: string) => {
        // 归档会话只读：重说会写入新回复，必须先取消归档。
        if (isArchivedConversation) {
            await showAlert('已归档对话不可重新生成。', 'warning', 'nonInvasive', 1800)
            return
        }
        await regenerateMessage(messageId)
    }, [isArchivedConversation, regenerateMessage, showAlert])

    return {handleCopyMessage, handleRegenerateMessage}
}
