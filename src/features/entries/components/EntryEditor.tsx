import {logger} from '../../../shared/logger'
import {listen} from '../../../api/events'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button, useAlert} from 'flowcloudai-ui'
import {
    db_delete_entry,
    db_get_entry,
    db_list_incoming_links,
    db_list_outgoing_links,
    db_list_relations_for_entry,
    db_create_relation,
    db_delete_relation,
    db_update_entry,
    db_update_relation,
    type Entry,
    ENTRY_DELETED,
    ENTRY_UPDATED,
    type EntryDeletedEvent,
    type EntryLink,
    type EntryRelation,
    type EntryUpdatedEvent,
    type TagSchema,
} from '../../../api'
import {pageDocumentReadEntry} from '../../../api/pageDocument.ts'
import EntryEditorSidebar from './EntryEditorSidebar'
import EntryImageLightbox from './EntryImageLightbox'
import TagCreator from './TagCreator'
import EntryEditorMetaPanel from './EntryEditorMetaPanel'
import EntryImageAddModal from './EntryImageAddModal'
import EntryEditorLinkPreview from './EntryEditorLinkPreview'
import EntryDraftRecoveryBanner from './EntryDraftRecoveryBanner'
import EntryEditorWorkspace from './EntryEditorWorkspace.tsx'
import useLinkPreview from '../hooks/useLinkPreview'
import useEntryTags from '../hooks/useEntryTags'
import useEntryImageState from '../hooks/useEntryImageState'
import useEntryRelationState from '../hooks/useEntryRelationState'
import useEntrySaveStatus from '../hooks/useEntrySaveStatus'
import useEntryTtsVoiceState from '../hooks/useEntryTtsVoiceState.ts'
import useEntryProjectIndex from '../hooks/useEntryProjectIndex.ts'
import useEntryDraftRecoveryState from '../hooks/useEntryDraftRecoveryState.ts'
import useEntryImageDraftActions from '../hooks/useEntryImageDraftActions.ts'
import useEntrySummaryGeneration from '../hooks/useEntrySummaryGeneration.ts'
import useEntryPageDocumentNavigation from '../hooks/useEntryPageDocumentNavigation.ts'
import {buildEntryTagsPayload,} from './entryTagUtils'
import {Overlay} from '../../../shared/ui/overlay'

import './EntryEditor.css'
import {areTagMapsEqual, buildAutoVisibleTagSchemaIds,} from '../lib/entryTag'
import {buildRelationDraft,} from '../lib/entryRelation'
import {syncEntryRelationDrafts} from '../lib/entryRelationPersistence.ts'
import {
    normalizeComparableContent,
    normalizeComparableText,
    normalizeComparableType,
} from '../lib/entryCommon'
import {resolveSavedState, shouldAutoSave} from '../lib/entrySaveState'
import type {EntryRelationDraft} from '../../project-editor/components/EntryRelations/EntryRelationCreator.tsx'
import EntryMapLocationOverlay from '../../maps/components/EntryMapLocationOverlay'
import {PageDocumentCanvasEntry} from '@page-document-canvas-entry'
import {PageDocumentEditorEntry} from '@page-document-editor-entry'
import type {EntryEditorMode} from '../lib/entryEditorShortcutModel.ts'
import {convertMarkdownToPageDocument} from '../../page-document/application/markdownDocumentConversion.ts'
import {resolveSupportedEntryMode, supportsPageDocumentLayers} from '../../page-document/application/canvasLayerSupport.ts'
import {areImagesEqual, buildDraft, type EntryDraft, type EntryEditorProps} from './entryEditorModel.ts'

type EntrySaveSource = 'manual' | 'auto'
const AUTO_SAVE_IDLE_MS = 30_000
const PAGE_DOCUMENT_LAYERS_SUPPORTED = typeof window !== 'undefined' && supportsPageDocumentLayers(window)

export default function EntryEditor(props: EntryEditorProps) {
    const {
        entryId, projectId, projectName, categories, entryTypes, tagSchemas,
        onOpenEntry, onTitleChange, onSaved, onTagSchemasChange, onBack, onDelete,
        onDirtyChange, onSavingChange, onStartCharacterChat, onOpenWorldMap,
        onOpenPluginManagement, onOpenAiSettings,
    } = props
    const active = props.active ?? true
    const aiPluginId = props.aiPluginId ?? null
    const aiModel = props.aiModel ?? null
    const initialEditorMode = props.initialEditorMode ?? 'browse'
    const pageDocumentSelection = props.pageDocumentSelection ?? null
    const [entry, setEntry] = useState<Entry | null>(null)
    const [draft, setDraft] = useState<EntryDraft>({
        title: '', summary: '', content: '', type: null, categoryId: null, tags: {}, images: [],
    })
    const [loading, setLoading] = useState(false)
    const [savingSource, setSavingSource] = useState<EntrySaveSource | null>(null)
    const saving = savingSource !== null
    const [error, setError] = useState<string | null>(null)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [editorMode, setEditorMode] = useState<EntryEditorMode>(
        resolveSupportedEntryMode(initialEditorMode, PAGE_DOCUMENT_LAYERS_SUPPORTED),
    )
    const [layerSupportNoticeOpen, setLayerSupportNoticeOpen] = useState(
        !PAGE_DOCUMENT_LAYERS_SUPPORTED && initialEditorMode === 'edit',
    )
    const [pageDocumentDirty, setPageDocumentDirty] = useState(false)
    const [pageDocumentResetVersion, setPageDocumentResetVersion] = useState(0)
    const [pageDocumentDerivedText, setPageDocumentDerivedText] = useState<string | null>(null)
    const ttsVoiceState = useEntryTtsVoiceState()
    const [outgoingLinks, setOutgoingLinks] = useState<EntryLink[]>([])
    const [incomingLinks, setIncomingLinks] = useState<EntryLink[]>([])
    const [tagCreatorOpen, setTagCreatorOpen] = useState(false)
    const [hasUserEdited, setHasUserEdited] = useState(false)
    const [relationsReady, setRelationsReady] = useState(false)
    const {
        setEntryRelations, relationDrafts, setRelationDrafts, initialRelationDrafts,
        hasRelationChanges, hasInvalidRelationDrafts, clearRelations, applySavedRelations,
    } = useEntryRelationState(entryId)
    const {
        lightboxOpen, setLightboxOpen, lightboxIndex, setLightboxIndex, lightboxImages,
        imageAddModalMode, openImageAddModal, closeImageAddModal,
    } = useEntryImageState(draft.images)
    const reopenLightboxAfterImageAddRef = useRef(false)
    const linkPreviewPanelRef = useRef<HTMLDivElement | null>(null)
    const onDirtyChangeRef = useRef(onDirtyChange)
    const entryRef = useRef<Entry | null>(null)
    const hasChangesRef = useRef(false)
    const saveSourceIdRef = useRef(globalThis.crypto.randomUUID())
    const onSavedRef = useRef(onSaved)
    const onTitleChangeRef = useRef(onTitleChange)
    const userEditVersionRef = useRef(0)

    const {showAlert} = useAlert()
    const confirmDiscardPageDocument = useCallback(async () => {
        if (!pageDocumentDirty) return true
        const result = await showAlert(
            '页面草稿尚未保存。选择取消继续编辑，选择确定放弃修改。',
            'warning',
            'confirm',
        )
        return result === 'yes'
    }, [pageDocumentDirty, showAlert])
    const requestLeavePageDocument = useCallback(async (): Promise<boolean> => {
        if (!(await confirmDiscardPageDocument())) return false
        setPageDocumentDirty(false)
        setPageDocumentResetVersion(current => current + 1)
        return true
    }, [confirmDiscardPageDocument])
    const requestEditorMode = useCallback(async (nextMode: EntryEditorMode) => {
        if (nextMode === editorMode) return
        if (nextMode === 'edit' && !PAGE_DOCUMENT_LAYERS_SUPPORTED) {
            setLayerSupportNoticeOpen(true)
            return
        }
        if (editorMode === 'edit' && !(await requestLeavePageDocument())) return
        setEditorMode(nextMode)
    }, [editorMode, requestLeavePageDocument])
    const handleBack = useCallback(async () => {
        if (editorMode === 'edit' && !(await requestLeavePageDocument())) return
        await onBack?.()
    }, [editorMode, onBack, requestLeavePageDocument])
    const markUserEdited = useCallback(() => {
        userEditVersionRef.current += 1
        setHasUserEdited(true)
    }, [])
    const updateDraftFromUser = useCallback((updater: (current: EntryDraft) => EntryDraft) => {
        markUserEdited()
        setDraft(updater)
    }, [markUserEdited])
    const updateRelationDraftsFromUser = useCallback((next: EntryRelationDraft[]) => {
        markUserEdited()
        setRelationDrafts(next)
    }, [markUserEdited, setRelationDrafts])
    const imageDraftActions = useEntryImageDraftActions({
        projectId,
        updateDraft: updateDraftFromUser,
        reportError: setError,
    })
    // ProjectEditor 会常驻挂载已打开的词条标签；切换 active 不会丢草稿，因此无需确认。

    useEffect(() => {
        onDirtyChangeRef.current = onDirtyChange
        entryRef.current = entry
        onSavedRef.current = onSaved
        onTitleChangeRef.current = onTitleChange
    }, [onDirtyChange, entry, onSaved, onTitleChange])

    const entryTags = useEntryTags({
        tagSchemas,
        draftTags: draft.tags,
        draftType: draft.type,
        entryId,
        onTagsChange: (nextTags) => setDraft((current) => (
            areTagMapsEqual(current.tags, nextTags, tagSchemas) ? current : {...current, tags: nextTags}
        )),
    })

    const {
        projectEntries,
        setProjectEntries,
        entryDetailsById: projectEntryDetailsById,
        setEntryDetailsById: setProjectEntryDetailsById,
        projectDataLoading,
        projectEntriesRef,
        ensureEntryDetails,
        ensureProjectEntriesLoaded,
        backlinks,
    } = useEntryProjectIndex({active, entryId, projectId, incomingLinks})

    const linkPreview = useLinkPreview({
        currentProjectId: projectId,
        entryCache: projectEntryDetailsById,
        projectEntries,
        ensureProjectEntriesLoaded: () => ensureProjectEntriesLoaded(),
        ensureEntryDetail: (targetEntryId) => ensureEntryDetails([targetEntryId]),
        onOpenEntry: (targetProjectId, targetEntry) => {
            if (targetProjectId !== projectId) {
                void showAlert('该词条链接指向其他项目，当前编辑器无法直接打开。', 'warning', 'nonInvasive', 1800)
                return
            }
            onOpenEntry?.(targetEntry)
        },
        onMissingLink: (message) => {
            void showAlert(message, 'warning', 'nonInvasive', 1800)
        },
    })

    const closePageLinkPreview = linkPreview.closeLinkPreview
    const pageDocumentNavigation = useEntryPageDocumentNavigation({
        active,
        editorMode,
        ensureProjectEntriesLoaded,
        linkPreview,
    })
    // 词条标签常驻挂载；切换活动标签或模式时不得留下后台词条的 fixed 浮窗。
    useEffect(() => {
        closePageLinkPreview()
    }, [active, editorMode, entryId, closePageLinkPreview])


    useEffect(() => {
        onDirtyChangeRef.current?.(false)
        userEditVersionRef.current = 0
        setHasUserEdited(false)
    }, [entryId])

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setSavingSource(null)
        setError(null)
        setSaveError(null)
        linkPreview.closeLinkPreview()
        setOutgoingLinks([])
        setIncomingLinks([])
        clearRelations()
        setRelationsReady(false)

        void db_get_entry(entryId, projectId)
            .then((result) => {
                if (cancelled) return
                setEntry(result)
                setDraft(buildDraft(result))
                setEditorMode(resolveSupportedEntryMode(initialEditorMode, PAGE_DOCUMENT_LAYERS_SUPPORTED))
            })
            .catch((e) => {
                if (cancelled) return
                setEntry(null)
                setError(String(e))
            })
            .finally(() => {
                if (cancelled) return
                setLoading(false)
            })

        Promise.all([
            db_list_outgoing_links(entryId, projectId).catch(() => [] as EntryLink[]),
            db_list_incoming_links(entryId, projectId).catch(() => [] as EntryLink[]),
            db_list_relations_for_entry(entryId, projectId).catch(() => [] as EntryRelation[]),
        ])
            .then(([outgoing, incoming, relations]) => {
                if (cancelled) return
                setOutgoingLinks(outgoing)
                setIncomingLinks(incoming)
                void ensureEntryDetails(incoming.map((link) => link.a_id))
                applySavedRelations(relations)
                setRelationsReady(true)
            })

        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linkPreview.closeLinkPreview, entryId, clearRelations, applySavedRelations])

    useEffect(() => {
        let cancelled = false
        setPageDocumentDerivedText(null)
        void pageDocumentReadEntry(entryId)
            .then(document => {
                if (!cancelled) setPageDocumentDerivedText(document?.derivedText ?? null)
            })
            .catch(readError => logger.warn('读取页面文档派生文本失败', readError))
        return () => {
            cancelled = true
        }
    }, [entryId])

    useEffect(() => {
        if (!entry || entry.id !== entryId) return
        const initialDraftState = buildDraft(entry)
        const initialVisibleTagSchemaIds = buildAutoVisibleTagSchemaIds(entryTags.localTagSchemas, initialDraftState.tags, initialDraftState.type)
        entryTags.setPinnedTagSchemaIds((current) => (current.length === 0 ? initialVisibleTagSchemaIds : current))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entry, entryId, entryTags.localTagSchemas, entryTags.setPinnedTagSchemaIds])

    const trimmedTitle = useMemo(() => normalizeComparableText(draft.title), [draft.title])
    const trimmedSummary = useMemo(() => normalizeComparableText(draft.summary), [draft.summary])
    const initialDraft = useMemo(() => (entry ? buildDraft(entry) : null), [entry])
    const comparableInitial = useMemo(() => {
        if (!initialDraft) return null
        return {
            title: normalizeComparableText(initialDraft.title),
            summary: normalizeComparableText(initialDraft.summary),
            content: normalizeComparableContent(initialDraft.content),
            type: normalizeComparableType(initialDraft.type),
            categoryId: initialDraft.categoryId ?? null,
            tags: initialDraft.tags,
            images: initialDraft.images,
        }
    }, [initialDraft])
    const hasChanges = Boolean(
        comparableInitial && (
            trimmedTitle !== comparableInitial.title
            || trimmedSummary !== comparableInitial.summary
            || normalizeComparableType(draft.type) !== comparableInitial.type
            || !areTagMapsEqual(draft.tags, comparableInitial.tags, entryTags.localTagSchemas)
            || (draft.categoryId ?? null) !== comparableInitial.categoryId
            || !areImagesEqual(draft.images, comparableInitial.images)
            || hasRelationChanges
        ),
    )
    const canSave = Boolean(entry && trimmedTitle && hasChanges && !hasInvalidRelationDrafts && !loading && !saving)

    const {
        notice: recoveryNotice,
        restore: handleRestoreRecovery,
        discard: handleDiscardRecovery,
        clearAfterSave: clearRecoveryAfterSave,
    } = useEntryDraftRecoveryState({
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
        editingSupported: PAGE_DOCUMENT_LAYERS_SUPPORTED,
        markUserEdited,
        setDraft,
        setRelationDrafts,
        setEditorMode,
        onEditingUnsupported: () => {
            if (!PAGE_DOCUMENT_LAYERS_SUPPORTED) {
                setLayerSupportNoticeOpen(true)
            }
        },
    })

    const convertedLegacyText = useMemo(
        () => convertMarkdownToPageDocument(entryId, draft.content).derivedText,
        [draft.content, entryId],
    )
    const documentBodyText = pageDocumentDerivedText ?? convertedLegacyText
    const summaryGeneration = useEntrySummaryGeneration({
        aiPluginId,
        aiModel,
        projectId,
        entryId,
        entryTitle: entry?.title ?? null,
        draft,
        documentBodyText,
        loading,
        saving,
        updateDraft: updateDraftFromUser,
    })
    useEffect(() => {
        hasChangesRef.current = hasChanges
        onDirtyChangeRef.current?.(hasChanges || pageDocumentDirty)
    }, [hasChanges, pageDocumentDirty])

    const saveStatus = useEntrySaveStatus({
        entryLoaded: Boolean(entry),
        hasChanges,
        trimmedTitle,
        hasInvalidRelationDrafts,
        saving,
        saveError,
    })

    const infoTitle = trimmedTitle || entry?.title || '未命名词条'

    const reloadEntryFromDatabase = useCallback(async (
        reason: 'external' | 'save' = 'external',
        submitted?: {draft: EntryDraft; relationDrafts: EntryRelationDraft[]},
    ) => {
        const [refreshed, refreshedOutgoing, refreshedIncoming, refreshedRelations] = await Promise.all([
            db_get_entry(entryId, projectId),
            db_list_outgoing_links(entryId, projectId).catch(() => [] as EntryLink[]),
            db_list_incoming_links(entryId, projectId).catch(() => [] as EntryLink[]),
            db_list_relations_for_entry(entryId, projectId).catch(() => [] as EntryRelation[]),
        ])

        const previousEntry = entryRef.current

        const savedDraft = buildDraft(refreshed)
        const savedRelationDrafts = refreshedRelations.map((relation) => buildRelationDraft(refreshed.id, relation))

        setEntry(refreshed)
        if (reason === 'save' && submitted) {
            setDraft((current) => resolveSavedState(current, submitted.draft, savedDraft))
            setEntryRelations(refreshedRelations)
            setRelationDrafts((current) => resolveSavedState(
                current,
                submitted.relationDrafts,
                savedRelationDrafts,
            ))
        } else {
            setDraft(savedDraft)
            applySavedRelations(refreshedRelations, refreshed.id)
        }
        setSaveError(null)
        setOutgoingLinks(refreshedOutgoing)
        setIncomingLinks(refreshedIncoming)
        void ensureEntryDetails(refreshedIncoming.map((link) => link.a_id))
        setProjectEntryDetailsById((current) => ({...current, [refreshed.id]: refreshed}))
        setProjectEntries((current) => {
            const next = current.map((item) => (
                item.id === refreshed.id
                    ? {
                        ...item,
                        title: refreshed.title,
                        summary: refreshed.summary ?? null,
                        type: refreshed.type ?? null,
                        updated_at: String(refreshed.updated_at ?? ''),
                    }
                    : item
            ))
            projectEntriesRef.current = next
            return next
        })

        if (reason === 'external') {
            if (previousEntry && previousEntry.title !== refreshed.title) {
                await onTitleChangeRef.current?.(refreshed)
            }
            await onSavedRef.current?.(refreshed)
        }

        return refreshed
    }, [
        applySavedRelations,
        ensureEntryDetails,
        entryId, projectId,
        projectEntriesRef, setEntryRelations, setProjectEntries, setProjectEntryDetailsById, setRelationDrafts,
    ])

    useEffect(() => {
        const unlisten = listen<EntryUpdatedEvent>(ENTRY_UPDATED, (event) => {
            if (event.payload.entry_id !== entryId) return
            if (event.payload.source_id === saveSourceIdRef.current) return

            if (hasChangesRef.current) {
                void showAlert('词条已在其他位置更新；当前页面存在未保存修改，已跳过自动覆盖。', 'warning', 'nonInvasive', 2200)
                return
            }

            void reloadEntryFromDatabase('external').catch((e) => {
                logger.error('reload entry after AI update failed', e)
                void showAlert('词条已更新，但页面刷新失败，请手动重新打开词条。', 'warning', 'nonInvasive', 2200)
            })
        })

        return () => {
            unlisten.then((fn) => fn())
        }
    }, [entryId, reloadEntryFromDatabase, showAlert])

    useEffect(() => {
        const unlisten = listen<EntryDeletedEvent>(ENTRY_DELETED, (event) => {
            if (event.payload.entry_id !== entryId) return
            void showAlert('词条已被 AI 删除', 'warning', 'nonInvasive', 2500)
            void onBack?.()
        })
        return () => {
            unlisten.then((fn) => fn())
        }
    }, [entryId, onBack, showAlert])

    const handleDelete = useCallback(async () => {
        if (!entry) return
        const confirmed = await showAlert(
            `确定要删除词条「${entry.title}」吗？此操作不可撤销。`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return
        try {
            await db_delete_entry(entry.id, projectId)
            await onDelete?.()
        } catch (e) {
            void showAlert(`删除失败：${String(e)}`, 'error', 'nonInvasive', 2200)
        }
    }, [entry, onDelete, projectId, showAlert])

    const handleSave = useCallback(async (source: EntrySaveSource = 'manual') => {
        if (!entry || !canSave) return

        setSavingSource(source)
        onSavingChange?.(true)
        setError(null)
        setSaveError(null)

        try {
            if (hasInvalidRelationDrafts) {
                setError('存在未完成的词条关系，请先选择目标词条。')
                setSavingSource(null)
                return
            }

            const submitted = {draft, relationDrafts}
            const submittedEditVersion = userEditVersionRef.current
            await db_update_entry({
                id: entry.id,
                projectId,
                categoryId: draft.categoryId,
                title: trimmedTitle,
                summary: trimmedSummary || null,
                type: draft.type,
                tags: buildEntryTagsPayload(draft.tags, entryTags.localTagSchemas, entry.tags),
                images: draft.images,
            })
            await syncEntryRelationDrafts(entry.id, projectId, relationDrafts, {
                list: db_list_relations_for_entry,
                create: db_create_relation,
                update: db_update_relation,
                delete: db_delete_relation,
            })
            await clearRecoveryAfterSave()

            const refreshed = await reloadEntryFromDatabase('save', submitted)
            if (refreshed.title !== entry.title) {
                await onTitleChange?.(refreshed)
            }
            await onSaved?.(refreshed)
            if (userEditVersionRef.current === submittedEditVersion) {
                setHasUserEdited(false)
            }
            if (source === 'manual') {
                void showAlert('词条已保存', 'success', 'nonInvasive', 1000)
            }
        } catch (e) {
            const message = String(e)
            setError(message)
            setSaveError(message)
            if (message.includes('同名词条')) {
                void showAlert(message, 'warning', 'nonInvasive', 1800)
            }
        } finally {
            setSavingSource(null)
            onSavingChange?.(false)
        }
    }, [entry, canSave, hasInvalidRelationDrafts, trimmedTitle, trimmedSummary, draft, entryTags.localTagSchemas, projectId, relationDrafts, onTitleChange, onSaved, onSavingChange, showAlert, reloadEntryFromDatabase, clearRecoveryAfterSave])

    useEffect(() => {
        if (!shouldAutoSave(active, editorMode === 'edit', hasUserEdited, canSave)) return
        const timer = window.setTimeout(() => {
            void handleSave('auto')
        }, AUTO_SAVE_IDLE_MS)
        return () => window.clearTimeout(timer)
    }, [active, canSave, draft, editorMode, handleSave, hasUserEdited, relationDrafts])

    async function handleTagSchemaSaved(schema: TagSchema) {
        markUserEdited()
        const nextSchemas = entryTags.handleTagSchemaSaved(schema)
        await onTagSchemasChange?.(nextSchemas)
        setTagCreatorOpen(false)
    }

    function handlePageDocumentLinkHover(hover: {href: string | null; rect: {
        top: number; left: number; width: number; height: number
    } | null}) {
        if (!active || editorMode !== 'browse') {
            linkPreview.closeLinkPreview()
            return
        }
        pageDocumentNavigation.hover(hover)
    }

    const relationsPanel = <EntryEditorSidebar {...{
        entryId, entry, editorMode, projectDataLoading, relationDrafts, outgoingLinks, backlinks,
        projectEntries, categories, onOpenEntry,
        saving: savingSource === 'manual',
        entryDetailsById: projectEntryDetailsById,
        onRelationDraftsChange: updateRelationDraftsFromUser,
    }}/>

    return <EntryEditorWorkspace
        active={active}
        entryId={entryId}
        editorMode={editorMode}
        modeSwitch={<div className="entry-editor-mode-switch" role="group" aria-label="词条查看模式">
            <button type="button" className={`entry-editor-mode-chip${editorMode === 'browse' ? ' active' : ''}`}
                    aria-pressed={editorMode === 'browse'} onClick={() => void requestEditorMode('browse')}>浏览</button>
            <button type="button" className={`entry-editor-mode-chip${editorMode === 'edit' ? ' active' : ''}`}
                    aria-pressed={editorMode === 'edit'} aria-disabled={!PAGE_DOCUMENT_LAYERS_SUPPORTED}
                    title={!PAGE_DOCUMENT_LAYERS_SUPPORTED ? '页面编辑需要更新系统 WebView' : undefined}
                    onClick={() => void requestEditorMode('edit')}>编辑</button>
        </div>}
        title={draft.title}
        titleEditingDisabled={editorMode === 'browse' || loading || saving}
        loading={loading}
        saving={saving}
        canSave={canSave}
        saveStatus={saveStatus}
        onBack={() => void handleBack()}
        onTitleCommit={title => updateDraftFromUser(current => (
            current.title === title ? current : {...current, title}
        ))}
        onSave={() => void handleSave()}
        onDelete={onDelete ? () => void handleDelete() : undefined}
        toolbarExtras={<>
            {onOpenWorldMap && <EntryMapLocationOverlay
                active={active}
                projectId={projectId}
                entryId={entryId}
                onEnterMap={onOpenWorldMap}
            />}
            {editorMode === 'browse'
                && normalizeComparableType(draft.type) === 'character'
                && entry
                && onStartCharacterChat && <Button
                type="button"
                size="sm"
                radius="full"
                aria-label={`与${entry.title}开始角色对话`}
                onClick={() => void onStartCharacterChat(entry)}
            >和 TA 聊天</Button>}
        </>}
        informationPanel={<EntryEditorMetaPanel
            showTitle={false}
            entryId={entryId}
            entry={entry}
            draft={draft}
            status={{editorMode, loading, saving: savingSource === 'manual', generatingSummary: summaryGeneration.generating}}
            projectContext={{projectName, categories, entryTypes}}
            tagUi={{
                localTagSchemas: entryTags.localTagSchemas,
                visibleTagSchemas: entryTags.visibleTagSchemas,
                browseVisibleTagSchemas: entryTags.browseVisibleTagSchemas,
                implantedTagSchemaIdSet: entryTags.implantedTagSchemaIdSet,
                availableTagSchemaOptions: entryTags.availableTagSchemaOptions,
                tagSchemaPickerValue: entryTags.tagSchemaPickerValue,
            }}
            ttsVoice={ttsVoiceState}
            actions={{
                onDraftChange: updateDraftFromUser,
                onOpenImageAddModal: () => openImageAddModal('add'),
                onViewImageSet: () => {
                    const coverIndex = draft.images.findIndex(image => image.is_cover)
                    setLightboxIndex(Math.max(0, coverIndex))
                    setLightboxOpen(true)
                },
                onGenerateSummary: summaryGeneration.generate,
                onAddVisibleTagSchema: entryTags.handleAddVisibleTagSchema,
                onRemoveVisibleTagSchema: schema => {
                    markUserEdited()
                    entryTags.handleRemoveVisibleTagSchema(schema)
                },
                onOpenTagCreator: () => setTagCreatorOpen(true),
            }}
        />}
        relationsPanel={relationsPanel}
        recoveryBanner={recoveryNotice && <EntryDraftRecoveryBanner
            record={recoveryNotice.record}
            kind={recoveryNotice.kind}
            fields={recoveryNotice.fields}
            onRestore={handleRestoreRecovery}
            onDiscard={handleDiscardRecovery}
        />}
        mainContent={<>
            {editorMode === 'browse' && <PageDocumentCanvasEntry
                entryId={entryId}
                projectId={projectId}
                title={draft.title}
                summary={draft.summary}
                markdown={draft.content}
                convertLegacyMarkdown
                selectedNodeId={active ? pageDocumentSelection?.nodeId ?? null : null}
                onNavigationIntent={pageDocumentNavigation.navigate}
                onLinkHover={handlePageDocumentLinkHover}
            />}
            {editorMode === 'edit' && PAGE_DOCUMENT_LAYERS_SUPPORTED && (<PageDocumentEditorEntry
                entryId={entryId}
                projectId={projectId}
                categoryId={entry?.category_id ?? null}
                active={active}
                title={draft.title}
                summary={draft.summary}
                markdown={draft.content}
                resetVersion={pageDocumentResetVersion}
                selectionRequest={active ? pageDocumentSelection : null}
                projectEntries={projectEntries}
                onDirtyChange={setPageDocumentDirty}
                onSavedDerivedText={setPageDocumentDerivedText}
                onNavigationIntent={pageDocumentNavigation.navigate}
                onRequestLeave={requestLeavePageDocument}
            />)}
        </>}
        feedback={(error || loading) && <div className={`entry-editor-feedback ${error ? 'is-error' : ''}`}>
            {error || '正在加载词条…'}
        </div>}
        overlays={<>
            <Overlay
                open={active && layerSupportNoticeOpen}
                onClose={() => setLayerSupportNoticeOpen(false)}
                ariaLabel="页面编辑需要更新系统 WebView"
            >
                <div className="entry-editor-layer-support-notice">
                    <h2>页面编辑暂不可用</h2>
                    <p>当前系统 WebView 不支持页面所需的 CSS 层叠层。请更新系统 WebView 后重新打开应用。</p>
                    <Button type="button" onClick={() => setLayerSupportNoticeOpen(false)}>知道了</Button>
                </div>
            </Overlay>
            <EntryEditorLinkPreview
                linkPreview={linkPreview.linkPreview}
                linkPreviewPosition={linkPreview.linkPreviewPosition}
                linkPreviewEntry={linkPreview.linkPreviewEntry}
                panelRef={linkPreviewPanelRef}
                anchorRef={linkPreview.linkPreviewAnchorRef}
                onClearCloseTimer={linkPreview.clearLinkPreviewCloseTimer}
                onScheduleClose={linkPreview.scheduleLinkPreviewClose}
            />
            <EntryImageLightbox
                open={lightboxOpen}
                images={lightboxImages}
                currentIndex={lightboxIndex}
                infoTitle={infoTitle}
                onClose={() => setLightboxOpen(false)}
                onIndexChange={setLightboxIndex}
                onSetCover={editorMode === 'edit' ? imageDraftActions.setCover : undefined}
                onRemove={editorMode === 'edit' ? imageDraftActions.removeImage : undefined}
                onRemoveMany={editorMode === 'edit' ? imageDraftActions.removeImages : undefined}
                onAddImage={() => {
                    reopenLightboxAfterImageAddRef.current = true
                    setLightboxOpen(false)
                    openImageAddModal('add')
                }}
            />
            <TagCreator
                open={tagCreatorOpen}
                projectId={projectId}
                entryTypes={entryTypes}
                existingNames={entryTags.localTagSchemas.map(schema => schema.name)}
                existingCount={entryTags.localTagSchemas.length}
                onClose={() => setTagCreatorOpen(false)}
                onSaved={schema => void handleTagSchemaSaved(schema)}
            />
            <EntryImageAddModal
                open={imageAddModalMode !== null}
                projectId={projectId}
                projectName={projectName}
                entryTitle={draft.title || entry?.title || null}
                entrySummary={draft.summary || entry?.summary || null}
                entryType={draft.type || entry?.type || null}
                aiPluginId={aiPluginId}
                aiModel={aiModel}
                mode={imageAddModalMode ?? 'add'}
                existingImages={draft.images}
                onClose={() => {
                    closeImageAddModal()
                    if (!reopenLightboxAfterImageAddRef.current) return
                    reopenLightboxAfterImageAddRef.current = false
                    setLightboxOpen(true)
                }}
                onUploadLocal={imageDraftActions.uploadImages}
                onOpenPluginManagement={onOpenPluginManagement ? kind => {
                    reopenLightboxAfterImageAddRef.current = false
                    setLightboxOpen(false)
                    onOpenPluginManagement(kind)
                } : undefined}
                onOpenAiSettings={onOpenAiSettings ? pluginId => {
                    reopenLightboxAfterImageAddRef.current = false
                    setLightboxOpen(false)
                    onOpenAiSettings(pluginId)
                } : undefined}
                onAddAiImages={imageDraftActions.addAiImages}
            />
        </>}
    />
}
