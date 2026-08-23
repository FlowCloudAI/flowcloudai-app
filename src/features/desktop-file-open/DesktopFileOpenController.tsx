/**
 * 桌面系统文件双击的业务消费层。
 *
 * Windows 与 macOS 共用该组件：平台层只负责把路径放入 Rust 队列；这里逐个执行世界包
 * 预览/冲突处理或插件安装确认，任何系统打开事件都不能绕过现有业务确认边界。
 */
import {useCallback, useEffect, useRef, useState} from 'react'
import {useAlert} from 'flowcloudai-ui'
import {
    db_get_project,
    type FcworldImportResult,
    type Project,
} from '../../api'
import {
    DESKTOP_FILE_OPEN_PENDING_EVENT,
    type DesktopFileOpenRequest,
} from '../../api/desktopFileOpen'
import {listen, releaseTauriListener} from '../../api/events'
import {isBrowserPreview} from '../../shared/devPreview'
import {logger} from '../../shared/logger'
import FcworldProgressDialog from '../projects/components/FcworldProgressDialog'
import ProjectImportConflictDialog from '../projects/components/ProjectImportConflictDialog'
import {useProjectImportController} from '../projects/hooks/useProjectImportController'
import {invalidateProjectList, useProjectListStore} from '../projects/projectListStore'
import {installLocalPlugin} from '../settings/pluginCatalogStore'
import {
    requestDesktopFileOpenDrain,
    takeNextDesktopFileOpenRequest,
    useDesktopFileOpenQueueVersion,
} from './desktopFileOpenQueue'

interface DesktopFileOpenControllerProps {
    onOpenProject?: (project: Project) => void
}

function fileNameFromPath(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export default function DesktopFileOpenController({onOpenProject}: DesktopFileOpenControllerProps) {
    const {showAlert} = useAlert()
    const {projects} = useProjectListStore()
    const queueVersion = useDesktopFileOpenQueueVersion()
    const [activeRequest, setActiveRequest] = useState<DesktopFileOpenRequest | null>(null)
    const startedRequestIdsRef = useRef(new Set<number>())

    const finishActiveRequest = useCallback(() => {
        setActiveRequest(null)
    }, [])

    const handleImported = useCallback(async (result: FcworldImportResult) => {
        await invalidateProjectList()
        try {
            const project = await db_get_project(result.projectId)
            onOpenProject?.(project)
            void showAlert(
                `“${result.projectName}”导入成功`,
                'success',
                'nonInvasive',
                2200,
            )
        } catch (error) {
            logger.warn('导入完成后打开项目失败', error)
            void showAlert(
                `“${result.projectName}”已导入，但暂时无法自动打开，请从世界列表进入。`,
                'warning',
                'nonInvasive',
                3200,
            )
        } finally {
            finishActiveRequest()
        }
    }, [finishActiveRequest, onOpenProject, showAlert])

    const handleImportError = useCallback(async (error: unknown) => {
        await showAlert(
            `导入世界失败：${String(error)}`,
            'error',
            'nonInvasive',
            3600,
        )
        finishActiveRequest()
    }, [finishActiveRequest, showAlert])

    const {
        importing,
        conflict,
        progress,
        importFromPath,
        rename,
        overwrite,
        cancelConflict,
    } = useProjectImportController({onImported: handleImported, onError: handleImportError})

    const installPluginRequest = useCallback(async (request: DesktopFileOpenRequest) => {
        const fileName = fileNameFromPath(request.path)
        try {
            const confirmed = await showAlert(
                `是否安装插件包“${fileName}”？安装会关闭当前 AI 会话；同 ID 插件可能被更新或替换。`,
                'warning',
                'confirm',
            )
            if (confirmed !== 'yes') return

            const plugin = await installLocalPlugin(request.path)
            void showAlert(
                `${plugin.name} 安装成功`,
                'success',
                'nonInvasive',
                2200,
            )
        } catch (error) {
            logger.error('系统文件打开安装插件失败', error)
            void showAlert(
                `插件安装失败：${String(error)}`,
                'error',
                'nonInvasive',
                3600,
            )
        } finally {
            finishActiveRequest()
        }
    }, [finishActiveRequest, showAlert])

    useEffect(() => {
        if (isBrowserPreview()) return

        const drain = () => {
            void requestDesktopFileOpenDrain().catch((error: unknown) => {
                logger.error('读取桌面系统文件打开队列失败', error)
                void showAlert(
                    '读取系统打开的文件失败，请重新双击文件。',
                    'error',
                    'nonInvasive',
                    3000,
                )
            })
        }
        const listener = listen(DESKTOP_FILE_OPEN_PENDING_EVENT, drain)
        drain()

        return () => releaseTauriListener(listener, '桌面文件打开')
    }, [showAlert])

    useEffect(() => {
        if (activeRequest || importing) return
        const nextRequest = takeNextDesktopFileOpenRequest()
        if (nextRequest) setActiveRequest(nextRequest)
    }, [activeRequest, importing, queueVersion])

    useEffect(() => {
        if (!activeRequest || startedRequestIdsRef.current.has(activeRequest.id)) return
        startedRequestIdsRef.current.add(activeRequest.id)

        if (activeRequest.kind === 'fcworld') {
            void importFromPath(activeRequest.path)
            return
        }
        void installPluginRequest(activeRequest)
    }, [activeRequest, importFromPath, installPluginRequest])

    const handleConflictCancel = useCallback(() => {
        cancelConflict()
        finishActiveRequest()
    }, [cancelConflict, finishActiveRequest])

    const handleConflictOverwrite = useCallback(async () => {
        if (!conflict?.duplicateProject || importing) return
        const confirmed = await showAlert(
            '选择覆盖后，原世界观的数据会丢失。确定覆盖吗？',
            'warning',
            'confirm',
        )
        if (confirmed === 'yes') await overwrite()
    }, [conflict, importing, overwrite, showAlert])

    return (
        <>
            <ProjectImportConflictDialog
                open={Boolean(conflict)}
                preview={conflict}
                existingNames={projects.map(project => project.name)}
                busy={importing}
                onCancel={handleConflictCancel}
                onRename={projectName => void rename(projectName)}
                onOverwrite={() => void handleConflictOverwrite()}
            />
            <FcworldProgressDialog progress={progress}/>
        </>
    )
}
