import {useCallback, useEffect, useRef, useState} from 'react'
import {Button, Card, Input, useAlert} from 'flowcloudai-ui'
import {openFileDialog} from '../../../api/dialog'
import {
    db_count_entries,
    db_get_project,
    db_import_project_fcworld,
    db_preview_project_fcworld,
    formatApiError,
    type FcworldImportPreview,
    type FcworldImportResult,
    type Project,
    toApiError,
} from '../../../api'
import FcworldProgressDialog from '../../../features/projects/components/FcworldProgressDialog'
import ProjectCreator from '../../../features/projects/components/ProjectCreator'
import ProjectImportConflictDialog from '../../../features/projects/components/ProjectImportConflictDialog'
import ProjectDefaultCover from '../../../features/projects/ProjectDefaultCover'
import ProjectCoverImage from '../../../features/projects/components/ProjectCoverImage'
import {useFcworldProgress} from '../../../features/projects/hooks/useFcworldProgress'
import {invalidateProjectList, useProjectListStore} from '../../../features/projects/projectListStore'
import {type MobilePage} from '../usePageStack'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import {formatProjectDate} from '../../../features/projects/projectDisplay'
import {MobileAddIcon} from '../components/MobileTopControls'
import {useMobilePageScrollMemory} from '../useMobilePageScrollMemory'
import './MobileProjectList.css'

interface Props {
    push: (page: MobilePage) => void
    setAiFocus: (focus: AiFocus) => void
    pageKey: string
}

export default function MobileProjectList({push, setAiFocus, pageKey}: Props) {
    const pageRef = useRef<HTMLDivElement>(null)
    const {showAlert} = useAlert()
    const {projects, loading: projectsLoading, error: projectError, refresh: refreshProjects} = useProjectListStore()
    const [entryCounts, setEntryCounts] = useState<Record<string, number>>({})
    const [countsLoading, setCountsLoading] = useState(false)
    const [importing, setImporting] = useState(false)
    const [countsError, setCountsError] = useState<string | null>(null)
    const [searchText, setSearchText] = useState('')
    const [creatorOpen, setCreatorOpen] = useState(false)
    const [importConflict, setImportConflict] = useState<FcworldImportPreview | null>(null)
    const {progress: fcworldProgress, startProgress, closeProgress, finishProgress} = useFcworldProgress()

    useEffect(() => {
        if (projects.length === 0) {
            setEntryCounts({})
            setCountsError(null)
            setCountsLoading(false)
            return
        }

        let cancelled = false
        setCountsLoading(true)
        setCountsError(null)
        const loadCounts = async () => {
            try {
                const counts = await Promise.all(
                    projects.map(async p => {
                        const c = await db_count_entries({projectId: p.id})
                        return [p.id, c] as const
                    })
                )
                if (!cancelled) setEntryCounts(Object.fromEntries(counts))
            } catch (e) {
                if (!cancelled) setCountsError(formatApiError(toApiError(e)))
            } finally {
                if (!cancelled) setCountsLoading(false)
            }
        }
        void loadCounts()

        return () => {
            cancelled = true
        }
    }, [projects])

    const loading = projectsLoading || countsLoading
    const error = projectError ?? countsError
    const retryProjects = useCallback(() => {
        void refreshProjects()
    }, [refreshProjects])

    const query = searchText.trim().toLowerCase()
    const filtered = projects
        .filter(p => {
            if (!query) return true
            return p.name.toLowerCase().includes(query)
                || (p.description ?? '').toLowerCase().includes(query)
        })
        .sort((a, b) => {
            const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0
            const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0
            return tb - ta
        })

    const handleOpenProject = useCallback((project: Project) => {
        setAiFocus({projectId: project.id, entryId: null})
        push({type: 'projectHome', params: {projectId: project.id, displayName: project.name}})
    }, [push, setAiFocus])

    const openImportedProject = useCallback(async (result: FcworldImportResult) => {
        await invalidateProjectList()
        const project = await db_get_project(result.projectId)
        handleOpenProject(project)
    }, [handleOpenProject])

    const handleImportProject = useCallback(async () => {
        if (importing) return
        const selectedPath = await openFileDialog({
            multiple: false,
            filters: [{
                name: '流云AI World',
                extensions: ['fcworld'],
            }],
        })
        if (!selectedPath || Array.isArray(selectedPath)) return

        setImporting(true)
        try {
            const previewOperationId = startProgress('import', '检查导入包')
            const preview = await db_preview_project_fcworld(selectedPath, previewOperationId)
            if (preview.duplicateProject) {
                closeProgress()
                setImportConflict(preview)
                return
            }
            closeProgress()
            const importOperationId = startProgress('import', '导入世界')
            const result = await db_import_project_fcworld(selectedPath, {
                mode: 'rename',
                projectName: preview.projectName,
            }, importOperationId)
            finishProgress()
            await openImportedProject(result)
        } catch (e) {
            closeProgress()
            await showAlert(`导入世界失败：${formatApiError(toApiError(e))}`, 'error', 'nonInvasive', 3200)
        } finally {
            setImporting(false)
        }
    }, [closeProgress, finishProgress, importing, openImportedProject, showAlert, startProgress])

    const handleImportConflictCancel = useCallback(() => {
        if (!importing) setImportConflict(null)
    }, [importing])

    const handleImportConflictRename = useCallback(async (projectName: string) => {
        if (!importConflict || importing) return
        const inputPath = importConflict.inputPath
        setImportConflict(null)
        setImporting(true)
        try {
            const operationId = startProgress('import', '导入世界')
            const result = await db_import_project_fcworld(inputPath, {
                mode: 'rename',
                projectName,
            }, operationId)
            finishProgress()
            await openImportedProject(result)
        } catch (e) {
            closeProgress()
            await showAlert(`导入世界失败：${formatApiError(toApiError(e))}`, 'error', 'nonInvasive', 3200)
        } finally {
            setImporting(false)
        }
    }, [closeProgress, finishProgress, importConflict, importing, openImportedProject, showAlert, startProgress])

    const handleImportConflictOverwrite = useCallback(async () => {
        if (!importConflict?.duplicateProject || importing) return
        const inputPath = importConflict.inputPath
        const overwriteProjectId = importConflict.duplicateProject.projectId
        const confirmed = await showAlert(
            '选择覆盖后，原世界观的数据会丢失。确定覆盖吗？',
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        setImportConflict(null)
        setImporting(true)
        try {
            const operationId = startProgress('import', '导入世界')
            const result = await db_import_project_fcworld(inputPath, {
                mode: 'overwrite',
                overwriteProjectId,
            }, operationId)
            finishProgress()
            await openImportedProject(result)
        } catch (e) {
            closeProgress()
            await showAlert(`导入世界失败：${formatApiError(toApiError(e))}`, 'error', 'nonInvasive', 3200)
        } finally {
            setImporting(false)
        }
    }, [closeProgress, finishProgress, importConflict, importing, openImportedProject, showAlert, startProgress])

    // 同 MobileProjectHome：加载态没有 .mobile-page，滚动记忆要等容器就绪。
    useMobilePageScrollMemory(pageKey, pageRef, !(loading && projects.length === 0))

    if (loading && projects.length === 0) {
        return <div className="mobile-page__loading">加载中…</div>
    }

    if (error && projects.length === 0) {
        return <div className="mobile-page__error" role="alert">
            <span>加载失败：{error}</span>
            <Button type="button" size="sm" variant="outline" onClick={retryProjects}>重试</Button>
        </div>
    }

    return (
        <div ref={pageRef} className="mobile-page mobile-project-list">
            <ProjectCreator
                open={creatorOpen}
                onClose={() => setCreatorOpen(false)}
                onCreated={handleOpenProject}
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
            <FcworldProgressDialog progress={fcworldProgress} />

            <div className="mobile-project-list__hero">
                <div className="mobile-project-list__hero-copy">
                    <span className="mobile-page__eyebrow mobile-project-list__eyebrow">
                        {loading ? '正在同步' : `${filtered.length} 个世界`}
                    </span>
                <h2 className="mobile-page__hero-title">项目</h2>
                </div>
                <button
                    type="button"
                    className="mobile-project-list__create"
                    onClick={() => setCreatorOpen(true)}
                    aria-label="新建项目"
                >
                    <MobileAddIcon/>
                </button>
            </div>

            <div className="mobile-project-list__toolbar">
                <Input
                    placeholder="搜索项目…"
                    aria-label="搜索项目"
                    value={searchText}
                    onValueChange={setSearchText}
                    className="mobile-page__search"
                    radius="full"
                    size="lg"
                    allowClear
                />
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mobile-project-list__import"
                    disabled={importing}
                    onClick={() => void handleImportProject()}
                >
                    {importing ? '导入中…' : '导入'}
                </Button>
            </div>

            {error && projects.length > 0 && (
                <div className="mobile-page__error-banner" role="alert">
                    <span>部分项目信息刷新失败：{error}</span>
                    <Button type="button" size="sm" variant="outline" onClick={retryProjects}>重试</Button>
                </div>
            )}

            {projects.length === 0 && !loading ? (
                <div className="mobile-page__empty">
                    <p>还没有任何项目</p>
                    <Button type="button" onClick={() => setCreatorOpen(true)}>创建第一个世界</Button>
                </div>
            ) : (
                <div className="mobile-project-list__cards">
                    {filtered.length === 0 ? (
                        <div className="mobile-page__empty">没有匹配的项目</div>
                    ) : (
                        filtered.map(project => {
                            return (
                                <Card
                                    key={project.id}
                                    className="mobile-page__card mobile-project-card"
                                    title={project.name}
                                    description={project.description || '暂无描述'}
                                    imageSlot={project.cover_path ? (
                                        <ProjectCoverImage
                                            projectId={project.id}
                                            coverPath={project.cover_path}
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
                                    imageHeight="8.5rem"
                                    extraInfo={
                                        <span className="mobile-project-card__meta">
                                            {entryCounts[project.id] ?? 0} 词条 · {formatProjectDate(project.updated_at)}
                                        </span>
                                    }
                                    variant="shadow"
                                    hoverable
                                    onClick={() => handleOpenProject(project)}
                                />
                            )
                        })
                    )}
                </div>
            )}
        </div>
    )
}
