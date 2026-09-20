// 本 hook 隔离既有的本地恢复记录定时读写；页面正文仍由独立页面文档会话负责。

import {type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState} from 'react'
import type {Entry} from '../../../api'
import {logger} from '../../../shared/logger'
import type {EntryRelationDraft} from '../../project-editor/components/EntryRelations/EntryRelationCreator.tsx'
import type {EntryDraft} from '../components/entryEditorModel.ts'
import {
    deleteEntryDraftRecovery,
    type EntryDraftRecoveryField,
    type EntryDraftRecoveryRecord,
    getEntryDraftRecovery,
    getEntryDraftRecoveryFields,
    resolveEntryDraftRecoveryKind,
    saveEntryDraftRecovery,
} from '../lib/entryDraftRecovery.ts'
import type {EntryEditorMode} from '../lib/entryEditorShortcutModel.ts'

interface RecoveryNotice {
    record: EntryDraftRecoveryRecord
    kind: ReturnType<typeof resolveEntryDraftRecoveryKind>
    fields: EntryDraftRecoveryField[]
}

interface UseEntryDraftRecoveryStateOptions {
    projectId: string
    entryId: string
    entry: Entry | null
    initialDraft: EntryDraft | null
    initialRelationDrafts: EntryRelationDraft[]
    draft: EntryDraft
    relationDrafts: EntryRelationDraft[]
    relationsReady: boolean
    hasChanges: boolean
    hasUserEdited: boolean
    editingSupported: boolean
    markUserEdited: () => void
    setDraft: Dispatch<SetStateAction<EntryDraft>>
    setRelationDrafts: Dispatch<SetStateAction<EntryRelationDraft[]>>
    setEditorMode: Dispatch<SetStateAction<EntryEditorMode>>
    onEditingUnsupported: () => void
}

export default function useEntryDraftRecoveryState({
    projectId,
    entryId,
    entry,
    initialDraft,
    initialRelationDrafts,
    draft,
    relationDrafts,
    relationsReady,
    hasChanges,
    hasUserEdited,
    editingSupported,
    markUserEdited,
    setDraft,
    setRelationDrafts,
    setEditorMode,
    onEditingUnsupported,
}: UseEntryDraftRecoveryStateOptions) {
    const [ready, setReady] = useState(false)
    const [notice, setNotice] = useState<RecoveryNotice | null>(null)
    const loadKeyRef = useRef<string | null>(null)
    const writeTimerRef = useRef<number | null>(null)

    const clearWriteTimer = useCallback(() => {
        if (writeTimerRef.current === null) return
        window.clearTimeout(writeTimerRef.current)
        writeTimerRef.current = null
    }, [])

    useEffect(() => {
        loadKeyRef.current = null
        setReady(false)
        setNotice(null)
        clearWriteTimer()
    }, [clearWriteTimer, entryId])

    useEffect(() => {
        if (!entry || entry.id !== entryId || !initialDraft || !relationsReady) return
        const currentUpdatedAt = String(entry.updated_at ?? '')
        const loadKey = JSON.stringify([projectId, entryId, currentUpdatedAt])
        if (loadKeyRef.current === loadKey) return
        loadKeyRef.current = loadKey
        setReady(false)
        setNotice(null)
        let cancelled = false
        void getEntryDraftRecovery(projectId, entryId)
            .then(record => {
                if (cancelled || !record) return
                const fields = getEntryDraftRecoveryFields(record, {
                    ...initialDraft,
                    relationDrafts: initialRelationDrafts,
                }).filter(field => field !== 'content')
                if (fields.length === 0) {
                    void deleteEntryDraftRecovery(projectId, entryId)
                        .catch(error => logger.error('delete redundant entry recovery failed', error))
                    return
                }
                setNotice({record, kind: resolveEntryDraftRecoveryKind(record, currentUpdatedAt), fields})
            })
            .catch(error => logger.error('load entry recovery failed', error))
            .finally(() => {
                if (!cancelled) setReady(true)
            })
        return () => {
            cancelled = true
        }
    }, [entry, entryId, initialDraft, initialRelationDrafts, projectId, relationsReady])

    useEffect(() => {
        clearWriteTimer()
        if (!entry || !initialDraft || !ready || !hasUserEdited) return
        if (!hasChanges) {
            void deleteEntryDraftRecovery(projectId, entryId)
                .catch(error => logger.error('delete entry recovery failed', error))
            return
        }
        writeTimerRef.current = window.setTimeout(() => {
            writeTimerRef.current = null
            void saveEntryDraftRecovery({
                projectId,
                entryId,
                baseUpdatedAt: String(entry.updated_at ?? ''),
                savedAt: Date.now(),
                draft: {
                    ...draft,
                    tags: {...draft.tags},
                    images: draft.images.map(image => ({...image})),
                    relationDrafts: relationDrafts.map(relation => ({...relation})),
                },
            }).catch(error => logger.error('save entry recovery failed', error))
        }, 1000)
        return clearWriteTimer
    }, [clearWriteTimer, draft, entry, entryId, hasChanges, hasUserEdited, initialDraft, projectId, ready, relationDrafts])

    const restore = useCallback((fields: EntryDraftRecoveryField[]) => {
        if (!notice) return
        if (!editingSupported) {
            onEditingUnsupported()
            return
        }
        markUserEdited()
        const snapshot = notice.record.draft
        setDraft(current => ({
            title: fields.includes('title') && snapshot.title !== undefined ? snapshot.title : current.title,
            summary: fields.includes('summary') && snapshot.summary !== undefined ? snapshot.summary : current.summary,
            content: current.content,
            type: fields.includes('type') && snapshot.type !== undefined ? snapshot.type : current.type,
            categoryId: fields.includes('categoryId') && snapshot.categoryId !== undefined
                ? snapshot.categoryId
                : current.categoryId,
            tags: fields.includes('tags') && snapshot.tags ? {...snapshot.tags} : current.tags,
            images: fields.includes('images') && snapshot.images
                ? snapshot.images.map(image => ({...image}))
                : current.images,
        }))
        if (fields.includes('relationDrafts') && snapshot.relationDrafts) {
            setRelationDrafts(snapshot.relationDrafts.map(relation => ({...relation})))
        }
        setEditorMode('edit')
        setNotice(null)
        void deleteEntryDraftRecovery(projectId, entryId)
            .catch(error => logger.error('delete restored entry recovery failed', error))
    }, [editingSupported, entryId, markUserEdited, notice, onEditingUnsupported, projectId, setDraft, setEditorMode, setRelationDrafts])

    const discard = useCallback(() => {
        setNotice(null)
        void deleteEntryDraftRecovery(projectId, entryId)
            .catch(error => logger.error('discard entry recovery failed', error))
    }, [entryId, projectId])

    const clearAfterSave = useCallback(async () => {
        clearWriteTimer()
        await deleteEntryDraftRecovery(projectId, entryId)
            .catch(error => logger.error('delete saved entry recovery failed', error))
        setNotice(null)
    }, [clearWriteTimer, entryId, projectId])

    return {notice, restore, discard, clearAfterSave}
}
