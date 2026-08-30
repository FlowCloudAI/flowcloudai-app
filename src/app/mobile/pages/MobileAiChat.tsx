import {
    type MouseEvent as ReactMouseEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {useDrag} from '@use-gesture/react'
import {createPortal} from 'react-dom'
import {useAlert} from 'flowcloudai-ui'
import {useAiController} from '../../../features/ai-chat/hooks/useAiController'
import {useAppSettingsStore} from '../../../features/settings/appSettingsStore'
import {
    normalizeConversationSettings,
    type AiToolAccessMode,
    type Conversation,
    type ConversationSettings,
} from '../../../features/ai-chat/model/AiControllerTypes'
import {isPendingConversationId} from '../../../features/ai-chat/model/conversationState'
import {
    type MobileAnchoredMenuItem,
    MobileAddIcon,
    MobileMenuIcon,
    MobileMoreIcon,
    MobilePageTopBar,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import MobileAiConversationControls from './MobileAiConversationControls'
import MobileAiConversationDrawer from './MobileAiConversationDrawer'
import MobileAiComposer from './MobileAiComposer'
import MobileAiMessageList from './MobileAiMessageList'
import {
    AI_TOOL_ACCESS_DETAILS,
    AI_TOOL_ACCESS_LABELS,
    AI_TOOL_ACCESS_OPTIONS,
    buildConversationSearchText,
    CONVERSATION_LONG_PRESS_DELAY,
    CONVERSATION_LONG_PRESS_MOVE_TOLERANCE,
    matchesConversationFilter,
    MobileAiIcon,
    sortConversations,
    type AiConversationFilter,
    type AiConversationStatusFilter,
    type ConversationLongPressState,
} from './MobileAiChatUi'
import type {MobileAiChatProps} from './MobileAiChat.types'
import {runMobileViewTransition} from './mobileViewTransition'
import {useMobileAiApiKeyAvailability} from './useMobileAiApiKeyAvailability'
import {useMobileAiMessageScroll} from './useMobileAiMessageScroll'
import {useMobileAiMessageLinks} from './useMobileAiMessageLinks'
import {useMobileAiMessageActions} from './useMobileAiMessageActions'
import {useMobileAiConversationFiles} from './useMobileAiConversationFiles'
import {useMobileAiComposerClearance} from './useMobileAiComposerClearance'
import {useAiContextUsage} from '../../../features/ai-chat/hooks/useAiContextUsage'
import './MobileAiChat.css'

export default function MobileAiChat({
    aiFocus,
    active,
    keyboardVisible,
    navigateToTab,
    conversationDrawerOpen = false,
    onOpenConversationDrawer,
    onCloseConversationDrawer,
    onStartReportDiscussionReady,
    onStartCharacterConversationReady,
}: MobileAiChatProps) {
    const {showAlert} = useAlert()
    const appSettings = useAppSettingsStore()
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const pageRef = useRef<HTMLDivElement>(null)
    const composerRef = useRef<HTMLElement>(null)
    const topActionsRef = useRef<HTMLDivElement>(null)
    useMobileAiComposerClearance(pageRef, composerRef)

    const controller = useAiController(aiFocus)
    const {
        conversations, activeConversationId, activeConversation: controllerActiveConversation,
        isComposingNewConversation,
        messages, sendMessage, stopStreaming,
        regenerateMessage, compactAndRetryMessage, continueMessage,
        editMessage, editingMessageId, setEditingMessageId,
        inputValue, setInputValue, isStreaming, isCompacting, streamingBlocks, continuationNodeId,
        continuationSubmittingMessageId,
        conversationRuntime, switchConversation, createNewConversation, deleteConversation,
        renameConversation, toggleConversationPinned, toggleConversationArchived,
        addDocumentContextFiles, documentContextItems, removeDocumentContextItem, retryDocumentContextItem,
        plugins, pluginsReady, selectedPlugin, selectedModel,
        webSearchEnabled, toggleWebSearch,
        toolAccessMode, writerModeAvailable, setToolAccessMode, sessionParams, setSessionParams,
        updateConversationSettings, switchActiveConversationModel, focusContext,
        autoScroll, setAutoScroll,
        startReportDiscussion, startCharacterConversation,
    } = controller

    useEffect(() => {
        onStartReportDiscussionReady?.(startReportDiscussion)
        return () => onStartReportDiscussionReady?.(null)
    }, [onStartReportDiscussionReady, startReportDiscussion])

    useEffect(() => {
        onStartCharacterConversationReady?.(startCharacterConversation)
        return () => onStartCharacterConversationReady?.(null)
    }, [onStartCharacterConversationReady, startCharacterConversation])

    const [conversationSearch, setConversationSearch] = useState('')
    const [conversationStatusFilter, setConversationStatusFilter] = useState<AiConversationStatusFilter>('active')
    const [conversationFilter, setConversationFilter] = useState<AiConversationFilter>('all')
    const [drawerRoot, setDrawerRoot] = useState<HTMLElement | null>(null)
    const [topMenuOpen, setTopMenuOpen] = useState(false)
    const [modelMenuOpen, setModelMenuOpen] = useState(false)
    const [modelMenuMode, setModelMenuMode] = useState<'models' | 'plugins'>('models')
    const [toolModeMenuOpen, setToolModeMenuOpen] = useState(false)
    const [morePanelOpen, setMorePanelOpen] = useState(false)
    const [contextUsageOpen, setContextUsageOpen] = useState(false)
    const [renameTarget, setRenameTarget] = useState<Conversation | null>(null)
    const [conversationActionTarget, setConversationActionTarget] = useState<Conversation | null>(null)
    const [renaming, setRenaming] = useState(false)
    const conversationLongPressRef = useRef<ConversationLongPressState | null>(null)
    const suppressConversationClickRef = useRef(false)
    const modelMenuRef = useRef<HTMLButtonElement>(null)
    const toolModeMenuRef = useRef<HTMLButtonElement>(null)
    const contextUsageRef = useRef<HTMLButtonElement>(null)

    const activeConversation = controllerActiveConversation ?? null
    const isCharacterConversation = activeConversation?.mode === 'character'
    const activeLlmPluginId = activeConversation?.pluginId || selectedPlugin
    const activeLlmPluginInfo = useMemo(
        () => plugins.find(plugin => plugin.id === activeLlmPluginId) ?? null,
        [activeLlmPluginId, plugins],
    )
    const activeLlmPluginName = activeLlmPluginInfo?.name || activeLlmPluginId || '当前 AI 对话插件'
    const activeModelId = activeConversation?.model || selectedModel
    const activeModelInfo = activeLlmPluginInfo?.model_infos.find(modelInfo => modelInfo.id === activeModelId)
    const activeModelLabel = activeModelInfo?.name && activeModelInfo.name !== activeModelId
        ? activeModelInfo.name
        : activeModelId || '未选择模型'
    const modelPillUsesExpandedWidth = activeModelLabel.length >= 12
    const activeModelOptions = useMemo(() => {
        if (!activeLlmPluginInfo) return []
        return activeLlmPluginInfo.models.map(modelId => {
            const modelInfo = activeLlmPluginInfo.model_infos.find(item => item.id === modelId)
            return {
                id: modelId,
                label: modelInfo?.name && modelInfo.name !== modelId ? modelInfo.name : modelId,
                description: modelInfo?.description || (modelInfo?.name && modelInfo.name !== modelId ? modelId : ''),
            }
        })
    }, [activeLlmPluginInfo])
    const toolModeOptions = useMemo(() => AI_TOOL_ACCESS_OPTIONS.map(mode => ({
        mode,
        label: AI_TOOL_ACCESS_LABELS[mode],
        description: AI_TOOL_ACCESS_DETAILS[mode],
    })), [])
    const conversationSettings = useMemo(
        () => normalizeConversationSettings(activeConversation?.settings),
        [activeConversation?.settings],
    )
    const normalizedConversationSearch = conversationSearch.trim().toLocaleLowerCase()
    const visibleConversations = useMemo(() => {
        return [...conversations]
            .filter(conversation => {
                if (conversationStatusFilter === 'active' && conversation.archivedAt) return false
                if (conversationStatusFilter === 'archived' && !conversation.archivedAt) return false
                if (!matchesConversationFilter(conversation, conversationFilter)) return false
                if (!normalizedConversationSearch) return true
                return buildConversationSearchText(conversation).includes(normalizedConversationSearch)
            })
            .sort(sortConversations)
    }, [conversationFilter, conversations, conversationStatusFilter, normalizedConversationSearch])
    const hasConversationSearch = normalizedConversationSearch.length > 0
    const pluginsLoading = !pluginsReady
    const llmUnavailable = pluginsReady && plugins.length === 0
    const llmApiKeyAvailability = useMobileAiApiKeyAvailability({
        pluginId: activeLlmPluginId,
        pluginsReady,
        pluginUnavailable: llmUnavailable,
    })
    const pluginSelectionIncomplete = pluginsReady && plugins.length > 0 && (!selectedPlugin || !selectedModel)
    const llmApiKeyChecking = pluginsReady
        && !llmUnavailable
        && Boolean(activeLlmPluginId)
        && llmApiKeyAvailability === 'checking'
    const llmApiKeyMissing = pluginsReady
        && !llmUnavailable
        && Boolean(activeLlmPluginId)
        && llmApiKeyAvailability === 'missing'
    const isArchivedConversation = Boolean(activeConversation?.archivedAt)
    const conversationCreationDisabled = pluginsLoading
        || llmUnavailable
        || pluginSelectionIncomplete
        || llmApiKeyChecking
        || llmApiKeyMissing
        || isCompacting
        || isComposingNewConversation
    const inputDisabled = !activeConversation
        || isArchivedConversation
        || pluginsLoading
        || llmUnavailable
        || pluginSelectionIncomplete
        || llmApiKeyChecking
        || llmApiKeyMissing
    const inputPlaceholder = !activeConversation
        ? '先新建一个对话'
        : isArchivedConversation
            ? '已归档对话不可继续发送'
            : pluginsLoading
                ? '正在加载 AI 对话插件…'
                : llmUnavailable
                    ? '请先配置 AI 对话插件'
                    : pluginSelectionIncomplete
                        ? '请选择插件和模型'
                    : llmApiKeyChecking
                            ? '正在检查访问密钥…'
                            : llmApiKeyMissing
                                ? '请先配置访问密钥'
                                : isCompacting
                                    ? '正在压缩对话历史…'
                                    // 全仓没有任何语音输入实现，占位文案不能承诺「按住说话」。
                                    : '发消息'

    const messageListEmpty = messages.length === 0 && !isStreaming
    useMobileAiMessageScroll({
        active,
        activeConversationId,
        autoScroll,
        keyboardVisible,
        messageCount: messages.length,
        messageListEmpty,
        messagesEndRef,
        setAutoScroll,
        streamingBlocks,
    })

    useEffect(() => {
        setDrawerRoot(document.getElementById('mobile-ai-conversation-drawer-root'))
    }, [conversationDrawerOpen])

    useEffect(() => {
        return () => {
            const conversationLongPress = conversationLongPressRef.current
            if (conversationLongPress?.timerId != null) {
                window.clearTimeout(conversationLongPress.timerId)
            }
        }
    }, [])

    const handleToolModeChange = useCallback(async (mode: AiToolAccessMode) => {
        if (mode === toolAccessMode) return
        if (mode === 'writer' && !writerModeAvailable) {
            const confirmed = await showAlert(
                '作家模式会跳过新建、改写、移动等常规操作确认，\nAI 将更容易直接改动项目内容；\n删除操作仍会要求确认。\n\n需要先在设置中手动开启后才能使用。是否前往设置？',
                'warning',
                'confirm',
            )
            if (confirmed === 'yes') {
                navigateToTab('settings')
            }
            return
        }
        await setToolAccessMode(mode)
    }, [navigateToTab, setToolAccessMode, showAlert, toolAccessMode, writerModeAvailable])

    const activeToolModeShortLabel = AI_TOOL_ACCESS_LABELS[toolAccessMode].replace(/模式$/, '')

    const openMorePanel = useCallback(() => {
        setToolModeMenuOpen(false)
        setMorePanelOpen(true)
    }, [])

    const closeMorePanel = useCallback(() => {
        setMorePanelOpen(false)
    }, [])

    const closeModelMenu = useCallback(() => {
        setModelMenuOpen(false)
        setModelMenuMode('models')
    }, [])

    const changeModelMenuMode = useCallback((mode: 'models' | 'plugins') => {
        if (mode === modelMenuMode) return
        runMobileViewTransition(() => setModelMenuMode(mode))
    }, [modelMenuMode])

    const closeTopMenu = useCallback(() => {
        setTopMenuOpen(false)
    }, [])

    const handleToggleModelMenu = useCallback(() => {
        setTopMenuOpen(false)
        setToolModeMenuOpen(false)
        setModelMenuOpen(open => !open)
        setModelMenuMode('models')
    }, [])

    const handleToggleTopMenu = useCallback(() => {
        setModelMenuOpen(false)
        setModelMenuMode('models')
        setToolModeMenuOpen(false)
        setTopMenuOpen(open => !open)
    }, [])

    const handleSelectModel = useCallback(async (modelId: string) => {
        if (!activeLlmPluginId) return
        closeModelMenu()
        await switchActiveConversationModel(activeLlmPluginId, modelId)
    }, [activeLlmPluginId, closeModelMenu, switchActiveConversationModel])

    const handleSelectPlugin = useCallback(async (pluginId: string) => {
        const plugin = plugins.find(item => item.id === pluginId)
        if (!plugin) return
        const nextModel = plugin.default_model && plugin.models.includes(plugin.default_model)
            ? plugin.default_model
            : (plugin.models[0] ?? '')
        if (!nextModel) {
            await showAlert(`插件「${plugin.name}」没有可用模型。`, 'warning', 'nonInvasive', 1800)
            return
        }
        await switchActiveConversationModel(plugin.id, nextModel)
        changeModelMenuMode('models')
    }, [changeModelMenuMode, plugins, showAlert, switchActiveConversationModel])

    const updateConversationSetting = useCallback(<K extends keyof ConversationSettings>(
        key: K,
        value: ConversationSettings[K],
    ) => {
        if (!activeConversation) return
        void updateConversationSettings(activeConversation.id, {[key]: value} as Partial<ConversationSettings>)
    }, [activeConversation, updateConversationSettings])

    const updatePenaltySetting = useCallback((
        key: 'frequencyPenalty' | 'presencePenalty',
        value: number,
    ) => {
        if (!activeConversation) return
        const nextValue = Number.isFinite(value)
            ? Math.min(2, Math.max(-2, value))
            : 0
        const enabledKey = key === 'frequencyPenalty'
            ? 'frequencyPenaltyEnabled'
            : 'presencePenaltyEnabled'
        void updateConversationSettings(activeConversation.id, {
            [key]: nextValue,
            [enabledKey]: nextValue !== 0,
        } as Partial<ConversationSettings>)
    }, [activeConversation, updateConversationSettings])

    const handleSend = useCallback(async () => {
        if (!inputValue.trim() || isStreaming || isCompacting) return
        if (!activeConversation) {
            await showAlert('请先新建对话。', 'warning', 'nonInvasive', 1800)
            return
        }
        if (isArchivedConversation) {
            await showAlert('已归档对话不可继续发送。', 'warning', 'nonInvasive', 1800)
            return
        }
        if (pluginsLoading) {
            await showAlert('AI 插件仍在加载，请稍后再发送。', 'warning', 'nonInvasive', 1800)
            return
        }
        if (llmUnavailable) {
            await showAlert('当前没有可用的 AI 对话插件，请先在设置中配置。', 'warning', 'nonInvasive', 2200)
            return
        }
        if (pluginSelectionIncomplete) {
            await showAlert('请先选择 AI 对话插件和模型。', 'warning', 'nonInvasive', 1800)
            return
        }
        if (llmApiKeyChecking) {
            await showAlert('正在检查访问密钥，请稍后再发送。', 'warning', 'nonInvasive', 1800)
            return
        }
        if (llmApiKeyMissing) {
            await showAlert(`请先在设置中配置 ${activeLlmPluginName} 的访问密钥。`, 'warning', 'nonInvasive', 2200)
            return
        }
        await sendMessage(inputValue)
    }, [
        activeConversation,
        activeLlmPluginName,
        inputValue,
        isArchivedConversation,
        isCompacting,
        isStreaming,
        llmApiKeyChecking,
        llmApiKeyMissing,
        llmUnavailable,
        pluginSelectionIncomplete,
        pluginsLoading,
        sendMessage,
        showAlert,
    ])

    const handleNewConv = useCallback(async () => {
        setConversationActionTarget(null)
        await createNewConversation()
        closeMorePanel()
        onCloseConversationDrawer?.()
    }, [closeMorePanel, createNewConversation, onCloseConversationDrawer])

    const handleSelectConv = useCallback(async (convId: string) => {
        setConversationActionTarget(null)
        await switchConversation(convId)
        onCloseConversationDrawer?.()
    }, [onCloseConversationDrawer, switchConversation])

    const clearConversationLongPress = useCallback(() => {
        const state = conversationLongPressRef.current
        if (state?.timerId != null) {
            window.clearTimeout(state.timerId)
        }
        conversationLongPressRef.current = null
    }, [])

    const handleConversationItemClick = useCallback((convId: string) => {
        if (suppressConversationClickRef.current) {
            suppressConversationClickRef.current = false
            return
        }
        void handleSelectConv(convId)
    }, [handleSelectConv])

    const handleConversationContextMenu = useCallback((
        conversation: Conversation,
        event: ReactMouseEvent<HTMLButtonElement>,
    ) => {
        event.preventDefault()
        suppressConversationClickRef.current = true
        setConversationActionTarget(conversation)
    }, [])

    const bindConversationLongPress = useDrag(({
        args: [conversation],
        cancel,
        event,
        first,
        last,
        movement: [moveX, moveY],
    }) => {
        const targetConversation = conversation as Conversation | undefined
        if (!targetConversation) return

        if (first) {
            clearConversationLongPress()
            const state: ConversationLongPressState = {
                conversation: targetConversation,
                ready: false,
                timerId: null,
            }
            state.timerId = window.setTimeout(() => {
                if (conversationLongPressRef.current !== state) return
                state.ready = true
                state.timerId = null
            }, CONVERSATION_LONG_PRESS_DELAY)
            conversationLongPressRef.current = state
        }

        if (
            Math.abs(moveX) > CONVERSATION_LONG_PRESS_MOVE_TOLERANCE
            || Math.abs(moveY) > CONVERSATION_LONG_PRESS_MOVE_TOLERANCE
        ) {
            clearConversationLongPress()
            cancel()
            return
        }

        if (!last) return
        const state = conversationLongPressRef.current
        const shouldOpenMenu = state?.ready
        clearConversationLongPress()
        if (!state || !shouldOpenMenu) return
        if (event.cancelable) event.preventDefault()
        event.stopPropagation()
        suppressConversationClickRef.current = true
        setConversationActionTarget(state.conversation)
    }, {
        filterTaps: false,
        pointer: {keys: false, touch: true},
    })

    const handleDeleteConv = useCallback(async (convId: string, event?: ReactMouseEvent) => {
        event?.stopPropagation()
        const result = await showAlert('确定删除此对话？此操作不可撤销。', 'warning', 'confirm')
        if (result !== 'yes') return
        setTopMenuOpen(false)
        setConversationActionTarget(null)
        await deleteConversation(convId)
    }, [deleteConversation, showAlert])

    const handleRenameConfirm = useCallback(async (title: string) => {
        if (!renameTarget) return
        setRenaming(true)
        try {
            await renameConversation(renameTarget.id, title)
            setRenameTarget(null)
        } finally {
            setRenaming(false)
        }
    }, [renameConversation, renameTarget])

    const {handleExportConversation, handleAttachDocuments} = useMobileAiConversationFiles({
        activeConversation,
        isArchivedConversation,
        addDocumentContextFiles,
        closeMorePanel,
        onCloseActionTarget: () => setConversationActionTarget(null),
    })

    const handleMessageLinkClick = useMobileAiMessageLinks({
        // 矛盾检测会话自带项目上下文；普通会话用当前聚焦的项目。
        projectId: activeConversation?.reportContext?.projectId ?? focusContext.projectId,
        navigateToTab,
    })
    const {usage: contextUsage, hasModel: contextUsageAvailable} = useAiContextUsage({
        messages,
        inputValue,
        activeConversation,
        plugins,
        selectedPlugin,
        selectedModel,
        tokenCalibrationFactors: appSettings.settings?.llm.token_calibration_factors,
    })

    const {handleCopyMessage, handleRegenerateMessage} = useMobileAiMessageActions({
        isArchivedConversation,
        regenerateMessage,
    })

    const handleEditMessage = useCallback((messageId: string) => {
        if (isArchivedConversation) {
            void showAlert('已归档对话不可编辑消息。', 'warning', 'nonInvasive', 1800)
            return
        }
        editMessage(messageId)
    }, [editMessage, isArchivedConversation, showAlert])

    const handleCancelEditing = useCallback(() => {
        setEditingMessageId(null)
        setInputValue('')
    }, [setEditingMessageId, setInputValue])


    const activeConversationMenuItems: MobileAnchoredMenuItem[] = activeConversation && !isComposingNewConversation ? [
        {
            key: 'pin',
            label: activeConversation.pinnedAt ? '取消顶置' : '顶置对话',
            description: activeConversation.pinnedAt ? '恢复到普通排序' : '固定在对话列表顶部',
            icon: <MobileAiIcon type="pin"/>,
            onSelect: () => toggleConversationPinned(activeConversation.id),
        },
        {
            key: 'archive',
            label: activeConversation.archivedAt ? '取消归档' : '归档对话',
            description: activeConversation.archivedAt ? '恢复继续对话' : '收起但保留历史',
            icon: <MobileAiIcon type="archive"/>,
            onSelect: () => toggleConversationArchived(activeConversation.id),
        },
        {
            key: 'rename',
            label: '重命名',
            description: '修改当前会话名称',
            icon: <MobileAiIcon type="rename"/>,
            onSelect: () => setRenameTarget(activeConversation),
        },
        {
            key: 'export-markdown',
            label: '导出 Markdown',
            description: isPendingConversationId(activeConversation.id) ? '发送消息后可导出' : '保存为 .md 文件',
            icon: <MobileAiIcon type="file"/>,
            disabled: isPendingConversationId(activeConversation.id),
            onSelect: () => void handleExportConversation(activeConversation, 'markdown'),
        },
        {
            key: 'export-json',
            label: '导出 JSON',
            description: isPendingConversationId(activeConversation.id) ? '发送消息后可导出' : '保存为 .json 文件',
            icon: <MobileAiIcon type="file"/>,
            disabled: isPendingConversationId(activeConversation.id),
            onSelect: () => void handleExportConversation(activeConversation, 'json'),
        },
        {
            key: 'delete',
            label: '删除对话',
            description: '永久删除当前会话',
            icon: <MobileAiIcon type="delete"/>,
            danger: true,
            onSelect: () => void handleDeleteConv(activeConversation.id),
        },
    ] : []

    const conversationActionMenuItems = conversationActionTarget ? [
        {
            key: 'pin',
            label: conversationActionTarget.pinnedAt ? '取消顶置' : '顶置',
            onSelect: () => toggleConversationPinned(conversationActionTarget.id),
        },
        {
            key: 'archive',
            label: conversationActionTarget.archivedAt ? '取消归档' : '归档',
            onSelect: () => toggleConversationArchived(conversationActionTarget.id),
        },
        {
            key: 'rename',
            label: '重命名',
            onSelect: () => setRenameTarget(conversationActionTarget),
        },
        {
            key: 'export-markdown',
            label: '导出 Markdown',
            disabled: isPendingConversationId(conversationActionTarget.id),
            onSelect: () => void handleExportConversation(conversationActionTarget, 'markdown'),
        },
        {
            key: 'export-json',
            label: '导出 JSON',
            disabled: isPendingConversationId(conversationActionTarget.id),
            onSelect: () => void handleExportConversation(conversationActionTarget, 'json'),
        },
        {
            key: 'delete',
            label: '删除',
            danger: true,
            onSelect: () => void handleDeleteConv(conversationActionTarget.id),
        },
    ] : []

    const conversationControls = <MobileAiConversationControls
        disabled={!activeConversation}
        settings={conversationSettings}
        onTemperature={value => updateConversationSetting('temperature', value)}
        onTopP={value => updateConversationSetting('topP', value)}
        onFrequencyPenalty={value => updatePenaltySetting('frequencyPenalty', value)}
        onPresencePenalty={value => updatePenaltySetting('presencePenalty', value)}
    />
    const conversationDrawer = <MobileAiConversationDrawer
        search={conversationSearch} onSearch={setConversationSearch}
        statusFilter={conversationStatusFilter} onStatusFilter={setConversationStatusFilter}
        filter={conversationFilter} onFilter={setConversationFilter}
        creationDisabled={conversationCreationDisabled} onNew={() => void handleNewConv()}
        conversations={conversations} visibleConversations={visibleConversations} hasSearch={hasConversationSearch}
        runtime={conversationRuntime} activeConversationId={activeConversationId}
        getLongPressProps={bindConversationLongPress} onOpen={handleConversationItemClick}
        onContextMenu={handleConversationContextMenu} actionTarget={conversationActionTarget}
        onActionTarget={setConversationActionTarget}
    />


    return (
        <div
            ref={pageRef}
            className={`mobile-ai-chat mobile-nav-safe-fixed${isCharacterConversation ? ' is-character' : ''}`}
            hidden={!active}
        >
            {drawerRoot ? createPortal(conversationDrawer, drawerRoot) : null}
            {/* 角色背景铺满页面，压在消息与输入卡下方；aria-hidden，纯装饰。 */}
            {isCharacterConversation && activeConversation?.backgroundImageUrl ? (
                <div className="mobile-ai-chat__background" aria-hidden="true">
                    <img src={activeConversation.backgroundImageUrl} alt=""/>
                </div>
            ) : null}
            <MobilePageTopBar
                className="mobile-ai-chat__topbar"
                ariaLabel="AI 对话操作"
                left={<MobileTopActionPill actions={[{
                    key: 'conversations',
                    label: '打开对话列表',
                    icon: <MobileMenuIcon/>,
                    ariaExpanded: conversationDrawerOpen,
                    onClick: () => onOpenConversationDrawer?.(),
                }]}/>}
                center={<button
                    ref={modelMenuRef}
                    type="button"
                    className={`mobile-ai-model-pill${modelPillUsesExpandedWidth ? ' mobile-ai-model-pill--wide' : ''}${modelMenuOpen ? ' mobile-ai-model-pill--expanded' : ''}`}
                    aria-haspopup="menu"
                    aria-expanded={modelMenuOpen}
                    disabled={pluginsLoading}
                    onClick={handleToggleModelMenu}
                >
                    <span>{pluginsLoading ? '加载模型中' : activeModelLabel}</span>
                    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                        <path d={modelMenuOpen ? 'M2.5 7.5 6 4l3.5 3.5' : 'M2.5 4.5 6 8l3.5-3.5'}/>
                    </svg>
                </button>}
                right={<MobileTopActionPill
                    ref={topActionsRef}
                    actions={[
                        {
                            key: 'new',
                            label: '新建对话',
                            icon: <MobileAddIcon/>,
                            kind: 'add',
                            disabled: conversationCreationDisabled,
                            onClick: () => void handleNewConv(),
                        },
                        {
                            key: 'menu',
                            label: '对话操作',
                            icon: <MobileMoreIcon/>,
                            kind: 'more',
                            ariaHasPopup: 'menu',
                            ariaExpanded: topMenuOpen,
                            disabled: !activeConversation || isComposingNewConversation,
                            onClick: handleToggleTopMenu,
                        },
                    ]}
                />}
            />

            <MobileAiMessageList
                messages={messages}
                streamingBlocks={streamingBlocks}
                isStreaming={isStreaming}
                continuationNodeId={continuationNodeId}
                continuationSubmittingMessageId={continuationSubmittingMessageId}
                focusEntryId={focusContext.entryId}
                hasActiveConversation={Boolean(activeConversation)}
                conversationCreationDisabled={conversationCreationDisabled}
                setupActionLabel={llmUnavailable || llmApiKeyMissing
                    ? llmApiKeyMissing ? '配置访问密钥' : '去设置插件'
                    : null}
                messagesEndRef={messagesEndRef}
                onNewConversation={() => void handleNewConv()}
                onOpenSettings={() => navigateToTab('settings')}
                onRetryMessage={messageId => void regenerateMessage(messageId)}
                onCompactRetryMessage={messageId => void compactAndRetryMessage(messageId)}
                onContinueMessage={messageId => void continueMessage(messageId)}
                onMessageLinkClick={handleMessageLinkClick}
                onCopyMessage={content => void handleCopyMessage(content)}
                onRegenerateMessage={messageId => void handleRegenerateMessage(messageId)}
                onEditMessage={handleEditMessage}
            />

            <MobileAiComposer
                pageRef={pageRef} composerRef={composerRef} topActionsRef={topActionsRef} toolModeMenuRef={toolModeMenuRef} modelMenuRef={modelMenuRef}
                inputValue={inputValue} onInput={setInputValue} onSend={() => void handleSend()} inputPlaceholder={inputPlaceholder} inputDisabled={inputDisabled}
                isStreaming={isStreaming} isCompacting={isCompacting} onStop={stopStreaming} thinking={sessionParams.thinking}
                onToggleThinking={() => setSessionParams(current => ({...current, thinking: !current.thinking}))}
                toolAccessMode={toolAccessMode} activeToolModeShortLabel={activeToolModeShortLabel}
                toolModeMenuOpen={toolModeMenuOpen} onToolModeMenuOpen={setToolModeMenuOpen}
                onBeforeToolModeMenuOpen={() => { closeModelMenu(); setTopMenuOpen(false) }}
                toolModeOptions={toolModeOptions} onToolModeChange={mode => void handleToolModeChange(mode)}
                morePanelOpen={morePanelOpen} onOpenMore={openMorePanel} onCloseMore={closeMorePanel}
                editing={Boolean(editingMessageId)} onCancelEditing={handleCancelEditing}
                modelMenuOpen={modelMenuOpen} onCloseModelMenu={closeModelMenu} modelMenuMode={modelMenuMode} onModelMenuMode={changeModelMenuMode}
                plugins={plugins} activeLlmPluginName={activeLlmPluginName} activeLlmPluginId={activeLlmPluginId}
                activeModelOptions={activeModelOptions} activeModelId={activeModelId}
                onSelectModel={modelId => void handleSelectModel(modelId)} onSelectPlugin={pluginId => void handleSelectPlugin(pluginId)}
                topMenuOpen={topMenuOpen} onCloseTopMenu={closeTopMenu} activeConversationMenuItems={activeConversationMenuItems}
                onAttachDocuments={() => void handleAttachDocuments()} webSearchEnabled={webSearchEnabled} onToggleWebSearch={() => void toggleWebSearch()}
                documentContextItems={documentContextItems}
                contextUsage={contextUsageAvailable ? contextUsage : null}
                contextUsageOpen={contextUsageOpen}
                contextUsageRef={contextUsageRef}
                onToggleContextUsage={() => setContextUsageOpen(open => !open)}
                onCloseContextUsage={() => setContextUsageOpen(false)}
                onRetryDocument={itemId => void retryDocumentContextItem(itemId)}
                onRemoveDocument={itemId => void removeDocumentContextItem(itemId)}
                conversationControls={conversationControls} conversationActionTarget={conversationActionTarget}
                onCloseConversationAction={() => setConversationActionTarget(null)} conversationActionMenuItems={conversationActionMenuItems}
                renameTarget={renameTarget} renaming={renaming} onCloseRename={() => setRenameTarget(null)} onRename={title => void handleRenameConfirm(title)}
            />
        </div>
    )
}
