import {logger} from '../shared/logger'
import {type CSSProperties, type RefObject, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
    Button,
    type CategoryTreeNode,
    flatToTree,
    Input,
    RollingBox,
    Select,
    Slider,
    TeraEditor,
    type TeraEditorDiagnostic,
    type Theme,
    Tree,
    useAlert,
    useTheme
} from 'flowcloudai-ui'
import {listenNativeFileDrop, openFileDialog} from '../api/dialog'
import {appConfigDir} from '@tauri-apps/api/path'
import {listen} from '../api/events'
import AboutSection, {FeedbackSection} from '../features/about/AboutSection'
import UpdateSection from '../features/about/UpdateSection'
import ThemeModePreview from '../shared/ui/ThemeModePreview'
import ThemeColorPreview from './settings/ThemeColorPreview'
import {
    ai_get_usage_by_model,
    ai_get_usage_daily,
    ai_get_usage_summary,
    type ApiUsageByModel,
    type ApiUsageDaily,
    type ApiUsageSummary,
    type AppSettings,
    type LlmCompactDetail,
    type LocalPluginInfo,
    open_in_file_manager,
    type RemotePluginInfo,
    type SearchSourceSettings,
    setting_open_backup_dir,
    template_get,
    template_get_default,
    template_get_effective_path,
    template_get_local_root_dir,
    template_list,
    template_save,
    type TemplateDocument,
    type TemplateMeta,
    type TemplateSaveResult,
    type TemplateValidationError,
} from '../api'
import {LocalPluginCard, MarketPluginCard} from '../features/plugins/PluginCard'
import {resolveDroppedPluginPath} from '../features/plugins/pluginFileDrop'
import {usePluginPageCapacity} from '../features/plugins/usePluginPageCapacity'
import {buildTtsVoiceOptions, normalizeVoiceIdWithPlugin} from '../features/plugins/ttsVoice'
import {CONVERSATION_TEMPERATURE_MAX} from '../features/ai-chat/model/AiControllerTypes'
import {
    deleteAppApiKey,
    refreshAppSettings,
    saveAppApiKey,
    saveAppSettings,
    useAppSettingsStore,
} from '../features/settings/appSettingsStore'
import {
    installLocalPlugin,
    installMarketPlugin,
    refreshLocalPlugins,
    refreshMarketPlugins,
    uninstallPlugin,
    usePluginCatalogStore,
} from '../features/settings/pluginCatalogStore'
import {
    buildUsageActivityDays,
    buildUsageMonthLabels,
    USAGE_ACTIVITY_COLUMNS,
} from '../features/settings/usageActivity'
import {SidebarResizeHandle} from '../shared/ui/layout/SidebarResizeHandle'
import {useResizableSidebar} from '../shared/ui/layout/useResizableSidebar'
import {FloatingPanel} from '../shared/ui/overlay'
import '../shared/ui/layout/WorkspaceScaffold.css'
import './Settings.css'

export type SettingsTab =
    | 'storage'
    | 'appearance'
    | 'plugins'
    | 'models'
    | 'permissions'
    | 'templates'
    | 'usage'
    | 'feedback'
    | 'update'
    | 'about'
export type SettingsFocusTarget = 'writer-mode' | 'api-key'
export type SettingsPluginKindFilter = 'all' | 'llm' | 'image' | 'tts'
type PluginKindFilter = SettingsPluginKindFilter
type SearchSourceKey = keyof SearchSourceSettings

type TemplateView = 'list' | 'detail'
type SelectValue = string | number | (string | number)[]

const PLUGIN_KIND_LABELS: Record<PluginKindFilter, string> = {
    all: '全部',
    llm: 'AI 对话',
    image: 'AI 绘图',
    tts: 'AI 语音',
}

const SETTINGS_GROUPS: Array<{
    label: string
    tabs: Array<{ value: SettingsTab; label: string }>
}> = [
    {
        label: '系统',
        tabs: [
            {value: 'storage', label: '存储与备份'},
            {value: 'appearance', label: '外观'},
        ],
    },
    {
        label: 'AI',
        tabs: [
            {value: 'plugins', label: '插件管理'},
            {value: 'models', label: '模型管理'},
            {value: 'permissions', label: '权限与工具'},
            {value: 'templates', label: '指令模板'},
            {value: 'usage', label: '用量统计'},
        ],
    },
    {
        label: '信息',
        tabs: [
            {value: 'feedback', label: '提交反馈'},
            {value: 'update', label: '更新'},
            {value: 'about', label: '关于'},
        ],
    },
]

const LLM_COMPACT_DETAIL_OPTIONS: Array<{ value: LlmCompactDetail; label: string }> = [
    {value: 'brief', label: '简略'},
    {value: 'balanced', label: '适中'},
    {value: 'detailed', label: '详细'},
]
const DEFAULT_ENABLED_FREQUENCY_PENALTY = 1.1
const DEFAULT_ENABLED_PRESENCE_PENALTY = 0.5
const SETTINGS_SIDEBAR_MIN_WIDTH = '15rem'
const SETTINGS_SIDEBAR_MAX_WIDTH = '22rem'
const SETTINGS_SIDEBAR_DEFAULT_WIDTH = 256
const SETTINGS_SIDEBAR_COLLAPSE_THRESHOLD_RATIO = 1 / 5
const DEFAULT_SEARCH_SOURCE_SETTINGS: SearchSourceSettings = {
    wikimedia: true,
    technical_wiki: true,
    game_wiki: true,
    fandom_wiki: true,
    esports_wiki: true,
    web: true,
}

const SEARCH_SOURCE_OPTIONS: Array<{ key: SearchSourceKey; label: string; hint: string }> = [
    {
        key: 'wikimedia',
        label: '维基媒体',
        hint: '维基百科、维基词典、维基文库、维基语录、维基导游。',
    },
    {
        key: 'technical_wiki',
        label: '专业参考',
        hint: '专业资料源。',
    },
    {
        key: 'game_wiki',
        label: '游戏 wiki',
        hint: 'PCGamingWiki、Minecraft Wiki、UESP、Bulbapedia 等游戏资料源。',
    },
    {
        key: 'fandom_wiki',
        label: '作品设定 wiki',
        hint: 'Wookieepedia、Harry Potter Wiki、All The Tropes 等设定资料源。',
    },
    {
        key: 'esports_wiki',
        label: '电竞 wiki',
        hint: 'Liquipedia 的电竞资料源。',
    },
    {
        key: 'web',
        label: '通用网页兜底',
        hint: '按上方搜索引擎发起通用网页搜索。',
    },
]

function normalizeThemeSelectValue(value: SelectValue): Theme {
    const theme = String(Array.isArray(value) ? value[0] ?? 'system' : value)
    if (theme === 'light' || theme === 'dark' || theme === 'system') return theme
    return 'system'
}

function clampNumberValue(value: string, fallback: number, min: number, max: number): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
}

function normalizeSearchSources(sources: Partial<SearchSourceSettings> | null | undefined): SearchSourceSettings {
    return {
        ...DEFAULT_SEARCH_SOURCE_SETTINGS,
        ...sources,
    }
}

interface ParsedPluginVersion {
    core: [number, number, number]
    prerelease: string[]
}

interface TemplateTreeRow {
    id: string
    parent_id: string | null
    name: string
    sort_order: number
    template_id?: string
    relative_path?: string

    [key: string]: unknown   // flatToTree(FlatCategory) 要求索引签名
}

const TEMPLATE_GROUP_LABELS: Record<string, string> = {
    sense: '场景',
    contradiction: '矛盾检查',
    context: '上下文',
    formats: '输出格式',
}

const TEMPLATE_GROUP_ORDER = ['sense', 'contradiction', 'context', 'formats']

function normalizePluginKey(value: string): string {
    return value.trim().toLowerCase()
}

function parsePluginVersion(version: string): ParsedPluginVersion | null {
    const trimmed = version.trim().replace(/^[vV]/, '')
    if (!trimmed) return null

    const [withoutBuild] = trimmed.split('+', 1)
    const [corePart, prereleasePart = ''] = withoutBuild.split('-', 2)
    const parts = corePart.split('.')
    if (parts.length === 0 || parts.length > 3) return null
    if (parts.some(part => !/^\d+$/.test(part))) return null

    while (parts.length < 3) {
        parts.push('0')
    }

    return {
        core: [Number(parts[0]), Number(parts[1]), Number(parts[2])],
        prerelease: prereleasePart ? prereleasePart.split('.') : [],
    }
}

function comparePrerelease(a: string[], b: string[]): number {
    if (a.length === 0 && b.length === 0) return 0
    if (a.length === 0) return 1
    if (b.length === 0) return -1

    const len = Math.max(a.length, b.length)
    for (let i = 0; i < len; i += 1) {
        const left = a[i]
        const right = b[i]
        if (left == null) return -1
        if (right == null) return 1

        const leftIsNumber = /^\d+$/.test(left)
        const rightIsNumber = /^\d+$/.test(right)
        if (leftIsNumber && rightIsNumber) {
            const diff = Number(left) - Number(right)
            if (diff !== 0) return diff
            continue
        }
        if (leftIsNumber !== rightIsNumber) {
            return leftIsNumber ? -1 : 1
        }
        const diff = left.localeCompare(right)
        if (diff !== 0) return diff
    }
    return 0
}

function isRemoteVersionNewer(current: string, latest: string): boolean {
    const currentVersion = parsePluginVersion(current)
    const latestVersion = parsePluginVersion(latest)
    if (!currentVersion || !latestVersion) return false

    for (let i = 0; i < 3; i += 1) {
        const diff = latestVersion.core[i] - currentVersion.core[i]
        if (diff !== 0) return diff > 0
    }

    return comparePrerelease(latestVersion.prerelease, currentVersion.prerelease) > 0
}

interface SettingsSidebarProps {
    activeTab: SettingsTab
    onTabChange: (tab: SettingsTab) => void
    onBack?: () => void
    collapsed: boolean
    onCollapseToggle: () => void
}

function SettingsSidebar({activeTab, onTabChange, onBack, collapsed, onCollapseToggle}: SettingsSidebarProps) {
    return (
        <aside className="settings-sidebar">
            <div className="settings-sidebar__header">
                {onBack && (
                    <Button
                        type="button"
                        className="settings-back-button"
                        variant="ghost"
                        size="sm"
                        onClick={onBack}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M19 12H5M12 19l-7-7 7-7"/>
                        </svg>
                        <span>返回</span>
                    </Button>
                )}
                <Button
                    type="button"
                    className="settings-sidebar-toggle"
                    variant="ghost"
                    size="sm"
                    onClick={onCollapseToggle}
                >
                    {collapsed ? '展开' : '收起'}
                </Button>
            </div>
            <nav className="settings-sidebar__nav" aria-label="设置项">
                {SETTINGS_GROUPS.map(group => (
                    <div className="settings-sidebar-group" key={group.label}>
                        <div className="settings-sidebar-group__label">{group.label}</div>
                        <div className="settings-sidebar-group__items">
                            {group.tabs.map(tab => (
                                <button
                                    key={tab.value}
                                    type="button"
                                    className={`settings-sidebar-item ${activeTab === tab.value ? 'active' : ''}`}
                                    aria-current={activeTab === tab.value ? 'page' : undefined}
                                    onClick={() => onTabChange(tab.value)}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </nav>
        </aside>
    )
}

interface TemplatesPanelProps {
    editorFontSize: number
    defaultPrompt: string
    onDefaultPromptChange: (value: string) => void
}

function TemplatesPanel({editorFontSize, defaultPrompt, onDefaultPromptChange}: TemplatesPanelProps) {
    const {showAlert} = useAlert()
    // ── 模板配置状态 ──
    const [templateMetas, setTemplateMetas] = useState<TemplateMeta[]>([])
    const [templateListLoading, setTemplateListLoading] = useState(false)
    const [templateListError, setTemplateListError] = useState<string | null>(null)
    const [templateView, setTemplateView] = useState<TemplateView>('list')
    const [templateSelectedKey, setTemplateSelectedKey] = useState<string>('')
    const [templateExpandedKeys, setTemplateExpandedKeys] = useState<string[]>([])
    const [templateDocument, setTemplateDocument] = useState<TemplateDocument | null>(null)
    const [templateDocumentLoading, setTemplateDocumentLoading] = useState(false)
    const [templateDraft, setTemplateDraft] = useState('')
    const [templateSaving, setTemplateSaving] = useState(false)
    const [templateRestoring, setTemplateRestoring] = useState(false)
    const [templatePageError, setTemplatePageError] = useState<TemplateValidationError | null>(null)

    const loadTemplateList = useCallback(async () => {
        setTemplateListLoading(true)
        setTemplateListError(null)
        try {
            const metas = await template_list()
            setTemplateMetas(metas)
            setTemplateExpandedKeys(prev => {
                if (prev.length > 0) return prev
                return Array.from(new Set(metas.map(meta => `group:${meta.group}`)))
            })
        } catch (error) {
            const message = String(error)
            logger.error('AI 指令模板目录加载失败:', error)
            setTemplateListError(message)
            void showAlert(`AI 指令模板目录加载失败：${message}`, 'error', 'nonInvasive', 3000)
        } finally {
            setTemplateListLoading(false)
        }
    }, [showAlert])

    useEffect(() => {
        if (templateMetas.length === 0 && !templateListLoading && !templateListError) {
            loadTemplateList().catch(logger.error)
        }
    }, [loadTemplateList, templateListError, templateListLoading, templateMetas.length])

    const templateMetaMap = useMemo(
        () => new Map(templateMetas.map(meta => [meta.id, meta])),
        [templateMetas],
    )

    const templateTreeRows = useMemo<TemplateTreeRow[]>(() => {
        const groupRows = Array.from(new Set(templateMetas.map(meta => meta.group)))
            .sort((a, b) => {
                const indexA = TEMPLATE_GROUP_ORDER.indexOf(a)
                const indexB = TEMPLATE_GROUP_ORDER.indexOf(b)
                const orderA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA
                const orderB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB
                return orderA - orderB || a.localeCompare(b)
            })
            .map((group, index) => ({
                id: `group:${group}`,
                parent_id: null,
                name: TEMPLATE_GROUP_LABELS[group] ?? group,
                sort_order: index,
            }))

        const templateRows = templateMetas.map((meta, index) => ({
            id: meta.id,
            parent_id: `group:${meta.group}`,
            name: meta.title,
            sort_order: index,
            template_id: meta.id,
            relative_path: meta.relative_path,
        }))

        return [...groupRows, ...templateRows]
    }, [templateMetas])

    const templateTreeData = useMemo(
        () => flatToTree(templateTreeRows).roots,
        [templateTreeRows],
    )

    const activeTemplateMeta = useMemo(() => {
        if (templateDocument) return templateDocument.meta
        if (!templateSelectedKey) return null
        return templateMetaMap.get(templateSelectedKey) ?? null
    }, [templateDocument, templateMetaMap, templateSelectedKey])

    const templateIsDirty = templateDocument ? templateDraft !== templateDocument.content : false

    const templateDiagnostics = useMemo<TeraEditorDiagnostic[]>(() => {
        if (!templatePageError?.line || !templatePageError.column) return []
        return [{
            message: templatePageError.raw_message,
            severity: 'error',
            startLineNumber: templatePageError.line,
            startColumn: templatePageError.column,
            endLineNumber: templatePageError.line,
            endColumn: templatePageError.column + 1,
            source: 'tera',
        }]
    }, [templatePageError])

    const openTemplateDetail = useCallback(async (templateId: string) => {
        if (!templateMetaMap.has(templateId)) return
        setTemplateSelectedKey(templateId)
        setTemplateView('detail')
        setTemplateDocumentLoading(true)
        setTemplatePageError(null)

        try {
            const document = await template_get(templateId)
            setTemplateDocument(document)
            setTemplateDraft(document.content)
        } catch (error) {
            setTemplateDocument(null)
            setTemplateDraft('')
            void showAlert('加载 AI 指令模板失败: ' + error, 'error')
        } finally {
            setTemplateDocumentLoading(false)
        }
    }, [showAlert, templateMetaMap])

    const handleTemplateTreeSelect = useCallback((key: string) => {
        if (!templateMetaMap.has(key)) return
        void openTemplateDetail(key)
    }, [openTemplateDetail, templateMetaMap])

    const handleTemplateBack = useCallback(async () => {
        if (templateIsDirty) {
            const result = await showAlert('未保存的更改将丢失，是否继续？', 'warning', 'confirm')
            if (result !== 'yes') return
        }

        setTemplateView('list')
        setTemplateDocument(null)
        setTemplateDraft('')
        setTemplatePageError(null)
        setTemplateDocumentLoading(false)
        setTemplateSelectedKey('')
    }, [showAlert, templateIsDirty])

    const handleTemplateRestore = useCallback(async () => {
        if (!templateDocument) return
        const result = await showAlert(
            '恢复默认内容后，当前所有更改都会丢失，是否继续？',
            'warning',
            'confirm'
        )
        if (result !== 'yes') return

        try {
            setTemplateRestoring(true)
            const defaultContent = await template_get_default(templateDocument.meta.id)
            setTemplateDraft(defaultContent)
            setTemplatePageError(null)
        } catch (error) {
            void showAlert('恢复默认内容失败: ' + error, 'error')
        } finally {
            setTemplateRestoring(false)
        }
    }, [showAlert, templateDocument])

    const handleOpenTemplateRootDir = useCallback(async () => {
        try {
            const path = await template_get_local_root_dir()
            await open_in_file_manager(path)
        } catch (error) {
            void showAlert('打开 AI 指令模板目录失败: ' + error, 'error')
        }
    }, [showAlert])

    const handleOpenTemplateFilePath = useCallback(async () => {
        if (!activeTemplateMeta) return
        try {
            const path = await template_get_effective_path(activeTemplateMeta.id)
            await open_in_file_manager(path)
        } catch (error) {
            void showAlert('打开 AI 指令模板文件失败: ' + error, 'error')
        }
    }, [activeTemplateMeta, showAlert])

    const handleTemplateSave = useCallback(async () => {
        if (!templateDocument) return

        try {
            setTemplateSaving(true)
            setTemplatePageError(null)
            const result: TemplateSaveResult = await template_save(templateDocument.meta.id, templateDraft)

            if (result.status === 'success') {
                setTemplateDocument(result.document)
                setTemplateDraft(result.document.content)
                void showAlert('AI 指令模板已保存', 'success', 'nonInvasive', 2000)
                return
            }

            if (result.status === 'validation_error') {
                setTemplatePageError(result.error)
                return
            }

            setTemplatePageError({
                message: '保存失败',
                raw_message: result.message,
                line: null,
                column: null,
            })
                void showAlert('保存 AI 指令模板失败: ' + result.message, 'error')
        } catch (error) {
            const message = String(error)
            setTemplatePageError({
                message: '保存失败',
                raw_message: message,
                line: null,
                column: null,
            })
            void showAlert('保存 AI 指令模板失败: ' + message, 'error')
        } finally {
            setTemplateSaving(false)
        }
    }, [showAlert, templateDocument, templateDraft])

    return (
                            <div className="settings-container fc-page-shell settings-template-shell">
                                <div className="settings-title fc-page-header">
                                    <div className="fc-page-title-block">
                                        <h1 className="fc-page-title">AI 指令模板</h1>
                                    </div>
                                </div>

                                <section className="settings-section fc-section-card">
                                    <h2 className="settings-section-title fc-section-title">全局指令</h2>
                                    <div className="settings-field-stack settings-field-stack--full settings-llm-prompt-field">
                                        <textarea
                                            className="settings-textarea"
                                            value={defaultPrompt}
                                            onChange={(event) => onDefaultPromptChange(event.currentTarget.value)}
                                            placeholder="例如：保持回答简洁，优先延续当前世界观设定。"
                                        />
                                        <span className="settings-field-hint">
                                            当前对话没有独有提示词时，会自动使用这段默认指令。
                                        </span>
                                    </div>
                                </section>

                                <div className="templates-workspace">
                                {templateView === 'list' && (
                                    <section className="settings-section fc-section-card templates-catalog-section">
                                        <div className="templates-catalog-header">
                                            <div>
                                                <h2 className="settings-section-title fc-section-title">模板目录</h2>
                                                <p className="templates-catalog-hint">
                                                    共 {templateMetas.length} 个 AI 指令模板，按用途分组展示。
                                                </p>
                                            </div>
                                            <div className="templates-catalog-actions">
                                                <Button type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        void handleOpenTemplateRootDir()
                                                    }}
                                                >
                                                    打开本地路径
                                                </Button>
                                                <Button type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={templateListLoading}
                                                    onClick={() => {
                                                        loadTemplateList().catch(logger.error)
                                                    }}
                                                >
                                                    {templateListLoading ? '刷新中…' : '刷新'}
                                                </Button>
                                            </div>
                                        </div>

                                        {templateListError ? (
                                            <div className="settings-empty-state"
                                                 style={{color: 'var(--fc-color-danger)'}}>
                                                加载失败：{templateListError}
                                                <div style={{marginTop: 8}}>
                                                    <Button type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => {
                                                            loadTemplateList().catch(logger.error)
                                                        }}
                                                    >
                                                        重试
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : templateListLoading && templateTreeData.length === 0 ? (
                                            <div className="settings-empty-state">加载中...</div>
                                        ) : templateTreeData.length === 0 ? (
                                            <div className="settings-empty-state">暂无可编辑的 AI 指令模板。</div>
                                        ) : (
                                            <div className="templates-tree-shell">
                                                <Tree
                                                    treeData={templateTreeData}
                                                    selectedKey={templateSelectedKey}
                                                    expandedKeys={templateExpandedKeys}
                                                    onExpandedKeysChange={setTemplateExpandedKeys}
                                                    onSelectedKeyChange={handleTemplateTreeSelect}
                                                    searchable
                                                    searchPlaceholder="搜索名称"
                                                    collapseDuration={0.13}
                                                    indentSize={7}
                                                    renderTitle={(node: CategoryTreeNode) => {
                                                        const row = node.raw as TemplateTreeRow
                                                        if (!row.template_id) {
                                                            return (
                                                                <div className="templates-tree-group-title">
                                                                    {row.name}
                                                                </div>
                                                            )
                                                        }
                                                        return (
                                                            <div className="templates-tree-item">
                                                                <div
                                                                    className="templates-tree-item-name">{row.name}</div>
                                                            </div>
                                                        )
                                                    }}
                                                    canDrag={() => false}
                                                    canDrop={() => false}
                                                    canRename={() => false}
                                                    canDelete={() => false}
                                                    canCreate={() => false}
                                                />
                                            </div>
                                        )}
                                    </section>
                                )}

                                {templateView === 'detail' && (
                                    <section className="settings-section fc-section-card templates-detail-section">
                                        <div className="templates-detail-toolbar">
                                            <Button type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    void handleTemplateBack()
                                                }}
                                            >
                                                返回
                                            </Button>
                                            <div className="templates-detail-toolbar-actions">
                                                <Button type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={!templateDocument}
                                                    onClick={() => {
                                                        void handleOpenTemplateFilePath()
                                                    }}
                                                >
                                                    打开本地路径
                                                </Button>
                                                <Button type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={!templateDocument || templateRestoring || templateSaving}
                                                    onClick={() => {
                                                        void handleTemplateRestore()
                                                    }}
                                                >
                                                    {templateRestoring ? '恢复中...' : '恢复默认'}
                                                </Button>
                                                <Button type="button"
                                                    size="sm"
                                                    disabled={!templateDocument || !templateIsDirty || templateSaving || templateDocumentLoading}
                                                    onClick={() => {
                                                        void handleTemplateSave()
                                                    }}
                                                >
                                                    {templateSaving ? '保存中...' : '保存'}
                                                </Button>
                                            </div>
                                        </div>

                                        {activeTemplateMeta ? (
                                            <>
                                                <div className="templates-detail-header">
                                                    <div className="templates-detail-heading">
                                                        <div className="templates-detail-topline">
                                                            <div className="templates-detail-caption">当前内容</div>
                                                            <span className="templates-detail-badge">
                                                            {TEMPLATE_GROUP_LABELS[activeTemplateMeta.group] ?? activeTemplateMeta.group}
                                                        </span>
                                                        </div>
                                                        <h2 className="templates-detail-title">{activeTemplateMeta.title}</h2>
                                                        <div className="templates-detail-path">
                                                            {activeTemplateMeta.relative_path}
                                                        </div>
                                                    </div>
                                                </div>

                                                <details className="templates-detail-disclosure">
                                                    <summary className="templates-detail-disclosure-summary">
                                                        <span>用途说明与可用变量</span>
                                                        <span className="templates-detail-disclosure-meta">
                                                        用于：{activeTemplateMeta.appear_in}
                                                    </span>
                                                        <span className="templates-detail-disclosure-meta">
                                                        可用变量：{activeTemplateMeta.params.length} 个
                                                    </span>
                                                    </summary>
                                                    <div className="templates-detail-grid">
                                                        <div className="templates-detail-card">
                                                            <div className="templates-detail-label">作用</div>
                                                            <p className="templates-detail-text">{activeTemplateMeta.purpose}</p>
                                                        </div>
                                                        <div className="templates-detail-card">
                                                            <div className="templates-detail-label">用于哪里</div>
                                                            <p className="templates-detail-text">{activeTemplateMeta.appear_in}</p>
                                                        </div>
                                                        <div
                                                            className="templates-detail-card templates-detail-card--params">
                                                            <div className="templates-detail-label">可用变量</div>
                                                            {activeTemplateMeta.params.length === 0 ? (
                                                                <p className="templates-detail-text">这段内容不依赖额外变量。</p>
                                                            ) : (
                                                                <div className="templates-param-list">
                                                                    {activeTemplateMeta.params.map(param => (
                                                                        <div key={param.name}
                                                                             className="templates-param-item">
                                                                            <div
                                                                                className="templates-param-name">{param.name}</div>
                                                                            <div
                                                                                className="templates-param-desc">{param.description}</div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </details>

                                                {templatePageError && (
                                                    <div className="templates-error-panel">
                                                        <div
                                                            className="templates-error-title">{templatePageError.message}</div>
                                                        {(templatePageError.line && templatePageError.column) ? (
                                                            <div className="templates-error-location">
                                                                第 {templatePageError.line} 行，第 {templatePageError.column} 列
                                                            </div>
                                                        ) : null}
                                                        <pre
                                                            className="templates-error-raw">{templatePageError.raw_message}</pre>
                                                    </div>
                                                )}

                                                <div className="templates-editor-shell">
                                                    {templateDocumentLoading && !templateDocument ? (
                                                        <div className="settings-empty-state">加载中...</div>
                                                    ) : !templateDocument ? (
                                                        <div
                                                            className="settings-empty-state">加载失败，请返回目录后重试。</div>
                                                    ) : (
                                                        <>
                                                            <div className="templates-editor-meta">
                                                            <span>
                                                                当前来源：{templateDocument.is_override ? '你的自定义版本' : '系统默认版本'}
                                                            </span>
                                                                <span>
                                                                {templateIsDirty ? '存在未保存更改' : '内容已保存'}
                                                            </span>
                                                            </div>
                                                            <TeraEditor
                                                                value={templateDraft}
                                                                onValueChange={(value) => {
                                                                    setTemplateDraft(value)
                                                                    if (templatePageError) {
                                                                        setTemplatePageError(null)
                                                                    }
                                                                }}
                                                                height="100%"
                                                                minHeight={0}
                                                                fontSize={editorFontSize}
                                                                lineHeight={24}
                                                                wordWrap="on"
                                                                diagnostics={templateDiagnostics}
                                                        placeholder="请输入 AI 指令模板内容"
                                                                className="templates-editor"
                                                                style={{minHeight: 0}}
                                                            />
                                                        </>
                                                    )}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="settings-empty-state">
                                                未找到当前 AI 指令模板信息。
                                            </div>
                                        )}
                                    </section>
                            )}
                                </div>
                        </div>
    )
}

interface PluginsPanelProps {
    localPlugins: LocalPluginInfo[]
    marketPlugins: RemotePluginInfo[]
    loadingLocal: boolean
    loadingMarket: boolean
    installingLocalFile: boolean
    localError: string | null
    marketError: string | null
    installingIds: Set<string>
    uninstallingId: string | null
    searchText: string
    kindFilter: PluginKindFilter
    apiKeyStatus: Record<string, boolean>
    expandedApiKeyPluginId: string | null
    apiKeyDraft: string
    savingApiKeyPluginId: string | null
    apiKeyInputRef: RefObject<HTMLInputElement | null>
    onRefreshLocal: () => void | Promise<void>
    onRefreshMarket: () => void | Promise<void>
    onInstallFromFile: () => void | Promise<void>
    onInstallDroppedFile: (paths: readonly string[]) => void | Promise<void>
    onUninstall: (pluginId: string) => void | Promise<void>
    onInstall: (pluginId: string) => void | Promise<void>
    onSearchTextChange: (value: string) => void
    onKindFilterChange: (value: PluginKindFilter) => void
    onConfigureApiKey: (pluginId: string) => void
    onDeleteApiKey: (pluginId: string) => void | Promise<void>
    onApiKeyDraftChange: (value: string) => void
    onSaveApiKey: (pluginId: string) => void | Promise<void>
    onCancelApiKey: () => void
}

function PluginPagination({
                              page,
                              pageCount,
                              ariaLabel,
                              onPageChange,
                          }: {
    page: number
    pageCount: number
    ariaLabel: string
    onPageChange: (page: number) => void
}) {
    return (
        <nav
            className={`settings-plugin-pagination${pageCount <= 1 ? ' is-placeholder' : ''}`}
            aria-label={ariaLabel}
            aria-hidden={pageCount <= 1}
        >
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => onPageChange(page - 1)}
            >
                上一页
            </Button>
            <span aria-live="polite">{page} / {pageCount}</span>
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page === pageCount}
                onClick={() => onPageChange(page + 1)}
            >
                下一页
            </Button>
        </nav>
    )
}

function PluginsPanel({
                          localPlugins,
                          marketPlugins,
                          loadingLocal,
                          loadingMarket,
                          installingLocalFile,
                          localError,
                          marketError,
                          installingIds,
                          uninstallingId,
                          searchText,
                          kindFilter,
                          apiKeyStatus,
                          expandedApiKeyPluginId,
                          apiKeyDraft,
                          savingApiKeyPluginId,
                          apiKeyInputRef,
                          onRefreshLocal,
                          onRefreshMarket,
                          onInstallFromFile,
                          onInstallDroppedFile,
                          onUninstall,
                          onInstall,
                          onSearchTextChange,
                          onKindFilterChange,
                          onConfigureApiKey,
                          onDeleteApiKey,
                          onApiKeyDraftChange,
                          onSaveApiKey,
                          onCancelApiKey,
                      }: PluginsPanelProps) {
    const [pluginLibraryOpen, setPluginLibraryOpen] = useState(false)
    const [installedPage, setInstalledPage] = useState(1)
    const [marketPage, setMarketPage] = useState(1)
    const [nativeFileDragActive, setNativeFileDragActive] = useState(false)
    const pluginDropZoneRef = useRef<HTMLButtonElement>(null)
    const installedPluginMap = new Map(localPlugins.map(plugin => [normalizePluginKey(plugin.id), plugin]))
    const installedIds = new Set(installedPluginMap.keys())
    const marketPluginMap = new Map(marketPlugins.map(plugin => [normalizePluginKey(plugin.id), plugin]))
    const filteredMarket = marketPlugins.filter(plugin => {
        const matchKind = kindFilter === 'all' || plugin.kind.includes(kindFilter)
        const query = searchText.trim().toLowerCase()
        const matchSearch = !query
            || plugin.name.toLowerCase().includes(query)
            || plugin.author.toLowerCase().includes(query)
        return matchKind && matchSearch
    })
    const {
        viewportRef: installedViewportRef,
        listRef: installedListRef,
        pageSize: installedPageSize,
    } = usePluginPageCapacity(true, localPlugins.length)
    const {
        viewportRef: marketViewportRef,
        listRef: marketListRef,
        pageSize: marketPageSize,
    } = usePluginPageCapacity(pluginLibraryOpen, filteredMarket.length)
    const installedPageCount = Math.max(1, Math.ceil(localPlugins.length / installedPageSize))
    const currentInstalledPage = Math.min(installedPage, installedPageCount)
    const paginatedLocalPlugins = localPlugins.slice(
        (currentInstalledPage - 1) * installedPageSize,
        currentInstalledPage * installedPageSize,
    )
    const marketPageCount = Math.max(1, Math.ceil(filteredMarket.length / marketPageSize))
    const currentMarketPage = Math.min(marketPage, marketPageCount)
    const paginatedMarketPlugins = filteredMarket.slice(
        (currentMarketPage - 1) * marketPageSize,
        currentMarketPage * marketPageSize,
    )

    useEffect(() => {
        setInstalledPage(page => Math.min(page, installedPageCount))
    }, [installedPageCount])

    useEffect(() => {
        setMarketPage(page => Math.min(page, marketPageCount))
    }, [marketPageCount])

    useEffect(() => {
        let disposed = false
        let unlisten: (() => void) | undefined
        const isInsideDropZone = (position: {x: number; y: number}) => {
            const rect = pluginDropZoneRef.current?.getBoundingClientRect()
            if (!rect) return false
            // Tauri 使用物理像素，DOM 矩形使用 CSS 像素。
            const scale = window.devicePixelRatio || 1
            const x = position.x / scale
            const y = position.y / scale
            return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        }

        void listenNativeFileDrop((event) => {
            if (event.type === 'leave') {
                setNativeFileDragActive(false)
                return
            }
            const inside = isInsideDropZone(event.position)
            if (event.type === 'drop') {
                setNativeFileDragActive(false)
                if (inside && !installingLocalFile) void onInstallDroppedFile(event.paths)
                return
            }
            setNativeFileDragActive(inside)
        }).then((release) => {
            if (disposed) release()
            else unlisten = release
        }).catch((error) => {
            if (!disposed) logger.warn('[Settings] 监听插件文件拖放失败', error)
        })

        return () => {
            disposed = true
            unlisten?.()
        }
    }, [installingLocalFile, onInstallDroppedFile])

    return (
        <>
            <div className="settings-container settings-plugin-page fc-page-shell fc-page-shell--narrow">
                <div className="settings-title fc-page-header">
                    <div className="fc-page-title-block">
                        <h1 className="fc-page-title">插件管理</h1>
                    </div>
                </div>

                <section className="settings-section settings-plugin-section fc-section-card">
                    <div className="plugins-section-header">
                        <h2 className="plugins-section-title fc-section-title">已安装插件</h2>
                        <div className="plugins-section-actions">
                            <Button
                                type="button"
                                size="sm"
                                onClick={() => setPluginLibraryOpen(true)}
                            >
                                安装插件
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={loadingLocal}
                                onClick={onRefreshLocal}
                            >
                                {loadingLocal ? '刷新中…' : '刷新'}
                            </Button>
                        </div>
                    </div>

                    {localError && (
                        <div className="plugins-error fc-status-banner fc-status-banner--error">{localError}</div>
                    )}

                    <div ref={installedViewportRef} className="plugins-list-viewport">
                        <div ref={installedListRef} className="plugins-list">
                            {localPlugins.length === 0 && !loadingLocal ? (
                                <div className="plugins-empty">暂无已安装插件</div>
                            ) : (
                                paginatedLocalPlugins.map(plugin => {
                                const marketPlugin = marketPluginMap.get(normalizePluginKey(plugin.id))
                                const updateVersion = marketPlugin
                                && isRemoteVersionNewer(plugin.version, marketPlugin.version)
                                    ? marketPlugin.version
                                    : undefined
                                const isExpanded = expandedApiKeyPluginId === plugin.id
                                const isSaving = savingApiKeyPluginId === plugin.id
                                const isConfigured = apiKeyStatus[plugin.id] === true

                                return (
                                    <div
                                        key={plugin.id}
                                        className={`settings-plugin-card${isExpanded ? ' is-expanded' : ''}`}
                                    >
                                    <LocalPluginCard
                                        plugin={plugin}
                                        updateVersion={updateVersion}
                                        onUninstall={onUninstall}
                                        uninstalling={uninstallingId === plugin.id}
                                    />
                                    <div className="settings-plugin-credentials">
                                        <div className="settings-plugin-credential-copy">
                                            <span className="settings-plugin-credential-title">访问密钥</span>
                                            <span className="settings-plugin-credential-hint">凭据仅保存在此设备</span>
                                        </div>
                                        <div className="settings-api-key-actions">
                                            <span className={`settings-api-key-status${isConfigured ? '' : ' is-missing'}`}>
                                                {isConfigured ? '已配置' : '未配置'}
                                            </span>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => onConfigureApiKey(plugin.id)}
                                            >
                                                {isConfigured ? '重新配置' : '配置'}
                                            </Button>
                                            {isConfigured && (
                                                <Button
                                                    type="button"
                                                    variant="danger"
                                                    size="sm"
                                                    onClick={() => onDeleteApiKey(plugin.id)}
                                                >
                                                    删除密钥
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    <div className={`settings-api-key-drawer${isExpanded ? ' is-open' : ''}`}>
                                        <div className="settings-api-key-drawer-inner">
                                            <form
                                                className="settings-api-key-form"
                                                onSubmit={(event) => {
                                                    event.preventDefault()
                                                    void onSaveApiKey(plugin.id)
                                                }}
                                            >
                                                <label className="settings-api-key-form-label">访问密钥</label>
                                                <Input
                                                    type="password"
                                                    ref={isExpanded ? apiKeyInputRef : undefined}
                                                    value={isExpanded ? apiKeyDraft : ''}
                                                    onValueChange={(value) => onApiKeyDraftChange(String(value))}
                                                    placeholder={`请输入 ${plugin.name} 的访问密钥`}
                                                    style={{flex: 1}}
                                                />
                                                <div className="settings-api-key-form-actions">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={onCancelApiKey}
                                                        disabled={isSaving}
                                                    >
                                                        取消
                                                    </Button>
                                                    <Button size="sm" type="submit" disabled={isSaving}>
                                                        {isSaving ? '保存中...' : '保存'}
                                                    </Button>
                                                </div>
                                            </form>
                                        </div>
                                    </div>
                                    </div>
                                )
                                })
                            )}
                        </div>
                    </div>
                    <PluginPagination
                        page={currentInstalledPage}
                        pageCount={installedPageCount}
                        ariaLabel="已安装插件分页"
                        onPageChange={setInstalledPage}
                    />
                </section>
            </div>

            <FloatingPanel
                open={pluginLibraryOpen}
                onClose={() => setPluginLibraryOpen(false)}
                title="插件库"
                className="settings-plugin-library-panel"
            >
                <div className="settings-plugin-library-content">
                    <button
                        ref={pluginDropZoneRef}
                        type="button"
                        className={`settings-plugin-dropzone${nativeFileDragActive ? ' is-active' : ''}`}
                        disabled={installingLocalFile}
                        onClick={onInstallFromFile}
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>
                        </svg>
                        <span>
                            <strong>{installingLocalFile ? '正在安装插件…' : nativeFileDragActive ? '松开以安装插件' : '拖入 .fcplug 安装本地插件'}</strong>
                            <small>也可以点击选择文件</small>
                        </span>
                    </button>
                    <div className="plugins-filter-bar">
                        <Input
                            placeholder="搜索名称或作者…"
                            value={searchText}
                            onValueChange={(value) => {
                                setMarketPage(1)
                                onSearchTextChange(value)
                            }}
                            className="plugins-search"
                        />
                        <div className="plugins-kind-tabs">
                            {(['all', 'llm', 'image', 'tts'] as const).map(kind => (
                                <button
                                    key={kind}
                                    type="button"
                                    className={`plugins-kind-tab${kindFilter === kind ? ' active' : ''}`}
                                    onClick={() => {
                                        setMarketPage(1)
                                        onKindFilterChange(kind)
                                    }}
                                >
                                    {PLUGIN_KIND_LABELS[kind]}
                                </button>
                            ))}
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            className="settings-plugin-library-refresh"
                            disabled={loadingMarket}
                            onClick={onRefreshMarket}
                        >
                            {loadingMarket ? '加载中…' : '刷新'}
                        </Button>
                    </div>

                    {marketError && (
                        <div className="plugins-error fc-status-banner fc-status-banner--error">{marketError}</div>
                    )}

                    <div ref={marketViewportRef} className="plugins-list-viewport">
                        <div ref={marketListRef} className="plugins-list">
                            {filteredMarket.length === 0 && !loadingMarket ? (
                                <div className="plugins-empty">
                                    {marketPlugins.length === 0 ? '暂无可用插件' : '无匹配结果'}
                                </div>
                            ) : (
                                paginatedMarketPlugins.map(plugin => {
                                const installedPlugin = installedPluginMap.get(normalizePluginKey(plugin.id))
                                const hasUpdate = installedPlugin
                                    ? isRemoteVersionNewer(installedPlugin.version, plugin.version)
                                    : false
                                return (
                                    <MarketPluginCard
                                        key={plugin.id}
                                        plugin={plugin}
                                        installedIds={installedIds}
                                        installedVersion={installedPlugin?.version}
                                        hasUpdate={hasUpdate}
                                        onInstall={onInstall}
                                        installing={installingIds.has(plugin.id)}
                                    />
                                )
                                })
                            )}
                        </div>
                    </div>
                    <PluginPagination
                        page={currentMarketPage}
                        pageCount={marketPageCount}
                        ariaLabel="插件库分页"
                        onPageChange={setMarketPage}
                    />
                </div>
            </FloatingPanel>
        </>
    )
}
interface SettingsProps {
    onBack?: () => void
    openIntent?: SettingsOpenIntent
}

export interface SettingsOpenIntent {
    tab?: SettingsTab
    pluginKind?: SettingsPluginKindFilter
    focus?: SettingsFocusTarget | null
    apiKeyPluginId?: string | null
    requestId?: number
}

export default function Settings({
                                     onBack,
                                     openIntent,
                                 }: SettingsProps) {
    const initialTab = openIntent?.tab ?? 'storage'
    const initialPluginKind = openIntent?.pluginKind ?? 'all'
    const initialFocus = openIntent?.focus ?? null
    const initialApiKeyPluginId = openIntent?.apiKeyPluginId ?? null
    const focusRequestId = openIntent?.requestId ?? 0
    const {showAlert} = useAlert()
    const showAlertRef = useRef(showAlert)
    const writerModeFieldRef = useRef<HTMLDivElement>(null)
    const apiKeyInputRef = useRef<HTMLInputElement>(null)
    const handledFocusRequestIdRef = useRef<number | null>(null)
    const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
    const [focusedSetting, setFocusedSetting] = useState<SettingsFocusTarget | null>(null)
    const {
        width: settingsSidebarWidth,
        collapsed: settingsSidebarCollapsed,
        dragging: settingsSidebarDragging,
        layoutRef: settingsLayoutRef,
        expand: expandSettingsSidebar,
        collapse: collapseSettingsSidebar,
        handleMouseDown: handleSettingsSidebarResizeStart,
        handleKeyDown: handleSettingsSidebarDividerKeyDown,
    } = useResizableSidebar({
        widthVariable: '--settings-sidebar-width',
        minWidth: SETTINGS_SIDEBAR_MIN_WIDTH,
        maxWidth: SETTINGS_SIDEBAR_MAX_WIDTH,
        defaultWidth: SETTINGS_SIDEBAR_DEFAULT_WIDTH,
        collapseThresholdRatio: SETTINGS_SIDEBAR_COLLAPSE_THRESHOLD_RATIO,
    })

    useEffect(() => {
        showAlertRef.current = showAlert
    }, [showAlert])

    // ── 系统配置状态 ──
    const appSettingsStore = useAppSettingsStore()
    const pluginCatalog = usePluginCatalogStore()
    const [loading, setLoading] = useState(true)
    const [settings, setSettings] = useState<AppSettings | null>(null)
    const mediaDir = appSettingsStore.mediaDir
    const defaultPaths = appSettingsStore.defaultPaths
    const [configDir, setConfigDir] = useState<string>('')
    const settingsSaveSuccessNoticeEnabledRef = useRef(false)

    // ── AI 配置状态 ──
    const llmPlugins = appSettingsStore.llmPlugins
    const imagePlugins = appSettingsStore.imagePlugins
    const ttsPlugins = appSettingsStore.ttsPlugins
    const apiKeyStatus = appSettingsStore.apiKeyStatus
    const [expandedApiKeyPluginId, setExpandedApiKeyPluginId] = useState<string | null>(null)
    const [apiKeyDraft, setApiKeyDraft] = useState('')
    const [savingApiKeyPluginId, setSavingApiKeyPluginId] = useState<string | null>(null)

    // ── 插件管理状态 ──
    const localPlugins = pluginCatalog.localPlugins
    const marketPlugins = pluginCatalog.marketPlugins
    const loadingLocal = pluginCatalog.loadingLocal
    const loadingMarket = pluginCatalog.loadingMarket
    const installingLocalFile = pluginCatalog.installingLocalFile
    const localError = pluginCatalog.localError
    const marketError = pluginCatalog.marketError
    const installingIds = pluginCatalog.installingIds
    const uninstallingId = pluginCatalog.uninstallingId
    const [searchText, setSearchText] = useState('')
    const [kindFilter, setKindFilter] = useState<PluginKindFilter>(initialPluginKind)
    const [pluginDirectoryLoaded, setPluginDirectoryLoaded] = useState(false)
    const {setTheme} = useTheme();

    // ── 用量统计状态 ──
    const [usageSummary, setUsageSummary] = useState<ApiUsageSummary | null>(null)
    const [usageByModel, setUsageByModel] = useState<ApiUsageByModel[]>([])
    const [usageDaily, setUsageDaily] = useState<ApiUsageDaily[]>([])
    const [usageLoading, setUsageLoading] = useState(false)
    const [usageError, setUsageError] = useState<string | null>(null)

    const loadUsageStats = useCallback(async () => {
        setUsageLoading(true)
        setUsageError(null)
        try {
            const [summary, byModel, daily] = await Promise.all([
                ai_get_usage_summary(),
                ai_get_usage_by_model(),
                ai_get_usage_daily(),
            ])
            setUsageSummary(summary)
            setUsageByModel(byModel)
            setUsageDaily(daily)
        } catch (e) {
            setUsageError(String(e))
        } finally {
            setUsageLoading(false)
        }
    }, [])

    useEffect(() => {
        setActiveTab(initialTab)
        if (initialTab === 'plugins') {
            setKindFilter(initialPluginKind)
        }
    }, [initialPluginKind, initialTab])

    useEffect(() => {
        if (loading || !settings || activeTab !== 'permissions' || initialFocus !== 'writer-mode') return
        if (handledFocusRequestIdRef.current === focusRequestId) return
        handledFocusRequestIdRef.current = focusRequestId
        const frameId = window.requestAnimationFrame(() => {
            writerModeFieldRef.current?.scrollIntoView({behavior: 'smooth', block: 'center'})
            setFocusedSetting('writer-mode')
        })
        const timeoutId = window.setTimeout(() => setFocusedSetting(null), 1800)
        return () => {
            window.cancelAnimationFrame(frameId)
            window.clearTimeout(timeoutId)
        }
    }, [activeTab, focusRequestId, initialFocus, loading, settings])

    useEffect(() => {
        if (loading || !settings || activeTab !== 'plugins' || initialFocus !== 'api-key' || !initialApiKeyPluginId) return
        const targetPlugin = localPlugins.find(plugin => (
            normalizePluginKey(plugin.id) === normalizePluginKey(initialApiKeyPluginId)
        ))
        if (!targetPlugin) return
        if (handledFocusRequestIdRef.current === focusRequestId) return
        handledFocusRequestIdRef.current = focusRequestId
        setExpandedApiKeyPluginId(targetPlugin.id)
        setApiKeyDraft('')
    }, [
        activeTab,
        focusRequestId,
        initialApiKeyPluginId,
        initialFocus,
        localPlugins,
        loading,
        settings,
    ])

    useEffect(() => {
        if (activeTab !== 'plugins' || !expandedApiKeyPluginId) return
        const frameId = window.requestAnimationFrame(() => {
            apiKeyInputRef.current?.scrollIntoView({behavior: 'smooth', block: 'center'})
            apiKeyInputRef.current?.focus()
        })
        return () => window.cancelAnimationFrame(frameId)
    }, [activeTab, expandedApiKeyPluginId])

    // 切换到用量统计 tab 时自动加载
    useEffect(() => {
        if (activeTab === 'usage') {
            void loadUsageStats()
        }
    }, [activeTab, loadUsageStats])

    const getPluginsForType = useCallback((type: 'llm' | 'image' | 'tts') => {
        if (type === 'llm') return llmPlugins
        if (type === 'image') return imagePlugins
        return ttsPlugins
    }, [imagePlugins, llmPlugins, ttsPlugins])

    const getPluginById = useCallback((type: 'llm' | 'image' | 'tts', pluginId: string | null) => {
        if (!pluginId) return null
        const targetKey = normalizePluginKey(pluginId)
        return getPluginsForType(type).find(plugin => normalizePluginKey(plugin.id) === targetKey) ?? null
    }, [getPluginsForType])

    const resolveDefaultModel = useCallback((type: 'llm' | 'image' | 'tts', pluginId: string | null) => {
        const plugin = getPluginById(type, pluginId)
        if (!plugin) return null
        return plugin.default_model ?? plugin.models[0] ?? null
    }, [getPluginById])

    // 初始化加载
    const loadData = useCallback(async (source = 'manual') => {
        try {
            setLoading(true)
            settingsSaveSuccessNoticeEnabledRef.current = false
            const [
                bootstrap,
                configDirData,
            ] = await Promise.all([
                refreshAppSettings(),
                appConfigDir(),
            ])

            logger.info('[Settings] 加载设置完成', {
                source,
                theme: bootstrap.settings?.theme,
                themeColorRecipeId: bootstrap.settings?.theme_color_config?.recipeId ?? null,
                mediaDir: bootstrap.mediaDir,
            })
            setSettings(bootstrap.settings)
            setConfigDir(configDirData)
        } catch (error) {
            const errStr = String(error)
            logger.error('[Settings] 加载设置失败', {source, error})
            if (!errStr.includes('state not managed')) {
                await showAlertRef.current('加载设置失败: ' + error, 'error')
            }
        } finally {
            setLoading(false)
        }
    }, [])

    const loadLocal = useCallback(async () => {
        await refreshLocalPlugins()
    }, [])

    const loadMarket = useCallback(async () => {
        await refreshMarketPlugins()
    }, [])

    useEffect(() => {
        loadData('mount').catch(logger.error)
    }, [loadData])

    // 后端异步初始化完成后重新加载（AiState 在 DB 就绪后才 manage）
    useEffect(() => {
        const unlisten = listen('backend-ready', () => {
            logger.info('[Settings] 收到 backend-ready，重新加载设置')
            loadData('backend-ready').catch(logger.error)
        })
        return () => {
            unlisten.then(f => f())
        }
    }, [loadData])

    useEffect(() => {
        if (activeTab !== 'plugins' || pluginDirectoryLoaded) return
        setPluginDirectoryLoaded(true)
        loadLocal().catch(logger.error)
        loadMarket().catch(logger.error)
    }, [activeTab, loadLocal, loadMarket, pluginDirectoryLoaded])

    useEffect(() => {
        if (!settings || loading) return

        setSettings(prev => {
            if (!prev) return null

            const normalizeAiConfig = <T extends 'llm' | 'image' | 'tts'>(type: T) => {
                const plugin = getPluginById(type, prev[type].plugin_id)
                if (!plugin) {
                    return prev[type].plugin_id || prev[type].default_model
                        ? {...prev[type], plugin_id: null, default_model: null}
                        : prev[type]
                }

                const currentModel = prev[type].default_model
                const hasCurrentModel = currentModel ? plugin.models.includes(currentModel) : false
                if (hasCurrentModel) return prev[type]

                const nextDefaultModel = resolveDefaultModel(type, prev[type].plugin_id)
                if (currentModel === nextDefaultModel) return prev[type]

                return {
                    ...prev[type],
                    default_model: nextDefaultModel
                }
            }

            const nextLlm = normalizeAiConfig('llm')
            const nextImage = normalizeAiConfig('image')
            const normalizedTts = normalizeAiConfig('tts')
            const ttsPlugin = getPluginById('tts', normalizedTts.plugin_id)
            const nextTtsVoiceId = normalizeVoiceIdWithPlugin(ttsPlugin, normalizedTts.voice_id)
            const nextTts = nextTtsVoiceId === normalizedTts.voice_id
                ? normalizedTts
                : {
                    ...normalizedTts,
                    voice_id: nextTtsVoiceId,
                }
            const nextSearchSources = normalizeSearchSources(prev.search_sources)
            const searchSourcesChanged = SEARCH_SOURCE_OPTIONS.some(({key}) =>
                nextSearchSources[key] !== prev.search_sources?.[key]
            )
            const changed = nextLlm !== prev.llm
                || nextImage !== prev.image
                || nextTts !== prev.tts
                || searchSourcesChanged

            return changed ? {
                ...prev,
                llm: nextLlm,
                image: nextImage,
                tts: nextTts,
                search_sources: nextSearchSources
            } : prev
        })
    }, [getPluginById, loading, resolveDefaultModel, settings])

    // 字体大小变化时实时通知其他组件
    useEffect(() => {
        if (!settings || loading) return
        window.dispatchEvent(new CustomEvent('fc:editor-font-size-change', {
            detail: {fontSize: settings.editor_font_size}
        }))
    }, [settings?.editor_font_size, loading]) // eslint-disable-line react-hooks/exhaustive-deps

    const persistSettings = useCallback(async (nextSettings: AppSettings, showSuccessNotice = true) => {
        try {
            logger.info('[Settings] 准备保存设置', {
                theme: nextSettings.theme,
                themeColorRecipeId: nextSettings.theme_color_config?.recipeId ?? null,
                showSuccessNotice,
            })
            // 新 API 返回迁移摘要字符串（路径变更时自动复制文件），非空则弹窗提示
            const {migrationMessage: migrationMsg, settings: savedSettings} = await saveAppSettings(nextSettings)
            logger.info('[Settings] 设置保存完成', {
                requestTheme: nextSettings.theme,
                savedTheme: savedSettings.theme,
                requestThemeColorRecipeId: nextSettings.theme_color_config?.recipeId ?? null,
                savedThemeColorRecipeId: savedSettings.theme_color_config?.recipeId ?? null,
                migrationMsg,
                newMediaDir: appSettingsStore.mediaDir,
            })
            const shouldShowSuccessNotice = showSuccessNotice && settingsSaveSuccessNoticeEnabledRef.current
            settingsSaveSuccessNoticeEnabledRef.current = true
            if (migrationMsg) {
                await showAlertRef.current(migrationMsg, 'info', 'nonInvasive', 3500)
            } else if (shouldShowSuccessNotice) {
                void showAlertRef.current('设置已保存', 'success', 'nonInvasive', 1200)
            }
        } catch (error) {
            const message = String(error)
            logger.error('设置保存失败:', error)
            void showAlertRef.current(`设置保存失败：${message}`, 'error')
        }
    }, [appSettingsStore.mediaDir])

    const handleThemeChange = useCallback((value: SelectValue) => {
        if (!settings) return

        const nextTheme = normalizeThemeSelectValue(value)
        const nextSettings = {...settings, theme: nextTheme}
        logger.info('[Settings] 主题切换', {
            previousTheme: settings.theme,
            nextTheme,
            rawValue: value,
        })
        setSettings(nextSettings)
        setTheme(nextTheme)
        void persistSettings(nextSettings, false)
    }, [persistSettings, setTheme, settings])

    const handleThemeColorConfigChange = useCallback((themeColorConfig: AppSettings['theme_color_config']) => {
        if (!settings) return

        const nextSettings = {...settings, theme_color_config: themeColorConfig}
        logger.info('[Settings] 颜色主题配置变更，立即保存', {
            recipeId: themeColorConfig?.recipeId ?? null,
            tokenCount: themeColorConfig ? Object.keys(themeColorConfig.tokenColors).length : 0,
        })
        setSettings(nextSettings)
        void persistSettings(nextSettings, false)
    }, [persistSettings, settings])

    // 自动保存设置
    useEffect(() => {
        if (!settings || loading) return

        const timer = setTimeout(() => {
            void persistSettings(settings)
        }, 500) // 防抖 500ms

        return () => clearTimeout(timer)
    }, [settings, loading, persistSettings])

    // 重置为默认值
    const handleReset = () => {
        const defaultSettings: AppSettings = {
            media_dir: null,
            db_path: null,
            plugins_path: null,
            starred_project_ids: [],
            starred_entry_ids: [],
            theme: 'system',
            language: 'zh-CN',
            editor_font_size: 14,
            theme_color_config: null,
            shell_acrylic_enabled: true,
            auto_save_secs: 0,
            auto_backup_secs: 300,
            backup_dir: null,
            max_backup_count: 20,
            default_entry_type: null,
            llm: {
                plugin_id: null,
                default_model: null,
                temperature: 0.7,
                top_p: 0.9,
                frequency_penalty: 0,
                presence_penalty: 0,
                max_tokens: 8192,
                stream: true,
                show_reasoning: false,
                app_sense_custom_prompt: '',
                writer_mode_enabled: false,
                auto_compact_enabled: true,
                auto_compact_threshold_ratio: 0.65,
                auto_compact_recent_messages: 8,
                auto_compact_detail: 'balanced',
                token_calibration_factors: {},
                model_price_overrides: {},
                monthly_budget_amount: null,
                monthly_budget_currency: 'USD',
                budget_warn_ratio: 0.8,
            },
            image: {
                plugin_id: null,
                default_model: null
            },
            tts: {
                plugin_id: null,
                default_model: null,
                voice_id: null,
                auto_play: true
            },
            search_engine: 'bing',
            search_sources: {...DEFAULT_SEARCH_SOURCE_SETTINGS}
        }
        setSettings(defaultSettings)
        void showAlert('已重置为默认设置', 'info', 'nonInvasive')
    }

    // 在系统文件管理器中打开目录
    const handleOpenDir = useCallback((path: string) => {
        if (!path) return
        open_in_file_manager(path).catch((err) => {
            logger.error('打开目录失败', err)
            void showAlert(`打开目录失败：${String(err)}`, 'error', 'nonInvasive', 2200)
        })
    }, [showAlert])

    // 选择媒体目录
    const handleSelectMediaDir = async () => {
        const selected = await openFileDialog({
            directory: true,
            multiple: false,
            title: '选择媒体文件根目录'
        })
        if (selected) {
            setSettings(prev => prev ? {
                ...prev,
                media_dir: Array.isArray(selected) ? selected[0] : selected
            } : null)
        }
    }

    // 选择数据库目录
    const handleSelectDbPath = async () => {
        const selected = await openFileDialog({
            directory: true,
            multiple: false,
            title: '选择数据库存储目录'
        })
        if (selected) {
            setSettings(prev => prev ? {
                ...prev,
                db_path: Array.isArray(selected) ? selected[0] : selected
            } : null)
        }
    }

    // 选择插件目录
    const handleSelectPluginsPath = async () => {
        const selected = await openFileDialog({
            directory: true,
            multiple: false,
            title: '选择插件存储目录'
        })
        if (selected) {
            setSettings(prev => prev ? {
                ...prev,
                plugins_path: Array.isArray(selected) ? selected[0] : selected
            } : null)
        }
    }

    // 选择 CSV 自动备份目录
    const handleSelectBackupDir = async () => {
        const selected = await openFileDialog({
            directory: true,
            multiple: false,
            title: '选择 CSV 自动备份目录'
        })
        if (selected) {
            setSettings(prev => prev ? {
                ...prev,
                backup_dir: Array.isArray(selected) ? selected[0] : selected
            } : null)
        }
    }

    const handleOpenBackupDir = useCallback((path: string) => {
        if (!path) return
        setting_open_backup_dir(path).catch((err) => {
            logger.error('打开备份目录失败', err)
            void showAlert(`打开备份目录失败：${String(err)}`, 'error', 'nonInvasive', 2200)
        })
    }, [showAlert])

    const handleNumberSettingChange = (
        field: 'auto_backup_secs' | 'max_backup_count',
        value: string,
        fallback: number,
        min: number,
        max: number,
    ) => {
        const parsed = Number(value)
        const nextValue = Number.isFinite(parsed)
            ? Math.min(max, Math.max(min, Math.trunc(parsed)))
            : fallback
        setSettings(prev => prev ? {...prev, [field]: nextValue} : null)
    }

    // AI 配置处理
    const handleAiConfigChange = (
        type: 'llm' | 'image' | 'tts',
        field: 'plugin_id' | 'default_model',
        value: string | null
    ) => {
        setSettings(prev => {
            if (!prev) return null
            const aiConfig = {...prev[type], [field]: value}
            // 如果改变了插件，优先回填插件自身默认模型，再回退到首个模型
            if (field === 'plugin_id') {
                aiConfig.default_model = resolveDefaultModel(type, value)
            }
            return {...prev, [type]: aiConfig}
        })
    }

    const updateLlmDefaults = useCallback((patch: Partial<AppSettings['llm']>) => {
        setSettings(prev => prev ? {
            ...prev,
            llm: {
                ...prev.llm,
                ...patch,
            },
        } : null)
    }, [])

    const updateSearchSource = useCallback((key: SearchSourceKey, enabled: boolean) => {
        setSettings(prev => prev ? {
            ...prev,
            search_sources: {
                ...normalizeSearchSources(prev.search_sources),
                [key]: enabled,
            },
        } : null)
    }, [])

    const handleLlmCompactThresholdChange = useCallback((value: number | number[]) => {
        const rawValue = Array.isArray(value) ? value[0] : value
        const nextValue = Number.isFinite(rawValue) ? rawValue : 75
        updateLlmDefaults({
            auto_compact_threshold_ratio: Math.min(0.95, Math.max(0.5, nextValue / 100)),
        })
    }, [updateLlmDefaults])

    const handleLlmCompactRecentMessagesChange = useCallback((value: string) => {
        const parsed = Number(value)
        updateLlmDefaults({
            auto_compact_recent_messages: Number.isFinite(parsed)
                ? Math.min(30, Math.max(2, Math.trunc(parsed)))
                : 8,
        })
    }, [updateLlmDefaults])

    // 访问密钥管理
    const handleConfigureApiKey = (pluginId: string) => {
        setExpandedApiKeyPluginId(current => current === pluginId ? null : pluginId)
        setApiKeyDraft('')
    }

    const handleCancelApiKey = () => {
        setExpandedApiKeyPluginId(null)
        setApiKeyDraft('')
    }

    const handleSaveApiKey = async (pluginId: string) => {
        const nextApiKey = apiKeyDraft.trim()
        if (!nextApiKey) {
            void showAlert('请输入访问密钥', 'error')
            return
        }

        try {
            setSavingApiKeyPluginId(pluginId)
            await saveAppApiKey(pluginId, nextApiKey)
            setExpandedApiKeyPluginId(null)
            setApiKeyDraft('')
            void showAlert('访问密钥已保存', 'success', 'nonInvasive', 2000)
        } catch (error) {
            void showAlert('保存失败: ' + error, 'error')
        } finally {
            setSavingApiKeyPluginId(null)
        }
    }

    const handleDeleteApiKey = async (pluginId: string) => {
        try {
            await deleteAppApiKey(pluginId)
            if (expandedApiKeyPluginId === pluginId) {
                setExpandedApiKeyPluginId(null)
                setApiKeyDraft('')
            }
            void showAlert('访问密钥已删除', 'success', 'nonInvasive', 2000)
        } catch (error) {
            void showAlert('删除失败: ' + error, 'error')
        }
    }

    // 插件管理操作
    const handleInstall = async (pluginId: string) => {
        try {
            const info = await installMarketPlugin(pluginId)
            void showAlert(`${info.name} 安装成功`, 'success', 'nonInvasive', 2000)
        } catch (e) {
            void showAlert('安装失败: ' + e, 'error')
        }
    }

    const handleInstallPluginPath = useCallback(async (filePath: string) => {
        try {
            const info = await installLocalPlugin(filePath)
            void showAlert(`${info.name} 安装成功`, 'success', 'nonInvasive', 2000)
        } catch (e) {
            void showAlert('本地插件安装失败: ' + e, 'error')
        }
    }, [showAlert])

    const handleInstallFromFile = async () => {
        const selected = await openFileDialog({
            multiple: false,
            directory: false,
            title: '选择本地插件包',
            filters: [
                {
                    name: '流云AI 插件包',
                    extensions: ['fcplug'],
                },
            ],
        })
        if (!selected || Array.isArray(selected)) return

        await handleInstallPluginPath(selected)
    }

    const handleInstallDroppedFile = useCallback(async (paths: readonly string[]) => {
        const result = resolveDroppedPluginPath(paths)
        if (!result.ok) {
            await showAlert(result.error, 'warning', 'nonInvasive', 2400)
            return
        }
        await handleInstallPluginPath(result.path)
    }, [handleInstallPluginPath, showAlert])

    const handleUninstall = async (pluginId: string) => {
        const res = await showAlert('确认删除', 'warning', 'confirm')
        if (res !== 'yes') return
        try {
            await uninstallPlugin(pluginId)
        } catch (e) {
            void showAlert('卸载失败: ' + e, 'error')
        }
    }

    const selectedTtsPlugin = useMemo(
        () => getPluginById('tts', settings?.tts.plugin_id ?? null),
        [getPluginById, settings?.tts.plugin_id],
    )
    const ttsVoiceOptions = useMemo(
        () => buildTtsVoiceOptions(selectedTtsPlugin, '未选择'),
        [selectedTtsPlugin],
    )
    const searchSources = useMemo(
        () => normalizeSearchSources(settings?.search_sources),
        [settings?.search_sources],
    )
    const usageActivityDays = useMemo(() => buildUsageActivityDays(usageDaily), [usageDaily])
    const usageMonthLabels = useMemo(() => buildUsageMonthLabels(), [])
    const usageActiveDays = usageDaily.filter(row => row.call_count > 0).length
    const usageAverageTokens = usageSummary && usageSummary.call_count > 0
        ? Math.round(usageSummary.total_tokens / usageSummary.call_count)
        : 0
    const usageTopModel = usageByModel[0] ?? null
    if (loading || !settings) {
        return (
            <div className="settings-outer">
                <div
                    ref={settingsLayoutRef}
                    className={`settings-page-layout ${settingsSidebarCollapsed ? 'is-sidebar-collapsed' : ''} ${settingsSidebarDragging ? 'is-sidebar-dragging' : ''}`}
                    style={{
                        '--settings-sidebar-width': `${settingsSidebarCollapsed ? 0 : settingsSidebarWidth}px`,
                        '--settings-sidebar-content-min-width': SETTINGS_SIDEBAR_MIN_WIDTH,
                    } as CSSProperties}
                >
                    <SettingsSidebar
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                        onBack={onBack}
                        collapsed={settingsSidebarCollapsed}
                        onCollapseToggle={settingsSidebarCollapsed ? expandSettingsSidebar : collapseSettingsSidebar}
                    />
                    <SidebarResizeHandle
                        dragging={settingsSidebarDragging}
                        onMouseDown={handleSettingsSidebarResizeStart}
                        onKeyDown={handleSettingsSidebarDividerKeyDown}
                        ariaLabel="调整设置导航宽度"
                    />
                    <div className="settings-content settings-loading-shell" style={{padding: '20px'}}>加载中...</div>
                </div>
            </div>
        )
    }

    // 生成 Select 选项
    const themeOptions = [
        {value: 'system', label: '跟随系统'},
        {value: 'light', label: '浅色'},
        {value: 'dark', label: '深色'}
    ]

    const languageOptions = [
        {value: 'zh-CN', label: '简体中文'},
        {value: 'en-US', label: 'English'}
    ]

    const getPluginOptions = (type: 'llm' | 'image' | 'tts') => {
        const plugins = getPluginsForType(type)
        return [
            {value: '', label: '未选择'},
            ...plugins.map(p => ({value: p.id, label: p.name}))
        ]
    }

    const getModelOptions = (type: 'llm' | 'image' | 'tts') => {
        const plugin = getPluginById(type, settings[type].plugin_id)
        if (!plugin) return [{value: '', label: '请先选择插件'}]

        return [
            {value: '', label: '未选择'},
            ...plugin.models.map(m => ({value: m, label: m}))
        ]
    }

    const effectiveDbDir = settings.db_path || defaultPaths?.db_path || ''
    const derivedBackupDir = effectiveDbDir
        ? `${effectiveDbDir.replace(/[\\/]+$/, '')}${effectiveDbDir.includes('\\') ? '\\' : '/'}backup`
        : defaultPaths?.backup_path || ''
    const effectiveBackupDir = settings.backup_dir || derivedBackupDir

    return (
        <div className="settings-outer">
            <div
                ref={settingsLayoutRef}
                className={`settings-page-layout ${settingsSidebarCollapsed ? 'is-sidebar-collapsed' : ''} ${settingsSidebarDragging ? 'is-sidebar-dragging' : ''}`}
                style={{
                    '--settings-sidebar-width': `${settingsSidebarCollapsed ? 0 : settingsSidebarWidth}px`,
                    '--settings-sidebar-content-min-width': SETTINGS_SIDEBAR_MIN_WIDTH,
                } as CSSProperties}
            >
                <SettingsSidebar
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    onBack={onBack}
                    collapsed={settingsSidebarCollapsed}
                    onCollapseToggle={settingsSidebarCollapsed ? expandSettingsSidebar : collapseSettingsSidebar}
                />
                <SidebarResizeHandle
                    dragging={settingsSidebarDragging}
                    onMouseDown={handleSettingsSidebarResizeStart}
                    onKeyDown={handleSettingsSidebarDividerKeyDown}
                    ariaLabel="调整设置导航宽度"
                />
                <RollingBox axis="y" className="settings-scroll-area" thumbSize={'thin'}>
                    <div className="settings-content">
                    {activeTab === 'storage' && (
                        <div className="settings-container fc-page-shell fc-page-shell--narrow">
                            <div className="settings-title fc-page-header">
                                <div className="fc-page-title-block">
                                    <h1 className="fc-page-title">存储与备份</h1>
                                </div>
                            </div>

                            {/* 存储 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">存储</h2>
                                <div className="settings-field">
                                    <label className="settings-label-wide">配置目录</label>
                                    <Input
                                        value={configDir}
                                        readOnly
                                        placeholder="加载中…"
                                        style={{flex: 1}}
                                    />
                                    <div className="settings-field-actions">
                                        <Button type="button" size={"sm"} variant="outline"
                                                onClick={() => handleOpenDir(configDir)}>
                                            打开
                                        </Button>
                                    </div>
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label-wide">媒体目录</label>
                                    <Input
                                        value={settings.media_dir || mediaDir}
                                        readOnly
                                        placeholder="使用默认目录"
                                        style={{flex: 1}}
                                    />
                                    <div className="settings-field-actions">
                                        <Button type="button" size={"sm"} onClick={handleSelectMediaDir}>浏览</Button>
                                    </div>
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label-wide">数据库目录</label>
                                    <Input
                                        value={settings.db_path || ''}
                                        readOnly
                                        placeholder="Windows: 程序目录  其他: 系统数据目录"
                                        style={{flex: 1}}
                                    />
                                    <div className="settings-field-actions">
                                        <Button type="button" size={"sm"} onClick={handleSelectDbPath}>浏览</Button>
                                        {settings.db_path && defaultPaths && settings.db_path !== defaultPaths.db_path && (
                                            <Button type="button" size={"sm"} variant="outline" onClick={() =>
                                                setSettings(prev => prev ? {...prev, db_path: null} : null)
                                            }>重置</Button>
                                        )}
                                    </div>
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label-wide">插件目录</label>
                                    <Input
                                        value={settings.plugins_path || ''}
                                        readOnly
                                        placeholder="Windows: 程序目录/plugins  其他: 系统数据目录/plugins"
                                        style={{flex: 1}}
                                    />
                                    <div className="settings-field-actions">
                                        <Button type="button" size={"sm"} onClick={handleSelectPluginsPath}>浏览</Button>
                                        {settings.plugins_path && defaultPaths && settings.plugins_path !== defaultPaths.plugins_path && (
                                            <Button type="button" size={"sm"} variant="outline" onClick={() =>
                                                setSettings(prev => prev ? {...prev, plugins_path: null} : null)
                                            }>重置</Button>
                                        )}
                                    </div>
                                </div>
                            </section>

                            {/* 备份 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">备份</h2>
                                <div className="settings-field">
                                    <label className="settings-label-wide">备份目录</label>
                                    <Input
                                        value={effectiveBackupDir}
                                        readOnly
                                        placeholder="数据库目录下的 backup"
                                        style={{flex: 1}}
                                    />
                                    <div className="settings-field-actions">
                                        <Button type="button" size="sm" onClick={handleSelectBackupDir}>浏览</Button>
                                        <Button type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={!effectiveBackupDir}
                                            onClick={() => handleOpenBackupDir(effectiveBackupDir)}
                                        >
                                            打开
                                        </Button>
                                        {settings.backup_dir && (
                                            <Button type="button" size="sm" variant="outline" onClick={() =>
                                                setSettings(prev => prev ? {...prev, backup_dir: null} : null)
                                            }>重置</Button>
                                        )}
                                    </div>
                                </div>
                                <div className="settings-row">
                                    <div className="settings-field">
                                        <label className="settings-label-wide">自动备份</label>
                                        <Input
                                            className="settings-number-input"
                                            type="number"
                                            size="sm"
                                            min={0}
                                            max={86400}
                                            step={30}
                                            value={settings.auto_backup_secs}
                                            onValueChange={(value) => handleNumberSettingChange(
                                                'auto_backup_secs',
                                                value,
                                                300,
                                                0,
                                                86400,
                                            )}
                                        />
                                        <span className="settings-span">秒</span>
                                        <span className="settings-field-hint">0 表示关闭</span>
                                    </div>
                                    <div className="settings-field">
                                        <label className="settings-label-wide">最大备份数量</label>
                                        <Input
                                            className="settings-number-input"
                                            type="number"
                                            size="sm"
                                            min={1}
                                            max={999}
                                            step={1}
                                            value={settings.max_backup_count}
                                            onValueChange={(value) => handleNumberSettingChange(
                                                'max_backup_count',
                                                value,
                                                20,
                                                1,
                                                999,
                                            )}
                                        />
                                        <span className="settings-field-hint">按时间戳保留最近的备份组</span>
                                    </div>
                                </div>
                            </section>

                            <div className="settings-footer">
                                <Button type="button" variant="outline" onClick={handleReset}>重置为默认</Button>
                            </div>
                        </div>
                    )}
                    {activeTab === 'appearance' && (
                        <div className="settings-container fc-page-shell fc-page-shell--narrow">
                            <div className="settings-title fc-page-header">
                                <div className="fc-page-title-block">
                                    <h1 className="fc-page-title">外观</h1>
                                </div>
                            </div>

                            {/* 外观 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">外观</h2>
                                <div className="settings-field">
                                    <label className="settings-label">语言</label>
                                    <Select
                                        options={languageOptions}
                                        value={settings.language}
                                        onValueChange={(value) => setSettings(prev => prev ? {
                                            ...prev,
                                            language: String(value)
                                        } : null)}
                                        style={{flex: 1}}
                                    />
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label">字体大小</label>
                                    <Slider
                                        min={10}
                                        max={24}
                                        step={1}
                                        value={settings.editor_font_size}
                                        onValueChange={(value) => setSettings(prev => prev ? {
                                            ...prev,
                                            editor_font_size: value as number
                                        } : null)}
                                        style={{flex: 1}}
                                    />
                                    <span className="settings-span">{settings.editor_font_size}px</span>
                                    {settings.editor_font_size !== 14 && (
                                        <Button type="button" size="sm" variant="outline" style={{marginLeft: 8}} onClick={() =>
                                            setSettings(prev => prev ? {...prev, editor_font_size: 14} : null)
                                        }>恢复默认</Button>
                                    )}
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label">显示模式</label>
                                    <div className="settings-theme-buttons" role="group" aria-label="显示模式">
                                        {themeOptions.map(option => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                className={`settings-theme-button${settings.theme === option.value ? ' active' : ''}`}
                                                aria-pressed={settings.theme === option.value}
                                                onClick={() => handleThemeChange(option.value)}
                                            >
                                                <span className="settings-theme-button__preview">
                                                    <ThemeModePreview mode={String(option.value)}/>
                                                </span>
                                                <span className="settings-theme-button__label">{option.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="settings-field">
                                    <label className="settings-label">毛玻璃效果</label>
                                    <label className="settings-checkbox-field">
                                        <input
                                            type="checkbox"
                                            aria-label="毛玻璃效果"
                                            checked={settings.shell_acrylic_enabled}
                                            onChange={(event) => {
                                                const checked = event.currentTarget.checked
                                                setSettings(prev => prev ? {
                                                    ...prev,
                                                    shell_acrylic_enabled: checked
                                                } : null)
                                            }}
                                        />
                                    </label>
                                </div>
                                <ThemeColorPreview
                                    value={settings.theme_color_config}
                                    onChange={handleThemeColorConfigChange}
                                />
                            </section>
                        </div>
                    )}
                    {activeTab === 'feedback' && (
                        <div className="settings-container fc-page-shell fc-page-shell--narrow">
                            <div className="settings-title fc-page-header">
                                <div className="fc-page-title-block">
                                    <h1 className="fc-page-title">提交反馈</h1>
                                </div>
                            </div>

                            <FeedbackSection/>
                        </div>
                    )}
                    {activeTab === 'about' && (
                        <div className="settings-container fc-page-shell fc-page-shell--narrow">
                            <div className="settings-title fc-page-header">
                                <div className="fc-page-title-block">
                                    <h1 className="fc-page-title">关于</h1>
                                </div>
                            </div>

                            <AboutSection configDir={configDir} onOpenDir={handleOpenDir}/>
                        </div>
                    )}
                    {activeTab === 'update' && (
                        <div className="settings-container fc-page-shell fc-page-shell--narrow">
                            <div className="settings-title fc-page-header">
                                <div className="fc-page-title-block">
                                    <h1 className="fc-page-title">更新</h1>
                                </div>
                            </div>

                            <UpdateSection/>
                        </div>
                    )}
                    {activeTab === 'models' && (
                        <div className="settings-container fc-page-shell fc-page-shell--narrow">
                            <div className="settings-title fc-page-header">
                                <div className="fc-page-title-block">
                                    <h1 className="fc-page-title">模型管理</h1>
                                </div>
                            </div>

                            {/* 默认模型 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">默认模型</h2>
                                <div className="settings-ai-model-grid">
                                    <div className="settings-ai-model-kind">AI 对话</div>
                                    <div className="settings-field settings-ai-model-field">
                                        <label className="settings-label">插件</label>
                                        <div className="settings-select-control">
                                            <Select
                                                options={getPluginOptions('llm')}
                                                value={settings.llm.plugin_id || ''}
                                                onValueChange={(value) => handleAiConfigChange('llm', 'plugin_id', value ? String(value) : null)}
                                            />
                                        </div>
                                    </div>
                                    <div className="settings-field settings-ai-model-field">
                                        <label className="settings-label">模型</label>
                                        <div className="settings-select-control">
                                            <Select
                                                options={getModelOptions('llm')}
                                                value={settings.llm.default_model || ''}
                                                onValueChange={(value) => handleAiConfigChange('llm', 'default_model', value ? String(value) : null)}
                                                disabled={!settings.llm.plugin_id}
                                            />
                                        </div>
                                    </div>
                                    <div className="settings-ai-model-extra"/>

                                    <div className="settings-ai-model-kind">图片</div>
                                    <div className="settings-field settings-ai-model-field">
                                        <label className="settings-label">插件</label>
                                        <div className="settings-select-control">
                                            <Select
                                                options={getPluginOptions('image')}
                                                value={settings.image.plugin_id || ''}
                                                onValueChange={(value) => handleAiConfigChange('image', 'plugin_id', value ? String(value) : null)}
                                            />
                                        </div>
                                    </div>
                                    <div className="settings-field settings-ai-model-field">
                                        <label className="settings-label">模型</label>
                                        <div className="settings-select-control">
                                            <Select
                                                options={getModelOptions('image')}
                                                value={settings.image.default_model || ''}
                                                onValueChange={(value) => handleAiConfigChange('image', 'default_model', value ? String(value) : null)}
                                                disabled={!settings.image.plugin_id}
                                            />
                                        </div>
                                    </div>
                                    <div className="settings-ai-model-extra"/>

                                    <div className="settings-ai-model-kind">AI 语音</div>
                                    <div className="settings-field settings-ai-model-field">
                                        <label className="settings-label">插件</label>
                                        <div className="settings-select-control">
                                            <Select
                                                options={getPluginOptions('tts')}
                                                value={settings.tts.plugin_id || ''}
                                                onValueChange={(value) => handleAiConfigChange('tts', 'plugin_id', value ? String(value) : null)}
                                            />
                                        </div>
                                    </div>
                                    <div className="settings-field settings-ai-model-field">
                                        <label className="settings-label">模型</label>
                                        <div className="settings-select-control">
                                            <Select
                                                options={getModelOptions('tts')}
                                                value={settings.tts.default_model || ''}
                                                onValueChange={(value) => handleAiConfigChange('tts', 'default_model', value ? String(value) : null)}
                                                disabled={!settings.tts.plugin_id}
                                            />
                                        </div>
                                    </div>
                                    <div className="settings-field settings-ai-model-field">
                                        <label className="settings-label">默认音色</label>
                                        <div className="settings-select-control">
                                            <Select
                                                options={ttsVoiceOptions}
                                                value={settings.tts.voice_id || ''}
                                                onValueChange={(value) => setSettings(prev => prev ? {
                                                    ...prev,
                                                    tts: {
                                                        ...prev.tts,
                                                        voice_id: value ? String(value) : null,
                                                    }
                                                } : null)}
                                                disabled={!selectedTtsPlugin || selectedTtsPlugin.supported_voices.length === 0}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </section>

                            {/* 文本模型配置 */}
                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">文本模型配置</h2>
                                <div className="settings-text-model-grid">
                                    <label className="settings-text-model-field">
                                        <span>温度</span>
                                        <Input
                                            type="number"
                                            size="sm"
                                            min={0}
                                            max={CONVERSATION_TEMPERATURE_MAX}
                                            step={0.1}
                                            value={settings.llm.temperature}
                                            onValueChange={(value) => updateLlmDefaults({
                                                temperature: clampNumberValue(
                                                    value,
                                                    settings.llm.temperature,
                                                    0,
                                                    CONVERSATION_TEMPERATURE_MAX,
                                                ),
                                            })}
                                        />
                                    </label>
                                    <label className="settings-text-model-field" title="回答开放度：越低越稳定严谨，越高越自由发散。">
                                        <span>回答开放度</span>
                                        <Input
                                            type="number"
                                            size="sm"
                                            min={0}
                                            max={1}
                                            step={0.05}
                                            value={settings.llm.top_p}
                                            onValueChange={(value) => updateLlmDefaults({
                                                top_p: clampNumberValue(value, settings.llm.top_p, 0, 1),
                                            })}
                                        />
                                    </label>
                                    <div className="settings-text-model-field settings-text-model-field--penalty">
                                        <label>
                                            <span>重复惩罚</span>
                                            <input
                                                type="checkbox"
                                                checked={settings.llm.frequency_penalty !== 0}
                                                onChange={(event) => updateLlmDefaults({
                                                    frequency_penalty: event.currentTarget.checked
                                                        ? (settings.llm.frequency_penalty || DEFAULT_ENABLED_FREQUENCY_PENALTY)
                                                        : 0,
                                                })}
                                            />
                                        </label>
                                        <Input
                                            type="number"
                                            size="sm"
                                            min={-2}
                                            max={2}
                                            step={0.1}
                                            disabled={settings.llm.frequency_penalty === 0}
                                            value={settings.llm.frequency_penalty}
                                            onValueChange={(value) => updateLlmDefaults({
                                                frequency_penalty: clampNumberValue(value, settings.llm.frequency_penalty, -2, 2),
                                            })}
                                        />
                                    </div>
                                    <div className="settings-text-model-field settings-text-model-field--penalty">
                                        <label>
                                            <span>存在惩罚</span>
                                            <input
                                                type="checkbox"
                                                checked={settings.llm.presence_penalty !== 0}
                                                onChange={(event) => updateLlmDefaults({
                                                    presence_penalty: event.currentTarget.checked
                                                        ? (settings.llm.presence_penalty || DEFAULT_ENABLED_PRESENCE_PENALTY)
                                                        : 0,
                                                })}
                                            />
                                        </label>
                                        <Input
                                            type="number"
                                            size="sm"
                                            min={-2}
                                            max={2}
                                            step={0.1}
                                            disabled={settings.llm.presence_penalty === 0}
                                            value={settings.llm.presence_penalty}
                                            onValueChange={(value) => updateLlmDefaults({
                                                presence_penalty: clampNumberValue(value, settings.llm.presence_penalty, -2, 2),
                                            })}
                                        />
                                    </div>
                                </div>
                            </section>

                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">对话上下文</h2>
                                <div className="settings-field settings-field-stack settings-field-stack--full">
                                    <label className="settings-checkbox-row">
                                        <input
                                            type="checkbox"
                                            checked={settings.llm.auto_compact_enabled}
                                            onChange={(event) => updateLlmDefaults({
                                                auto_compact_enabled: event.target.checked,
                                            })}
                                        />
                                        <span>自动精简对话记忆</span>
                                    </label>
                                    <span className="settings-field-hint">
                                        发送前若预计达到阈值，会先把较早对话整理成摘要并保留近期原文；可关闭此功能。
                                    </span>
                                </div>
                                {settings.llm.auto_compact_enabled && (
                                    <div className="settings-row settings-llm-compact-options">
                                        <div className="settings-field">
                                            <label className="settings-label-wide">压缩阈值</label>
                                            <div className="settings-range-control">
                                                <Slider
                                                    min={50}
                                                    max={95}
                                                    step={5}
                                                    value={Math.round(settings.llm.auto_compact_threshold_ratio * 100)}
                                                    onValueChange={handleLlmCompactThresholdChange}
                                                />
                                            </div>
                                            <span className="settings-span">
                                                {Math.round(settings.llm.auto_compact_threshold_ratio * 100)}%
                                            </span>
                                        </div>
                                        <div className="settings-field">
                                            <label className="settings-label-wide">保留近期消息</label>
                                            <Input
                                                className="settings-number-input"
                                                type="number"
                                                size="sm"
                                                min={2}
                                                max={30}
                                                step={1}
                                                value={settings.llm.auto_compact_recent_messages}
                                                onValueChange={handleLlmCompactRecentMessagesChange}
                                            />
                                            <span className="settings-span">条</span>
                                        </div>
                                        <div className="settings-field">
                                            <label className="settings-label-wide">摘要详细程度</label>
                                            <div className="settings-select-control">
                                                <Select
                                                    options={LLM_COMPACT_DETAIL_OPTIONS}
                                                    value={settings.llm.auto_compact_detail}
                                                    onValueChange={(value) => updateLlmDefaults({
                                                        auto_compact_detail: String(value) as LlmCompactDetail,
                                                    })}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </section>
                        </div>
                    )}

                    {activeTab === 'permissions' && (
                        <div className="settings-container fc-page-shell fc-page-shell--narrow">
                            <div className="settings-title fc-page-header">
                                <div className="fc-page-title-block">
                                    <h1 className="fc-page-title">权限与工具</h1>
                                </div>
                            </div>

                            <section className="settings-section fc-section-card">
                                <h2 className="settings-section-title fc-section-title">权限与工具</h2>
                                <div
                                    id="settings-ai-writer-mode"
                                    ref={writerModeFieldRef}
                                    className={`settings-field settings-field-stack settings-field-stack--full ${focusedSetting === 'writer-mode' ? 'settings-field--focus-target' : ''}`}
                                >
                                    <label className="settings-checkbox-row">
                                        <input
                                            type="checkbox"
                                            checked={settings.llm.writer_mode_enabled}
                                            onChange={(event) => updateLlmDefaults({
                                                writer_mode_enabled: event.target.checked,
                                            })}
                                        />
                                        <span>允许 AI 作家模式</span>
                                    </label>
                                    <span className="settings-field-hint">
                                        作家模式会跳过新建、改写、移动等常规操作确认；删除类操作仍会要求确认。
                                    </span>
                                </div>
                                <div className="settings-row">
                                    <div className="settings-field">
                                        <label className="settings-label-wide">搜索引擎</label>
                                        <Select
                                            options={[
                                                {value: 'bing', label: '必应 (Bing)'},
                                                {value: 'baidu', label: '百度 (Baidu)'},
                                                {value: 'duckduckgo', label: 'DuckDuckGo'},
                                            ]}
                                            value={settings.search_engine}
                                            onValueChange={(value) => setSettings(prev => prev ? {
                                                ...prev,
                                                search_engine: String(value)
                                            } : null)}
                                            style={{flex: 1}}
                                        />
                                    </div>
                                </div>
                                <div className="settings-field settings-field-stack settings-field-stack--full">
                                    <div className="settings-search-source-heading">
                                        <span className="settings-search-source-heading-title">搜索信源</span>
                                    </div>
                                    <div className="settings-search-source-list">
                                        {SEARCH_SOURCE_OPTIONS.map((source) => (
                                            <label className="settings-search-source-item" key={source.key}>
                                                <input
                                                    type="checkbox"
                                                    checked={searchSources[source.key]}
                                                    onChange={(event) => updateSearchSource(
                                                        source.key,
                                                        event.currentTarget.checked,
                                                    )}
                                                />
                                                <span className="settings-search-source-copy">
                                                    <span className="settings-search-source-title">{source.label}</span>
                                                    <span className="settings-field-hint">{source.hint}</span>
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            </section>
                        </div>
                    )}
                    {activeTab === 'plugins' && (
                        <PluginsPanel
                            localPlugins={localPlugins}
                            marketPlugins={marketPlugins}
                            loadingLocal={loadingLocal}
                            loadingMarket={loadingMarket}
                            installingLocalFile={installingLocalFile}
                            localError={localError}
                            marketError={marketError}
                            installingIds={installingIds}
                            uninstallingId={uninstallingId}
                            searchText={searchText}
                            kindFilter={kindFilter}
                            apiKeyStatus={apiKeyStatus}
                            expandedApiKeyPluginId={expandedApiKeyPluginId}
                            apiKeyDraft={apiKeyDraft}
                            savingApiKeyPluginId={savingApiKeyPluginId}
                            apiKeyInputRef={apiKeyInputRef}
                            onRefreshLocal={loadLocal}
                            onRefreshMarket={loadMarket}
                            onInstallFromFile={handleInstallFromFile}
                            onInstallDroppedFile={handleInstallDroppedFile}
                            onUninstall={handleUninstall}
                            onInstall={handleInstall}
                            onSearchTextChange={setSearchText}
                            onKindFilterChange={setKindFilter}
                            onConfigureApiKey={handleConfigureApiKey}
                            onDeleteApiKey={handleDeleteApiKey}
                            onApiKeyDraftChange={setApiKeyDraft}
                            onSaveApiKey={handleSaveApiKey}
                            onCancelApiKey={handleCancelApiKey}
                        />
                    )}
                    {activeTab === 'usage' && (
                        <div className="settings-container fc-page-shell fc-page-shell--narrow">
                            <div className="settings-title fc-page-header">
                                <div className="fc-page-title-block">
                                    <h1 className="fc-page-title">用量统计</h1>
                                </div>
                            </div>

                            {usageLoading ? (
                                <div className="settings-empty-state">加载中...</div>
                            ) : usageError ? (
                                <div className="settings-empty-state" style={{color: 'var(--fc-color-danger)'}}>
                                    加载失败：{usageError}
                                    <div style={{marginTop: 8}}>
                                        <Button type="button" size="sm" variant="outline" onClick={loadUsageStats}>重试</Button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <section className="usage-activity-panel">
                                        <div className="usage-activity-header">
                                            <h2 className="settings-section-title fc-section-title">AI 使用热力图</h2>
                                            <div className="usage-activity-total">
                                                {usageSummary
                                                    ? `${usageSummary.total_tokens.toLocaleString()} tokens`
                                                    : '暂无数据'}
                                            </div>
                                        </div>
                                        <div
                                            className="usage-heatmap"
                                            aria-label={`最近 ${USAGE_ACTIVITY_COLUMNS} 周 AI 使用热力图`}
                                            style={{'--usage-activity-columns': USAGE_ACTIVITY_COLUMNS} as CSSProperties}
                                        >
                                            <div className="usage-heatmap-track">
                                                <div className="usage-heatmap-grid">
                                                    {usageActivityDays.map((day, index) => day ? (
                                                        <span
                                                            key={day.date}
                                                            className={`usage-heatmap-cell usage-heatmap-cell--${day.intensity}`}
                                                            title={`${day.label}：${day.totalTokens.toLocaleString()} 消耗，${day.callCount.toLocaleString()} 次调用`}
                                                        />
                                                    ) : (
                                                        <span key={`empty-${index}`}
                                                              className="usage-heatmap-cell usage-heatmap-cell--empty"/>
                                                    ))}
                                                </div>
                                                <div className="usage-heatmap-months">
                                                    {usageMonthLabels.map((item) => (
                                                        <span
                                                            key={`${item.label}-${item.column}`}
                                                            style={{gridColumn: item.column}}
                                                        >
                                                            {item.label}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="usage-insight-grid">
                                        <div className="usage-insight-panel">
                                            <h2 className="settings-section-title fc-section-title">活动洞察</h2>
                                            <dl className="usage-insight-list">
                                                <div>
                                                    <dt>AI 使用次数</dt>
                                                    <dd>{usageSummary?.call_count.toLocaleString() ?? '0'}</dd>
                                                </div>
                                                <div>
                                                    <dt>活跃天数</dt>
                                                    <dd>{usageActiveDays.toLocaleString()}</dd>
                                                </div>
                                                <div>
                                                    <dt>平均每次消耗</dt>
                                                    <dd>{usageAverageTokens.toLocaleString()}</dd>
                                                </div>
                                                <div>
                                                    <dt>最常用模型</dt>
                                                    <dd>{usageTopModel?.model ?? '无'}</dd>
                                                </div>
                                            </dl>
                                        </div>

                                        <div className="usage-insight-panel">
                                            <h2 className="settings-section-title fc-section-title">最常用的模型</h2>
                                            {usageByModel.length === 0 ? (
                                                <div className="usage-model-empty">
                                                    尚未使用任何模型
                                                </div>
                                            ) : (
                                                <div className="usage-model-list">
                                                    {usageByModel.slice(0, 3).map((row) => (
                                                        <div key={`${row.provider}-${row.model}-${row.modality}`}
                                                             className="usage-model-item">
                                                            <div>
                                                                <div className="usage-model-item__name">{row.model}</div>
                                                                <div className="usage-model-item__meta">{row.provider}</div>
                                                            </div>
                                                            <div className="usage-model-item__tokens">
                                                                {row.total_tokens.toLocaleString()}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </section>

                                    <section className="settings-section fc-section-card">
                                        <h2 className="settings-section-title fc-section-title">模型明细</h2>
                                        {usageByModel.length === 0 ? (
                                            <div className="settings-empty-state">
                                                暂无记录。使用 AI 对话后将自动统计。
                                            </div>
                                        ) : (
                                            <div className="usage-table-wrapper">
                                                <table className="usage-table">
                                                    <thead>
                                                    <tr>
                                                        <th>模型</th>
                                                        <th>供应商</th>
                                                        <th>类型</th>
                                                        <th>调用次数</th>
                                                        <th>提问消耗</th>
                                                        <th>应答消耗</th>
                                                        <th>总消耗</th>
                                                    </tr>
                                                    </thead>
                                                    <tbody>
                                                    {usageByModel.map((row, i) => (
                                                        <tr key={i}>
                                                            <td className="usage-model-name">{row.model}</td>
                                                            <td>{row.provider}</td>
                                                            <td>
                                                                <span className={`usage-badge usage-badge--${row.modality}`}>
                                                                    {row.modality === 'llm' ? '对话' :
                                                                        row.modality === 'image' ? '图片' : '语音'}
                                                                </span>
                                                            </td>
                                                            <td>{row.call_count.toLocaleString()}</td>
                                                            <td>{row.prompt_tokens.toLocaleString()}</td>
                                                            <td>{row.completion_tokens.toLocaleString()}</td>
                                                            <td className="usage-total-col">
                                                                {row.total_tokens.toLocaleString()}</td>
                                                        </tr>
                                                    ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </section>
                                </>
                            )}

                            {/* 刷新按钮 */}
                            {!usageLoading && !usageError && (
                                <div className="settings-row" style={{marginTop: 8}}>
                                    <Button type="button" size="sm" variant="outline" onClick={loadUsageStats}>
                                        刷新数据
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                        {activeTab === 'templates' && (
                        <TemplatesPanel
                            editorFontSize={settings.editor_font_size}
                            defaultPrompt={settings.llm.app_sense_custom_prompt}
                            onDefaultPromptChange={(value) => updateLlmDefaults({app_sense_custom_prompt: value})}
                        />
                    )}
                    </div>
                </RollingBox>
            </div>
        </div>
    )
}
