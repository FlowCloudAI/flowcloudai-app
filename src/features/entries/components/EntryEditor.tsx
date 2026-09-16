import {logger} from '../../../shared/logger'
import {openFileDialog} from '../../../api/dialog'
import {listen} from '../../../api/events'
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {Button, RollingBox, useAlert} from 'flowcloudai-ui'
import {
    ai_generate_entry_summary,
    ai_list_plugins,
    type Category,
    db_delete_entry,
    db_get_entry,
    db_list_entries,
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
    type EntryBrief,
    type EntryDeletedEvent,
    type EntryLink,
    type EntryRelation,
    type EntryTypeView,
    type EntryUpdatedEvent,
    import_entry_images,
    type PluginInfo,
    setting_get_settings,
    type TagSchema,
} from '../../../api'
import {openUrl} from '../../../api/opener'
import {pageDocumentReadEntry} from '../../../api/pageDocument.ts'
import EntryEditorSidebar from './EntryEditorSidebar'
import EntryImageLightbox from './EntryImageLightbox'
import TagCreator from './TagCreator'
import EntryEditorMetaPanel from './EntryEditorMetaPanel'
import EntryImageAddModal from './EntryImageAddModal'
import EntryDraftRecoveryBanner from './EntryDraftRecoveryBanner'
import useLinkPreview from '../hooks/useLinkPreview'
import useEntryTags from '../hooks/useEntryTags'
import useEntryImageState from '../hooks/useEntryImageState'
import useEntryRelationState from '../hooks/useEntryRelationState'
import useEntrySaveStatus from '../hooks/useEntrySaveStatus'
import {buildEntryTagsPayload,} from './entryTagUtils'
import ActionMenu from '../../../shared/ui/overlay/ActionMenu'

import './EntryEditor.css'
import {
    isSafeExternalHref,
    parseInternalEntryHref,
} from '../lib/entryMarkdown'
import {type EntryImage, normalizeEntryImages,} from '../lib/entryImage'
import {removeEntryImages} from '../lib/entryImageCollection'
import {
    deleteEntryDraftRecovery,
    type EntryDraftRecoveryField,
    type EntryDraftRecoveryRecord,
    getEntryDraftRecoveryFields,
    getEntryDraftRecovery,
    resolveEntryDraftRecoveryKind,
    saveEntryDraftRecovery,
} from '../lib/entryDraftRecovery'
import {areTagMapsEqual, buildAutoVisibleTagSchemaIds,} from '../lib/entryTag'
import {buildRelationDraft,} from '../lib/entryRelation'
import {syncEntryRelationDrafts} from '../lib/entryRelationPersistence.ts'
import {ensureEntryDetailLoaded} from '../lib/entryDetailLoading'
import type {AiMissingPluginKind} from '../../../shared/ui/AiPluginMissingOverlay'
import {
    buildTagValueMap,
    normalizeComparableContent,
    normalizeComparableText,
    normalizeComparableType,
    normalizeEntryContent,
    parseDateValue,
} from '../lib/entryCommon'
import {resolveSavedState, shouldAutoSave} from '../lib/entrySaveState'
import type {EntryRelationDraft} from '../../project-editor/components/EntryRelations/EntryRelationCreator.tsx'
import EntryMapLocationOverlay from '../../maps/components/EntryMapLocationOverlay'
import {PageDocumentCanvasEntry} from '@page-document-canvas-entry'
import {PageDocumentEditorEntry} from '@page-document-editor-entry'
import {type EntryEditorMode} from '../lib/entryEditorShortcutModel'
import {convertMarkdownToPageDocument} from '../../page-document/application/markdownDocumentConversion.ts'

type EntrySaveSource = 'manual' | 'auto'
type TtsVoiceState = {
    plugins: PluginInfo[]
    defaultPluginId: string | null
    defaultModel: string | null
    hint: string
}

interface EntryEditorProps {
    entryId: string
    projectId: string
    projectName: string
    active?: boolean
    aiPluginId?: string | null
    aiModel?: string | null
    categories: Category[]
    entryTypes: EntryTypeView[]
    tagSchemas: TagSchema[]
    initialEditorMode?: EntryEditorMode
    onOpenEntry?: (entry: { id: string; title: string }) => void
    onTitleChange?: (entry: Entry) => void | Promise<void>
    onSaved?: (entry: Entry) => void | Promise<void>
    onTagSchemasChange?: (schemas: TagSchema[]) => void | Promise<void>
    onBack?: () => void | Promise<void>
    onDelete?: () => void | Promise<void>
    onDirtyChange?: (dirty: boolean) => void
    onSavingChange?: (saving: boolean) => void
    onStartCharacterChat?: (entry: Entry) => void | Promise<void>
    onOpenWorldMap?: (target: {mapId: string; locationId: string}) => void
    onOpenPluginManagement?: (kind: AiMissingPluginKind) => void
    onOpenAiSettings?: (pluginId: string) => void
}

interface EntryDraft {
    title: string
    summary: string
    content: string
    type: string | null
    categoryId: string | null
    tags: Record<string, string | number | boolean | null>
    images: EntryImage[]
}

const DEFAULT_TTS_VOICE_STATE: TtsVoiceState = {
    plugins: [],
    defaultPluginId: null,
    defaultModel: null,
    hint: '请先在设置中选择默认 AI 语音插件',
}

const AUTO_SAVE_IDLE_MS = 30_000

function buildDraft(entry: Entry): EntryDraft {
    return {
        title: entry.title ?? '',
        summary: entry.summary ?? '',
        content: normalizeEntryContent(entry),
        type: entry.type ?? null,
        categoryId: entry.category_id ?? null,
        tags: buildTagValueMap(entry),
        images: normalizeEntryImages(entry.images),
    }
}

function areImagesEqual(left: EntryImage[], right: EntryImage[]): boolean {
    if (left.length !== right.length) return false
    return left.every((image, index) => {
        const target = right[index]
        return image.path === target.path
            && image.url === target.url
            && image.alt === target.alt
            && Boolean(image.is_cover) === Boolean(target.is_cover)
    })
}

export default function EntryEditor({
                                        entryId,
                                        projectId,
                                        projectName,
                                        active = true,
                                        aiPluginId = null,
                                        aiModel = null,
                                        categories,
                                        entryTypes,
                                        tagSchemas,
                                        initialEditorMode = 'browse',
                                        onOpenEntry,
                                        onTitleChange,
                                        onSaved,
                                        onTagSchemasChange,
                                        onBack,
                                        onDelete,
                                        onDirtyChange,
                                        onSavingChange,
                                        onStartCharacterChat,
                                        onOpenWorldMap,
                                        onOpenPluginManagement,
                                        onOpenAiSettings,
                                    }: EntryEditorProps) {
    const [entry, setEntry] = useState<Entry | null>(null)
    const [draft, setDraft] = useState<EntryDraft>({
        title: '',
        summary: '',
        content: '',
        type: null,
        categoryId: null,
        tags: {},
        images: [],
    })
    const [loading, setLoading] = useState(false)
    const [savingSource, setSavingSource] = useState<EntrySaveSource | null>(null)
    const saving = savingSource !== null
    const [error, setError] = useState<string | null>(null)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [generatingSummary, setGeneratingSummary] = useState(false)
    const [editorMode, setEditorMode] = useState<EntryEditorMode>(initialEditorMode)
    const [pageDocumentDirty, setPageDocumentDirty] = useState(false)
    const [pageDocumentResetVersion, setPageDocumentResetVersion] = useState(0)
    const [pageDocumentDerivedText, setPageDocumentDerivedText] = useState<string | null>(null)
    const [projectEntries, setProjectEntries] = useState<EntryBrief[]>([])
    const [projectEntryDetailsById, setProjectEntryDetailsById] = useState<Record<string, Entry>>({})

    const [projectDataLoading, setProjectDataLoading] = useState(false)
    const [ttsVoiceState, setTtsVoiceState] = useState<TtsVoiceState>(DEFAULT_TTS_VOICE_STATE)
    const [outgoingLinks, setOutgoingLinks] = useState<EntryLink[]>([])
    const [incomingLinks, setIncomingLinks] = useState<EntryLink[]>([])
    const [tagCreatorOpen, setTagCreatorOpen] = useState(false)
    const [actionMenuOpen, setActionMenuOpen] = useState(false)
    const [hasUserEdited, setHasUserEdited] = useState(false)
    const [recoveryReady, setRecoveryReady] = useState(false)
    const [relationsReady, setRelationsReady] = useState(false)
    const [recoveryNotice, setRecoveryNotice] = useState<{
        record: EntryDraftRecoveryRecord
        kind: ReturnType<typeof resolveEntryDraftRecoveryKind>
        fields: EntryDraftRecoveryField[]
    } | null>(null)
    const {
        setEntryRelations,
        relationDrafts,
        setRelationDrafts,
        initialRelationDrafts,
        hasRelationChanges,
        hasInvalidRelationDrafts,
        clearRelations,
        applySavedRelations,
    } = useEntryRelationState(entryId)
    const {
        lightboxOpen,
        setLightboxOpen,
        lightboxIndex,
        setLightboxIndex,
        lightboxImages,
        imageAddModalMode,
        openImageAddModal,
        closeImageAddModal,
    } = useEntryImageState(draft.images)
    const reopenLightboxAfterImageAddRef = useRef(false)
    const pageScrollRef = useRef<HTMLDivElement | null>(null)
    const workspaceRef = useRef<HTMLElement | null>(null)
    const workspaceHeaderRef = useRef<HTMLDivElement | null>(null)
    const onDirtyChangeRef = useRef(onDirtyChange)
    const projectEntriesRef = useRef(projectEntries)
    const projectEntriesStatusRef = useRef<'idle' | 'loading' | 'loaded'>('idle')
    const loadedDetailIdsRef = useRef(new Set<string>())
    const entryDetailLoadPromisesRef = useRef(new Map<string, Promise<void>>())
    const projectEntriesLoadPromiseRef = useRef<Promise<void> | null>(null)
    const recoveryLoadKeyRef = useRef<string | null>(null)
    const recoveryWriteTimerRef = useRef<number | null>(null)
    const entryRef = useRef<Entry | null>(null)
    const hasChangesRef = useRef(false)
    const saveSourceIdRef = useRef(globalThis.crypto.randomUUID())
    const onSavedRef = useRef(onSaved)
    const onTitleChangeRef = useRef(onTitleChange)
    const userEditVersionRef = useRef(0)
    const projectIdRef = useRef(projectId)

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
    useLayoutEffect(() => {
        projectIdRef.current = projectId
    }, [projectId])

    useLayoutEffect(() => {
        const workspace = workspaceRef.current
        const header = workspaceHeaderRef.current
        if (!workspace || !header) return

        const syncHeaderHeight = () => {
            workspace.style.setProperty('--entry-editor-page-toolbar-height', `${header.offsetHeight}px`)
        }
        syncHeaderHeight()
        const observer = new ResizeObserver(syncHeaderHeight)
        observer.observe(header)
        return () => observer.disconnect()
    }, [])

    // ProjectEditor 会常驻挂载已打开的词条标签；切换 active 不会丢草稿，因此无需确认。

    useEffect(() => {
        projectEntriesRef.current = projectEntries
        onDirtyChangeRef.current = onDirtyChange
        entryRef.current = entry
        onSavedRef.current = onSaved
        onTitleChangeRef.current = onTitleChange
    }, [projectEntries, onDirtyChange, entry, onSaved, onTitleChange])

    useEffect(() => {
        let cancelled = false

        void Promise.all([
            setting_get_settings(),
            ai_list_plugins('tts'),
        ])
            .then(([settings, plugins]) => {
                if (cancelled) return

                const ttsPlugins = plugins as PluginInfo[]
                setTtsVoiceState({
                    plugins: ttsPlugins,
                    defaultPluginId: settings.tts.plugin_id,
                    defaultModel: settings.tts.default_model,
                    hint: ttsPlugins.length > 0 ? '' : '当前没有可用的 AI 语音插件',
                })
            })
            .catch((loadError) => {
                if (cancelled) return
                logger.error('加载 TTS 音色列表失败', loadError)
                setTtsVoiceState({
                    plugins: [],
                    defaultPluginId: null,
                    defaultModel: null,
                    hint: '音色列表加载失败',
                })
            })

        return () => {
            cancelled = true
        }
    }, [])

    const entryTags = useEntryTags({
        tagSchemas,
        draftTags: draft.tags,
        draftType: draft.type,
        entryId,
        onTagsChange: (nextTags) => setDraft((current) => (
            areTagMapsEqual(current.tags, nextTags, tagSchemas) ? current : {...current, tags: nextTags}
        )),
    })

    const ensureEntryDetails = useCallback(async (ids: string[]) => {
        await Promise.all([...new Set(ids)]
            .filter((targetEntryId) => targetEntryId !== entryId)
            .map((targetEntryId) => ensureEntryDetailLoaded(
                targetEntryId,
                loadedDetailIdsRef.current,
                entryDetailLoadPromisesRef.current,
                async () => {
                    const detail = await db_get_entry(targetEntryId, projectId)
                    if (projectIdRef.current !== projectId) return
                    setProjectEntryDetailsById((current) => ({...current, [targetEntryId]: detail}))
                },
            ).catch(() => undefined)))
    }, [entryId, projectId])

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


    useEffect(() => {
        onDirtyChangeRef.current?.(false)
        userEditVersionRef.current = 0
        setHasUserEdited(false)
        recoveryLoadKeyRef.current = null
        setRecoveryReady(false)
        setRecoveryNotice(null)
        if (recoveryWriteTimerRef.current !== null) {
            window.clearTimeout(recoveryWriteTimerRef.current)
            recoveryWriteTimerRef.current = null
        }
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
                setEditorMode(initialEditorMode)
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

    // projectId 变化时重置词条列表状态
    useEffect(() => {
        projectEntriesStatusRef.current = 'idle'
        loadedDetailIdsRef.current.clear()
        entryDetailLoadPromisesRef.current.clear()
        projectEntriesLoadPromiseRef.current = null
        projectEntriesRef.current = []
        setProjectEntries([])
        setProjectEntryDetailsById({})
    }, [projectId])

    useEffect(() => {
        if (!entry || entry.id !== entryId) return
        const initialDraftState = buildDraft(entry)
        const initialVisibleTagSchemaIds = buildAutoVisibleTagSchemaIds(entryTags.localTagSchemas, initialDraftState.tags, initialDraftState.type)
        entryTags.setPinnedTagSchemaIds((current) => (current.length === 0 ? initialVisibleTagSchemaIds : current))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entry, entryId, entryTags.localTagSchemas, entryTags.setPinnedTagSchemaIds])

    // 按需加载：进入编辑模式或需要双链时调用
    const ensureProjectEntriesLoaded = useCallback(async () => {
        if (projectEntriesStatusRef.current === 'loaded') return
        if (projectEntriesLoadPromiseRef.current) return projectEntriesLoadPromiseRef.current

        projectEntriesStatusRef.current = 'loading'
        projectEntriesLoadPromiseRef.current = (async () => {
            setProjectDataLoading(true)
            try {
                const briefs = await db_list_entries({projectId, limit: 1000, offset: 0})
                projectEntriesRef.current = briefs
                setProjectEntries(briefs)
                projectEntriesStatusRef.current = 'loaded'
            } catch {
                projectEntriesStatusRef.current = 'idle'
            } finally {
                setProjectDataLoading(false)
                projectEntriesLoadPromiseRef.current = null
            }
        })()

        return projectEntriesLoadPromiseRef.current
    }, [projectId])

    useEffect(() => {
        if (!active) return
        void ensureProjectEntriesLoaded()
    }, [active, ensureProjectEntriesLoaded])
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

    useEffect(() => {
        if (!entry || entry.id !== entryId || !initialDraft || !relationsReady) return
        const currentUpdatedAt = String(entry.updated_at ?? '')
        const loadKey = JSON.stringify([projectId, entryId, currentUpdatedAt])
        if (recoveryLoadKeyRef.current === loadKey) return
        recoveryLoadKeyRef.current = loadKey
        setRecoveryReady(false)
        setRecoveryNotice(null)

        let cancelled = false
        void getEntryDraftRecovery(projectId, entryId)
            .then((record) => {
                if (cancelled || !record) return
                const fields = getEntryDraftRecoveryFields(record, {
                    ...initialDraft,
                    relationDrafts: initialRelationDrafts,
                }).filter(field => field !== 'content')
                if (fields.length === 0) {
                    void deleteEntryDraftRecovery(projectId, entryId).catch((recoveryError) => {
                        logger.error('delete redundant entry recovery failed', recoveryError)
                    })
                    return
                }
                setRecoveryNotice({
                    record,
                    kind: resolveEntryDraftRecoveryKind(record, currentUpdatedAt),
                    fields,
                })
            })
            .catch((recoveryError) => {
                logger.error('load entry recovery failed', recoveryError)
            })
            .finally(() => {
                if (!cancelled) setRecoveryReady(true)
            })

        return () => {
            cancelled = true
        }
    }, [
        entry,
        entryId,
        initialDraft,
        initialRelationDrafts,
        projectId,
        relationsReady,
    ])

    useEffect(() => {
        if (recoveryWriteTimerRef.current !== null) {
            window.clearTimeout(recoveryWriteTimerRef.current)
            recoveryWriteTimerRef.current = null
        }
        if (!entry || !comparableInitial || !recoveryReady || !hasUserEdited) return

        if (!hasChanges) {
            void deleteEntryDraftRecovery(projectId, entryId).catch((recoveryError) => {
                logger.error('delete entry recovery failed', recoveryError)
            })
            return
        }

        recoveryWriteTimerRef.current = window.setTimeout(() => {
            recoveryWriteTimerRef.current = null
            void saveEntryDraftRecovery({
                projectId,
                entryId,
                baseUpdatedAt: String(entry.updated_at ?? ''),
                savedAt: Date.now(),
                draft: {
                    ...draft,
                    tags: {...draft.tags},
                    images: draft.images.map((image) => ({...image})),
                    relationDrafts: relationDrafts.map((relation) => ({...relation})),
                },
            }).catch((recoveryError) => {
                logger.error('save entry recovery failed', recoveryError)
            })
        }, 1000)

        return () => {
            if (recoveryWriteTimerRef.current !== null) {
                window.clearTimeout(recoveryWriteTimerRef.current)
                recoveryWriteTimerRef.current = null
            }
        }
    }, [
        comparableInitial,
        draft,
        entry,
        entryId,
        hasChanges,
        hasUserEdited,
        projectId,
        recoveryReady,
        relationDrafts,
    ])

    const handleRestoreRecovery = useCallback((fields: EntryDraftRecoveryField[]) => {
        if (!recoveryNotice) return
        markUserEdited()
        const snapshot = recoveryNotice.record.draft
        setDraft((current) => ({
            title: fields.includes('title') && snapshot.title !== undefined ? snapshot.title : current.title,
            summary: fields.includes('summary') && snapshot.summary !== undefined ? snapshot.summary : current.summary,
            content: current.content,
            type: fields.includes('type') && snapshot.type !== undefined ? snapshot.type : current.type,
            categoryId: fields.includes('categoryId') && snapshot.categoryId !== undefined
                ? snapshot.categoryId
                : current.categoryId,
            tags: fields.includes('tags') && snapshot.tags ? {...snapshot.tags} : current.tags,
            images: fields.includes('images') && snapshot.images
                ? snapshot.images.map((image) => ({...image}))
                : current.images,
        }))
        if (fields.includes('relationDrafts') && snapshot.relationDrafts) {
            setRelationDrafts(snapshot.relationDrafts.map((relation) => ({...relation})))
        }
        setEditorMode('edit')
        setRecoveryNotice(null)
        void deleteEntryDraftRecovery(projectId, entryId).catch((recoveryError) => {
            logger.error('delete restored entry recovery failed', recoveryError)
        })
    }, [entryId, markUserEdited, projectId, recoveryNotice, setRelationDrafts])

    const handleDiscardRecovery = useCallback(() => {
        setRecoveryNotice(null)
        void deleteEntryDraftRecovery(projectId, entryId).catch((recoveryError) => {
            logger.error('discard entry recovery failed', recoveryError)
        })
    }, [entryId, projectId])

    const convertedLegacyText = useMemo(
        () => convertMarkdownToPageDocument(entryId, draft.content).derivedText,
        [draft.content, entryId],
    )
    const documentBodyText = pageDocumentDerivedText ?? convertedLegacyText

    const handleGenerateSummary = useCallback(async () => {
        if (generatingSummary || loading || saving) return
        if (!aiPluginId) {
            await showAlert('当前还没有可用的 AI 插件，请先在右侧 AI 面板选择或配置模型。', 'warning', 'nonInvasive', 2200)
            return
        }

        const fallbackTitle = normalizeComparableText(draft.title) || entry?.title || '未命名词条'
        const draftContent = normalizeComparableText(documentBodyText)
        if (!draftContent) {
            await showAlert('正文为空，无法生成摘要。', 'warning', 'nonInvasive', 1800)
            return
        }

        setGeneratingSummary(true)
        try {
            const result = await ai_generate_entry_summary({
                pluginId: aiPluginId,
                projectId,
                entryIds: [entryId],
                outputMode: 'entry_field',
                focus: `请概括词条《${fallbackTitle}》的核心设定，输出适合放在摘要字段中的中文。`,
                draftEntry: {
                    entryId,
                    title: fallbackTitle,
                    summary: normalizeComparableText(draft.summary) || null,
                    content: documentBodyText,
                    entryType: draft.type,
                },
                model: aiModel || null,
            })

            const nextSummary = normalizeComparableText(result.summaryMarkdown)
            if (!nextSummary) {
                throw new Error('AI 未返回可用摘要')
            }

            updateDraftFromUser((current) => (
                normalizeComparableText(current.summary) === nextSummary
                    ? current
                    : {...current, summary: nextSummary}
            ))
            await showAlert('已生成摘要', 'success', 'nonInvasive', 1500)
        } catch (summaryError) {
            logger.error('generate summary failed', summaryError)
            const message = summaryError instanceof Error ? summaryError.message : '生成摘要失败'
            await showAlert(message, 'error', 'nonInvasive', 2200)
        } finally {
            setGeneratingSummary(false)
        }
    }, [
        aiModel,
        aiPluginId,
        draft.summary,
        draft.title,
        draft.type,
        entry?.title,
        entryId,
        generatingSummary,
        loading,
        documentBodyText,
        projectId,
        saving,
        showAlert,
        updateDraftFromUser,
    ])
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

    const backlinks = useMemo(() => {
        const linkedEntryIds = new Set(incomingLinks.map((link) => link.a_id))
        return Object.values(projectEntryDetailsById)
            .filter((item) => item.id !== entryId && linkedEntryIds.has(item.id))
            .sort((left, right) => parseDateValue(right.updated_at as string | null | undefined) - parseDateValue(left.updated_at as string | null | undefined))
            .map((item) => ({
                id: item.id,
                project_id: item.project_id,
                category_id: item.category_id ?? null,
                title: item.title,
                summary: item.summary ?? null,
                type: item.type ?? null,
                cover: null,
                updated_at: String(item.updated_at ?? ''),
                content: item.content,
            }))
    }, [projectEntryDetailsById, entryId, incomingLinks])

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
        entryId,
        projectId,
        setEntryRelations,
        setRelationDrafts,
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
            if (recoveryWriteTimerRef.current !== null) {
                window.clearTimeout(recoveryWriteTimerRef.current)
                recoveryWriteTimerRef.current = null
            }
            await deleteEntryDraftRecovery(projectId, entryId).catch((recoveryError) => {
                logger.error('delete saved entry recovery failed', recoveryError)
            })
            setRecoveryNotice(null)

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
    }, [entry, canSave, hasInvalidRelationDrafts, trimmedTitle, trimmedSummary, draft, entryTags.localTagSchemas, projectId, entryId, relationDrafts, onTitleChange, onSaved, onSavingChange, showAlert, reloadEntryFromDatabase])

    useEffect(() => {
        if (!shouldAutoSave(active, editorMode === 'edit', hasUserEdited, canSave)) return
        const timer = window.setTimeout(() => {
            void handleSave('auto')
        }, AUTO_SAVE_IDLE_MS)
        return () => window.clearTimeout(timer)
    }, [active, canSave, draft, editorMode, handleSave, hasUserEdited, relationDrafts])

    async function handleUploadImages(): Promise<EntryImage[]> {
        try {
            const selected = await openFileDialog({
                multiple: true,
                filters: [{
                    name: 'Images',
                    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
                }],
            })
            const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
            if (!paths.length) return []
            const importedImages = await import_entry_images(projectId, paths)
            const nextImportedImages = importedImages.map((image, index) => ({
                ...image,
                alt: image.alt || (image.path?.split(/[\\/]/).pop() ?? `图片 ${index + 1}`),
            }))
            updateDraftFromUser((current) => {
                const nextImages = [...current.images]
                nextImportedImages.forEach((image, index) => {
                    nextImages.push({
                        ...image,
                        is_cover: nextImages.length === 0 && index === 0,
                    })
                })
                return {
                    ...current,
                    images: nextImages,
                }
            })
            return nextImportedImages
        } catch (e) {
            setError(String(e))
            return []
        }
    }

    function handleAddAiImages(aiImages: EntryImage[]) {
        updateDraftFromUser((current) => {
            const nextImages = [...current.images]
            aiImages.forEach((image, index) => {
                nextImages.push({
                    ...image,
                    is_cover: nextImages.length === 0 && index === 0,
                })
            })
            return {
                ...current,
                images: nextImages,
            }
        })
    }

    function handleSetCover(targetIndex: number) {
        updateDraftFromUser((current) => ({
            ...current,
            images: current.images.map((image, index) => ({
                ...image,
                is_cover: index === targetIndex,
            })),
        }))
    }

    function handleRemoveImage(targetIndex: number) {
        handleRemoveImages([targetIndex])
    }

    function handleRemoveImages(indices: number[]) {
        updateDraftFromUser((current) => ({
            ...current,
            images: removeEntryImages(current.images, indices),
        }))
    }

    function handlePageDocumentNavigation(href: string) {
        const internalLink = parseInternalEntryHref(href)
        if (internalLink) {
            void ensureProjectEntriesLoaded().then(() => {
                linkPreview.handleOpenLinkedEntry(internalLink)
            })
            return
        }
        if (!isSafeExternalHref(href)) return
        void openUrl(href).catch((openError) => {
            logger.error('open page document external link failed', openError)
            void showAlert('打开链接失败', 'error', 'nonInvasive', 1500)
        })
    }

    async function handleTagSchemaSaved(schema: TagSchema) {
        markUserEdited()
        const nextSchemas = entryTags.handleTagSchemaSaved(schema)
        await onTagSchemasChange?.(nextSchemas)
        setTagCreatorOpen(false)
    }

    return (
        <div className="entry-editor-page">
            <RollingBox ref={pageScrollRef} axis="y" className="entry-editor-page__scroll" thumbSize="thin">
                <div className="entry-editor-shell">
                    <section
                        ref={workspaceRef}
                        className={`entry-editor-workspace${editorMode === 'edit' ? ' is-editing' : ''}`}
                    >
                        <div ref={workspaceHeaderRef} className="entry-editor-workspace__header">
                            <div className="entry-editor-workspace__toolbar" data-mobile-horizontal-scroll>
                                <div className="entry-editor-workspace__toolbar-main">
                                    <button
                                        type="button"
                                        className="entry-editor-back-button"
                                        onClick={() => void handleBack()}
                                        disabled={!onBack}
                                    >
                                        <svg viewBox="0 0 24 24" aria-hidden="true">
                                            <path
                                                d="M14.5 6.5L9 12l5.5 5.5"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="1.8"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        </svg>
                                        <span>返回</span>
                                    </button>
                                    <div className="entry-editor-mode-switch" role="group" aria-label="词条查看模式">
                                        <button
                                            type="button"
                                            className={`entry-editor-mode-chip${editorMode === 'browse' ? ' active' : ''}`}
                                            aria-pressed={editorMode === 'browse'}
                                            onClick={() => void requestEditorMode('browse')}
                                        >
                                            浏览
                                        </button>
                                        <button
                                            type="button"
                                            className={`entry-editor-mode-chip${editorMode === 'edit' ? ' active' : ''}`}
                                            aria-pressed={editorMode === 'edit'}
                                            onClick={() => void requestEditorMode('edit')}
                                        >
                                            编辑
                                        </button>
                                    </div>
                                </div>
                                <div className="entry-editor-workspace__toolbar-actions">
                                    {onOpenWorldMap && (
                                        <EntryMapLocationOverlay
                                            active={active}
                                            projectId={projectId}
                                            entryId={entryId}
                                            onEnterMap={onOpenWorldMap}
                                        />
                                    )}
                                    {editorMode === 'edit' && (
                                        <span
                                            className={`entry-editor-save-state is-${saveStatus.kind}`}
                                            title={saveStatus.detail}
                                            role={saveStatus.kind === 'error' ? 'alert' : 'status'}
                                        >
                                            {saveStatus.text}
                                        </span>
                                    )}
                                    {editorMode === 'browse'
                                        && normalizeComparableType(draft.type) === 'character'
                                        && entry
                                        && onStartCharacterChat && (
                                        <Button
                                            type="button"
                                            size="sm"
                                            radius="full"
                                            aria-label={`与${entry.title}开始角色对话`}
                                            onClick={() => void onStartCharacterChat(entry)}
                                        >
                                            和 TA 聊天
                                        </Button>
                                    )}
                                    {editorMode === 'edit' && (
                                        <Button
                                            type="button"
                                            size="sm"
                                            radius="full"
                                            disabled={!canSave}
                                            onClick={() => void handleSave()}
                                        >
                                            {saving ? '保存中…' : '保存修改'}
                                        </Button>
                                    )}
                                    {onDelete && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            radius="full"
                                            className="entry-editor-more-button"
                                            aria-label="更多词条操作"
                                            disabled={loading || saving}
                                            onClick={() => setActionMenuOpen(true)}
                                        >
                                            更多
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="entry-editor-workspace__body">
                            <EntryEditorMetaPanel
                                    entryId={entryId}
                                    entry={entry}
                                    draft={draft}
                                    status={{
                                        editorMode,
                                        loading,
                                        saving: savingSource === 'manual',
                                        generatingSummary,
                                    }}
                                    projectContext={{
                                        projectName,
                                        categories,
                                        entryTypes,
                                    }}
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
                                            const coverIndex = draft.images.findIndex((image) => image.is_cover)
                                            setLightboxIndex(Math.max(0, coverIndex))
                                            setLightboxOpen(true)
                                        },
                                        onGenerateSummary: handleGenerateSummary,
                                        onAddVisibleTagSchema: entryTags.handleAddVisibleTagSchema,
                                        onRemoveVisibleTagSchema: (schema) => {
                                            markUserEdited()
                                            entryTags.handleRemoveVisibleTagSchema(schema)
                                        },
                                        onOpenTagCreator: () => setTagCreatorOpen(true),
                                    }}
                                />
                            {recoveryNotice && (
                                <EntryDraftRecoveryBanner
                                    record={recoveryNotice.record}
                                    kind={recoveryNotice.kind}
                                    fields={recoveryNotice.fields}
                                    onRestore={handleRestoreRecovery}
                                    onDiscard={handleDiscardRecovery}
                                />
                            )}
                            {editorMode === 'browse' && (
                                <PageDocumentCanvasEntry
                                    entryId={entryId}
                                    projectId={projectId}
                                    title={draft.title}
                                    summary={draft.summary}
                                    markdown={draft.content}
                                    convertLegacyMarkdown
                                    onNavigationIntent={handlePageDocumentNavigation}
                                />
                            )}
                            {editorMode === 'edit' && (
                                <PageDocumentEditorEntry
                                    entryId={entryId}
                                    projectId={projectId}
                                    categoryId={entry?.category_id ?? null}
                                    active={active}
                                    title={draft.title}
                                    summary={draft.summary}
                                    markdown={draft.content}
                                    resetVersion={pageDocumentResetVersion}
                                    onDirtyChange={setPageDocumentDirty}
                                    onSavedDerivedText={setPageDocumentDerivedText}
                                    onNavigationIntent={handlePageDocumentNavigation}
                                    onRequestLeave={requestLeavePageDocument}
                                />
                            )}
                        </div>
                    </section>

                    <EntryEditorSidebar
                            entryId={entryId}
                            entry={entry}
                            editorMode={editorMode}
                            saving={savingSource === 'manual'}
                            projectDataLoading={projectDataLoading}
                            relationDrafts={relationDrafts}
                            outgoingLinks={outgoingLinks}
                            backlinks={backlinks}
                            projectEntries={projectEntries}
                            entryDetailsById={projectEntryDetailsById}
                            categories={categories}
                            onOpenEntry={onOpenEntry}
                            onRelationDraftsChange={updateRelationDraftsFromUser}
                        />

                    {(error || loading) && (
                        <div className={`entry-editor-feedback ${error ? 'is-error' : ''}`}>
                            {error || '正在加载词条…'}
                        </div>
                    )}
                </div>
            </RollingBox>

            <ActionMenu
                open={actionMenuOpen}
                onClose={() => setActionMenuOpen(false)}
                title={draft.title || entry?.title || '词条操作'}
                ariaLabel="更多词条操作"
                items={[{
                    key: 'delete-entry',
                    label: '删除词条',
                    danger: true,
                    disabled: loading || saving,
                    onSelect: () => void handleDelete(),
                }]}
            />

            <EntryImageLightbox
                open={lightboxOpen}
                images={lightboxImages}
                currentIndex={lightboxIndex}
                infoTitle={infoTitle}
                onClose={() => setLightboxOpen(false)}
                onIndexChange={setLightboxIndex}
                onSetCover={editorMode === 'edit' ? handleSetCover : undefined}
                onRemove={editorMode === 'edit' ? handleRemoveImage : undefined}
                onRemoveMany={editorMode === 'edit' ? handleRemoveImages : undefined}
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
                existingNames={entryTags.localTagSchemas.map((schema) => schema.name)}
                existingCount={entryTags.localTagSchemas.length}
                onClose={() => setTagCreatorOpen(false)}
                onSaved={(schema) => void handleTagSchemaSaved(schema)}
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
                onUploadLocal={handleUploadImages}
                onOpenPluginManagement={onOpenPluginManagement ? (kind) => {
                    reopenLightboxAfterImageAddRef.current = false
                    setLightboxOpen(false)
                    onOpenPluginManagement(kind)
                } : undefined}
                onOpenAiSettings={onOpenAiSettings ? (pluginId) => {
                    reopenLightboxAfterImageAddRef.current = false
                    setLightboxOpen(false)
                    onOpenAiSettings(pluginId)
                } : undefined}
                onAddAiImages={handleAddAiImages}
            />
        </div>
    )
}
