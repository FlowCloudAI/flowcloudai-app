/**
 * 桌面创作首页：汇总继续创作、灵感速记、世界项目与近期关注事项。
 * 页面只编排既有领域能力，项目数据、灵感和 Dock 跳转分别由现有 store、API 与 DesktopApp 负责。
 */
import {type CSSProperties, type FormEvent, memo, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button, Card, Input, RollingBox, Select, useAlert, useContextMenu} from 'flowcloudai-ui'
import {
    db_create_idea_note,
    db_export_project_fcworld,
    db_get_entry,
    db_get_project,
    db_get_project_stats,
    db_list_idea_notes,
    db_delete_project,
    db_update_project,
    formatApiError,
    type Entry,
    type FcworldImportResult,
    type Project,
    type ProjectStats,
    setting_get_settings,
    toApiError,
} from '../api'
import {saveFileDialog} from '../api/dialog'
import {saveAppSettings} from '../features/settings/appSettingsStore'
import ProjectCreator from '../features/projects/components/ProjectCreator'
import FcworldProgressDialog from '../features/projects/components/FcworldProgressDialog'
import ProjectImportConflictDialog from '../features/projects/components/ProjectImportConflictDialog'
import ProjectDefaultCover from '../features/projects/ProjectDefaultCover'
import ProjectCoverImage from '../features/projects/components/ProjectCoverImage'
import {useProjectImportController} from '../features/projects/hooks/useProjectImportController'
import {useFcworldProgress} from '../features/projects/hooks/useFcworldProgress'
import {invalidateProjectList, useProjectListStore} from '../features/projects/projectListStore'
import {
    getHomeActivityTargetKey,
    getHomeTargetEntryId,
    getHomeTargetProjectId,
    isHomeProjectBackedTarget,
    removeHomeActivityTarget,
    removeHomeEntryActivity,
    removeHomeProjectActivity,
    type HomeActivityRecord,
    type HomeActivityTarget,
    type HomeDashboardData,
    useHomeDashboard,
} from '../features/home/homeActivity'
import HomeContinueCoverImage from '../features/home/HomeContinueCoverImage'
import {HOME_TIPS} from '../features/home/homeTips'
import {refreshIdeas, useIdeaInboxRevision} from '../features/ideas/ideaStore'
import {pageDocumentReadEntry} from '../api/pageDocument.ts'
import {convertMarkdownToPageDocument} from '../features/page-document/application/markdownDocumentConversion.ts'
import {FloatingPanel, RenameDialog} from '../shared/ui/overlay'
import {HOME_ONBOARDING_TOUR_ID, type TourDefinition, type TourStepLeaveContext, useTour} from '../features/onboarding'
import {
    buildProjectExportFileName,
    formatProjectDate,
    parseProjectDateMs,
} from '../features/projects/projectDisplay'
import {formatProjectStatCount} from './projectListHomeModel'
import '../shared/ui/layout/WorkspaceScaffold.css'
import './ProjectList.css'

interface ProjectListProps {
    onOpenProject?: (project: Project) => void
    onOpenHomeTarget?: (target: HomeActivityTarget) => void | Promise<void>
}

type SortMode = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc'
type ProjectPageRows = 2 | 5 | 10

const SORT_OPTIONS: Array<{value: SortMode; label: string}> = [
    {value: 'updated-desc', label: '最近更新'},
    {value: 'updated-asc', label: '最早更新'},
    {value: 'name-asc', label: '标题 A-Z'},
    {value: 'name-desc', label: '标题 Z-A'},
]
const PROJECT_PAGE_ROW_OPTIONS: Array<{value: ProjectPageRows; label: string}> = [
    {value: 2, label: '每页 2 行'},
    {value: 5, label: '每页 5 行'},
    {value: 10, label: '每页 10 行'},
]
const HOME_WELCOME_STORAGE_KEY = 'fc:onboarding:home-welcome:v1'
const WELCOME_TOUR_START_DELAY_MS = 300
const HOME_IDEA_PAGE_SIZE = 200
const AI_ASSISTANT_TARGET: HomeActivityTarget = {
    type: 'conversation',
    id: 'ai-chat-panel',
    title: 'AI 助手',
    subtitle: '创作辅助',
}

function formatRelativeTime(value?: string | null): string {
    const timestamp = parseProjectDateMs(value)
    if (!timestamp) return '时间未知'

    const diffMs = Date.now() - timestamp
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour

    if (diffMs < minute) return '刚刚'
    if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`
    if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`
    if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} 天前`
    return formatProjectDate(value)
}

function asOptionalString(value: unknown): string | null | undefined {
    return typeof value === 'string' || value == null ? value : undefined
}

function normalizeStarredProjectIds(projectIds: string[] | null | undefined) {
    return Array.from(new Set((projectIds ?? []).filter(Boolean)))
}

function buildProjectMarkdownLink(project: Project) {
    return `[${project.name}](fc://project/${encodeURIComponent(project.id)})`
}

function hasSeenHomeWelcome(): boolean {
    try {
        return window.localStorage.getItem(HOME_WELCOME_STORAGE_KEY) === 'done'
    } catch {
        return false
    }
}

function markHomeWelcomeSeen() {
    try {
        window.localStorage.setItem(HOME_WELCOME_STORAGE_KEY, 'done')
    } catch {
        // 本地存储不可用时只影响欢迎弹窗是否重复出现。
    }
}

function collectDashboardTargets(dashboard: HomeDashboardData) {
    const targets: HomeActivityTarget[] = [
        ...dashboard.recentItems,
        ...dashboard.pinnedItems,
    ]
    if (dashboard.continueItem) {
        targets.push(dashboard.continueItem)
    }
    return targets
}

function ProjectList({onOpenProject, onOpenHomeTarget}: ProjectListProps) {
    const {showAlert} = useAlert()
    const {showContextMenu} = useContextMenu()
    const {
        progress: exportProgress,
        startProgress: startExportProgress,
        closeProgress: closeExportProgress,
        finishProgress: finishExportProgress,
    } = useFcworldProgress()
    const {registerTour, startTour} = useTour()
    const [searchText, setSearchText] = useState('')
    const [sortMode, setSortMode] = useState<SortMode>('updated-desc')
    const [projectPageRows, setProjectPageRows] = useState<ProjectPageRows>(2)
    const [projectPage, setProjectPage] = useState(1)
    const [projectGridColumnCount, setProjectGridColumnCount] = useState(4)
    const [creatorOpen, setCreatorOpen] = useState(false)
    const [welcomeOpen, setWelcomeOpen] = useState(false)
    const [starredProjectIds, setStarredProjectIds] = useState<string[]>([])
    const [renameProject, setRenameProject] = useState<Project | null>(null)
    const [projectActionBusy, setProjectActionBusy] = useState(false)
    const [ideaText, setIdeaText] = useState('')
    const [ideaSaving, setIdeaSaving] = useState(false)
    const [tipIndex, setTipIndex] = useState(0)
    const [projectStatsById, setProjectStatsById] = useState<ReadonlyMap<string, ProjectStats | null>>(
        () => new Map(),
    )
    const [inboxIdeaCountByProject, setInboxIdeaCountByProject] = useState<ReadonlyMap<string, number>>(
        () => new Map(),
    )
    const ideaInboxRevision = useIdeaInboxRevision()
    const ideaComposingRef = useRef(false)
    const projectGridRef = useRef<HTMLDivElement>(null)
    const dashboard = useHomeDashboard()
    const [entryByTargetKey, setEntryByTargetKey] = useState<ReadonlyMap<string, Entry>>(() => new Map())
    const [entryTextByTargetKey, setEntryTextByTargetKey] = useState<ReadonlyMap<string, string>>(() => new Map())
    const [invalidHomeTargetKeys, setInvalidHomeTargetKeys] = useState<Set<string>>(() => new Set())
    const [pendingEntryTargetKeys, setPendingEntryTargetKeys] = useState<Set<string>>(() => new Set())
    const {
        projects,
        loading,
        error,
        hasLoaded: hasLoadedProjects,
    } = useProjectListStore()
    const openCreatorForTour = useCallback(() => {
        setCreatorOpen(true)
    }, [])
    const closeCreatorWhenTourCancelled = useCallback(({reason}: TourStepLeaveContext) => {
        if (reason === 'skip' || reason === 'stop') setCreatorOpen(false)
    }, [])
    const closeCreatorWhenBackToHome = useCallback(({reason}: TourStepLeaveContext) => {
        if (reason === 'previous' || reason === 'skip' || reason === 'stop') setCreatorOpen(false)
    }, [])
    const homeOnboardingTour = useMemo<TourDefinition>(() => ({
        id: HOME_ONBOARDING_TOUR_ID,
        version: 1,
        steps: [
            {
                id: 'home-overview',
                target: '[data-tour-id="home-overview"]',
                title: '这是创作首页',
                content: '这里是进入流云AI后的起点。你可以继续已有世界，也可以从这里创建第一个世界观。',
                placement: 'bottom',
            },
            {
                id: 'home-actions',
                target: '[data-tour-id="home-quick-actions"]',
                title: '先选一个起点',
                content: '没有项目时可以使用基础模板、让 AI 帮你梳理骨架或导入世界包；已有项目时会优先展示继续创作。',
                placement: 'bottom',
            },
            {
                id: 'new-world-action',
                target: '[data-tour-id="home-new-world-action"]',
                title: '使用基础模板',
                content: '这个入口会打开新建窗口，并默认生成常用分类和标签。点击下一步会自动打开窗口，方便继续查看。',
                placement: 'bottom',
            },
            {
                id: 'creator-dialog',
                target: '[data-tour-id="project-creator-dialog"]',
                title: '新建世界观窗口',
                content: '新世界只需要先填最小信息：名称、可选简介，以及是否生成默认模板。',
                placement: 'right',
                beforeEnter: openCreatorForTour,
                afterLeave: closeCreatorWhenBackToHome,
            },
            {
                id: 'creator-name',
                target: '[data-tour-id="project-creator-name"]',
                title: '先填世界观名称',
                content: '名称是唯一必填项，建议用作品名、企划名或你能快速识别的世界名。',
                placement: 'right',
                beforeEnter: openCreatorForTour,
                afterLeave: closeCreatorWhenTourCancelled,
            },
            {
                id: 'creator-description',
                target: '[data-tour-id="project-creator-description"]',
                title: '简介可以先写一句话',
                content: '简介不是设定正文，只要写清题材、基调或当前创作目标，后续 AI 辅助会更好用。',
                placement: 'right',
                beforeEnter: openCreatorForTour,
                afterLeave: closeCreatorWhenTourCancelled,
            },
            {
                id: 'creator-template',
                target: '[data-tour-id="project-creator-template"]',
                title: '默认模板先保持开启',
                content: '默认模板会帮你生成常用分类和标签。第一次创建建议保留，后面不需要时再调整。',
                placement: 'right',
                beforeEnter: openCreatorForTour,
                afterLeave: closeCreatorWhenTourCancelled,
            },
            {
                id: 'creator-submit',
                target: '[data-tour-id="project-creator-submit"]',
                title: '填好后点击创建',
                content: '名称填好后这里会变成可用。完成引导后窗口会保留，你可以直接创建第一个世界观。',
                placement: 'top',
                beforeEnter: openCreatorForTour,
                afterLeave: closeCreatorWhenTourCancelled,
            },
        ],
    }), [closeCreatorWhenBackToHome, closeCreatorWhenTourCancelled, openCreatorForTour])

    useEffect(() => {
        if (!hasSeenHomeWelcome()) setWelcomeOpen(true)
    }, [])

    useEffect(() => registerTour(homeOnboardingTour), [homeOnboardingTour, registerTour])

    const finishWelcome = useCallback((startTutorial: boolean) => {
        markHomeWelcomeSeen()
        setWelcomeOpen(false)
        if (!startTutorial) return
        window.setTimeout(() => {
            startTour(homeOnboardingTour, {force: true, markCompletedOnSkip: true})
        }, WELCOME_TOUR_START_DELAY_MS)
    }, [homeOnboardingTour, startTour])

    useEffect(() => {
        let cancelled = false
        setting_get_settings()
            .then(settings => {
                if (!cancelled) setStarredProjectIds(normalizeStarredProjectIds(settings.starred_project_ids))
            })
            .catch(error => {
                if (!cancelled) void showAlert(`加载星标项目失败：${String(error)}`, 'error', 'nonInvasive', 3000)
            })
        return () => {
            cancelled = true
        }
    }, [showAlert])

    const projectIdSet = useMemo(() => new Set(projects.map(project => project.id)), [projects])
    const starredProjectIdSet = useMemo(() => new Set(starredProjectIds), [starredProjectIds])

    useEffect(() => {
        if (!hasLoadedProjects || projects.length === 0) return

        let cancelled = false
        void Promise.allSettled(projects.map(project => db_get_project_stats(project.id)))
            .then(results => {
                if (cancelled) return
                setProjectStatsById(new Map(projects.map((project, index) => {
                    const result = results[index]
                    return [project.id, result?.status === 'fulfilled' ? result.value : null]
                })))
            })

        return () => {
            cancelled = true
        }
    }, [hasLoadedProjects, projects])

    useEffect(() => {
        if (!hasLoadedProjects) return
        if (projects.length === 0) {
            setInboxIdeaCountByProject(new Map())
            return
        }

        let cancelled = false
        void (async () => {
            const counts = new Map<string, number>()
            let offset = 0
            while (true) {
                const ideas = await db_list_idea_notes({
                    status: 'inbox',
                    limit: HOME_IDEA_PAGE_SIZE,
                    offset,
                })
                for (const idea of ideas) {
                    if (idea.project_id && projectIdSet.has(idea.project_id)) {
                        counts.set(idea.project_id, (counts.get(idea.project_id) ?? 0) + 1)
                    }
                }
                if (ideas.length < HOME_IDEA_PAGE_SIZE) break
                offset += ideas.length
            }
            if (!cancelled) setInboxIdeaCountByProject(counts)
        })().catch(() => {
            if (!cancelled) setInboxIdeaCountByProject(new Map())
        })

        return () => {
            cancelled = true
        }
    }, [hasLoadedProjects, ideaInboxRevision, projectIdSet, projects.length])

    useEffect(() => {
        if (!hasLoadedProjects) return

        const entryTargets: Array<{
            key: string
            projectId: string
            entryId: string
            target: HomeActivityTarget
        }> = []
        const invalidKeys = new Set<string>()
        const missingProjectIds = new Set<string>()

        for (const target of collectDashboardTargets(dashboard)) {
            const key = getHomeActivityTargetKey(target)
            const projectId = getHomeTargetProjectId(target)

            if (isHomeProjectBackedTarget(target) && (!projectId || !projectIdSet.has(projectId))) {
                invalidKeys.add(key)
                if (projectId) {
                    missingProjectIds.add(projectId)
                } else {
                    removeHomeActivityTarget(target)
                }
                continue
            }

            if (target.type === 'entry') {
                const entryId = getHomeTargetEntryId(target)
                if (!projectId || !entryId) {
                    invalidKeys.add(key)
                    removeHomeActivityTarget(target)
                    continue
                }
                entryTargets.push({key, projectId, entryId, target})
            }
        }

        if (invalidKeys.size > 0) {
            setInvalidHomeTargetKeys(prev => new Set([...prev, ...invalidKeys]))
        }
        for (const projectId of missingProjectIds) {
            removeHomeProjectActivity(projectId)
        }
        if (entryTargets.length === 0) return

        const validationKeys = new Set(entryTargets.map(item => item.key))
        setPendingEntryTargetKeys(prev => new Set([...prev, ...validationKeys]))

        let cancelled = false
        void (async () => {
            const validKeys = new Set<string>()
            const validEntries = new Map<string, Entry>()
            const validEntryTexts = new Map<string, string>()
            const invalidEntryKeys = new Set<string>()

            await Promise.all(entryTargets.map(async item => {
                try {
                    const entry = await db_get_entry(item.entryId, item.projectId)
                    if (entry.project_id !== item.projectId) {
                        invalidEntryKeys.add(item.key)
                        removeHomeActivityTarget(item.target)
                        return
                    }
                    validKeys.add(item.key)
                    validEntries.set(item.key, entry)
                    const document = await pageDocumentReadEntry(item.entryId).catch(() => null)
                    validEntryTexts.set(item.key, document?.derivedText
                        ?? convertMarkdownToPageDocument(item.entryId, entry.content ?? '').derivedText)
                } catch {
                    invalidEntryKeys.add(item.key)
                    removeHomeEntryActivity(item.projectId, item.entryId)
                }
            }))

            if (cancelled) return

            setPendingEntryTargetKeys(prev => {
                const next = new Set(prev)
                for (const key of validationKeys) next.delete(key)
                return next
            })
            setEntryByTargetKey(prev => {
                const next = new Map(prev)
                for (const key of invalidEntryKeys) next.delete(key)
                for (const [key, entry] of validEntries) next.set(key, entry)
                return next
            })
            setEntryTextByTargetKey(prev => {
                const next = new Map(prev)
                for (const key of invalidEntryKeys) next.delete(key)
                for (const [key, text] of validEntryTexts) next.set(key, text)
                return next
            })
            setInvalidHomeTargetKeys(prev => {
                const next = new Set(prev)
                for (const key of validKeys) next.delete(key)
                for (const key of invalidEntryKeys) next.add(key)
                return next
            })
        })()

        return () => {
            cancelled = true
        }
    }, [dashboard, hasLoadedProjects, projectIdSet])

    const sortedProjects = useMemo(() => [...projects].sort((a, b) => {
            const starOrder = Number(starredProjectIdSet.has(b.id)) - Number(starredProjectIdSet.has(a.id))
            if (starOrder !== 0) return starOrder

            const timeA = parseProjectDateMs(asOptionalString(a.updated_at) ?? asOptionalString(a.created_at))
            const timeB = parseProjectDateMs(asOptionalString(b.updated_at) ?? asOptionalString(b.created_at))
            const nameOrder = a.name.localeCompare(b.name, 'zh-CN')

            switch (sortMode) {
                case 'updated-asc':
                    return timeA - timeB || nameOrder
                case 'name-asc':
                    return nameOrder
                case 'name-desc':
                    return -nameOrder
                case 'updated-desc':
                default:
                    return timeB - timeA || nameOrder
            }
        }), [projects, sortMode, starredProjectIdSet])
    const filteredProjects = useMemo(() => {
        const query = searchText.trim().toLocaleLowerCase('zh-CN')
        if (!query) return sortedProjects
        return sortedProjects.filter(project => [project.name, project.description ?? '']
            .join(' ')
            .toLocaleLowerCase('zh-CN')
            .includes(query))
    }, [searchText, sortedProjects])
    const projectPageSize = Math.max(1, projectGridColumnCount * projectPageRows - 1)
    const projectPageCount = Math.max(1, Math.ceil(filteredProjects.length / projectPageSize))
    const currentProjectPage = Math.min(projectPage, projectPageCount)
    const paginatedProjects = useMemo(() => {
        const start = (currentProjectPage - 1) * projectPageSize
        return filteredProjects.slice(start, start + projectPageSize)
    }, [currentProjectPage, filteredProjects, projectPageSize])

    useEffect(() => {
        const grid = projectGridRef.current
        if (!grid) return undefined

        const updateColumnCount = () => {
            const columns = window.getComputedStyle(grid).gridTemplateColumns
                .split(' ')
                .filter(Boolean)
                .length
            setProjectGridColumnCount(Math.max(1, columns))
        }
        updateColumnCount()

        const observer = new ResizeObserver(updateColumnCount)
        observer.observe(grid)
        return () => observer.disconnect()
    }, [error, hasLoadedProjects, loading])

    useEffect(() => {
        setProjectPage(page => Math.min(page, projectPageCount))
    }, [projectPageCount])

    const saveStarredProjectIds = useCallback(async (projectIds: string[]) => {
        const nextIds = normalizeStarredProjectIds(projectIds)
        const settings = await setting_get_settings()
        const nextSettings = {...settings, starred_project_ids: nextIds}
        await saveAppSettings(nextSettings)
        return nextIds
    }, [])

    const toggleProjectStar = useCallback(async (project: Project) => {
        const previousIds = starredProjectIds
        const nextIds = previousIds.includes(project.id)
            ? previousIds.filter(id => id !== project.id)
            : [...previousIds, project.id]

        setStarredProjectIds(nextIds)
        try {
            setStarredProjectIds(await saveStarredProjectIds(nextIds))
        } catch (error) {
            setStarredProjectIds(previousIds)
            await showAlert(`保存星标失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        }
    }, [saveStarredProjectIds, showAlert, starredProjectIds])

    const handleRenameProject = useCallback(async (name: string) => {
        if (!renameProject) return
        if (name === renameProject.name) {
            setRenameProject(null)
            return
        }

        setProjectActionBusy(true)
        try {
            await db_update_project({id: renameProject.id, name})
            await invalidateProjectList()
            setRenameProject(null)
            await showAlert('项目已重命名', 'success', 'nonInvasive', 1500)
        } catch (error) {
            await showAlert(`重命名项目失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setProjectActionBusy(false)
        }
    }, [renameProject, showAlert])

    const handleDeleteProject = useCallback(async (project: Project) => {
        const confirmed = await showAlert(
            `确定删除项目「${project.name}」吗？此操作不可撤销。`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        try {
            await db_delete_project(project.id)
            removeHomeProjectActivity(project.id)
            await invalidateProjectList()
            if (starredProjectIds.includes(project.id)) {
                const nextIds = starredProjectIds.filter(id => id !== project.id)
                setStarredProjectIds(nextIds)
                await saveStarredProjectIds(nextIds)
            }
            await showAlert('项目已删除', 'success', 'nonInvasive', 1500)
        } catch (error) {
            await showAlert(`删除项目失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        }
    }, [saveStarredProjectIds, showAlert, starredProjectIds])

    const copyProjectLink = useCallback(async (project: Project) => {
        try {
            await navigator.clipboard.writeText(buildProjectMarkdownLink(project))
            await showAlert('链接已复制', 'success', 'nonInvasive', 1500)
        } catch (error) {
            await showAlert(`复制链接失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        }
    }, [showAlert])

    const handleExportProject = useCallback(async (project: Project) => {
        const selectedPath = await saveFileDialog({
            defaultPath: buildProjectExportFileName(project.name),
            filters: [{name: '流云AI World', extensions: ['fcworld']}],
        })
        if (!selectedPath) return

        try {
            const operationId = startExportProgress('export', '导出世界')
            await db_export_project_fcworld(project.id, selectedPath, operationId)
            finishExportProgress()
        } catch (error) {
            closeExportProgress()
            await showAlert(`导出世界失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 3200)
        }
    }, [closeExportProgress, finishExportProgress, showAlert, startExportProgress])

    const handleProjectContextMenu = useCallback((event: MouseEvent<HTMLDivElement>, project: Project) => {
        showContextMenu(event, [
            {
                label: starredProjectIdSet.has(project.id) ? '取消标星' : '标星',
                onClick: () => void toggleProjectStar(project),
            },
            {label: '复制链接', onClick: () => void copyProjectLink(project)},
            {label: '重命名', onClick: () => setRenameProject(project)},
            {
                label: '导出世界',
                disabled: exportProgress !== null,
                onClick: () => void handleExportProject(project),
            },
            {label: '删除', danger: true, onClick: () => void handleDeleteProject(project)},
        ])
    }, [copyProjectLink, exportProgress, handleDeleteProject, handleExportProject, showContextMenu, starredProjectIdSet, toggleProjectStar])

    const projectCountLabel = hasLoadedProjects ? projects.length : '-'
    const filteredProjectCountLabel = hasLoadedProjects ? filteredProjects.length : '-'
    const isVisibleHomeTarget = useCallback((target: HomeActivityTarget) => {
        const key = getHomeActivityTargetKey(target)
        if (invalidHomeTargetKeys.has(key)) return false

        if (hasLoadedProjects && isHomeProjectBackedTarget(target)) {
            const projectId = getHomeTargetProjectId(target)
            if (!projectId || !projectIdSet.has(projectId)) return false
        }

        if (target.type === 'entry' && hasLoadedProjects) {
            if (pendingEntryTargetKeys.has(key)) return false
            return entryByTargetKey.has(key)
        }

        return true
    }, [entryByTargetKey, hasLoadedProjects, invalidHomeTargetKeys, pendingEntryTargetKeys, projectIdSet])
    const visibleRecentItems = useMemo(() => (
        dashboard.recentItems.filter(item => isVisibleHomeTarget(item))
    ), [dashboard.recentItems, isVisibleHomeTarget])
    const continueItem = useMemo(() => {
        if (
            dashboard.continueItem
            && (dashboard.continueItem.type === 'entry' || dashboard.continueItem.type === 'tool')
            && isVisibleHomeTarget(dashboard.continueItem)
        ) {
            return dashboard.continueItem
        }
        return visibleRecentItems.find(item => item.type === 'entry' || item.type === 'tool') ?? null
    }, [dashboard.continueItem, isVisibleHomeTarget, visibleRecentItems])
    const continueKey = continueItem ? getHomeActivityTargetKey(continueItem) : null
    const continueActivity = continueKey
        ? visibleRecentItems.find(item => getHomeActivityTargetKey(item) === continueKey)
        : null
    const lastSessionTarget = dashboard.lastSession?.target
    const isLastSessionContinue = Boolean(
        continueKey
        && lastSessionTarget
        && getHomeActivityTargetKey(lastSessionTarget) === continueKey,
    )
    const continueTimestamp = isLastSessionContinue
        ? dashboard.lastSession?.savedAt
        : continueActivity?.lastOpenedAt
    const recentTargetByProjectId = useMemo(() => {
        const targets = new Map<string, HomeActivityRecord>()
        for (const item of visibleRecentItems) {
            const projectId = getHomeTargetProjectId(item)
            if (projectId && item.type !== 'project' && !targets.has(projectId)) targets.set(projectId, item)
        }
        return targets
    }, [visibleRecentItems])
    const resumeTarget = continueItem
    const resumeProjectId = resumeTarget ? getHomeTargetProjectId(resumeTarget) : null
    const resumeProject = resumeProjectId ? projects.find(project => project.id === resumeProjectId) ?? null : null
    const resumeEntry = resumeTarget?.type === 'entry' && continueKey
        ? entryByTargetKey.get(continueKey) ?? null
        : null
    const resumeEntryText = continueKey ? entryTextByTargetKey.get(continueKey) ?? resumeEntry?.summary ?? '' : ''
    const resumeExcerpt = resumeEntryText.length > 70 ? `${resumeEntryText.slice(0, 70)}…` : resumeEntryText
    const resumeDescription = resumeTarget?.type === 'entry'
        ? (resumeExcerpt ? `上次写到「${resumeExcerpt}」` : undefined)
        : resumeTarget?.description || undefined
    const resumeWordCount = resumeEntry ? Array.from(resumeEntryText).length : null
    const resumeTimestamp = continueTimestamp
        ?? resumeTarget?.updatedAt
        ?? asOptionalString(resumeProject?.updated_at)
        ?? asOptionalString(resumeProject?.created_at)
    const activeHelpLink = dashboard.helpLinks[0] ?? null
    const activeHomeTip = HOME_TIPS.length > 0 ? HOME_TIPS[tipIndex % HOME_TIPS.length] : null

    const openDashboardTarget = useCallback((target: HomeActivityTarget) => {
        const projectId = getHomeTargetProjectId(target)
        if (hasLoadedProjects && isHomeProjectBackedTarget(target) && (!projectId || !projectIdSet.has(projectId))) {
            if (projectId) {
                removeHomeProjectActivity(projectId)
            } else {
                removeHomeActivityTarget(target)
            }
            void showAlert('这个首页入口指向的内容已不存在，已从首页移除。', 'warning', 'nonInvasive', 3000)
            return
        }
        if (target.type === 'project') {
            const targetProjectId = target.projectId ?? target.id
            const project = projects.find(item => item.id === targetProjectId)
            if (project) {
                onOpenProject?.(project)
                return
            }
        }
        void onOpenHomeTarget?.(target)
    }, [hasLoadedProjects, onOpenHomeTarget, onOpenProject, projectIdSet, projects, showAlert])

    const handleIdeaSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (ideaComposingRef.current || ideaSaving) return
        const content = ideaText.trim()
        if (!content) {
            await showAlert('先写下一条灵感。好点子不必完整。', 'info', 'nonInvasive', 2200)
            return
        }

        setIdeaSaving(true)
        try {
            await db_create_idea_note({content})
            await refreshIdeas()
            setIdeaText('')
            await showAlert('灵感已存入收件箱', 'success', 'nonInvasive', 1800)
        } catch (error) {
            await showAlert(`保存灵感失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setIdeaSaving(false)
        }
    }, [ideaSaving, ideaText, showAlert])

    const openImportedProject = useCallback(async (result: FcworldImportResult) => {
        await invalidateProjectList()
        const importedProject = await db_get_project(result.projectId)
        onOpenProject?.(importedProject)
    }, [onOpenProject])

    const handleImportError = useCallback(
        (error: unknown) => showAlert(`导入世界失败：${String(error)}`, 'error', 'nonInvasive', 3600),
        [showAlert],
    )
    const {
        importing,
        conflict: importConflict,
        progress: fcworldProgress,
        selectAndImport: handleImportProject,
        rename: handleImportConflictRename,
        overwrite: importConflictOverwrite,
        cancelConflict: handleImportConflictCancel,
    } = useProjectImportController({onImported: openImportedProject, onError: handleImportError})

    const handlePageContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
        if (
            event.target instanceof Element
            && event.target.closest('button, a, input, textarea, select, [role="button"], .project-list-card')
        ) {
            return
        }

        showContextMenu(event, [
            {label: '新建世界', onClick: () => setCreatorOpen(true)},
            {label: '导入世界', disabled: importing, onClick: () => void handleImportProject()},
        ])
    }, [handleImportProject, importing, showContextMenu])

    const handleImportConflictOverwrite = useCallback(async () => {
        if (!importConflict?.duplicateProject || importing) return
        const confirmed = await showAlert(
            '选择覆盖后，原世界观的数据会丢失。确定覆盖吗？',
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return
        await importConflictOverwrite()
    }, [importConflict, importConflictOverwrite, importing, showAlert])

    return (
        <>
                        <FloatingPanel
                            open={welcomeOpen}
                            dismissible={false}
                            title="先从第一个世界观开始"
                            className="project-home-welcome-overlay"
                            ariaLabel="欢迎使用流云AI"
                        >
                            <div className="project-home-welcome">
                                <div className="project-home-welcome__body">
                                    <span className="project-home-welcome__eyebrow">欢迎使用流云AI</span>
                                    <p>
                            流云AI会把世界项目、词条、灵感和 AI 辅助放在同一个创作工作区里。你可以先看一遍简短教程，也可以直接开始使用。
                        </p>
                    </div>
                    <div className="project-home-welcome__actions">
                        <Button type="button" variant="ghost" radius="full" onClick={() => finishWelcome(false)}>
                            暂不需要
                        </Button>
                        <Button type="button" radius="full" onClick={() => finishWelcome(true)}>
                            开启教程
                        </Button>
                    </div>
                </div>
            </FloatingPanel>
            <ProjectCreator
                open={creatorOpen}
                onClose={() => setCreatorOpen(false)}
                onCreated={project => onOpenProject?.(project)}
                existingNames={projects.map(p => p.name)}
            />
            <ProjectImportConflictDialog
                open={Boolean(importConflict)}
                preview={importConflict}
                existingNames={projects.map(p => p.name)}
                busy={importing}
                onCancel={handleImportConflictCancel}
                onRename={projectName => void handleImportConflictRename(projectName)}
                onOverwrite={() => void handleImportConflictOverwrite()}
            />
            <RenameDialog
                open={Boolean(renameProject)}
                title="重命名项目"
                initialValue={renameProject?.name ?? ''}
                placeholder="输入项目名称"
                confirmText="保存"
                busy={projectActionBusy}
                onClose={() => {
                    if (!projectActionBusy) setRenameProject(null)
                }}
                onConfirm={name => void handleRenameProject(name)}
            />
            <FcworldProgressDialog progress={exportProgress ?? fcworldProgress} />
            <RollingBox axis="y" style={{padding: 'var(--fc-space-xs)'} as CSSProperties} thumbSize="thin">
                <div className="project-list-page fc-page-shell">
                    {hasLoadedProjects && projects.length === 0 && !loading && !error ? (
                        <section className="project-home-empty" data-tour-id="home-overview">
                            <div className="project-home-empty__intro">
                                <span className="project-home-empty__symbol" aria-hidden="true">✦</span>
                                <span className="project-home-eyebrow">第一次创作</span>
                                <h1>开始你的第一个世界</h1>
                                <p>先选一种起点。名称、结构和内容之后都能修改，不需要现在做完所有决定。</p>
                            </div>
                            <div className="project-home-start-grid" data-tour-id="home-quick-actions">
                                <Card
                                    className="project-home-start-card"
                                    title="使用基础模板"
                                    description="带人物、地点与事件分类，适合直接开始"
                                    extraInfo="▦"
                                    actions={(
                                        <Button type="button" data-tour-id="home-new-world-action" onClick={() => setCreatorOpen(true)}>
                                            创建世界
                                        </Button>
                                    )}
                                    variant="bordered"
                                />
                                <Card
                                    className="project-home-start-card"
                                    title="让 AI 搭骨架"
                                    description="通过对话整理主题、冲突与核心设定"
                                    extraInfo="✦"
                                    actions={(
                                        <Button type="button" variant="outline" onClick={() => openDashboardTarget(AI_ASSISTANT_TARGET)}>
                                            打开 AI 助手
                                        </Button>
                                    )}
                                    variant="bordered"
                                />
                                <Card
                                    className="project-home-start-card"
                                    title="导入世界包"
                                    description="从已有的 FlowCloudAI 世界包继续创作"
                                    extraInfo="⇧"
                                    actions={(
                                        <Button type="button" variant="outline" disabled={importing} onClick={() => void handleImportProject()}>
                                            {importing ? '导入中…' : '选择世界包'}
                                        </Button>
                                    )}
                                    variant="bordered"
                                />
                            </div>
                            {activeHelpLink && (
                                <div className="project-home-empty__help">
                                    第一次使用？
                                    <Button type="button" size="sm" variant="ghost" onClick={() => openDashboardTarget(activeHelpLink.target)}>
                                        查看快速开始
                                    </Button>
                                </div>
                            )}
                        </section>
                    ) : (
                        <>
                            <section className="project-home-resume" data-tour-id="home-overview">
                                {resumeTarget && (
                                    <>
                                        <span className="project-home-eyebrow">{isLastSessionContinue ? '上次停在这里' : '继续创作'}</span>
                                        <Card
                                            className="project-home-resume-card"
                                            imageSlot={(
                                                <HomeContinueCoverImage
                                                    target={resumeTarget}
                                                    project={resumeProject}
                                                    entry={resumeEntry}
                                                    eager
                                                />
                                            )}
                                            imageHeight="var(--fc-home-resume-cover-height)"
                                            tag={resumeProject?.name ? <span className="project-home-resume-project">{resumeProject.name}</span> : undefined}
                                            title={resumeTarget.title}
                                            description={resumeDescription}
                                            extraInfo={(
                                                <div className="project-home-resume-meta">
                                                    <span>{formatRelativeTime(resumeTimestamp)}</span>
                                                    {resumeWordCount !== null && <span>本篇 {formatProjectStatCount(resumeWordCount)} 字</span>}
                                                </div>
                                            )}
                                            actions={(
                                                <div className="project-home-resume-actions">
                                                    <Button type="button" size="lg" onClick={() => openDashboardTarget(resumeTarget)}>
                                                        {resumeTarget.type === 'entry' ? '继续写作' : '继续创作'}
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="lg"
                                                        variant="outline"
                                                        onClick={() => {
                                                            if (resumeProject) onOpenProject?.(resumeProject)
                                                            openDashboardTarget({
                                                                ...AI_ASSISTANT_TARGET,
                                                                projectId: resumeProject?.id,
                                                                subtitle: resumeProject?.name,
                                                            })
                                                        }}
                                                    >
                                                        和 AI 讨论这个世界
                                                    </Button>
                                                </div>
                                            )}
                                            variant="shadow"
                                        />
                                    </>
                                )}
                                <form className="project-home-idea-form" data-tour-id="home-quick-actions" onSubmit={event => void handleIdeaSubmit(event)}>
                                    <span className="project-home-idea-form__icon" aria-hidden="true">✦</span>
                                    <Input
                                        className="project-home-idea-input"
                                        value={ideaText}
                                        placeholder="突然想到什么？按 Enter 存进灵感"
                                        aria-label="快速记录灵感"
                                        disabled={ideaSaving}
                                        onValueChange={setIdeaText}
                                        onCompositionStart={() => {
                                            ideaComposingRef.current = true
                                        }}
                                        onCompositionEnd={() => {
                                            ideaComposingRef.current = false
                                        }}
                                    />
                                    <Button type="submit" variant="ghost" disabled={ideaSaving}>
                                        {ideaSaving ? '保存中…' : '存入灵感'}
                                    </Button>
                                </form>
                            </section>

                    <section className="project-home-workbench" onContextMenu={handlePageContextMenu}>
                        <div className="project-list-header">
                            <div className="project-list-title-block">
                                <h2 className="project-list-section-title">我的世界</h2>
                                <p className="project-list-subtitle">
                                    {projectCountLabel} 个世界 · 当前显示 {filteredProjectCountLabel} 个
                                </p>
                            </div>
                            <div className="project-list-header-actions">
                                <Input
                                    className="project-list-search"
                                    placeholder="搜索世界"
                                    value={searchText}
                                    aria-label="搜索世界"
                                    onValueChange={value => {
                                        setSearchText(value)
                                        setProjectPage(1)
                                    }}
                                />
                                <Select
                                    className="project-list-sort"
                                    options={SORT_OPTIONS}
                                    value={sortMode}
                                    aria-label="世界排序"
                                    onValueChange={value => {
                                        const nextValue = Array.isArray(value) ? value[0] : value
                                        setSortMode(nextValue as SortMode)
                                        setProjectPage(1)
                                    }}
                                />
                                <Select
                                    className="project-list-page-size"
                                    options={PROJECT_PAGE_ROW_OPTIONS}
                                    value={projectPageRows}
                                    aria-label="每页显示行数"
                                    onValueChange={value => {
                                        const nextValue = Array.isArray(value) ? value[0] : value
                                        setProjectPageRows(Number(nextValue) as ProjectPageRows)
                                        setProjectPage(1)
                                    }}
                                />
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={importing}
                                    onClick={() => void handleImportProject()}
                                >
                                    {importing ? '导入中…' : '导入'}
                                </Button>
                                <Button type="button" size="sm" data-tour-id="home-new-world-action" onClick={() => setCreatorOpen(true)}>
                                    新建世界
                                </Button>
                            </div>
                        </div>

                        {error && (
                            <div className="project-list-feedback fc-status-banner fc-status-banner--error error">
                                项目列表加载失败：{error}
                            </div>
                        )}

                        {hasLoadedProjects || loading || error ? (
                            <div ref={projectGridRef} className="project-list-grid">
                                {filteredProjects.length === 0 && !loading ? (
                                    <div className="project-list-feedback fc-status-banner">
                                        没有匹配的项目。
                                    </div>
                                ) : (
                                    paginatedProjects.map(project => {
                                        const coverPath = asOptionalString(project.cover_path)
                                        const updatedAt = asOptionalString(project.updated_at)
                                        const createdAt = asOptionalString(project.created_at)
                                        const timestampLabel = formatProjectDate(updatedAt ?? createdAt)
                                        const isStarred = starredProjectIdSet.has(project.id)
                                        const stats = projectStatsById.get(project.id)
                                        const inboxIdeaCount = inboxIdeaCountByProject.get(project.id) ?? 0
                                        const recentTarget = recentTargetByProjectId.get(project.id)
                                        const description = project.description?.trim()

                                        return (
                                            <div
                                                key={project.id}
                                                onContextMenu={event => handleProjectContextMenu(event, project)}
                                            >
                                                <Card
                                                    className="project-list-card"
                                                    role="button"
                                                    tabIndex={0}
                                                    aria-label={`打开世界：${project.name}`}
                                                    onClick={() => onOpenProject?.(project)}
                                                    onKeyDown={event => {
                                                        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                                                        event.preventDefault()
                                                        onOpenProject?.(project)
                                                    }}
                                                    imageSlot={coverPath ? (
                                                        <ProjectCoverImage
                                                            projectId={project.id}
                                                            coverPath={coverPath}
                                                            alt={project.name}
                                                            fallback={(
                                                                <ProjectDefaultCover
                                                                    projectId={project.id}
                                                                    projectName={project.name}
                                                                />
                                                            )}
                                                        />
                                                    ) : (
                                                        <ProjectDefaultCover
                                                            projectId={project.id}
                                                            projectName={project.name}
                                                        />
                                                    )}
                                                    imageHeight="var(--fc-home-project-card-height)"
                                                    title={project.name}
                                                    tag={(
                                                        <Button
                                                            type="button"
                                                            className="project-list-star-button"
                                                            size="sm"
                                                            variant="ghost"
                                                            aria-label={isStarred ? `取消标星${project.name}` : `标星${project.name}`}
                                                            aria-pressed={isStarred}
                                                            onClick={event => {
                                                                event.stopPropagation()
                                                                void toggleProjectStar(project)
                                                            }}
                                                        >
                                                            {isStarred ? '★' : '☆'}
                                                        </Button>
                                                    )}
                                                    description={description || undefined}
                                                    extraInfo={(
                                                        <div className="project-list-meta">
                                                            {recentTarget && (
                                                                <button
                                                                    type="button"
                                                                    className="project-list-recent-link"
                                                                    onClick={event => {
                                                                        event.stopPropagation()
                                                                        openDashboardTarget(recentTarget)
                                                                    }}
                                                                >
                                                                    <span>最近：{recentTarget.title}</span>
                                                                    <span aria-hidden="true">→</span>
                                                                </button>
                                                            )}
                                                            <div className="project-list-stats">
                                                                {stats ? (
                                                                    <>
                                                                        <span>{formatProjectStatCount(stats.entryCount)} 个词条</span>
                                                                        <span>{formatProjectStatCount(stats.wordCount)} 字</span>
                                                                    </>
                                                                ) : (
                                                                    <span>{projectStatsById.has(project.id) ? '统计暂不可用' : '正在读取统计…'}</span>
                                                                )}
                                                                <span>{timestampLabel}</span>
                                                            </div>
                                                            {inboxIdeaCount > 0 && (
                                                                <button
                                                                    type="button"
                                                                    className="project-list-inbox-link"
                                                                    onClick={event => {
                                                                        event.stopPropagation()
                                                                        openDashboardTarget({
                                                                            type: 'idea',
                                                                            id: 'project-inbox',
                                                                            projectId: project.id,
                                                                            title: '待整理灵感',
                                                                            subtitle: project.name,
                                                                        })
                                                                    }}
                                                                >
                                                                    <span>{formatProjectStatCount(inboxIdeaCount)} 条灵感待整理</span>
                                                                    <span aria-hidden="true">→</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                    variant="shadow"
                                                    hoverable
                                                    contentAreaRatio={0.58}
                                                />
                                            </div>
                                        )
                                    })
                                )}
                                <Card
                                    className="project-list-create-card"
                                    title="创建一个新世界"
                                    description="从基础结构开始，稍后再补细节"
                                    extraInfo={<span className="project-list-create-card__plus" aria-hidden="true">＋</span>}
                                    variant="outline"
                                    hoverable
                                    role="button"
                                    tabIndex={0}
                                    aria-label="创建一个新世界"
                                    onClick={() => setCreatorOpen(true)}
                                    onKeyDown={event => {
                                        if (event.key !== 'Enter' && event.key !== ' ') return
                                        event.preventDefault()
                                        setCreatorOpen(true)
                                    }}
                                />
                            </div>
                        ) : null}
                        {projectPageCount > 1 && (
                            <nav className="project-list-pagination" aria-label="世界列表分页">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={currentProjectPage === 1}
                                    onClick={() => setProjectPage(page => Math.max(1, page - 1))}
                                >
                                    上一页
                                </Button>
                                <span aria-live="polite">{currentProjectPage} / {projectPageCount}</span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={currentProjectPage === projectPageCount}
                                    onClick={() => setProjectPage(page => Math.min(projectPageCount, page + 1))}
                                >
                                    下一页
                                </Button>
                            </nav>
                        )}
                    </section>
                    {(activeHomeTip || dashboard.helpLinks.length > 0) && (
                        <section className="project-home-help-strip" aria-label="帮助与技巧">
                            <span className="project-home-help-strip__icon" aria-hidden="true">?</span>
                            <div className="project-home-help-strip__content">
                                {activeHomeTip && <p>技巧：{activeHomeTip}</p>}
                                <div className="project-home-help-links">
                                    {dashboard.helpLinks.map(link => (
                                        <Button key={link.key} type="button" size="sm" variant="ghost" onClick={() => openDashboardTarget(link.target)}>
                                            {link.title}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                            {HOME_TIPS.length > 1 && (
                                <Button type="button" size="sm" variant="ghost" onClick={() => setTipIndex(index => index + 1)}>
                                    换一条
                                </Button>
                            )}
                        </section>
                    )}
                        </>
                    )}
                </div>
            </RollingBox>
        </>
    )
}

export default memo(ProjectList)
