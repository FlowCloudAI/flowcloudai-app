import {logger} from '../../../shared/logger'
import {rehypeSanitizeRawHtml} from '../../../shared/markdown/rehypeSanitizeRawHtml'
import {openFileDialog} from '../../../api/dialog'
import {listen} from '../../../api/events'
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {ICommand} from '@uiw/react-md-editor'
import {Button, RollingBox, useAlert} from 'flowcloudai-ui'
import {
    ai_generate_entry_summary,
    ai_list_plugins,
    type Category,
    db_create_entry,
    db_delete_entry,
    db_get_entry,
    db_list_entries,
    db_list_incoming_links,
    db_list_outgoing_links,
    db_list_relations_for_entry,
    db_save_entry_bundle,
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
import EntryEditorSidebar from './EntryEditorSidebar'
import {MarkdownEditor, type MarkdownEditorRef} from './MarkdownEditor/MarkdownEditor'
import EntryImageLightbox from './EntryImageLightbox'
import TagCreator from './TagCreator'
import EntryEditorMetaPanel from './EntryEditorMetaPanel'
import EntryImageAddModal from './EntryImageAddModal'
import EntryEditorWikiLink from './EntryEditorWikiLink'
import EntryEditorLinkPreview from './EntryEditorLinkPreview'
import EntryMarkdownToolbar, {
    EntryMarkdownSelectionToolbar,
} from './EntryMarkdownToolbar'
import EntryMarkdownFindBar, {
    type EntryMarkdownFindBarRef,
} from './EntryMarkdownFindBar'
import EntryMarkdownOutline from './EntryMarkdownOutline'
import EntryDraftRecoveryBanner from './EntryDraftRecoveryBanner'
import {
    buildListEnterEdit,
    resolveMarkdownBlockStyle,
    type MarkdownBlockStyle,
} from './entryMarkdownToolbarCommands'
import {
    type MarkdownTextMatch,
    replaceMarkdownTextMatch,
    replaceMarkdownTextMatches,
} from './entryMarkdownSearch'
import {
    resolveSelectionToolbarPlacement,
    type SelectionToolbarPlacement,
} from './entrySelectionToolbar'
import {
    buildMarkdownOutline,
    type MarkdownOutlineItem,
} from './entryMarkdownOutlineUtils'
import useWikiLink from '../hooks/useWikiLink'
import useLinkPreview from '../hooks/useLinkPreview'
import useEntryTags from '../hooks/useEntryTags'
import useEntryImageState from '../hooks/useEntryImageState'
import useEntryRelationState from '../hooks/useEntryRelationState'
import useEntrySaveStatus from '../hooks/useEntrySaveStatus'
import {buildEntryTagsPayload,} from './entryTagUtils'
import ActionMenu from '../../../shared/ui/overlay/ActionMenu'

import './EntryEditor.css'
import {
    buildMarkdownPreviewSource,
    type InternalEntryLink,
    isSafeExternalHref,
    parseInternalEntryHref,
    resolveMarkdownAnchor,
} from '../lib/entryMarkdown'
import {resolveMarkdownPreviewSourceContent} from '../lib/entryMarkdownPreviewState'
import {buildEntryImageMarkdownRef, type EntryImage, normalizeEntryImages,} from '../lib/entryImage'
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
import {ensureEntryDetailLoaded} from '../lib/entryDetailLoading'
import {useUndoRedo} from '../../../shared/hooks/useUndoRedo'
import type {AiMissingPluginKind} from '../../../shared/ui/AiPluginMissingOverlay'
import {
    buildTagValueMap,
    findCategoryDuplicatedEntry,
    getTextareaCaretOffset,
    normalizeComparableContent,
    normalizeComparableText,
    normalizeComparableType,
    normalizeEntryContent,
    parseDateValue,
} from '../lib/entryCommon'
import {resolveSavedState, shouldAutoSave} from '../lib/entrySaveState'
import type {EntryRelationDraft} from '../../project-editor/components/EntryRelations/EntryRelationCreator.tsx'
import EntryMapLocationOverlay from '../../maps/components/EntryMapLocationOverlay'

type EditorMode = 'edit' | 'browse'
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
    initialEditorMode?: EditorMode
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

interface EditorHistory {
    draft: EntryDraft
    relationDrafts: EntryRelationDraft[]
    selection?: {
        start: number
        end: number
    }
}

const DEFAULT_TTS_VOICE_STATE: TtsVoiceState = {
    plugins: [],
    defaultPluginId: null,
    defaultModel: null,
    hint: '请先在设置中选择默认 AI 语音插件',
}

const ENTRY_MARKDOWN_PREVIEW_OPTIONS = {
    rehypePlugins: [rehypeSanitizeRawHtml],
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

function escapeMarkdownImageAlt(value: string): string {
    return value.replace(/[[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim()
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
    const [editorFontSize, setEditorFontSize] = useState(14)
    const [generatingSummary, setGeneratingSummary] = useState(false)
    const [editorMode, setEditorMode] = useState<EditorMode>(initialEditorMode)
    const [projectEntries, setProjectEntries] = useState<EntryBrief[]>([])
    const [projectEntryDetailsById, setProjectEntryDetailsById] = useState<Record<string, Entry>>({})

    const [projectDataLoading, setProjectDataLoading] = useState(false)
    const [ttsVoiceState, setTtsVoiceState] = useState<TtsVoiceState>(DEFAULT_TTS_VOICE_STATE)
    const [outgoingLinks, setOutgoingLinks] = useState<EntryLink[]>([])
    const [incomingLinks, setIncomingLinks] = useState<EntryLink[]>([])
    const [tagCreatorOpen, setTagCreatorOpen] = useState(false)
    const [actionMenuOpen, setActionMenuOpen] = useState(false)
    const [editorSplitView, setEditorSplitView] = useState(false)
    const [debouncedContent, setDebouncedContent] = useState('')
    const [findBarOpen, setFindBarOpen] = useState(false)
    const [markdownSearchHighlights, setMarkdownSearchHighlights] = useState<{
        matches: MarkdownTextMatch[]
        activeIndex: number
    } | null>(null)
    const [outlineOpen, setOutlineOpen] = useState(false)
    const [activeBlockStyle, setActiveBlockStyle] = useState<MarkdownBlockStyle>('paragraph')
    const [hasUserEdited, setHasUserEdited] = useState(false)
    const [recoveryReady, setRecoveryReady] = useState(false)
    const [relationsReady, setRelationsReady] = useState(false)
    const [recoveryNotice, setRecoveryNotice] = useState<{
        record: EntryDraftRecoveryRecord
        kind: ReturnType<typeof resolveEntryDraftRecoveryKind>
        fields: EntryDraftRecoveryField[]
    } | null>(null)
    const [selectionToolbarPosition, setSelectionToolbarPosition] = useState<{
        left: number
        top: number
        placement: SelectionToolbarPlacement
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
    const markdownContainerRef = useRef<HTMLDivElement | null>(null)
    const findBarRef = useRef<EntryMarkdownFindBarRef>(null)
    const wikiPopoverRef = useRef<HTMLDivElement | null>(null)
    const previewContainerRef = useRef<HTMLDivElement | null>(null)
    const linkPreviewPanelRef = useRef<HTMLDivElement | null>(null)
    const onDirtyChangeRef = useRef(onDirtyChange)
    const projectEntriesRef = useRef(projectEntries)
    const projectEntriesStatusRef = useRef<'idle' | 'loading' | 'loaded'>('idle')
    const loadedDetailIdsRef = useRef(new Set<string>())
    const entryDetailLoadPromisesRef = useRef(new Map<string, Promise<void>>())
    const projectEntriesLoadPromiseRef = useRef<Promise<void> | null>(null)
    const canSaveRef = useRef(false)
    const saveActionRef = useRef<((source: EntrySaveSource) => void) | null>(null)
    const editorRef = useRef<MarkdownEditorRef>(null)
    const recoveryLoadKeyRef = useRef<string | null>(null)
    const recoveryWriteTimerRef = useRef<number | null>(null)
    const isApplyingHistoryRef = useRef(false)
    const historyInitializedRef = useRef<string | null>(null)
    const entryRef = useRef<Entry | null>(null)
    const hasChangesRef = useRef(false)
    const saveSourceIdRef = useRef(globalThis.crypto.randomUUID())
    const onSavedRef = useRef(onSaved)
    const onTitleChangeRef = useRef(onTitleChange)
    const lastSuccessfulSaveAtRef = useRef(0)
    const userEditVersionRef = useRef(0)
    const projectIdRef = useRef(projectId)

    const undoRedo = useUndoRedo<EditorHistory>({draft, relationDrafts: []})
    const {showAlert} = useAlert()
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
    const buildEditorHistory = useCallback((
        nextDraft: EntryDraft,
        nextRelationDrafts: EntryRelationDraft[],
    ): EditorHistory => {
        const textarea = editorRef.current?.getTextareaElement()
        return {
            draft: nextDraft,
            relationDrafts: nextRelationDrafts,
            selection: textarea
                ? {start: textarea.selectionStart, end: textarea.selectionEnd}
                : undefined,
        }
    }, [])

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

    useEffect(() => {
        setSelectionToolbarPosition(null)
        setFindBarOpen(false)
        setOutlineOpen(false)
        setActiveBlockStyle('paragraph')
    }, [entryId, editorMode])

    useEffect(() => {
        lastSuccessfulSaveAtRef.current = Date.now()
    }, [])

    useEffect(() => {
        projectEntriesRef.current = projectEntries
        onDirtyChangeRef.current = onDirtyChange
        entryRef.current = entry
        onSavedRef.current = onSaved
        onTitleChangeRef.current = onTitleChange
    }, [projectEntries, onDirtyChange, entry, onSaved, onTitleChange])

    useEffect(() => {
        let cancelled = false

        void setting_get_settings()
            .then((settings) => {
                if (cancelled) return
                setEditorFontSize(settings.editor_font_size ?? 14)
            })
            .catch((loadError) => {
                logger.error('加载编辑器字体设置失败', loadError)
            })

        function handleFontSizeChange(event: Event) {
            const fontSize = (event as CustomEvent<{ fontSize: number }>).detail.fontSize
            setEditorFontSize(fontSize ?? 14)
        }

        window.addEventListener('fc:editor-font-size-change', handleFontSizeChange)

        return () => {
            cancelled = true
            window.removeEventListener('fc:editor-font-size-change', handleFontSizeChange)
        }
    }, [])

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

    const wikiLink = useWikiLink({
        projectId,
        entryId,
        entryCategoryId: entry?.category_id,
        projectEntries,
        content: draft.content,
        containerRef: markdownContainerRef,
        popoverRef: wikiPopoverRef,
        onContentChange: (nextContent) => updateDraftFromUser((current) => (
            current.content === nextContent ? current : {...current, content: nextContent}
        )),
        onCreateEntry: async (title) => {
            const duplicatedEntry = await findCategoryDuplicatedEntry(projectId, entry?.category_id ?? null, title)
            if (duplicatedEntry) {
                await showAlert('当前分类下已存在同名词条，请直接选择已有词条。', 'warning', 'nonInvasive', 1800)
                return null
            }
            const created = await db_create_entry({
                projectId,
                categoryId: entry?.category_id ?? null,
                title,
                summary: null,
                content: null,
                type: null,
                tags: null,
                images: null,
            })
            const brief: EntryBrief = {
                id: created.id,
                project_id: created.project_id,
                category_id: created.category_id ?? null,
                title: created.title,
                summary: created.summary ?? null,
                type: created.type ?? null,
                cover: null,
                updated_at: String(created.updated_at ?? ''),
            }
            setProjectEntries((current) => {
                const next = [brief, ...current]
                projectEntriesRef.current = next
                return next
            })
            loadedDetailIdsRef.current.add(created.id)
            setProjectEntryDetailsById((current) => ({...current, [created.id]: created}))
            return {id: created.id, title: created.title}
        },
        onShowAlert: (message, type) => {
            if (type === 'success') {
                void showAlert(message, type, 'nonInvasive')
                return
            }
            void showAlert(message, type, 'nonInvasive', 1000)
        },
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
        lastSuccessfulSaveAtRef.current = Date.now()
        userEditVersionRef.current = 0
        setHasUserEdited(false)
        recoveryLoadKeyRef.current = null
        setRecoveryReady(false)
        setRecoveryNotice(null)
        if (recoveryWriteTimerRef.current !== null) {
            window.clearTimeout(recoveryWriteTimerRef.current)
            recoveryWriteTimerRef.current = null
        }
        // 切换词条时重置历史追踪
        historyInitializedRef.current = null
        undoRedo.reset(buildEditorHistory(
            {title: '', summary: '', content: '', type: null, categoryId: null, tags: {}, images: []},
            [],
        ))
    }, [entryId]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setSavingSource(null)
        setError(null)
        setSaveError(null)
        linkPreview.closeLinkPreview()
        wikiLink.setWikiDraft?.(null)
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
                lastSuccessfulSaveAtRef.current = Date.now()
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
    }, [linkPreview.closeLinkPreview, wikiLink.setWikiDraft, entryId, clearRelations, applySavedRelations])

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

    // 每次加载词条时初始化历史记录（词条和关联都就绪后触发）
    useEffect(() => {
        if (!entry || entry.id !== entryId || !relationsReady) return
        if (historyInitializedRef.current === entryId) return
        historyInitializedRef.current = entryId
        undoRedo.reset(buildEditorHistory(draft, relationDrafts))
    }, [entry, entryId, draft, relationDrafts, relationsReady]) // eslint-disable-line react-hooks/exhaustive-deps

    // 草稿/关联变更时自动推送历史快照（防抖以避免每次按键都记录）
    useEffect(() => {
        if (!entry || entry.id !== entryId) return
        if (historyInitializedRef.current !== entryId) return
        if (isApplyingHistoryRef.current) {
            isApplyingHistoryRef.current = false
            return
        }
        undoRedo.pushDebounced(buildEditorHistory(draft, relationDrafts))
    }, [draft, relationDrafts]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const normalizedContent = useMemo(() => normalizeComparableContent(draft.content), [draft.content])
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
    const hasBodyChanges = Boolean(
        comparableInitial && normalizedContent !== comparableInitial.content,
    )
    const hasChanges = Boolean(
        comparableInitial && (
            trimmedTitle !== comparableInitial.title
            || trimmedSummary !== comparableInitial.summary
            || hasBodyChanges
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
                })
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
            content: fields.includes('content') && snapshot.content !== undefined ? snapshot.content : current.content,
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

    const handleGenerateSummary = useCallback(async () => {
        if (generatingSummary || loading || saving) return
        if (!aiPluginId) {
            await showAlert('当前还没有可用的 AI 插件，请先在右侧 AI 面板选择或配置模型。', 'warning', 'nonInvasive', 2200)
            return
        }

        const fallbackTitle = normalizeComparableText(draft.title) || entry?.title || '未命名词条'
        const draftContent = normalizeComparableContent(draft.content)
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
                    content: draft.content,
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
        draft.content,
        draft.summary,
        draft.title,
        draft.type,
        entry?.title,
        entryId,
        generatingSummary,
        loading,
        projectId,
        saving,
        showAlert,
        updateDraftFromUser,
    ])
    useEffect(() => {
        hasChangesRef.current = hasChanges
        onDirtyChangeRef.current?.(hasChanges)
    }, [hasChanges])

    const saveStatus = useEntrySaveStatus({
        entryLoaded: Boolean(entry),
        hasChanges,
        trimmedTitle,
        hasInvalidRelationDrafts,
        saving,
        saveError,
    })

    useEffect(() => {
        if (editorMode !== 'edit' || !editorSplitView) return
        const timer = window.setTimeout(() => setDebouncedContent(draft.content), 150)
        return () => window.clearTimeout(timer)
    }, [draft.content, editorMode, editorSplitView])

    const previewSourceContent = resolveMarkdownPreviewSourceContent(
        editorMode,
        editorSplitView,
        draft.content,
        debouncedContent,
    )
    const previewContent = useMemo(
        () => previewSourceContent === null
            ? ''
            : buildMarkdownPreviewSource(previewSourceContent, draft.images),
        [previewSourceContent, draft.images],
    )
    const outlineItems = useMemo(
        () => outlineOpen ? buildMarkdownOutline(draft.content) : [],
        [draft.content, outlineOpen],
    )

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
            historyInitializedRef.current = null
            undoRedo.reset(buildEditorHistory(savedDraft, savedRelationDrafts))
        }
        lastSuccessfulSaveAtRef.current = Date.now()

        if (reason === 'external') {
            if (previousEntry && previousEntry.title !== refreshed.title) {
                await onTitleChangeRef.current?.(refreshed)
            }
            await onSavedRef.current?.(refreshed)
        }

        return refreshed
    }, [
        applySavedRelations,
        buildEditorHistory,
        ensureEntryDetails,
        entryId,
        projectId,
        setEntryRelations,
        setRelationDrafts,
        undoRedo,
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

            undoRedo.flushDebounced()
            const submitted = {draft, relationDrafts}
            const submittedEditVersion = userEditVersionRef.current
            const savedBundle = await db_save_entry_bundle({
                id: entry.id,
                projectId,
                categoryId: draft.categoryId,
                title: trimmedTitle,
                summary: trimmedSummary || null,
                content: normalizedContent === '' ? null : normalizedContent,
                type: draft.type,
                tags: buildEntryTagsPayload(draft.tags, entryTags.localTagSchemas, entry.tags),
                images: draft.images,
                relationDrafts,
                sourceId: saveSourceIdRef.current,
            })
            setOutgoingLinks(savedBundle.outgoingLinks)
            setIncomingLinks(savedBundle.incomingLinks)
            setEntryRelations(savedBundle.relations)
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
            lastSuccessfulSaveAtRef.current = Date.now()
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
    }, [entry, canSave, hasInvalidRelationDrafts, trimmedTitle, trimmedSummary, normalizedContent, draft, entryTags.localTagSchemas, projectId, entryId, relationDrafts, onTitleChange, onSaved, onSavingChange, showAlert, reloadEntryFromDatabase, setEntryRelations, undoRedo])

    useEffect(() => {
        canSaveRef.current = canSave
        saveActionRef.current = (source) => {
            void handleSave(source)
        }
    }, [canSave, handleSave])

    useEffect(() => {
        if (!shouldAutoSave(active, editorMode === 'edit', hasUserEdited, canSave)) return
        const timer = window.setTimeout(() => {
            saveActionRef.current?.('auto')
        }, AUTO_SAVE_IDLE_MS)
        return () => window.clearTimeout(timer)
    }, [active, canSave, draft, editorMode, hasUserEdited, relationDrafts])

    const applyHistory = useCallback((history: EditorHistory) => {
        const restoreEditorSelection = document.activeElement === editorRef.current?.getTextareaElement()
        markUserEdited()
        isApplyingHistoryRef.current = true
        setDraft(history.draft)
        setRelationDrafts(history.relationDrafts)
        const selection = history.selection
        if (!selection || !restoreEditorSelection) return
        window.requestAnimationFrame(() => {
            const textarea = editorRef.current?.getTextareaElement()
            if (!textarea) return
            const contentLength = history.draft.content.length
            textarea.focus()
            textarea.setSelectionRange(
                Math.min(selection.start, contentLength),
                Math.min(selection.end, contentLength),
            )
        })
    }, [markUserEdited, setRelationDrafts])

    const handleUndo = useCallback(() => {
        const prev = undoRedo.undo()
        if (prev) applyHistory(prev)
    }, [undoRedo, applyHistory])

    const handleRedo = useCallback(() => {
        const next = undoRedo.redo()
        if (next) applyHistory(next)
    }, [undoRedo, applyHistory])

    useEffect(() => {
        if (!active) return

        function handleKeyShortcut(event: KeyboardEvent) {
            if (event.defaultPrevented || event.repeat) return
            if (!(event.ctrlKey || event.metaKey)) return

            const key = event.key.toLowerCase()

            if (key === 's') {
                event.preventDefault()
                if (!canSaveRef.current) return
                saveActionRef.current?.('manual')
                return
            }

            // 撤销/重做 — 仅在焦点不在 MarkdownEditor 文本框内时生效
            //（文本框通过 onKeyDown 自行处理 Ctrl+Z）
            const textarea = editorRef.current?.getTextareaElement()
            if (textarea && document.activeElement === textarea) return

            if (key === 'z' && !event.shiftKey) {
                event.preventDefault()
                handleUndo()
                return
            }
            if ((key === 'z' && event.shiftKey) || key === 'y') {
                event.preventDefault()
                handleRedo()
            }
        }

        window.addEventListener('keydown', handleKeyShortcut)
        return () => {
            window.removeEventListener('keydown', handleKeyShortcut)
        }
    }, [active, handleUndo, handleRedo])

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

    function insertImageMarkdown(image: EntryImage | undefined, fallbackIndex = 0, closeLightbox = false) {
        const imageRef = buildEntryImageMarkdownRef(image, projectId)
        if (!image || !imageRef) {
            void showAlert('当前图片还没有可用于正文引用的 uuid，请先保存词条后再插入。', 'warning', 'nonInvasive', 1800)
            return
        }

        const textarea = editorRef.current?.getTextareaElement()
        const fallbackAlt = image.alt || image.caption || draft.title || entry?.title || `图片 ${fallbackIndex + 1}`
        const markdown = `![${escapeMarkdownImageAlt(fallbackAlt)}](${imageRef})`
        let nextCursor = 0

        updateDraftFromUser((current) => {
            const currentContent = current.content
            const start = textarea?.selectionStart ?? currentContent.length
            const end = textarea?.selectionEnd ?? start
            const prefix = currentContent.slice(0, start)
            const suffix = currentContent.slice(end)
            const before = prefix && !prefix.endsWith('\n') ? '\n\n' : ''
            const after = suffix && !suffix.startsWith('\n') ? '\n\n' : ''
            nextCursor = prefix.length + before.length + markdown.length

            return {
                ...current,
                content: `${prefix}${before}${markdown}${after}${suffix}`,
            }
        })

        window.requestAnimationFrame(() => {
            const nextTextarea = editorRef.current?.getTextareaElement()
            nextTextarea?.focus()
            nextTextarea?.setSelectionRange(nextCursor, nextCursor)
        })
        if (closeLightbox) {
            setLightboxOpen(false)
        }
    }

    function handleInsertImageMarkdown(targetIndex: number) {
        insertImageMarkdown(draft.images[targetIndex], targetIndex, true)
    }

    function resolveEntryAnchor(target: EventTarget | null): HTMLAnchorElement | null {
        const anchor = resolveMarkdownAnchor(target)
        if (!anchor) return null
        const href = anchor.getAttribute('href') ?? ''
        return parseInternalEntryHref(href, anchor.textContent ?? '') ? anchor : null
    }

    function getEntryLinkFromAnchor(anchor: HTMLAnchorElement): InternalEntryLink | null {
        const href = anchor.getAttribute('href') ?? ''
        return parseInternalEntryHref(href, anchor.textContent ?? '')
    }

    async function handleTagSchemaSaved(schema: TagSchema) {
        markUserEdited()
        const nextSchemas = entryTags.handleTagSchemaSaved(schema)
        await onTagSchemasChange?.(nextSchemas)
        setTagCreatorOpen(false)
    }

    const selectMarkdownMatch = useCallback((match: MarkdownTextMatch) => {
        const textarea = editorRef.current?.getTextareaElement()
        if (!textarea) return
        textarea.setSelectionRange(match.start, match.end)
        setSelectionToolbarPosition(null)
        setActiveBlockStyle(resolveMarkdownBlockStyle(textarea.value, match.start))

        window.requestAnimationFrame(() => {
            const scroll = pageScrollRef.current
            if (!scroll) return
            const {top} = getTextareaCaretOffset(textarea, match.start)
            const scrollBounds = scroll.getBoundingClientRect()
            const textareaBounds = textarea.getBoundingClientRect()
            const formatToolbar = markdownContainerRef.current
                ?.parentElement
                ?.querySelector<HTMLElement>('.entry-editor-format-toolbar')
            const visibleTop = Math.max(scrollBounds.top, formatToolbar?.getBoundingClientRect().bottom ?? 0)
            const targetTop = visibleTop + Math.min(96, scrollBounds.height * 0.2)
            const caretTop = textareaBounds.top + top
            scroll.scrollTo({
                top: scroll.scrollTop + caretTop - targetTop,
                behavior: 'auto',
            })
        })
    }, [])

    const openFindBar = useCallback(() => {
        setOutlineOpen(false)
        setFindBarOpen(true)
        window.requestAnimationFrame(() => findBarRef.current?.focusSearch())
    }, [])

    const closeFindBar = useCallback(() => {
        setFindBarOpen(false)
        window.requestAnimationFrame(() => editorRef.current?.getTextareaElement()?.focus())
    }, [])

    const handleMarkdownSearchHighlights = useCallback((
        matches: MarkdownTextMatch[],
        activeIndex: number,
    ) => {
        setMarkdownSearchHighlights(matches.length ? {matches, activeIndex} : null)
    }, [])

    const toggleOutline = useCallback(() => {
        setFindBarOpen(false)
        setOutlineOpen((current) => !current)
    }, [])

    const selectMarkdownOutlineItem = useCallback((item: MarkdownOutlineItem) => {
        selectMarkdownMatch(item)
        setOutlineOpen(false)
        window.requestAnimationFrame(() => editorRef.current?.getTextareaElement()?.focus())
    }, [selectMarkdownMatch])

    const replaceMarkdownMatch = useCallback((match: MarkdownTextMatch, replacement: string) => {
        updateDraftFromUser((current) => ({
            ...current,
            content: replaceMarkdownTextMatch(current.content, match, replacement),
        }))
        window.requestAnimationFrame(() => selectMarkdownMatch({
            start: match.start,
            end: match.start + replacement.length,
        }))
    }, [selectMarkdownMatch, updateDraftFromUser])

    const replaceAllMarkdownMatches = useCallback((
        matches: MarkdownTextMatch[],
        replacement: string,
    ) => {
        updateDraftFromUser((current) => ({
            ...current,
            content: replaceMarkdownTextMatches(current.content, matches, replacement),
        }))
        window.requestAnimationFrame(() => findBarRef.current?.focusSearch())
    }, [updateDraftFromUser])

    const syncActiveBlockStyle = useCallback((textarea?: HTMLTextAreaElement | null) => {
        const input = textarea ?? editorRef.current?.getTextareaElement()
        if (!input) return
        setActiveBlockStyle(resolveMarkdownBlockStyle(input.value, input.selectionStart))
    }, [])

    const executeMarkdownCommand = useCallback((command: ICommand) => {
        editorRef.current?.executeCommand(command)
        setSelectionToolbarPosition(null)
        window.requestAnimationFrame(() => syncActiveBlockStyle())
    }, [syncActiveBlockStyle])

    const updateSelectionToolbar = useCallback((
        textarea: HTMLTextAreaElement,
        clientX?: number,
        clientY?: number,
    ) => {
        syncActiveBlockStyle(textarea)
        if (textarea.selectionStart === textarea.selectionEnd) {
            setSelectionToolbarPosition(null)
            return
        }

        const markdown = markdownContainerRef.current?.parentElement
        if (!markdown) return
        const bounds = markdown.getBoundingClientRect()
        const textareaBounds = textarea.getBoundingClientRect()
        const formatToolbar = markdown.querySelector<HTMLElement>('.entry-editor-format-toolbar')
        const scrollBounds = pageScrollRef.current?.getBoundingClientRect() ?? bounds
        const start = getTextareaCaretOffset(textarea, textarea.selectionStart)
        const end = getTextareaCaretOffset(textarea, textarea.selectionEnd)
        const selectionTop = textareaBounds.top + Math.min(start.top, end.top)
        const selectionBottom = textareaBounds.top + Math.max(
            start.top + start.lineHeight,
            end.top + end.lineHeight,
        )
        const visibleTop = Math.max(scrollBounds.top, formatToolbar?.getBoundingClientRect().bottom ?? bounds.top)
        const visibleBottom = Math.min(scrollBounds.bottom, window.innerHeight)
        const placement = resolveSelectionToolbarPlacement({
            selectionTop,
            selectionBottom,
            visibleTop,
            visibleBottom,
            pointerY: clientY,
        })
        if (!placement) {
            setSelectionToolbarPosition(null)
            return
        }
        const edge = Math.min(96, bounds.width / 2)
        const anchorX = clientX ?? (textareaBounds.left + textareaBounds.width / 2)

        setSelectionToolbarPosition({
            left: Math.min(Math.max(anchorX - bounds.left, edge), bounds.width - edge),
            top: (placement === 'above' ? selectionTop : selectionBottom) - bounds.top,
            placement,
        })
    }, [syncActiveBlockStyle])

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
                                        onClick={onBack}
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
                                            onClick={() => setEditorMode('browse')}
                                        >
                                            浏览
                                        </button>
                                        <button
                                            type="button"
                                            className={`entry-editor-mode-chip${editorMode === 'edit' ? ' active' : ''}`}
                                            aria-pressed={editorMode === 'edit'}
                                            onClick={() => setEditorMode('edit')}
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
                            {editorMode === 'edit' ? (
                                <div className="entry-editor-markdown">
                                    <EntryMarkdownToolbar
                                        canUndo={undoRedo.canUndo}
                                        canRedo={undoRedo.canRedo}
                                        activeBlockStyle={activeBlockStyle}
                                        splitView={editorSplitView}
                                        content={draft.content}
                                        findBar={findBarOpen ? (
                                            <EntryMarkdownFindBar
                                                ref={findBarRef}
                                                value={draft.content}
                                                onSelect={selectMarkdownMatch}
                                                onReplace={replaceMarkdownMatch}
                                                onReplaceAll={replaceAllMarkdownMatches}
                                                onHighlightChange={handleMarkdownSearchHighlights}
                                                onClose={closeFindBar}
                                            />
                                        ) : undefined}
                                        outlineOpen={outlineOpen}
                                        outlinePanel={outlineOpen ? (
                                            <EntryMarkdownOutline
                                                items={outlineItems}
                                                onSelect={selectMarkdownOutlineItem}
                                                onClose={() => setOutlineOpen(false)}
                                            />
                                        ) : undefined}
                                        onUndo={handleUndo}
                                        onRedo={handleRedo}
                                        onFind={openFindBar}
                                        onOutline={toggleOutline}
                                        onCommand={executeMarkdownCommand}
                                        onInsertImage={() => openImageAddModal('insert')}
                                        onSplitViewChange={setEditorSplitView}
                                    />
                                    {selectionToolbarPosition && (
                                        <EntryMarkdownSelectionToolbar
                                            left={selectionToolbarPosition.left}
                                            top={selectionToolbarPosition.top}
                                            placement={selectionToolbarPosition.placement}
                                            onCommand={executeMarkdownCommand}
                                        />
                                    )}
                                    <div ref={markdownContainerRef} className="entry-editor-markdown-anchor">
                                        <MarkdownEditor
                                            ref={editorRef}
                                            key={entryId}
                                            value={draft.content}
                                            onValueChange={(value) => {
                                                updateDraftFromUser((current) => (
                                                    current.content === value
                                                        ? current
                                                        : {...current, content: value}
                                                ))
                                                window.requestAnimationFrame(() => syncActiveBlockStyle())
                                            }}
                                            tokens={{fontSizeScale: editorFontSize / 14}}
                                            minHeight={720}
                                            placeholder="在这里写正文。输入 [[ 可以快速插入双链。"
                                            previewOptions={ENTRY_MARKDOWN_PREVIEW_OPTIONS}
                                            previewValue={previewContent}
                                            searchHighlights={markdownSearchHighlights ?? undefined}
                                            hideToolbar
                                            hideFullscreen
                                            showSplitToggle={false}
                                            splitView={editorSplitView}
                                            onSplitChange={setEditorSplitView}
                                            onKeyDown={(event) => {
                                                if (!(event.ctrlKey || event.metaKey) || event.repeat) return
                                                const key = event.key.toLowerCase()
                                                if (key === 'f') {
                                                    event.preventDefault()
                                                    openFindBar()
                                                } else if (key === 'z' && !event.shiftKey) {
                                                    event.preventDefault()
                                                    handleUndo()
                                                } else if ((key === 'z' && event.shiftKey) || key === 'y') {
                                                    event.preventDefault()
                                                    handleRedo()
                                                }
                                            }}
                                            textareaProps={{
                                                onKeyDownCapture: (event) => {
                                                    wikiLink.handleWikiKeyDown(event)
                                                    if (event.key !== 'Enter') return
                                                    const textarea = event.currentTarget
                                                    if (
                                                        event.defaultPrevented
                                                        || event.shiftKey
                                                        || event.ctrlKey
                                                        || event.altKey
                                                        || event.metaKey
                                                        || event.nativeEvent.isComposing
                                                    ) {
                                                        return
                                                    }
                                                    const edit = buildListEnterEdit(textarea.value, {
                                                        start: textarea.selectionStart,
                                                        end: textarea.selectionEnd,
                                                    })
                                                    if (!edit) return
                                                    event.preventDefault()
                                                    event.stopPropagation()
                                                    const nextContent = textarea.value.slice(0, edit.start)
                                                        + edit.replacement
                                                        + textarea.value.slice(edit.end)
                                                    updateDraftFromUser((current) => (
                                                        current.content === nextContent
                                                            ? current
                                                            : {...current, content: nextContent}
                                                    ))
                                                    setSelectionToolbarPosition(null)
                                                    window.requestAnimationFrame(() => {
                                                        textarea.setSelectionRange(
                                                            edit.selection.start,
                                                            edit.selection.end,
                                                        )
                                                        wikiLink.handleMarkdownCursorSync(textarea)
                                                        syncActiveBlockStyle(textarea)
                                                    })
                                                },
                                                onKeyUp: (event) => {
                                                    wikiLink.handleMarkdownCursorSync(event.currentTarget)
                                                    updateSelectionToolbar(event.currentTarget)
                                                },
                                                onMouseUp: (event) => updateSelectionToolbar(
                                                    event.currentTarget,
                                                    event.clientX,
                                                    event.clientY,
                                                ),
                                                onClick: (event) => {
                                                    const textarea = event.currentTarget
                                                    const {clientX, clientY} = event
                                                    wikiLink.handleMarkdownCursorSync(textarea)
                                                    window.requestAnimationFrame(() => {
                                                        updateSelectionToolbar(textarea, clientX, clientY)
                                                    })
                                                },
                                                onSelect: (event) => {
                                                    wikiLink.handleMarkdownCursorSync(event.currentTarget)
                                                    syncActiveBlockStyle(event.currentTarget)
                                                },
                                                onFocus: (event) => syncActiveBlockStyle(event.currentTarget),
                                                onScroll: (event) => {
                                                    wikiLink.updateWikiPopoverPosition(event.currentTarget as unknown as HTMLTextAreaElement)
                                                    setSelectionToolbarPosition(null)
                                                },
                                                onBlur: () => {
                                                    wikiLink.handleTextareaBlur()
                                                    setSelectionToolbarPosition(null)
                                                },
                                            }}
                                        />

                                        <EntryEditorWikiLink
                                            wikiDraft={wikiLink.wikiDraft}
                                            wikiPopoverPosition={wikiLink.wikiPopoverPosition}
                                            wikiLinkOptions={wikiLink.wikiLinkOptions}
                                            activeWikiOptionIndex={wikiLink.activeWikiOptionIndex}
                                            creatingLinkedEntry={wikiLink.creatingLinkedEntry}
                                            hasExactCategorySuggestion={wikiLink.hasExactCategorySuggestion}
                                            categories={categories}
                                            popoverRef={wikiPopoverRef}
                                            optionRefs={wikiLink.wikiOptionRefs}
                                            onOptionCommit={wikiLink.handleWikiOptionCommit}
                                            onActiveIndexChange={wikiLink.setActiveWikiOptionIndex}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div
                                    ref={previewContainerRef}
                                    className="entry-editor-preview"
                                    onClick={(e) => {
                                        const anchor = resolveMarkdownAnchor(e.target)
                                        if (!anchor) return
                                        e.preventDefault()
                                        const href = anchor.getAttribute('href') ?? ''
                                        const internalLink = getEntryLinkFromAnchor(anchor)
                                        if (internalLink) {
                                            void ensureProjectEntriesLoaded().then(() => {
                                                linkPreview.handleOpenLinkedEntry(internalLink)
                                            })
                                            return
                                        }
                                        if (isSafeExternalHref(href)) {
                                            void openUrl(href).catch((error) => {
                                                logger.error('open external link failed', error)
                                                void showAlert('打开链接失败', 'error', 'nonInvasive', 1500)
                                            })
                                            return
                                        }
                                        void showAlert('无效链接，已阻止跳转', 'warning', 'nonInvasive', 1500)
                                    }}
                                    onMouseOver={(e) => {
                                        const anchor = resolveEntryAnchor(e.target)
                                        if (!anchor) return
                                        const internalLink = getEntryLinkFromAnchor(anchor)
                                        if (!internalLink) return
                                        if (linkPreview.linkPreviewAnchorRef.current === anchor) {
                                            linkPreview.clearLinkPreviewCloseTimer()
                                            linkPreview.updateLinkPreviewPosition(anchor)
                                            return
                                        }
                                        linkPreview.openLinkPreview(anchor, internalLink)
                                    }}
                                    onMouseOut={(e) => {
                                        const anchor = resolveEntryAnchor(e.target)
                                        if (!anchor) return
                                        const relatedTarget = e.relatedTarget
                                        if (
                                            relatedTarget instanceof Node
                                            && (anchor.contains(relatedTarget) || linkPreviewPanelRef.current?.contains(relatedTarget))
                                        ) {
                                            return
                                        }
                                        linkPreview.scheduleLinkPreviewClose()
                                    }}
                                    onScroll={linkPreview.closeLinkPreview}
                                >
                                    <MarkdownEditor
                                        mode="preview"
                                        value={previewContent}
                                        onValueChange={() => {
                                        }}
                                        tokens={{
                                            background: 'transparent',
                                            fontSizeScale: editorFontSize / 14,
                                        }}
                                        autoHeight
                                        previewOptions={ENTRY_MARKDOWN_PREVIEW_OPTIONS}
                                    />

                                    <EntryEditorLinkPreview
                                        linkPreview={linkPreview.linkPreview}
                                        linkPreviewPosition={linkPreview.linkPreviewPosition}
                                        linkPreviewEntry={linkPreview.linkPreviewEntry}
                                        panelRef={linkPreviewPanelRef}
                                        anchorRef={linkPreview.linkPreviewAnchorRef}
                                        onClearCloseTimer={linkPreview.clearLinkPreviewCloseTimer}
                                        onScheduleClose={linkPreview.scheduleLinkPreviewClose}
                                    />
                                </div>
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
                onInsertMarkdown={editorMode === 'edit' ? handleInsertImageMarkdown : undefined}
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
                onInsertImage={(image) => insertImageMarkdown(image)}
            />
        </div>
    )
}
