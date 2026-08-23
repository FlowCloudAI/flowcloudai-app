import {logger} from '../../../shared/logger'
import {useCallback, useRef, useState} from 'react'
import {Button, useAlert} from 'flowcloudai-ui'
import {saveFileDialog} from '../../../api/dialog'
import {
    db_create_entry,
    db_delete_project,
    db_export_project_fcworld,
    db_update_project,
    formatApiError,
    toApiError,
} from '../../../api'
import {type MobilePage, type MobileProjectPageParams} from '../usePageStack'
import {useMobilePageScrollMemory} from '../useMobilePageScrollMemory'
import {type MobileTab} from '../MobileNav'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import {FloatingPanel, RenameDialog} from '../../../shared/ui/overlay'
import {
    MobileAnchoredActionMenu,
    type MobileAnchoredMenuItem,
    MobileAddIcon,
    MobileBackIcon,
    MobileMenuIcon,
    MobileMoreIcon,
    MobilePageTopBar,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import ProjectCoverPickerModal from '../../../features/project-editor/components/ProjectCoverPicker/ProjectCoverPickerModal'
import {invalidateProjectContext, useProjectContextStore} from '../../../features/projects/projectContextStore'
import {patchProjectDetail, useProjectDetailStore} from '../../../features/projects/projectDetailStore'
import {invalidateProjectList} from '../../../features/projects/projectListStore'
import FcworldProgressDialog from '../../../features/projects/components/FcworldProgressDialog'
import {useFcworldProgress} from '../../../features/projects/hooks/useFcworldProgress'
import {buildProjectExportFileName, toProjectImageSrc} from '../../../features/projects/projectDisplay'
import {
    ProjectHomeHero,
    ProjectHomePrimaryActions,
    ProjectHomeResourceList,
    type ProjectHomeStatItem,
    ProjectHomeToolGrid,
    type ProjectHomeTool,
} from './MobileProjectHomeSections'
import './MobileProjectHome.css'

interface Props {
    push: (page: MobilePage) => void
    pop: () => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    aiFocus: AiFocus
    setAiFocus: (focus: AiFocus) => void
    pageKey: string
    categoryDrawerOpen?: boolean
    onOpenCategoryDrawer?: () => void
    params: MobileProjectPageParams
}

function formatNumber(value?: number | null): string {
    return (value ?? 0).toLocaleString('zh-CN')
}

function ProjectMenuIcon({type}: {type: 'rename' | 'description' | 'cover' | 'export' | 'delete'}) {
    if (type === 'rename') {
        return (
            <svg className="mobile-top-control-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M4.5 16.5 15.8 5.2a2.1 2.1 0 0 1 3 3L7.5 19.5h-3Z"/>
                <path d="m14 7 3 3"/>
            </svg>
        )
    }
    if (type === 'description') {
        return (
            <svg className="mobile-top-control-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M6 5.5h12"/>
                <path d="M6 10h12"/>
                <path d="M6 14.5h8"/>
                <path d="M6 19h5"/>
            </svg>
        )
    }
    if (type === 'cover') {
        return (
            <svg className="mobile-top-control-svg" viewBox="0 0 24 24" focusable="false">
                <rect x="4" y="5" width="16" height="14" rx="2.5"/>
                <path d="m7 16 3.5-3.5 2.5 2.5 2-2 3 3"/>
                <path d="M8.5 9.5h.1"/>
            </svg>
        )
    }
    if (type === 'export') {
        return (
            <svg className="mobile-top-control-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M12 4v10"/>
                <path d="m8 10 4 4 4-4"/>
                <path d="M5 18.5h14"/>
            </svg>
        )
    }
    return (
        <svg className="mobile-top-control-svg" viewBox="0 0 24 24" focusable="false">
            <path d="M5.5 7h13"/>
            <path d="M9 7V5.5h6V7"/>
            <path d="M8 10v8"/>
            <path d="M12 10v8"/>
            <path d="M16 10v8"/>
            <path d="M7 7.5 8 20h8l1-12.5"/>
        </svg>
    )
}

export default function MobileProjectHome({
    push,
    pop,
    navigateToTab,
    setAiFocus,
    pageKey,
    categoryDrawerOpen = false,
    onOpenCategoryDrawer,
    params,
}: Props) {
    const projectId = params.projectId
    // 复用已有的 pageRef（它同时作为浮层的 containerRef），不另挂一个 ref。
    const pageRef = useRef<HTMLDivElement>(null)
    const topActionsRef = useRef<HTMLDivElement>(null)
    const {showAlert} = useAlert()
    const {progress: fcworldProgress, startProgress, closeProgress, finishProgress} = useFcworldProgress()
    const [menuOpen, setMenuOpen] = useState(false)
    const [renameOpen, setRenameOpen] = useState(false)
    const [renaming, setRenaming] = useState(false)
    const [coverOpen, setCoverOpen] = useState(false)
    const [descriptionOpen, setDescriptionOpen] = useState(false)
    const [descriptionDraft, setDescriptionDraft] = useState('')
    const [descriptionSaving, setDescriptionSaving] = useState(false)
    const [descriptionError, setDescriptionError] = useState<string | null>(null)
    const [actionError, setActionError] = useState<string | null>(null)
    const [exporting, setExporting] = useState(false)
    const projectDetail = useProjectDetailStore(projectId)
    const project = projectDetail.project
    const entryTypes = projectDetail.entryTypes
    const tagSchemas = projectDetail.tagSchemas
    const projectContext = useProjectContextStore(projectId)
    const categories = projectContext.categories
    const stats = projectContext.stats
    const loadError = projectDetail.error ?? projectContext.error
    const retryLoad = useCallback(() => {
        void Promise.all([projectDetail.refresh(), projectContext.refresh()])
    }, [projectContext, projectDetail])

    const handleCreateEntry = useCallback(async (categoryId: string | null) => {
        setActionError(null)
        try {
            const created = await db_create_entry({
                projectId,
                categoryId,
                title: '未命名词条',
            })
            void invalidateProjectContext(projectId)
            setAiFocus({projectId, entryId: created.id})
            push({type: 'entryDetail', params: {projectId, entryId: created.id, displayName: '未命名词条', mode: 'edit'}})
        } catch (e) {
            logger.error('新建词条失败', e)
            setActionError(`新建词条失败：${formatApiError(toApiError(e))}`)
        }
    }, [projectId, push, setAiFocus])

    const handleOpenEntryList = useCallback((categoryId: string | null, categoryName: string) => {
        push({type: 'entryList', params: {projectId, categoryId: categoryId ?? '', displayName: categoryName}})
    }, [projectId, push])

    const handleOpenAi = useCallback(() => {
        setAiFocus({projectId, entryId: null})
        navigateToTab('ai')
    }, [navigateToTab, projectId, setAiFocus])

    const handleSelectTool = useCallback((tool: ProjectHomeTool) => {
        if (tool.disabled) return
        if (tool.key === 'relation') {
            push({type: 'relationGraph', params: {projectId, displayName: '关系图谱'}})
            return
        }
        if (tool.key === 'timeline') {
            push({type: 'timeline', params: {projectId, displayName: '时间线'}})
            return
        }
        if (tool.key === 'check') {
            push({type: 'worldCheck', params: {projectId, displayName: '设定检测'}})
            return
        }
    }, [projectId, push])

    const handleRename = useCallback(async (name: string) => {
        setRenaming(true)
        try {
            await db_update_project({id: projectId, name})
            patchProjectDetail(projectId, {name})
            invalidateProjectList()
            setRenameOpen(false)
        } catch (e) {
            await showAlert(`重命名失败：${formatApiError(toApiError(e))}`, 'error', 'nonInvasive', 3000)
        } finally {
            setRenaming(false)
        }
    }, [projectId, showAlert])

    const handleChangeCover = useCallback(async (coverPath: string | null) => {
        try {
            await db_update_project({id: projectId, coverPath})
            patchProjectDetail(projectId, {cover_path: coverPath})
            invalidateProjectList()
            setCoverOpen(false)
        } catch (e) {
            await showAlert(`更换封面失败：${formatApiError(toApiError(e))}`, 'error', 'nonInvasive', 3000)
        }
    }, [projectId, showAlert])

    const handleOpenDescription = useCallback(() => {
        setDescriptionDraft(project?.description ?? '')
        setDescriptionError(null)
        setDescriptionOpen(true)
    }, [project?.description])

    const handleSaveDescription = useCallback(async () => {
        setDescriptionSaving(true)
        setDescriptionError(null)
        try {
            const description = descriptionDraft.trim() || null
            const updated = await db_update_project({id: projectId, description})
            patchProjectDetail(projectId, {description: updated.description ?? null})
            invalidateProjectList()
            setDescriptionOpen(false)
        } catch (e) {
            setDescriptionError(`保存描述失败：${formatApiError(toApiError(e))}`)
        } finally {
            setDescriptionSaving(false)
        }
    }, [descriptionDraft, projectId])

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
        } catch (e) {
            closeProgress()
            await showAlert(`导出世界失败：${formatApiError(toApiError(e))}`, 'error', 'nonInvasive', 3200)
        } finally {
            setExporting(false)
        }
    }, [closeProgress, exporting, finishProgress, project, projectId, showAlert, startProgress])

    const handleDeleteProject = useCallback(async () => {
        const result = await showAlert(
            `确定删除项目「${project?.name ?? ''}」？将永久删除其中所有词条、分类与图片，且不可撤销。`,
            'warning',
            'confirm',
        )
        if (result !== 'yes') return
        try {
            await db_delete_project(projectId)
            invalidateProjectList()
            pop()
        } catch (e) {
            await showAlert(`删除项目失败：${formatApiError(toApiError(e))}`, 'error', 'nonInvasive', 3000)
        }
    }, [project, projectId, pop, showAlert])

    // 加载态返回的是 .mobile-page__loading，此时 pageRef 还没挂上真正的滚动容器，
    // 所以滚动记忆要等它就绪后再接（hook 必须无条件调用，故放在提前 return 之前）。
    const pageIsLoading = (projectDetail.loading && !projectDetail.hasLoaded)
        || (projectContext.loading && !projectContext.hasLoaded)
    useMobilePageScrollMemory(pageKey, pageRef, !pageIsLoading)

    if (pageIsLoading) {
        return <div className="mobile-page__loading">加载中…</div>
    }
    if (!project && loadError) return <div className="mobile-page__error" role="alert">
        <span>项目加载失败：{loadError}</span>
        <Button type="button" size="sm" variant="outline" onClick={retryLoad}>重试</Button>
    </div>
    if (!project) return <div className="mobile-page__error">项目不存在</div>

    const image = toProjectImageSrc(project.cover_path)
    const entryCount = stats?.entryCount ?? 0
    const imageCount = stats?.imageCount ?? 0
    const wordCount = stats?.wordCount ?? 0
    const relationCount = stats?.relationCount ?? 0
    const internalLinkCount = stats?.internalLinkCount ?? 0
    const categoryCount = categories.length
    const customTypeCount = entryTypes.filter(type => type.kind === 'custom').length
    const statItems: ProjectHomeStatItem[] = [
        {key: 'entries', label: '词条', value: formatNumber(entryCount)},
        {key: 'categories', label: '分类', value: formatNumber(categoryCount)},
        {key: 'types', label: '类型', value: formatNumber(entryTypes.length)},
        {key: 'tags', label: '标签', value: formatNumber(tagSchemas.length)},
        {key: 'images', label: '图片', value: formatNumber(imageCount)},
        {key: 'words', label: '字数', value: formatNumber(wordCount)},
    ]
    const advancedTools: ProjectHomeTool[] = [
        {key: 'relation', label: '关系图谱', meta: `${formatNumber(relationCount)} 关系`},
        {key: 'timeline', label: '时间线', meta: '时序'},
        {key: 'map', label: '世界地图', meta: '地图', disabled: true, unavailableReason: '仅桌面端'},
        {key: 'check', label: '设定检测', meta: internalLinkCount > 0 ? `${formatNumber(internalLinkCount)} 内链` : '质检'},
    ]
    const projectMenuItems: MobileAnchoredMenuItem[] = [
        {
            key: 'rename',
            label: '重命名',
            description: '修改世界名称',
            icon: <ProjectMenuIcon type="rename"/>,
            onSelect: () => setRenameOpen(true),
        },
        {
            key: 'description',
            label: '编辑描述',
            description: '记录项目简介',
            icon: <ProjectMenuIcon type="description"/>,
            onSelect: handleOpenDescription,
        },
        {
            key: 'cover',
            label: '换封面',
            description: '设置顶部封面',
            icon: <ProjectMenuIcon type="cover"/>,
            onSelect: () => setCoverOpen(true),
        },
        {
            key: 'export',
            label: exporting ? '导出中…' : '导出 .fcworld',
            description: '保存到本地文件',
            icon: <ProjectMenuIcon type="export"/>,
            disabled: exporting,
            onSelect: () => void handleExportProject(),
        },
        {
            key: 'delete',
            label: '删除项目',
            description: '永久删除当前世界',
            icon: <ProjectMenuIcon type="delete"/>,
            danger: true,
            onSelect: () => void handleDeleteProject(),
        },
    ]

    return (
        <div ref={pageRef} className="mobile-page mobile-project-home">
            <MobilePageTopBar
                className="mobile-project-home__topbar"
                sticky
                edgeToEdge
                ariaLabel="项目总览操作"
                left={<MobileTopActionPill
                    actions={[
                        {
                            key: 'back',
                            label: '返回',
                            icon: <MobileBackIcon/>,
                            onClick: pop,
                        },
                        {
                            key: 'categories',
                            label: '显示分类树',
                            icon: <MobileMenuIcon/>,
                            ariaExpanded: categoryDrawerOpen,
                            onClick: () => onOpenCategoryDrawer?.(),
                        },
                    ]}
                />}
                right={<MobileTopActionPill
                    ref={topActionsRef}
                    actions={[
                        {
                            key: 'create',
                            label: '新建词条',
                            icon: <MobileAddIcon/>,
                            kind: 'add',
                            onClick: () => void handleCreateEntry(null),
                        },
                        {
                            key: 'menu',
                            label: '项目管理',
                            icon: <MobileMoreIcon/>,
                            kind: 'more',
                            ariaHasPopup: 'menu',
                            ariaExpanded: menuOpen,
                            onClick: () => setMenuOpen(open => !open),
                        },
                    ]}
                />}
            />

            {loadError && (
                <div className="mobile-page__error-banner" role="alert">
                    <span>部分项目信息刷新失败：{loadError}</span>
                    <Button type="button" size="sm" variant="outline" onClick={retryLoad}>重试</Button>
                </div>
            )}
            {actionError && (
                <div className="mobile-page__error-banner" role="alert">
                    <span>{actionError}</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => void handleCreateEntry(null)}>重试</Button>
                </div>
            )}

            <ProjectHomeHero
                projectId={project.id}
                projectName={project.name}
                description={project.description}
                image={image}
                createdAt={project.created_at}
                updatedAt={project.updated_at}
                statItems={statItems}
                onOpenDescription={handleOpenDescription}
            />

            <ProjectHomePrimaryActions
                onCreateEntry={() => void handleCreateEntry(null)}
                onOpenAi={handleOpenAi}
            />

            <ProjectHomeResourceList
                entryCount={formatNumber(entryCount)}
                customTypeCount={formatNumber(customTypeCount)}
                tagSchemaCount={formatNumber(tagSchemas.length)}
                onOpenEntries={() => handleOpenEntryList(null, '全部词条')}
                onOpenTypeManager={() => push({
                    type: 'typeManager',
                    params: {projectId, displayName: '类型管理'},
                })}
                onOpenTagManager={() => push({
                    type: 'tagManager',
                    params: {projectId, displayName: '标签管理'},
                })}
            />

            <ProjectHomeToolGrid
                tools={advancedTools}
                onSelectTool={handleSelectTool}
            />

            <MobileAnchoredActionMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                anchorRef={topActionsRef}
                containerRef={pageRef}
                ariaLabel="项目管理"
                items={projectMenuItems}
            />

            <RenameDialog
                open={renameOpen}
                title="重命名项目"
                initialValue={project.name}
                placeholder="项目名称"
                busy={renaming}
                onClose={() => setRenameOpen(false)}
                onConfirm={(name) => void handleRename(name)}
            />

            <FloatingPanel
                open={descriptionOpen}
                onClose={() => setDescriptionOpen(false)}
                dismissible={!descriptionSaving}
                title="编辑项目描述"
                ariaLabel="编辑项目描述"
                className="fc-rename-dialog"
            >
                <textarea
                    value={descriptionDraft}
                    aria-label="项目描述"
                    onChange={(event) => setDescriptionDraft(event.currentTarget.value)}
                    disabled={descriptionSaving}
                    placeholder="项目描述"
                    rows={5}
                    className="mobile-project-home__description-input"
                />
                {descriptionError && (
                    <div className="mobile-page__error-banner" role="alert">{descriptionError}</div>
                )}
                <div className="fc-rename-dialog__actions">
                    <Button type="button" variant="ghost" size="sm" radius="full" onClick={() => setDescriptionOpen(false)} disabled={descriptionSaving}>取消</Button>
                    <Button type="button" size="sm" radius="full" onClick={() => void handleSaveDescription()} disabled={descriptionSaving}>
                        {descriptionSaving ? '保存中…' : '保存'}
                    </Button>
                </div>
            </FloatingPanel>

            <ProjectCoverPickerModal
                open={coverOpen}
                projectId={projectId}
                projectName={project.name}
                currentCoverPath={project.cover_path}
                onClose={() => setCoverOpen(false)}
                onSelectCover={(coverPath) => handleChangeCover(coverPath)}
                onOpenAiSettings={(pluginId) => navigateToTab('settings', {type: 'settingsAi', params: {pluginId}})}
            />
            <FcworldProgressDialog progress={fcworldProgress} />
        </div>
    )
}
