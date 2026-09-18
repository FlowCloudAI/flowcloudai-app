import {logger} from '../shared/logger'
import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
    type CategoryTreeNode,
    DeleteDialog,
    type DropPosition,
    flatToTree,
    Tree,
    type TreeViewportRowsPayload,
    useAlert
} from 'flowcloudai-ui'
import {listen} from '../api/events'
import {saveFileDialog} from '../api/dialog'
import {
    ai_list_contradiction_reports,
    type Category,
    CATEGORY_CREATED,
    CATEGORY_DELETED,
    type CategoryCreatedEvent,
    type CategoryDeletedEvent,
    type CustomEntryType,
    db_count_entries,
    db_create_category,
    db_create_entry,
    db_delete_category,
    db_delete_entry,
    db_delete_project,
    db_ensure_project_cover_thumbnails,
    db_export_project_fcworld,
    db_get_entry,
    db_get_project,
    db_get_project_stats,
    db_list_all_entry_types,
    db_list_categories,
    db_list_entries,
    db_list_incoming_links,
    db_list_outgoing_links,
    db_list_tag_schemas,
    db_update_category,
    db_update_project,
    dbListSnapshots,
    ENTRY_CREATED,
    ENTRY_DELETED,
    ENTRY_UPDATED,
    type EntryBrief,
    type EntryCreatedEvent,
    type EntryDeletedEvent,
    type EntryTypeView,
    type EntryUpdatedEvent,
    map_list_project_maps,
    type Project,
    type ProjectStats,
    type TagSchema,
} from '../api'
import EntryEditor from '../features/entries/components/EntryEditor'
import {pageDocumentReadEntry, pageDocumentRebuildProjection} from '../api/pageDocument.ts'
import {convertMarkdownToPageDocument} from '../features/page-document/application/markdownDocumentConversion.ts'
import EntryTypeCreator from '../features/entries/components/EntryTypeCreator'
import WorldMapPanel from '../features/maps/components/WorldMapPanel'
import ProjectContradictionPanel from '../features/project-editor/components/ProjectContradiction/ProjectContradictionPanel'
import TagCreator from '../features/entries/components/TagCreator'
import CategoryView from '../features/project-editor/components/ProjectOverview/CategoryView'
import ProjectOverview from '../features/project-editor/components/ProjectOverview/ProjectOverview'
import type {ProjectRiskSummary} from '../features/project-editor/components/ProjectOverview/ProjectOverview.types'
import ProjectCoverPickerModal from '../features/project-editor/components/ProjectCoverPicker/ProjectCoverPickerModal'
import type {AiMissingPluginKind} from '../shared/ui/AiPluginMissingOverlay'
import {SidebarResizeHandle} from '../shared/ui/layout/SidebarResizeHandle'
import {useResizableSidebar} from '../shared/ui/layout/useResizableSidebar'
import {ProjectHomeIcon} from '../shared/ui/ProjectHomeIcon'
import ProjectTimeline from '../features/project-editor/components/ProjectTimeline'
import ProjectRelationGraph from '../features/relation-graph/components/ProjectRelationGraph'
import FcworldProgressDialog from '../features/projects/components/FcworldProgressDialog'
import {useFcworldProgress} from '../features/projects/hooks/useFcworldProgress'
import {buildProjectExportFileName} from '../features/projects/projectDisplay'
import type {ReportConversationContext} from '../features/ai-chat/model/AiControllerTypes'
import {PROJECT_EDITOR_TOUR_ID, type TourDefinition, useTour} from '../features/onboarding'
import {
    PageDocumentProjectSidebar,
    PageDocumentProjectSidebarHeader,
} from '@page-document-editor-entry'
import './ProjectEditor.css'

const TREE_MIN_WIDTH = '15rem'
const TREE_MAX_WIDTH = '22rem'
const TREE_DEFAULT_PX = 256
const TREE_COLLAPSE_THRESHOLD_RATIO = 1 / 5
const ROOT_ID = '__project_root__'
const ALL_ENTRIES_CACHE_KEY = '__all_entries__'
const CATEGORY_PREFETCH_LIMIT = 6
const DEFAULT_CATEGORY_NAME = '新建分类'
const RISK_RELATED_ENTRY_LIMIT = 24
const RISK_ENTRY_SCAN_LIMIT = 80

type RiskEntryRef = { id: string; title: string }

function isRiskEntryRef(entry: RiskEntryRef | null): entry is RiskEntryRef {
    return entry !== null
}

interface Props {
    projectId: string
    aiPluginId?: string | null
    aiModel?: string | null
    activeEntryId?: string | null
    activeEntryTitle?: string | null
    openEntryIds?: string[]
    mountedEntryIds?: string[]
    onOpenEntry?: (projectId: string, entry: { id: string; title: string }) => void
    onEntryTitleChange?: (projectId: string, entry: { id: string; title: string }) => void
    onBackHome?: () => void
    onBackToProject?: (projectId: string) => void
    onEntryDirtyChange?: (projectId: string, entryId: string, dirty: boolean) => void
    onEntrySavingChange?: (projectId: string, entryId: string, saving: boolean) => void
    onStartCharacterChat?: (projectId: string, entry: { id: string; title: string }) => void
    onStartReportDiscussion?: (params: {
        title: string
        pluginId: string
        model: string
        reportContext: ReportConversationContext
    }) => void
    onOpenPluginManagement?: (kind: AiMissingPluginKind) => void
    onOpenAiSettings?: (pluginId: string) => void
    activeToolPanel?: ProjectPanel | null
    onOpenProjectPanel?: (panel: Exclude<ProjectPanel, 'overview'>, project: { id: string; name: string }) => void
    onProjectViewLabelChange?: (projectId: string, label: string) => void
    onDeleteProject?: (projectId: string) => void
    onDeleteEntry?: (projectId: string, entryId: string) => void
}

type Selection = { kind: 'project' } | { kind: 'category'; id: string }
type ProjectPanel = 'overview' | 'relation-graph' | 'timeline' | 'contradiction' | 'world-map'
type BreadcrumbItem = {
    key: string
    label: string
    onClick: () => void
    current?: boolean
}

const PROJECT_PANEL_LABELS: Record<ProjectPanel, string> = {
    overview: '项目概览',
    'relation-graph': '关系图',
    timeline: '时间线',
    contradiction: '设定检测',
    'world-map': '世界地图',
}

function getCategoryCacheKey(categoryId: string | null): string {
    return categoryId ?? ALL_ENTRIES_CACHE_KEY
}

function areEntryBriefListsEqual(prev: EntryBrief[] | undefined, next: EntryBrief[]): boolean {
    if (prev === next) return true
    if (!prev || prev.length !== next.length) return false

    for (let i = 0; i < next.length; i += 1) {
        const prevItem = prev[i]
        const nextItem = next[i]
        if (
            prevItem.id !== nextItem.id
            || prevItem.updated_at !== nextItem.updated_at
            || prevItem.title !== nextItem.title
            || prevItem.type !== nextItem.type
            || prevItem.category_id !== nextItem.category_id
        ) {
            return false
        }
    }

    return true
}

function sortCategoriesByOrder(categories: Category[]): Category[] {
    return [...categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'zh-CN'))
}

function getCategoryNameKey(parentId: string | null, name: string): string {
    return `${parentId ?? ROOT_ID}:${name.trim()}`
}

function hasSiblingCategoryName(categories: Category[], parentId: string | null, name: string, excludeId?: string): boolean {
    const normalizedName = name.trim()
    return categories.some(category =>
        category.id !== excludeId
        && (category.parent_id ?? null) === parentId
        && category.name.trim() === normalizedName
    )
}

function nextDefaultCategoryName(categories: Category[], parentId: string | null, pendingNameKeys: Set<string>): string {
    let index = 0
    while (true) {
        const name = index === 0 ? DEFAULT_CATEGORY_NAME : `${DEFAULT_CATEGORY_NAME}(${index})`
        if (!hasSiblingCategoryName(categories, parentId, name) && !pendingNameKeys.has(getCategoryNameKey(parentId, name))) {
            return name
        }
        index += 1
    }
}

function collectCategorySubtreeIds(categories: Category[], categoryId: string): string[] {
    const ids = [categoryId]
    for (const category of categories) {
        if (category.parent_id === categoryId) ids.push(...collectCategorySubtreeIds(categories, category.id))
    }
    return ids
}

function ProjectEditorInner({
                                projectId,
                                aiPluginId = null,
                                aiModel = null,
                                activeEntryId = null,
                                activeEntryTitle = null,
                                openEntryIds = [],
                                mountedEntryIds = [],
                                onOpenEntry,
                                onEntryTitleChange,
                                onBackHome,
                                onBackToProject,
                                onEntryDirtyChange,
                                onEntrySavingChange,
                                 onStartCharacterChat,
                                 onStartReportDiscussion,
                                 onOpenPluginManagement,
                                 onOpenAiSettings,
                                 activeToolPanel = null,
                                 onOpenProjectPanel,
                                 onProjectViewLabelChange,
                                 onDeleteProject,
                                 onDeleteEntry,
                             }: Props) {
    const {
        width: treeWidth,
        collapsed: treeCollapsed,
        dragging: dividerDragging,
        layoutRef,
        expand: expandTree,
        collapse: collapseTree,
        handleMouseDown: handleDividerMouseDown,
    } = useResizableSidebar({
        widthVariable: '--pe-tree-width',
        minWidth: TREE_MIN_WIDTH,
        maxWidth: TREE_MAX_WIDTH,
        defaultWidth: TREE_DEFAULT_PX,
        collapseThresholdRatio: TREE_COLLAPSE_THRESHOLD_RATIO,
    })
    const [worldMapSidebarHost, setWorldMapSidebarHost] = useState<HTMLDivElement | null>(null)
    const [worldMapInitialMapId, setWorldMapInitialMapId] = useState<string | null>(null)
    const [relationGraphSidebarHost, setRelationGraphSidebarHost] = useState<HTMLDivElement | null>(null)
    const [contradictionSidebarHost, setContradictionSidebarHost] = useState<HTMLDivElement | null>(null)
    const [timelineSidebarHost, setTimelineSidebarHost] = useState<HTMLDivElement | null>(null)

    const [project, setProject] = useState<Project | null>(null)
    const [categories, setCategories] = useState<Category[]>([])
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [projectStats, setProjectStats] = useState<ProjectStats | null>(null)
    const entryCount = projectStats?.entryCount ?? 0
    const [mapCount, setMapCount] = useState<number | null>(null)
    const [snapshotCount, setSnapshotCount] = useState<number | null>(null)
    const [riskSummary, setRiskSummary] = useState<ProjectRiskSummary | null>(null)
    const [categoryEntryRefreshToken, setCategoryEntryRefreshToken] = useState(0)
    const [tagSchemas, setTagSchemas] = useState<TagSchema[]>([])
    const [tagCreatorOpen, setTagCreatorOpen] = useState(false)
    const [entryTypeCreatorOpen, setEntryTypeCreatorOpen] = useState(false)
    const [editingTag, setEditingTag] = useState<TagSchema | null>(null)
    const [editingEntryType, setEditingEntryType] = useState<CustomEntryType | null>(null)
    const [coverPickerOpen, setCoverPickerOpen] = useState(false)
    const [coverUpdating, setCoverUpdating] = useState(false)
    const [exporting, setExporting] = useState(false)
    const {progress: fcworldProgress, startProgress, closeProgress, finishProgress} = useFcworldProgress()
    const {registerTour} = useTour()

    const [selection, setSelection] = useState<Selection>({kind: 'project'})
    const selectedKey = selection.kind === 'project' ? ROOT_ID : selection.id
    const [expandedKeys, setExpandedKeys] = useState<string[]>([ROOT_ID])
    const [deleteTarget, setDeleteTarget] = useState<CategoryTreeNode | null>(null)
    // ponytail: 占位状态仅服务当前会话；需要崩溃恢复时再持久化草稿，而不是继续扩大内存状态。
    const [placeholderEntryIds, setPlaceholderEntryIds] = useState<Set<string>>(() => new Set())
    const [creatingEntryCategoryKeys, setCreatingEntryCategoryKeys] = useState<Set<string>>(() => new Set())
    const [prefetchedCategoryEntries, setPrefetchedCategoryEntries] = useState<Record<string, EntryBrief[]>>({})
    const placeholderSeenInOpenRef = useRef<Set<string>>(new Set())
    const creatingEntryCategoryKeysRef = useRef<Set<string>>(new Set())
    const prefetchingCategoryKeysRef = useRef<Set<string>>(new Set())
    const categoriesRef = useRef<Category[]>([])
    const pendingCategoryNameKeysRef = useRef<Set<string>>(new Set())
    const {showAlert} = useAlert()

    useEffect(() => {
        categoriesRef.current = categories
    }, [categories])

    const touchProjectUpdatedAt = useCallback(() => {
        setProject(current => current ? {...current, updated_at: new Date().toISOString()} : current)
    }, [])

    const adjustEntryCount = useCallback((delta: number) => {
        setProjectStats(current => current
            ? {...current, entryCount: Math.max(0, current.entryCount + delta)}
            : current
        )
    }, [])

    const forgetPlaceholderEntry = useCallback((entryId: string) => {
        setPlaceholderEntryIds(current => {
            if (!current.has(entryId)) return current
            const next = new Set(current)
            next.delete(entryId)
            return next
        })
        placeholderSeenInOpenRef.current.delete(entryId)
    }, [])

    const refreshProject = useCallback(async () => {
        try {
            const nextProject = await db_get_project(projectId)
            setProject(nextProject)
        } catch (e) {
            logger.error('refresh project failed', e)
        }
    }, [projectId])

    const fetchAll = useCallback(async () => {
        const [proj, cats, types, stats, tags] = await Promise.all([
            db_get_project(projectId),
            db_list_categories(projectId),
            db_list_all_entry_types(projectId),
            db_get_project_stats(projectId),
            db_list_tag_schemas(projectId),
        ])

        return {
            project: proj,
            categories: cats,
            entryTypes: types,
            projectStats: stats,
            tagSchemas: tags,
        }
    }, [projectId])

    const loadAll = useCallback(async () => {
        try {
            const data = await fetchAll()
            setProject(data.project)
            setCategories(data.categories)
            setEntryTypes(data.entryTypes)
            setProjectStats(data.projectStats)
            setTagSchemas(data.tagSchemas)
        } catch (e) {
            logger.error('ProjectEditor load failed', e)
        }
    }, [fetchAll])

    useEffect(() => {
        let cancelled = false

        void (async () => {
            try {
                const data = await fetchAll()
                if (cancelled) return
                setProject(data.project)
                setCategories(data.categories)
                setEntryTypes(data.entryTypes)
                setProjectStats(data.projectStats)
                setTagSchemas(data.tagSchemas)

                void (async () => {
                    try {
                        const summary = await db_ensure_project_cover_thumbnails(projectId)
                        if (cancelled || summary.generated === 0) return
                        const refreshed = await fetchAll()
                        if (cancelled) return
                        setProject(refreshed.project)
                        setCategories(refreshed.categories)
                        setEntryTypes(refreshed.entryTypes)
                        setProjectStats(refreshed.projectStats)
                        setTagSchemas(refreshed.tagSchemas)
                    } catch (error) {
                        if (!cancelled) logger.warn('project cover thumbnail migration failed', error)
                    }
                })()
            } catch (e) {
                if (!cancelled) {
                    logger.error('ProjectEditor load failed', e)
                }
            }
        })()

        return () => {
            cancelled = true
        }
    }, [fetchAll, projectId])

    useEffect(() => {
        // 项目页面打开一次只补缺失投影；旧页面仍可在重建失败时走纯文本搜索兜底。
        void pageDocumentRebuildProjection(projectId).then(report => {
            if (report.skippedCount > 0) logger.warn('page document projection rebuild skipped', report)
        }).catch(error => logger.warn('page document projection rebuild failed', error))
    }, [projectId])

    useEffect(() => {
        let cancelled = false

        void (async () => {
            const [mapsResult, snapshotsResult, riskResult] = await Promise.allSettled([
                map_list_project_maps(projectId),
                dbListSnapshots(projectId),
                ai_list_contradiction_reports(projectId),
            ])
            if (cancelled) return

            if (mapsResult.status === 'fulfilled') {
                setMapCount(mapsResult.value.length)
            } else {
                logger.warn('ProjectEditor map count load failed', mapsResult.reason)
                setMapCount(null)
            }

            if (snapshotsResult.status === 'fulfilled') {
                setSnapshotCount(snapshotsResult.value.length)
            } else {
                logger.warn('ProjectEditor snapshot count load failed', snapshotsResult.reason)
                setSnapshotCount(null)
            }

            if (riskResult.status === 'fulfilled') {
                const reports = riskResult.value
                let entryBriefs: EntryBrief[] = []
                try {
                    entryBriefs = await db_list_entries({
                        projectId,
                        categoryId: null,
                        entryType: null,
                        limit: RISK_ENTRY_SCAN_LIMIT,
                        offset: 0,
                    })
                } catch (error) {
                    logger.warn('ProjectEditor risk entries load failed', error)
                }
                const relatedEntryIds = Array.from(new Set(reports.flatMap(report => report.sourceEntryIds)))
                    .slice(0, RISK_RELATED_ENTRY_LIMIT)
                const reportEntries = (await Promise.all(relatedEntryIds.map(async id => {
                    try {
                        const entry = await db_get_entry(id, projectId)
                        return {id: entry.id, title: entry.title}
                    } catch {
                        return null
                    }
                }))).filter(isRiskEntryRef)
                const entryContents = (await Promise.all(entryBriefs.map(async brief => {
                    try {
                        const entry = await db_get_entry(brief.id, projectId)
                        const document = await pageDocumentReadEntry(brief.id).catch(() => null)
                        const text = document?.derivedText
                            ?? convertMarkdownToPageDocument(brief.id, entry.content ?? '').derivedText
                        return {id: brief.id, title: brief.title, content: text.trim()}
                    } catch {
                        return null
                    }
                }))).filter((entry): entry is RiskEntryRef & { content: string } => entry !== null)
                const isolatedEntries = (await Promise.all(entryBriefs.map(async brief => {
                    try {
                        const [outgoing, incoming] = await Promise.all([
                            db_list_outgoing_links(brief.id, projectId),
                            db_list_incoming_links(brief.id, projectId),
                        ])
                        return outgoing.length === 0 && incoming.length === 0 ? {id: brief.id, title: brief.title} : null
                    } catch {
                        return null
                    }
                }))).filter(isRiskEntryRef).slice(0, RISK_RELATED_ENTRY_LIMIT)
                const briefEntries = (entries: EntryBrief[]) => entries
                    .slice(0, RISK_RELATED_ENTRY_LIMIT)
                    .map(entry => ({id: entry.id, title: entry.title}))
                if (cancelled) return
                setRiskSummary({
                    reportCount: reports.length,
                    issueCount: reports.reduce((sum, report) => sum + report.issueCount, 0),
                    unresolvedCount: reports.reduce((sum, report) => sum + report.unresolvedCount, 0),
                    latestOverview: reports[0]?.overview ?? null,
                    relatedEntriesByIssue: {
                        uncategorized: briefEntries(entryBriefs.filter(entry => !entry.category_id)),
                        empty: entryContents
                            .filter(entry => entry.content.length === 0)
                            .slice(0, RISK_RELATED_ENTRY_LIMIT)
                            .map(({id, title}) => ({id, title})),
                        summary: briefEntries(entryBriefs.filter(entry => !(entry.summary ?? '').trim())),
                        isolated: isolatedEntries,
                        short: entryContents
                            .filter(entry => entry.content.length > 0 && entry.content.length < 100)
                            .slice(0, RISK_RELATED_ENTRY_LIMIT)
                            .map(({id, title}) => ({id, title})),
                        contradiction: reportEntries,
                        unresolved: reportEntries,
                    },
                })
            } else {
                logger.warn('ProjectEditor contradiction summary load failed', riskResult.reason)
                setRiskSummary(null)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [categoryEntryRefreshToken, projectId])

    // 监听 AI 工具调用产生的事件，刷新编辑页
    useEffect(() => {
        let cancelled = false
        const unlistens: (() => void)[] = []

        void Promise.all([
            listen<EntryUpdatedEvent>(ENTRY_UPDATED, () => {
                setCategoryEntryRefreshToken(t => t + 1)
            }),
            listen<EntryCreatedEvent>(ENTRY_CREATED, (e) => {
                if (e.payload.project_id === projectId) {
                    setCategoryEntryRefreshToken(t => t + 1)
                    adjustEntryCount(1)
                }
            }),
            listen<EntryDeletedEvent>(ENTRY_DELETED, () => {
                setCategoryEntryRefreshToken(t => t + 1)
                adjustEntryCount(-1)
            }),
            listen<CategoryCreatedEvent>(CATEGORY_CREATED, (e) => {
                if (e.payload.project_id === projectId) {
                    void loadAll()
                }
            }),
            listen<CategoryDeletedEvent>(CATEGORY_DELETED, () => {
                void loadAll()
            }),
        ]).then(fns => {
            if (!cancelled) unlistens.push(...fns)
        })

        return () => {
            cancelled = true
            unlistens.forEach(fn => fn())
        }
    }, [projectId, loadAll, adjustEntryCount])

    useEffect(() => {
        setExpandedKeys([ROOT_ID])
        setPrefetchedCategoryEntries({})
        prefetchingCategoryKeysRef.current.clear()
    }, [projectId])

    useEffect(() => {
        setPrefetchedCategoryEntries({})
        prefetchingCategoryKeysRef.current.clear()
    }, [categoryEntryRefreshToken])

    const handleSelect = (key: string) => {
        if (key === ROOT_ID) {
            setSelection({kind: 'project'})
        } else {
            setSelection({kind: 'category', id: key})
        }

        if (activeEntryId || activeToolPanel) {
            void onBackToProject?.(projectId)
        }
    }

    const handleOpenProjectPanel = useCallback((panel: Exclude<ProjectPanel, 'overview'>) => {
        if (project && onOpenProjectPanel) {
            onOpenProjectPanel(panel, {id: projectId, name: project.name})
        }
    }, [onOpenProjectPanel, project, projectId])

    const handleOpenBoundLocationMap = useCallback((target: {mapId: string}) => {
        setWorldMapInitialMapId(target.mapId)
        handleOpenProjectPanel('world-map')
    }, [handleOpenProjectPanel])

    const handleRename = async (key: string, newName: string) => {
        if (key === ROOT_ID) {
            const updated = await db_update_project({id: projectId, name: newName})
            setProject({...updated, updated_at: new Date().toISOString()})
        } else {
            const trimmedName = newName.trim()
            const currentCategories = categoriesRef.current
            const target = currentCategories.find(category => category.id === key)
            const parentId = target?.parent_id ?? null
            const duplicate = hasSiblingCategoryName(currentCategories, parentId, trimmedName, key)
                || pendingCategoryNameKeysRef.current.has(getCategoryNameKey(parentId, trimmedName))
            if (duplicate) {
                await showAlert(`同级分类中已存在「${trimmedName}」。`, 'warning', 'nonInvasive', 2400)
                return
            }

            await db_update_category({id: key, projectId, name: trimmedName})
            setCategories(prev => {
                const next = prev.map(c => c.id === key ? {...c, name: trimmedName} : c)
                categoriesRef.current = next
                return next
            })
            await refreshProject()
            touchProjectUpdatedAt()
        }
    }

    const handleUpdateProjectCover = useCallback(async (coverPath: string | null) => {
        setCoverUpdating(true)
        try {
            const updated = await db_update_project({id: projectId, coverPath})
            setProject((current) => {
                if (!current) return current
                return {
                    ...current,
                    ...updated,
                    cover_path: coverPath,
                    updated_at: new Date().toISOString(),
                }
            })
            touchProjectUpdatedAt()
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            await showAlert(message, 'error', 'nonInvasive', 3000)
            throw error
        } finally {
            setCoverUpdating(false)
        }
    }, [projectId, showAlert, touchProjectUpdatedAt])

    const handleExportProject = useCallback(async () => {
        if (!project || exporting) return

        const selectedPath = await saveFileDialog({
            defaultPath: buildProjectExportFileName(project.name),
            filters: [{
                name: '流云AI World',
                extensions: ['fcworld'],
            }],
        })
        if (!selectedPath) return

        setExporting(true)
        try {
            const operationId = startProgress('export', '导出世界')
            await db_export_project_fcworld(projectId, selectedPath, operationId)
            finishProgress()
        } catch (error) {
            closeProgress()
            await showAlert(`导出世界失败：${String(error)}`, 'error', 'nonInvasive', 3200)
        } finally {
            setExporting(false)
        }
    }, [closeProgress, exporting, finishProgress, project, projectId, showAlert, startProgress])

    const handleCreate = async (parentKey: string | null): Promise<string> => {
        const actualParentId = (!parentKey || parentKey === ROOT_ID) ? null : parentKey
        const currentCategories = categoriesRef.current
        const siblings = currentCategories.filter(c =>
            actualParentId ? c.parent_id === actualParentId : c.parent_id == null
        )
        const maxOrder = siblings.length > 0
            ? Math.max(...siblings.map(c => c.sort_order))
            : -1
        const name = nextDefaultCategoryName(currentCategories, actualParentId, pendingCategoryNameKeysRef.current)
        const pendingNameKey = getCategoryNameKey(actualParentId, name)
        pendingCategoryNameKeysRef.current.add(pendingNameKey)
        try {
            const newCat = await db_create_category({
                projectId,
                parentId: actualParentId,
                name,
                sortOrder: maxOrder + 1,
            })
            setCategories(prev => {
                const next = [...prev, newCat]
                categoriesRef.current = next
                return next
            })
            await refreshProject()
            touchProjectUpdatedAt()
            return newCat.id
        } finally {
            pendingCategoryNameKeysRef.current.delete(pendingNameKey)
        }
    }

    const handleDelete = async (key: string, mode: 'lift' | 'cascade') => {
        if (key === ROOT_ID) return
        const currentCategories = categoriesRef.current

        if (mode === 'cascade') {
            const toDeleteIds = collectCategorySubtreeIds(currentCategories, key)
            const toDelete = new Set(toDeleteIds)
            setCategories(prev => prev.filter(c => !toDelete.has(c.id)))
            if (toDelete.has(key) && (selection.kind === 'category') && toDelete.has(selection.id)) {
                setSelection({kind: 'project'})
            }
            for (const id of [...toDeleteIds].reverse()) {
                await db_delete_category(id, projectId)
            }
            await refreshProject()
            touchProjectUpdatedAt()
        } else {
            const target = currentCategories.find(c => c.id === key)
            if (!target) return
            const children = currentCategories.filter(c => c.parent_id === key)
            setCategories(prev =>
                prev
                    .map(c => c.parent_id === key ? {...c, parent_id: target.parent_id ?? null} : c)
                    .filter(c => c.id !== key)
            )
            if (selection.kind === 'category' && selection.id === key) {
                setSelection({kind: 'project'})
            }
            await Promise.all(
                children.map(child =>
                    db_update_category({id: child.id, projectId, parentId: target.parent_id ?? null})
                )
            )
            await db_delete_category(key, projectId)
            await refreshProject()
            touchProjectUpdatedAt()
        }
    }

    const handleDeleteRequest = async (node: CategoryTreeNode) => {
        try {
            const subtreeIds = collectCategorySubtreeIds(categoriesRef.current, node.key)
            const entryCounts = await Promise.all(subtreeIds.map(categoryId =>
                db_count_entries({projectId, categoryId, entryType: null})
            ))
            if (entryCounts.every(count => count === 0)) {
                await handleDelete(node.key, 'cascade')
                return
            }
            setDeleteTarget(node)
        } catch (error) {
            await showAlert(`删除分类失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        }
    }

    const handleRequestCreateEntry = useCallback(async (categoryId: string | null) => {
        const categoryKey = getCategoryCacheKey(categoryId)
        if (creatingEntryCategoryKeysRef.current.has(categoryKey)) return

        creatingEntryCategoryKeysRef.current.add(categoryKey)
        setCreatingEntryCategoryKeys(current => new Set(current).add(categoryKey))
        try {
            const created = await db_create_entry({
                projectId,
                categoryId,
                title: '未命名词条',
                summary: null,
                content: null,
                type: null,
                tags: null,
                images: null,
            })
            setPlaceholderEntryIds(prev => {
                const next = new Set(prev)
                next.add(created.id)
                return next
            })
            adjustEntryCount(1)
            touchProjectUpdatedAt()
            onOpenEntry?.(projectId, {id: created.id, title: created.title})
        } catch (e) {
            await showAlert(`新建词条失败：${String(e)}`, 'error', 'nonInvasive', 2200)
        } finally {
            creatingEntryCategoryKeysRef.current.delete(categoryKey)
            setCreatingEntryCategoryKeys(current => {
                if (!current.has(categoryKey)) return current
                const next = new Set(current)
                next.delete(categoryKey)
                return next
            })
        }
    }, [projectId, onOpenEntry, showAlert, touchProjectUpdatedAt, adjustEntryCount])

    const handleCategoryEntryRenamed = useCallback((entry: { id: string; title: string }) => {
        forgetPlaceholderEntry(entry.id)
        onEntryTitleChange?.(projectId, entry)
        setCategoryEntryRefreshToken(current => current + 1)
        touchProjectUpdatedAt()
    }, [forgetPlaceholderEntry, onEntryTitleChange, projectId, touchProjectUpdatedAt])

    const handleCategoryEntryDeleted = useCallback((entryId: string) => {
        forgetPlaceholderEntry(entryId)
        adjustEntryCount(-1)
        setCategoryEntryRefreshToken(current => current + 1)
        touchProjectUpdatedAt()
        onDeleteEntry?.(projectId, entryId)
    }, [adjustEntryCount, forgetPlaceholderEntry, onDeleteEntry, projectId, touchProjectUpdatedAt])

    useEffect(() => {
        if (placeholderEntryIds.size === 0) return
        const stillOpen = new Set(openEntryIds)
        // 追踪已在 openEntryIds 中出现过的占位符——只有这些占位符在后续缺失时才计为"已移除"
        // 这保护了从创建到父组件传播新的 openEntryIds 之间的短暂窗口期。
        for (const id of openEntryIds) {
            if (placeholderEntryIds.has(id)) placeholderSeenInOpenRef.current.add(id)
        }
        const removed: string[] = []
        for (const id of placeholderEntryIds) {
            if (!stillOpen.has(id) && placeholderSeenInOpenRef.current.has(id)) {
                removed.push(id)
            }
        }
        if (removed.length === 0) return
        removed.forEach(id => placeholderSeenInOpenRef.current.delete(id))

        setPlaceholderEntryIds(prev => {
            const next = new Set(prev)
            removed.forEach(id => next.delete(id))
            return next
        })

        // 只有从未成功保存、且用户明确关闭了标签页的新词条才会进入这里。
        // 不再根据字段内容猜测，避免仅保存类型、标签或关系时误删有效词条。
        for (const id of removed) {
            void (async () => {
                try {
                    await db_delete_entry(id, projectId)
                    adjustEntryCount(-1)
                    setCategoryEntryRefreshToken(current => current + 1)
                } catch (error) {
                    await showAlert(`清理未保存的新词条失败：${String(error)}`, 'error', 'nonInvasive', 3000)
                }
            })()
        }
    }, [openEntryIds, placeholderEntryIds, adjustEntryCount, projectId, showAlert])

    const handleMove = async (key: string, targetKey: string, position: DropPosition) => {
        if (key === ROOT_ID) return
        const target = categories.find(c => c.id === targetKey)
        const dragged = categories.find(c => c.id === key)
        if (!dragged) return

        let newParentId: string | null
        let orderMap: Map<string, number>

        if (position === 'into') {
            newParentId = targetKey === ROOT_ID ? null : targetKey
            const siblings = categories.filter(c => c.parent_id === newParentId && c.id !== key)
            const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(c => c.sort_order)) : -1
            orderMap = new Map([[key, maxOrder + 1]])
        } else {
            if (!target) return
            newParentId = target.parent_id ?? null
            const siblings = categories
                .filter(c => c.parent_id === newParentId && c.id !== key)
                .sort((a, b) => a.sort_order - b.sort_order)
            const targetIndex = siblings.findIndex(c => c.id === targetKey)
            const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
            const reordered = [...siblings]
            reordered.splice(insertIndex, 0, dragged)
            orderMap = new Map<string, number>()
            reordered.forEach((c, i) => orderMap.set(c.id, i))
        }

        setCategories(prev => prev.map(c => {
            if (c.id === key) return {...c, parent_id: newParentId, sort_order: orderMap.get(key)!}
            if (orderMap.has(c.id)) return {...c, sort_order: orderMap.get(c.id)!}
            return c
        }))

        try {
            const parentChanged = dragged.parent_id !== newParentId
            const promises: Promise<unknown>[] = []

            if (parentChanged) {
                promises.push(
                    db_update_category({
                        id: key,
                        projectId,
                        parentId: newParentId,
                        sortOrder: orderMap.get(key),
                    })
                )
            }
            for (const [id, order] of orderMap) {
                if (id === key && parentChanged) continue
                const original = categories.find(c => c.id === id)
                if (original && original.sort_order !== order) {
                    promises.push(db_update_category({id, projectId, sortOrder: order}))
                }
            }
            await Promise.all(promises)
            await refreshProject()
            touchProjectUpdatedAt()
        } catch (e) {
            logger.error('move category failed', e)
            void loadAll()
        }
    }

    const {roots} = useMemo(() => {
        const flatRows = [
            {id: ROOT_ID, parent_id: null as string | null, name: project?.name ?? '…', sort_order: 0},
            ...categories.map(c => ({
                id: c.id,
                parent_id: c.parent_id ?? ROOT_ID,
                name: c.name,
                sort_order: c.sort_order,
            })),
        ]
        return flatToTree(flatRows)
    }, [project?.name, categories])

    const rootChildCategories = useMemo(
        () => sortCategoriesByOrder(categories.filter((category) => category.parent_id == null)),
        [categories],
    )

    const selectedChildCategories = useMemo(
        () => selection.kind === 'category'
            ? sortCategoriesByOrder(categories.filter((category) => category.parent_id === selection.id))
            : [],
        [categories, selection],
    )

    const storePrefetchedEntries = useCallback((categoryId: string | null, entries: EntryBrief[]) => {
        const cacheKey = getCategoryCacheKey(categoryId)
        setPrefetchedCategoryEntries((current) => {
            const previous = current[cacheKey]
            if (areEntryBriefListsEqual(previous, entries)) return current
            return {
                ...current,
                [cacheKey]: entries,
            }
        })
    }, [])

    const prefetchCategoryEntries = useCallback(async (categoryId: string | null) => {
        const cacheKey = getCategoryCacheKey(categoryId)
        if (prefetchedCategoryEntries[cacheKey] !== undefined) return
        if (prefetchingCategoryKeysRef.current.has(cacheKey)) return

        prefetchingCategoryKeysRef.current.add(cacheKey)
        try {
            const entries = await db_list_entries({
                projectId,
                categoryId,
                entryType: null,
                limit: 200,
                offset: 0,
            })
            storePrefetchedEntries(categoryId, entries)
        } catch (error) {
            logger.error('prefetch category entries failed', {
                projectId,
                categoryId,
                error,
            })
        } finally {
            prefetchingCategoryKeysRef.current.delete(cacheKey)
        }
    }, [prefetchedCategoryEntries, projectId, storePrefetchedEntries])

    const handleViewportRowsChange = useCallback((payload: TreeViewportRowsPayload) => {
        const categoryIds = payload.rows
            .map((row) => row.key === ROOT_ID ? null : row.key)
            .slice(0, CATEGORY_PREFETCH_LIMIT)

        categoryIds.forEach((categoryId) => {
            void prefetchCategoryEntries(categoryId)
        })
    }, [prefetchCategoryEntries])

    const hasActiveEntry = Boolean(activeEntryId)
    const hasActiveTool = Boolean(activeToolPanel)
    const isWorldMapPanelActive = activeToolPanel === 'world-map'
    const isRelationGraphPanelActive = activeToolPanel === 'relation-graph'
    const isContradictionPanelActive = activeToolPanel === 'contradiction'
    const isTimelinePanelActive = activeToolPanel === 'timeline'
    const hasToolSidebar = isWorldMapPanelActive || isRelationGraphPanelActive || isContradictionPanelActive || isTimelinePanelActive
    const handleBreadcrumbProjectClick = useCallback(() => {
        setSelection({kind: 'project'})
        if (activeEntryId || activeToolPanel) {
            void onBackToProject?.(projectId)
        }
    }, [activeEntryId, activeToolPanel, onBackToProject, projectId])

    const handleTreeHeaderBackClick = useCallback(() => {
        if (hasToolSidebar) {
            handleBreadcrumbProjectClick()
            return
        }

        onBackHome?.()
    }, [handleBreadcrumbProjectClick, hasToolSidebar, onBackHome])

    const handleBreadcrumbCategoryClick = useCallback((categoryId: string) => {
        setSelection({kind: 'category', id: categoryId})
        if (activeEntryId || activeToolPanel) {
            void onBackToProject?.(projectId)
        }
    }, [activeEntryId, activeToolPanel, onBackToProject, projectId])

    const handleBreadcrumbEntryClick = useCallback(() => {
        if (!activeEntryId) return
        onOpenEntry?.(projectId, {
            id: activeEntryId,
            title: activeEntryTitle || '词条',
        })
    }, [activeEntryId, activeEntryTitle, onOpenEntry, projectId])

    const handleBreadcrumbToolClick = useCallback(() => {
        if (!activeToolPanel || activeToolPanel === 'overview') return
        handleOpenProjectPanel(activeToolPanel)
    }, [activeToolPanel, handleOpenProjectPanel])

    const showProjectOverviewForTour = useCallback(async () => {
        expandTree()
        setSelection(prev => prev.kind === 'project' ? prev : {kind: 'project'})
        void onBackToProject?.(projectId)
        await new Promise<void>(resolve => {
            window.requestAnimationFrame(() => resolve())
        })
    }, [expandTree, onBackToProject, projectId])

    const projectEditorTour = useMemo<TourDefinition>(() => ({
        id: PROJECT_EDITOR_TOUR_ID,
        version: 1,
        steps: [
            {
                id: 'tree',
                target: '[data-tour-id="project-editor-tree"]',
                title: '左侧是项目结构',
                content: '这里管理项目主页和分类树。选中项目主页会回到总览，选中分类会进入对应分类下的词条列表。',
                placement: 'right',
                beforeEnter: showProjectOverviewForTour,
            },
            {
                id: 'breadcrumb',
                target: '[data-tour-id="project-editor-breadcrumb"]',
                title: '这里显示当前位置',
                content: '打开词条、分类或高级工具后，可以通过面包屑确认当前所在位置，并快速回到项目主页。',
                placement: 'bottom',
                beforeEnter: showProjectOverviewForTour,
            },
            {
                id: 'hero',
                target: '[data-tour-id="project-overview-hero"]',
                title: '项目主页展示核心信息',
                content: '这里包含封面、项目名称、描述和更新时间。右上角编辑菜单用于重命名、编辑描述、导出或删除世界。',
                placement: 'bottom',
                beforeEnter: showProjectOverviewForTour,
            },
            {
                id: 'tools',
                target: '[data-tour-id="project-overview-tools"]',
                title: '高级工具',
                content: '关系图谱、时间线、世界地图和 AI 质检都从这里进入，用来检查设定结构和风险。',
                placement: 'top',
                beforeEnter: showProjectOverviewForTour,
            },
            {
                id: 'dashboard',
                target: '[data-tour-id="project-overview-dashboard"]',
                title: '项目总览',
                content: '这里汇总资料规模、分类分布、标签字段、内容厚度和待处理问题，适合阶段性复盘。',
                placement: 'top',
                beforeEnter: showProjectOverviewForTour,
            },
            {
                id: 'config',
                target: '[data-tour-id="project-overview-config"]',
                title: '词条类型与标签',
                content: '这里维护资料规则。词条类型决定资料对象，标签用于横向筛选和给 AI 提供稳定上下文。',
                placement: 'top',
                beforeEnter: showProjectOverviewForTour,
            },
            {
                id: 'entries',
                target: '[data-tour-id="project-overview-entries"]',
                title: '全部词条',
                content: '这里展示当前项目的全部词条，可搜索、筛选、排序，也可以直接新建词条继续补充世界资料。',
                placement: 'top',
                beforeEnter: showProjectOverviewForTour,
            },
        ],
    }), [showProjectOverviewForTour])

    useEffect(() => registerTour(projectEditorTour), [projectEditorTour, registerTour])

    const selectedCategoryPathItems = useMemo(() => {
        if (selection.kind !== 'category') return [] as Array<{ id: string; name: string }>

        const categoryMap = new Map(categories.map((category) => [category.id, category]))
        const items: Array<{ id: string; name: string }> = []
        const visited = new Set<string>()
        let current = categoryMap.get(selection.id) ?? null

        while (current && !visited.has(current.id)) {
            visited.add(current.id)
            items.push({id: current.id, name: current.name})
            current = current.parent_id ? (categoryMap.get(current.parent_id) ?? null) : null
        }

        items.reverse()
        return items
    }, [categories, selection])

    const selectedCategoryPathNames = useMemo(
        () => selectedCategoryPathItems.map((category) => category.name),
        [selectedCategoryPathItems],
    )

    const breadcrumbItems = useMemo(() => {
        const items: BreadcrumbItem[] = [
            {
                key: 'project-list',
                label: '项目',
                onClick: handleBreadcrumbProjectClick,
            },
            {
                key: `project-${projectId}`,
                label: project?.name ?? '加载中',
                onClick: handleBreadcrumbProjectClick,
            },
        ]
        if (selection.kind === 'category') {
            for (const category of selectedCategoryPathItems) {
                items.push({
                    key: `category-${category.id}`,
                    label: category.name,
                    onClick: () => handleBreadcrumbCategoryClick(category.id),
                })
            }
        }
        if (activeEntryId) {
            items.push({
                key: `entry-${activeEntryId}`,
                label: activeEntryTitle || '词条',
                onClick: handleBreadcrumbEntryClick,
                current: true,
            })
            return items
        }
        if (activeToolPanel) {
            items.push({
                key: `tool-${activeToolPanel}`,
                label: PROJECT_PANEL_LABELS[activeToolPanel],
                onClick: handleBreadcrumbToolClick,
                current: true,
            })
            return items
        }
        return items
    }, [
        activeEntryId,
        activeEntryTitle,
        activeToolPanel,
        handleBreadcrumbCategoryClick,
        handleBreadcrumbEntryClick,
        handleBreadcrumbProjectClick,
        handleBreadcrumbToolClick,
        project?.name,
        projectId,
        selectedCategoryPathItems,
        selection.kind,
    ])

    const projectViewLabel = useMemo(() => {
        const projectName = project?.name ?? '加载中'
        if (selection.kind !== 'category') return projectName
        if (selectedCategoryPathNames.length === 0) return `${projectName} · 分类`
        return `${projectName} · ${selectedCategoryPathNames.join(' / ')}`
    }, [project?.name, selectedCategoryPathNames, selection.kind])

    useEffect(() => {
        onProjectViewLabelChange?.(projectId, projectViewLabel)
    }, [onProjectViewLabelChange, projectId, projectViewLabel])

    if (!project) {
        return <div className="pe-loading">加载中…</div>
    }

    return (
        <div
            className={`pe-layout ${treeCollapsed ? 'is-tree-collapsed' : ''} ${dividerDragging ? 'is-divider-dragging' : ''}`}
            ref={layoutRef}
            style={{
                '--pe-tree-width': `${treeCollapsed ? 0 : treeWidth}px`,
                '--pe-tree-content-min-width': TREE_MIN_WIDTH,
            } as React.CSSProperties}
        >
            <FcworldProgressDialog progress={fcworldProgress} />
            <div className="pe-tree-panel" data-tour-id="project-editor-tree">
                <div className="pe-tree-panel__header">
                    <PageDocumentProjectSidebarHeader
                        projectId={projectId}
                        defaultLabel={hasToolSidebar ? '返回' : '返回主页'}
                        onDefaultBack={handleTreeHeaderBackClick}
                        onReturnCategory={handleBreadcrumbCategoryClick}
                        onReturnProject={handleBreadcrumbProjectClick}
                    />
                    <button
                        type="button"
                        className="pe-tree-toggle"
                        onClick={treeCollapsed ? expandTree : collapseTree}
                    >
                        {treeCollapsed ? '展开' : '收起'}
                    </button>
                </div>

                <div className="pe-tree-panel__body">
                    {isWorldMapPanelActive ? (
                        <div className="pe-tool-sidebar-host" ref={setWorldMapSidebarHost}/>
                    ) : isRelationGraphPanelActive ? (
                        <div className="pe-tool-sidebar-host" ref={setRelationGraphSidebarHost}/>
                    ) : isContradictionPanelActive ? (
                        <div className="pe-tool-sidebar-host" ref={setContradictionSidebarHost}/>
                    ) : isTimelinePanelActive ? (
                        <div className="pe-tool-sidebar-host" ref={setTimelineSidebarHost}/>
                    ) : (
                        <PageDocumentProjectSidebar projectId={projectId}>
                            <button
                                type="button"
                                className={`pe-tree-home-btn${selectedKey === ROOT_ID ? ' is-active' : ''}`}
                                aria-pressed={selectedKey === ROOT_ID}
                                onClick={handleBreadcrumbProjectClick}
                            >
                                <ProjectHomeIcon/>
                                <span>项目主页</span>
                            </button>
                            <div className="pe-tree-panel__tree">
                                <Tree
                                    treeData={roots}
                                    selectedKey={selectedKey}
                                    expandedKeys={expandedKeys}
                                    onExpandedKeysChange={setExpandedKeys}
                                    onViewportRowsChange={handleViewportRowsChange}
                                    onSelectedKeyChange={handleSelect}
                                    onRename={handleRename}
                                    onCreate={handleCreate}
                                    onDeleteRequest={(node) => {
                                        void handleDeleteRequest(node)
                                    }}
                                    onMove={handleMove}
                                    searchable
                                    hideRoot
                                    indentationLine
                                    collapseDuration={0.13}
                                    indentSize={12}
                                />
                            </div>
                        </PageDocumentProjectSidebar>
                    )}
                </div>
            </div>

            <SidebarResizeHandle
                dragging={dividerDragging}
                onMouseDown={handleDividerMouseDown}
            />

            <div className="pe-content">
                <div className="pe-content__rail">
                    <nav className="pe-breadcrumb" aria-label="当前位置" data-tour-id="project-editor-breadcrumb">
                        {breadcrumbItems.map((item, index) => (
                            <React.Fragment key={item.key}>
                                {index > 0 && <span className="pe-breadcrumb__sep">/</span>}
                                <button
                                    type="button"
                                    className={`pe-breadcrumb__item${item.current ? ' is-current' : ''}`}
                                    title={item.label}
                                    onClick={item.onClick}
                                >
                                    {item.label}
                                </button>
                            </React.Fragment>
                        ))}
                    </nav>
                    <div className={`pe-project-view${hasActiveEntry || hasActiveTool ? '' : ' active'}`}>
                        {selection.kind === 'project' ? (
                            <ProjectOverview
                                project={project}
                                categories={categories}
                                entryTypes={entryTypes}
                                tagSchemas={tagSchemas}
                                entryCount={entryCount}
                                imageCount={projectStats?.imageCount ?? null}
                                wordCount={projectStats?.wordCount ?? null}
                                projectStats={projectStats}
                                mapCount={mapCount}
                                snapshotCount={snapshotCount}
                                riskSummary={riskSummary}
                                onCreateTag={() => {
                                    setEditingTag(null)
                                    setTagCreatorOpen(true)
                                }}
                                onCreateEntryType={() => {
                                    setEditingEntryType(null)
                                    setEntryTypeCreatorOpen(true)
                                }}
                                onEditTag={(tag) => {
                                    setEditingTag(tag)
                                    setTagCreatorOpen(true)
                                }}
                                onEditEntryType={(entryType) => {
                                    setEditingEntryType(entryType)
                                    setEntryTypeCreatorOpen(true)
                                }}
                                onOpenRelationGraph={() => handleOpenProjectPanel('relation-graph')}
                                onOpenTimeline={() => handleOpenProjectPanel('timeline')}
                                onOpenWorldMap={() => handleOpenProjectPanel('world-map')}
                                onOpenContradiction={() => handleOpenProjectPanel('contradiction')}
                                onOpenEntry={(entry) => onOpenEntry?.(projectId, entry)}
                                onRename={(name) => handleRename(ROOT_ID, name)}
                                onEditCover={() => setCoverPickerOpen(true)}
                                onClearCover={() => {
                                    void (async () => {
                                        const confirmed = await showAlert(
                                            '确定要清除项目封面吗？此操作不会删除已上传的图片文件。',
                                            'warning',
                                            'confirm',
                                        )
                                        if (confirmed !== 'yes') return
                                        await handleUpdateProjectCover(null).catch(() => undefined)
                                    })()
                                }}
                                coverUpdating={coverUpdating}
                                onExport={handleExportProject}
                                exporting={exporting}
                                onDescriptionChange={async (description) => {
                                    const updated = await db_update_project({id: projectId, description})
                                    setProject((current) => current ? {...current, description: updated.description} : current)
                                }}
                                onDelete={onDeleteProject ? async () => {
                                    await db_delete_project(projectId)
                                    onDeleteProject(projectId)
                                } : undefined}
                            >
                                <CategoryView
                                    key="__all__"
                                    categoryId={null}
                                    categoryName="全部词条"
                                    projectId={projectId}
                                    entryTypes={entryTypes}
                                    prefetchedEntries={prefetchedCategoryEntries[getCategoryCacheKey(null)]}
                                    childCategories={rootChildCategories}
                                    refreshToken={categoryEntryRefreshToken}
                                    noScroll
                                    creatingEntry={creatingEntryCategoryKeys.has(getCategoryCacheKey(null))}
                                    onDefaultEntriesLoaded={storePrefetchedEntries}
                                    onRequestCreateEntry={handleRequestCreateEntry}
                                    onSelectCategory={handleSelect}
                                    onEntryRenamed={handleCategoryEntryRenamed}
                                    onEntryDeleted={handleCategoryEntryDeleted}
                                    onOpenEntry={(entry) => onOpenEntry?.(projectId, entry)}
                                />
                            </ProjectOverview>
                        ) : (
                            <CategoryView
                                key={selection.id}
                                categoryId={selection.id}
                                categoryName={categories.find(c => c.id === selection.id)?.name ?? ''}
                                projectId={projectId}
                                entryTypes={entryTypes}
                                prefetchedEntries={prefetchedCategoryEntries[getCategoryCacheKey(selection.id)]}
                                childCategories={selectedChildCategories}
                                refreshToken={categoryEntryRefreshToken}
                                creatingEntry={creatingEntryCategoryKeys.has(getCategoryCacheKey(selection.id))}
                                onDefaultEntriesLoaded={storePrefetchedEntries}
                                onRequestCreateEntry={handleRequestCreateEntry}
                                onSelectCategory={handleSelect}
                                onEntryRenamed={handleCategoryEntryRenamed}
                                onEntryDeleted={handleCategoryEntryDeleted}
                                onOpenEntry={(entry) => onOpenEntry?.(projectId, entry)}
                            />
                        )}
                    </div>

                    <div className={`pe-tool-stack${hasActiveTool ? ' active' : ''}`}>
                        {activeToolPanel === 'relation-graph' && (
                            <ProjectRelationGraph
                                projectId={projectId}
                                sidebarContainer={relationGraphSidebarHost}
                            />
                        )}
                        {activeToolPanel === 'timeline' && (
                            <ProjectTimeline
                                projectId={projectId}
                                tagSchemas={tagSchemas}
                                onOpenEntry={(entry) => onOpenEntry?.(projectId, entry)}
                                sidebarContainer={timelineSidebarHost}
                            />
                        )}
                        {activeToolPanel === 'contradiction' && (
                            <ProjectContradictionPanel
                                projectId={projectId}
                                projectName={project.name}
                                aiPluginId={aiPluginId}
                                aiModel={aiModel}
                                activeEntryId={activeEntryId}
                                activeEntryTitle={activeEntryTitle}
                                sidebarContainer={contradictionSidebarHost}
                                onStartDiscussion={onStartReportDiscussion}
                                onOpenEntry={(entry) => onOpenEntry?.(projectId, entry)}
                            />
                        )}
                        {activeToolPanel === 'world-map' && (
                            <WorldMapPanel
                                projectId={projectId}
                                initialMapId={worldMapInitialMapId}
                                onOpenEntry={(entry) => onOpenEntry?.(projectId, entry)}
                                sidebarContainer={worldMapSidebarHost}
                            />
                        )}
                    </div>

                    <div className={`pe-entry-stack${hasActiveEntry ? ' active' : ''}`}>
                        {mountedEntryIds.map((entryId) => (
                            <div
                                key={entryId}
                                className={`pe-entry-layer${entryId === activeEntryId ? ' active' : ''}`}
                            >
                                <EntryEditor
                                    entryId={entryId}
                                    projectId={projectId}
                                    projectName={project.name}
                                    active={entryId === activeEntryId}
                                    aiPluginId={aiPluginId}
                                    aiModel={aiModel}
                                    categories={categories}
                                    entryTypes={entryTypes}
                                    tagSchemas={tagSchemas}
                                    initialEditorMode={placeholderEntryIds.has(entryId) ? 'edit' : 'browse'}
                                    onOpenEntry={(entry) => onOpenEntry?.(projectId, entry)}
                                    onTitleChange={async (updatedEntry) => {
                                        onEntryTitleChange?.(projectId, {
                                            id: updatedEntry.id,
                                            title: updatedEntry.title,
                                        })
                                    }}
                                    onSaved={async () => {
                                        forgetPlaceholderEntry(entryId)
                                        setCategoryEntryRefreshToken(current => current + 1)
                                        touchProjectUpdatedAt()
                                    }}
                                    onTagSchemasChange={async (schemas) => {
                                        setTagSchemas(schemas)
                                        await refreshProject()
                                        touchProjectUpdatedAt()
                                    }}
                                    onBack={() => onBackToProject?.(projectId)}
                                    onDelete={() => {
                                        forgetPlaceholderEntry(entryId)
                                        adjustEntryCount(-1)
                                        setCategoryEntryRefreshToken((t) => t + 1)
                                        onDeleteEntry?.(projectId, entryId)
                                    }}
                                    onDirtyChange={(dirty) => {
                                        onEntryDirtyChange?.(projectId, entryId, dirty)
                                    }}
                                    onSavingChange={(saving) => {
                                        onEntrySavingChange?.(projectId, entryId, saving)
                                    }}
                                    onStartCharacterChat={(entry) => onStartCharacterChat?.(projectId, {
                                        id: entry.id,
                                        title: entry.title,
                                    })}
                                    onOpenWorldMap={handleOpenBoundLocationMap}
                                    onOpenPluginManagement={onOpenPluginManagement}
                                    onOpenAiSettings={onOpenAiSettings}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <TagCreator
                open={tagCreatorOpen}
                projectId={projectId}
                entryTypes={entryTypes}
                initialTag={editingTag}
                existingNames={tagSchemas.map(schema => schema.name)}
                existingCount={tagSchemas.length}
                onClose={() => {
                    setTagCreatorOpen(false)
                    setEditingTag(null)
                }}
                onSaved={async (schema) => {
                    setTagSchemas(prev => {
                        const index = prev.findIndex(item => item.id === schema.id)
                        if (index === -1) return [...prev, schema]
                        return prev.map(item => item.id === schema.id ? schema : item)
                    })
                    await refreshProject()
                    touchProjectUpdatedAt()
                }}
                onDeleted={async (schemaId) => {
                    setTagSchemas(prev => prev.filter(item => item.id !== schemaId))
                    setTagCreatorOpen(false)
                    setEditingTag(null)
                    await refreshProject()
                    touchProjectUpdatedAt()
                }}
            />

            <EntryTypeCreator
                open={entryTypeCreatorOpen}
                projectId={projectId}
                initialEntryType={editingEntryType}
                existingNames={entryTypes.map(entryType => entryType.name)}
                onClose={() => {
                    setEntryTypeCreatorOpen(false)
                    setEditingEntryType(null)
                }}
                onSaved={async (entryType) => {
                    setEntryTypes(prev => {
                        const nextEntryType: EntryTypeView = {kind: 'custom', ...entryType}
                        const index = prev.findIndex(item => item.kind === 'custom' && item.id === entryType.id)
                        if (index === -1) return [...prev, nextEntryType]
                        return prev.map(item =>
                            item.kind === 'custom' && item.id === entryType.id ? nextEntryType : item
                        )
                    })
                    await refreshProject()
                    touchProjectUpdatedAt()
                }}
                onDeleted={async (entryTypeId) => {
                    setEntryTypes(prev => prev.filter(item => !(item.kind === 'custom' && item.id === entryTypeId)))
                    setEntryTypeCreatorOpen(false)
                    setEditingEntryType(null)
                    await refreshProject()
                    touchProjectUpdatedAt()
                }}
            />

            <ProjectCoverPickerModal
                open={coverPickerOpen}
                projectId={projectId}
                projectName={project.name}
                currentCoverPath={project?.cover_path ?? null}
                aiPluginId={aiPluginId}
                aiModel={aiModel}
                onClose={() => setCoverPickerOpen(false)}
                onSelectCover={handleUpdateProjectCover}
                onOpenPluginManagement={onOpenPluginManagement}
            />

            <DeleteDialog
                node={deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onDelete={(key, mode) => handleDelete(key, mode)}
            />
        </div>
    )
}

function ProjectEditor(props: Props) {
    return <ProjectEditorInner key={props.projectId} {...props} />
}

export default memo(ProjectEditor)
