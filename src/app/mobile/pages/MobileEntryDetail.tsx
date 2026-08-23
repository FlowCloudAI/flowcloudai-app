import {logger} from '../../../shared/logger'
import {listen} from '../../../api/events'
import {openFileDialog} from '../../../api/dialog'
import {openUrl} from '../../../api/opener'
import {
    type CSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type SyntheticEvent as ReactSyntheticEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {Button, useAlert, useTheme} from 'flowcloudai-ui'
import type {MarkdownEditorRef} from '../../../features/entries/components/MarkdownEditor/MarkdownEditor'
import {
    type Category,
    type CustomEntryType,
    db_get_entry,
    db_delete_entry,
    db_list_all_entry_types,
    db_list_categories,
    db_list_entries,
    db_list_incoming_links,
    db_list_outgoing_links,
    db_list_relations_for_entry,
    db_list_tag_schemas,
    db_save_entry_bundle,
    import_entry_images,
    type Entry,
    type EntryBrief,
    ENTRY_DELETED,
    type EntryDeletedEvent,
    type EntryLink,
    type EntryRelation,
    ENTRY_UPDATED,
    type EntryUpdatedEvent,
    type EntryTypeView,
    entryTypeKey,
    formatApiError,
    type TagSchema,
    toApiError,
} from '../../../api'
import type {MobileEntryDetailProps as Props} from './MobileEntryDetailPageProps'
import {
    buildMarkdownPreviewSource,
    isSafeExternalHref,
    parseInternalEntryHref,
    resolveInternalEntryProjectId,
    resolveMarkdownAnchor,
} from '../../../features/entries/lib/entryMarkdown'
import {areTagMapsEqual} from '../../../features/entries/lib/entryTag'
import {recordHomeActivity} from '../../../features/home/homeActivity'
import {
    buildEntryImageMarkdownRef,
    type EntryImage,
    normalizeEntryImages,
    toEntryImageSrc,
} from '../../../features/entries/lib/entryImage'
import {removeEntryImages} from '../../../features/entries/lib/entryImageCollection'
import {
    areRelationDraftsEqual,
    buildRelationDraft,
    hasInvalidRelationDraft,
} from '../../../features/entries/lib/entryRelation'
import useEntryTags from '../../../features/entries/hooks/useEntryTags'
import {buildEntryTagsPayload} from '../../../features/entries/components/entryTagUtils'
import {type EntryRelationDraft} from '../../../features/project-editor/components/EntryRelations/EntryRelationCreator'
import {
    appendImages,
    areImagesEqual,
    buildTagDraft,
    escapeMarkdownImageAlt,
    getImageLabel,
    type TagValueMap,
} from './MobileEntryDetailUtils'
import {MobileEntryDetailView} from './MobileEntryDetailView'
import MobileEntryDetailEditView from './MobileEntryDetailEditView'
import useMobileEntryDetailLoader from './useMobileEntryDetailLoader'
import useMobileEntryWikiEditor from './useMobileEntryWikiEditor'
import './MobileEntryDetail.css'
type Mode = 'view' | 'edit'

/** 双链候选/关系选择器的查表上限。仅在真正需要时才拉（见 ensureProjectEntries）。 */
const PROJECT_ENTRY_LOOKUP_LIMIT = 1000

export default function MobileEntryDetail({push, pop, replace, navigateToTab, setBeforeLeave, setAiFocus, params}: Props) {
    const projectId = params.projectId
    const entryId = params.entryId ?? ''
    const saveSourceIdRef = useRef(globalThis.crypto.randomUUID())
    const {showAlert} = useAlert()
    const {theme} = useTheme()
    const pageRef = useRef<HTMLDivElement>(null)
    const topActionsRef = useRef<HTMLDivElement>(null)
    const immersiveContentEditorRef = useRef<MarkdownEditorRef>(null)
    const projectEntriesRequestRef = useRef<Promise<EntryBrief[]> | null>(null)
    const recordedHomeEntryRef = useRef<string | null>(null)

    const [entry, setEntry] = useState<Entry | null>(null)
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [mode, setMode] = useState<Mode>(params.mode === 'edit' ? 'edit' : 'view')

    // 编辑表单字段
    const [title, setTitle] = useState('')
    const [content, setContent] = useState('')
    const [summary, setSummary] = useState('')
    const [entryType, setEntryType] = useState<string | null>(null)
    const [categoryId, setCategoryId] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [menuOpen, setMenuOpen] = useState(false)
    const [typeCreatorOpen, setTypeCreatorOpen] = useState(false)
    const [tagCreatorOpen, setTagCreatorOpen] = useState(false)
    const [tagSchemas, setTagSchemas] = useState<TagSchema[]>([])
    const [tagDraft, setTagDraft] = useState<TagValueMap>({})
    const [images, setImages] = useState<EntryImage[]>([])
    const [imageAddModalOpen, setImageAddModalOpen] = useState(false)
    const [lightboxOpen, setLightboxOpen] = useState(false)
    const [lightboxIndex, setLightboxIndex] = useState(0)
    const [projectEntries, setProjectEntries] = useState<EntryBrief[]>([])
    const [projectEntriesLoaded, setProjectEntriesLoaded] = useState(false)
    const [outgoingLinks, setOutgoingLinks] = useState<EntryLink[]>([])
    const [incomingLinks, setIncomingLinks] = useState<EntryLink[]>([])
    const [entryRelations, setEntryRelations] = useState<EntryRelation[]>([])
    const [relationDrafts, setRelationDrafts] = useState<EntryRelationDraft[]>([])
    const [immersiveEditorOpen, setImmersiveEditorOpen] = useState(false)

    const {
        wikiDraft,
        wikiLinkOptions,
        activeWikiOptionIndex,
        setActiveWikiOptionIndex,
        creatingLinkedEntry,
        getContentTextarea,
        syncWikiDraftFromTextarea,
        handleWikiOptionCommit,
        handleContentChange,
        handleContentKeyDown,
        handleContentBlur,
        handleContentFocus,
        handleMarkdownTool,
    } = useMobileEntryWikiEditor({
        projectId,
        entryId,
        categoryId,
        content,
        setContent,
        projectEntries,
        setProjectEntries,
        immersiveEditorOpen,
        immersiveContentEditorRef,
        setImageAddModalOpen,
    })

    const handleTagDraftChange = useCallback((nextTags: TagValueMap) => {
        setTagDraft(nextTags)
    }, [])
    const entryTags = useEntryTags({
        tagSchemas,
        draftTags: tagDraft,
        draftType: entryType,
        entryId,
        onTagsChange: handleTagDraftChange,
    })
    const initialRelationDrafts = useMemo(
        () => entryRelations.map(relation => buildRelationDraft(entryId, relation)),
        [entryId, entryRelations],
    )

    // wrapperElement 的 data-color-mode 只接受 "light" | "dark"，不接受 "auto"
    const colorMode: 'light' | 'dark' = theme === 'dark'
        ? 'dark'
        : theme === 'light'
            ? 'light'
            : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

    const syncForm = useCallback((e: Entry) => {
        setTitle(e.title)
        setContent(e.content ?? '')
        setSummary(e.summary ?? '')
        setEntryType(e.type ?? null)
        setCategoryId(e.category_id ?? null)
        setTagDraft(buildTagDraft(e))
        setImages(normalizeEntryImages(e.images))
    }, [])

    /**
     * 全量词条列表只有三处要用：正文 `[[` 双链候选、编辑态的关系选择器、
     * 以及查看态解析关联卡上的标题。它原先挂在 reloadEntryState 的 Promise.all 里，
     * 于是**每开一个词条都要把整个项目的词条拉过 IPC，且卡在首屏渲染的关键路径上**——
     * 千条词条的世界观在低端安卓机上这一发就是主要开销。改为按需加载：
     * 没有关联、也不进编辑态的词条，一行都不拉。
     */
    const ensureProjectEntries = useCallback(() => {
        if (projectEntriesRequestRef.current) return projectEntriesRequestRef.current
        const request = db_list_entries({projectId, limit: PROJECT_ENTRY_LOOKUP_LIMIT, offset: 0})
            .then((briefs) => {
                setProjectEntries(briefs)
                setProjectEntriesLoaded(true)
                return briefs
            })
            .catch((error) => {
                logger.error('加载项目词条列表失败', error)
                projectEntriesRequestRef.current = null // 允许后续重试
                return [] as EntryBrief[]
            })
        projectEntriesRequestRef.current = request
        return request
    }, [projectId])

    const reloadEntryState = useCallback(async () => {
        const [e, types, cats, schemas, outgoing, incoming, relations] = await Promise.all([
            db_get_entry(entryId, projectId),
            db_list_all_entry_types(projectId),
            db_list_categories(projectId),
            db_list_tag_schemas(projectId),
            db_list_outgoing_links(entryId, projectId).catch(() => [] as EntryLink[]),
            db_list_incoming_links(entryId, projectId).catch(() => [] as EntryLink[]),
            db_list_relations_for_entry(entryId, projectId).catch(() => [] as EntryRelation[]),
        ])
        setEntry(e)
        setEntryTypes(types)
        setCategories(cats)
        setTagSchemas(schemas)
        setOutgoingLinks(outgoing)
        setIncomingLinks(incoming)
        setEntryRelations(relations)
        setRelationDrafts(relations.map(relation => buildRelationDraft(entryId, relation)))
        syncForm(e)
        const homeEntryKey = `${projectId}:${e.id}`
        if (recordedHomeEntryRef.current !== homeEntryKey) {
            recordedHomeEntryRef.current = homeEntryKey
            recordHomeActivity({
                type: 'entry',
                id: e.id,
                projectId,
                entryId: e.id,
                title: e.title,
                subtitle: '词条',
                description: e.summary?.trim() || null,
                updatedAt: e.updated_at,
            })
        }
        return e
    }, [entryId, projectId, syncForm])

    const isDirty = mode === 'edit' && !!entry && (
        title !== entry.title
        || content !== (entry.content ?? '')
        || summary !== (entry.summary ?? '')
        || entryType !== (entry.type ?? null)
        || categoryId !== (entry.category_id ?? null)
        || !areTagMapsEqual(tagDraft, buildTagDraft(entry), tagSchemas)
        || !areImagesEqual(images, normalizeEntryImages(entry.images))
        || !areRelationDraftsEqual(relationDrafts, initialRelationDrafts)
    )

    const {loading, loadError, reload: loadEntry, setLoadError} = useMobileEntryDetailLoader(entryId, reloadEntryState)

    const hasConnectionData = entryRelations.length > 0 || outgoingLinks.length > 0 || incomingLinks.length > 0

    useEffect(() => {
        // 编辑态必然要全量列表（双链候选 + 关系选择器）；
        // 查看态只有存在关联卡、需要把 id 解析成标题时才要。两者都在首屏渲染之后才发。
        if (mode !== 'edit' && !hasConnectionData) return
        void ensureProjectEntries()
    }, [ensureProjectEntries, hasConnectionData, mode])

    const enterEdit = useCallback(() => {
        if (entry) syncForm(entry)
        setMode('edit')
    }, [entry, syncForm])

    const confirmDiscard = useCallback(async () => {
        if (!isDirty) return true
        const result = await showAlert('未保存的更改将丢失，是否继续？', 'warning', 'confirm')
        return result === 'yes'
    }, [isDirty, showAlert])

    useEffect(() => {
        const updatedListener = listen<EntryUpdatedEvent>(ENTRY_UPDATED, (event) => {
            if (event.payload.entry_id !== entryId) return
            if (event.payload.source_id === saveSourceIdRef.current) return
            if (mode === 'edit' && isDirty) {
                void showAlert('词条已在后台更新；当前页面存在未保存修改，已跳过自动覆盖。', 'warning', 'nonInvasive', 2200)
                return
            }
            void reloadEntryState()
                .then((updatedEntry) => {
                    setLoadError(null)
                    replace({
                        type: 'entryDetail',
                        params: {
                            ...params,
                            projectId,
                            entryId,
                            displayName: updatedEntry.title,
                            mode,
                        },
                    })
                    void showAlert('词条已在后台更新，页面已刷新。', 'success', 'nonInvasive', 1500)
                })
                .catch((error) => {
                    logger.error('刷新后台更新的词条失败', error)
                    setLoadError(formatApiError(toApiError(error)))
                    void showAlert('词条已更新，但页面刷新失败，请重新打开词条。', 'warning', 'nonInvasive', 2200)
                })
        })
        const deletedListener = listen<EntryDeletedEvent>(ENTRY_DELETED, (event) => {
            if (event.payload.entry_id !== entryId) return
            void showAlert('词条已在后台删除。', 'warning', 'nonInvasive', 2200)
            pop()
        })

        return () => { updatedListener.then((fn) => fn()); deletedListener.then((fn) => fn()) }
    }, [entryId, isDirty, mode, params, pop, projectId, reloadEntryState, replace, setLoadError, showAlert])

    // 输入/编辑期间第一次返回只退出编辑模式；不会顺带离开词条或切换 Tab。
    const exitEditMode = useCallback(async (): Promise<boolean> => {
        if (!await confirmDiscard()) return false
        if (entry) {
            syncForm(entry)
            setRelationDrafts(initialRelationDrafts)
            setImmersiveEditorOpen(false)
            setMode('view')
        } else {
            pop()
        }
        return true
    }, [confirmDiscard, entry, initialRelationDrafts, pop, syncForm])

    // 取消：已有可回退的查看态则回查看；否则（极端情况无 entry）回退页面。
    const handleCancel = useCallback(async () => {
        await exitEditMode()
    }, [exitEditMode])

    useEffect(() => {
        if (mode !== 'edit') {
            setBeforeLeave(null)
            return
        }
        setBeforeLeave(async (intent) => {
            // 返回键可以先“吃掉”一次，只收起沉浸编辑；切 Tab 会直接卸载本页，
            // 收起沉浸编辑没有意义，必须直奔未保存确认。
            if (intent === 'back' && immersiveEditorOpen) {
                setImmersiveEditorOpen(false)
                return false
            }
            if (intent === 'back') {
                await exitEditMode()
                return false
            }
            return confirmDiscard()
        })
        return () => setBeforeLeave(null)
    }, [confirmDiscard, exitEditMode, immersiveEditorOpen, mode, setBeforeLeave])

    const handleAiDiscuss = useCallback(() => {
        setAiFocus({projectId, entryId})
        navigateToTab('ai')
    }, [navigateToTab, projectId, entryId, setAiFocus])

    const handleOpenLinkedEntry = useCallback((targetProjectId: string, targetId?: string, title?: string) => {
        const resolvedProjectId = targetId ? targetProjectId : projectId
        const resolvedEntryId = targetId ?? targetProjectId
        if (resolvedProjectId === projectId && resolvedEntryId === entryId) return
        const target = projectEntries.find(item => item.id === resolvedEntryId)
        push({
            type: 'entryDetail',
            params: {
                projectId: resolvedProjectId,
                entryId: resolvedEntryId,
                displayName: target?.title ?? title ?? '词条',
            },
        })
    }, [entryId, projectEntries, projectId, push])

    const handleMarkdownClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        const anchor = resolveMarkdownAnchor(event.target)
        if (!anchor) return

        const href = anchor.getAttribute('href') ?? ''
        const internalLink = parseInternalEntryHref(href, anchor.textContent ?? '')
        if (internalLink) {
            event.preventDefault()
            if (internalLink.entryId) {
                const targetProjectId = resolveInternalEntryProjectId(internalLink, projectId)
                if (!targetProjectId) {
                    void showAlert('旧版词条链接缺少项目 ID，无法定位词条。', 'warning', 'nonInvasive', 1800)
                    return
                }
                handleOpenLinkedEntry(targetProjectId, internalLink.entryId, internalLink.title)
                return
            }
            // 只有标题、没有 entryId 的旧版链接才需要全量列表查表——按需拉，别为它拖慢开屏。
            const targetTitle = internalLink.title.trim()
            void (async () => {
                const entries = await ensureProjectEntries()
                const target = entries.find(item => item.title.trim() === targetTitle)
                if (!target) {
                    void showAlert(`未找到词条「${targetTitle}」`, 'warning', 'nonInvasive', 1800)
                    return
                }
                handleOpenLinkedEntry(projectId, target.id, target.title)
            })()
            return
        }

        if (isSafeExternalHref(href)) {
            event.preventDefault()
            void openUrl(href).catch((error) => {
                logger.error('打开链接失败', error)
                void showAlert('打开链接失败', 'error', 'nonInvasive', 1800)
            })
            return
        }

        if (href) {
            event.preventDefault()
            void showAlert('无效链接，已阻止跳转', 'warning', 'nonInvasive', 1500)
        }
    }, [ensureProjectEntries, handleOpenLinkedEntry, projectId, showAlert])

    const handleSave = useCallback(async () => {
        if (!title.trim()) {
            await showAlert('请输入词条标题', 'warning', 'nonInvasive', 2000)
            return
        }
        if (!entry) return
        if (relationDrafts.some(draft => hasInvalidRelationDraft(draft, entryId))) {
            await showAlert('存在未完成关系，请先选择目标词条或删除该关系。', 'warning', 'nonInvasive', 2400)
            return
        }
        setSaving(true)
        setSaveError(null)
        const tags = buildEntryTagsPayload(tagDraft, entryTags.localTagSchemas, entry.tags)
        try {
            const savedBundle = await db_save_entry_bundle({
                id: entryId,
                projectId,
                title: title.trim(),
                content: content.trim() || null,
                summary: summary.trim() || null,
                type: entryType,
                categoryId: categoryId || null,
                tags,
                images,
                relationDrafts,
                sourceId: saveSourceIdRef.current,
            })
            setEntry(savedBundle.entry)
            syncForm(savedBundle.entry)
            setOutgoingLinks(savedBundle.outgoingLinks)
            setIncomingLinks(savedBundle.incomingLinks)
            setEntryRelations(savedBundle.relations)
            setRelationDrafts(savedBundle.relations.map(relation => buildRelationDraft(entryId, relation)))
            setAiFocus({projectId, entryId})
            // 同步页面标题（顶部标题取自 params.displayName），保存后继续停留在编辑态。
            replace({type: 'entryDetail', params: {...params, projectId, entryId, displayName: title.trim(), mode: 'edit'}})
        } catch (e) {
            setSaveError(`保存失败：${formatApiError(toApiError(e))}`)
        } finally {
            setSaving(false)
        }
    }, [title, content, summary, entryType, categoryId, relationDrafts, tagDraft, entryTags.localTagSchemas, entry, entryId, images, projectId, params, replace, setAiFocus, showAlert, syncForm])

    const handleDelete = useCallback(async () => {
        const result = await showAlert(`确定删除词条「${entry?.title ?? ''}」？此操作不可撤销。`, 'warning', 'confirm')
        if (result !== 'yes') return
        try {
            await db_delete_entry(entryId, projectId)
            pop()
        } catch (e) {
            await showAlert(`删除失败：${formatApiError(toApiError(e))}`, 'error', 'nonInvasive', 3000)
        }
    }, [entry, entryId, pop, projectId, showAlert])

    const handleTypeCreated = useCallback(async (created: CustomEntryType) => {
        try {
            setEntryTypes(await db_list_all_entry_types(projectId))
        } catch (e) {
            logger.error('刷新词条类型失败', e)
        }
        setEntryType(created.id)
    }, [projectId])

    const handleTagSchemaSaved = useCallback((schema: TagSchema) => {
        const nextSchemas = entryTags.handleTagSchemaSaved(schema)
        setTagSchemas(nextSchemas)
        setTagCreatorOpen(false)
    }, [entryTags])

    const lightboxImages = useMemo(() => images.map((image) => ({
        ...image,
        src: toEntryImageSrc(image),
    })), [images])

    const entryBriefById = useMemo(
        () => new Map(projectEntries.map(item => [item.id, item])),
        [projectEntries],
    )
    const categoryNameById = useMemo(
        () => new Map(categories.map(item => [item.id, item.name])),
        [categories],
    )

    const handleUploadImages = useCallback(async (): Promise<EntryImage[]> => {
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
            const imported = await import_entry_images(projectId, paths)
            const nextImportedImages: EntryImage[] = imported.map((image, index) => ({
                ...image,
                alt: image.alt || (image.path?.split(/[\\/]/).pop() ?? `图片 ${index + 1}`),
                is_cover: false,
            }))
            setImages(current => appendImages(current, nextImportedImages))
            return nextImportedImages
        } catch (error) {
            await showAlert(`导入图片失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 3000)
            return []
        }
    }, [projectId, showAlert])

    const handleAddAiImages = useCallback((aiImages: EntryImage[]) => {
        setImages(current => appendImages(current, aiImages))
    }, [])

    const handleSetCover = useCallback((targetIndex: number) => {
        setImages(current => current.map((image, index) => ({
            ...image,
            is_cover: index === targetIndex,
        })))
    }, [])

    const handleRemoveImage = useCallback((targetIndex: number) => {
        setImages(current => removeEntryImages(current, [targetIndex]))
        setLightboxIndex(current => Math.min(current, Math.max(0, images.length - 2)))
    }, [images.length])

    const handleRemoveImages = useCallback((indices: number[]) => {
        setImages(current => removeEntryImages(current, indices))
        setLightboxIndex(0)
    }, [])

    const handleInsertImageMarkdown = useCallback((targetIndex: number) => {
        const image = images[targetIndex]
        const imageRef = buildEntryImageMarkdownRef(image, projectId)
        if (!image || !imageRef) {
            void showAlert('当前图片还没有可用于正文引用的 uuid，请先保存词条后再插入。', 'warning', 'nonInvasive', 1800)
            return
        }
        const textarea = getContentTextarea()
        const fallbackAlt = getImageLabel(image, targetIndex) || title || entry?.title || `图片 ${targetIndex + 1}`
        const markdown = `![${escapeMarkdownImageAlt(fallbackAlt)}](${imageRef})`
        const start = textarea?.selectionStart ?? content.length
        const end = textarea?.selectionEnd ?? start
        const prefix = content.slice(0, start)
        const suffix = content.slice(end)
        const before = prefix && !prefix.endsWith('\n') ? '\n\n' : ''
        const after = suffix && !suffix.startsWith('\n') ? '\n\n' : ''
        const nextContent = `${prefix}${before}${markdown}${after}${suffix}`
        const nextCursor = prefix.length + before.length + markdown.length
        setContent(nextContent)
        setLightboxOpen(false)
        window.requestAnimationFrame(() => {
            const nextTextarea = getContentTextarea()
            nextTextarea?.focus()
            nextTextarea?.setSelectionRange(nextCursor, nextCursor)
        })
    }, [content, entry?.title, getContentTextarea, images, projectId, showAlert, title])

    if (loading) return <div className="mobile-page__loading">加载中…</div>
    if (!entry && loadError) return <div className="mobile-page__error" role="alert"><span>词条加载失败：{loadError}</span><Button type="button" size="sm" variant="outline" onClick={() => void loadEntry()}>重试</Button></div>
    if (!entry) return <div className="mobile-page__error">词条不存在</div>

    // ---------- 编辑态 ----------
    if (mode === 'edit') {
        const textareaProps = {
            onKeyDown: handleContentKeyDown,
            onKeyUp: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => syncWikiDraftFromTextarea(event.currentTarget),
            onClick: (event: ReactMouseEvent<HTMLTextAreaElement>) => syncWikiDraftFromTextarea(event.currentTarget),
            onSelect: (event: ReactSyntheticEvent<HTMLTextAreaElement>) => syncWikiDraftFromTextarea(event.currentTarget),
            onFocus: handleContentFocus, onBlur: handleContentBlur,
        }
        return <MobileEntryDetailEditView
            saving={saving} isDirty={isDirty} error={saveError} onCancel={() => void handleCancel()} onSave={() => void handleSave()}
            title={title} onTitle={setTitle} summary={summary} onSummary={setSummary}
            entryType={entryType} onEntryType={setEntryType} categoryId={categoryId} onCategory={setCategoryId}
            categories={categories} entryTypes={entryTypes} onOpenTypeCreator={() => setTypeCreatorOpen(true)}
            immersiveOpen={immersiveEditorOpen} onOpenImmersive={() => setImmersiveEditorOpen(true)}
            wikiDraft={wikiDraft} wikiOptions={wikiLinkOptions} activeWikiIndex={activeWikiOptionIndex}
            categoryNameById={categoryNameById} creatingLinkedEntry={creatingLinkedEntry}
            onWikiIndex={setActiveWikiOptionIndex} onWikiCommit={handleWikiOptionCommit}
            imagesProps={{images, onAddImage: () => setImageAddModalOpen(true), onOpenImage: index => { setLightboxIndex(index); setLightboxOpen(true) }}}
            tagsProps={{hasTagDefinitions: entryTags.localTagSchemas.length > 0, availableTagSchemaOptions: entryTags.availableTagSchemaOptions, tagSchemaPickerValue: entryTags.tagSchemaPickerValue, editTagSchemas: entryTags.visibleTagSchemas, implantedTagSchemaIdSet: entryTags.implantedTagSchemaIdSet, tagDraft, onAddVisibleTagSchema: entryTags.handleAddVisibleTagSchema, onTagDraftChange: setTagDraft, onOpenTagCreator: () => setTagCreatorOpen(true)}}
            relationsProps={{relationDrafts, entries: projectEntries, categories, currentEntryId: entryId, disabled: saving, onChange: setRelationDrafts, onOpenEntry: target => void (async () => { if (await confirmDiscard()) handleOpenLinkedEntry(target.id) })()}}
            immersiveProps={{editorRef: immersiveContentEditorRef, content, textareaProps, isDirty, saving, onContentChange: handleContentChange, onClose: () => setImmersiveEditorOpen(false), onSave: () => void handleSave(), onMarkdownTool: handleMarkdownTool}}
            typeCreatorProps={{open: typeCreatorOpen, projectId, existingNames: entryTypes.map(type => type.name), onClose: () => setTypeCreatorOpen(false), onSaved: created => void handleTypeCreated(created)}}
            tagCreatorProps={{open: tagCreatorOpen, projectId, entryTypes, existingNames: entryTags.localTagSchemas.map(schema => schema.name), existingCount: entryTags.localTagSchemas.length, onClose: () => setTagCreatorOpen(false), onSaved: handleTagSchemaSaved}}
            lightboxProps={{open: lightboxOpen, images: lightboxImages, currentIndex: lightboxIndex, infoTitle: title || entry.title || '未命名词条', onClose: () => setLightboxOpen(false), onIndexChange: setLightboxIndex, onSetCover: handleSetCover, onRemove: handleRemoveImage, onRemoveMany: handleRemoveImages, onAddImage: () => { setLightboxOpen(false); setImageAddModalOpen(true) }, onInsertMarkdown: handleInsertImageMarkdown}}
            imageAddProps={{open: imageAddModalOpen, projectId, entryTitle: title || entry.title || null, entrySummary: summary || entry.summary || null, entryType: entryType || entry.type || null, existingImages: images, onClose: () => setImageAddModalOpen(false), onUploadLocal: handleUploadImages, onAddAiImages: handleAddAiImages, onInsertImage: image => { const index = images.findIndex(item => item.path === image.path && item.url === image.url); handleInsertImageMarkdown(index >= 0 ? index : images.length) }, onOpenAiSettings: pluginId => navigateToTab('settings', {type: 'settingsAi', params: {pluginId}})}}
        />
    }

    // ---------- 查看态 ----------
    const et = entry.type ? entryTypes.find(t => entryTypeKey(t) === entry.type) ?? null : null
    const typeBadgeStyle = et?.color
        ? {
            '--mobile-entry-type-bg': `${et.color}22`,
            '--mobile-entry-type-color': et.color,
        } as CSSProperties
        : undefined

    const viewTagMap = tagDraft
    const viewTagSchemas = entryTags.browseVisibleTagSchemas
    const viewImages = normalizeEntryImages(entry.images)
    const viewMarkdownSource = buildMarkdownPreviewSource(entry.content ?? '', viewImages)
    const viewRelationDrafts = entryRelations
        .map(relation => buildRelationDraft(entryId, relation))
        .filter(relation => relation.otherEntryId)
    const hasConnections = viewRelationDrafts.length > 0 || outgoingLinks.length > 0 || incomingLinks.length > 0

    return (
        <MobileEntryDetailView
            pageRef={pageRef}
            topActionsRef={topActionsRef}
            entry={entry} error={loadError}
            entryType={et}
            typeBadgeStyle={typeBadgeStyle}
            viewTagSchemas={viewTagSchemas}
            implantedTagSchemaIdSet={entryTags.implantedTagSchemaIdSet}
            viewTagMap={viewTagMap}
            viewImages={viewImages}
            viewMarkdownSource={viewMarkdownSource}
            viewRelationDrafts={viewRelationDrafts}
            hasConnections={hasConnections}
            outgoingLinks={outgoingLinks}
            incomingLinks={incomingLinks}
            entryBriefById={entryBriefById}
            connectionsResolving={hasConnectionData && !projectEntriesLoaded}
            colorMode={colorMode}
            menuOpen={menuOpen}
            setMenuOpen={setMenuOpen}
            onBack={pop}
            onAiDiscuss={handleAiDiscuss}
            onEdit={enterEdit}
            onDelete={handleDelete}
            onOpenLinkedEntry={handleOpenLinkedEntry}
            onMarkdownClick={handleMarkdownClick}
        />
    )
}
