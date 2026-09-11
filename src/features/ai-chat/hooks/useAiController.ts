import {logger} from '../../../shared/logger'
import {type MouseEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {listen} from '../../../api/events'
import type {MessageBoxBlock} from 'flowcloudai-ui'
import {
    ai_build_character_project_snapshot,
    ai_compact_conversation,
    ai_delete_conversation,
    ai_disable_tool,
    ai_enable_tool,
    ai_get_character_conversation_meta,
    ai_get_conversation,
    ai_get_conversation_ui_state,
    ai_list_conversations,
    ai_list_tools,
    ai_preflight_request,
    ai_rename_conversation,
    ai_save_character_conversation_meta,
    ai_save_conversation_ui_state,
    ai_set_task_context,
    ai_switch_plugin,
    ai_update_conversation_settings,
    ai_update_message_attachments,
    ai_update_session,
    type AppSettings,
    type AiRequestPreflight,
    type CharacterConversationMeta,
    type ConversationUiState,
    DOCCTX_UPDATED,
    db_get_entry,
    db_get_project,
    docctx_add_files,
    docctx_build_context,
    docctx_list_items,
    docctx_reassign_conversation,
    docctx_remove_item,
    docctx_retry_item,
    type DocumentContextItem,
    type DocumentContextUpdatedEvent,
    ENTRY_UPDATED,
    ErrorCode,
    type EntryUpdatedEvent,
    setting_get_settings,
    type StoredConversationSettings,
    type StoredMessage,
    type StoredMessageAttachment,
    type TaskContextPayload,
    type ToolStatus,
    type UpdateSessionParams,
    toApiError,
} from '../../../api'
import {type SessionFailure, type SessionMessage, useAiSession} from './useAiSession'
import {
    estimateMessagesTokens,
    resolveTokenCalibrationFactor,
    tokensToConservativeCharBudget,
} from '../lib/contextUsage'
import {isMissingBackendSessionError} from '../lib/sessionErrors'
import {
    buildTaskContextPayload,
    DOCUMENT_CONTEXT_ATTRIBUTE,
    withDocumentContext,
} from '../lib/contextSubmission'
import {
    getAiPluginSnapshot,
    refreshAiPluginStore,
    setAiSelectedModel,
    setAiSelectedPlugin,
    setAiSelectedPluginModel,
    setAiWriterModeAvailable,
    useAiPluginStore,
} from '../stores/aiPluginStore'
import {
    getAppSettingsSnapshot,
    subscribeAppSettings,
} from '../../settings/appSettingsStore'
import {
    getAiConversationSnapshot,
    setAiActiveConversationId,
    setAiConversationMetaLoaded,
    setAiConversations,
    setAiUnreadConversationIds,
    useAiConversationStore,
} from '../stores/aiConversationStore'
import {
    abortAiStreamingController,
    clearAutoCompactInFlight,
    deleteRuntimeConversation,
    deleteRuntimeConversationsById,
    findRuntimeConversation,
    getAiSessionApi,
    markAutoCompactInFlight,
    setAiAbortController,
    setAiSessionApi,
    setRuntimeConversation,
} from '../stores/aiSessionStore'
import {
    setAiDocumentContextItemsByConversation,
    setAiFocusContext,
    setAiPendingDocumentAttachmentIdsByConversation,
    useAiContextStore,
} from '../stores/aiContextStore'
import type {
    AiContextValue,
    Attachment,
    Conversation,
    ConversationSettings,
    ConversationRuntimeState,
    Message,
    ReportConversationContext,
    SessionParams,
    AiToolAccessMode,
} from '../model/AiControllerTypes'
import {DEFAULT_CONVERSATION_SETTINGS, normalizeConversationSettings} from '../model/AiControllerTypes'
import {
    applyConversationModelSwitch,
    applyLatestTurnOutcome,
    appendOrMergeContinuation,
    createCompletedAssistantTurn,
    isEmptyDraftConversation,
    isIncompleteMessage,
    isPendingConversationId,
    toConversationHistory,
} from '../model/conversationState'
import {toEntryImageSrc} from '../../entries/lib/entryImage'

const generateTitleFromMessage = (content: string): string => {
    const cleaned = content.trim().replace(/\s+/g, ' ')
    if (cleaned.length <= 20) return cleaned
    return `${cleaned.slice(0, 20)}...`
}

const createAiTraceId = () => `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const buildAiLogPreview = (content: string) => {
    const normalized = content.trim().replace(/\s+/g, ' ')
    return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized
}

const CHARACTER_CONVERSATION_META_STORAGE_KEY = 'flowcloudai.characterConversationMeta.v1'
const AUTO_COMPACT_RETRY_BACKOFF_MS = 5 * 60 * 1_000
const DOCUMENT_CONTEXT_CHAR_BUDGET = 24_000
const DOCUMENT_CONTEXT_MIN_CHAR_BUDGET = 4_000
const DOCUMENT_CONTEXT_MAX_CHAR_BUDGET = 128_000
const WEB_TOOL_NAMES = ['web_search', 'open_url']
const READER_TOOL_NAMES = [
    'list_projects',
    'search_entries',
    'get_entry',
    'get_entry_content_by_line',
    'list_all_entries',
    'list_categories',
    'list_entries_by_type',
    'query_categories',
    'list_tag_schemas',
    'get_entry_relations',
    'get_project_summary',
    'list_entry_types',
    'report_progress',
]

function isToolEnabledForAccessMode(
    toolName: string,
    mode: AiToolAccessMode,
    webSearchEnabled: boolean,
): boolean {
    if (WEB_TOOL_NAMES.includes(toolName)) return webSearchEnabled
    if (mode === 'reader') return READER_TOOL_NAMES.includes(toolName)
    return true
}

type PreparedAiSession = { sid: string; runId: string; conversationId: string }

const mergeDocumentContextItems = (
    current: Record<string, DocumentContextItem[]>,
    items: DocumentContextItem[],
) => {
    if (items.length === 0) return current
    const next = {...current}
    let changed = false

    items.forEach((item) => {
        const conversationId = item.conversationId
        if (!conversationId) return
        const list = next[conversationId] ?? []
        const existingIndex = list.findIndex((existing) => existing.id === item.id)
        const nextList = existingIndex >= 0
            ? list.map((existing, index) => index === existingIndex ? item : existing)
            : [item, ...list]
        next[conversationId] = nextList.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        changed = true
    })

    return changed ? next : current
}

const getGlobalDefaultPrompt = (settings: AppSettings | null): string =>
    settings?.llm?.app_sense_custom_prompt.trim() ?? ''

const getConversationSpecificPrompt = (
    settings: ConversationSettings | null | undefined,
    appSettings: AppSettings | null,
): string => {
    const prompt = settings?.systemPrompt.trim() ?? ''
    if (!prompt) return ''

    const globalPrompt = getGlobalDefaultPrompt(appSettings)
    return globalPrompt && prompt === globalPrompt ? '' : prompt
}

const toStoredConversationSettings = (
    settings: ConversationSettings,
    appSettings: AppSettings | null = null,
): StoredConversationSettings => ({
    temperature: settings.temperature,
    topP: settings.topP,
    frequencyPenaltyEnabled: settings.frequencyPenaltyEnabled,
    frequencyPenalty: settings.frequencyPenalty,
    presencePenaltyEnabled: settings.presencePenaltyEnabled,
    presencePenalty: settings.presencePenalty,
    systemPrompt: getConversationSpecificPrompt(settings, appSettings),
})

const buildSessionUpdateParams = (
    settings: ConversationSettings,
    thinking: boolean,
): UpdateSessionParams => ({
    thinking,
    temperature: settings.temperature,
    topP: settings.topP,
    frequencyPenalty: settings.frequencyPenaltyEnabled ? settings.frequencyPenalty : 0,
    presencePenalty: settings.presencePenaltyEnabled ? settings.presencePenalty : 0,
})

const buildDefaultConversationSettings = (settings: AppSettings | null): ConversationSettings => {
    const llm = settings?.llm
    return normalizeConversationSettings({
        temperature: llm?.temperature ?? DEFAULT_CONVERSATION_SETTINGS.temperature,
        topP: llm?.top_p ?? DEFAULT_CONVERSATION_SETTINGS.topP,
        frequencyPenaltyEnabled: Boolean(llm && llm.frequency_penalty !== 0),
        frequencyPenalty: llm?.frequency_penalty ?? DEFAULT_CONVERSATION_SETTINGS.frequencyPenalty,
        presencePenaltyEnabled: Boolean(llm && llm.presence_penalty !== 0),
        presencePenalty: llm?.presence_penalty ?? DEFAULT_CONVERSATION_SETTINGS.presencePenalty,
        systemPrompt: getGlobalDefaultPrompt(settings),
    })
}

const conversationSettingsPatchAffectsContext = (patch: Partial<ConversationSettings>) => (
    Object.prototype.hasOwnProperty.call(patch, 'systemPrompt')
)

const normalizeConversationSettingsWithGlobalPrompt = (
    settings: Partial<ConversationSettings> | null | undefined,
    mode: Conversation['mode'] | undefined,
    appSettings: AppSettings | null,
): ConversationSettings => {
    const normalized = normalizeConversationSettings(settings)
    const globalPrompt = getGlobalDefaultPrompt(appSettings)
    if ((mode == null || mode === 'default') && !normalized.systemPrompt.trim() && globalPrompt) {
        return {...normalized, systemPrompt: globalPrompt}
    }
    return normalized
}

const createDraftConversation = (
    pluginId: string,
    model: string,
    settings: ConversationSettings = DEFAULT_CONVERSATION_SETTINGS,
): Conversation => ({
    id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: '新对话',
    messages: [],
    pluginId,
    model,
    sessionId: null,
    runId: null,
    timestamp: Date.now(),
    pinnedAt: null,
    archivedAt: null,
    mode: 'default',
    characterEntryId: null,
    characterName: null,
    backgroundImageUrl: null,
    characterVoicePluginId: null,
    characterVoiceModel: null,
    characterVoiceId: null,
    characterAutoPlay: null,
    reportContext: null,
    reportSeeded: false,
    settings: normalizeConversationSettings(settings),
})

interface StoredCharacterConversationMeta {
    mode?: 'character' | 'report' | null
    characterEntryId: string | null
    characterName: string | null
    backgroundImageUrl: string | null
    characterVoicePluginId: string | null
    characterVoiceModel: string | null
    characterVoiceId: string | null
    characterAutoPlay: boolean | null
    reportContext?: ReportConversationContext | null
    reportSeeded?: boolean | null
}

function buildReportBootstrapPrompt(reportContext: ReportConversationContext, userQuestion: string): string {
    return [
        `你正在和用户讨论一份“${reportContext.projectName}”项目的设定矛盾检测报告。`,
        '请把这份报告当作本轮对话的唯一核心上下文，优先解释报告中的结论、证据与修复建议。',
        '如果用户质疑某条结论，请先引用报告中的相关问题、证据和未决问题，再给出分析。',
        reportContext.truncated
            ? '注意：这份报告的检测范围经过裁剪，若结论依赖额外资料，请明确说明证据可能不足。'
            : '这份报告覆盖的是当前选定范围内的资料。',
        '除非用户明确要求，不要在自然语言回答中直接展示内部 ID；需要引用当前项目具体词条时，优先使用标准 Markdown 链接格式：[词条标题](fc://self/entry/词条ID)。',
        `报告范围：${reportContext.scopeSummary}`,
        `来源词条 ID（仅供定位）：${reportContext.sourceEntryIds.join('、') || '无'}`,
        '报告 JSON 如下：',
        reportContext.reportJson,
        '',
        `用户问题：${userQuestion}`,
    ].join('\n')
}

function inferCharacterConversationMeta(title: string): StoredCharacterConversationMeta | null {
    const matched = /^和「(.+)」聊天$/.exec(title.trim())
    if (!matched) return null
    return {
        characterEntryId: null,
        characterName: matched[1] || null,
        backgroundImageUrl: null,
        characterVoicePluginId: null,
        characterVoiceModel: null,
        characterVoiceId: null,
        characterAutoPlay: null,
    }
}

function readStoredCharacterConversationMetaMap(): Record<string, StoredCharacterConversationMeta> {
    if (typeof window === 'undefined') return {}
    try {
        const raw = window.localStorage.getItem(CHARACTER_CONVERSATION_META_STORAGE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return {}
        return parsed as Record<string, StoredCharacterConversationMeta>
    } catch {
        return {}
    }
}

function writeStoredCharacterConversationMetaMap(conversations: Conversation[]) {
    if (typeof window === 'undefined') return
    try {
        const stored: Record<string, StoredCharacterConversationMeta> = {}
        conversations.forEach((conversation) => {
            if (conversation.mode !== 'character' && conversation.mode !== 'report') return
            stored[conversation.id] = {
                mode: conversation.mode,
                characterEntryId: conversation.characterEntryId ?? null,
                characterName: conversation.characterName ?? null,
                backgroundImageUrl: conversation.backgroundImageUrl ?? null,
                characterVoicePluginId: conversation.characterVoicePluginId ?? null,
                characterVoiceModel: conversation.characterVoiceModel ?? null,
                characterVoiceId: conversation.characterVoiceId ?? null,
                characterAutoPlay: conversation.characterAutoPlay ?? null,
                reportContext: conversation.reportContext ?? null,
                reportSeeded: conversation.reportSeeded ?? null,
            }
        })
        window.localStorage.setItem(CHARACTER_CONVERSATION_META_STORAGE_KEY, JSON.stringify(stored))
    } catch {
        logger.warn('写入特殊会话元数据缓存失败')
    }
}

function normalizeStoredSpecialConversationMetaMap(
    fileMetaMap: Record<string, CharacterConversationMeta>,
): Record<string, StoredCharacterConversationMeta> {
    const normalized: Record<string, StoredCharacterConversationMeta> = {}
    Object.entries(fileMetaMap).forEach(([conversationId, meta]) => {
        normalized[conversationId] = {
            mode: meta.mode,
            characterEntryId: meta.characterEntryId ?? null,
            characterName: meta.characterName ?? null,
            backgroundImageUrl: meta.backgroundImageUrl ?? null,
            characterVoicePluginId: meta.characterVoicePluginId ?? null,
            characterVoiceModel: meta.characterVoiceModel ?? null,
            characterVoiceId: meta.characterVoiceId ?? null,
            characterAutoPlay: meta.characterAutoPlay ?? null,
            reportContext: (meta.reportContext as ReportConversationContext | null | undefined) ?? null,
            reportSeeded: meta.reportSeeded ?? null,
        }
    })
    return normalized
}

function buildCharacterConversationMetaMap(conversations: Conversation[]): Record<string, CharacterConversationMeta> {
    const metadata: Record<string, CharacterConversationMeta> = {}
    conversations.forEach((conversation) => {
        if (conversation.mode !== 'character' && conversation.mode !== 'report') return
        metadata[conversation.id] = {
            mode: conversation.mode,
            characterEntryId: conversation.characterEntryId ?? null,
            characterName: conversation.characterName ?? null,
            backgroundImageUrl: conversation.backgroundImageUrl ?? null,
            characterVoicePluginId: conversation.characterVoicePluginId ?? null,
            characterVoiceModel: conversation.characterVoiceModel ?? null,
            characterVoiceId: conversation.characterVoiceId ?? null,
            characterAutoPlay: conversation.characterAutoPlay ?? null,
            reportContext: conversation.reportContext ?? null,
            reportSeeded: conversation.reportSeeded ?? null,
        }
    })
    return metadata
}

function buildConversationUiStateMap(conversations: Conversation[]): Record<string, ConversationUiState> {
    const state: Record<string, ConversationUiState> = {}
    conversations.forEach((conversation) => {
        if (!conversation.pinnedAt && !conversation.archivedAt) return
        state[conversation.id] = {
            pinnedAt: conversation.pinnedAt ?? null,
            archivedAt: conversation.archivedAt ?? null,
        }
    })
    return state
}

const documentItemToAttachment = (item: DocumentContextItem): Attachment => ({
    id: item.id,
    name: item.fileName,
    type: 'file',
    data: item.id,
    documentContextItemId: item.id,
    extension: item.extension,
    sha256: item.sha256,
    status: item.status,
})

const storedAttachmentToMessageAttachment = (attachment: StoredMessageAttachment): Attachment => ({
    id: attachment.attachmentId,
    name: attachment.fileName,
    type: 'file',
    data: attachment.documentContextItemId,
    documentContextItemId: attachment.documentContextItemId,
    extension: attachment.extension,
    sha256: attachment.sha256,
    status: attachment.status,
})

const messageAttachmentToStored = (attachment: Attachment): StoredMessageAttachment | null => {
    if (attachment.type !== 'file' || !attachment.documentContextItemId) return null
    return {
        attachmentId: attachment.id,
        documentContextItemId: attachment.documentContextItemId,
        fileName: attachment.name,
        extension: attachment.extension ?? '',
        sha256: attachment.sha256 ?? '',
        status: attachment.status ?? 'ready',
    }
}

const messageAttachmentsToStored = (attachments: Attachment[] | undefined): StoredMessageAttachment[] =>
    (attachments ?? [])
        .map(messageAttachmentToStored)
        .filter((attachment): attachment is StoredMessageAttachment => Boolean(attachment))

const mergeDocumentAttachmentItemIds = (...groups: Array<string[] | undefined>): string[] => {
    const merged: string[] = []
    groups.forEach((group) => {
        group?.forEach((itemId) => {
            if (itemId && !merged.includes(itemId)) merged.push(itemId)
        })
    })
    return merged
}

const resolveDocumentContextCharBudget = (
    conversation: Conversation | null | undefined,
    query?: string,
): Promise<number> => {
    const snapshot = getAiPluginSnapshot()
    const pluginId = conversation?.pluginId ?? snapshot.selectedPlugin
    const modelId = conversation?.model ?? snapshot.selectedModel
    const plugin = snapshot.plugins.find((item) => item.id === pluginId)
    const contextWindowTokens = plugin?.model_infos.find((item) => item.id === modelId)?.context_window_tokens ?? null
    if (!contextWindowTokens || contextWindowTokens <= 0) return Promise.resolve(DOCUMENT_CONTEXT_CHAR_BUDGET)

    const calibrationFactor = resolveTokenCalibrationFactor(
        getAppSettingsSnapshot().settings?.llm.token_calibration_factors,
        pluginId,
        modelId,
    )

    const virtualMessages = [
        ...(conversation?.messages ?? []),
        ...(query?.trim() ? [{content: query}] : []),
        ...(conversation?.settings.systemPrompt.trim()
            ? [{content: conversation.settings.systemPrompt}]
            : []),
    ]
    return estimateMessagesTokens(virtualMessages, calibrationFactor, pluginId, modelId)
        .then(usedTokens => {
            const reservedReplyTokens = Math.max(2_000, Math.floor(contextWindowTokens * 0.2))
            const availableTokens = contextWindowTokens - usedTokens - reservedReplyTokens
            if (availableTokens <= 0) return DOCUMENT_CONTEXT_MIN_CHAR_BUDGET
            const documentTokens = Math.floor(availableTokens * 0.6)
            return Math.max(
                DOCUMENT_CONTEXT_MIN_CHAR_BUDGET,
                Math.min(
                    DOCUMENT_CONTEXT_MAX_CHAR_BUDGET,
                    tokensToConservativeCharBudget(documentTokens, calibrationFactor),
                ),
            )
        })
        .catch(() => DOCUMENT_CONTEXT_CHAR_BUDGET)
}

const collectDocumentAttachmentItemIds = (messages: Message[]): string[] =>
    mergeDocumentAttachmentItemIds(messages.flatMap((message) =>
        (message.attachments ?? [])
            .map((attachment) => attachment.documentContextItemId)
            .filter((itemId): itemId is string => Boolean(itemId)),
    ))

const collectDocumentAttachmentItemIdsUntilMessage = (
    messages: Message[],
    targetMessageId: string,
): string[] => {
    const collected: Message[] = []
    for (const message of messages) {
        collected.push(message)
        if (message.id === targetMessageId) break
    }
    return collectDocumentAttachmentItemIds(collected)
}

const parseStoredTimestamp = (timestamp: string): number | null => {
    const value = Date.parse(timestamp)
    return Number.isFinite(value) ? value : null
}

const attachWorkSecondsToFirstBlock = (
    blocks: MessageBoxBlock[],
    seconds: number | undefined,
): MessageBoxBlock[] => {
    if (seconds === undefined || blocks.length === 0) return blocks
    const normalizedSeconds = Math.max(0, Math.floor(seconds))
    return blocks.map((block, index) => (
        index === 0 ? {...block, seconds: normalizedSeconds} : block
    ))
}

const storedToMessages = (messages: StoredMessage[]): Message[] => {
    const result: Message[] = []
    let pendingAssistant: Message | null = null
    let pendingAssistantWorkSeconds: number | undefined
    const turnStartTimes = new Map<number, number>()

    messages.forEach((message) => {
        if (message.turn_id == null) return
        const timestamp = parseStoredTimestamp(message.timestamp)
        if (timestamp == null) return
        const current = turnStartTimes.get(message.turn_id)
        if (current === undefined || timestamp < current) {
            turnStartTimes.set(message.turn_id, timestamp)
        }
    })

    const getStoredMessageWorkSeconds = (message: StoredMessage) => {
        if (typeof message.work_seconds === 'number' && Number.isFinite(message.work_seconds)) {
            return Math.max(0, Math.floor(message.work_seconds))
        }
        if (message.role !== 'assistant' || message.turn_id == null) return undefined
        const start = turnStartTimes.get(message.turn_id)
        const end = parseStoredTimestamp(message.timestamp)
        if (start === undefined || end == null) return undefined
        return Math.max(0, Math.round((end - start) / 1000))
    }

    const flushPendingAssistant = () => {
        if (!pendingAssistant) return
        if (pendingAssistant.blocks && pendingAssistant.blocks.length > 0) {
            result.push({
                ...pendingAssistant,
                blocks: attachWorkSecondsToFirstBlock(pendingAssistant.blocks, pendingAssistantWorkSeconds),
            })
        }
        pendingAssistant = null
        pendingAssistantWorkSeconds = undefined
    }

    const ensureAssistant = (message: StoredMessage, index: number) => {
        if (!pendingAssistant) {
            pendingAssistant = {
                id: message.message_id ?? `loaded_assistant_${index}_${Date.now()}`,
                role: 'assistant',
                content: '',
                timestamp: new Date(message.timestamp).getTime(),
                nodeId: message.node_id ?? undefined,
                blocks: [],
                turnStatus: message.turn_status ?? undefined,
                finishReason: message.finish_reason ?? undefined,
                continuationOfNodeId: message.continuation_of ?? undefined,
            }
        }
        return pendingAssistant
    }

    messages.forEach((message, index) => {
        if (message.role === 'user') {
            flushPendingAssistant()
        }

        if (message.role === 'tool') {
            const assistant = pendingAssistant
            if (!assistant?.blocks) return
            const toolBlockIndex = assistant.blocks.findIndex((block) => {
                if (block.type !== 'tool') return false
                return block.tool.result == null
            })
            if (toolBlockIndex === -1) return

            const nextBlocks = [...assistant.blocks]
            const block = nextBlocks[toolBlockIndex]
            if (block.type === 'tool') {
                nextBlocks[toolBlockIndex] = {
                    ...block,
                    tool: {
                        ...block.tool,
                        result: message.content ?? '',
                        isError: false,
                    },
                }
                pendingAssistant = {...assistant, blocks: nextBlocks}
            }
            return
        }

        if (message.role === 'assistant') {
            const assistant = ensureAssistant(message, index)
            const nextBlocks = [...(assistant.blocks ?? [])]
            const workSeconds = getStoredMessageWorkSeconds(message)
            if (workSeconds !== undefined) {
                pendingAssistantWorkSeconds = Math.max(pendingAssistantWorkSeconds ?? 0, workSeconds)
            }

            if (message.reasoning) {
                nextBlocks.push({type: 'reasoning', content: message.reasoning})
            }
            if (message.tool_calls && message.tool_calls.length > 0) {
                message.tool_calls.forEach((toolCall) => {
                    const name = toolCall.function?.name ?? toolCall.name ?? ''
                    const args = toolCall.function?.arguments ?? toolCall.arguments ?? ''
                    const last = nextBlocks[nextBlocks.length - 1]

                    if (last && last.type === 'tool_use'
                        && last.tools.length > 0
                        && last.tools[0].name === name) {
                        nextBlocks[nextBlocks.length - 1] = {
                            ...last,
                            tools: [...last.tools, {index: toolCall.index, name, args}],
                        }
                    } else if (last && last.type === 'tool'
                        && last.tool.name === name
                        && last.tool.result == null) {
                        nextBlocks[nextBlocks.length - 1] = {
                            type: 'tool_use',
                            tools: [last.tool, {index: toolCall.index, name, args}],
                            detail: 'verbose',
                        }
                    } else {
                        nextBlocks.push({
                            type: 'tool',
                            tool: {index: toolCall.index, name, args},
                            detail: 'verbose',
                        })
                    }
                })
            }
            if (message.content) {
                nextBlocks.push({type: 'content', content: message.content, markdown: true})
            }

            pendingAssistant = applyLatestTurnOutcome({
                ...assistant,
                content: assistant.content + (message.content ?? ''),
                reasoning: assistant.reasoning
                    ? `${assistant.reasoning}${message.reasoning ?? ''}`
                    : (message.reasoning || undefined),
                timestamp: new Date(message.timestamp).getTime(),
                nodeId: message.node_id ?? assistant.nodeId,
                blocks: nextBlocks,
            }, {
                turnStatus: message.turn_status ?? undefined,
                finishReason: message.finish_reason ?? undefined,
                continuationOfNodeId: message.continuation_of ?? undefined,
                error: message.turn_status === 'cancelled'
                    || message.turn_status === 'interrupted'
                    || message.turn_status === 'error'
                    ? {
                        code: message.turn_status === 'cancelled'
                            ? ErrorCode.CoreClientCancelled
                            : ErrorCode.LlmStreamProtocolError,
                        message: '上次生成未正常完成，可从保留内容继续。',
                        detail: {retryable: true},
                    }
                    : undefined,
            })
            return
        }

        const base: Message = {
            id: message.message_id ?? `loaded_${index}_${Date.now()}`,
            role: message.role as 'user' | 'assistant',
            content: message.content ?? '',
            reasoning: message.reasoning || undefined,
            timestamp: new Date(message.timestamp).getTime(),
            nodeId: message.node_id ?? undefined,
            attachments: message.attachments?.map(storedAttachmentToMessageAttachment),
        }

        if (message.content) {
            base.blocks = [{type: 'content', content: message.content}]
        }

        result.push(base)
    })

    flushPendingAssistant()
    return result
}

export interface AiFocus {
    projectId: string | null
    entryId: string | null
}

export function useAiController(focus: AiFocus): AiContextValue {
    const {
        plugins,
        pluginsReady,
        selectedPlugin,
        selectedModel,
        writerModeAvailable,
    } = useAiPluginStore()
    const appSettingsRef = useRef<AppSettings | null>(null)

    const {
        conversations,
        activeConversationId,
        unreadConversationIds,
        conversationMetaLoaded,
    } = useAiConversationStore()
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
    const [autoScroll, setAutoScroll] = useState(true)

    const [inputValue, setInputValue] = useState('')
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
    const [continuationSubmittingMessageId, setContinuationSubmittingMessageId] = useState<string | null>(null)
    const [completedAssistantTurn, setCompletedAssistantTurn] = useState<AiContextValue['completedAssistantTurn']>(null)
    const completedAssistantTurnSequenceRef = useRef(0)
    const continuationSubmittingRef = useRef(new Set<string>())
    const [sessionParams, setSessionParams] = useState<SessionParams>({thinking: true})
    const sessionParamsRef = useRef(sessionParams)
    useEffect(() => { sessionParamsRef.current = sessionParams }, [sessionParams])
    const [tools, setTools] = useState<ToolStatus[]>([])
    const [webSearchEnabled, setWebSearchEnabled] = useState(true)
    const [toolAccessMode, setToolAccessModeState] = useState<AiToolAccessMode>('assistant')
    const editModeEnabled = toolAccessMode !== 'reader'

    const conversationsRef = useRef(conversations)
    useEffect(() => {
        conversationsRef.current = conversations
    }, [conversations])

    const focusRef = useRef(focus)
    useEffect(() => {
        focusRef.current = focus
    }, [focus])

    const projectNameCacheRef = useRef<Map<string, string>>(new Map())
    // Map value: snippet string（含空字符串），undefined 表示未缓存
    const entrySnippetCacheRef = useRef<Map<string, string>>(new Map())
    const entryTitleCacheRef = useRef<Map<string, string>>(new Map())
    const conversationSettingsSaveTimersRef = useRef<Record<string, ReturnType<typeof window.setTimeout>>>({})
    const autoCompactSuggestedConversationIdsRef = useRef(new Set<string>())
    const autoCompactRetryAfterRef = useRef(new Map<string, number>())
    const [compactingConversationId, setCompactingConversationId] = useState<string | null>(null)
    const {
        focusContext,
        documentContextItemsByConversation,
        pendingDocumentAttachmentIdsByConversation,
    } = useAiContextStore()

    const activeConversation = useMemo(
        () => conversations.find((conversation) => conversation.id === activeConversationId),
        [conversations, activeConversationId],
    )
    const historyConversations = useMemo(
        () => toConversationHistory(conversations),
        [conversations],
    )
    const isComposingNewConversation = Boolean(
        activeConversation && isEmptyDraftConversation(activeConversation),
    )

    const messages = useMemo(() => activeConversation?.messages ?? [], [activeConversation])
    const documentContextItemsByConversationRef = useRef(documentContextItemsByConversation)
    useEffect(() => {
        documentContextItemsByConversationRef.current = documentContextItemsByConversation
    }, [documentContextItemsByConversation])
    const pendingDocumentAttachmentIdsByConversationRef = useRef(pendingDocumentAttachmentIdsByConversation)
    useEffect(() => {
        pendingDocumentAttachmentIdsByConversationRef.current = pendingDocumentAttachmentIdsByConversation
    }, [pendingDocumentAttachmentIdsByConversation])
    const documentContextItems = useMemo(
        () => activeConversationId ? (documentContextItemsByConversation[activeConversationId] ?? []) : [],
        [activeConversationId, documentContextItemsByConversation],
    )
    const pendingDocumentAttachmentItems = useMemo(() => {
        if (!activeConversationId) return []
        const items = documentContextItemsByConversation[activeConversationId] ?? []
        const itemsById = new Map(items.map((item) => [item.id, item]))
        return (pendingDocumentAttachmentIdsByConversation[activeConversationId] ?? [])
            .map((itemId) => itemsById.get(itemId))
            .filter((item): item is DocumentContextItem => Boolean(item))
    }, [activeConversationId, documentContextItemsByConversation, pendingDocumentAttachmentIdsByConversation])

    const activeConversationRef = useRef(activeConversation)
    const modelSwitchInFlightRef = useRef<Promise<void> | null>(null)
    useEffect(() => {
        activeConversationRef.current = activeConversation
    }, [activeConversation])

    const refreshAiSidebarState = useCallback(async (includeTools = false) => {
        const [pluginState, fetchedTools] = await Promise.all([
            refreshAiPluginStore({
                preferredPluginId: activeConversationRef.current?.pluginId,
                preferredModel: activeConversationRef.current?.model,
            }),
            includeTools ? ai_list_tools() : Promise.resolve(null),
        ])

        const settings = pluginState.settings
        appSettingsRef.current = settings

        if (fetchedTools) {
            const nextMode: AiToolAccessMode = 'assistant'
            const enableOps = fetchedTools.map((tool) => ai_enable_tool(tool.name))
            void Promise.all(enableOps)
            setTools(fetchedTools.map((tool) => ({
                ...tool,
                enabled: isToolEnabledForAccessMode(tool.name, nextMode, true),
            })))
            setWebSearchEnabled(true)
            setToolAccessModeState(nextMode)
        }
    }, [])

    const activeConversationIdRef = useRef(activeConversationId)
    useEffect(() => {
        activeConversationIdRef.current = activeConversationId
    }, [activeConversationId])

    const loadDocumentContextItems = useCallback(async (conversationId: string) => {
        const items = await docctx_list_items(conversationId)
        setAiDocumentContextItemsByConversation((current) => ({
            ...current,
            [conversationId]: items,
        }))
    }, [])

    const migrateDocumentContextConversation = useCallback(async (
        fromConversationId: string,
        toConversationId: string,
    ) => {
        if (fromConversationId === toConversationId) return []
        const migrated = await docctx_reassign_conversation(fromConversationId, toConversationId)
        setAiDocumentContextItemsByConversation((current) => {
            const next = {...current}
            delete next[fromConversationId]
            if (migrated.length > 0) {
                next[toConversationId] = migrated
            } else if (current[fromConversationId]?.length) {
                next[toConversationId] = current[fromConversationId].map((item) => ({
                    ...item,
                    conversationId: toConversationId,
                }))
            }
            return next
        })
        setAiPendingDocumentAttachmentIdsByConversation((current) => {
            const pendingIds = current[fromConversationId]
            if (!pendingIds?.length) return current
            const next = {...current}
            delete next[fromConversationId]
            next[toConversationId] = pendingIds
            return next
        })
        return migrated
    }, [])

    const maybeAutoCompactBeforeSend = useCallback(async (
        conversation: Conversation,
        messages: Message[],
        _pendingContent: string,
        force = false,
        preflight?: AiRequestPreflight | null,
        runtime?: PreparedAiSession | null,
    ): Promise<boolean> => {
        const settings = await setting_get_settings().catch(() => appSettingsRef.current)
        if (settings) appSettingsRef.current = settings
        const compactSettings = settings?.llm
        if (
            !compactSettings
            || conversation.mode !== 'default'
            || (!force && !compactSettings.auto_compact_enabled)
        ) return false
        const targetConversationId = runtime?.conversationId ?? conversation.id
        const retryAfter = autoCompactRetryAfterRef.current.get(targetConversationId) ?? 0
        if (!force && retryAfter > Date.now()) return false
        if (retryAfter > 0) autoCompactRetryAfterRef.current.delete(targetConversationId)

        const headMessage = [...messages]
            .reverse()
            .find((item) => item.nodeId != null && (force || item.role === 'assistant'))
        if (!headMessage?.nodeId) return false
        const headNodeId = preflight?.head_node_id ?? headMessage.nodeId

        const contextWindowTokens = preflight?.context_window_tokens ?? null
        if (!force && (!contextWindowTokens || contextWindowTokens <= 0)) return false

        const estimatedTokens = preflight?.estimated_input_tokens ?? 0
        let usageRatio = 0
        const suggested = force
            || preflight?.suggest_compaction === true
            || autoCompactSuggestedConversationIdsRef.current.has(targetConversationId)
        if (!force && contextWindowTokens) {
            usageRatio = estimatedTokens / contextWindowTokens
            if (!suggested && usageRatio < compactSettings.auto_compact_threshold_ratio) return false
        }

        const inFlightKey = `${targetConversationId}:${headNodeId}:${force ? 'forced' : 'pre-send'}`
        if (!markAutoCompactInFlight(inFlightKey)) return false

        setCompactingConversationId(targetConversationId)
        try {
            const result = await ai_compact_conversation({
                conversationId: targetConversationId,
                pluginId: conversation.pluginId,
                model: conversation.model,
                headNodeId,
                recentMessages: compactSettings.auto_compact_recent_messages,
                detail: compactSettings.auto_compact_detail,
            })
            autoCompactSuggestedConversationIdsRef.current.delete(targetConversationId)
            autoCompactRetryAfterRef.current.delete(targetConversationId)
            logger.log('[useAiController][自动压缩] 发送前压缩检查完成', {
                conversationId: targetConversationId,
                applied: result.applied,
                positionNodeId: result.positionNodeId ?? null,
                summaryChars: result.summaryChars,
                suggested,
                usageRatio,
                estimatedTokens,
                inputBudgetTokens: preflight?.input_budget_tokens ?? null,
                outputReserveTokens: preflight?.output_reserve_tokens ?? null,
                safetyReserveTokens: preflight?.safety_reserve_tokens ?? null,
                requestFingerprint: preflight?.request_fingerprint ?? null,
                force,
            })
            if (!result.applied) return false

            const sessionId = runtime?.sid ?? conversation.sessionId
            const runId = runtime?.runId ?? conversation.runId
            if (sessionId) {
                await getAiSessionApi()?.closeSession(sessionId)
            }
            if (sessionId && runId) {
                deleteRuntimeConversation(sessionId, runId)
            }
            getAiSessionApi()?.activateSession(null, null)
            const clearRuntime = (item: Conversation) =>
                item.id === conversation.id || item.id === targetConversationId
                    ? {...item, sessionId: null, runId: null}
                    : item
            conversationsRef.current = conversationsRef.current.map(clearRuntime)
            setAiConversations((prev) => prev.map(clearRuntime))
            return true
        } catch (error) {
            autoCompactRetryAfterRef.current.set(
                targetConversationId,
                Date.now() + AUTO_COMPACT_RETRY_BACKOFF_MS,
            )
            logger.warn('[useAiController][自动压缩] 发送前压缩失败，继续发送', {
                conversationId: targetConversationId,
                error,
            })
            return false
        } finally {
            setCompactingConversationId((current) =>
                current === targetConversationId ? null : current,
            )
            clearAutoCompactInFlight(inFlightKey)
        }
    }, [])

    const persistUserMessageAttachments = useCallback((
        conversationId: string,
        userMessage: Message | null | undefined,
    ) => {
        if (!userMessage?.nodeId || !userMessage.attachments?.length) return
        const attachments = messageAttachmentsToStored(userMessage.attachments)
        if (attachments.length === 0) return
        ai_update_message_attachments(conversationId, userMessage.nodeId, attachments)
            .catch((error) => {
                logger.warn('[useAiController] 持久化消息附件失败', {
                    conversationId,
                    nodeId: userMessage.nodeId,
                    error,
                })
            })
    }, [])

    const onMessage = useCallback((message: SessionMessage) => {
        const targetConversationId = findRuntimeConversation(message.sessionId, message.runId)
        const resolvedConversationId = targetConversationId
            ?? conversationsRef.current.find((conversation) => (
                conversation.sessionId === message.sessionId && conversation.runId === message.runId
            ))?.id
            ?? null

        const incomingMessage: Message = {
            id: message.id,
            role: message.role,
            content: message.content,
            timestamp: message.timestamp,
            reasoning: message.reasoning,
            blocks: message.blocks,
            nodeId: message.nodeId,
            usage: message.usage,
            calibrationFactor: message.calibrationFactor,
            turnStatus: message.turnStatus,
            finishReason: message.finishReason,
            continuationOfNodeId: message.continuationOfNodeId,
            error: message.turnStatus === 'cancelled'
                || message.turnStatus === 'interrupted'
                ? {
                    code: message.turnStatus === 'cancelled'
                        ? ErrorCode.CoreClientCancelled
                        : ErrorCode.LlmStreamProtocolError,
                    message: '本轮生成未完成，可从保留内容继续。',
                    detail: {retryable: true},
                }
                : undefined,
        }
        let latestUserMessageWithAttachments: Message | null = null
        setAiConversations((prev) => prev.map((conversation) => {
            const matchedByRuntime =
                conversation.sessionId === message.sessionId && conversation.runId === message.runId
            const matchedByMap = targetConversationId != null && conversation.id === targetConversationId
            if (!matchedByRuntime && !matchedByMap) return conversation
            latestUserMessageWithAttachments = [...conversation.messages]
                .reverse()
                .find((item) => item.role === 'user' && Boolean(item.nodeId) && Boolean(item.attachments?.length))
                ?? null
            return {
                ...conversation,
                messages: appendOrMergeContinuation(conversation.messages, incomingMessage),
            }
        }))
        const nextSequence = completedAssistantTurnSequenceRef.current + 1
        const completedTurn = createCompletedAssistantTurn(
            incomingMessage,
            resolvedConversationId,
            activeConversationIdRef.current,
            nextSequence,
        )
        if (completedTurn) {
            completedAssistantTurnSequenceRef.current = nextSequence
            setCompletedAssistantTurn(completedTurn)
        }
        if (resolvedConversationId) {
            setAiUnreadConversationIds((prev) => {
                const next = {...prev}
                if (resolvedConversationId === activeConversationIdRef.current) {
                    delete next[resolvedConversationId]
                } else {
                    next[resolvedConversationId] = true
                }
                return next
            })
        }
        if (resolvedConversationId) {
            if (message.suggestCompaction) {
                autoCompactSuggestedConversationIdsRef.current.add(resolvedConversationId)
            }
            persistUserMessageAttachments(resolvedConversationId, latestUserMessageWithAttachments)
        }
    }, [persistUserMessageAttachments])

    const onUserTurnBegin = useCallback((payload: { sessionId: string; runId: string; nodeId: number }) => {
        const targetConversationId = findRuntimeConversation(payload.sessionId, payload.runId)

        setAiConversations((prev) => prev.map((conversation) => {
            const matchedByRuntime =
                conversation.sessionId === payload.sessionId && conversation.runId === payload.runId
            const matchedByMap = targetConversationId != null && conversation.id === targetConversationId
            if (!matchedByRuntime && !matchedByMap) return conversation

            const targetIndex = [...conversation.messages]
                .reverse()
                .findIndex((message) => message.role === 'user' && message.nodeId == null)
            if (targetIndex === -1) return conversation

            const actualIndex = conversation.messages.length - 1 - targetIndex
            const targetMessage = conversation.messages[actualIndex]
            if (!targetMessage || targetMessage.role !== 'user' || targetMessage.nodeId != null) {
                return conversation
            }

            const nextMessages = [...conversation.messages]
            nextMessages[actualIndex] = {
                ...targetMessage,
                nodeId: payload.nodeId,
            }

            return {
                ...conversation,
                messages: nextMessages,
            }
        }))
    }, [])

    const onError = useCallback((failure: SessionFailure) => {
        logger.error('[useAiController] AI 对话失败', {
            code: failure.error.code,
            message: failure.error.message,
            detail: failure.error.detail,
            sessionId: failure.sessionId,
            runId: failure.runId,
            fatal: failure.fatal,
        })
        const mappedConversationId = failure.sessionId && failure.runId
            ? findRuntimeConversation(failure.sessionId, failure.runId)
            : null
        const ownedConversationId = mappedConversationId
            ?? conversationsRef.current.find((conversation) => (
                conversation.sessionId === failure.sessionId
                && (!failure.runId || conversation.runId === failure.runId)
            ))?.id
            ?? null
        // 带 runId 的错误只能写入拥有该运行实例的对话；设定检测等独立 AI 任务不得回退到当前对话。
        if (failure.runId && !ownedConversationId) return
        const targetConversationId = ownedConversationId
            ?? activeConversationIdRef.current
        if (!targetConversationId) return

        if (failure.fatal && failure.sessionId && failure.runId) {
            deleteRuntimeConversation(failure.sessionId, failure.runId)
        }
        setAiConversations((prev) => prev.map((conversation) => {
            if (conversation.id !== targetConversationId) return conversation
            const ownsFailedSession = Boolean(
                failure.fatal
                && failure.sessionId
                && conversation.sessionId === failure.sessionId
                && (!failure.runId || conversation.runId === failure.runId),
            )
            return {
                ...conversation,
                sessionId: ownsFailedSession ? null : conversation.sessionId,
                runId: ownsFailedSession ? null : conversation.runId,
                messages: appendOrMergeContinuation(conversation.messages, {
                    id: `error_${Date.now()}_${failure.runId ?? 'session'}`,
                    role: 'assistant',
                    content: failure.content,
                    timestamp: Date.now(),
                    reasoning: failure.reasoning,
                    blocks: failure.blocks,
                    nodeId: failure.nodeId,
                    error: failure.error,
                    turnStatus: failure.turnStatus ?? 'error',
                    finishReason: failure.finishReason,
                    continuationOfNodeId: failure.continuationOfNodeId,
                }),
            }
        }))
        setAiUnreadConversationIds((prev) => {
            if (targetConversationId === activeConversationIdRef.current) return prev
            return {...prev, [targetConversationId]: true}
        })
    }, [])

    const session = useAiSession({onMessage, onUserTurnBegin, onError})
    useEffect(() => {
        setAiSessionApi(session)
    }, [session])

    const selectConversation = useCallback((convId: string | null) => {
        activeConversationIdRef.current = convId
        setAiActiveConversationId(convId)
        const conversation = convId
            ? conversationsRef.current.find((item) => item.id === convId)
            : null
        session.activateSession(conversation?.sessionId ?? null, conversation?.runId ?? null)
        if (convId) {
            setAiUnreadConversationIds((prev) => {
                if (!prev[convId]) return prev
                const next = {...prev}
                delete next[convId]
                return next
            })
        }
    }, [session])

    const conversationRuntime = useMemo<Record<string, ConversationRuntimeState>>(() => {
        const result: Record<string, ConversationRuntimeState> = {}
        conversations.forEach((conversation) => {
            const isStreaming = conversation.runId ? Boolean(session.streamingByRun[conversation.runId]) : false
            result[conversation.id] = {
                isStreaming,
                hasUnreadReply: !isStreaming && Boolean(unreadConversationIds[conversation.id]),
            }
        })
        return result
    }, [conversations, session.streamingByRun, unreadConversationIds])

    useEffect(() => {
        const currentConversationId = activeConversationIdRef.current
        if (!currentConversationId || !session.sessionId || !session.runId || session.lastUserNodeId == null) {
            return
        }

        setAiConversations((prev) => prev.map((conversation) => {
            if (
                conversation.id !== currentConversationId
                || conversation.sessionId !== session.sessionId
                || conversation.runId !== session.runId
            ) {
                return conversation
            }

            const targetIndex = [...conversation.messages]
                .reverse()
                .findIndex((message) => message.role === 'user' && message.nodeId == null)

            if (targetIndex === -1) return conversation

            const actualIndex = conversation.messages.length - 1 - targetIndex
            const targetMessage = conversation.messages[actualIndex]
            if (!targetMessage || targetMessage.role !== 'user' || targetMessage.nodeId != null) {
                return conversation
            }

            const nextMessages = [...conversation.messages]
            nextMessages[actualIndex] = {
                ...targetMessage,
                nodeId: session.lastUserNodeId ?? undefined,
            }

            return {
                ...conversation,
                messages: nextMessages,
            }
        }))
    }, [session.lastUserNodeId, session.runId, session.sessionId])

    // 分支切换后重新加载对话消息（新分支路径上的消息可能不同）
    useEffect(() => {
        if (session.branchSwitchVersion === 0) return
        const convId = activeConversationIdRef.current
        if (!convId || isPendingConversationId(convId)) return
        ai_get_conversation(convId).then(stored => {
            if (!stored) return
            setAiConversations(prev => prev.map(c =>
                c.id === convId
                    ? {
                        ...c,
                        messages: storedToMessages(stored.messages),
                        settings: normalizeConversationSettingsWithGlobalPrompt(
                            stored.settings,
                            c.mode,
                            appSettingsRef.current,
                        ),
                    }
                    : c,
            ))
        }).catch(() => {})
    }, [session.branchSwitchVersion])

    // 词条内容更新时清除对应缓存，避免下次推送旧摘要
    useEffect(() => {
        const unlisten = listen<EntryUpdatedEvent>(ENTRY_UPDATED, (e) => {
            entrySnippetCacheRef.current.delete(e.payload.entry_id)
            entryTitleCacheRef.current.delete(e.payload.entry_id)
        })
        return () => {
            unlisten.then(fn => fn())
        }
    }, [])

    useEffect(() => {
        const unlisten = listen<DocumentContextUpdatedEvent>(DOCCTX_UPDATED, (event) => {
            setAiDocumentContextItemsByConversation((current) =>
                mergeDocumentContextItems(current, [event.payload.item]),
            )
            setAiConversations((current) => current.map((conversation) => ({
                ...conversation,
                messages: conversation.messages.map((message) => {
                    if (!message.attachments?.some((attachment) =>
                        attachment.documentContextItemId === event.payload.item.id,
                    )) {
                        return message
                    }
                    return {
                        ...message,
                        attachments: message.attachments.map((attachment) =>
                            attachment.documentContextItemId === event.payload.item.id
                                ? documentItemToAttachment(event.payload.item)
                                : attachment,
                        ),
                    }
                }),
            })))
        })
        return () => {
            unlisten.then(fn => fn())
        }
    }, [])

    useEffect(() => {
        const conversationId = activeConversationId
        if (!conversationId) return
        loadDocumentContextItems(conversationId).catch((error) => {
            logger.warn('[useAiController] 加载文档上下文列表失败', {conversationId, error})
        })
    }, [activeConversationId, loadDocumentContextItems])

    useEffect(() => {
        let cancelled = false

        const loadFocusContext = async () => {
            const [projectResult, entryResult] = await Promise.allSettled([
                focus.projectId ? (async () => {
                    const cached = projectNameCacheRef.current.get(focus.projectId!)
                    if (cached !== undefined) return cached
                    const project = await db_get_project(focus.projectId!)
                    projectNameCacheRef.current.set(focus.projectId!, project.name)
                    return project.name
                })() : Promise.resolve(null),
                focus.entryId ? (async () => {
                    const cached = entryTitleCacheRef.current.get(focus.entryId!)
                    if (cached !== undefined) return cached
                    const entry = await db_get_entry(focus.entryId!, focus.projectId ?? undefined)
                    entryTitleCacheRef.current.set(focus.entryId!, entry.title)
                    return entry.title
                })() : Promise.resolve(null),
            ])

            if (cancelled) return
            setAiFocusContext({
                projectId: focus.projectId,
                projectName: projectResult.status === 'fulfilled' ? projectResult.value : null,
                entryId: focus.entryId,
                entryTitle: entryResult.status === 'fulfilled' ? entryResult.value : null,
                editModeEnabled,
                webSearchEnabled,
            })
        }

        void loadFocusContext()

        return () => {
            cancelled = true
        }
    }, [editModeEnabled, focus.entryId, focus.projectId, webSearchEnabled])

    const resolveContextPayload = useCallback(async (
        projectId: string | null,
        entryId: string | null,
        conversationSettings?: ConversationSettings | null,
    ): Promise<TaskContextPayload> => {
        const [projResult, entryResult] = await Promise.allSettled([
            projectId ? (async () => {
                const cached = projectNameCacheRef.current.get(projectId)
                if (cached !== undefined) return cached
                const proj = await db_get_project(projectId)
                projectNameCacheRef.current.set(projectId, proj.name)
                return proj.name
            })() : Promise.resolve(null),
            entryId ? (async () => {
                if (entrySnippetCacheRef.current.has(entryId)) {
                    return entrySnippetCacheRef.current.get(entryId)!
                }
                const entry = await db_get_entry(entryId, projectId ?? undefined)
                const snippet = entry.content?.slice(0, 500) ?? ''
                entrySnippetCacheRef.current.set(entryId, snippet)
                return snippet
            })() : Promise.resolve(null),
        ])

        const systemPrompt = getConversationSpecificPrompt(
            conversationSettings ?? null,
            appSettingsRef.current,
        )
        return buildTaskContextPayload({
            projectId,
            projectName: projResult.status === 'fulfilled' ? projResult.value : null,
            entryId,
            entrySnippet: entryResult.status === 'fulfilled' ? entryResult.value : null,
            systemPrompt,
            toolAccessMode,
            webSearchEnabled,
            editModeEnabled,
        })
    }, [editModeEnabled, toolAccessMode, webSearchEnabled])

    const appendDocumentContext = useCallback(async (
        ctx: TaskContextPayload,
        conversationId: string,
        itemIds: string[] = [],
        query?: string,
    ): Promise<TaskContextPayload> => {
        const selectedItemIds = mergeDocumentAttachmentItemIds(itemIds)
        if (selectedItemIds.length === 0) return ctx

        try {
            const conversation = conversationsRef.current.find((item) => item.id === conversationId) ?? null
            const result = await docctx_build_context({
                conversationId,
                itemIds: selectedItemIds,
                maxChars: await resolveDocumentContextCharBudget(conversation, query),
                query: query?.trim() || null,
            })
            if (result.sources.length === 0 || !result.markdown.trim()) return ctx
            return withDocumentContext(ctx, result.markdown)
        } catch (error) {
            logger.warn('[useAiController] 构建文档上下文失败，继续使用基础上下文', {
                conversationId,
                error,
            })
            return ctx
        }
    }, [])

    // tab 切换、session 建立或对话提示词变化时推送最新焦点上下文
    useEffect(() => {
        const sid = session.sessionId
        if (!sid) return
        let cancelled = false
        const conversationId = activeConversationRef.current?.id ?? null
        const settings = activeConversationRef.current?.settings ?? DEFAULT_CONVERSATION_SETTINGS
        const documentAttachmentItemIds = activeConversationRef.current
            ? collectDocumentAttachmentItemIds(activeConversationRef.current.messages)
            : []
        resolveContextPayload(focus.projectId, focus.entryId, settings).then(async (ctx) => {
            if (cancelled) return
            const enrichedCtx = conversationId
                ? await appendDocumentContext(ctx, conversationId, documentAttachmentItemIds)
                : ctx
            if (cancelled) return
            ai_set_task_context(sid, enrichedCtx).catch(() => {
            })
        }).catch(() => {
        })
        return () => {
            cancelled = true
        }
    }, [activeConversation?.settings.systemPrompt, activeConversationId, focus.projectId, focus.entryId, session.sessionId, resolveContextPayload, appendDocumentContext])

    useEffect(() => {
        let mounted = true
        refreshAiSidebarState(true).catch((error) => {
            if (!mounted) return
            logger.error('初始化 AI 侧栏状态失败', error)
        })
        return () => {
            mounted = false
        }
    }, [refreshAiSidebarState])

    useEffect(() => {
        const unlisten = listen('backend-ready', () => {
            refreshAiSidebarState(true).catch((error) => {
                logger.error('后端就绪后刷新 AI 侧栏状态失败', error)
            })
        })
        return () => {
            unlisten.then((fn) => fn())
        }
    }, [refreshAiSidebarState])

    useEffect(() => {
        if (getAiConversationSnapshot().conversationMetaLoaded) return
        let mounted = true
        const init = async () => {
            const [metas, fileMetaMap, uiStateMap] = await Promise.all([
                ai_list_conversations().catch(
                    () => [] as Awaited<ReturnType<typeof ai_list_conversations>>,
                ),
                ai_get_character_conversation_meta().catch(() => ({} as Record<string, CharacterConversationMeta>)),
                ai_get_conversation_ui_state().catch(() => ({} as Record<string, ConversationUiState>)),
            ])
            if (!mounted) return

            if (metas.length > 0) {
                const storedMetaMap = {
                    ...readStoredCharacterConversationMetaMap(),
                    ...normalizeStoredSpecialConversationMetaMap(fileMetaMap),
                }
                const convs: Conversation[] = metas.map((meta) => (
                    buildConversationFromMeta(meta, storedMetaMap, uiStateMap)
                ))

                setAiConversations(convs)
                setAiActiveConversationId(null)
            } else {
                setAiConversations([])
                setAiActiveConversationId(null)
            }
            setAiConversationMetaLoaded(true)
        }

        void init()
        return () => {
            mounted = false
        }
    }, [])

    useEffect(() => {
        if (!conversationMetaLoaded) return
        writeStoredCharacterConversationMetaMap(conversations)
        void ai_save_character_conversation_meta(buildCharacterConversationMetaMap(conversations)).catch((error) => {
            logger.warn('写入特殊会话元数据文件失败', error)
        })
        void ai_save_conversation_ui_state(buildConversationUiStateMap(conversations)).catch((error) => {
            logger.warn('写入会话 UI 状态失败', error)
        })
    }, [conversationMetaLoaded, conversations])

    useEffect(() => {
        if (!conversationMetaLoaded || !pluginsReady || !selectedPlugin || !selectedModel) return
        if (activeConversationIdRef.current) return

        const existingDraft = conversationsRef.current.find(isEmptyDraftConversation)
        if (existingDraft) {
            setAiConversations((prev) => prev.map((conversation) =>
                conversation.id === existingDraft.id
                    ? {
                        ...conversation,
                        pluginId: selectedPlugin,
                        model: selectedModel,
                        settings: normalizeConversationSettingsWithGlobalPrompt(
                            conversation.settings,
                            conversation.mode,
                            appSettingsRef.current,
                        ),
                    }
                    : conversation,
            ))
            setAiActiveConversationId(existingDraft.id)
            activeConversationIdRef.current = existingDraft.id
            session.activateSession(null, null)
            return
        }

        const draft = createDraftConversation(
            selectedPlugin,
            selectedModel,
            buildDefaultConversationSettings(appSettingsRef.current),
        )
        setAiConversations((prev) => [draft, ...prev])
        setAiActiveConversationId(draft.id)
        activeConversationIdRef.current = draft.id
        session.activateSession(null, null)
    }, [conversationMetaLoaded, pluginsReady, selectedModel, selectedPlugin, session])

    useEffect(() => {
        if (!activeConversationId || !isPendingConversationId(activeConversationId) || !selectedPlugin || !selectedModel) return
        setAiConversations((prev) => prev.map((conversation) => {
            if (conversation.id !== activeConversationId || !isEmptyDraftConversation(conversation)) {
                return conversation
            }
            if (conversation.pluginId === selectedPlugin && conversation.model === selectedModel) {
                return conversation
            }
            return {...conversation, pluginId: selectedPlugin, model: selectedModel}
        }))
    }, [activeConversationId, selectedModel, selectedPlugin])

    useEffect(() => {
        if (!session.sessionId) return
        const settings = activeConversationRef.current?.settings ?? DEFAULT_CONVERSATION_SETTINGS
        void ai_update_session(
            session.sessionId,
            buildSessionUpdateParams(settings, sessionParams.thinking),
        ).catch(logger.error)
    }, [activeConversation?.settings, sessionParams, session.sessionId])

    const discardDraftDocumentContext = useCallback(async (conversationId: string) => {
        const items = documentContextItemsByConversationRef.current[conversationId]
            ?? await docctx_list_items(conversationId).catch((error) => {
                logger.warn('读取待丢弃草稿的文档上下文失败', {conversationId, error})
                return []
            })
        await Promise.all(items.map((item) =>
            docctx_remove_item(item.id).catch((error) => {
                logger.warn('清理待丢弃草稿的文档上下文失败', {
                    conversationId,
                    itemId: item.id,
                    error,
                })
            }),
        ))
        setAiDocumentContextItemsByConversation((current) => {
            if (!current[conversationId]) return current
            const next = {...current}
            delete next[conversationId]
            return next
        })
        setAiPendingDocumentAttachmentIdsByConversation((current) => {
            if (!current[conversationId]) return current
            const next = {...current}
            delete next[conversationId]
            return next
        })
    }, [])

    const createNewConversation = useCallback(async () => {
        if (activeConversationRef.current && isEmptyDraftConversation(activeConversationRef.current)) {
            return
        }
        if (!selectedPlugin || !selectedModel) {
            session.activateSession(null, null)
            setAiActiveConversationId(null)
            activeConversationIdRef.current = null
            setInputValue('')
            setEditingMessageId(null)
            setAutoScroll(true)
            return
        }

        const staleDrafts = conversationsRef.current.filter(isEmptyDraftConversation)
        await Promise.all(staleDrafts.map((conversation) =>
            discardDraftDocumentContext(conversation.id),
        ))
        const draft = createDraftConversation(
            selectedPlugin,
            selectedModel,
            buildDefaultConversationSettings(appSettingsRef.current),
        )
        session.activateSession(null, null)
        setAiConversations((prev) => [
            draft,
            ...prev.filter((conversation) => !isEmptyDraftConversation(conversation)),
        ])
        setAiActiveConversationId(draft.id)
        activeConversationIdRef.current = draft.id
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)
    }, [discardDraftDocumentContext, selectedModel, selectedPlugin, session])

    const startReportDiscussion = useCallback(async ({
                                                         title,
                                                         pluginId,
                                                         model,
                                                         reportContext,
                                                     }: {
        title: string
        pluginId: string
        model: string
        reportContext: ReportConversationContext
    }) => {
        const conversation: Conversation = {
            id: `conv_report_${Date.now()}`,
            title,
            messages: [{
                id: `assistant_report_${Date.now()}`,
                role: 'assistant',
                content: '已载入这份矛盾检测报告。你可以继续追问某条冲突的依据、影响范围，或让我把建议改写成可执行的修订方案。',
                timestamp: Date.now(),
            }],
            pluginId,
            model,
            sessionId: null,
            runId: null,
            timestamp: Date.now(),
            pinnedAt: null,
            archivedAt: null,
            mode: 'report',
            characterEntryId: null,
            characterName: null,
            backgroundImageUrl: null,
            characterVoicePluginId: null,
            characterVoiceModel: null,
            characterVoiceId: null,
            characterAutoPlay: null,
            reportContext,
            reportSeeded: false,
            settings: normalizeConversationSettings(),
        }

        setAiSelectedPluginModel(pluginId, model)
        setAiConversations((prev) => [conversation, ...prev])
        setAiActiveConversationId(conversation.id)
        activeConversationIdRef.current = conversation.id
        session.activateSession(null, null)
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)
    }, [session])

    const startCharacterConversation = useCallback(async ({projectId, entryId}: {
        projectId: string
        entryId: string
    }) => {
        if (!selectedPlugin || !selectedModel) {
            throw new Error('当前 AI 插件或模型尚未准备好，请稍后重试。')
        }

        const built = await ai_build_character_project_snapshot(projectId, entryId)
        if ((built.characterEntry.type ?? '').trim().toLowerCase() !== 'character') {
            throw new Error('当前词条不是角色类型，无法开启角色对话。')
        }

        const created = await session.createCharacterSession(selectedPlugin, selectedModel, {
            characterName: built.characterEntry.title,
            projectSnapshot: built.snapshot,
            maxToolRounds: sessionParams.maxToolRounds,
        })
        if (!created) return

        const conversation: Conversation = {
            id: created.conversationId,
            title: `和「${built.characterEntry.title}」聊天`,
            messages: [],
            pluginId: selectedPlugin,
            model: selectedModel,
            sessionId: created.sessionId,
            runId: created.runId,
            timestamp: Date.now(),
            pinnedAt: null,
            archivedAt: null,
            mode: 'character',
            characterEntryId: entryId,
            characterName: built.characterEntry.title,
            backgroundImageUrl: toEntryImageSrc(built.backgroundImage) ?? null,
            characterVoicePluginId: built.characterVoicePluginId,
            characterVoiceModel: built.characterVoiceModel,
            characterVoiceId: built.characterVoiceId,
            characterAutoPlay: built.characterAutoPlay,
            reportContext: null,
            reportSeeded: false,
            settings: normalizeConversationSettings(),
        }
        setRuntimeConversation(created.sessionId, created.runId, created.conversationId)
        setAiConversations((prev) => [conversation, ...prev.filter((item) => item.id !== conversation.id)])
        setAiActiveConversationId(conversation.id)
        activeConversationIdRef.current = conversation.id
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)
    }, [selectedModel, selectedPlugin, session, sessionParams.maxToolRounds])

    const updateConversationCharacterAutoPlay = useCallback((convId: string, autoPlay: boolean) => {
        setAiConversations((prev) => prev.map((conversation) => (
            conversation.id === convId
                ? {...conversation, characterAutoPlay: autoPlay}
                : conversation
        )))
    }, [])

    const persistConversationSettings = useCallback((
        convId: string,
        settings: ConversationSettings,
        immediate = false,
    ) => {
        if (isPendingConversationId(convId)) return
        const timers = conversationSettingsSaveTimersRef.current
        if (timers[convId]) {
            window.clearTimeout(timers[convId])
            delete timers[convId]
        }

        const save = () => {
            void ai_update_conversation_settings(
                convId,
                toStoredConversationSettings(settings, appSettingsRef.current),
            )
                .then((saved) => {
                    setAiConversations((prev) => prev.map((conversation) =>
                        conversation.id === convId
                            ? {...conversation, settings: normalizeConversationSettings(saved)}
                            : conversation,
                    ))
                })
                .catch((error) => {
                    logger.warn('写入对话独有设置失败', {convId, error})
                })
        }

        if (immediate) {
            save()
            return
        }
        timers[convId] = window.setTimeout(() => {
            delete timers[convId]
            save()
        }, 450)
    }, [])

    const updateConversationSettings = useCallback(async (
        convId: string,
        patch: Partial<ConversationSettings>,
    ) => {
        let nextSettings: ConversationSettings | null = null
        setAiConversations((prev) => prev.map((conversation) => {
            if (conversation.id !== convId) return conversation
            nextSettings = normalizeConversationSettings({
                ...conversation.settings,
                ...patch,
            })
            return {
                ...conversation,
                settings: nextSettings,
            }
        }))
        if (!nextSettings) return

        const current = conversationsRef.current.find((conversation) => conversation.id === convId)
        if (current?.sessionId) {
            void ai_update_session(
                current.sessionId,
                buildSessionUpdateParams(nextSettings, sessionParamsRef.current.thinking),
            ).catch(logger.error)
            if (conversationSettingsPatchAffectsContext(patch)) {
                void resolveContextPayload(
                    focusRef.current.projectId,
                    focusRef.current.entryId,
                    nextSettings,
                )
                    .then((ctx) => ai_set_task_context(current.sessionId!, ctx))
                    .catch(logger.error)
            }
        }
        persistConversationSettings(convId, nextSettings)
    }, [persistConversationSettings, resolveContextPayload])

    const switchActiveConversationModel = useCallback((pluginId: string, model: string) => {
        const previousSwitch = modelSwitchInFlightRef.current ?? Promise.resolve()
        const switchTask = previousSwitch.then(async () => {
            if (!pluginId || !model) return

            const conversationSnapshot = getAiConversationSnapshot()
            const conv = conversationSnapshot.conversations.find(
                (conversation) => conversation.id === conversationSnapshot.activeConversationId,
            )
            if (!conv) {
                setAiSelectedPluginModel(pluginId, model)
                return
            }
            if (conv.pluginId === pluginId && conv.model === model) {
                setAiSelectedPluginModel(pluginId, model)
                return
            }
            if (conv.runId && session.isRunStreaming(conv.runId)) return

            const liveRuntime = conv.sessionId && conv.runId
                ? {sessionId: conv.sessionId, runId: conv.runId}
                : null
            if (liveRuntime) {
                try {
                    if (conv.pluginId !== pluginId) {
                        await ai_switch_plugin(liveRuntime.sessionId, pluginId)
                    }
                    if (conv.model !== model) {
                        await ai_update_session(liveRuntime.sessionId, {model})
                    }
                } catch (error) {
                    logger.error('[useAiController] 切换当前会话模型失败', error)
                    return
                }
            }

            const switchModel = (conversation: Conversation) =>
                applyConversationModelSwitch(
                    conversation,
                    conv.id,
                    pluginId,
                    model,
                    liveRuntime ?? undefined,
                )
            const latestSnapshot = getAiConversationSnapshot()
            const nextConversations = latestSnapshot.conversations.map(switchModel)
            conversationsRef.current = nextConversations
            setAiConversations(nextConversations)
            if (latestSnapshot.activeConversationId === conv.id) {
                activeConversationRef.current = nextConversations.find(
                    (conversation) => conversation.id === conv.id,
                )
                setAiSelectedPluginModel(pluginId, model)
                session.activateSession(liveRuntime?.sessionId ?? null, liveRuntime?.runId ?? null)
            }
            if (!liveRuntime && conv.sessionId) {
                await session.closeSession(conv.sessionId)
            }
        })
        modelSwitchInFlightRef.current = switchTask
        const clearSwitchTask = () => {
            if (modelSwitchInFlightRef.current === switchTask) {
                modelSwitchInFlightRef.current = null
            }
        }
        void switchTask.then(clearSwitchTask, clearSwitchTask)
        return switchTask
    }, [session])

    useEffect(() => () => {
        Object.values(conversationSettingsSaveTimersRef.current).forEach((timer) => {
            window.clearTimeout(timer)
        })
        conversationSettingsSaveTimersRef.current = {}
    }, [])

    const switchConversation = useCallback(async (convId: string) => {
        const targetConv = conversationsRef.current.find((conversation) => conversation.id === convId)
        const alreadyActive = convId === activeConversationIdRef.current
        const needsStoredMessages = Boolean(
            targetConv
            && targetConv.messages.length === 0
            && !isPendingConversationId(targetConv.id),
        )
        if (alreadyActive && !needsStoredMessages) return

        if (!alreadyActive) {
            setAiActiveConversationId(convId)
            activeConversationIdRef.current = convId
            setAiUnreadConversationIds((prev) => {
                if (!prev[convId]) return prev
                const next = {...prev}
                delete next[convId]
                return next
            })
            setInputValue('')
            setEditingMessageId(null)
            setAutoScroll(true)
        }

        if (targetConv) {
            session.activateSession(targetConv.sessionId, targetConv.runId)
            setAiSelectedPluginModel(targetConv.pluginId, targetConv.model)

            if (needsStoredMessages) {
                const stored = await ai_get_conversation(targetConv.id).catch((error) => {
                    logger.error('[useAiController] 恢复会话消息失败', error)
                    return null
                })
                if (stored) {
                    setAiConversations((prev) => prev.map((conversation) =>
                        conversation.id === convId
                            ? {
                                ...conversation,
                                messages: storedToMessages(stored.messages),
                                settings: normalizeConversationSettingsWithGlobalPrompt(
                                    stored.settings,
                                    conversation.mode,
                                    appSettingsRef.current,
                                ),
                            }
                            : conversation,
                    ))
                }
            }
        }
    }, [session])

    const deleteConversation = useCallback(async (convId: string, event?: MouseEvent) => {
        event?.stopPropagation()
        const conv = conversationsRef.current.find((conversation) => conversation.id === convId)

        if (conv?.sessionId) {
            await session.closeSession(conv.sessionId)
        }
        if (conv && !isPendingConversationId(conv.id)) {
            await ai_delete_conversation(conv.id).catch(logger.error)
        }

        setAiConversations((prev) => prev.filter((conversation) => conversation.id !== convId))
        setAiUnreadConversationIds((prev) => {
            if (!prev[convId]) return prev
            const next = {...prev}
            delete next[convId]
            return next
        })
        deleteRuntimeConversationsById(convId)

        if (activeConversationIdRef.current === convId) {
            session.activateSession(null, null)
            setAiActiveConversationId(null)
            activeConversationIdRef.current = null
            setInputValue('')
            setEditingMessageId(null)
            setAutoScroll(true)
        }
    }, [session])

    const renameConversation = useCallback(async (convId: string, title: string) => {
        const trimmed = title.trim()
        if (!trimmed) return
        setAiConversations((prev) => prev.map((conversation) =>
            conversation.id === convId ? {...conversation, title: trimmed} : conversation,
        ))
        await ai_rename_conversation(convId, trimmed).catch(logger.error)
    }, [])

    const toggleConversationPinned = useCallback((convId: string, event?: MouseEvent) => {
        event?.stopPropagation()
        setAiConversations((prev) => prev.map((conversation) =>
            conversation.id === convId
                ? {...conversation, pinnedAt: conversation.pinnedAt ? null : new Date().toISOString()}
                : conversation,
        ))
    }, [])

    const toggleConversationArchived = useCallback((convId: string, event?: MouseEvent) => {
        event?.stopPropagation()
        const nextArchivedAt = conversationsRef.current.find((conversation) => conversation.id === convId)?.archivedAt
            ? null
            : new Date().toISOString()
        setAiConversations((prev) => prev.map((conversation) =>
            conversation.id === convId
                ? {...conversation, archivedAt: nextArchivedAt}
                : conversation,
        ))
        if (activeConversationIdRef.current === convId && nextArchivedAt) {
            setInputValue('')
            setEditingMessageId(null)
        }
    }, [])

    const addDocumentContextFiles = useCallback(async (filePaths: string[]) => {
        const conversationId = activeConversationIdRef.current
        if (!conversationId || filePaths.length === 0) return
        const items = await docctx_add_files(conversationId, filePaths)
        setAiDocumentContextItemsByConversation((current) =>
            mergeDocumentContextItems(current, items),
        )
        setAiPendingDocumentAttachmentIdsByConversation((current) => {
            const existing = current[conversationId] ?? []
            const nextIds = items.map((item) => item.id)
            const merged = [...existing]
            nextIds.forEach((itemId) => {
                if (!merged.includes(itemId)) merged.push(itemId)
            })
            return {
                ...current,
                [conversationId]: merged,
            }
        })
    }, [])

    const removeDocumentContextItem = useCallback(async (itemId: string) => {
        await docctx_remove_item(itemId)
        setAiDocumentContextItemsByConversation((current) => {
            const next = {...current}
            Object.entries(next).forEach(([conversationId, items]) => {
                const filtered = items.filter((item) => item.id !== itemId)
                if (filtered.length === items.length) return
                if (filtered.length === 0) {
                    delete next[conversationId]
                } else {
                    next[conversationId] = filtered
                }
            })
            return next
        })
        setAiPendingDocumentAttachmentIdsByConversation((current) => {
            let changed = false
            const next = {...current}
            Object.entries(next).forEach(([conversationId, itemIds]) => {
                const filtered = itemIds.filter((id) => id !== itemId)
                if (filtered.length === itemIds.length) return
                changed = true
                if (filtered.length === 0) {
                    delete next[conversationId]
                } else {
                    next[conversationId] = filtered
                }
            })
            return changed ? next : current
        })
    }, [])

    const retryDocumentContextItem = useCallback(async (itemId: string) => {
        const item = await docctx_retry_item(itemId)
        setAiDocumentContextItemsByConversation((current) =>
            mergeDocumentContextItems(current, [item]),
        )
    }, [])

    const sendMessage = useCallback(async (content: string) => {
        const trimmed = content.trim()
        if (!trimmed) return
        // 用户点击发送即冻结页面焦点；后续会话创建、文档检索或页面切换不能改绑本轮引用。
        const submissionFocus = {...focusRef.current}
        await modelSwitchInFlightRef.current

        const traceId = createAiTraceId()
        const activeConv = activeConversationRef.current ?? null
        if (activeConv?.archivedAt) return
        logger.log('[useAiController][发送链路] 用户触发发送', {
            traceId,
            activeConversationId: activeConv?.id ?? null,
            hasSession: Boolean(activeConv?.sessionId),
            sessionId: activeConv?.sessionId ?? null,
            runId: activeConv?.runId ?? null,
            pluginId: activeConv?.pluginId ?? selectedPlugin,
            model: activeConv?.model ?? selectedModel,
            messageLength: trimmed.length,
            messageChars: [...trimmed].length,
            messagePreview: buildAiLogPreview(trimmed),
        })
        if (activeConv?.runId && session.isRunStreaming(activeConv.runId)) return

        const draftConversation: Conversation | null = activeConv
            ? null
            : createDraftConversation(
                selectedPlugin,
                selectedModel,
                buildDefaultConversationSettings(appSettingsRef.current),
            )
        const currentConv = activeConv ?? draftConversation
        if (!currentConv) return
        const currentConvId = currentConv.id
        const currentSettings = normalizeConversationSettings(currentConv.settings)
        const syncPreparedSessionContext = async (
            target: PreparedAiSession,
            documentAttachmentItemIds: string[] = [],
            query?: string,
        ): Promise<TaskContextPayload> => {
            try {
                await ai_update_session(
                    target.sid,
                    buildSessionUpdateParams(currentSettings, sessionParamsRef.current.thinking),
                )
            } catch (error) {
                logger.warn('[useAiController][发送链路] 同步对话模型参数失败，继续构建上下文', {
                    traceId,
                    sessionId: target.sid,
                    error,
                })
            }
            const ctx = await resolveContextPayload(
                submissionFocus.projectId,
                submissionFocus.entryId,
                currentSettings,
            )
            const enrichedCtx = await appendDocumentContext(
                ctx,
                target.conversationId,
                documentAttachmentItemIds,
                query,
            )
            await ai_set_task_context(target.sid, enrichedCtx).catch((error) => {
                logger.warn('[useAiController][发送链路] 预检上下文同步失败，提交时仍携带同一快照', {
                    traceId,
                    sessionId: target.sid,
                    error,
                })
            })
            return enrichedCtx
        }
        const recreateMissingSession = async (failedSession: PreparedAiSession): Promise<PreparedAiSession | null> => {
            logger.warn('[useAiController][发送链路] 后端会话不存在，准备重建后继续发送', {
                traceId,
                conversationId: failedSession.conversationId,
                sessionId: failedSession.sid,
                runId: failedSession.runId,
            })

            deleteRuntimeConversation(failedSession.sid, failedSession.runId)
            session.activateSession(null, null)
            setAiConversations((prev) => prev.map((conversation) =>
                conversation.id === failedSession.conversationId
                    ? {...conversation, sessionId: null, runId: null}
                    : conversation,
            ))

            const isPending = isPendingConversationId(failedSession.conversationId)
            const created = await session.createSession(
                currentConv.pluginId || selectedPlugin,
                currentConv.model || selectedModel,
                isPending ? undefined : failedSession.conversationId,
                sessionParams.maxToolRounds,
                traceId,
                toStoredConversationSettings(currentSettings, appSettingsRef.current),
                {
                    toolAccess: toolAccessMode,
                    webSearchEnabled,
                },
            )
            if (!created) return null

            const nextConversationId = isPending ? created.conversationId : failedSession.conversationId
            if (isPending && nextConversationId !== failedSession.conversationId) {
                await migrateDocumentContextConversation(failedSession.conversationId, nextConversationId)
            }
            setRuntimeConversation(created.sessionId, created.runId, nextConversationId)
            setAiConversations((prev) => prev.map((conversation) =>
                conversation.id === failedSession.conversationId
                    ? {
                        ...conversation,
                        id: nextConversationId,
                        sessionId: created.sessionId,
                        runId: created.runId,
                    }
                    : conversation,
            ))
            if (activeConversationIdRef.current === failedSession.conversationId) {
                setAiActiveConversationId(nextConversationId)
                activeConversationIdRef.current = nextConversationId
            }

            logger.log('[useAiController][发送链路] 后端会话重建完成', {
                traceId,
                previousSessionId: failedSession.sid,
                sessionId: created.sessionId,
                runId: created.runId,
                conversationId: nextConversationId,
            })
            return {sid: created.sessionId, runId: created.runId, conversationId: nextConversationId}
        }

        if (draftConversation) {
            logger.log('[useAiController][发送链路] 当前没有激活对话，创建前端草稿对话', {
                traceId,
                draftConversationId: draftConversation.id,
                pluginId: selectedPlugin,
                model: selectedModel,
            })
            setAiConversations((prev) => [draftConversation, ...prev])
            setAiActiveConversationId(draftConversation.id)
            activeConversationIdRef.current = draftConversation.id
            session.activateSession(null, null)
            setAutoScroll(true)
        }

        setAiAbortController(new AbortController())

        let sessionClosedForEdit = false
        let messagesBeforeNewUser = currentConv.messages

        if (editingMessageId) {
            const editIdx = currentConv.messages.findIndex((message) => message.id === editingMessageId)
            if (editIdx !== -1) {
                messagesBeforeNewUser = currentConv.messages.slice(0, editIdx)
                setAiConversations((prev) => prev.map((conversation) =>
                    conversation.id === currentConvId
                        ? {...conversation, messages: conversation.messages.slice(0, editIdx)}
                        : conversation,
                ))
                const precedingMsg = editIdx > 0 ? currentConv.messages[editIdx - 1] : null
                if (precedingMsg?.nodeId && currentConv.sessionId && currentConv.runId) {
                    session.activateSession(currentConv.sessionId, currentConv.runId)
                    await session.checkoutForEdit(precedingMsg.nodeId, currentConv.sessionId, currentConv.runId)
                } else if (currentConv.sessionId) {
                    await session.closeSession(currentConv.sessionId)
                    sessionClosedForEdit = true
                    setAiConversations((prev) => prev.map((conversation) =>
                        conversation.id === currentConvId
                            ? {...conversation, sessionId: null, runId: null}
                            : conversation,
                    ))
                }
            }
            setEditingMessageId(null)
        }

        const documentAttachmentItemIdsForSend = mergeDocumentAttachmentItemIds(
            collectDocumentAttachmentItemIds(messagesBeforeNewUser),
            pendingDocumentAttachmentIdsByConversationRef.current[currentConvId],
        )
        const actualPrompt = currentConv.mode === 'report'
        && !currentConv.reportSeeded
        && currentConv.reportContext
            ? buildReportBootstrapPrompt(currentConv.reportContext, trimmed)
            : trimmed
        const existingSid = sessionClosedForEdit ? null : currentConv.sessionId
        const existingRunId = sessionClosedForEdit ? null : currentConv.runId
        let preparedSession = await (async (): Promise<PreparedAiSession | null> => {
            if (existingSid && existingRunId) {
                logger.log('[useAiController][发送链路] 复用当前对话已有后端会话', {
                    traceId,
                    conversationId: currentConvId,
                    sessionId: existingSid,
                    runId: existingRunId,
                })
                session.activateSession(existingSid, existingRunId)
                setRuntimeConversation(existingSid, existingRunId, currentConvId)
                return {sid: existingSid, runId: existingRunId, conversationId: currentConvId}
            }

            logger.log('[useAiController][发送链路] 开始同步工具状态', {
                traceId,
                conversationId: currentConvId,
                toolCount: tools.length,
            })
            await new Promise<void>((resolve) => {
                setTools((latest) => {
                    Promise.all(
                        latest.map(async (tool) => {
                            try {
                                if (tool.enabled) {
                                    await ai_enable_tool(tool.name)
                                } else {
                                    await ai_disable_tool(tool.name)
                                }
                            } catch (error) {
                                logger.warn('[useAiController][发送链路] 工具状态同步单项失败', {
                                    traceId,
                                    toolName: tool.name,
                                    enabled: tool.enabled,
                                    error,
                                })
                            }
                        }),
                    ).finally(resolve)
                    return latest
                })
            })
            logger.log('[useAiController][发送链路] 工具状态同步完成，准备创建后端会话', {
                traceId,
                conversationId: currentConvId,
            })

            const isPending = isPendingConversationId(currentConvId)
            const desiredSessionId = isPending ? undefined : currentConvId
            const created = await session.createSession(
                selectedPlugin,
                selectedModel,
                desiredSessionId,
                sessionParams.maxToolRounds,
                traceId,
                toStoredConversationSettings(currentSettings, appSettingsRef.current),
                {
                    toolAccess: toolAccessMode,
                    webSearchEnabled,
                },
            )
            if (!created) return null
            logger.log('[useAiController][发送链路] 后端会话创建完成', {
                traceId,
                requestedConversationId: desiredSessionId ?? null,
                resolvedConversationId: created.conversationId,
                sessionId: created.sessionId,
                runId: created.runId,
            })

            // 立即同步本对话参数，避免首轮对话使用旧默认值
            await ai_update_session(
                created.sessionId,
                buildSessionUpdateParams(currentSettings, sessionParamsRef.current.thinking),
            ).then(() => {
                logger.log('[useAiController][发送链路] 会话参数同步完成', {
                    traceId,
                    sessionId: created.sessionId,
                    thinking: sessionParamsRef.current.thinking,
                })
            }).catch((error) => {
                logger.warn('[useAiController][发送链路] 会话参数同步失败', {
                    traceId,
                    sessionId: created.sessionId,
                    error,
                })
            })

            const nextConversationId = isPending ? created.conversationId : currentConvId
            if (isPending && nextConversationId !== currentConvId) {
                await migrateDocumentContextConversation(currentConvId, nextConversationId)
            }

            // 兜底推送：session 刚建立时 effect 可能尚未触发，确保首轮 assemble 有上下文
            try {
                const ctx = await resolveContextPayload(
                    submissionFocus.projectId,
                    submissionFocus.entryId,
                    currentSettings,
                )
                const enrichedCtx = await appendDocumentContext(
                    ctx,
                    nextConversationId,
                    documentAttachmentItemIdsForSend,
                    actualPrompt,
                )
                logger.log('[useAiController][发送链路] 准备推送任务上下文', {
                    traceId,
                    sessionId: created.sessionId,
                    projectId: enrichedCtx.attributes?.project_id ?? null,
                    entryId: enrichedCtx.attributes?.entry_id ?? null,
                    hasDocumentContext: Boolean(enrichedCtx.attributes?.[DOCUMENT_CONTEXT_ATTRIBUTE]),
                    readOnly: enrichedCtx.flags?.read_only ?? null,
                })
                await ai_set_task_context(created.sessionId, enrichedCtx)
                logger.log('[useAiController][发送链路] 任务上下文推送完成', {
                    traceId,
                    sessionId: created.sessionId,
                })
            } catch (error) {
                logger.warn('[useAiController][发送链路] 任务上下文推送失败，继续发送消息', {
                    traceId,
                    sessionId: created.sessionId,
                    error,
                })
            }

            setRuntimeConversation(created.sessionId, created.runId, nextConversationId)

            if (isPending) {
                setAiConversations((prev) => prev.map((conversation) =>
                    conversation.id === currentConvId
                        ? {...conversation, id: created.conversationId, sessionId: created.sessionId, runId: created.runId}
                        : conversation,
                ))
                setAiActiveConversationId(created.conversationId)
                activeConversationIdRef.current = created.conversationId
            } else {
                setAiConversations((prev) => prev.map((conversation) =>
                    conversation.id === currentConvId
                        ? {...conversation, sessionId: created.sessionId, runId: created.runId}
                        : conversation,
                ))
            }

            return {sid: created.sessionId, runId: created.runId, conversationId: nextConversationId}
        })()
        if (!preparedSession) return

        let submissionContext = await syncPreparedSessionContext(
            preparedSession,
            documentAttachmentItemIdsForSend,
            actualPrompt,
        )
        const requestPreflight = await ai_preflight_request(preparedSession.sid, actualPrompt)
            .catch((error) => {
                logger.warn('[useAiController][自动压缩] 有效请求预检失败，交由核心预算保护', {
                    traceId,
                    sessionId: preparedSession?.sid ?? null,
                    error,
                })
                return null
            })
        const compactApplied = await maybeAutoCompactBeforeSend(
            currentConv,
            messagesBeforeNewUser,
            actualPrompt,
            false,
            requestPreflight,
            preparedSession,
        )
        if (compactApplied) {
            const recreatedSession = await recreateMissingSession(preparedSession)
            if (!recreatedSession) return
            preparedSession = recreatedSession
            submissionContext = await syncPreparedSessionContext(
                preparedSession,
                documentAttachmentItemIdsForSend,
                actualPrompt,
            )
        }

        const pendingAttachmentIds =
            pendingDocumentAttachmentIdsByConversationRef.current[preparedSession.conversationId]
            ?? pendingDocumentAttachmentIdsByConversationRef.current[currentConvId]
            ?? []
        const pendingItems =
            documentContextItemsByConversationRef.current[preparedSession.conversationId]
            ?? documentContextItemsByConversationRef.current[currentConvId]
            ?? []
        const pendingItemsById = new Map(pendingItems.map((item) => [item.id, item]))
        const userAttachments = pendingAttachmentIds
            .map((itemId) => pendingItemsById.get(itemId))
            .filter((item): item is DocumentContextItem => Boolean(item))
            .map(documentItemToAttachment)

        const userMessage: Message = {
            id: `u_${Date.now()}`,
            role: 'user',
            content: trimmed,
            timestamp: Date.now(),
            attachments: userAttachments.length > 0 ? userAttachments : undefined,
        }

        setAiConversations((prev) => prev.map((conversation) => {
            if (conversation.id !== preparedSession.conversationId) return conversation
            const isFirstMessage = conversation.messages.length === 0
            return {
                ...conversation,
                title: isFirstMessage && conversation.mode !== 'character' && conversation.mode !== 'report'
                    ? generateTitleFromMessage(trimmed)
                    : conversation.title,
                messages: [...conversation.messages, userMessage],
                reportSeeded: conversation.mode === 'report' ? true : conversation.reportSeeded,
            }
        }))

        setInputValue('')
        if (pendingAttachmentIds.length > 0) {
            setAiPendingDocumentAttachmentIdsByConversation((current) => {
                const next = {...current}
                delete next[currentConvId]
                delete next[preparedSession.conversationId]
                return next
            })
        }
        logger.log('[useAiController][发送链路] 用户消息已写入前端状态，准备进入 session 发送', {
            traceId,
            conversationId: preparedSession.conversationId,
            sessionId: preparedSession.sid,
            runId: preparedSession.runId,
            actualPromptLength: actualPrompt.length,
            isReportBootstrap: actualPrompt !== trimmed,
        })
        try {
            await session.sendMessage(
                actualPrompt,
                preparedSession.sid,
                preparedSession.runId,
                traceId,
                submissionContext,
            )
        } catch (error) {
            if (!isMissingBackendSessionError(error)) {
                logger.error('[useAiController][发送链路] 发送失败且无法自动恢复', {
                    traceId,
                    sessionId: preparedSession.sid,
                    runId: preparedSession.runId,
                    error,
                })
                onError({
                    sessionId: preparedSession.sid,
                    runId: preparedSession.runId,
                    error: toApiError(error),
                    content: '',
                    fatal: false,
                })
                return
            }

            const recoveredSession = await recreateMissingSession(preparedSession)
            if (!recoveredSession) return
            submissionContext = await syncPreparedSessionContext(
                recoveredSession,
                documentAttachmentItemIdsForSend,
                actualPrompt,
            )
            logger.log('[useAiController][发送链路] 会话重建后重试发送', {
                traceId,
                conversationId: recoveredSession.conversationId,
                sessionId: recoveredSession.sid,
                runId: recoveredSession.runId,
            })
            try {
                await session.sendMessage(
                    actualPrompt,
                    recoveredSession.sid,
                    recoveredSession.runId,
                    traceId,
                    submissionContext,
                )
            } catch (retryError) {
                logger.error('[useAiController][发送链路] 会话重建后重试仍失败', {
                    traceId,
                    sessionId: recoveredSession.sid,
                    runId: recoveredSession.runId,
                    error: retryError,
                })
                onError({
                    sessionId: recoveredSession.sid,
                    runId: recoveredSession.runId,
                    error: toApiError(retryError),
                    content: '',
                    fatal: true,
                })
            }
        }
    }, [
        editingMessageId,
        selectedModel,
        selectedPlugin,
        session,
        resolveContextPayload,
        appendDocumentContext,
        migrateDocumentContextConversation,
        sessionParams.maxToolRounds,
        tools.length,
        toolAccessMode,
        webSearchEnabled,
        onError,
        maybeAutoCompactBeforeSend,
    ])

    const stopStreaming = useCallback(() => {
        abortAiStreamingController()
        const conv = activeConversationRef.current
        void session.cancelSession(conv?.sessionId)
    }, [session])

    const continueMessage = useCallback(async (messageId: string) => {
        const conversation = conversationsRef.current.find(
            item => item.id === activeConversationIdRef.current,
        )
        const message = conversation?.messages.find(item => item.id === messageId)
        if (
            !conversation
            || message?.role !== 'assistant'
            || message.nodeId == null
            || !isIncompleteMessage(message)
        ) return
        const nodeId = message.nodeId
        if (conversation.runId && session.isRunStreaming(conversation.runId)) return
        const submissionKey = `${conversation.id}:${nodeId}`
        if (continuationSubmittingRef.current.has(submissionKey)) return
        continuationSubmittingRef.current.add(submissionKey)
        setContinuationSubmittingMessageId(messageId)
        const finishSubmission = () => {
            continuationSubmittingRef.current.delete(submissionKey)
            setContinuationSubmittingMessageId(current => current === messageId ? null : current)
        }
        const traceId = createAiTraceId()
        const settings = normalizeConversationSettings(conversation.settings)
        const documentAttachmentItemIds = collectDocumentAttachmentItemIdsUntilMessage(
            conversation.messages,
            message.id,
        )
        const createBackendSession = async (): Promise<PreparedAiSession | null> => {
            const created = await session.createSession(
                conversation.pluginId,
                conversation.model,
                conversation.id,
                sessionParams.maxToolRounds,
                traceId,
                toStoredConversationSettings(settings, appSettingsRef.current),
                {toolAccess: toolAccessMode, webSearchEnabled},
            )
            if (!created) return null
            setRuntimeConversation(created.sessionId, created.runId, conversation.id)
            setAiConversations(prev => prev.map(item => item.id === conversation.id
                ? {...item, sessionId: created.sessionId, runId: created.runId}
                : item,
            ))
            return {sid: created.sessionId, runId: created.runId, conversationId: conversation.id}
        }
        const syncContext = async (target: PreparedAiSession) => {
            try {
                await ai_update_session(
                    target.sid,
                    buildSessionUpdateParams(settings, sessionParamsRef.current.thinking),
                )
                const context = await resolveContextPayload(
                    focusRef.current.projectId,
                    focusRef.current.entryId,
                    settings,
                )
                await ai_set_task_context(
                    target.sid,
                    await appendDocumentContext(
                        context,
                        conversation.id,
                        documentAttachmentItemIds,
                    ),
                )
            } catch (error) {
                logger.warn('[useAiController][继续生成] 同步上下文失败，继续使用已恢复的历史', {
                    traceId,
                    sessionId: target.sid,
                    error,
                })
            }
        }
        const reportFailure = (error: unknown, target: PreparedAiSession) => onError({
            sessionId: target.sid,
            runId: target.runId,
            error: toApiError(error),
            content: '',
            turnStatus: 'error',
            continuationOfNodeId: nodeId,
            fatal: false,
        })

        try {
            let target = conversation.sessionId && conversation.runId
                ? {sid: conversation.sessionId, runId: conversation.runId, conversationId: conversation.id}
                : await createBackendSession()
            if (!target) {
                return
            }
            session.activateSession(target.sid, target.runId)
            setRuntimeConversation(target.sid, target.runId, conversation.id)
            await syncContext(target)
            setAutoScroll(true)

            try {
                await session.continueGeneration(nodeId, target.sid, target.runId, traceId)
            } catch (error) {
                if (!isMissingBackendSessionError(error)) {
                    reportFailure(error, target)
                    return
                }

                deleteRuntimeConversation(target.sid, target.runId)
                session.activateSession(null, null)
                setAiConversations(prev => prev.map(item => item.id === conversation.id
                    ? {...item, sessionId: null, runId: null}
                    : item,
                ))
                target = await createBackendSession()
                if (!target) return
                await syncContext(target)
                try {
                    await session.continueGeneration(nodeId, target.sid, target.runId, traceId)
                } catch (retryError) {
                    reportFailure(retryError, target)
                }
            }
        } finally {
            finishSubmission()
        }
    }, [
        appendDocumentContext,
        onError,
        resolveContextPayload,
        session,
        sessionParams.maxToolRounds,
        toolAccessMode,
        webSearchEnabled,
    ])

    const regenerateMessage = useCallback(async (messageId: string) => {
        logger.log('[useAiController] 进入重说', {
            messageId,
            activeConversationId: activeConversationIdRef.current,
            sessionId: session.sessionId,
            isStreaming: session.isStreaming,
        })
        const conv = conversationsRef.current.find((conversation) => conversation.id === activeConversationIdRef.current)
        if (!conv) {
            logger.warn('[useAiController] 重说被阻止：未找到对话')
            return
        }

        if (conv.runId && session.isRunStreaming(conv.runId)) {
            logger.warn('[useAiController] 重说被阻止：当前仍在流式输出中，尝试取消后重试', {
                isStreaming: session.isRunStreaming(conv.runId),
                blocksLen: session.blocks.length,
                sessionId: conv.sessionId,
            })
            await session.cancelSession(conv.sessionId)
            await new Promise(resolve => setTimeout(resolve, 100))
            if (session.isRunStreaming(conv.runId)) {
                logger.error('[useAiController] 重说失败：取消后仍处于流式状态，无法继续')
                return
            }
        }

        const messageIndex = conv.messages.findIndex((message) => message.id === messageId)
        if (messageIndex === -1) {
            logger.warn('[useAiController] 重说被阻止：未找到目标消息', {
                messageId,
                convMessageIds: conv.messages.map(m => m.id),
            })
            return
        }

        const precedingUserMsg = conv.messages
            .slice(0, messageIndex)
            .reverse()
            .find((message) => message.role === 'user')
        if (!precedingUserMsg?.nodeId) {
            logger.warn('[useAiController] 重说失败：上一条用户消息缺少 nodeId', {
                conversationId: conv.id,
                sessionId: conv.sessionId,
                targetMessageId: messageId,
                precedingUserMessageId: precedingUserMsg?.id ?? null,
                currentLastUserNodeId: session.lastUserNodeId,
            })
            return
        }
        const documentAttachmentItemIds = collectDocumentAttachmentItemIdsUntilMessage(
            conv.messages,
            precedingUserMsg.id,
        )

        const convSettings = normalizeConversationSettings(conv.settings)
        let currentSid = conv.sessionId
        let currentRunId = conv.runId
        if (currentSid && currentRunId) {
            session.activateSession(currentSid, currentRunId)
            setRuntimeConversation(currentSid, currentRunId, conv.id)
        }

        if (!currentSid || !currentRunId) {
            const created = await session.createSession(
                conv.pluginId,
                conv.model,
                conv.id,
                sessionParams.maxToolRounds,
                undefined,
                toStoredConversationSettings(convSettings, appSettingsRef.current),
                {
                    toolAccess: toolAccessMode,
                    webSearchEnabled,
                },
            )
            if (!created) {
                logger.error('[useAiController] 重说失败：无法创建会话')
                return
            }
            currentSid = created.sessionId
            currentRunId = created.runId
            setRuntimeConversation(created.sessionId, created.runId, conv.id)
            setAiConversations((prev) => prev.map((c) =>
                c.id === conv.id ? {...c, sessionId: created.sessionId, runId: created.runId} : c,
            ))

            // 兜底推送上下文，确保 checkout 触发的首轮 assemble 有上下文
            try {
                await ai_update_session(
                    currentSid!,
                    buildSessionUpdateParams(convSettings, sessionParamsRef.current.thinking),
                )
                const ctx = await resolveContextPayload(
                    focusRef.current.projectId,
                    focusRef.current.entryId,
                    convSettings,
                )
                const enrichedCtx = await appendDocumentContext(ctx, conv.id, documentAttachmentItemIds)
                await ai_set_task_context(currentSid!, enrichedCtx)
            } catch {
                // 上下文推送失败不阻塞 checkout
            }
        } else {
            try {
                await ai_update_session(
                    currentSid,
                    buildSessionUpdateParams(convSettings, sessionParamsRef.current.thinking),
                )
                const ctx = await resolveContextPayload(
                    focusRef.current.projectId,
                    focusRef.current.entryId,
                    convSettings,
                )
                const enrichedCtx = await appendDocumentContext(ctx, conv.id, documentAttachmentItemIds)
                await ai_set_task_context(currentSid, enrichedCtx)
            } catch {
                // 上下文推送失败不阻塞 checkout
            }
        }

        setAiConversations((prev) => prev.map((conversation) =>
            conversation.id === activeConversationIdRef.current
                ? {...conversation, messages: conversation.messages.slice(0, messageIndex)}
                : conversation,
        ))
        setAutoScroll(true)
        await session.checkout(precedingUserMsg.nodeId, currentSid, currentRunId)
    }, [
        session,
        sessionParams.maxToolRounds,
        resolveContextPayload,
        appendDocumentContext,
        toolAccessMode,
        webSearchEnabled,
    ])

    const compactAndRetryMessage = useCallback(async (messageId: string) => {
        const conversation = conversationsRef.current.find(
            item => item.id === activeConversationIdRef.current,
        )
        const messageIndex = conversation?.messages.findIndex(item => item.id === messageId) ?? -1
        const target = messageIndex >= 0 ? conversation?.messages[messageIndex] : null
        if (
            !conversation
            || messageIndex < 0
            || target?.error?.code !== ErrorCode.ContextBudgetExceeded
        ) return

        const compacted = await maybeAutoCompactBeforeSend(
            conversation,
            conversation.messages.slice(0, messageIndex),
            '',
            true,
        )
        if (compacted) await regenerateMessage(messageId)
    }, [maybeAutoCompactBeforeSend, regenerateMessage])

    const editMessage = useCallback((messageId: string) => {
        const conv = conversations.find((conversation) => conversation.id === activeConversationIdRef.current)
        const message = conv?.messages.find((item) => item.id === messageId)
        if (!message || message.role !== 'user') return
        setInputValue(message.content)
        setEditingMessageId(messageId)
    }, [conversations])

    const resetActiveBackendSessionForToolAccess = useCallback(async () => {
        const conversationId = activeConversationIdRef.current
        const conv = conversationsRef.current.find((conversation) => conversation.id === conversationId)
        if (!conv?.sessionId) return
        if (conv.runId && session.isRunStreaming(conv.runId)) return

        await session.closeSession(conv.sessionId)
        setAiConversations((prev) => prev.map((conversation) =>
            conversation.id === conversationId
                ? {...conversation, sessionId: null, runId: null}
                : conversation,
        ))
    }, [session])

    useEffect(() => {
        const handleSettingsUpdated = () => {
            const nextSettings = getAppSettingsSnapshot().settings
            if (!nextSettings) return
            appSettingsRef.current = nextSettings
            const writerEnabled = Boolean(nextSettings.llm?.writer_mode_enabled)
            setAiWriterModeAvailable(writerEnabled)
            if (!writerEnabled && toolAccessMode === 'writer') {
                setToolAccessModeState((current) => current === 'writer' ? 'assistant' : current)
                setTools((current) => current.map((tool) => ({
                    ...tool,
                    enabled: isToolEnabledForAccessMode(tool.name, 'assistant', webSearchEnabled),
                })))
                void resetActiveBackendSessionForToolAccess()
            }
        }
        return subscribeAppSettings(handleSettingsUpdated)
    }, [resetActiveBackendSessionForToolAccess, toolAccessMode, webSearchEnabled])

    const toggleWebSearch = useCallback(async () => {
        const next = !webSearchEnabled
        setTools((prev) => prev.map((tool) => WEB_TOOL_NAMES.includes(tool.name) ? {...tool, enabled: next} : tool))
        setWebSearchEnabled(next)
        await resetActiveBackendSessionForToolAccess()
        if (!session.sessionId) {
            const ops = tools
                .filter((tool) => WEB_TOOL_NAMES.includes(tool.name))
                .map((tool) => next ? ai_enable_tool(tool.name) : ai_disable_tool(tool.name))
            await Promise.all(ops).catch(logger.error)
        }
    }, [resetActiveBackendSessionForToolAccess, session.sessionId, tools, webSearchEnabled])

    const setToolAccessMode = useCallback(async (mode: AiToolAccessMode) => {
        const nextMode = mode === 'writer' && !writerModeAvailable ? 'assistant' : mode
        setTools((prev) => prev.map((tool) => ({
            ...tool,
            enabled: isToolEnabledForAccessMode(tool.name, nextMode, webSearchEnabled),
        })))
        setToolAccessModeState(nextMode)
        await resetActiveBackendSessionForToolAccess()
    }, [resetActiveBackendSessionForToolAccess, webSearchEnabled, writerModeAvailable])

    const toggleEditMode = useCallback(async () => {
        await setToolAccessMode(toolAccessMode === 'reader' ? 'assistant' : 'reader')
    }, [setToolAccessMode, toolAccessMode])

    return useMemo(() => ({
        plugins,
        pluginsReady,
        selectedPlugin,
        selectedModel,
        setSelectedPlugin: setAiSelectedPlugin,
        setSelectedModel: setAiSelectedModel,
        conversations: historyConversations,
        activeConversationId,
        setActiveConversationId: selectConversation,
        messages,
        completedAssistantTurn,
        documentContextItems,
        pendingDocumentAttachmentItems,
        addDocumentContextFiles,
        removeDocumentContextItem,
        retryDocumentContextItem,
        sendMessage,
        stopStreaming,
        regenerateMessage,
        compactAndRetryMessage,
        continueMessage,
        editMessage,
        inputValue,
        setInputValue,
        editingMessageId,
        setEditingMessageId,
        tools,
        webSearchEnabled,
        toolAccessMode,
        writerModeAvailable,
        editModeEnabled,
        focusContext,
        toggleWebSearch,
        setToolAccessMode,
        toggleEditMode,
        sessionParams,
        setSessionParams,
        isStreaming: session.isStreaming,
        isCompacting: compactingConversationId === activeConversationId,
        streamingBlocks: session.blocks,
        continuationNodeId: session.continuationNodeId,
        continuationSubmittingMessageId,
        conversationRuntime,
        sidebarCollapsed,
        setSidebarCollapsed,
        autoScroll,
        setAutoScroll,
        isComposingNewConversation,
        createNewConversation,
        startReportDiscussion,
        startCharacterConversation,
        updateConversationCharacterAutoPlay,
        updateConversationSettings,
        switchActiveConversationModel,
        switchConversation,
        deleteConversation,
        renameConversation,
        toggleConversationPinned,
        toggleConversationArchived,
        activeConversation,
        getBranchInfo: session.getBranchInfo,
        switchBranch: session.switchBranch,
    }), [
        plugins, pluginsReady, selectedPlugin, selectedModel, historyConversations, activeConversationId,
        documentContextItems, pendingDocumentAttachmentItems,
        messages, completedAssistantTurn, inputValue, editingMessageId, tools, webSearchEnabled, toolAccessMode,
        writerModeAvailable, editModeEnabled, focusContext,
        sessionParams, session.isStreaming, session.blocks, conversationRuntime, sidebarCollapsed, autoScroll,
        compactingConversationId,
        isComposingNewConversation,
        activeConversation, sendMessage, stopStreaming, regenerateMessage, compactAndRetryMessage,
        continueMessage, editMessage,
        addDocumentContextFiles, removeDocumentContextItem, retryDocumentContextItem,
        toggleWebSearch, setToolAccessMode, toggleEditMode, createNewConversation, switchConversation, deleteConversation,
        renameConversation, toggleConversationPinned, toggleConversationArchived,
        startCharacterConversation, startReportDiscussion, updateConversationCharacterAutoPlay,
        updateConversationSettings, switchActiveConversationModel,
        selectConversation, session.getBranchInfo, session.switchBranch, session.continuationNodeId,
        continuationSubmittingMessageId,
    ])
}

function buildConversationFromMeta(
    meta: Awaited<ReturnType<typeof ai_list_conversations>>[number],
    storedMetaMap: Record<string, StoredCharacterConversationMeta>,
    uiStateMap: Record<string, ConversationUiState>,
): Conversation {
    const storedMeta = storedMetaMap[meta.id]
    const uiState = uiStateMap[meta.id]
    const isReport = storedMeta?.mode === 'report' || Boolean(storedMeta?.reportContext)
    const characterMeta = isReport ? null : (storedMeta ?? inferCharacterConversationMeta(meta.title))
    const isCharacter = Boolean(characterMeta)

    return {
        id: meta.id,
        title: meta.title,
        messages: [],
        pluginId: meta.plugin_id,
        model: meta.model,
        sessionId: null,
        runId: null,
        timestamp: new Date(meta.updated_at).getTime(),
        pinnedAt: uiState?.pinnedAt ?? null,
        archivedAt: uiState?.archivedAt ?? null,
        mode: isReport ? 'report' : isCharacter ? 'character' : 'default',
        characterEntryId: characterMeta?.characterEntryId ?? null,
        characterName: characterMeta?.characterName ?? null,
        backgroundImageUrl: characterMeta?.backgroundImageUrl ?? null,
        characterVoicePluginId: characterMeta?.characterVoicePluginId ?? null,
        characterVoiceModel: characterMeta?.characterVoiceModel ?? null,
        characterVoiceId: characterMeta?.characterVoiceId ?? null,
        characterAutoPlay: characterMeta?.characterAutoPlay ?? null,
        reportContext: isReport ? (storedMeta?.reportContext ?? null) : null,
        reportSeeded: isReport ? (storedMeta?.reportSeeded ?? false) : false,
        settings: normalizeConversationSettings(),
    }
}
