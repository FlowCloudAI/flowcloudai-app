import {logger} from '../shared/logger'
import {Button, Select, useAlert} from 'flowcloudai-ui'
import {type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
    type Category,
    db_create_entry,
    db_get_entry,
    db_list_all_entry_types,
    db_list_categories,
    entryTypeKey,
    type EntryTypeView,
    type IdeaNote,
    type IdeaNoteStatus,
} from '../api'
import {
    deleteSelectedIdea,
    flushIdeaDraft,
    getIdeaSnapshot,
    patchIdeaDraft,
    selectIdea,
    setIdeaProjectFilter,
    setIdeaFeedback,
    setIdeaSearchText,
    setIdeaStatusFilter,
    startNewIdea,
    updateIdeaNote,
    updateSelectedIdea,
    useIdeaStore,
} from '../features/ideas/ideaStore'
import {DockPanelSearchInput, DockPanelSegmentedControl} from '../shared/ui/layout/DockPanelSidebarControls'
import {DockPanelIconButton, DockPanelMain, DockPanelSide, DockPanelTitle, DockPanelTopbar} from '../shared/ui/layout/DockPanelScaffold'
import '../shared/ui/layout/DockPanelScaffold.css'
import './Idea.css'

type IdeaViewMode = 'inbox' | 'all' | 'processed' | 'archived'

interface UseIdeaPanelOptions {
    contextProjectId?: string | null
    onOpenEntry?: (projectId: string, entry: { id: string; title: string }) => void
    onToggleCollapsed?: () => void
}

export interface IdeaPanelSlots {
    main: ReactNode
}

const PREVIEW_LENGTH = 28

const IDEA_VIEW_OPTIONS: Array<{ key: IdeaViewMode; label: string; status?: IdeaNoteStatus }> = [
    {key: 'all', label: '全部'},
    {key: 'inbox', label: '待整理', status: 'inbox'},
    {key: 'processed', label: '已处理', status: 'processed'},
    {key: 'archived', label: '已归档', status: 'archived'},
]

const IDEA_STATUS_OPTIONS: Array<{ key: IdeaNoteStatus; label: string }> = [
    {key: 'inbox', label: '待整理'},
    {key: 'processed', label: '已处理'},
    {key: 'archived', label: '已归档'},
]

function buildIdeaPreview(note: Pick<IdeaNote, 'title' | 'content'>) {
    const source = note.title?.trim() || note.content.trim()
    if (!source) return '未命名便签'
    return source.length > PREVIEW_LENGTH ? `${source.slice(0, PREVIEW_LENGTH)}…` : source
}

function getIdeaStatusLabel(status: IdeaNoteStatus) {
    if (status === 'processed') return '已处理'
    if (status === 'archived') return '已归档'
    return '待整理'
}

function formatIdeaTime(value?: string | null) {
    if (!value) return ''

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value

    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date)
}

function buildEntryTitleFromIdea(title: string, content: string) {
    const trimmedTitle = title.trim()
    if (trimmedTitle) return trimmedTitle.slice(0, 160)

    const firstLine = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)

    return firstLine ? firstLine.slice(0, 160) : ''
}

export function useIdeaPanel({
                                 contextProjectId = null,
                                 onOpenEntry,
                                 onToggleCollapsed,
                             }: UseIdeaPanelOptions = {}): IdeaPanelSlots {
    const {showAlert} = useAlert()
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const layoutRef = useRef<HTMLDivElement | null>(null)
    const layoutObserverRef = useRef<ResizeObserver | null>(null)
    const ideaStore = useIdeaStore()
    const projects = ideaStore.projects
    const selectedIdeaId = ideaStore.selectedIdeaId
    const selectedIdea = ideaStore.selectedIdea
    const draftTitle = ideaStore.draft.title
    const draftContent = ideaStore.draft.content
    const draftProjectId = ideaStore.draft.projectId
    const initialized = ideaStore.hasLoaded
    const loading = ideaStore.loading
    const saveState = ideaStore.saveState
    const statusMessage = ideaStore.statusMessage
    const viewMode = ideaStore.statusFilter as IdeaViewMode
    const projectFilter = ideaStore.projectFilter
    const ideaSearch = ideaStore.searchText
    const visibleIdeaNotes = ideaStore.visibleIdeas
    const setViewMode = (mode: IdeaViewMode) => setIdeaStatusFilter(mode)
    const setProjectFilter = (filter: string) => setIdeaProjectFilter(filter)
    const setIdeaSearch = setIdeaSearchText
    const setDraftTitle = (title: string) => patchIdeaDraft({title})
    const setDraftContent = (content: string) => patchIdeaDraft({content})
    const [categories, setCategories] = useState<Category[]>([])
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [convertCategoryId, setConvertCategoryId] = useState<string | null>(null)
    const [convertEntryType, setConvertEntryType] = useState<string | null>(null)
    const [openAfterConvert, setOpenAfterConvert] = useState(true)
    const [converting, setConverting] = useState(false)
    const [compactLayout, setCompactLayout] = useState(false)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true)

    const selectedIdeaProjectId = selectedIdea?.project_id ?? null
    const hasIdeaSearch = ideaSearch.trim().length > 0

    const projectFilterOptions = useMemo(() => ([
        {value: 'all', label: '全部项目'},
        {value: 'global', label: '未归属'},
        ...projects.map((project) => ({value: project.id, label: project.name})),
    ]), [projects])

    const ideaProjectOptions = useMemo(() => ([
        {value: 'global', label: '未归属'},
        ...projects.map((project) => ({value: project.id, label: project.name})),
    ]), [projects])

    const categoryOptions = useMemo(() => ([
        {value: '', label: '请选择分类'},
        ...categories.map((category) => ({value: category.id, label: category.name})),
    ]), [categories])

    const entryTypeOptions = useMemo(() => ([
        {value: '', label: '不设置'},
        ...entryTypes.map((entryType) => ({
            value: entryTypeKey(entryType),
            label: entryType.name,
        })),
    ]), [entryTypes])

    useEffect(() => {
        if (selectedIdea) return
        if (draftProjectId === (contextProjectId ?? null)) return
        patchIdeaDraft({projectId: contextProjectId ?? null})
    }, [contextProjectId, draftProjectId, selectedIdea])

    useEffect(() => {
        if (!initialized) return

        const timer = window.setTimeout(() => {
            textareaRef.current?.focus()
        }, 0)

        return () => window.clearTimeout(timer)
    }, [initialized, selectedIdeaId])

    useEffect(() => {
        setOpenAfterConvert(true)

        if (!selectedIdeaId || !selectedIdeaProjectId) {
            setCategories([])
            setEntryTypes([])
            setConvertCategoryId(null)
            setConvertEntryType(null)
            return
        }

        let cancelled = false

        void (async () => {
            try {
                const [nextCategories, nextEntryTypes] = await Promise.all([
                    db_list_categories(selectedIdeaProjectId),
                    db_list_all_entry_types(selectedIdeaProjectId),
                ])

                if (cancelled) return

                setCategories(nextCategories)
                setEntryTypes(nextEntryTypes)
                setConvertCategoryId(null)
                setConvertEntryType(null)
            } catch (error) {
                if (cancelled) return
                logger.error('加载转词条配置失败', error)
                setCategories([])
                setEntryTypes([])
                setConvertCategoryId(null)
                setConvertEntryType(null)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [selectedIdeaId, selectedIdeaProjectId])

    // 用 ref callback：div 挂载/卸载时立即启/停 ResizeObserver。
    const setLayoutRef = useCallback((el: HTMLDivElement | null) => {
        layoutRef.current = el

        if (layoutObserverRef.current) {
            layoutObserverRef.current.disconnect()
            layoutObserverRef.current = null
        }

        if (!el || typeof ResizeObserver === 'undefined') return

        const updateFromWidth = (width: number) => {
            const isCompact = width <= 960
            setCompactLayout(isCompact)
        }

        // 同步首测，避免先展开再收起的闪烁
        const rect = el.getBoundingClientRect()
        updateFromWidth(rect.width)

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0]
            if (!entry) return
            updateFromWidth(entry.contentRect.width)
        })
        observer.observe(el)
        layoutObserverRef.current = observer
    }, [])

    // 组件 unmount 时清理 observer
    useEffect(() => () => {
        layoutObserverRef.current?.disconnect()
        layoutObserverRef.current = null
    }, [])

    const handleSelectIdea = useCallback((ideaId: string) => {
        void selectIdea(ideaId, contextProjectId)
        if (compactLayout) {
            setSidebarCollapsed(true)
        }
    }, [compactLayout, contextProjectId])

    const handleCreateBlankIdea = useCallback(() => {
        void startNewIdea(contextProjectId)
        if (compactLayout) {
            setSidebarCollapsed(true)
        }
    }, [compactLayout, contextProjectId])

    const handleChangeIdeaStatus = useCallback(async (status: IdeaNoteStatus) => {
        if (!selectedIdea) return

        try {
            await updateSelectedIdea({status})
        } catch (error) {
            logger.error('更新便签状态失败', error)
        }
    }, [selectedIdea])

    const handleTogglePinned = useCallback(async () => {
        if (!selectedIdea) return

        try {
            await updateSelectedIdea({pinned: !selectedIdea.pinned})
        } catch (error) {
            logger.error('更新置顶状态失败', error)
        }
    }, [selectedIdea])

    const handleProjectChange = useCallback((value: string | number | (string | number)[]) => {
        const singleValue = Array.isArray(value) ? value[0] : value
        if (singleValue === undefined) return
        const nextProjectId = singleValue === 'global' ? null : String(singleValue)
        patchIdeaDraft({projectId: nextProjectId})
    }, [])

    const handleOpenConvertedEntry = useCallback(async () => {
        if (!selectedIdea?.converted_entry_id || !selectedIdea.project_id) return

        try {
            const entry = await db_get_entry(selectedIdea.converted_entry_id, selectedIdea.project_id)
            onOpenEntry?.(selectedIdea.project_id, {
                id: entry.id,
                title: entry.title,
            })
            setIdeaFeedback('saved', '已打开关联词条')
        } catch (error) {
            logger.error('打开关联词条失败', error)
            setIdeaFeedback('error', error instanceof Error ? error.message : '打开关联词条失败')
        }
    }, [onOpenEntry, selectedIdea])

    const handleConvertToEntry = useCallback(async () => {
        if (!selectedIdea) return

        if (selectedIdea.converted_entry_id) {
            await handleOpenConvertedEntry()
            return
        }

        if (!selectedIdea.project_id) {
            await showAlert('请先为这条便签选择所属项目，再转为词条。', 'warning', 'nonInvasive', 1800)
            return
        }

        if (!convertCategoryId) {
            await showAlert('请先选择目标分类，避免生成悬空词条。', 'warning', 'nonInvasive', 1800)
            return
        }

        const targetTitle = buildEntryTitleFromIdea(draftTitle, draftContent)
        if (!targetTitle) {
            await showAlert('便签标题和正文都为空，暂时无法转为词条。', 'warning', 'nonInvasive', 1800)
            return
        }

        setConverting(true)
        setIdeaFeedback('saving', '正在转为词条…')

        try {
            await flushIdeaDraft()
            const latestIdea = getIdeaSnapshot().ideas.find(item => item.id === selectedIdea.id) ?? selectedIdea

            if (!latestIdea.project_id) {
                await showAlert('请先为这条便签选择所属项目，再转为词条。', 'warning', 'nonInvasive', 1800)
                setIdeaFeedback('idle', '请先为便签设置所属项目')
                return
            }

            const createdEntry = await db_create_entry({
                projectId: latestIdea.project_id,
                categoryId: convertCategoryId,
                title: targetTitle,
                summary: null,
                content: draftContent.trim() ? draftContent : null,
                type: convertEntryType,
                tags: null,
                images: null,
            })

            await updateIdeaNote({
                id: latestIdea.id,
                status: 'processed',
                lastReviewedAt: new Date().toISOString(),
                convertedEntryId: createdEntry.id,
            })

            setIdeaFeedback('saved', `已转为词条「${createdEntry.title}」`)

            if (openAfterConvert) {
                onOpenEntry?.(latestIdea.project_id, {
                    id: createdEntry.id,
                    title: createdEntry.title,
                })
            }
        } catch (error) {
            logger.error('转为词条失败', error)
            setIdeaFeedback('error', error instanceof Error ? error.message : '转为词条失败')
        } finally {
            setConverting(false)
        }
    }, [
        convertCategoryId,
        convertEntryType,
        draftContent,
        draftTitle,
        handleOpenConvertedEntry,
        onOpenEntry,
        openAfterConvert,
        selectedIdea,
        showAlert,
    ])

    const handleDeleteCurrentIdea = useCallback(async () => {
        if (!selectedIdea) return

        const confirmed = await showAlert('删除后无法恢复，是否继续删除当前便签？', 'warning', 'confirm')
        if (confirmed !== 'yes') return

        try {
            await deleteSelectedIdea()
            setIdeaFeedback('idle', '便签已删除，输入内容后会自动创建新的便签')
        } catch (error) {
            logger.error('删除灵感便签失败', error)
            setIdeaFeedback('error', error instanceof Error ? error.message : '删除便签失败')
        }
    }, [selectedIdea, showAlert])

    // ===== JSX 拆分：sideContent / mainContent / backdrop =====

    const sideContent = (
        <DockPanelSide className="idea-page__sidebar">
            <div className="idea-page__sidebar-inner">
                <DockPanelTopbar className="idea-page__sidebar-topbar" variant="side">
                    <DockPanelTitle className="idea-page__sidebar-topbar-title">灵感导航</DockPanelTitle>
                    {compactLayout ? (
                        <DockPanelIconButton
                            type="button"
                            className="idea-page__sidebar-toggle"
                            onClick={() => setSidebarCollapsed(true)}
                            title="收起侧边栏"
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                                 strokeWidth="1.5">
                                <path d="M10 3L5 8L10 13"/>
                            </svg>
                        </DockPanelIconButton>
                    ) : null}
                </DockPanelTopbar>
                <div className="idea-page__toolbar dock-panel-sidebar-controls">
                    <div className="dock-panel-control-group">
                        <span className="dock-panel-control-label">视图</span>
                        <DockPanelSegmentedControl
                            options={IDEA_VIEW_OPTIONS}
                            value={viewMode}
                            onChange={setViewMode}
                            ariaLabel="灵感便签视图"
                        />
                    </div>
                    <div className="dock-panel-control-group idea-page__toolbar-group--project">
                        <span className="dock-panel-control-label">项目</span>
                        <Select
                            className="idea-page__project-select"
                            value={projectFilter}
                            options={projectFilterOptions}
                            onValueChange={(value) => setProjectFilter(String(value))}
                        />
                    </div>
                    <DockPanelSearchInput
                        value={ideaSearch}
                        onChange={setIdeaSearch}
                        placeholder="搜索便签"
                        ariaLabel="搜索灵感便签"
                    />
                </div>

                <div className="idea-page__sidebar-header">
                    <div className="idea-page__sidebar-list-meta">
                        <span className="idea-page__sidebar-list-title">便签列表</span>
                        <span className="idea-page__sidebar-count">{visibleIdeaNotes.length}</span>
                    </div>
                    <Button type="button" variant="ghost" onClick={handleCreateBlankIdea}>新建便签</Button>
                </div>

                <div className="idea-page__list">
                    {loading ? (
                        <div className="idea-page__empty">正在加载便签…</div>
                    ) : visibleIdeaNotes.length === 0 ? (
                        <div className="idea-page__empty">
                            {hasIdeaSearch ? '没有匹配的便签。' : '当前筛选下还没有便签，右侧直接开始记录。'}
                        </div>
                    ) : (
                        visibleIdeaNotes.map((idea) => {
                            const active = idea.id === selectedIdeaId
                            return (
                                <button
                                    key={idea.id}
                                    type="button"
                                    className={`idea-page__item${active ? ' is-active' : ''}`}
                                    onClick={() => handleSelectIdea(idea.id)}
                                >
                                    <div className="idea-page__item-top">
                                        <span className="idea-page__item-title">{buildIdeaPreview(idea)}</span>
                                        {idea.pinned ? <span className="idea-page__item-pin">置顶</span> : null}
                                    </div>
                                    <div className="idea-page__item-preview">
                                        {idea.content.trim() || '空白便签'}
                                    </div>
                                    <div className="idea-page__item-meta">
                                        <span>{formatIdeaTime(idea.updated_at)}</span>
                                        <span>{getIdeaStatusLabel(idea.status)}</span>
                                    </div>
                                </button>
                            )
                        })
                    )}
                </div>
            </div>
        </DockPanelSide>
    )

    const mainContent = (
        <DockPanelMain className="idea-page__main">
            <DockPanelTopbar className="idea-page__main-topbar">
                <div className="idea-page__main-topbar-left">
                    <DockPanelIconButton
                        type="button"
                        className="idea-page__sidebar-toggle"
                        onClick={() => setSidebarCollapsed((prev) => !prev)}
                        title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                             strokeWidth="1.5">
                            {sidebarCollapsed ? (
                                <path d="M6 3L11 8L6 13"/>
                            ) : (
                                <path d="M10 3L5 8L10 13"/>
                            )}
                        </svg>
                    </DockPanelIconButton>
                    <DockPanelTitle className="idea-page__main-title">灵感便签</DockPanelTitle>
                </div>
                <div className="idea-page__main-topbar-right">
                    <DockPanelIconButton
                        type="button"
                        className="idea-page__sidebar-toggle idea-page__collapse-toggle"
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

            <section className="idea-page__editor">
                <div className="idea-page__editor-header">
                    <div className="idea-page__editor-header-top">
                        <div>
                            <h3 className="idea-page__editor-title">
                                {selectedIdea ? '编辑便签' : '快速记录'}
                            </h3>
                            <p className={`idea-page__status idea-page__status--${saveState}`}>{statusMessage}</p>
                        </div>
                        <div className="idea-page__actions">
                            <Button type="button" variant="ghost" onClick={handleCreateBlankIdea}>空白便签</Button>
                            <Button type="button" variant="ghost" disabled={!selectedIdea}
                                    onClick={() => void handleDeleteCurrentIdea()}>
                                删除
                            </Button>
                        </div>
                    </div>
                    <div className="idea-page__editor-header-bottom">
                        <div className="idea-page__editor-meta">
                            <div className="idea-page__meta-field idea-page__meta-field--plain">
                                <span className="idea-page__meta-label">所属项目</span>
                                <Select
                                    className="idea-page__meta-select"
                                    value={draftProjectId ?? 'global'}
                                    options={ideaProjectOptions}
                                    onValueChange={handleProjectChange}
                                />
                            </div>
                            {selectedIdea ? (
                                <span className="idea-page__meta-badge">
                                    当前状态：{getIdeaStatusLabel(selectedIdea.status)}
                                </span>
                            ) : null}
                            {selectedIdea?.converted_entry_id ? (
                                <span className="idea-page__meta-badge">
                                    已关联词条
                                </span>
                            ) : null}
                            {selectedIdea?.project_id && (
                                <>
                                    <div className="idea-page__meta-field">
                                        <span className="idea-page__meta-label">目标分类</span>
                                        <Select
                                            className="idea-page__meta-select"
                                            value={convertCategoryId ?? ''}
                                            options={categoryOptions}
                                            onValueChange={(value) => setConvertCategoryId(value ? String(value) : null)}
                                            disabled={converting || Boolean(selectedIdea.converted_entry_id)}
                                        />
                                    </div>
                                    <div className="idea-page__meta-field">
                                        <span className="idea-page__meta-label">词条类型</span>
                                        <Select
                                            className="idea-page__meta-select"
                                            value={convertEntryType ?? ''}
                                            options={entryTypeOptions}
                                            onValueChange={(value) => setConvertEntryType(value ? String(value) : null)}
                                            disabled={converting || Boolean(selectedIdea.converted_entry_id)}
                                        />
                                    </div>
                                </>
                            )}
                            {selectedIdea && !selectedIdea.project_id && (
                                <span className="idea-page__meta-badge">
                                    先设置所属项目后才能转为词条
                                </span>
                            )}
                        </div>
                        <div className="idea-page__actions idea-page__actions--secondary">
                            <Button type="button"
                                    variant="ghost"
                                    disabled={!selectedIdea || converting || Boolean(selectedIdea?.converted_entry_id)}
                                    onClick={() => setOpenAfterConvert((prev) => !prev)}
                            >
                                转后打开：{openAfterConvert ? '开' : '关'}
                            </Button>
                            <Button type="button"
                                    variant="ghost"
                                    disabled={!selectedIdea || converting}
                                    onClick={() => void handleConvertToEntry()}
                            >
                                {converting ? '转词条中…' : selectedIdea?.converted_entry_id ? '打开词条' : '转为词条'}
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="idea-page__editor-body">
                    <div className="idea-page__editor-tools">
                        <div className="idea-page__segmented idea-page__segmented--compact">
                            {IDEA_STATUS_OPTIONS.map((item) => (
                                <button
                                    key={item.key}
                                    type="button"
                                    className={`idea-page__segmented-item${selectedIdea?.status === item.key ? ' is-active' : ''}`}
                                    onClick={() => void handleChangeIdeaStatus(item.key)}
                                    disabled={!selectedIdea}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                        <div className="idea-page__quick-actions">
                            <Button type="button" variant="ghost" disabled={!selectedIdea}
                                    onClick={() => void handleTogglePinned()}>
                                {selectedIdea?.pinned ? '取消置顶' : '置顶'}
                            </Button>
                        </div>
                    </div>
                    <input
                        className="idea-page__title-input"
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        placeholder="可选标题，不写也可以"
                    />
                    <textarea
                        ref={textareaRef}
                        className="idea-page__content-input"
                        value={draftContent}
                        onChange={(event) => setDraftContent(event.target.value)}
                        placeholder="把刚冒出来的想法先记在这里。支持先写正文，系统会自动保存。"
                    />
                </div>
            </section>
        </DockPanelMain>
    )

    return {
        main: (
            <div
                ref={setLayoutRef}
                className={`idea-page${compactLayout ? ' is-compact' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
            >
                <div className="idea-page__shell">
                    {compactLayout && !sidebarCollapsed ? (
                        <button
                            type="button"
                            className="idea-page__sidebar-backdrop"
                            aria-label="关闭灵感侧边栏"
                            onClick={() => setSidebarCollapsed(true)}
                        />
                    ) : null}
                    {sideContent}
                    {mainContent}
                </div>
            </div>
        ),
    }
}
