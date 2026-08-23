/**
 * 移动端公共首页：汇总最近词条、全局灵感速记和世界列表。
 * 项目内部报告与工具状态留在对应世界页面，本页只负责跨项目返回和进入。
 */
import {
    type FormEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {Button, Card, Input, useAlert} from 'flowcloudai-ui'
import {
    db_count_entries,
    db_create_idea_note,
    db_get_entry,
    db_get_project,
    formatApiError,
    type Entry,
    type FcworldImportResult,
    type Project,
    toApiError,
} from '../../../api'
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
    useHomeDashboard,
} from '../../../features/home/homeActivity'
import HomeContinueCoverImage from '../../../features/home/HomeContinueCoverImage'
import {refreshIdeas} from '../../../features/ideas/ideaStore'
import FcworldProgressDialog from '../../../features/projects/components/FcworldProgressDialog'
import ProjectCoverImage from '../../../features/projects/components/ProjectCoverImage'
import ProjectCreator from '../../../features/projects/components/ProjectCreator'
import ProjectImportConflictDialog from '../../../features/projects/components/ProjectImportConflictDialog'
import {useProjectImportController} from '../../../features/projects/hooks/useProjectImportController'
import ProjectDefaultCover from '../../../features/projects/ProjectDefaultCover'
import {invalidateProjectList, useProjectListStore} from '../../../features/projects/projectListStore'
import {parseProjectDateMs} from '../../../features/projects/projectDisplay'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import {type MobilePage} from '../usePageStack'
import {type MobileBeforeLeave} from '../mobileBackNavigation'
import {type MobileTab} from '../MobileNav'
import {
    MobileAddIcon,
    MobileAnchoredMenu,
    MobileMoreIcon,
    MobilePageTopBar,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import {
    collectDashboardTargets,
    FilterCheckIcon,
    FilterImportIcon,
    formatRelativeTime,
    MobileHomeContinueCard,
    renderDisplayIcon,
    WORLD_DISPLAY_OPTIONS,
    WORLD_SORT_DETAILS,
    WORLD_SORT_OPTIONS,
    type WorldDisplayMode,
    type WorldSortMode,
} from './MobileHomeUi'
import './MobileHome.css'

const WORLD_PAGE_SIZE = 4

interface Props {
    push: (page: MobilePage) => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    setAiFocus: (focus: AiFocus) => void
    setBeforeLeave: (handler: MobileBeforeLeave | null) => void
}

export default function MobileHome({
    push,
    navigateToTab,
    setAiFocus,
    setBeforeLeave,
}: Props) {
    const {showAlert} = useAlert()
    const {
        projects,
        loading,
        error,
        hasLoaded: hasLoadedProjects,
        refresh: refreshProjects,
    } = useProjectListStore()
    const homeRef = useRef<HTMLDivElement | null>(null)
    const worldActionsRef = useRef<HTMLDivElement | null>(null)
    const ideaComposingRef = useRef(false)

    const dashboard = useHomeDashboard()
    const [entryCounts, setEntryCounts] = useState<Record<string, number>>({})
    const [countsError, setCountsError] = useState<string | null>(null)
    const [entryByTargetKey, setEntryByTargetKey] = useState<Map<string, Entry>>(() => new Map())
    const [invalidHomeTargetKeys, setInvalidHomeTargetKeys] = useState<Set<string>>(() => new Set())
    const [pendingEntryTargetKeys, setPendingEntryTargetKeys] = useState<Set<string>>(() => new Set())
    const [searchText, setSearchText] = useState('')
    const [displayMode, setDisplayMode] = useState<WorldDisplayMode>('card')
    const [sortMode, setSortMode] = useState<WorldSortMode>('updated-desc')
    const [worldPage, setWorldPage] = useState(1)
    const [filterOpen, setFilterOpen] = useState(false)
    const [creatorOpen, setCreatorOpen] = useState(false)
    const [ideaText, setIdeaText] = useState('')
    const [ideaSaving, setIdeaSaving] = useState(false)

    useEffect(() => {
        if (!filterOpen) return undefined
        setBeforeLeave((intent) => {
            // 返回键收起菜单并留在首页；切换 Tab 时页面会整体卸载，不拦截。
            if (intent !== 'back') return true
            setFilterOpen(false)
            return false
        })
        return () => setBeforeLeave(null)
    }, [filterOpen, setBeforeLeave])

    const projectIdSet = useMemo(() => new Set(projects.map(project => project.id)), [projects])

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
                if (projectId) missingProjectIds.add(projectId)
                else removeHomeActivityTarget(target)
                continue
            }

            if (target.type !== 'entry') continue
            const entryId = getHomeTargetEntryId(target)
            if (!projectId || !entryId) {
                invalidKeys.add(key)
                removeHomeActivityTarget(target)
                continue
            }
            entryTargets.push({key, projectId, entryId, target})
        }

        if (invalidKeys.size > 0) {
            setInvalidHomeTargetKeys(previous => new Set([...previous, ...invalidKeys]))
        }
        for (const projectId of missingProjectIds) removeHomeProjectActivity(projectId)
        if (entryTargets.length === 0) return

        const validationKeys = new Set(entryTargets.map(item => item.key))
        setPendingEntryTargetKeys(previous => new Set([...previous, ...validationKeys]))

        let cancelled = false
        void (async () => {
            const validEntries = new Map<string, Entry>()
            const invalidEntryKeys = new Set<string>()

            await Promise.all(entryTargets.map(async item => {
                try {
                    const entry = await db_get_entry(item.entryId, item.projectId)
                    if (entry.project_id !== item.projectId) {
                        invalidEntryKeys.add(item.key)
                        removeHomeActivityTarget(item.target)
                        return
                    }
                    validEntries.set(item.key, entry)
                } catch {
                    invalidEntryKeys.add(item.key)
                    removeHomeEntryActivity(item.projectId, item.entryId)
                }
            }))

            if (cancelled) return
            setPendingEntryTargetKeys(previous => {
                const next = new Set(previous)
                for (const key of validationKeys) next.delete(key)
                return next
            })
            setEntryByTargetKey(previous => {
                const next = new Map(previous)
                for (const key of invalidEntryKeys) next.delete(key)
                for (const [key, entry] of validEntries) next.set(key, entry)
                return next
            })
            setInvalidHomeTargetKeys(previous => {
                const next = new Set(previous)
                for (const key of validEntries.keys()) next.delete(key)
                for (const key of invalidEntryKeys) next.add(key)
                return next
            })
        })()

        return () => {
            cancelled = true
        }
    }, [dashboard, hasLoadedProjects, projectIdSet])

    const isVisibleHomeTarget = useCallback((target: HomeActivityTarget) => {
        const key = getHomeActivityTargetKey(target)
        if (invalidHomeTargetKeys.has(key)) return false
        if (hasLoadedProjects && isHomeProjectBackedTarget(target)) {
            const projectId = getHomeTargetProjectId(target)
            if (!projectId || !projectIdSet.has(projectId)) return false
        }
        if (target.type === 'entry') {
            if (pendingEntryTargetKeys.has(key)) return false
            return entryByTargetKey.has(key)
        }
        return true
    }, [entryByTargetKey, hasLoadedProjects, invalidHomeTargetKeys, pendingEntryTargetKeys, projectIdSet])

    const visibleRecentItems = useMemo(() => (
        dashboard.recentItems.filter(item => isVisibleHomeTarget(item))
    ), [dashboard.recentItems, isVisibleHomeTarget])

    const continueItem = useMemo(() => {
        if (dashboard.continueItem?.type === 'entry' && isVisibleHomeTarget(dashboard.continueItem)) {
            return dashboard.continueItem
        }
        return visibleRecentItems.find(item => item.type === 'entry') ?? null
    }, [dashboard.continueItem, isVisibleHomeTarget, visibleRecentItems])

    const continueProject = useMemo(() => {
        if (!continueItem) return null
        const projectId = getHomeTargetProjectId(continueItem)
        return projects.find(project => project.id === projectId) ?? null
    }, [continueItem, projects])

    const continueEntry = useMemo(() => {
        if (!continueItem) return null
        return entryByTargetKey.get(getHomeActivityTargetKey(continueItem)) ?? null
    }, [continueItem, entryByTargetKey])

    const continueLastOpenedAt = useMemo(() => {
        if (!continueItem) return null
        const key = getHomeActivityTargetKey(continueItem)
        if (dashboard.lastSession?.target && getHomeActivityTargetKey(dashboard.lastSession.target) === key) {
            return dashboard.lastSession.savedAt
        }
        return dashboard.recentItems.find(item => item.key === key)?.lastOpenedAt
            ?? continueItem.updatedAt
            ?? null
    }, [continueItem, dashboard.lastSession, dashboard.recentItems])

    const recentEntryByProject = useMemo(() => {
        const result = new Map<string, HomeActivityRecord>()
        for (const item of visibleRecentItems) {
            if (item.type !== 'entry') continue
            const projectId = getHomeTargetProjectId(item)
            if (projectId && !result.has(projectId)) result.set(projectId, item)
        }
        return result
    }, [visibleRecentItems])

    const worldProjects = useMemo(() => {
        const query = searchText.trim().toLowerCase()
        return projects
            .filter(project => (
                !query
                || project.name.toLowerCase().includes(query)
                || (project.description ?? '').toLowerCase().includes(query)
            ))
            .sort((a, b) => {
                const nameOrder = a.name.localeCompare(b.name, 'zh-CN')
                switch (sortMode) {
                    case 'created-desc':
                        return parseProjectDateMs(b.created_at) - parseProjectDateMs(a.created_at) || nameOrder
                    case 'name-asc':
                        return nameOrder
                    case 'updated-desc':
                    default:
                        return parseProjectDateMs(b.updated_at ?? b.created_at) - parseProjectDateMs(a.updated_at ?? a.created_at) || nameOrder
                }
            })
    }, [projects, searchText, sortMode])

    const worldPageCount = Math.max(1, Math.ceil(worldProjects.length / WORLD_PAGE_SIZE))
    const currentWorldPage = Math.min(worldPage, worldPageCount)
    const paginatedWorldProjects = useMemo(() => {
        const start = (currentWorldPage - 1) * WORLD_PAGE_SIZE
        return worldProjects.slice(start, start + WORLD_PAGE_SIZE)
    }, [currentWorldPage, worldProjects])

    useEffect(() => {
        if (worldPage !== currentWorldPage) setWorldPage(currentWorldPage)
    }, [currentWorldPage, worldPage])

    useEffect(() => {
        if (paginatedWorldProjects.length === 0) {
            if (projects.length === 0) setEntryCounts({})
            setCountsError(null)
            return
        }

        let cancelled = false
        setCountsError(null)
        void Promise.all(
            paginatedWorldProjects.map(async project => [
                project.id,
                await db_count_entries({projectId: project.id}),
            ] as const),
        ).then(counts => {
            if (!cancelled) setEntryCounts(previous => ({...previous, ...Object.fromEntries(counts)}))
        }).catch(countError => {
            if (!cancelled) setCountsError(formatApiError(toApiError(countError)))
        })
        return () => {
            cancelled = true
        }
    }, [paginatedWorldProjects, projects.length])

    const loadingWorlds = loading && projects.length === 0
    const worldError = error ?? countsError
    const retryWorlds = useCallback(() => {
        void refreshProjects()
    }, [refreshProjects])

    const handleOpenProject = useCallback((project: Project) => {
        setAiFocus({projectId: project.id, entryId: null})
        push({type: 'projectHome', params: {projectId: project.id, displayName: project.name}})
    }, [push, setAiFocus])

    const openDashboardTarget = useCallback((target: HomeActivityTarget) => {
        const projectId = getHomeTargetProjectId(target)
        if (hasLoadedProjects && isHomeProjectBackedTarget(target) && (!projectId || !projectIdSet.has(projectId))) {
            if (projectId) removeHomeProjectActivity(projectId)
            else removeHomeActivityTarget(target)
            void showAlert('这个首页入口指向的内容已不存在，已从首页移除。', 'warning', 'nonInvasive', 3000)
            return
        }

        if (target.type === 'project') {
            const targetProjectId = target.projectId ?? target.id
            const project = projects.find(item => item.id === targetProjectId)
            if (project) {
                handleOpenProject(project)
                return
            }
        }

        if (target.type === 'entry') {
            const targetProjectId = getHomeTargetProjectId(target)
            const targetEntryId = getHomeTargetEntryId(target)
            if (targetProjectId && targetEntryId) {
                setAiFocus({projectId: targetProjectId, entryId: targetEntryId})
                push({
                    type: 'entryDetail',
                    params: {
                        projectId: targetProjectId,
                        entryId: targetEntryId,
                        displayName: target.title || '词条',
                    },
                })
                return
            }
        }

        if (target.type === 'idea') {
            navigateToTab('ideas')
            return
        }
        if (target.type === 'conversation') {
            navigateToTab('ai')
            return
        }
        void showAlert(target.description || '该入口暂未接入移动端。', 'info', 'nonInvasive', 2600)
    }, [handleOpenProject, hasLoadedProjects, navigateToTab, projectIdSet, projects, push, setAiFocus, showAlert])

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
        } catch (ideaError) {
            await showAlert(`保存灵感失败：${formatApiError(toApiError(ideaError))}`, 'error', 'nonInvasive', 3000)
        } finally {
            setIdeaSaving(false)
        }
    }, [ideaSaving, ideaText, showAlert])

    const openImportedProject = useCallback(async (result: FcworldImportResult) => {
        await invalidateProjectList()
        const project = await db_get_project(result.projectId)
        handleOpenProject(project)
    }, [handleOpenProject])

    const handleImportError = useCallback(
        (importError: unknown) => showAlert(`导入世界失败：${formatApiError(toApiError(importError))}`, 'error', 'nonInvasive', 3200),
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

    const handleHelp = useCallback(() => {
        void showAlert('首页只保留跨世界的继续创作、灵感速记和世界入口；项目报告请进入对应世界查看。', 'info', 'nonInvasive', 3000)
    }, [showAlert])

    const renderWorldCard = (project: Project) => {
        const entryCount = entryCounts[project.id]
        const countLabel = entryCount == null ? '词条统计中' : `${entryCount} 个词条`
        const updatedLabel = formatRelativeTime(project.updated_at ?? project.created_at)
        const recentEntry = recentEntryByProject.get(project.id)
        const recentLabel = recentEntry ? `${updatedLabel} · ${recentEntry.title}` : updatedLabel

        if (displayMode === 'list') {
            return (
                <button
                    type="button"
                    className="mobile-list-card mobile-home-world-list-card"
                    key={project.id}
                    onClick={() => handleOpenProject(project)}
                >
                    <span className="mobile-list-card__title">{project.name}</span>
                    <span className="mobile-list-card__description">{project.description || recentLabel}</span>
                    <span className="mobile-list-card__meta">{countLabel} · {updatedLabel}</span>
                </button>
            )
        }

        return (
            <Card
                key={project.id}
                className="mobile-page__card mobile-home-world-card"
                title={project.name}
                description={countLabel}
                imageSlot={project.cover_path ? (
                    <ProjectCoverImage
                        projectId={project.id}
                        coverPath={project.cover_path}
                        alt={project.name}
                        fallback={<ProjectDefaultCover projectId={project.id} projectName={project.name}/>}
                    />
                ) : (
                    <ProjectDefaultCover projectId={project.id} projectName={project.name}/>
                )}
                imageHeight="11.25rem"
                contentAreaRatio={0.46}
                overlayStartOpacity={0.06}
                overlayEndOpacity={0.94}
                extraInfo={recentEntry ? (
                    <button
                        type="button"
                        className="mobile-home-world-card__recent"
                        onClick={event => {
                            event.stopPropagation()
                            openDashboardTarget(recentEntry)
                        }}
                        onKeyDown={event => event.stopPropagation()}
                    >
                        {recentLabel}
                    </button>
                ) : <span className="mobile-home-world-card__recent">{recentLabel}</span>}
                variant="shadow"
                hoverable
                role="button"
                tabIndex={0}
                aria-label={`打开世界：${project.name}`}
                onClick={() => handleOpenProject(project)}
                onKeyDown={event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    handleOpenProject(project)
                }}
            />
        )
    }

    const topActions = (
        <MobileTopActionPill
            ref={worldActionsRef}
            actions={[
                {
                    key: 'create',
                    label: '新建世界观',
                    icon: <MobileAddIcon/>,
                    kind: 'add',
                    onClick: () => setCreatorOpen(true),
                },
                {
                    key: 'filter',
                    label: '世界列表操作',
                    icon: <MobileMoreIcon/>,
                    kind: 'more',
                    ariaHasPopup: 'menu',
                    ariaExpanded: filterOpen,
                    onClick: () => setFilterOpen(open => !open),
                },
            ]}
        />
    )

    return (
        <div ref={homeRef} className="mobile-page mobile-home">
            <ProjectCreator
                open={creatorOpen}
                onClose={() => setCreatorOpen(false)}
                onCreated={handleOpenProject}
                existingNames={projects.map(project => project.name)}
            />
            <ProjectImportConflictDialog
                open={Boolean(importConflict)}
                preview={importConflict}
                existingNames={projects.map(project => project.name)}
                busy={importing}
                onCancel={handleImportConflictCancel}
                onRename={projectName => void handleImportConflictRename(projectName)}
                onOverwrite={() => void handleImportConflictOverwrite()}
            />
            <FcworldProgressDialog progress={fcworldProgress}/>

            <MobilePageTopBar
                sticky
                edgeToEdge
                className="mobile-home__topbar"
                ariaLabel="首页操作"
                left={<h1 className="mobile-page__hero-title mobile-home__title">首页</h1>}
                right={topActions}
            />

            <main className="mobile-home__content">
                {continueItem ? (
                    <section aria-label="继续创作">
                        <MobileHomeContinueCard
                            continueItem={continueItem}
                            projectName={continueProject?.name ?? continueItem.subtitle ?? null}
                            lastOpenedAt={continueLastOpenedAt}
                            imageSlot={(
                                <HomeContinueCoverImage
                                    target={continueItem}
                                    project={continueProject}
                                    entry={continueEntry}
                                    eager
                                />
                            )}
                            onOpenTarget={openDashboardTarget}
                        />
                    </section>
                ) : null}

                <section aria-label="灵感速记">
                    <form className="mobile-home__idea-form" onSubmit={event => void handleIdeaSubmit(event)}>
                        <Input
                            value={ideaText}
                            placeholder="想到什么直接写…"
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
                        <Button type="submit" size="sm" variant="ghost" disabled={ideaSaving}>
                            {ideaSaving ? '保存中…' : '存入'}
                        </Button>
                    </form>
                </section>

                <section className="mobile-home-worlds" aria-labelledby="mobileHomeWorldsTitle">
                    <div className="mobile-home-worlds__head">
                        <h2 id="mobileHomeWorldsTitle">我的世界</h2>
                        <span>{loadingWorlds ? '正在同步' : `${worldProjects.length} 个`}</span>
                    </div>

                    {projects.length > WORLD_PAGE_SIZE || searchText ? (
                        <Input
                            placeholder="搜索世界"
                            aria-label="搜索世界"
                            value={searchText}
                            onValueChange={value => {
                                setSearchText(value)
                                setWorldPage(1)
                            }}
                            className="mobile-home-worlds__search"
                            radius="full"
                            allowClear
                        />
                    ) : null}

                    {worldError && projects.length === 0 ? (
                        <div className="mobile-page__error" role="alert">
                            <span>加载失败：{worldError}</span>
                            <Button type="button" size="sm" variant="outline" onClick={retryWorlds}>重试</Button>
                        </div>
                    ) : loadingWorlds ? (
                        <div className="mobile-page__loading mobile-home__state-panel">加载中…</div>
                    ) : projects.length === 0 ? (
                        <div className="mobile-page__empty mobile-home__state-panel">
                            <p>还没有世界。使用右上角“+”新建，或从更多菜单导入。</p>
                        </div>
                    ) : worldProjects.length === 0 ? (
                        <div className="mobile-page__empty mobile-home__state-panel">没有匹配的世界</div>
                    ) : (
                        <>
                            {worldError ? (
                                <div className="mobile-page__error-banner" role="alert">
                                    <span>部分词条统计暂不可用：{worldError}</span>
                                </div>
                            ) : null}
                            <div
                                className={`mobile-home-worlds__grid mobile-home-worlds__grid--${displayMode}${worldPageCount > 1 ? ' mobile-home-worlds__grid--paged' : ''}`}
                            >
                                {paginatedWorldProjects.map(renderWorldCard)}
                            </div>
                            {worldPageCount > 1 ? (
                                <nav className="mobile-home-worlds__pagination" aria-label="世界列表分页">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={currentWorldPage === 1}
                                        onClick={() => setWorldPage(page => Math.max(1, page - 1))}
                                    >
                                        上一页
                                    </Button>
                                    <span aria-live="polite">{currentWorldPage} / {worldPageCount}</span>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={currentWorldPage === worldPageCount}
                                        onClick={() => setWorldPage(page => Math.min(worldPageCount, page + 1))}
                                    >
                                        下一页
                                    </Button>
                                </nav>
                            ) : null}
                        </>
                    )}
                </section>

                <section className="mobile-home__tip" aria-label="使用技巧">
                    <p>在正文中输入 [[ 可以链接到另一个词条，对方会自动显示反向引用。</p>
                    <button type="button" onClick={handleHelp}>帮助中心</button>
                </section>
            </main>

            <MobileAnchoredMenu
                open={filterOpen}
                onClose={() => setFilterOpen(false)}
                anchorRef={worldActionsRef}
                containerRef={homeRef}
                ariaLabel="世界列表显示与排序"
            >
                <div className="mobile-anchored-menu__group" aria-label="显示方式">
                    {WORLD_DISPLAY_OPTIONS.map(option => {
                        const active = displayMode === option.key
                        return (
                            <button
                                key={option.key}
                                type="button"
                                role="menuitemradio"
                                aria-checked={active}
                                className={`mobile-anchored-menu__row${active ? ' is-active' : ''}`}
                                onClick={() => {
                                    setDisplayMode(option.key)
                                    setWorldPage(1)
                                    setFilterOpen(false)
                                }}
                            >
                                <span className="mobile-anchored-menu__check" aria-hidden="true">
                                    {active ? <FilterCheckIcon/> : null}
                                </span>
                                <span className="mobile-anchored-menu__icon" aria-hidden="true">
                                    {renderDisplayIcon(option.key)}
                                </span>
                                <span className="mobile-anchored-menu__text">
                                    <span>{option.label}</span>
                                    <small>{option.desc}</small>
                                </span>
                            </button>
                        )
                    })}
                </div>
                <div className="mobile-home-filter__divider" role="separator"/>
                <div className="mobile-anchored-menu__group" aria-label="排序方式">
                    {WORLD_SORT_OPTIONS.map(option => {
                        const active = sortMode === option.key
                        return (
                            <button
                                key={option.key}
                                type="button"
                                role="menuitemradio"
                                aria-checked={active}
                                className={`mobile-anchored-menu__row${active ? ' is-active' : ''}`}
                                onClick={() => {
                                    setSortMode(option.key)
                                    setWorldPage(1)
                                    setFilterOpen(false)
                                }}
                            >
                                <span className="mobile-anchored-menu__check" aria-hidden="true">
                                    {active ? <FilterCheckIcon/> : null}
                                </span>
                                <span className="mobile-anchored-menu__icon" aria-hidden="true"/>
                                <span className="mobile-anchored-menu__text">
                                    <span>{option.label}</span>
                                    <small>{WORLD_SORT_DETAILS[option.key]}</small>
                                </span>
                            </button>
                        )
                    })}
                </div>
                <div className="mobile-home-filter__divider" role="separator"/>
                <div className="mobile-anchored-menu__group" aria-label="列表操作">
                    <button
                        type="button"
                        role="menuitem"
                        className="mobile-anchored-menu__row"
                        disabled={importing}
                        onClick={() => {
                            setFilterOpen(false)
                            void handleImportProject()
                        }}
                    >
                        <span className="mobile-anchored-menu__check" aria-hidden="true"/>
                        <span className="mobile-anchored-menu__icon" aria-hidden="true">
                            <FilterImportIcon/>
                        </span>
                        <span className="mobile-anchored-menu__text">
                            <span>{importing ? '导入中…' : '导入世界'}</span>
                            <small>从 .fcworld 文件导入</small>
                        </span>
                    </button>
                </div>
            </MobileAnchoredMenu>
        </div>
    )
}
