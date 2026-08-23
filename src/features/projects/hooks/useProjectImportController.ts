import {useCallback, useState} from 'react'
import {openFileDialog} from '../../../api/dialog'
import {
    db_import_project_fcworld,
    db_preview_project_fcworld,
    type FcworldImportPreview,
    type FcworldImportResult,
} from '../../../api'
import {useFcworldProgress} from './useFcworldProgress'

interface ProjectImportControllerOptions {
    onImported: (result: FcworldImportResult) => void | Promise<void>
    onError: (error: unknown) => unknown | Promise<unknown>
}

export function useProjectImportController({onImported, onError}: ProjectImportControllerOptions) {
    const [importing, setImporting] = useState(false)
    const [conflict, setConflict] = useState<FcworldImportPreview | null>(null)
    const {progress, startProgress, closeProgress, finishProgress} = useFcworldProgress()

    const runImport = useCallback(async (
        inputPath: string,
        options: {mode: 'rename'; projectName: string} | {mode: 'overwrite'; overwriteProjectId: string},
    ) => {
        setConflict(null)
        setImporting(true)
        try {
            const operationId = startProgress('import', '导入世界')
            const result = await db_import_project_fcworld(inputPath, options, operationId)
            finishProgress()
            await onImported(result)
        } catch (error) {
            closeProgress()
            await onError(error)
        } finally {
            setImporting(false)
        }
    }, [closeProgress, finishProgress, onError, onImported, startProgress])

    const importFromPath = useCallback(async (inputPath: string) => {
        if (importing) return
        setImporting(true)
        try {
            const operationId = startProgress('import', '检查导入包')
            const preview = await db_preview_project_fcworld(inputPath, operationId)
            closeProgress()
            if (preview.duplicateProject) {
                setConflict(preview)
                return
            }
            await runImport(inputPath, {mode: 'rename', projectName: preview.projectName})
        } catch (error) {
            closeProgress()
            await onError(error)
        } finally {
            setImporting(false)
        }
    }, [closeProgress, importing, onError, runImport, startProgress])

    const selectAndImport = useCallback(async () => {
        if (importing) return
        const selectedPath = await openFileDialog({
            multiple: false,
            filters: [{name: '流云AI World', extensions: ['fcworld']}],
        })
        if (!selectedPath || Array.isArray(selectedPath)) return
        await importFromPath(selectedPath)
    }, [importFromPath, importing])

    const rename = useCallback((projectName: string) => {
        if (!conflict || importing) return Promise.resolve()
        return runImport(conflict.inputPath, {mode: 'rename', projectName})
    }, [conflict, importing, runImport])

    const overwrite = useCallback(() => {
        if (!conflict?.duplicateProject || importing) return Promise.resolve()
        return runImport(conflict.inputPath, {
            mode: 'overwrite',
            overwriteProjectId: conflict.duplicateProject.projectId,
        })
    }, [conflict, importing, runImport])

    const cancelConflict = useCallback(() => {
        if (!importing) setConflict(null)
    }, [importing])

    return {
        importing,
        conflict,
        progress,
        importFromPath,
        selectAndImport,
        rename,
        overwrite,
        cancelConflict,
        closeProgress,
    }
}
