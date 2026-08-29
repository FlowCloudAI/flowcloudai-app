/*
 * AI 会话的文件出入口：导出会话、添加文档上下文。
 *
 * 从 MobileAiChat.tsx 拆出来只是为了守住 800 行红线（AGENTS.md §5.1），
 * 逻辑与原实现一致。
 */
import {useCallback} from 'react'
import {useAlert} from 'flowcloudai-ui'
import {openFileDialog, saveFileDialog} from '../../../api/dialog'
import {
    ai_export_conversation,
    type ConversationExportFormat,
    formatApiError,
    toApiError,
} from '../../../api'
import type {Conversation} from '../../../features/ai-chat/model/AiControllerTypes'
import {isPendingConversationId} from '../../../features/ai-chat/model/conversationState'
import {logger} from '../../../shared/logger'
import {
    AI_DOCUMENT_CONTEXT_EXTENSION_SET,
    AI_DOCUMENT_CONTEXT_EXTENSIONS,
    buildConversationExportFileName,
    getSelectedFileExtension,
} from './MobileAiChatUi'

interface MobileAiConversationFilesOptions {
    activeConversation: Conversation | null
    isArchivedConversation: boolean
    addDocumentContextFiles: (filePaths: string[]) => Promise<void>
    closeMorePanel: () => void
    onCloseActionTarget: () => void
}

export function useMobileAiConversationFiles({
    activeConversation,
    isArchivedConversation,
    addDocumentContextFiles,
    closeMorePanel,
    onCloseActionTarget,
}: MobileAiConversationFilesOptions) {
    const {showAlert} = useAlert()

    const handleExportConversation = useCallback(async (
        conversation: Conversation,
        format: ConversationExportFormat,
    ) => {
        onCloseActionTarget()

        if (isPendingConversationId(conversation.id)) {
            await showAlert('这条会话尚未写入历史，发送消息后再导出。', 'warning', 'nonInvasive', 2200)
            return
        }

        const isJson = format === 'json'
        const selectedPath = await saveFileDialog({
            defaultPath: buildConversationExportFileName(conversation, format),
            filters: [{
                name: isJson ? 'JSON' : 'Markdown',
                extensions: [isJson ? 'json' : 'md'],
            }],
        })

        if (!selectedPath) return

        try {
            await ai_export_conversation(conversation.id, selectedPath, format)
            await showAlert(`会话已导出为 ${isJson ? 'JSON' : 'Markdown'}。`, 'success', 'nonInvasive', 1000)
        } catch (error) {
            await showAlert(`导出会话失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 2600)
        }
    }, [onCloseActionTarget, showAlert])

    const handleAttachDocuments = useCallback(async () => {
        if (!activeConversation || isArchivedConversation) return
        try {
            closeMorePanel()
            const selected = await openFileDialog({
                multiple: true,
                filters: [{
                    name: '文档与文本',
                    extensions: AI_DOCUMENT_CONTEXT_EXTENSIONS,
                }],
            })
            const paths = Array.isArray(selected)
                ? selected
                : selected
                    ? [selected]
                    : []
            if (paths.length === 0) return

            const supportedPaths = paths.filter(path =>
                AI_DOCUMENT_CONTEXT_EXTENSION_SET.has(getSelectedFileExtension(path)),
            )
            const unsupportedCount = paths.length - supportedPaths.length
            if (supportedPaths.length === 0) {
                await showAlert('仅支持文档与文本格式，不支持图片或音视频。', 'warning', 'nonInvasive', 2200)
                return
            }

            await addDocumentContextFiles(supportedPaths)
            await showAlert(
                unsupportedCount > 0
                    ? `已添加 ${supportedPaths.length} 个文件，跳过 ${unsupportedCount} 个不支持的文件。`
                    : `已添加 ${supportedPaths.length} 个文件。`,
                'success',
                'nonInvasive',
                1600,
            )
        } catch (error) {
            logger.warn('[MobileAiChat] 添加文档上下文失败', error)
            await showAlert(`添加文档失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 2600)
        }
    }, [activeConversation, addDocumentContextFiles, closeMorePanel, isArchivedConversation, showAlert])

    return {handleExportConversation, handleAttachDocuments}
}
