import {logger} from '../../shared/logger'
import '../../App.css'
import {Button, SideBar, type SideBarItem, TabBar, type TabItem, useAlert} from 'flowcloudai-ui'
import {db_get_entry, db_get_project, type BackendStartupStatus, type PlatformInfo, type Project, setting_get_backend_status, showWindow} from '../../api'
import AiConfirmModal from '../../features/ai-chat/components/AiConfirmModal'
import EntryEditModal from '../../features/entries/components/EntryEditModal'
import type {AiFocus} from '../../features/ai-chat/hooks/useAiController'
import {useAiController} from '../../features/ai-chat/hooks/useAiController'
import {useAIChatPanel} from '../../features/ai-chat/useAIChatPanel'
import {type HelpPanelRequest, useHelpPanel} from '../../features/help/useHelpPanel'
import {useSnapshotPanel} from '../../features/snapshots/useSnapshotPanel'
import {getCurrentWindow} from '@tauri-apps/api/window'
import {listen, releaseTauriListener} from '../../api/events'
import {type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState} from 'react'
import {useIdeaPanel} from '../../pages/useIdeaPanel'
import StartupUpdatePrompt from '../../features/about/StartupUpdatePrompt'
import ProjectEditor from '../../pages/ProjectEditor'
import ProjectList from '../../pages/ProjectList.tsx'
import Settings, {type SettingsOpenIntent} from '../../pages/Settings'
import DockableSidePanel from '../../shared/ui/layout/DockableSidePanel'
import type {AiMissingPluginKind} from '../../shared/ui/AiPluginMissingOverlay'
import type {ReportConversationContext} from '../../features/ai-chat/model/AiControllerTypes'
import {
    recordHomeActivity,
    removeHomeEntryActivity,
    removeHomeProjectActivity,
    saveHomeLastSession,
    type HomeActivityTarget,
} from '../../features/home/homeActivity'
import {setIdeaFilters, setIdeaSearchText} from '../../features/ideas/ideaStore'
import {invalidateProjectList} from '../../features/projects/projectListStore'
import {parseHelpTarget} from '../../shared/help/helpCatalog'
import {groupEntryIdsByProject, type EntryTabMeta} from './entryTabMounting'
import {
    getLatestWorldCheckTask,
    openWorldCheckTaskMonitor,
    useWorldCheckTaskStore,
} from '../../features/project-editor/stores/worldCheckTaskStore'
import DesktopFileOpenController from '../../features/desktop-file-open/DesktopFileOpenController'

interface DesktopAppProps {
    platformInfo: PlatformInfo
}

type ProjectToolPanel = 'relation-graph' | 'timeline' | 'contradiction' | 'world-map'

type ProjectToolTabMeta = {
    projectId: string
    panel: ProjectToolPanel
}

type MainContentKey = 'home' | 'relation' | 'map-editor' | 'settings'
type SidePanelContentKey = 'idea' | 'ai-chat' | 'snapshot' | 'help'
type OpenSettingsOptions = Omit<SettingsOpenIntent, 'requestId'> & {
    focusRequest?: boolean
}
const AI_MIN_PANEL_WIDTH = 500
const FULLSCREEN_SIDE_DEFAULT_WIDTH = 320
const RECENT_PAGE_LIMIT = 10
let desktopWindowShown = false

function worldCheckTaskStatusLabel(status: 'running' | 'cancelling' | 'failed' | 'success' | 'cancelled') {
    if (status === 'failed') return '检测失败'
    if (status === 'success') return '报告已完成'
    if (status === 'cancelled') return '检测已取消'
    if (status === 'cancelling') return '正在停止检测'
    return '后台检测中'
}

type DesktopTabState = {
    tabs: TabItem[]
    activeKey: string
    projectTabMap: Record<string, string>
    entryTabMap: Record<string, EntryTabMeta>
    toolTabMap: Record<string, ProjectToolTabMeta>
    entryDirtyMap: Record<string, boolean>
    entrySavingMap: Record<string, boolean>
    recentPageKeys: string[]
}

type DesktopTabAction =
    | { type: 'add-tab'; tab: TabItem }
    | { type: 'activate-tab'; tabKey: string }
    | { type: 'clear-active' }
    | { type: 'reorder-tabs'; tabs: TabItem[] }
    | { type: 'touch-recent'; tabKey: string }
    | { type: 'upsert-project-tab'; tabKey: string; project: { id: string; name: string }; activate?: boolean; touchRecent?: boolean }
    | { type: 'upsert-entry-tab'; tabKey: string; projectId: string; entry: { id: string; title: string }; activate?: boolean; touchRecent?: boolean }
    | { type: 'upsert-tool-tab'; tabKey: string; projectId: string; panel: ProjectToolPanel; label: string; activate?: boolean; touchRecent?: boolean }
    | { type: 'rename-tab'; tabKey: string; label: string }
    | { type: 'set-entry-dirty'; tabKey: string; dirty: boolean }
    | { type: 'set-entry-saving'; tabKey: string; saving: boolean }
    | { type: 'close-tabs'; keys: string[]; primaryKey?: string }

const initialDesktopTabState: DesktopTabState = {
    tabs: [],
    activeKey: '',
    projectTabMap: {},
    entryTabMap: {},
    toolTabMap: {},
    entryDirtyMap: {},
    entrySavingMap: {},
    recentPageKeys: [],
}

function touchRecentPageKeys(recentPageKeys: string[], tabKey: string) {
    const next = [...recentPageKeys.filter((key) => key !== tabKey), tabKey]
    return next.slice(-RECENT_PAGE_LIMIT)
}

function upsertTab(tabs: TabItem[], tab: TabItem) {
    const index = tabs.findIndex((item) => item.key === tab.key)
    if (index === -1) return [...tabs, tab]
    return tabs.map((item) => item.key === tab.key ? {...item, ...tab, closable: tab.closable ?? item.closable} : item)
}

function renameTab(tabs: TabItem[], tabKey: string, label: string) {
    return tabs.map((tab) => {
        if (tab.key !== tabKey || tab.label === label) return tab
        return {...tab, label}
    })
}

function omitRecordKeys<T>(record: Record<string, T>, keys: Set<string>) {
    let changed = false
    const next = {...record}
    for (const key of keys) {
        if (key in next) {
            delete next[key]
            changed = true
        }
    }
    return changed ? next : record
}

function isHomeWorkspaceTab(state: DesktopTabState, tabKey: string) {
    return Boolean(state.projectTabMap[tabKey] || state.toolTabMap[tabKey] || state.entryTabMap[tabKey])
}

function getNextTabAfterClose(state: DesktopTabState, keysToRemove: Set<string>, primaryKey?: string) {
    const remainingTabs = state.tabs.filter((tab) => !keysToRemove.has(tab.key))
    const closedIndex = primaryKey
        ? state.tabs.findIndex((tab) => tab.key === primaryKey)
        : state.tabs.findIndex((tab) => keysToRemove.has(tab.key))
    return remainingTabs[closedIndex] ?? remainingTabs[closedIndex - 1] ?? null
}

function desktopTabReducer(state: DesktopTabState, action: DesktopTabAction): DesktopTabState {
    switch (action.type) {
        case 'add-tab':
            return {
                ...state,
                tabs: [...state.tabs, action.tab],
                activeKey: action.tab.key,
            }
        case 'activate-tab':
            return {
                ...state,
                activeKey: action.tabKey,
            }
        case 'clear-active':
            return {
                ...state,
                activeKey: '',
            }
        case 'reorder-tabs':
            return {
                ...state,
                tabs: action.tabs,
            }
        case 'touch-recent':
            return {
                ...state,
                recentPageKeys: touchRecentPageKeys(state.recentPageKeys, action.tabKey),
            }
        case 'upsert-project-tab': {
            const nextRecent = action.touchRecent
                ? touchRecentPageKeys(state.recentPageKeys, action.tabKey)
                : state.recentPageKeys
            return {
                ...state,
                tabs: upsertTab(state.tabs, {key: action.tabKey, label: action.project.name, closable: true}),
                activeKey: action.activate ? action.tabKey : state.activeKey,
                projectTabMap: state.projectTabMap[action.tabKey] === action.project.id
                    ? state.projectTabMap
                    : {...state.projectTabMap, [action.tabKey]: action.project.id},
                recentPageKeys: nextRecent,
            }
        }
        case 'upsert-entry-tab': {
            const nextRecent = action.touchRecent
                ? touchRecentPageKeys(state.recentPageKeys, action.tabKey)
                : state.recentPageKeys
            return {
                ...state,
                tabs: upsertTab(state.tabs, {key: action.tabKey, label: action.entry.title, closable: true}),
                activeKey: action.activate ? action.tabKey : state.activeKey,
                entryTabMap: {
                    ...state.entryTabMap,
                    [action.tabKey]: {
                        projectId: action.projectId,
                        entryId: action.entry.id,
                    },
                },
                recentPageKeys: nextRecent,
            }
        }
        case 'upsert-tool-tab': {
            const nextRecent = action.touchRecent
                ? touchRecentPageKeys(state.recentPageKeys, action.tabKey)
                : state.recentPageKeys
            return {
                ...state,
                tabs: upsertTab(state.tabs, {key: action.tabKey, label: action.label, closable: true}),
                activeKey: action.activate ? action.tabKey : state.activeKey,
                toolTabMap: {
                    ...state.toolTabMap,
                    [action.tabKey]: {
                        projectId: action.projectId,
                        panel: action.panel,
                    },
                },
                recentPageKeys: nextRecent,
            }
        }
        case 'rename-tab':
            return {
                ...state,
                tabs: renameTab(state.tabs, action.tabKey, action.label),
            }
        case 'set-entry-dirty': {
            if (!action.dirty) {
                if (!state.entryDirtyMap[action.tabKey]) return state
                const next = {...state.entryDirtyMap}
                delete next[action.tabKey]
                return {...state, entryDirtyMap: next}
            }
            if (state.entryDirtyMap[action.tabKey]) return state
            return {
                ...state,
                entryDirtyMap: {...state.entryDirtyMap, [action.tabKey]: true},
            }
        }
        case 'set-entry-saving': {
            if (!action.saving) {
                if (!state.entrySavingMap[action.tabKey]) return state
                const next = {...state.entrySavingMap}
                delete next[action.tabKey]
                return {...state, entrySavingMap: next}
            }
            if (state.entrySavingMap[action.tabKey]) return state
            return {
                ...state,
                entrySavingMap: {...state.entrySavingMap, [action.tabKey]: true},
            }
        }
        case 'close-tabs': {
            const keysToRemove = new Set(action.keys)
            if (keysToRemove.size === 0) return state

            const nextTabs = state.tabs.filter((tab) => !keysToRemove.has(tab.key))
            let nextActiveKey = state.activeKey
            let nextRecentPageKeys = state.recentPageKeys.filter((tabKey) => !keysToRemove.has(tabKey))

            if (keysToRemove.has(state.activeKey)) {
                const nextTab = getNextTabAfterClose(state, keysToRemove, action.primaryKey)
                nextActiveKey = nextTab?.key ?? ''
                if (nextTab?.key && isHomeWorkspaceTab(state, nextTab.key)) {
                    nextRecentPageKeys = touchRecentPageKeys(nextRecentPageKeys, nextTab.key)
                }
            }

            return {
                ...state,
                tabs: nextTabs,
                activeKey: nextActiveKey,
                projectTabMap: omitRecordKeys(state.projectTabMap, keysToRemove),
                entryTabMap: omitRecordKeys(state.entryTabMap, keysToRemove),
                toolTabMap: omitRecordKeys(state.toolTabMap, keysToRemove),
                entryDirtyMap: omitRecordKeys(state.entryDirtyMap, keysToRemove),
                entrySavingMap: omitRecordKeys(state.entrySavingMap, keysToRemove),
                recentPageKeys: nextRecentPageKeys,
            }
        }
    }
}

const initialBackendStartupStatus: BackendStartupStatus = {
    phase: 'initializing',
    message: null,
}

function useBackendStartupStatus() {
    const [backendStatus, setBackendStatus] = useState<BackendStartupStatus>(initialBackendStartupStatus)

    useEffect(() => {
        let disposed = false

        const applyStatus = (status: BackendStartupStatus) => {
            if (disposed) return
            setBackendStatus(status)
        }

        const statusListener = listen<BackendStartupStatus>('backend-status-changed', (event) => {
            applyStatus(event.payload)
        })

        setting_get_backend_status()
            .then(applyStatus)
            .catch((error) => {
                logger.warn('检查后端启动状态失败', error)
            })

        return () => {
            disposed = true
            releaseTauriListener(statusListener, '后端状态')
        }
    }, [])

    return backendStatus
}

function BackendStartupScreen({status}: { status: BackendStartupStatus }) {
    const failed = status.phase === 'failed'

    return (
        <div className="app-layout" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            background: 'var(--fc-color-bg)',
            color: 'var(--fc-color-text-secondary)',
            fontSize: 'var(--fc-font-size-sm)',
            userSelect: 'none',
            textAlign: 'center',
            padding: 'var(--fc-space-xl)',
        }}>
            <div>
                <div style={{
                    color: failed ? 'var(--fc-color-danger, #c2410c)' : 'var(--fc-color-text)',
                    fontSize: 'var(--fc-font-size-md)',
                    marginBottom: 8,
                }}>
                    {failed ? '启动失败' : '正在启动...'}
                </div>
                <div style={{
                    maxWidth: 520,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                }}>
                    {failed ? status.message ?? '应用启动失败，请重新打开' : '正在准备数据…'}
                </div>
            </div>
        </div>
    )
}

export default function DesktopApp({platformInfo}: DesktopAppProps) {
    const backendStatus = useBackendStartupStatus()

    useEffect(() => {
        const shouldShowWindow = backendStatus.phase === 'ready' || backendStatus.phase === 'failed'
        if (!shouldShowWindow || !platformInfo.windowControls || desktopWindowShown) return
        desktopWindowShown = true
        // macOS 会暂停隐藏 WKWebView 的 requestAnimationFrame；若在下一帧里调用 show，
        // 就会形成“窗口不显示便没有下一帧”的启动死锁。useEffect 已经晚于本次 DOM 提交，
        // 此处可以直接显示窗口，同时仍避免把尚未提交的启动界面暴露给用户。
        showWindow().catch((error) => {
            desktopWindowShown = false
            logger.error('显示桌面窗口失败', error)
        })
    }, [backendStatus.phase, platformInfo.windowControls])

    if (backendStatus.phase !== 'ready') {
        return <BackendStartupScreen status={backendStatus}/>
    }

    return <DesktopAppContent platformInfo={platformInfo}/>
}

function DesktopAppContent({platformInfo}: DesktopAppProps) {
    const win = getCurrentWindow()
    const usesNativeWindowControls = platformInfo.os === 'macos'
    const {showAlert} = useAlert()
    const windowClosingRef = useRef(false)

    const [isMaximized, setIsMaximized] = useState(false)
    useEffect(() => {
        win.isMaximized().then(setIsMaximized)
        const unlisten = win.onResized(() => win.isMaximized().then(setIsMaximized))
        return () => {
            releaseTauriListener(unlisten, '窗口尺寸')
        }
    }, [win])

    const [tabState, dispatchTabState] = useReducer(desktopTabReducer, initialDesktopTabState)
    const {
        tabs,
        activeKey,
        projectTabMap,
        entryTabMap,
        toolTabMap,
        entryDirtyMap,
        entrySavingMap,
        recentPageKeys,
    } = tabState

    const aiFocus = useMemo<AiFocus>(() => ({
        projectId: projectTabMap[activeKey] ?? toolTabMap[activeKey]?.projectId ?? entryTabMap[activeKey]?.projectId ?? null,
        entryId: entryTabMap[activeKey]?.entryId ?? null,
    }), [activeKey, entryTabMap, projectTabMap, toolTabMap])
    const dirtyEntryCount = useMemo(
        () => Object.values(entryDirtyMap).filter(Boolean).length,
        [entryDirtyMap],
    )
    const {tasks: worldCheckTasks} = useWorldCheckTaskStore()
    const latestWorldCheckTask = useMemo(
        () => getLatestWorldCheckTask(worldCheckTasks),
        [worldCheckTasks],
    )
    const activeWorldCheckTaskCount = useMemo(
        () => Object.values(worldCheckTasks).filter((task) => task.status === 'running' || task.status === 'cancelling').length,
        [worldCheckTasks],
    )

    const aiController = useAiController(aiFocus)

    const [selectedKey, setSelectedKey] = useState<string>('')
    const [mainContentKey, setMainContentKey] = useState<MainContentKey>('home')
    const [sidePanelContentKey, setSidePanelContentKey] = useState<SidePanelContentKey>('ai-chat')
    const [mountedSidePanelKeys, setMountedSidePanelKeys] = useState<SidePanelContentKey[]>([])
    const [helpRequest, setHelpRequest] = useState<HelpPanelRequest | null>(null)
    const [settingsOpenIntent, setSettingsOpenIntent] = useState<SettingsOpenIntent>({
        tab: 'storage',
        pluginKind: 'all',
        focus: null,
        requestId: 0,
    })
    const [aiPanelWidth, setAiPanelWidth] = useState(AI_MIN_PANEL_WIDTH)
    const [aiPanelCollapsed, setAiPanelCollapsed] = useState(true)
    const [aiPanelMode, setAiPanelMode] = useState<'floating' | 'fullscreen'>('floating')
    const [fullscreenSideWidth, setFullscreenSideWidth] = useState(FULLSCREEN_SIDE_DEFAULT_WIDTH)
    const [fullscreenSideCollapsed, setFullscreenSideCollapsed] = useState(false)
    const [projectReloadTokens, setProjectReloadTokens] = useState<Record<string, number>>({})
    useEffect(() => {
        if (aiPanelCollapsed) return
        setMountedSidePanelKeys(prev => (
            prev.includes(sidePanelContentKey) ? prev : [...prev, sidePanelContentKey]
        ))
    }, [aiPanelCollapsed, sidePanelContentKey])

    const clearSidePanelSelection = useCallback(() => {
        setSelectedKey(prev => (
            prev === 'idea' || prev === 'ai-chat' || prev === 'snapshot' || prev === 'help'
                ? ''
                : prev
        ))
    }, [])

    const handleAiPanelCollapsedChange = useCallback((nextCollapsed: boolean) => {
        const wasCollapsed = aiPanelCollapsed
        if (!nextCollapsed && wasCollapsed) {
            setAiPanelWidth(AI_MIN_PANEL_WIDTH)
        }
        setAiPanelCollapsed(nextCollapsed)
        if (nextCollapsed) {
            clearSidePanelSelection()
            return
        }
        if (wasCollapsed) {
            setSelectedKey(sidePanelContentKey)
        }
    }, [aiPanelCollapsed, clearSidePanelSelection, sidePanelContentKey])

    const collapseAiPanel = useCallback(() => {
        handleAiPanelCollapsedChange(true)
        setAiPanelMode((prev) => prev === 'fullscreen' ? 'floating' : prev)
    }, [handleAiPanelCollapsedChange])

    const expandAiPanelToMinWidth = useCallback(() => {
        setAiPanelWidth(AI_MIN_PANEL_WIDTH)
        setAiPanelCollapsed(false)
    }, [])

    const showHomeWorkspace = useCallback(() => {
        setMainContentKey('home')
    }, [])

    const touchRecentPage = useCallback((tabKey: string) => {
        dispatchTabState({type: 'touch-recent', tabKey})
    }, [])

    const getProjectToolLabel = useCallback((projectName: string, panel: ProjectToolPanel) => {
        switch (panel) {
            case 'relation-graph':
                return `${projectName} · 关系图谱`
            case 'timeline':
                return `${projectName} · 时间线`
            case 'contradiction':
                return `${projectName} · 设定检测`
            case 'world-map':
                return `${projectName} · 世界地图`
        }
    }, [])

    const recordTabActivity = useCallback((tabKey: string) => {
        const tabLabel = String(tabs.find(tab => tab.key === tabKey)?.label ?? '')
        const projectId = projectTabMap[tabKey]
        if (projectId) {
            recordHomeActivity({
                type: 'project',
                id: projectId,
                projectId,
                title: tabLabel || '未命名世界',
                subtitle: '项目',
            })
            return
        }

        const entryMeta = entryTabMap[tabKey]
        if (entryMeta) {
            recordHomeActivity({
                type: 'entry',
                id: entryMeta.entryId,
                projectId: entryMeta.projectId,
                entryId: entryMeta.entryId,
                title: tabLabel || '未命名词条',
                subtitle: '词条',
            })
            return
        }

        const toolMeta = toolTabMap[tabKey]
        if (toolMeta) {
            recordHomeActivity({
                type: 'tool',
                id: `${toolMeta.projectId}:${toolMeta.panel}`,
                projectId: toolMeta.projectId,
                panel: toolMeta.panel,
                title: tabLabel || getProjectToolLabel('项目', toolMeta.panel),
                subtitle: '项目工具',
            })
        }
    }, [entryTabMap, getProjectToolLabel, projectTabMap, tabs, toolTabMap])

    // 新增标签（通用）
    const handleAdd = useCallback((label = '新标签') => {
        if (mainContentKey === 'settings') {
            setMainContentKey('home')
            setSelectedKey('')
        }
        const newKey = `tab-${Date.now()}`
        dispatchTabState({type: 'add-tab', tab: {key: newKey, label, closable: true}})
    }, [mainContentKey])

    const ensureProjectTab = useCallback((project: Project, options?: {
        activate?: boolean
        recordActivity?: boolean
        touchRecent?: boolean
    }) => {
        const tabKey = `proj-${project.id}`
        dispatchTabState({
            type: 'upsert-project-tab',
            tabKey,
            project: {id: project.id, name: project.name},
            activate: options?.activate,
            touchRecent: options?.touchRecent,
        })
        if (options?.activate) {
            showHomeWorkspace()
        }
        if (options?.recordActivity) {
            recordHomeActivity({
                type: 'project',
                id: project.id,
                projectId: project.id,
                title: project.name,
                subtitle: '项目',
                description: project.description,
                updatedAt: project.updated_at ?? project.created_at ?? null,
            })
        }
    }, [showHomeWorkspace])

    // 打开项目标签页
    const handleOpenProject = useCallback((project: Project) => {
        ensureProjectTab(project, {
            activate: true,
            recordActivity: true,
            touchRecent: true,
        })
    }, [ensureProjectTab])

    const ensureProjectTabById = useCallback((projectId: string, options?: {
        activate?: boolean
        recordActivity?: boolean
        touchRecent?: boolean
    }) => {
        const tabKey = `proj-${projectId}`
        if (projectTabMap[tabKey]) {
            if (options?.activate) {
                dispatchTabState({type: 'activate-tab', tabKey})
                showHomeWorkspace()
            }
            if (options?.recordActivity) {
                recordTabActivity(tabKey)
            }
            if (options?.touchRecent) {
                touchRecentPage(tabKey)
            }
            return
        }
        db_get_project(projectId)
            .then((project) => {
                ensureProjectTab(project, options)
            })
            .catch((error) => {
                logger.warn('补齐项目标签失败', error)
            })
    }, [ensureProjectTab, projectTabMap, recordTabActivity, showHomeWorkspace, touchRecentPage])

    const handleOpenEntry = useCallback((projectId: string, entry: { id: string; title: string }) => {
        ensureProjectTabById(projectId)
        const tabKey = `entry-${projectId}-${entry.id}`
        dispatchTabState({
            type: 'upsert-entry-tab',
            tabKey,
            projectId,
            entry,
            activate: true,
            touchRecent: true,
        })
        recordHomeActivity({
            type: 'entry',
            id: entry.id,
            projectId,
            entryId: entry.id,
            title: entry.title,
            subtitle: '词条',
        })
        showHomeWorkspace()
    }, [ensureProjectTabById, showHomeWorkspace])

    const handleOpenProjectTool = useCallback((panel: ProjectToolPanel, project: { id: string; name: string }) => {
        const tabKey = `tool-${project.id}-${panel}`
        const label = getProjectToolLabel(project.name, panel)
        dispatchTabState({
            type: 'upsert-tool-tab',
            tabKey,
            projectId: project.id,
            panel,
            label,
            activate: true,
            touchRecent: true,
        })
        recordHomeActivity({
            type: 'tool',
            id: `${project.id}:${panel}`,
            projectId: project.id,
            panel,
            title: label,
            subtitle: project.name,
        })
        showHomeWorkspace()
    }, [getProjectToolLabel, showHomeWorkspace])

    const handleEntryTitleChange = useCallback((projectId: string, entry: { id: string; title: string }) => {
        const tabKey = `entry-${projectId}-${entry.id}`
        dispatchTabState({type: 'rename-tab', tabKey, label: entry.title})
    }, [])

    const handleProjectViewLabelChange = useCallback((projectId: string, label: string) => {
        const tabKey = `proj-${projectId}`
        dispatchTabState({type: 'rename-tab', tabKey, label})
    }, [])

    const handleEntryDirtyChange = useCallback((projectId: string, entryId: string, dirty: boolean) => {
        const tabKey = `entry-${projectId}-${entryId}`
        dispatchTabState({type: 'set-entry-dirty', tabKey, dirty})
    }, [])

    const handleEntrySavingChange = useCallback((projectId: string, entryId: string, saving: boolean) => {
        const tabKey = `entry-${projectId}-${entryId}`
        dispatchTabState({type: 'set-entry-saving', tabKey, saving})
    }, [])

    const handleProjectVersionApplied = useCallback((projectId: string) => {
        setProjectReloadTokens(current => ({
            ...current,
            [projectId]: (current[projectId] ?? 0) + 1,
        }))
    }, [])

    const handleBackToProject = useCallback((projectId: string) => {
        ensureProjectTabById(projectId, {
            activate: true,
            recordActivity: true,
            touchRecent: true,
        })
    }, [ensureProjectTabById])

    const handleBackHome = useCallback(() => {
        dispatchTabState({type: 'clear-active'})
        setSelectedKey('')
        showHomeWorkspace()
    }, [showHomeWorkspace])

    const closeTabsForKeys = useCallback((keysToRemove: Set<string>) => {
        const nextTab = keysToRemove.has(activeKey)
            ? getNextTabAfterClose(tabState, keysToRemove)
            : null
        dispatchTabState({type: 'close-tabs', keys: [...keysToRemove]})
        if (keysToRemove.has(activeKey)) {
            if (nextTab?.key) {
                if (isHomeWorkspaceTab(tabState, nextTab.key)) {
                    showHomeWorkspace()
                }
            } else {
                setMainContentKey('home')
                setSelectedKey('')
            }
        }
    }, [activeKey, showHomeWorkspace, tabState])

    const handleDeleteProject = useCallback((projectId: string) => {
        const projKey = `proj-${projectId}`
        const relatedToolKeys = Object.entries(toolTabMap)
            .filter(([, meta]) => meta.projectId === projectId)
            .map(([key]) => key)
        const relatedEntryKeys = Object.entries(entryTabMap)
            .filter(([, meta]) => meta.projectId === projectId)
            .map(([key]) => key)
        closeTabsForKeys(new Set([projKey, ...relatedToolKeys, ...relatedEntryKeys]))
        removeHomeProjectActivity(projectId)
        void invalidateProjectList()
    }, [closeTabsForKeys, entryTabMap, toolTabMap])

    const handleDeleteEntry = useCallback((projectId: string, entryId: string) => {
        const entryKey = `entry-${projectId}-${entryId}`
        closeTabsForKeys(new Set([entryKey]))
        removeHomeEntryActivity(projectId, entryId)
        ensureProjectTabById(projectId, {
            activate: true,
            recordActivity: true,
            touchRecent: true,
        })
    }, [closeTabsForKeys, ensureProjectTabById])

    const handleTabChange = useCallback((key: string) => {
        const shouldShowHomeWorkspace = Boolean(projectTabMap[key] || toolTabMap[key] || entryTabMap[key])
        const shouldReturnHomeWorkspace = mainContentKey !== 'home'
        if (key === activeKey) {
            if (shouldReturnHomeWorkspace) {
                if (mainContentKey === 'settings') {
                    setSelectedKey('')
                }
                if (shouldShowHomeWorkspace) {
                    recordTabActivity(key)
                    touchRecentPage(key)
                }
                showHomeWorkspace()
            }
            return
        }
        dispatchTabState({type: 'activate-tab', tabKey: key})
        if (shouldReturnHomeWorkspace || shouldShowHomeWorkspace) {
            if (mainContentKey === 'settings') {
                setSelectedKey('')
            }
            if (shouldShowHomeWorkspace) {
                recordTabActivity(key)
                touchRecentPage(key)
            }
            showHomeWorkspace()
        }
    }, [activeKey, entryTabMap, mainContentKey, projectTabMap, recordTabActivity, showHomeWorkspace, toolTabMap, touchRecentPage])

    // 删除标签
    const handleClose = useCallback(async (key: string) => {
        const closingProjectId = projectTabMap[key]
        const relatedToolKeys = closingProjectId
            ? Object.entries(toolTabMap)
                .filter(([, meta]) => meta.projectId === closingProjectId)
                .map(([toolKey]) => toolKey)
            : []
        const relatedEntryKeys = closingProjectId
            ? Object.entries(entryTabMap)
                .filter(([, meta]) => meta.projectId === closingProjectId)
                .map(([entryKey]) => entryKey)
            : []
        const keysToRemove = new Set([key, ...relatedToolKeys, ...relatedEntryKeys])
        const savingEntryKeys = [...keysToRemove].filter(tabKey => entrySavingMap[tabKey])
        if (savingEntryKeys.length > 0) {
            await showAlert('词条正在保存，请稍候再关闭标签页。', 'warning', 'nonInvasive', 1800)
            return
        }
        const dirtyEntryKeys = [...keysToRemove].filter(tabKey => entryDirtyMap[tabKey])
        if (dirtyEntryKeys.length > 0) {
            const message = dirtyEntryKeys.length === 1
                ? '当前词条有未保存更改，关闭标签页会丢失这些修改。是否继续关闭？'
                : `有 ${dirtyEntryKeys.length} 个词条标签存在未保存更改，关闭后会丢失这些修改。是否继续关闭？`
            const res = await showAlert(message, 'warning', 'confirm')
            if (res !== 'yes') return
        }
        const nextTab = keysToRemove.has(activeKey)
            ? getNextTabAfterClose(tabState, keysToRemove, key)
            : null
        dispatchTabState({type: 'close-tabs', keys: [...keysToRemove], primaryKey: key})
        if (keysToRemove.has(activeKey)) {
            if (nextTab?.key) {
                if (isHomeWorkspaceTab(tabState, nextTab.key)) {
                    showHomeWorkspace()
                }
            } else {
                setMainContentKey('home')
                setSelectedKey('')
            }
        }
    }, [activeKey, entryDirtyMap, entrySavingMap, entryTabMap, projectTabMap, showAlert, showHomeWorkspace, tabState, toolTabMap])

    // 窗口关闭（右上角 X / Alt+F4 / 任务栏关闭均会触发 close-requested）
    const handleWindowClose = useCallback(async () => {
        if (windowClosingRef.current) return

        const savingEntryKeys = Object.keys(entrySavingMap).filter(key => entrySavingMap[key])
        if (savingEntryKeys.length > 0) {
            await showAlert('词条正在保存，请稍候再关闭窗口。', 'warning', 'nonInvasive', 1800)
            return
        }
        const dirtyEntryKeys = Object.keys(entryDirtyMap).filter(key => entryDirtyMap[key])
        if (dirtyEntryKeys.length > 0) {
            const message = dirtyEntryKeys.length === 1
                ? '当前词条有未保存更改，关闭窗口会丢失这些修改。是否继续关闭？'
                : `有 ${dirtyEntryKeys.length} 个词条存在未保存更改，关闭窗口后会丢失这些修改。是否继续关闭？`
            const res = await showAlert(message, 'warning', 'confirm')
            if (res !== 'yes') return
        }

        windowClosingRef.current = true
        try {
            await win.close()
        } catch (error) {
            windowClosingRef.current = false
            throw error
        }
    }, [entryDirtyMap, entrySavingMap, showAlert, win])

    const openSettings = useCallback((options: OpenSettingsOptions = {}) => {
        setSettingsOpenIntent(current => ({
            tab: options.tab ?? 'storage',
            pluginKind: options.pluginKind ?? 'all',
            focus: options.focus ?? null,
            apiKeyPluginId: options.apiKeyPluginId ?? null,
            requestId: options.focusRequest ? (current.requestId ?? 0) + 1 : (current.requestId ?? 0),
        }))
        setSelectedKey('settings')
        dispatchTabState({type: 'clear-active'})
        setMainContentKey('settings')
        collapseAiPanel()
    }, [collapseAiPanel])

    useEffect(() => {
        const p = win.onCloseRequested(async (event) => {
            if (windowClosingRef.current) return
            event.preventDefault()
            await handleWindowClose()
        })
        return () => {
            releaseTauriListener(p, '窗口关闭')
        }
    }, [handleWindowClose, win])

    const handleSideBarSelect = useCallback((key: string, options?: { forceOpen?: boolean }) => {
        if (key === 'world-check-task' && latestWorldCheckTask) {
            setSelectedKey('')
            collapseAiPanel()
            handleOpenProjectTool('contradiction', {
                id: latestWorldCheckTask.projectId,
                name: latestWorldCheckTask.projectName,
            })
            openWorldCheckTaskMonitor(latestWorldCheckTask.projectId)
            return
        }
        if (key === 'idea' || key === 'ai-chat' || key === 'snapshot' || key === 'help') {
            if (!aiPanelCollapsed && sidePanelContentKey === key && !options?.forceOpen) {
                collapseAiPanel()
                setSelectedKey('')
                return
            }
            setSelectedKey(key)
            setSidePanelContentKey(key as SidePanelContentKey)
            if (aiPanelCollapsed) {
                expandAiPanelToMinWidth()
            } else {
                setAiPanelCollapsed(false)
            }
            return
        }
        if (key === 'settings') {
            openSettings()
        }
    }, [aiPanelCollapsed, collapseAiPanel, expandAiPanelToMinWidth, handleOpenProjectTool, latestWorldCheckTask, openSettings, sidePanelContentKey])

    const handleOpenPluginManagement = useCallback((kind: AiMissingPluginKind) => {
        openSettings({tab: 'plugins', pluginKind: kind})
    }, [openSettings])

    const handleOpenAiSettings = useCallback((pluginId: string) => {
        openSettings({tab: 'plugins', focus: 'api-key', apiKeyPluginId: pluginId, focusRequest: true})
    }, [openSettings])

    const handleOpenWriterModeSettings = useCallback(() => {
        openSettings({tab: 'permissions', focus: 'writer-mode', focusRequest: true})
    }, [openSettings])

    const handleStartCharacterChat = useCallback(async (projectId: string, entry: { id: string; title: string }) => {
        setSelectedKey('ai-chat')
        setSidePanelContentKey('ai-chat')
        if (aiPanelCollapsed) {
            expandAiPanelToMinWidth()
        } else {
            setAiPanelCollapsed(false)
        }
        const entryTabKey = `entry-${projectId}-${entry.id}`
        if (activeKey !== entryTabKey) {
            dispatchTabState({type: 'activate-tab', tabKey: entryTabKey})
        }
        recordHomeActivity({
            type: 'entry',
            id: entry.id,
            projectId,
            entryId: entry.id,
            title: entry.title,
            subtitle: '角色对话',
        })
        touchRecentPage(entryTabKey)
        showHomeWorkspace()
        try {
            await aiController.startCharacterConversation({
                projectId,
                entryId: entry.id,
            })
        } catch (error) {
            logger.error('启动角色对话失败', error)
        }
    }, [activeKey, aiController, aiPanelCollapsed, expandAiPanelToMinWidth, showHomeWorkspace, touchRecentPage])

    const handleStartReportDiscussion = useCallback(async (params: {
        title: string
        pluginId: string
        model: string
        reportContext: ReportConversationContext
    }) => {
        setSelectedKey('ai-chat')
        setSidePanelContentKey('ai-chat')
        if (aiPanelCollapsed) {
            expandAiPanelToMinWidth()
        } else {
            setAiPanelCollapsed(false)
        }
        try {
            await aiController.startReportDiscussion(params)
        } catch (error) {
            logger.error('启动报告讨论失败', error)
        }
    }, [aiController, aiPanelCollapsed, expandAiPanelToMinWidth])

    const handleOpenHomeTarget = useCallback(async (target: HomeActivityTarget) => {
        switch (target.type) {
            case 'project':
                try {
                    const project = await db_get_project(target.projectId ?? target.id)
                    handleOpenProject(project)
                } catch {
                    removeHomeProjectActivity(target.projectId ?? target.id)
                    await showAlert('这个项目已被删除，已从首页移除。', 'warning', 'nonInvasive', 3000)
                }
                return
            case 'entry':
                if (!target.projectId || !target.entryId) return
                try {
                    const entry = await db_get_entry(target.entryId, target.projectId)
                    if (entry.project_id !== target.projectId) {
                        removeHomeEntryActivity(target.projectId, target.entryId)
                        await showAlert('这个词条已不属于原项目，已从首页移除。', 'warning', 'nonInvasive', 3000)
                        return
                    }
                    handleOpenEntry(entry.project_id, {
                        id: entry.id,
                        title: entry.title,
                    })
                } catch {
                    removeHomeEntryActivity(target.projectId, target.entryId)
                    await showAlert('这个词条已被删除，已从首页移除。', 'warning', 'nonInvasive', 3000)
                }
                return
            case 'tool':
                if (!target.projectId || !target.panel) return
                try {
                    const project = await db_get_project(target.projectId)
                    handleOpenProjectTool(target.panel, {
                        id: project.id,
                        name: project.name,
                    })
                } catch {
                    removeHomeProjectActivity(target.projectId)
                    await showAlert('这个项目已被删除，已从首页移除。', 'warning', 'nonInvasive', 3000)
                }
                return
            case 'idea':
                if (target.id === 'project-inbox' && target.projectId) {
                    setIdeaSearchText('')
                    setIdeaFilters('inbox', target.projectId)
                } else {
                    recordHomeActivity(target)
                }
                handleSideBarSelect('idea')
                return
            case 'conversation':
                recordHomeActivity(target)
                handleSideBarSelect('ai-chat')
                return
            case 'snapshot':
                recordHomeActivity(target)
                handleSideBarSelect('snapshot')
                return
            case 'help':
                recordHomeActivity(target)
                setHelpRequest(prev => ({
                    ...parseHelpTarget(target.id),
                    requestId: (prev?.requestId ?? 0) + 1,
                }))
                handleSideBarSelect('help', {forceOpen: true})
                return
        }
    }, [handleOpenEntry, handleOpenProject, handleOpenProjectTool, handleSideBarSelect, showAlert])

    const activeHomeProjectId = projectTabMap[activeKey] ?? toolTabMap[activeKey]?.projectId ?? entryTabMap[activeKey]?.projectId ?? ''
    const activeEntryMeta = entryTabMap[activeKey] ?? null
    const activeEntryTitle = activeEntryMeta
        ? String(tabs.find(tab => tab.key === activeKey)?.label ?? '')
        : null
    const activeHomeTarget = useMemo<HomeActivityTarget | null>(() => {
        const tabTitle = String(tabs.find(tab => tab.key === activeKey)?.label ?? '')
        const projectId = projectTabMap[activeKey]
        if (projectId) {
            return {
                type: 'project',
                id: projectId,
                projectId,
                title: tabTitle || '未命名世界',
                subtitle: '项目',
            }
        }

        const entryMeta = entryTabMap[activeKey]
        if (entryMeta) {
            return {
                type: 'entry',
                id: entryMeta.entryId,
                projectId: entryMeta.projectId,
                entryId: entryMeta.entryId,
                title: tabTitle || '未命名词条',
                subtitle: '词条',
            }
        }

        const toolMeta = toolTabMap[activeKey]
        if (toolMeta) {
            return {
                type: 'tool',
                id: `${toolMeta.projectId}:${toolMeta.panel}`,
                projectId: toolMeta.projectId,
                panel: toolMeta.panel,
                title: tabTitle || getProjectToolLabel('项目', toolMeta.panel),
                subtitle: '项目工具',
            }
        }

        return null
    }, [activeKey, entryTabMap, getProjectToolLabel, projectTabMap, tabs, toolTabMap])

    useEffect(() => {
        saveHomeLastSession({
            target: activeHomeTarget,
            mainContentKey,
            activeTabKey: activeKey || null,
            sidePanel: {
                contentKey: sidePanelContentKey,
                collapsed: aiPanelCollapsed,
                mode: aiPanelMode,
            },
        })
    }, [activeHomeTarget, activeKey, aiPanelCollapsed, aiPanelMode, mainContentKey, sidePanelContentKey])

    const isHomeTabActive = activeKey === '' && mainContentKey === 'home'
    const sideBarSelectedKey = aiPanelCollapsed ? selectedKey : sidePanelContentKey

    const togglePanelMode = useCallback(() => {
        setAiPanelMode((prev) => prev === 'floating' ? 'fullscreen' : 'floating')
    }, [])

    const ideaSlots = useIdeaPanel({
        contextProjectId: aiFocus.projectId,
        onOpenEntry: handleOpenEntry,
        panelMode: aiPanelMode,
        onTogglePanelMode: togglePanelMode,
        onToggleCollapsed: collapseAiPanel,
    })
    const snapshotSlots = useSnapshotPanel({
        projectId: aiFocus.projectId,
        panelMode: aiPanelMode,
        onTogglePanelMode: togglePanelMode,
        onToggleCollapsed: collapseAiPanel,
        onVersionApplied: handleProjectVersionApplied,
        dirtyEntryCount,
    })
    const aiChatSlots = useAIChatPanel({
        controller: aiController,
        panelMode: aiPanelMode,
        onTogglePanelMode: togglePanelMode,
        onToggleCollapsed: collapseAiPanel,
        onOpenEntry: handleOpenEntry,
        onOpenPluginManagement: handleOpenPluginManagement,
        onOpenWriterModeSettings: handleOpenWriterModeSettings,
    })
    const helpSlots = useHelpPanel({
        panelMode: aiPanelMode,
        request: helpRequest,
        onTogglePanelMode: togglePanelMode,
        onToggleCollapsed: collapseAiPanel,
    })

    const sidePanelSides = useMemo<Record<string, ReactNode>>(() => {
        const out: Record<string, ReactNode> = {}
        if (mountedSidePanelKeys.includes('idea')) out.idea = ideaSlots.side
        if (mountedSidePanelKeys.includes('snapshot')) out.snapshot = snapshotSlots.side
        if (mountedSidePanelKeys.includes('ai-chat')) out['ai-chat'] = aiChatSlots.side
        if (mountedSidePanelKeys.includes('help')) out.help = helpSlots.side
        return out
    }, [mountedSidePanelKeys, ideaSlots.side, snapshotSlots.side, aiChatSlots.side, helpSlots.side])

    const sidePanelMains = useMemo<Record<string, ReactNode>>(() => {
        const out: Record<string, ReactNode> = {}
        if (mountedSidePanelKeys.includes('idea')) out.idea = ideaSlots.main
        if (mountedSidePanelKeys.includes('snapshot')) out.snapshot = snapshotSlots.main
        if (mountedSidePanelKeys.includes('ai-chat')) out['ai-chat'] = aiChatSlots.main
        if (mountedSidePanelKeys.includes('help')) out.help = helpSlots.main
        return out
    }, [mountedSidePanelKeys, ideaSlots.main, snapshotSlots.main, aiChatSlots.main, helpSlots.main])
    const mountedPageKeys = useMemo(() => [...new Set([
        ...recentPageKeys,
        ...Object.keys(entryDirtyMap).filter(key => entryDirtyMap[key]),
        ...Object.keys(entrySavingMap).filter(key => entrySavingMap[key]),
        activeKey,
    ].filter(Boolean))], [activeKey, entryDirtyMap, entrySavingMap, recentPageKeys])
    const mountedPageKeySet = useMemo(() => new Set(mountedPageKeys), [mountedPageKeys])
    const homeProjectIds = useMemo(() => [...new Set(
        mountedPageKeys
            .map((key) => projectTabMap[key] ?? toolTabMap[key]?.projectId ?? entryTabMap[key]?.projectId ?? null)
            .filter((projectId): projectId is string => Boolean(projectId)),
    )], [entryTabMap, mountedPageKeys, projectTabMap, toolTabMap])
    const openEntryIdsByProject = useMemo(
        () => groupEntryIdsByProject(tabs, entryTabMap),
        [entryTabMap, tabs],
    )
    const mountedEntryIdsByProject = useMemo(
        () => groupEntryIdsByProject(tabs, entryTabMap, mountedPageKeySet),
        [entryTabMap, mountedPageKeySet, tabs],
    )

    // 侧边栏相关状态
    const IdeaIcon = (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
            <path
                d="M12 3C14 8 16 10 21 12C16 14 14 16 12 21C10 16 8 14 3 12C8 10 10 8 12 3Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>)

    const AiChatIcon = (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
            <path
                d="M5 9.5A3.5 3.5 0 0 1 8.5 6h7A3.5 3.5 0 0 1 19 9.5v4A3.5 3.5 0 0 1 15.5 17H10l-4 3v-3.6A3.48 3.48 0 0 1 5 13.5v-4Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M9 10h5M9 13h3.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
            />
            <path
                d="M17.5 4.5 18 6l1.5.5-1.5.5-.5 1.5-.5-1.5L15.5 6.5 17 6l.5-1.5Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>)

    const SnapshotIcon = (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
            <circle cx="8" cy="6" r="2" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="8" cy="18" r="2" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="16" cy="12" r="2" stroke="currentColor" strokeWidth="1.5"/>
            <path
                d="M8 8v8m2-10h3.5A2.5 2.5 0 0 1 16 8.5v1.5M10 18h3.5A2.5 2.5 0 0 0 16 15.5V14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>)

    const SettingsIcon = (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="3" strokeWidth="1.5"/>
            <path
                d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15 1.65 1.65 0 003.17 14H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68 1.65 1.65 0 0010 3.17V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            />
        </svg>)

    const HelpIcon = (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
            <path
                d="M4 6.5c2.5-1 5.5-1 8 .5 2.5-1.5 5.5-1.5 8-.5v12c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5v-12Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M12 7v12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
            />
        </svg>)

    const WorldCheckTaskIcon = latestWorldCheckTask ? (
        <span className="world-check-task-nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
                <path d="M5 5h14v14H5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="m8 12 2.5 2.5L16 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>{activeWorldCheckTaskCount || (latestWorldCheckTask.status === 'failed' ? '!' : '✓')}</span>
        </span>
    ) : null

    const menuItems: SideBarItem[] = [
        {key: 'idea', label: '灵感便签', icon: IdeaIcon},
        {key: 'ai-chat', label: 'AI 对话', icon: AiChatIcon},
        {key: 'snapshot', label: '历史版本', icon: SnapshotIcon},
        {key: 'help', label: '帮助', icon: HelpIcon},
    ]
    const bottomItems: SideBarItem[] = [
        ...(latestWorldCheckTask && WorldCheckTaskIcon ? [{
            key: 'world-check-task',
            label: worldCheckTaskStatusLabel(latestWorldCheckTask.status),
            icon: WorldCheckTaskIcon,
        }] : []),
        {key: 'settings', label: '设置', icon: SettingsIcon},
    ]

    return (
        <div className={`app-layout app-layout--${platformInfo.os}`}>
            <div className="top-bar" data-tauri-drag-region>
                <div className="app-logo" data-tauri-drag-region aria-hidden="true">
                    <svg
                        data-tauri-drag-region
                        xmlns="http://www.w3.org/2000/svg"
                        width="512"
                        height="512"
                        viewBox="0 0 512 512"
                        fill="none"
                    >
                        <path
                            d="M362.34 234.141C324.97 212.705 258.916 226.767 258.728 286.513C241.793 230.641 315.033 173.27 382.462 199.768C418.083 213.767 439.643 242.766 447.642 275.326C466.139 350.384 405.459 389.506 333.594 385.944C280.288 383.319 255.541 352.071 218.108 330.823C209.484 325.885 195.674 319.011 183.3 317.948C158.178 315.824 141.743 322.386 127.37 331.323C146.742 310.511 174.926 298.637 199.611 299.45C245.105 300.949 277.101 334.072 324.032 335.76C407.397 342.947 405.834 259.14 362.277 234.141L362.34 234.141ZM209.984 134.21C241.48 117.024 281.1 118.149 312.534 136.522C322.47 142.335 340.718 157.271 344.967 168.02C336.093 160.271 318.033 142.772 268.227 150.709C227.982 157.146 199.673 199.206 202.298 236.453C177.488 234.079 152.304 232.454 131.119 254.202C117.183 268.514 106.497 290.263 108.059 316.886C109.434 340.384 125.557 360.508 142.118 369.695C151.992 375.132 162.615 378.445 174.676 380.007C189.924 382.007 216.421 378.882 232.106 370.57C164.053 410.443 85.9373 384.632 66.5022 332.26C46.6298 278.701 82.3752 217.205 144.93 211.955C152.179 211.33 155.429 211.018 159.366 211.33C167.74 170.27 178.926 151.146 209.922 134.21L209.984 134.21Z"
                            fill="url(#linear_fill_jAZk9lqyiGGO3cP1dJ5WO)"
                        />
                        <defs>
                            <linearGradient
                                id="linear_fill_jAZk9lqyiGGO3cP1dJ5WO"
                                x1="94.38400268554688"
                                y1="140.4921875"
                                x2="417.6159973144531"
                                y2="371.5078125"
                                gradientUnits="userSpaceOnUse"
                            >
                                <stop offset="0" stopColor="var(--fc-color-info)"/>
                                <stop offset="1" stopColor="var(--fc-color-purple)"/>
                            </linearGradient>
                        </defs>
                    </svg>
                </div>
                <button
                    type="button"
                    className={`home-tab ${isHomeTabActive ? 'home-tab--active' : ''}`}
                    onClick={handleBackHome}
                >
                    <svg
                        className="home-tab__icon"
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M3.5 10.5 12 4l8.5 6.5"/>
                        <path d="M6.5 9.5V20h11V9.5"/>
                        <path d="M10 20v-5h4v5"/>
                    </svg>
                    主页
                </button>
                <div className="tab-bar-wrapper" data-tauri-drag-region>
                    <TabBar
                        variant="floating"
                        tabRadius="md"
                        closable
                        draggable
                        addable
                        tabSizing="adaptive"
                        dragGutter="min(96px, 12%)"
                        tauriDragRegion
                        maxTabWidth="15rem"
                        minTabWidth="8rem"
                        items={tabs}
                        selectedKey={activeKey}
                        onReorder={(nextTabs) => {
                            dispatchTabState({type: 'reorder-tabs', tabs: nextTabs})
                        }}
                        onSelectedKeyChange={(key) => {
                            void handleTabChange(key)
                        }}
                        onClose={(key) => {
                            handleClose(key).then()
                        }}
                        onAdd={() => {
                            handleAdd()
                        }}
                    />
                </div>
                {!usesNativeWindowControls && <div className="top-bar-actions" data-tauri-drag-region>
                    <Button type="button"
                        className="window-control-btn"
                        variant="ghost"
                        onClick={() => win.minimize()}
                        tokens={{hoverBackground: 'var(--fc-color-bg-tertiary)'}}
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                    </Button>
                    <Button type="button"
                        className="window-control-btn"
                        variant="ghost"
                        onClick={() => win.toggleMaximize()}
                        tokens={{hoverBackground: 'var(--fc-color-bg-tertiary)'}}
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            {isMaximized ? (
                                <>
                                    <rect x="2" y="6" width="16" height="12" rx="2"/>
                                    <path d="M 6 2 L 20 2 A 2 2 0 0 1 22 4 L 22 13"/>
                                </>
                            ) : (
                                <rect x="3" y="4.5" width="18" height="15" rx="2"/>
                            )}
                        </svg>
                    </Button>
                    <Button type="button"
                        className="window-control-btn window-control-btn--danger"
                        variant="ghost"
                        onClick={handleWindowClose}
                        tokens={{hoverBackground: 'var(--fc-color-danger)'}}
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <line x1="19" y1="5" x2="5" y2="19"/>
                            <line x1="5" y1="5" x2="19" y2="19"/>
                        </svg>
                    </Button>
                </div>}
            </div>
            <div className="main-content">
                <div className="workspace-content">
                    <div className={`page-container ${mainContentKey === 'home' && activeHomeProjectId ? 'page-container--project-editor' : ''} ${mainContentKey === 'settings' ? 'page-container--settings' : ''} ${aiPanelMode === 'fullscreen' ? 'is-hidden-for-dock-fullscreen' : ''}`}>
                        <div className={`page-wrapper ${mainContentKey === 'home' ? 'active' : ''}`}>
                            <div className="home-page-stack">
                                <div className={`home-page-layer ${!activeHomeProjectId ? 'active' : ''}`}>
                                    <ProjectList
                                        onOpenProject={handleOpenProject}
                                        onOpenHomeTarget={handleOpenHomeTarget}
                                    />
                                </div>
                                {homeProjectIds.map(projectId => (
                                    <div
                                        key={projectId}
                                        className={`home-page-layer ${activeHomeProjectId === projectId ? 'active' : ''}`}
                                    >
                                        <ProjectEditor
                                            key={`${projectId}:${projectReloadTokens[projectId] ?? 0}`}
                                            projectId={projectId}
                                            activeToolPanel={toolTabMap[activeKey]?.projectId === projectId ? toolTabMap[activeKey].panel : null}
                                            onOpenProjectPanel={handleOpenProjectTool}
                                            onProjectViewLabelChange={handleProjectViewLabelChange}
                                            aiPluginId={aiController.selectedPlugin || null}
                                            aiModel={aiController.selectedModel || null}
                                            activeEntryId={activeEntryMeta?.projectId === projectId ? activeEntryMeta.entryId : null}
                                            activeEntryTitle={activeEntryMeta?.projectId === projectId ? activeEntryTitle : null}
                                            openEntryIds={openEntryIdsByProject[projectId] ?? []}
                                            mountedEntryIds={mountedEntryIdsByProject[projectId] ?? []}
                                            onOpenEntry={handleOpenEntry}
                                            onEntryTitleChange={handleEntryTitleChange}
                                            onBackHome={handleBackHome}
                                            onBackToProject={handleBackToProject}
                                            onEntryDirtyChange={handleEntryDirtyChange}
                                            onEntrySavingChange={handleEntrySavingChange}
                                            onStartCharacterChat={handleStartCharacterChat}
                                            onStartReportDiscussion={handleStartReportDiscussion}
                                            onOpenPluginManagement={handleOpenPluginManagement}
                                            onOpenAiSettings={handleOpenAiSettings}
                                            onDeleteProject={handleDeleteProject}
                                            onDeleteEntry={handleDeleteEntry}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className={`page-wrapper ${mainContentKey === 'settings' ? 'active' : ''}`}>
                            {mainContentKey === 'settings' && (
                                <Settings
                                    openIntent={settingsOpenIntent}
                                    onBack={() => {
                                    setMainContentKey('home')
                                    setSelectedKey('')
                                }}/>
                            )}
                        </div>
                    </div>
                    <DockableSidePanel
                        mode={aiPanelMode}
                        width={aiPanelWidth}
                        minWidth={AI_MIN_PANEL_WIDTH}
                        maxWidthRatio={0.7}
                        collapsed={aiPanelCollapsed}
                        onCollapsedChange={handleAiPanelCollapsedChange}
                        onWidthChange={setAiPanelWidth}
                        onModeChange={setAiPanelMode}
                        fullscreenSideWidth={fullscreenSideWidth}
                        fullscreenSideCollapsed={fullscreenSideCollapsed}
                        onFullscreenSideWidthChange={setFullscreenSideWidth}
                        onFullscreenSideCollapsedChange={setFullscreenSideCollapsed}
                        handleTitle="拖拽调整宽度"
                        sides={sidePanelSides}
                        mains={sidePanelMains}
                        activeKey={sidePanelContentKey}
                    />
                </div>
                <SideBar
                    className="side-bar"
                    items={menuItems}
                    bottomItems={bottomItems}
                    selectedKey={sideBarSelectedKey}
                    collapsed={true}
                    collapsedWidth={50}
                    anchorState="collapse"
                    onSelectedKeyChange={(key) => handleSideBarSelect(key)}
                    onCollapsedChange={() => {}}
                    placement="right"
                />
            </div>
            <DesktopFileOpenController onOpenProject={handleOpenProject}/>
            <EntryEditModal/>
            <AiConfirmModal/>
            <StartupUpdatePrompt/>
        </div>
    )
}
