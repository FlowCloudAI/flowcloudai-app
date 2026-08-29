import {logger} from '../../../shared/logger'
import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {listenNativeFileDrop, openFileDialog, saveFileDialog} from '../../../api/dialog'
import {listen} from '../../../api/events'
import {Button, MessageBox, RollingBox, useAlert} from 'flowcloudai-ui'
import {
    ai_export_conversation,
    ai_cancel_tts,
    ai_play_tts,
    db_get_entry,
    db_list_entries,
    type Entry,
    type EntryBrief,
    type DocumentContextItem,
    type ConversationExportFormat,
    ErrorCode,
    formatApiError,
    setting_has_api_key,
    toApiError,
} from '../../../api'
import type {
    AiContextValue,
    AiToolAccessMode,
    Attachment,
    Conversation,
    ConversationSettings,
} from '../model/AiControllerTypes'
import {CONVERSATION_TEMPERATURE_MAX, normalizeConversationSettings} from '../model/AiControllerTypes'
import {
    estimateMessagesTokens,
    formatTokenCount,
    resolveTokenCalibrationFactor,
} from '../lib/contextUsage'
import {
    buildRenderableAiChatBlocks,
    buildRenderableAiChatMarkdown,
    parseAiChatEntryHref,
} from '../lib/aiChatMarkdown'
import type {DockableSidePanelMode} from '../../../shared/ui/layout/DockableSidePanel'
import {DockPanelSearchInput, DockPanelSegmentedControl} from '../../../shared/ui/layout/DockPanelSidebarControls'
import {DockPanelIconButton, DockPanelMain, DockPanelSide, DockPanelTitle, DockPanelTopbar} from '../../../shared/ui/layout/DockPanelScaffold'
import {resolvePreferredTtsPlugin, resolveVoiceIdWithPlugin} from '../../plugins/ttsVoice'
import AiPluginMissingOverlay, {type AiMissingPluginKind} from '../../../shared/ui/AiPluginMissingOverlay'
import useLinkPreview from '../../entries/hooks/useLinkPreview'
import useWikiLink from '../../entries/hooks/useWikiLink'
import EntryEditorLinkPreview from '../../entries/components/EntryEditorLinkPreview'
import EntryEditorWikiLink from '../../entries/components/EntryEditorWikiLink'
import AiToolAccessIcon from './AiToolAccessIcon'
import {
    buildInternalEntryMarkdown,
    type InternalEntryLink,
    resolveInternalEntryProjectId,
    resolveMarkdownAnchor,
} from '../../entries/lib/entryMarkdown'
import {normalizeEntryLookupTitle} from '../../entries/lib/entryCommon'
import {readCharacterVoiceConfigFromTags} from '../../entries/lib/characterVoice'
import {subscribeAppSettings, useAppSettingsStore} from '../../settings/appSettingsStore'
import AiChatErrorNotice from './AiChatErrorNotice'
import AiResponsePendingIndicator from './AiResponsePendingIndicator'
import {isIncompleteMessage, toRoleplayTtsText} from '../model/conversationState'
import '../../../shared/ui/layout/WorkspaceScaffold.css'
import '../../../shared/ui/layout/DockPanelScaffold.css'
import './AIChatContent.css'

const MAX_CHARS = 4000
const SHOW_HINT_THRESHOLD = 3500
const DEFAULT_ROLEPLAY_VOICE_ID = 'Ethan'
const AI_CHAT_DROP_ZONE_ID = 'ai-chat-drop-zone'
const ACTION_MENU_ESTIMATED_HEIGHT = 196
const CONTEXT_USAGE_RING_RADIUS = 10
const CONTEXT_USAGE_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_USAGE_RING_RADIUS
const DOCUMENT_CONTEXT_EXTENSIONS = [
    'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml',
    'ini', 'log', 'js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h',
    'hpp', 'cs', 'php', 'rb', 'swift', 'kt', 'sql', 'html', 'htm', 'css', 'scss', 'less',
    'sh', 'bat', 'ps1', 'env', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf',
]
const DOCUMENT_CONTEXT_EXTENSION_SET = new Set(DOCUMENT_CONTEXT_EXTENSIONS)
const CONVERSATION_SETTING_TOOLTIPS = {
    temperature: '温度：控制回答的随机性，越高越发散，越低越稳定。',
    topP: '回答开放度：越低越稳定严谨，越高越自由发散。',
    frequencyPenalty: '重复惩罚：启用后降低重复用词和句式，可设置具体强度。',
    presencePenalty: '存在惩罚：启用后鼓励模型引入新内容，可设置具体强度。',
    systemPrompt: '当前对话独有 AI 指令：只作用于当前对话，会作为额外指令发送。',
} as const
const AI_TOOL_ACCESS_LABELS: Record<AiToolAccessMode, string> = {
    reader: '读者模式',
    assistant: '助手模式',
    writer: '作家模式',
}
const AI_TOOL_ACCESS_OPTIONS: AiToolAccessMode[] = ['reader', 'assistant', 'writer']
const AI_TOOL_ACCESS_TITLES: Record<AiToolAccessMode, string> = {
    reader: '只允许读取项目资料',
    assistant: '允许写入工具，但写入前需要确认',
    writer: '常规写入跳过确认，删除仍需确认',
}
const formatConversationSettingNumber = (value: number) => {
    const fixed = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)
    const trimmed = fixed.replace(/\.?0+$/, '')
    return trimmed || '0'
}
const formatContextUsagePercent = (percent: number, usedTokens: number) => {
    if (usedTokens > 0 && percent > 0 && percent < 1) return '<1%'
    return `${Math.min(100, Math.max(0, Math.round(percent)))}%`
}
const parseConversationNumber = (value: string, fallback: number) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

const documentContextStatusLabel = (status: string) => {
    switch (status) {
        case 'pending':
            return '排队中'
        case 'parsing':
            return '解析中'
        case 'ready':
            return ''
        case 'failed':
            return '解析失败'
        default:
            return status
    }
}

const isCompleteConversationNumberInput = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || trimmed === '-' || trimmed === '+' || trimmed.endsWith('.')) return false
    return Number.isFinite(Number(trimmed))
}

interface ConversationNumberInputProps {
    value: number
    min: number
    max: number
    step: number
    disabled?: boolean
    onCommit: (value: number) => void
}

function ConversationNumberInput({
                                     value,
                                     min,
                                     max,
                                     step,
                                     disabled = false,
                                     onCommit,
                                 }: ConversationNumberInputProps) {
    const formattedValue = formatConversationSettingNumber(value)
    const [draft, setDraft] = useState(formattedValue)

    useEffect(() => {
        setDraft(formattedValue)
    }, [formattedValue])

    const commitDraft = useCallback((rawValue: string) => {
        if (!isCompleteConversationNumberInput(rawValue)) return
        onCommit(parseConversationNumber(rawValue, value))
    }, [onCommit, value])

    return (
        <input
            type="number"
            min={formatConversationSettingNumber(min)}
            max={formatConversationSettingNumber(max)}
            step={formatConversationSettingNumber(step)}
            disabled={disabled}
            value={draft}
            onChange={(event) => {
                const nextDraft = event.currentTarget.value
                setDraft(nextDraft)
                commitDraft(nextDraft)
            }}
            onBlur={() => {
                if (isCompleteConversationNumberInput(draft)) {
                    onCommit(parseConversationNumber(draft, value))
                } else {
                    setDraft(formattedValue)
                }
            }}
        />
    )
}
type AiConversationFilter = 'all' | 'default' | 'character' | 'report'
type AiConversationStatusFilter = 'active' | 'archived'
type ActionMenuPlacement = 'up' | 'down'
type ApiKeyAvailability = 'unknown' | 'checking' | 'configured' | 'missing' | 'error'

const AI_CONVERSATION_FILTER_OPTIONS: Array<{ key: AiConversationFilter; label: string }> = [
    {key: 'all', label: '全部'},
    {key: 'default', label: '通用'},
    {key: 'character', label: '角色聊天'},
    {key: 'report', label: '矛盾检测'},
]

const AI_CONVERSATION_STATUS_OPTIONS: Array<{ key: AiConversationStatusFilter; label: string }> = [
    {key: 'active', label: '当前'},
    {key: 'archived', label: '归档'},
]

function matchesConversationFilter(conversation: Conversation, filter: AiConversationFilter) {
    if (filter === 'all') return true
    if (filter === 'default') return !conversation.mode || conversation.mode === 'default'
    if (filter === 'character') return conversation.mode === 'character'
    if (filter === 'report') return conversation.mode === 'report'
    return false
}

function compareConversationsForList(a: Conversation, b: Conversation) {
    const pinnedDiff = Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt))
    if (pinnedDiff !== 0) return pinnedDiff
    if (a.pinnedAt && b.pinnedAt) return b.pinnedAt.localeCompare(a.pinnedAt)
    return b.timestamp - a.timestamp
}

function buildConversationSearchText(conversation: Conversation) {
    return [
        conversation.title,
        conversation.characterName,
        conversation.reportContext?.projectName,
        conversation.reportContext?.scopeSummary,
    ].filter(Boolean).join(' ').toLocaleLowerCase()
}

function buildConversationExportFileName(conversation: Conversation, format: ConversationExportFormat) {
    const extension = format === 'json' ? 'json' : 'md'
    const safeTitle = conversation.title
        .split('')
        .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80)
    return `${safeTitle || 'AI会话'}.${extension}`
}

function resolveActionMenuPlacement(anchorRect: DOMRect): ActionMenuPlacement {
    if (typeof window === 'undefined') return 'down'
    const spaceBelow = window.innerHeight - anchorRect.bottom
    const spaceAbove = anchorRect.top
    return spaceBelow >= ACTION_MENU_ESTIMATED_HEIGHT || spaceBelow >= spaceAbove ? 'down' : 'up'
}


const getDocumentContextFileExtension = (path: string) => {
    const fileName = path.split(/[\\/]/).pop() ?? ''
    const dotIndex = fileName.lastIndexOf('.')
    return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLocaleLowerCase() : ''
}

const isWithinAiChatDropZone = (position: {x: number; y: number}) => {
    const dropZone = document.getElementById(AI_CHAT_DROP_ZONE_ID)
    if (!dropZone) return false
    const rect = dropZone.getBoundingClientRect()
    // Tauri 返回物理像素，DOM 矩形使用 CSS 像素。
    const scale = window.devicePixelRatio || 1
    const x = position.x / scale
    const y = position.y / scale
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

const attachmentFileTypeLabel = (attachment: Attachment) => {
    const extension = attachment.extension?.replace(/^\./, '').trim()
    if (extension) return extension.toUpperCase()
    return '文件'
}

function DocumentFileIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M7 3.75h6.2L18 8.55v11.7H7z"/>
            <path d="M13 3.75v5h5"/>
            <path d="M9.8 13h4.4M9.8 16h3.2"/>
        </svg>
    )
}

function DocumentRailArrow({direction}: { direction: 'previous' | 'next' }) {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d={direction === 'previous' ? 'M10 3L5 8L10 13' : 'M6 3L11 8L6 13'}/>
        </svg>
    )
}

function AiMessageAttachments({attachments}: { attachments?: Attachment[] }) {
    const fileAttachments = (attachments ?? []).filter((attachment) => attachment.type === 'file')
    if (fileAttachments.length === 0) return null

    return (
        <div className="ai-message-attachments" aria-label="消息附件">
            {fileAttachments.map((attachment) => {
                const statusLabel = documentContextStatusLabel(attachment.status ?? 'ready')
                const typeLabel = attachmentFileTypeLabel(attachment)
                const isPdf = typeLabel === 'PDF'
                return (
                    <div
                        key={attachment.id}
                        className={`ai-message-attachment-card ai-message-attachment-card--${attachment.status ?? 'ready'} ${isPdf ? 'ai-message-attachment-card--pdf' : ''}`}
                        title={attachment.name}
                    >
                        <span className="ai-message-attachment-icon" aria-hidden="true">
                            <DocumentFileIcon/>
                        </span>
                        <span className="ai-message-attachment-meta">
                            <span className="ai-message-attachment-name">{attachment.name}</span>
                            <span className="ai-message-attachment-type">
                                {statusLabel || typeLabel}
                            </span>
                        </span>
                    </div>
                )
            })}
        </div>
    )
}

interface DocumentContextRailProps {
    items: DocumentContextItem[]
    onRetry: (itemId: string) => void
    onRemove: (itemId: string) => void
}

function DocumentContextRail({items, onRetry, onRemove}: DocumentContextRailProps) {
    const railRef = useRef<HTMLDivElement>(null)
    const [railScroll, setRailScroll] = useState({previous: false, next: false})
    const syncRailScroll = useCallback(() => {
        const rail = railRef.current
        if (!rail) return
        const next = {
            previous: rail.scrollLeft > 1,
            next: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1,
        }
        setRailScroll((current) => (
            current.previous === next.previous && current.next === next.next ? current : next
        ))
    }, [])

    useLayoutEffect(() => {
        const rail = railRef.current
        if (!rail) return
        syncRailScroll()
        const observer = new ResizeObserver(syncRailScroll)
        observer.observe(rail)
        return () => observer.disconnect()
    }, [items, syncRailScroll])

    const scrollRail = (direction: -1 | 1) => {
        const rail = railRef.current
        if (!rail) return
        rail.scrollBy({
            left: direction * Math.max(rail.clientWidth * 0.8, 240),
            behavior: 'smooth',
        })
    }

    return (
        <section
            className={`ai-document-context-rail${railScroll.previous ? ' has-previous' : ''}${railScroll.next ? ' has-next' : ''}`}
            aria-label="本对话引用文档"
        >
            {railScroll.previous && (
                <button
                    type="button"
                    className="ai-document-context-rail-nav ai-document-context-rail-nav--previous"
                    onClick={() => scrollRail(-1)}
                    aria-label="查看前面的引用文档"
                    title="查看前面的引用文档"
                >
                    <DocumentRailArrow direction="previous"/>
                </button>
            )}
            <RollingBox
                ref={railRef}
                className="ai-document-context-rail-track"
                axis="x"
                showThumb="hide"
                onScroll={syncRailScroll}
                tabIndex={0}
            >
                {items.map((item) => {
                    const typeLabel = item.extension ? item.extension.toUpperCase() : '文件'
                    const statusLabel = documentContextStatusLabel(item.status)
                    const isPdf = typeLabel === 'PDF'
                    return (
                        <article
                            key={item.id}
                            className={`ai-document-context-card ai-document-context-card--${item.status} ${isPdf ? 'ai-document-context-card--pdf' : ''}`}
                            title={item.error ?? item.sourcePath}
                        >
                            <span className="ai-message-attachment-icon ai-document-context-card-icon" aria-hidden="true">
                                <DocumentFileIcon/>
                            </span>
                            <span className="ai-document-context-card-meta">
                                <span className="ai-document-context-card-name">{item.fileName}</span>
                                <span className={`ai-document-context-card-status ai-document-context-card-status--${item.status}`} role={statusLabel ? 'status' : undefined}>
                                    {statusLabel ? `${typeLabel} · ${statusLabel}` : `${typeLabel} · 已引用`}
                                </span>
                            </span>
                            <span className="ai-document-context-card-actions">
                                {item.status === 'failed' && (
                                    <button
                                        type="button"
                                        className="ai-document-context-card-action"
                                        onClick={() => onRetry(item.id)}
                                        aria-label={`重新解析 ${item.fileName}`}
                                        title="重新解析"
                                    >
                                        ↻
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="ai-document-context-card-action"
                                    onClick={() => onRemove(item.id)}
                                    aria-label={`停止引用 ${item.fileName}`}
                                    title="停止后续引用"
                                >
                                    ×
                                </button>
                            </span>
                        </article>
                    )
                })}
            </RollingBox>
            {railScroll.next && (
                <button
                    type="button"
                    className="ai-document-context-rail-nav ai-document-context-rail-nav--next"
                    onClick={() => scrollRail(1)}
                    aria-label="查看后面的引用文档"
                    title="查看后面的引用文档"
                >
                    <DocumentRailArrow direction="next"/>
                </button>
            )}
        </section>
    )
}

interface AIChatContentProps {
    controller: AiContextValue
    panelMode?: DockableSidePanelMode
    onTogglePanelMode?: () => void
    onToggleCollapsed?: () => void
    onOpenEntry?: (projectId: string, entry: { id: string; title: string }) => void
    onOpenPluginManagement?: (kind: AiMissingPluginKind) => void
    onOpenWriterModeSettings?: () => void
    /** fullscreen 双 slot 模式下，sidebar JSX 会 portal 到这个元素；为 null 时正常 inline 渲染 */
    sidePortalTarget?: HTMLElement | null
}

export default function AIChatContent({
                                           controller,
                                           panelMode,
                                           onTogglePanelMode,
                                           onToggleCollapsed,
                                           onOpenEntry,
                                           onOpenPluginManagement,
                                           onOpenWriterModeSettings,
                                       sidePortalTarget,
                                   }: AIChatContentProps) {
    const ctx = controller
    const {
        settings: appSettings,
        ttsPlugins,
        apiKeyStatus,
        hasLoaded: appSettingsLoaded,
    } = useAppSettingsStore()
    const {addDocumentContextFiles} = ctx
    const activeConversation = ctx.activeConversation
    const isCharacterConversation = activeConversation?.mode === 'character'
    const isReportConversation = activeConversation?.mode === 'report'
    const isArchivedConversation = Boolean(activeConversation?.archivedAt)
    const canAttachDocuments = Boolean(activeConversation) && !isArchivedConversation
    const {showAlert} = useAlert()

    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [conversationStatusFilter, setConversationStatusFilter] = useState<AiConversationStatusFilter>('active')
    const [conversationFilter, setConversationFilter] = useState<AiConversationFilter>('all')
    const [conversationSearch, setConversationSearch] = useState('')
    const [actionMenuConversationId, setActionMenuConversationId] = useState<string | null>(null)
    const [actionMenuPlacement, setActionMenuPlacement] = useState<ActionMenuPlacement>('down')
    const renameInputRef = useRef<HTMLInputElement>(null)

    const startRename = (event: React.MouseEvent, conv: { id: string; title: string }) => {
        event.stopPropagation()
        setActionMenuConversationId(null)
        setRenamingId(conv.id)
        setRenameValue(conv.title)
        setTimeout(() => renameInputRef.current?.select(), 0)
    }

    const commitRename = async () => {
        if (renamingId) await ctx.renameConversation(renamingId, renameValue)
        setRenamingId(null)
    }

    const handleRenameKey = (event: React.KeyboardEvent) => {
        if (event.key === 'Enter') void commitRename()
        if (event.key === 'Escape') setRenamingId(null)
    }

    useEffect(() => {
        if (!actionMenuConversationId) return
        const handleClick = (event: MouseEvent) => {
            const target = event.target as Element | null
            if (target?.closest('.ai-conversation-action-menu, .ai-conversation-more-btn')) return
            setActionMenuConversationId(null)
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [actionMenuConversationId])

    const [isPluginMenuOpen, setIsPluginMenuOpen] = useState(false)
    const pluginSwitcherRef = useRef<HTMLDivElement>(null)

    const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
    const modelSwitcherRef = useRef<HTMLDivElement>(null)
    const [isToolAccessMenuOpen, setIsToolAccessMenuOpen] = useState(false)
    const toolAccessSelectRef = useRef<HTMLDivElement>(null)
    const toolAccessOptions = AI_TOOL_ACCESS_OPTIONS
    const settingsDrawerRef = useRef<HTMLDivElement>(null)
    const settingsToggleRef = useRef<HTMLButtonElement>(null)
    const [inputLimitMessage, setInputLimitMessage] = useState('')
    const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false)
    const [settingsDrawerMounted, setSettingsDrawerMounted] = useState(false)
    const [llmApiKeyState, setLlmApiKeyState] = useState<{
        availability: ApiKeyAvailability
        refreshTick: number
    }>({availability: 'unknown', refreshTick: 0})

    useEffect(() => {
        if (!isPluginMenuOpen) return
        const handleClick = (event: MouseEvent) => {
            if (pluginSwitcherRef.current && !pluginSwitcherRef.current.contains(event.target as Node)) {
                setIsPluginMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [isPluginMenuOpen])

    useEffect(() => {
        if (!isModelMenuOpen) return
        const handleClick = (event: MouseEvent) => {
            if (modelSwitcherRef.current && !modelSwitcherRef.current.contains(event.target as Node)) {
                setIsModelMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [isModelMenuOpen])

    useEffect(() => {
        if (!isToolAccessMenuOpen) return
        const handleClick = (event: MouseEvent) => {
            if (toolAccessSelectRef.current && !toolAccessSelectRef.current.contains(event.target as Node)) {
                setIsToolAccessMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [isToolAccessMenuOpen])

    useEffect(() => {
        setSettingsDrawerOpen(false)
        setSettingsDrawerMounted(false)
    }, [ctx.activeConversationId])

    useEffect(() => {
        if (settingsDrawerOpen) {
            setSettingsDrawerMounted(true)
        }
    }, [settingsDrawerOpen])

    useEffect(() => {
        if (!settingsDrawerOpen) return
        const handleClick = (event: MouseEvent) => {
            const target = event.target
            if (!(target instanceof Node)) return
            if (settingsDrawerRef.current?.contains(target)) return
            if (settingsToggleRef.current?.contains(target)) return
            setSettingsDrawerOpen(false)
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [settingsDrawerOpen])

    const [autoScroll, setAutoScroll] = useState(true)
    const [isNativeFileDragActive, setIsNativeFileDragActive] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    const linkPreviewPanelRef = useRef<HTMLDivElement | null>(null)
    const inputWikiContainerRef = useRef<HTMLDivElement | null>(null)
    const inputWikiPopoverRef = useRef<HTMLDivElement | null>(null)
    const focusContextRef = useRef<HTMLDivElement>(null)
    const focusChipTextRefs = useRef<Record<string, HTMLSpanElement | null>>({})
    const projectEntriesStatusRef = useRef<'idle' | 'loading' | 'loaded'>('idle')
    const projectEntriesLoadPromiseRef = useRef<Promise<void> | null>(null)
    const projectEntriesRef = useRef<EntryBrief[]>([])
    const lastScrollTopRef = useRef(0)
    const handledAssistantTurnSequenceRef = useRef(ctx.completedAssistantTurn?.sequence ?? 0)
    const activeRoleplayConversationIdRef = useRef(isCharacterConversation ? ctx.activeConversationId : null)
    const roleplayCancelTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
    const notifiedFailedDocumentIdsRef = useRef<Set<string>>(new Set())
    const [overflowingFocusChips, setOverflowingFocusChips] = useState<Record<string, boolean>>({})
    const [projectEntries, setProjectEntries] = useState<EntryBrief[]>([])
    const [entryCache, setEntryCache] = useState<Record<string, Entry>>({})

    useEffect(() => {
        if (roleplayCancelTimerRef.current != null) {
            window.clearTimeout(roleplayCancelTimerRef.current)
            roleplayCancelTimerRef.current = null
        }
        const nextConversationId = isCharacterConversation ? ctx.activeConversationId : null
        const previousConversationId = activeRoleplayConversationIdRef.current
        activeRoleplayConversationIdRef.current = nextConversationId
        if (previousConversationId && previousConversationId !== nextConversationId) {
            void ai_cancel_tts().catch(() => undefined)
        }

        return () => {
            if (!activeRoleplayConversationIdRef.current) return
            roleplayCancelTimerRef.current = window.setTimeout(() => {
                void ai_cancel_tts().catch(() => undefined)
            })
        }
    }, [ctx.activeConversationId, isCharacterConversation])

    const charCount = ctx.inputValue.length
    const showCharHint = charCount >= SHOW_HINT_THRESHOLD
    const visibleDocumentContextItems = ctx.documentContextItems
    const activeLlmPluginId = activeConversation?.pluginId || ctx.selectedPlugin
    const modelPluginInfo = ctx.plugins.find((plugin) => plugin.id === activeLlmPluginId)
    const activeLlmPluginInfo = ctx.plugins.find((plugin) => plugin.id === activeLlmPluginId)
    const activeLlmPluginName = activeLlmPluginInfo?.name || activeLlmPluginId || '当前 AI 对话插件'
    const contextPluginInfo = ctx.plugins.find((plugin) => plugin.id === (activeConversation?.pluginId ?? ctx.selectedPlugin))
    const contextModelId = activeConversation?.model || ctx.selectedModel
    const contextModelInfo = contextPluginInfo?.model_infos.find((modelInfo) => modelInfo.id === contextModelId)
    const contextWindowTokens = contextModelInfo?.context_window_tokens ?? null
    const calibrationFactor = resolveTokenCalibrationFactor(
        appSettings?.llm.token_calibration_factors,
        contextPluginInfo?.id,
        contextModelId,
    )
    const latestUsage = useMemo(() => {
        for (let index = ctx.messages.length - 1; index >= 0; index -= 1) {
            const usage = ctx.messages[index].usage
            if (usage) return usage
        }
        return null
    }, [ctx.messages])
    const [estimatedContextTokens, setEstimatedContextTokens] = useState(0)
    useEffect(() => {
        const estimatedMessages = [
            ...ctx.messages,
            ...(activeConversation?.settings.systemPrompt.trim()
                ? [{content: activeConversation.settings.systemPrompt}]
                : []),
            ...(ctx.inputValue.trim() ? [{content: ctx.inputValue}] : []),
        ]
        if (estimatedMessages.length === 0) {
            setEstimatedContextTokens(0)
            return
        }

        let active = true
        const timer = window.setTimeout(() => {
            void estimateMessagesTokens(
                estimatedMessages,
                calibrationFactor,
                contextPluginInfo?.id,
                contextModelId,
            )
                .then(tokens => {
                    if (active) setEstimatedContextTokens(tokens)
                })
                .catch(() => {
                    if (active) setEstimatedContextTokens(0)
                })
        }, 150)
        return () => {
            active = false
            window.clearTimeout(timer)
        }
    }, [
        activeConversation?.settings.systemPrompt,
        calibrationFactor,
        contextModelId,
        contextPluginInfo?.id,
        ctx.inputValue,
        ctx.messages,
    ])
    const contextUsage = useMemo(() => {
        const usageTokens = latestUsage?.total_tokens ?? 0
        const usedTokens = Math.max(usageTokens, estimatedContextTokens)
        const source = latestUsage && usageTokens >= estimatedContextTokens ? '服务返回' : '核心估算'
        if (!contextWindowTokens || contextWindowTokens <= 0) {
            return {
                label: usedTokens > 0 ? '?' : '0%',
                percent: 0,
                ringPercent: 0,
                title: usedTokens > 0
                    ? `对话记忆容量信息未返回，已估算当前对话记忆约 ${formatTokenCount(usedTokens)}`
                    : '对话记忆容量信息未返回，暂以 0% 显示',
            }
        }
        const percent = Math.min(100, Math.max(0, (usedTokens / contextWindowTokens) * 100))
        const label = formatContextUsagePercent(percent, usedTokens)
        return {
            label,
            percent,
            ringPercent: percent > 0 && percent < 1 ? 1 : percent,
            title: `对话记忆已用约 ${label}（${source} ${formatTokenCount(usedTokens)} / ${formatTokenCount(contextWindowTokens)}）`,
        }
    }, [contextWindowTokens, estimatedContextTokens, latestUsage])
    const showContextUsageIndicator = Boolean(contextModelId)
    const contextUsageDashOffset = CONTEXT_USAGE_RING_CIRCUMFERENCE * (1 - contextUsage.ringPercent / 100)
    const conversationSettings = normalizeConversationSettings(activeConversation?.settings)
    const updateConversationSetting = useCallback(<K extends keyof ConversationSettings,>(
        key: K,
        value: ConversationSettings[K],
    ) => {
        if (!activeConversation) return
        void ctx.updateConversationSettings(activeConversation.id, {[key]: value} as Partial<ConversationSettings>)
    }, [activeConversation, ctx])
    const toggleSettingsDrawer = useCallback(() => {
        if (!activeConversation) return
        if (!settingsDrawerOpen) {
            setSettingsDrawerMounted(true)
        }
        setSettingsDrawerOpen((open) => !open)
    }, [activeConversation, settingsDrawerOpen])
    const handleSettingsDrawerAnimationEnd = useCallback((event: React.AnimationEvent<HTMLDivElement>) => {
        if (event.currentTarget !== event.target) return
        if (!settingsDrawerOpen) {
            setSettingsDrawerMounted(false)
        }
    }, [settingsDrawerOpen])
    const showFocusContext = !isCharacterConversation && !isReportConversation
    const linkPreviewProjectId = activeConversation?.reportContext?.projectId ?? ctx.focusContext.projectId
    const llmUnavailable = ctx.pluginsReady && ctx.plugins.length === 0
    const llmApiKeyMissing = ctx.pluginsReady
        && !llmUnavailable
        && Boolean(activeLlmPluginId)
        && llmApiKeyState.availability === 'missing'
    const filteredConversations = useMemo(() => {
        const keyword = conversationSearch.trim().toLocaleLowerCase()

        return ctx.conversations.filter((conversation) => {
            if (conversationStatusFilter === 'active' && conversation.archivedAt) return false
            if (conversationStatusFilter === 'archived' && !conversation.archivedAt) return false
            if (!matchesConversationFilter(conversation, conversationFilter)) return false
            if (!keyword) return true
            return buildConversationSearchText(conversation).includes(keyword)
        }).sort(compareConversationsForList)
    }, [conversationFilter, conversationSearch, conversationStatusFilter, ctx.conversations])
    const hasConversationSearch = conversationSearch.trim().length > 0
    const ttsUnavailable = appSettingsLoaded && ttsPlugins.length === 0
    const roleplayTtsEnabled = isCharacterConversation && !ttsUnavailable
    const focusContextItems = useMemo(() => {
        const focusContext = ctx.focusContext
        return [
            focusContext.projectId
                ? {key: 'project', label: `项目：${focusContext.projectName ?? '加载中'}`}
                : {key: 'project', label: '项目：未引用'},
            focusContext.entryId
                ? {key: 'entry', label: `词条：${focusContext.entryTitle ?? '加载中'}`}
                : null,
        ].filter((item): item is { key: string; label: string } => Boolean(item))
    }, [ctx.focusContext])

    const ensureProjectEntryDetailsLoaded = useCallback(async (briefs: EntryBrief[]) => {
        if (!briefs.length) return
        const results = await Promise.all(
            briefs.map(async (brief) => {
                try {
                    const detail = await db_get_entry(brief.id, brief.project_id)
                    return [brief.id, detail] as const
                } catch {
                    return null
                }
            }),
        )
        setEntryCache((current) => ({
            ...current,
            ...Object.fromEntries(results.filter(Boolean) as Array<readonly [string, Entry]>),
        }))
    }, [])

    const ensureProjectEntriesLoaded = useCallback(async () => {
        if (!linkPreviewProjectId) return
        if (projectEntriesStatusRef.current === 'loaded') return
        if (projectEntriesLoadPromiseRef.current) return projectEntriesLoadPromiseRef.current

        projectEntriesStatusRef.current = 'loading'
        projectEntriesLoadPromiseRef.current = (async () => {
            try {
                const briefs = await db_list_entries({projectId: linkPreviewProjectId, limit: 1000, offset: 0})
                projectEntriesRef.current = briefs
                setProjectEntries(briefs)
                projectEntriesStatusRef.current = 'loaded'
                void ensureProjectEntryDetailsLoaded(briefs)
            } catch {
                projectEntriesStatusRef.current = 'idle'
            } finally {
                projectEntriesLoadPromiseRef.current = null
            }
        })()

        return projectEntriesLoadPromiseRef.current
    }, [ensureProjectEntryDetailsLoaded, linkPreviewProjectId])

    const linkPreview = useLinkPreview({
        currentProjectId: linkPreviewProjectId,
        entryCache,
        projectEntries,
        ensureProjectEntriesLoaded,
        onOpenEntry: (projectId, entry) => {
            onOpenEntry?.(projectId, entry)
        },
        onMissingLink: (message) => {
            void showAlert(message, 'warning', 'nonInvasive', 1800)
        },
    })
    const {closeLinkPreview} = linkPreview

    useEffect(() => {
        projectEntriesStatusRef.current = 'idle'
        projectEntriesLoadPromiseRef.current = null
        projectEntriesRef.current = []
        setProjectEntries([])
        setEntryCache({})
        closeLinkPreview()
    }, [closeLinkPreview, linkPreviewProjectId])

    useEffect(() => {
        const handler = () => setLlmApiKeyState((state) => ({
            ...state,
            refreshTick: state.refreshTick + 1,
        }))
        const unlistenBackendReady = listen('backend-ready', handler)
        const unsubscribeSettings = subscribeAppSettings(handler)
        return () => {
            unsubscribeSettings()
            unlistenBackendReady.then((fn) => fn())
        }
    }, [])

    useEffect(() => {
        if (!ctx.pluginsReady || llmUnavailable || !activeLlmPluginId) {
            setLlmApiKeyState((state) => ({...state, availability: 'unknown'}))
            return
        }

        let cancelled = false
        setLlmApiKeyState((state) => ({...state, availability: 'checking'}))
        setting_has_api_key(activeLlmPluginId)
            .then((hasApiKey) => {
                if (cancelled) return
                setLlmApiKeyState((state) => ({
                    ...state,
                    availability: hasApiKey ? 'configured' : 'missing',
                }))
            })
            .catch((error) => {
                if (cancelled) return
                logger.warn('检查 LLM 插件 API Key 状态失败', {pluginId: activeLlmPluginId, error})
                setLlmApiKeyState((state) => ({...state, availability: 'error'}))
            })

        return () => {
            cancelled = true
        }
    }, [activeLlmPluginId, ctx.pluginsReady, llmApiKeyState.refreshTick, llmUnavailable])

    const inputWikiLink = useWikiLink({
        projectId: linkPreviewProjectId,
        entryId: ctx.focusContext.entryId ?? '',
        entryCategoryId: null,
        projectEntries,
        content: ctx.inputValue,
        containerRef: inputWikiContainerRef,
        popoverRef: inputWikiPopoverRef,
        onContentChange: ctx.setInputValue,
        onCreateEntry: async () => null,
        onShowAlert: (message, type) => {
            void showAlert(message, type, 'nonInvasive', 1600)
        },
        canCreateEntry: false,
    })
    const sendDisabledReason = isArchivedConversation
        ? '取消归档后继续对话'
        : llmUnavailable
            ? '请先安装 AI 对话插件'
            : llmApiKeyMissing
                ? `请先配置 ${activeLlmPluginName} 的访问密钥`
                : ctx.isCompacting
                    ? '正在压缩对话历史…'
                    : ctx.isStreaming
                        ? '正在生成中'
                        : !ctx.inputValue.trim()
                            ? '请输入消息'
                            : ''

    useLayoutEffect(() => {
        if (!showFocusContext) {
            setOverflowingFocusChips({})
            return
        }

        const measureOverflow = () => {
            const nextState: Record<string, boolean> = {}
            focusContextItems.forEach((item) => {
                const element = focusChipTextRefs.current[item.key]
                nextState[item.key] = Boolean(element && element.scrollWidth > element.clientWidth + 1)
            })
            setOverflowingFocusChips((current) => {
                const currentKeys = Object.keys(current)
                const nextKeys = Object.keys(nextState)
                if (currentKeys.length !== nextKeys.length) return nextState
                for (const key of nextKeys) {
                    if (current[key] !== nextState[key]) return nextState
                }
                return current
            })
        }

        measureOverflow()
        const observer = new ResizeObserver(() => {
            measureOverflow()
        })
        if (focusContextRef.current) observer.observe(focusContextRef.current)
        focusContextItems.forEach((item) => {
            const element = focusChipTextRefs.current[item.key]
            if (element) observer.observe(element)
        })

        return () => observer.disconnect()
    }, [focusContextItems, showFocusContext])

    useEffect(() => {
        ctx.documentContextItems.forEach((item) => {
            if (item.status !== 'failed') {
                notifiedFailedDocumentIdsRef.current.delete(item.id)
            }
        })

        const failedItem = ctx.documentContextItems.find((item) =>
            item.status === 'failed' && !notifiedFailedDocumentIdsRef.current.has(item.id),
        )
        if (!failedItem) return

        notifiedFailedDocumentIdsRef.current.add(failedItem.id)
        void showAlert(
            `文档「${failedItem.fileName}」解析失败${failedItem.error ? `：${failedItem.error}` : ''}`,
            'error',
            'nonInvasive',
            3200,
        )
    }, [ctx.documentContextItems, showAlert])

    useEffect(() => {
        if (!autoScroll) return
        requestAnimationFrame(() => {
            const container = messagesContainerRef.current
            if (!container) return
            const roll = container.querySelector('.fc-roll') as HTMLElement | null
            const scrollContainer = roll || container
            scrollContainer.scrollTop = scrollContainer.scrollHeight
        })
    }, [ctx.messages.length, ctx.streamingBlocks, autoScroll])

    useLayoutEffect(() => {
        const input = inputWikiContainerRef.current
        const messages = messagesContainerRef.current
        if (!input || !messages) return
        const syncInputClearance = () => {
            messages.style.setProperty('--ai-messages-bottom-space', `${input.offsetHeight + 72}px`)
            if (autoScroll) messages.scrollTop = messages.scrollHeight
        }
        syncInputClearance()
        const observer = new ResizeObserver(syncInputClearance)
        observer.observe(input)
        return () => observer.disconnect()
    }, [autoScroll])

    const handleMessagesScroll = useCallback(() => {
        const container = messagesContainerRef.current
        if (!container) return
        const roll = container.querySelector('.fc-roll') as HTMLElement | null
        const scrollContainer = roll || container
        const {scrollTop, scrollHeight, clientHeight} = scrollContainer
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight
        if (scrollTop < lastScrollTopRef.current && distanceFromBottom > 50) {
            setAutoScroll(false)
        } else if (distanceFromBottom <= 50) {
            setAutoScroll(true)
        }
        lastScrollTopRef.current = scrollTop
    }, [])

    const resolveEntryAnchor = useCallback((target: EventTarget | null): HTMLAnchorElement | null => {
        const anchor = resolveMarkdownAnchor(target)
        if (!anchor) return null
        const href = anchor.getAttribute('href') ?? ''
        return parseAiChatEntryHref(href, anchor.textContent ?? '') ? anchor : null
    }, [])

    const getEntryLinkFromAnchor = useCallback((anchor: HTMLAnchorElement): InternalEntryLink | null => {
        const href = anchor.getAttribute('href') ?? ''
        return parseAiChatEntryHref(href, anchor.textContent ?? '')
    }, [])

    const handleEntryLinkClick = useCallback((event: React.MouseEvent) => {
        const anchor = resolveEntryAnchor(event.target)
        if (!anchor) return
        event.preventDefault()

        const internalLink = getEntryLinkFromAnchor(anchor)
        if (!internalLink) return
        const targetProjectId = resolveInternalEntryProjectId(internalLink, linkPreviewProjectId)
        if (!targetProjectId && !internalLink.entryId && !linkPreviewProjectId) {
            void showAlert('当前对话没有项目上下文，无法打开词条链接。', 'warning', 'nonInvasive', 1800)
            return
        }
        void ensureProjectEntriesLoaded().then(() => {
            linkPreview.handleOpenLinkedEntry(internalLink)
        })
    }, [ensureProjectEntriesLoaded, getEntryLinkFromAnchor, linkPreview, linkPreviewProjectId, resolveEntryAnchor, showAlert])

    const handleEntryLinkMouseOver = useCallback((event: React.MouseEvent) => {
        const anchor = resolveEntryAnchor(event.target)
        if (!anchor) return
        const internalLink = getEntryLinkFromAnchor(anchor)
        if (!internalLink) return
        if (internalLink.entryId && !resolveInternalEntryProjectId(internalLink, linkPreviewProjectId)) return
        if (!internalLink.entryId && !linkPreviewProjectId) return
        if (linkPreview.linkPreviewAnchorRef.current === anchor) {
            linkPreview.clearLinkPreviewCloseTimer()
            linkPreview.updateLinkPreviewPosition(anchor)
            return
        }
        linkPreview.openLinkPreview(anchor, internalLink)
    }, [getEntryLinkFromAnchor, linkPreview, linkPreviewProjectId, resolveEntryAnchor])

    const handleEntryLinkMouseOut = useCallback((event: React.MouseEvent) => {
        const anchor = resolveEntryAnchor(event.target)
        if (!anchor) return
        const relatedTarget = event.relatedTarget
        if (
            relatedTarget instanceof Node
            && (anchor.contains(relatedTarget) || linkPreviewPanelRef.current?.contains(relatedTarget))
        ) {
            return
        }
        linkPreview.scheduleLinkPreviewClose()
    }, [linkPreview, resolveEntryAnchor])

    const scrollToBottom = useCallback(() => {
        setAutoScroll(true)
        requestAnimationFrame(() => {
            const container = messagesContainerRef.current
            if (!container) return
            const roll = container.querySelector('.fc-roll') as HTMLElement | null
            const scrollContainer = roll || container
            scrollContainer.scrollTop = scrollContainer.scrollHeight
        })
    }, [])

    const resizeTextarea = useCallback(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.style.height = 'auto'
        const nextHeight = Math.min(Math.max(textarea.scrollHeight, 60), 200)
        textarea.style.height = `${nextHeight}px`
    }, [])

    useLayoutEffect(() => {
        resizeTextarea()
    }, [ctx.inputValue, resizeTextarea])

    useEffect(() => {
        const textarea = textareaRef.current
        if (!textarea) return

        const target = textarea.closest('.dockable-side-panel') as HTMLElement | null
            ?? textarea.closest('.ai-main') as HTMLElement | null
        if (!target) return

        const ro = new ResizeObserver(() => {
            resizeTextarea()
        })
        ro.observe(target)

        const handleTransitionEnd = () => resizeTextarea()
        target.addEventListener('transitionend', handleTransitionEnd)
        target.addEventListener('animationend', handleTransitionEnd)

        resizeTextarea()

        return () => {
            ro.disconnect()
            target.removeEventListener('transitionend', handleTransitionEnd)
            target.removeEventListener('animationend', handleTransitionEnd)
        }
    }, [resizeTextarea])

    const standardizeInputWikiLinks = useCallback(async (content: string) => {
        if (!content.includes('[[')) return content
        if (!linkPreviewProjectId) return content
        await ensureProjectEntriesLoaded()
        const entries = projectEntriesRef.current
        if (!entries.length) return content

        return content.replace(/\[\[([^[\]\n]+?)]]/g, (match, rawTitle) => {
            const title = String(rawTitle).trim()
            if (!title) return match
            const normalizedTitle = normalizeEntryLookupTitle(title)
            const target = entries.find((entry) => normalizeEntryLookupTitle(entry.title) === normalizedTitle)
            return target ? buildInternalEntryMarkdown(target.title, target.id, target.project_id) : match
        })
    }, [ensureProjectEntriesLoaded, linkPreviewProjectId])

    const handleSendCurrentInput = useCallback(async () => {
        const rawInput = ctx.inputValue
        if (llmApiKeyMissing) {
            await showAlert(`AI 对话插件「${activeLlmPluginName}」尚未配置访问密钥。`, 'warning', 'nonInvasive', 2600)
            return
        }
        if (
            isArchivedConversation
            || llmUnavailable
            || !rawInput.trim()
            || ctx.isStreaming
            || ctx.isCompacting
        ) return
        const nextInput = await standardizeInputWikiLinks(rawInput)
        await ctx.sendMessage(nextInput)
    }, [
        activeLlmPluginName,
        ctx,
        isArchivedConversation,
        llmApiKeyMissing,
        llmUnavailable,
        showAlert,
        standardizeInputWikiLinks,
    ])

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        inputWikiLink.handleWikiKeyDown(event)
        if (event.defaultPrevented) return

        if (
            event.key === 'ArrowLeft'
            || event.key === 'ArrowRight'
            || event.key === 'ArrowUp'
            || event.key === 'ArrowDown'
        ) {
            event.stopPropagation()
            return
        }

        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault()
            if (
                isArchivedConversation
                || !ctx.inputValue.trim()
                || ctx.isStreaming
                || ctx.isCompacting
            ) return
            void handleSendCurrentInput()
        }
    }

    const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const nextValue = event.target.value
        if (nextValue.length <= MAX_CHARS) {
            ctx.setInputValue(nextValue)
            if (inputLimitMessage) {
                setInputLimitMessage('')
            }
            if (nextValue.includes('[[')) {
                void ensureProjectEntriesLoaded()
            }
            inputWikiLink.handleMarkdownCursorSync(event.currentTarget)
            return
        }

        const overflow = nextValue.length - MAX_CHARS
        ctx.setInputValue(nextValue.slice(0, MAX_CHARS))
        setInputLimitMessage(`已截断，超出 ${overflow} 字未输入`)
        inputWikiLink.handleMarkdownCursorSync(event.currentTarget)
    }

    const addDocumentPaths = useCallback(async (paths: string[]) => {
        if (!canAttachDocuments || paths.length === 0) return
        const supportedPaths = paths.filter((path) =>
            DOCUMENT_CONTEXT_EXTENSION_SET.has(getDocumentContextFileExtension(path)),
        )
        const skippedCount = paths.length - supportedPaths.length
        if (supportedPaths.length === 0) {
            await showAlert('仅支持文档与文本格式，不支持图片、音视频或文件夹。', 'warning', 'nonInvasive', 2400)
            return
        }

        try {
            await addDocumentContextFiles(supportedPaths)
            if (skippedCount > 0) {
                await showAlert(`已添加 ${supportedPaths.length} 个文件，跳过 ${skippedCount} 个不支持的文件。`, 'warning', 'nonInvasive', 2200)
            }
        } catch (error) {
            logger.warn('[AIChatContent] 添加文档上下文失败', error)
            await showAlert('添加文档失败，请确认文件可读取且格式受支持。', 'error', 'nonInvasive', 2400)
        }
    }, [addDocumentContextFiles, canAttachDocuments, showAlert])

    const setNativeFileDragActive = useCallback((next: boolean) => {
        setIsNativeFileDragActive((current) => current === next ? current : next)
    }, [])

    const handleAttachDocuments = useCallback(async () => {
        if (!canAttachDocuments) return
        const selected = await openFileDialog({
            multiple: true,
            filters: [
                {
                    name: '文档与文本',
                    extensions: DOCUMENT_CONTEXT_EXTENSIONS,
                },
            ],
        })
        const paths = Array.isArray(selected)
            ? selected
            : selected
                ? [selected]
                : []
        if (paths.length === 0) return
        await addDocumentPaths(paths)
    }, [addDocumentPaths, canAttachDocuments])

    useEffect(() => {
        if (!canAttachDocuments) {
            setNativeFileDragActive(false)
            return
        }

        let disposed = false
        let unlisten: (() => void) | undefined
        void listenNativeFileDrop((event) => {
            if (event.type === 'leave') {
                setNativeFileDragActive(false)
                return
            }

            const isWithinDropZone = isWithinAiChatDropZone(event.position)
            if (event.type === 'drop') {
                setNativeFileDragActive(false)
                if (isWithinDropZone) void addDocumentPaths(event.paths)
                return
            }

            setNativeFileDragActive(isWithinDropZone)
        }).then((release) => {
            if (disposed) {
                release()
            } else {
                unlisten = release
            }
        }).catch((error) => {
            if (!disposed) logger.warn('[AIChatContent] 监听原生文件拖放失败', error)
        })

        return () => {
            disposed = true
            unlisten?.()
        }
    }, [addDocumentPaths, canAttachDocuments, setNativeFileDragActive])

    const handleExportConversation = useCallback(async (
        event: React.MouseEvent,
        conversation: Conversation,
        format: ConversationExportFormat,
    ) => {
        event.stopPropagation()
        setActionMenuConversationId(null)

        if (conversation.id.startsWith('conv_')) {
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
    }, [showAlert])

    const handleDeleteConversation = useCallback(async (event: React.MouseEvent, conversation: Conversation) => {
        event.stopPropagation()
        setActionMenuConversationId(null)
        const confirmed = await showAlert(`确定删除对话「${conversation.title}」？`, 'warning', 'confirm')
        if (confirmed !== 'yes') return
        await ctx.deleteConversation(conversation.id)
    }, [ctx, showAlert])

    const handleToolAccessModeSelect = useCallback(async (mode: AiToolAccessMode) => {
        setIsToolAccessMenuOpen(false)
        if (mode === 'writer' && !ctx.writerModeAvailable) {
            const confirmed = await showAlert(
                '作家模式会跳过新建、改写、移动等常规操作确认，\nAI 将更容易直接改动项目内容；\n删除操作仍会要求确认。\n\n需要先在设置中手动开启后才能使用。是否前往设置？',
                'warning',
                'confirm',
            )
            if (confirmed === 'yes') {
                onOpenWriterModeSettings?.()
            }
            return
        }
        await ctx.setToolAccessMode(mode)
    }, [ctx, onOpenWriterModeSettings, showAlert])

    const handlePlayRoleMessage = useCallback(async (
        content: string,
        trigger: 'auto' | 'manual',
    ) => {
        const conversationId = activeConversation?.id ?? null
        const text = toRoleplayTtsText(content)
        if (!text) {
            await showAlert('当前消息没有可播放的文本内容。', 'warning', 'nonInvasive', 1800)
            return
        }

        if (!appSettingsLoaded || !appSettings) {
            await showAlert('语音设置仍在加载，请稍后重试。', 'warning', 'nonInvasive', 1800)
            return
        }

        if (ttsPlugins.length === 0) {
            await showAlert('当前没有可用的语音插件，请先安装 AI 语音插件。', 'warning', 'nonInvasive', 2600)
            return
        }

        let roleVoice = {
            pluginId: activeConversation?.characterVoicePluginId ?? null,
            model: activeConversation?.characterVoiceModel ?? null,
            voiceId: activeConversation?.characterVoiceId ?? null,
        }
        let voiceConfigSource = 'conversation-snapshot'
        if (activeConversation?.characterEntryId) {
            try {
                const character = await db_get_entry(activeConversation.characterEntryId)
                const latest = readCharacterVoiceConfigFromTags(character.tags)
                roleVoice = {
                    pluginId: latest.pluginId,
                    model: latest.model,
                    voiceId: latest.voiceId,
                }
                voiceConfigSource = 'character-entry'
            } catch (error) {
                logger.warn('[roleplay-tts] 读取角色最新音色失败，回退会话快照', {
                    conversationId,
                    characterEntryId: activeConversation.characterEntryId,
                    error: String(error),
                })
            }
        }
        if (conversationId && activeRoleplayConversationIdRef.current !== conversationId) {
            logger.info('[roleplay-tts] 会话已切换，跳过过期播放', {conversationId, trigger})
            return
        }

        const selectedPlugin = resolvePreferredTtsPlugin(
            ttsPlugins,
            roleVoice.pluginId ?? appSettings.tts.plugin_id,
        )

        if (!selectedPlugin) {
            await showAlert('默认语音插件不可用，请在设置中重新选择。', 'warning', 'nonInvasive', 2600)
            return
        }

        if (apiKeyStatus[selectedPlugin.id] === false) {
            await showAlert(`语音插件「${selectedPlugin.name}」尚未配置访问密钥。`, 'warning', 'nonInvasive', 2600)
            return
        }

        const preferredModel = roleVoice.model
            ?? (roleVoice.pluginId ? null : appSettings.tts.default_model)
        const model = preferredModel && selectedPlugin.models.includes(preferredModel)
            ? preferredModel
            : (selectedPlugin.default_model ?? selectedPlugin.models[0] ?? '')

        if (!model) {
            await showAlert(`语音插件「${selectedPlugin.name}」没有可用模型。`, 'warning', 'nonInvasive', 2600)
            return
        }

        const voiceId = resolveVoiceIdWithPlugin(
            selectedPlugin,
            [roleVoice.voiceId, appSettings.tts.voice_id],
            DEFAULT_ROLEPLAY_VOICE_ID,
        )

        logger.info('[roleplay-tts] 开始播放', {
            conversationId,
            characterEntryId: activeConversation?.characterEntryId ?? null,
            trigger,
            voiceConfigSource,
            pluginId: selectedPlugin.id,
            pluginName: selectedPlugin.name,
            model,
            voiceId,
            textCharacters: [...text].length,
        })

        try {
            await ai_play_tts({
                pluginId: selectedPlugin.id,
                model,
                text,
                voiceId,
                conversationId,
                trigger,
            })
        } catch (error) {
            logger.error('[roleplay-tts] 播放失败', {
                conversationId,
                trigger,
                pluginId: selectedPlugin.id,
                model,
                voiceId,
                error: String(error),
            })
            await showAlert(`语音播放失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 2800)
        }
    }, [activeConversation, apiKeyStatus, appSettings, appSettingsLoaded, showAlert, ttsPlugins])

    useEffect(() => {
        const turn = ctx.completedAssistantTurn
        if (!turn || turn.sequence <= handledAssistantTurnSequenceRef.current) return
        handledAssistantTurnSequenceRef.current = turn.sequence
        if (
            !turn.activeAtCompletion
            || ttsUnavailable
            || !activeConversation
            || activeConversation.id !== turn.conversationId
            || activeConversation.mode !== 'character'
            || !(activeConversation.characterAutoPlay ?? appSettings?.tts.auto_play ?? false)
        ) return

        void handlePlayRoleMessage(
            turn.text,
            'auto',
        )
    }, [
        activeConversation,
        appSettings?.tts.auto_play,
        ctx.completedAssistantTurn,
        handlePlayRoleMessage,
        ttsUnavailable,
    ])

    const effectiveRoleplayAutoPlay = activeConversation?.characterAutoPlay ?? appSettings?.tts.auto_play ?? true

    const sidebarJsx = (
        <>
            {!ctx.sidebarCollapsed && !sidePortalTarget && (
                <div className="ai-sidebar-overlay" onClick={() => ctx.setSidebarCollapsed(true)}/>
            )}
            <DockPanelSide className="ai-sidebar">
                <div className="ai-sidebar-top">
                    <DockPanelTopbar className="ai-sidebar-topbar" variant="side">
                        <DockPanelTitle className="ai-sidebar-topbar-title">对话列表</DockPanelTitle>
                        {panelMode !== 'fullscreen' && (
                            <DockPanelIconButton
                                className="ai-sidebar-close-btn"
                                onClick={() => ctx.setSidebarCollapsed(true)}
                                title="收起侧边栏"
                            >
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
                                     strokeWidth="1.5">
                                    <path d="M9 2L4 7L9 12"/>
                                </svg>
                            </DockPanelIconButton>
                        )}
                    </DockPanelTopbar>
                    <div className="ai-sidebar-controls dock-panel-sidebar-controls">
                        <div className="dock-panel-control-group">
                            <span className="dock-panel-control-label">状态</span>
                            <DockPanelSegmentedControl
                                options={AI_CONVERSATION_STATUS_OPTIONS}
                                value={conversationStatusFilter}
                                onChange={setConversationStatusFilter}
                                ariaLabel="AI 对话状态"
                            />
                        </div>
                        <div className="dock-panel-control-group">
                            <span className="dock-panel-control-label">类型</span>
                            <DockPanelSegmentedControl
                                options={AI_CONVERSATION_FILTER_OPTIONS}
                                value={conversationFilter}
                                onChange={setConversationFilter}
                                ariaLabel="AI 对话类型"
                            />
                        </div>
                        <DockPanelSearchInput
                            value={conversationSearch}
                            onChange={setConversationSearch}
                            placeholder="搜索对话"
                            ariaLabel="搜索 AI 对话"
                        />
                        <Button
                            type="button"
                            className="ai-sidebar-new-btn"
                            variant="primary"
                            size="sm"
                            onClick={() => void ctx.createNewConversation()}
                            disabled={ctx.isComposingNewConversation}
                            title="新对话"
                        >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
                                 strokeWidth="1.5">
                                <path d="M7 2v10M2 7h10"/>
                            </svg>
                            <span>新对话</span>
                        </Button>
                    </div>
                </div>
                <div className="ai-conversations-list">
                    {ctx.conversations.length === 0 && (
                        <div className="ai-empty-history"><p>暂无历史对话</p></div>
                    )}
                    {ctx.conversations.length > 0 && filteredConversations.length === 0 && (
                        <div className="ai-empty-history">
                            <p>{hasConversationSearch
                                ? '没有匹配的对话'
                                : conversationStatusFilter === 'archived'
                                    ? '暂无归档对话'
                                    : '当前类型下没有对话'}</p>
                        </div>
                    )}
                    {filteredConversations.map((conv) => {
                        const runtime = ctx.conversationRuntime[conv.id]
                        const isConversationStreaming = Boolean(runtime?.isStreaming)
                        const hasUnreadReply = Boolean(runtime?.hasUnreadReply)
                        const showUnreadReply = !isConversationStreaming && hasUnreadReply
                        const pinLabel = conv.pinnedAt ? '取消顶置' : '顶置'
                        const conversationTags = [
                            conv.pinnedAt ? '已顶置' : null,
                            conv.archivedAt ? '已归档' : null,
                            conv.mode === 'character' ? '角色对话' : null,
                            conv.mode === 'report' ? '矛盾检测' : null,
                        ].filter(Boolean).join(' · ')
                        const canExportConversation = !conv.id.startsWith('conv_')
                        return (
                            <div
                                key={conv.id}
                                className={`ai-conversation-row ${actionMenuConversationId === conv.id ? 'is-menu-open' : ''}`}
                                onMouseLeave={() => {
                                    if (actionMenuConversationId === conv.id) setActionMenuConversationId(null)
                                }}
                            >
                                <div
                                    className={`ai-conversation-item ${conv.id === ctx.activeConversationId ? 'active' : ''}${conv.mode === 'character' ? ' is-character' : ''}${conv.mode === 'report' ? ' is-report' : ''}${conv.pinnedAt ? ' is-pinned' : ''}${conv.archivedAt ? ' is-archived' : ''}${isConversationStreaming ? ' is-streaming' : ''}${hasUnreadReply ? ' has-unread-reply' : ''}`}
                                    onClick={() => {
                                        setActionMenuConversationId(null)
                                        if (renamingId !== conv.id) void ctx.switchConversation(conv.id)
                                    }}
                                    onContextMenu={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        setActionMenuPlacement(resolveActionMenuPlacement(event.currentTarget.getBoundingClientRect()))
                                        setActionMenuConversationId(conv.id)
                                    }}
                                >
                                    <div className="ai-conversation-leading">
                                        {showUnreadReply ? (
                                            <span className="ai-conversation-unread-dot" aria-hidden="true"/>
                                        ) : (
                                            <button
                                                className={`ai-conversation-pin-btn ${conv.pinnedAt ? 'is-pinned' : ''}`}
                                                onClick={(event) => {
                                                    event.stopPropagation()
                                                    ctx.toggleConversationPinned(conv.id, event)
                                                }}
                                                title={pinLabel}
                                                aria-label={pinLabel}
                                            >
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                                                     stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
                                                     strokeLinejoin="round">
                                                    <path d="M12 17v5"/>
                                                    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a2 2 0 0 1 2-2V3H7v2a2 2 0 0 1 2 2z"/>
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                    {conv.mode === 'character' && (
                                        <div className="ai-conversation-avatar" aria-hidden="true">
                                            {conv.backgroundImageUrl ? (
                                                <img src={conv.backgroundImageUrl}
                                                     alt={conv.characterName ?? conv.title}/>
                                            ) : (
                                                <span>{(conv.characterName ?? conv.title).slice(0, 1) || '角'}</span>
                                            )}
                                        </div>
                                    )}
                                    {conv.mode === 'report' && (
                                        <div className="ai-conversation-report-icon" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"
                                                 stroke="currentColor"
                                                 strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">
                                                <path
                                                    d="M8.1 2.7L2.4 12.6a1.4 1.4 0 001.2 2.1h10.8a1.4 1.4 0 001.2-2.1L9.9 2.7a1.04 1.04 0 00-1.8 0z"/>
                                                <path d="M9 6.2v3.4M9 12.2h.01"/>
                                            </svg>
                                        </div>
                                    )}
                                    <div className="ai-conversation-info">
                                        {renamingId === conv.id ? (
                                            <input
                                                ref={renameInputRef}
                                                className="ai-conversation-rename-input"
                                                value={renameValue}
                                                onChange={(event) => setRenameValue(event.target.value)}
                                                onKeyDown={handleRenameKey}
                                                onBlur={() => void commitRename()}
                                                onClick={(event) => event.stopPropagation()}
                                            />
                                        ) : (
                                            <>
                                                <div className="ai-conversation-title"
                                                     title={conv.title}>{conv.title}</div>
                                                {conversationTags && (
                                                    <div className="ai-conversation-subtitle">{conversationTags}</div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <div className="ai-conversation-actions">
                                        <button
                                            className={`ai-conversation-action-btn ai-conversation-more-btn ${actionMenuConversationId === conv.id ? 'active' : ''}`}
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                if (actionMenuConversationId === conv.id) {
                                                    setActionMenuConversationId(null)
                                                    return
                                                }
                                                setActionMenuPlacement(resolveActionMenuPlacement(event.currentTarget.getBoundingClientRect()))
                                                setActionMenuConversationId(conv.id)
                                            }}
                                            title="更多操作"
                                        >
                                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                                <circle cx="4" cy="8" r="1.35" fill="currentColor"/>
                                                <circle cx="8" cy="8" r="1.35" fill="currentColor"/>
                                                <circle cx="12" cy="8" r="1.35" fill="currentColor"/>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                {actionMenuConversationId === conv.id && (
                                    <div className={`ai-conversation-action-menu is-${actionMenuPlacement}`}
                                         onClick={(event) => event.stopPropagation()}>
                                        <button onClick={(event) => {
                                            ctx.toggleConversationPinned(conv.id, event)
                                            setActionMenuConversationId(null)
                                        }}>
                                            {conv.pinnedAt ? '取消顶置' : '顶置'}
                                        </button>
                                        <button onClick={(event) => {
                                            ctx.toggleConversationArchived(conv.id, event)
                                            setActionMenuConversationId(null)
                                        }}>
                                            {conv.archivedAt ? '取消归档' : '归档'}
                                        </button>
                                        <button onClick={(event) => startRename(event, conv)}>
                                            重命名
                                        </button>
                                        <button
                                            disabled={!canExportConversation}
                                            onClick={(event) => void handleExportConversation(event, conv, 'markdown')}
                                        >
                                            导出 Markdown
                                        </button>
                                        <button
                                            disabled={!canExportConversation}
                                            onClick={(event) => void handleExportConversation(event, conv, 'json')}
                                        >
                                            导出 JSON
                                        </button>
                                        <button
                                            className="danger"
                                            onClick={(event) => void handleDeleteConversation(event, conv)}
                                        >
                                            删除
                                        </button>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </DockPanelSide>
        </>
    )

    return (
        <>
            {sidePortalTarget ? createPortal(sidebarJsx, sidePortalTarget) : sidebarJsx}

            <DockPanelMain
                id={AI_CHAT_DROP_ZONE_ID}
                className={`ai-main${isCharacterConversation ? ' is-character' : ''}${isReportConversation ? ' is-report' : ''}`}>
                {isNativeFileDragActive && (
                    <div className="ai-document-drop-overlay" role="status">
                        松开以上传文档
                    </div>
                )}
                {isCharacterConversation && activeConversation?.backgroundImageUrl && (
                    <div className="ai-main-background" aria-hidden="true">
                        <img src={activeConversation.backgroundImageUrl}
                             alt={activeConversation.characterName ?? '角色背景'}/>
                    </div>
                )}
                <DockPanelTopbar className="ai-topbar">
                    <div className="ai-topbar-left">
                        {panelMode !== 'fullscreen' && (
                            <DockPanelIconButton
                                className="ai-topbar-toggle"
                                onClick={() => ctx.setSidebarCollapsed((prev) => !prev)}
                                title={ctx.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
                            >
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                     strokeWidth="1.5">
                                    {ctx.sidebarCollapsed ? (
                                        <path d="M6 3L11 8L6 13"/>
                                    ) : (
                                        <path d="M10 3L5 8L10 13"/>
                                    )}
                                </svg>
                            </DockPanelIconButton>
                        )}
                        <div className="ai-plugin-switcher" ref={pluginSwitcherRef}>
                            {isPluginMenuOpen && (
                                <div className="ai-plugin-menu">
                                    {ctx.plugins.map((plugin) => (
                                        <button
                                            key={plugin.id}
                                            className={`ai-plugin-menu-item ${plugin.id === activeLlmPluginId ? 'active' : ''}`}
                                            onClick={() => {
                                                const model = plugin.default_model && plugin.models.includes(plugin.default_model)
                                                    ? plugin.default_model
                                                    : (plugin.models[0] ?? '')
                                                void ctx.switchActiveConversationModel(plugin.id, model)
                                                setIsPluginMenuOpen(false)
                                            }}
                                        >
                                            {plugin.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <button
                                className={`ai-topbar-btn ${isPluginMenuOpen ? 'active' : ''}`}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    setIsPluginMenuOpen((prev) => !prev)
                                }}
                                title="切换插件"
                            >
                                <span>{activeLlmPluginInfo?.name || '选择插件'}</span>
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
                                     strokeWidth="1.5">
                                    <path d={isPluginMenuOpen ? 'M1 7l4-4 4 4' : 'M1 3l4 4 4-4'}/>
                                </svg>
                            </button>
                        </div>
                        {showFocusContext && (
                            <div className="ai-focus-context" aria-label="当前 AI 上下文" ref={focusContextRef}>
                                {focusContextItems.map((item) => (
                                    <span
                                        key={item.key}
                                        className="ai-focus-chip"
                                        title={item.label}
                                        data-overflow={overflowingFocusChips[item.key] ? 'true' : 'false'}
                                    >
                                        <span
                                            className="ai-focus-chip__text"
                                            ref={(element) => {
                                                focusChipTextRefs.current[item.key] = element
                                            }}
                                        >
                                            {item.label}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="ai-topbar-right">
                        <DockPanelIconButton
                            className="ai-topbar-new-chat"
                            onClick={() => void ctx.createNewConversation()}
                            disabled={ctx.isComposingNewConversation}
                            title="新对话"
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                 strokeWidth="1.5">
                                <path d="M8 3v10M3 8h10"/>
                            </svg>
                        </DockPanelIconButton>
                        <DockPanelIconButton
                            className="ai-topbar-toggle"
                            onClick={() => onTogglePanelMode?.()}
                            title={panelMode === 'fullscreen' ? '退出全屏' : '全屏模式'}
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                 strokeWidth="1.5">
                                {panelMode === 'fullscreen' ? (
                                    <>
                                        <path d="M4 10v2h2M10 12h2v-2M12 4v2h-2M6 4H4v2"/>
                                    </>
                                ) : (
                                    <>
                                        <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/>
                                    </>
                                )}
                            </svg>
                        </DockPanelIconButton>
                        <DockPanelIconButton
                            className="ai-topbar-toggle"
                            onClick={() => onToggleCollapsed?.()}
                            title="最小化"
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                 strokeWidth="1.5">
                                <path d="M6 4l4 4-4 4"/>
                            </svg>
                        </DockPanelIconButton>
                    </div>
                </DockPanelTopbar>

                <RollingBox axis="y"
                    className="ai-messages-container"
                    ref={messagesContainerRef}
                    onScroll={() => {
                        handleMessagesScroll()
                        linkPreview.closeLinkPreview()
                    }}
                    thumbSize={'thin'}
                >
                    {isReportConversation && activeConversation?.reportContext && (
                        <div className="ai-report-context-bar fc-status-banner">
                            <div className="ai-report-context-icon" aria-hidden="true">
                                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor"
                                     strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                    <path
                                        d="M8.1 2.7L2.4 12.6a1.4 1.4 0 001.2 2.1h10.8a1.4 1.4 0 001.2-2.1L9.9 2.7a1.04 1.04 0 00-1.8 0z"/>
                                    <path d="M9 6.2v3.4M9 12.2h.01"/>
                                </svg>
                            </div>
                            <div className="ai-report-context-main">
                                <div className="ai-report-context-title">
                                    <span>矛盾检测</span>
                                    <strong>{activeConversation.reportContext.projectName}</strong>
                                </div>
                                <div
                                    className="ai-report-context-scope">{activeConversation.reportContext.scopeSummary}</div>
                            </div>
                        </div>
                    )}
                    {ctx.activeConversationId && ctx.messages.length > 0 && (
                        <div
                            className="ai-messages-list"
                            onClick={handleEntryLinkClick}
                            onMouseOver={handleEntryLinkMouseOver}
                            onMouseOut={handleEntryLinkMouseOut}
                        >
                            {ctx.messages.map((message, messageIndex) => {
                                const canRetry = ctx.messages
                                    .slice(0, messageIndex)
                                    .some(item => item.role === 'user' && item.nodeId != null)
                                const isContinuing = Boolean(
                                    ctx.isStreaming
                                    && ctx.continuationNodeId != null
                                    && ctx.continuationNodeId === message.nodeId,
                                )
                                const canContinue = Boolean(
                                    !ctx.isStreaming
                                    && ctx.continuationSubmittingMessageId !== message.id
                                    && message.nodeId != null
                                    && isIncompleteMessage(message),
                                )
                                const visibleBlocks = isContinuing
                                    ? [...(message.blocks ?? []), ...ctx.streamingBlocks]
                                    : message.blocks
                                const hasRenderableMessage = Boolean(
                                    message.content || message.reasoning || visibleBlocks?.length,
                                )
                                return (
                                    <div
                                        key={message.id}
                                        className={`ai-message-frame ai-message-frame--${message.role}`}
                                    >
                                        {message.role === 'user' && (
                                            <AiMessageAttachments attachments={message.attachments}/>
                                        )}
                                        {hasRenderableMessage || !message.error ? (
                                            <MessageBox
                                                role={message.role}
                                                blocks={message.role === 'assistant'
                                                    ? buildRenderableAiChatBlocks(visibleBlocks, !isContinuing)
                                                    : visibleBlocks}
                                                contextDisplay={message.role === 'assistant' ? 'compact' : 'full'}
                                                content={message.role === 'assistant'
                                                    ? buildRenderableAiChatMarkdown(message.content)
                                                    : message.content}
                                                toolCallDetail={'verbose'}
                                                markdown={message.role === 'assistant'}
                                                lineHeight={1.5}
                                                reasoning={message.reasoning || undefined}
                                                streaming={isContinuing}
                                                rolePlaying={roleplayTtsEnabled && message.role === 'assistant' && !isContinuing}
                                                onCopy={() => navigator.clipboard.writeText(message.content)}
                                                onPlay={roleplayTtsEnabled && message.role === 'assistant' && !isContinuing
                                                    ? () => void handlePlayRoleMessage(
                                                        message.content,
                                                        'manual',
                                                    )
                                                    : undefined}
                                                onEdit={message.role === 'user'
                                                    ? () => ctx.editMessage(message.id)
                                                    : undefined}
                                                onRegenerate={message.role === 'assistant'
                                                && !message.error
                                                && !isIncompleteMessage(message)
                                                    ? () => {
                                                        logger.log('[AIChatContent] 点击重说', {
                                                            messageId: message.id,
                                                            conversationId: ctx.activeConversationId,
                                                        })
                                                        void ctx.regenerateMessage(message.id)
                                                    }
                                                    : undefined}
                                            />
                                        ) : null}
                                        {message.error ? (
                                            <AiChatErrorNotice
                                                error={message.error}
                                                onRetry={message.error.code === ErrorCode.ContextBudgetExceeded
                                                    ? () => void ctx.compactAndRetryMessage(message.id)
                                                    : canContinue
                                                    ? () => void ctx.continueMessage(message.id)
                                                    : canRetry
                                                        ? () => void ctx.regenerateMessage(message.id)
                                                        : undefined}
                                                retryLabel={message.error.code === ErrorCode.ContextBudgetExceeded
                                                    ? '立即压缩并重试'
                                                    : canContinue ? '继续' : '重试'}
                                                onOpenSettings={onOpenPluginManagement
                                                    ? () => onOpenPluginManagement('llm')
                                                    : undefined}
                                            />
                                        ) : null}
                                        {!message.error && canContinue ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                onClick={() => void ctx.continueMessage(message.id)}
                                            >
                                                继续
                                            </Button>
                                        ) : null}
                                    </div>
                                )
                            })}
                            {ctx.isStreaming
                            && ctx.continuationNodeId == null
                            && ctx.streamingBlocks.length === 0 && (
                                <AiResponsePendingIndicator/>
                            )}
                            {ctx.streamingBlocks.length > 0
                            && ctx.isStreaming
                            && ctx.continuationNodeId == null && (
                                <MessageBox
                                    role="assistant"
                                    blocks={buildRenderableAiChatBlocks(ctx.streamingBlocks)}
                                    lineHeight={1.5}
                                    streaming
                                    markdown
                                    toolCallDetail={'verbose'}
                                />
                            )}
                        </div>
                    )}
                </RollingBox>

                <EntryEditorLinkPreview
                    linkPreview={linkPreview.linkPreview}
                    linkPreviewPosition={linkPreview.linkPreviewPosition}
                    linkPreviewEntry={linkPreview.linkPreviewEntry}
                    panelRef={linkPreviewPanelRef}
                    anchorRef={linkPreview.linkPreviewAnchorRef}
                    onClearCloseTimer={linkPreview.clearLinkPreviewCloseTimer}
                    onScheduleClose={linkPreview.scheduleLinkPreviewClose}
                />

                <div className="ai-floating-input-wrapper ai-floating-input-wrapper--full">
                    {ctx.activeConversationId && ctx.messages.length > 0 && !autoScroll && (
                        <div className="ai-scroll-to-bottom-sticky">
                            <button className="ai-scroll-to-bottom-btn" onClick={scrollToBottom} title="滚动到底部">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                     strokeWidth="1.8">
                                    <path d="M3 6l5 5 5-5"/>
                                </svg>
                            </button>
                        </div>
                    )}
                    {activeConversation && settingsDrawerMounted && (
                        <div
                            ref={settingsDrawerRef}
                            className={`ai-conversation-settings-panel ${settingsDrawerOpen ? 'is-open' : 'is-closing'}`}
                            onAnimationEnd={handleSettingsDrawerAnimationEnd}
                        >
                            <div className="ai-conversation-settings-grid">
                                <label className="ai-conversation-settings-field" title={CONVERSATION_SETTING_TOOLTIPS.temperature}>
                                    <span>温度</span>
                                    <ConversationNumberInput
                                        value={conversationSettings.temperature}
                                        min={0}
                                        max={CONVERSATION_TEMPERATURE_MAX}
                                        step={0.1}
                                        onCommit={(value) => updateConversationSetting(
                                            'temperature',
                                            value,
                                        )}
                                    />
                                </label>
                                <label className="ai-conversation-settings-field" title={CONVERSATION_SETTING_TOOLTIPS.topP}>
                                    <span>回答开放度</span>
                                    <ConversationNumberInput
                                        value={conversationSettings.topP}
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        onCommit={(value) => updateConversationSetting(
                                            'topP',
                                            value,
                                        )}
                                    />
                                </label>
                                <div
                                    className="ai-conversation-settings-field ai-conversation-settings-field--penalty"
                                    title={CONVERSATION_SETTING_TOOLTIPS.frequencyPenalty}
                                >
                                    <label>
                                        <span>重复惩罚</span>
                                        <input
                                            type="checkbox"
                                            checked={conversationSettings.frequencyPenaltyEnabled}
                                            onChange={(event) => updateConversationSetting(
                                                'frequencyPenaltyEnabled',
                                                event.currentTarget.checked,
                                            )}
                                        />
                                    </label>
                                    <ConversationNumberInput
                                        value={conversationSettings.frequencyPenalty}
                                        min={-2}
                                        max={2}
                                        step={0.1}
                                        disabled={!conversationSettings.frequencyPenaltyEnabled}
                                        onCommit={(value) => updateConversationSetting(
                                            'frequencyPenalty',
                                            value,
                                        )}
                                    />
                                </div>
                                <div
                                    className="ai-conversation-settings-field ai-conversation-settings-field--penalty"
                                    title={CONVERSATION_SETTING_TOOLTIPS.presencePenalty}
                                >
                                    <label>
                                        <span>存在惩罚</span>
                                        <input
                                            type="checkbox"
                                            checked={conversationSettings.presencePenaltyEnabled}
                                            onChange={(event) => updateConversationSetting(
                                                'presencePenaltyEnabled',
                                                event.currentTarget.checked,
                                            )}
                                        />
                                    </label>
                                    <ConversationNumberInput
                                        value={conversationSettings.presencePenalty}
                                        min={-2}
                                        max={2}
                                        step={0.1}
                                        disabled={!conversationSettings.presencePenaltyEnabled}
                                        onCommit={(value) => updateConversationSetting(
                                            'presencePenalty',
                                            value,
                                        )}
                                    />
                                </div>
                            </div>
                            <label className="ai-conversation-settings-prompt" title={CONVERSATION_SETTING_TOOLTIPS.systemPrompt}>
                                <span>当前对话独有 AI 指令</span>
                                <textarea
                                    value={conversationSettings.systemPrompt}
                                    onChange={(event) => updateConversationSetting('systemPrompt', event.currentTarget.value)}
                                    placeholder="例如：保持回答简洁，优先延续当前世界观设定。"
                                />
                            </label>
                        </div>
                    )}
                    <div className="ai-floating-input-inner" ref={inputWikiContainerRef}>
                        {ctx.editingMessageId && (
                            <div className="ai-edit-indicator">
                                <span>正在编辑上一条消息</span>
                                <Button type="button" variant="ghost" size="xs" onClick={() => {
                                    ctx.setEditingMessageId(null)
                                    ctx.setInputValue('')
                                }}>取消
                                </Button>
                            </div>
                        )}
                        {isArchivedConversation && activeConversation && (
                            <div className="ai-archived-input-hint" role="status">
                                <span>会话已归档，取消归档后可继续对话。</span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={(event) => ctx.toggleConversationArchived(activeConversation.id, event)}
                                >
                                    取消归档
                                </Button>
                            </div>
                        )}
                        {!isArchivedConversation && llmApiKeyMissing && (
                            <div className="ai-api-key-input-hint" role="status" aria-live="polite">
                                <span>AI 对话插件「{activeLlmPluginName}」尚未配置访问密钥。</span>
                                {onOpenPluginManagement && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => onOpenPluginManagement('llm')}
                                    >
                                        去配置
                                    </Button>
                                )}
                            </div>
                        )}
                        {isCharacterConversation && ttsUnavailable && (
                            <AiPluginMissingOverlay
                                kind="tts"
                                variant="inline"
                                onOpenPluginManagement={onOpenPluginManagement}
                            />
                        )}
                        {visibleDocumentContextItems.length > 0 && (
                            <DocumentContextRail
                                items={visibleDocumentContextItems}
                                onRetry={(itemId) => void ctx.retryDocumentContextItem(itemId)}
                                onRemove={(itemId) => void ctx.removeDocumentContextItem(itemId)}
                            />
                        )}
                        <div className="ai-input-meta-row">
                            <div className="ai-input-meta-controls">
                                <button
                                    ref={settingsToggleRef}
                                    type="button"
                                    className="ai-input-meta-btn ai-conversation-settings-toggle"
                                    disabled={!activeConversation}
                                    aria-expanded={settingsDrawerOpen}
                                    title={activeConversation ? '当前对话属性设置' : '发送消息后可设置当前对话属性'}
                                    onClick={toggleSettingsDrawer}
                                >
                                    <svg viewBox="0 0 16 16" aria-hidden="true">
                                        <path d="M6 3.5 10.5 8 6 12.5"/>
                                    </svg>
                                    <span>对话属性</span>
                                </button>
                                <div className="ai-model-switcher ai-model-switcher--meta" ref={modelSwitcherRef}>
                                    {isModelMenuOpen && modelPluginInfo && (
                                        <div className="ai-model-menu">
                                            {modelPluginInfo.models.map((model) => (
                                                <button
                                                    key={model}
                                                    className={`ai-model-menu-item ${model === contextModelId ? 'active' : ''}`}
                                                    onClick={() => {
                                                        void ctx.switchActiveConversationModel(activeLlmPluginId, model)
                                                        setIsModelMenuOpen(false)
                                                    }}
                                                >
                                                    {model}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        className={`ai-input-meta-btn ai-model-switcher-btn ${isModelMenuOpen ? 'active' : ''}`}
                                        aria-expanded={isModelMenuOpen}
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            setIsModelMenuOpen((prev) => !prev)
                                        }}
                                        title="切换模型"
                                    >
                                        <svg viewBox="0 0 16 16" aria-hidden="true">
                                            <path d="M6 3.5 10.5 8 6 12.5"/>
                                        </svg>
                                        <span>{contextModelId || '选择模型'}</span>
                                    </button>
                                </div>
                            </div>
                            {showContextUsageIndicator && (
                                <div
                                    className="ai-context-usage-indicator"
                                    title={contextUsage.title}
                                    aria-label={contextUsage.title}
                                >
                                    <svg className="ai-context-usage-ring" viewBox="0 0 28 28" aria-hidden="true">
                                        <circle
                                            className="ai-context-usage-ring-track"
                                            cx="14"
                                            cy="14"
                                            r={CONTEXT_USAGE_RING_RADIUS}
                                        />
                                        <circle
                                            className="ai-context-usage-ring-value"
                                            cx="14"
                                            cy="14"
                                            r={CONTEXT_USAGE_RING_RADIUS}
                                            strokeDasharray={CONTEXT_USAGE_RING_CIRCUMFERENCE}
                                            strokeDashoffset={contextUsageDashOffset}
                                        />
                                    </svg>
                                    <span>{contextUsage.label}</span>
                                </div>
                            )}
                        </div>
                        <textarea
                            ref={textareaRef}
                            className="ai-floating-textarea"
                            value={ctx.inputValue}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            onKeyUp={(event) => inputWikiLink.handleMarkdownCursorSync(event.currentTarget)}
                            onClick={(event) => inputWikiLink.handleMarkdownCursorSync(event.currentTarget)}
                            onSelect={(event) => inputWikiLink.handleMarkdownCursorSync(event.currentTarget)}
                            onScroll={(event) => inputWikiLink.updateWikiPopoverPosition(event.currentTarget)}
                            onBlur={() => inputWikiLink.handleTextareaBlur()}
                            disabled={
                                isArchivedConversation
                                || llmUnavailable
                                || llmApiKeyMissing
                                || ctx.isCompacting
                            }
                            placeholder={isArchivedConversation
                                ? '取消归档后继续对话'
                                : llmUnavailable
                                    ? '安装 AI 对话插件后继续对话'
                                    : llmApiKeyMissing
                                        ? '配置访问密钥后继续对话'
                                        : ctx.isCompacting
                                            ? '正在压缩对话历史…'
                                            : '请输入消息...'}
                        />
                        {ctx.isCompacting ? (
                            <div className="ai-input-limit-hint" role="status">
                                正在压缩对话历史…
                            </div>
                        ) : null}
                        {inputLimitMessage && (
                            <div className="ai-input-limit-hint" role="status">
                                {inputLimitMessage}
                            </div>
                        )}
                        <EntryEditorWikiLink
                            wikiDraft={inputWikiLink.wikiDraft}
                            wikiPopoverPosition={inputWikiLink.wikiPopoverPosition}
                            wikiLinkOptions={inputWikiLink.wikiLinkOptions}
                            activeWikiOptionIndex={inputWikiLink.activeWikiOptionIndex}
                            creatingLinkedEntry={inputWikiLink.creatingLinkedEntry}
                            hasExactCategorySuggestion={inputWikiLink.hasExactCategorySuggestion}
                            categories={[]}
                            popoverRef={inputWikiPopoverRef}
                            optionRefs={inputWikiLink.wikiOptionRefs}
                            onOptionCommit={inputWikiLink.handleWikiOptionCommit}
                            onActiveIndexChange={inputWikiLink.setActiveWikiOptionIndex}
                        />
                        <div className="ai-floating-footer">
                            <div className="ai-floating-toolbar">
                                <button
                                    className={`ai-toolbar-btn ${ctx.sessionParams.thinking ? 'active' : ''}`}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        ctx.setSessionParams((prev) => ({...prev, thinking: !prev.thinking}))
                                    }}
                                    title="深度思考"
                                >
                                    深度思考
                                </button>
                                {isCharacterConversation && activeConversation && !ttsUnavailable && (
                                    <button
                                        className={`ai-toolbar-btn ${effectiveRoleplayAutoPlay ? 'active' : ''}`}
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            const nextAutoPlay = !effectiveRoleplayAutoPlay
                                            ctx.updateConversationCharacterAutoPlay(activeConversation.id, nextAutoPlay)
                                        }}
                                        title="自动播放角色回复"
                                    >
                                        自动播放
                                    </button>
                                )}
                                {!isCharacterConversation && (
                                    <>
                                        <button
                                            className={`ai-toolbar-btn ${ctx.webSearchEnabled ? 'active' : ''}`}
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                void ctx.toggleWebSearch()
                                            }}
                                            title="联网搜索"
                                        >
                                            联网搜索
                                        </button>
                                        <div className="ai-tool-access-select" ref={toolAccessSelectRef}>
                                            <button
                                                type="button"
                                                className={`ai-toolbar-btn ai-tool-access-select-btn active ${ctx.toolAccessMode === 'reader' ? 'is-reader' : ''} ${ctx.toolAccessMode === 'writer' ? 'is-writer' : ''}`}
                                                onClick={(event) => {
                                                    event.stopPropagation()
                                                    setIsToolAccessMenuOpen((open) => !open)
                                                }}
                                                title={AI_TOOL_ACCESS_TITLES[ctx.toolAccessMode]}
                                                aria-haspopup="listbox"
                                                aria-expanded={isToolAccessMenuOpen}
                                            >
                                                <AiToolAccessIcon
                                                    mode={ctx.toolAccessMode}
                                                    className="ai-tool-access-icon"
                                                />
                                                <span>{AI_TOOL_ACCESS_LABELS[ctx.toolAccessMode]}</span>
                                            </button>
                                            {isToolAccessMenuOpen && (
                                                <div className="ai-tool-access-menu" role="listbox">
                                                    {toolAccessOptions.map((mode) => (
                                                        <button
                                                            key={mode}
                                                            type="button"
                                                            role="option"
                                                            aria-selected={ctx.toolAccessMode === mode}
                                                            className={`ai-tool-access-menu-item is-${mode} ${ctx.toolAccessMode === mode ? 'active' : ''}`}
                                                            title={AI_TOOL_ACCESS_TITLES[mode]}
                                                            onClick={(event) => {
                                                                event.stopPropagation()
                                                                void handleToolAccessModeSelect(mode)
                                                            }}
                                                        >
                                                            <AiToolAccessIcon
                                                                mode={mode}
                                                                className="ai-tool-access-menu-item-icon"
                                                            />
                                                            <span>{AI_TOOL_ACCESS_LABELS[mode]}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="ai-floating-actions">
                                {showCharHint && (
                                    <span className="ai-floating-char-count">{charCount}/{MAX_CHARS}</span>
                                )}
                                <button
                                    type="button"
                                    className="ai-floating-attach-btn"
                                    disabled={!activeConversation || isArchivedConversation}
                                    title={activeConversation ? '添加文档上下文' : '创建对话后可添加文档上下文'}
                                    aria-label="添加文档上下文"
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        void handleAttachDocuments()
                                    }}
                                >
                                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
                                         stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"
                                         strokeLinejoin="round" aria-hidden="true">
                                        <path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.8-9.8a4 4 0 0 1 5.7 5.7l-9.8 9.8a2 2 0 1 1-2.8-2.8l9.4-9.4"/>
                                    </svg>
                                </button>
                                {ctx.isStreaming ? (
                                    <button
                                        className="ai-floating-stop-btn"
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            ctx.stopStreaming()
                                        }}
                                        title="停止生成"
                                    >
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                            <rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor"/>
                                        </svg>
                                    </button>
                                ) : (
                                    <button
                                        className="ai-floating-send-btn"
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            if (!ctx.inputValue.trim()) return
                                            void handleSendCurrentInput()
                                        }}
                                        disabled={Boolean(sendDisabledReason)}
                                        title={sendDisabledReason || '发送'}
                                    >
                                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
                                             strokeLinejoin="round">
                                            <path d="M12 20V4"/>
                                            <path d="M4.5 11.5L12 4l7.5 7.5"/>
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </DockPanelMain>
        </>
    )
}
