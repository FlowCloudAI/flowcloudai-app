import {
    type Dispatch,
    type KeyboardEvent as ReactKeyboardEvent,
    type RefObject,
    type SetStateAction,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {useAlert} from 'flowcloudai-ui'
import type {MarkdownEditorRef} from '../../../features/entries/components/MarkdownEditor/MarkdownEditor'
import {
    db_create_entry,
    type EntryBrief,
    formatApiError,
    toApiError,
} from '../../../api'
import {logger} from '../../../shared/logger'
import {
    findCategoryDuplicatedEntry,
    normalizeEntryLookupTitle,
    replaceRange,
    resolveActiveWikiDraft,
} from '../../../features/entries/lib/entryCommon'
import {buildInternalEntryMarkdown} from '../../../features/entries/lib/entryMarkdown'
import {type MobileWikiDraft, type MobileWikiOption} from './MobileEntryDetailEditView'
import {type MobileMarkdownTool} from './MobileEntryMarkdownToolModel'
import {transformMarkdownContent} from './MobileEntryMarkdownTransforms'

interface UseMobileEntryWikiEditorOptions {
    projectId: string
    entryId: string
    categoryId: string | null
    content: string
    setContent: Dispatch<SetStateAction<string>>
    projectEntries: EntryBrief[]
    setProjectEntries: Dispatch<SetStateAction<EntryBrief[]>>
    immersiveEditorOpen: boolean
    inlineContentEditorRef: RefObject<MarkdownEditorRef | null>
    immersiveContentEditorRef: RefObject<MarkdownEditorRef | null>
    openImageAdd: () => void
}

export default function useMobileEntryWikiEditor({
    projectId,
    entryId,
    categoryId,
    content,
    setContent,
    projectEntries,
    setProjectEntries,
    immersiveEditorOpen,
    inlineContentEditorRef,
    immersiveContentEditorRef,
    openImageAdd,
}: UseMobileEntryWikiEditorOptions) {
    const {showAlert} = useAlert()
    const wikiDraftRetainTimerRef = useRef<number | null>(null)
    const [wikiDraft, setWikiDraft] = useState<MobileWikiDraft | null>(null)
    const [activeWikiOptionIndex, setActiveWikiOptionIndex] = useState(0)
    const [creatingLinkedEntry, setCreatingLinkedEntry] = useState(false)

    const wikiLinkSuggestions = useMemo(() => {
        if (!wikiDraft) return []
        const query = normalizeEntryLookupTitle(wikiDraft.query)
        return projectEntries
            .filter((item) => item.id !== entryId)
            .filter((item) => !query || normalizeEntryLookupTitle(item.title).includes(query))
            .slice(0, 8)
    }, [entryId, projectEntries, wikiDraft])

    const hasExactCategorySuggestion = useMemo(() => {
        const query = normalizeEntryLookupTitle(wikiDraft?.query)
        if (!query) return false
        return projectEntries.some((item) => (
            item.id !== entryId
            && (item.category_id ?? null) === (categoryId ?? null)
            && normalizeEntryLookupTitle(item.title) === query
        ))
    }, [categoryId, entryId, projectEntries, wikiDraft])

    const wikiLinkOptions = useMemo<MobileWikiOption[]>(() => {
        const options: MobileWikiOption[] = wikiLinkSuggestions.map((item) => ({
            kind: 'entry',
            id: item.id,
            title: item.title,
            categoryId: item.category_id ?? null,
        }))
        const pendingTitle = wikiDraft?.query.trim()
        if (pendingTitle && !hasExactCategorySuggestion) {
            options.push({kind: 'create', title: pendingTitle})
        }
        return options
    }, [hasExactCategorySuggestion, wikiDraft, wikiLinkSuggestions])

    useEffect(() => {
        if (!wikiDraft) {
            setActiveWikiOptionIndex(0)
            return
        }
        setActiveWikiOptionIndex((current) => {
            if (wikiLinkOptions.length <= 0) return 0
            return Math.min(current, wikiLinkOptions.length - 1)
        })
    }, [wikiDraft, wikiLinkOptions.length])

    useEffect(() => () => {
        if (wikiDraftRetainTimerRef.current !== null) {
            window.clearTimeout(wikiDraftRetainTimerRef.current)
        }
    }, [])

    const getContentTextarea = useCallback(
        () => (immersiveEditorOpen ? immersiveContentEditorRef : inlineContentEditorRef).current?.getTextareaElement() ?? null,
        [immersiveContentEditorRef, immersiveEditorOpen, inlineContentEditorRef],
    )

    const syncWikiDraftFromTextarea = useCallback((textarea: HTMLTextAreaElement | null, nextContent: string = content) => {
        if (!textarea) {
            setWikiDraft(null)
            return
        }
        const nextDraft = resolveActiveWikiDraft(nextContent, textarea.selectionStart)
        setWikiDraft((current) => {
            if (
                current?.start === nextDraft?.start
                && current?.end === nextDraft?.end
                && current?.query === nextDraft?.query
            ) {
                return current
            }
            return nextDraft
        })
    }, [content])

    const applyWikiLink = useCallback((linkedEntry: { id: string; title: string }, draft: MobileWikiDraft | null = wikiDraft) => {
        if (!draft) return
        const inserted = buildInternalEntryMarkdown(linkedEntry.title, linkedEntry.id, projectId)
        const nextContent = replaceRange(content, draft.start, draft.end, inserted)
        const nextCursor = draft.start + inserted.length
        setContent(nextContent)
        setWikiDraft(null)
        window.requestAnimationFrame(() => {
            const textarea = getContentTextarea()
            textarea?.focus()
            textarea?.setSelectionRange(nextCursor, nextCursor)
        })
    }, [content, getContentTextarea, projectId, setContent, wikiDraft])

    const handleCreateLinkedEntry = useCallback(async () => {
        const draft = wikiDraft
        const nextTitle = draft?.query.trim()
        if (!draft || !nextTitle || hasExactCategorySuggestion || creatingLinkedEntry) return

        setCreatingLinkedEntry(true)
        try {
            const nextCategoryId = categoryId ?? null
            const duplicatedEntry = await findCategoryDuplicatedEntry(projectId, nextCategoryId, nextTitle)
            if (duplicatedEntry) {
                await showAlert('当前分类下已存在同名词条，请直接选择已有词条。', 'warning', 'nonInvasive', 1800)
                setActiveWikiOptionIndex(0)
                return
            }

            const created = await db_create_entry({
                projectId,
                categoryId: nextCategoryId,
                title: nextTitle,
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
            setProjectEntries((current) => [brief, ...current])
            applyWikiLink({id: created.id, title: created.title}, draft)
            await showAlert('已创建并插入双链', 'success', 'nonInvasive', 1500)
        } catch (error) {
            logger.error('创建双链词条失败', error)
            await showAlert(`创建词条失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 2200)
        } finally {
            setCreatingLinkedEntry(false)
        }
    }, [applyWikiLink, categoryId, creatingLinkedEntry, hasExactCategorySuggestion, projectId, setProjectEntries, showAlert, wikiDraft])

    const handleWikiOptionCommit = useCallback((option: MobileWikiOption | undefined) => {
        if (!option) return
        if (option.kind === 'entry') {
            applyWikiLink({id: option.id, title: option.title})
            return
        }
        void handleCreateLinkedEntry()
    }, [applyWikiLink, handleCreateLinkedEntry])

    const handleContentChange = useCallback((nextContent: string) => {
        setContent(nextContent)
        window.requestAnimationFrame(() => {
            syncWikiDraftFromTextarea(getContentTextarea(), nextContent)
        })
    }, [getContentTextarea, setContent, syncWikiDraftFromTextarea])

    const handleContentKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (!wikiDraft || wikiLinkOptions.length <= 0) return
        if (event.nativeEvent.isComposing) return

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveWikiOptionIndex((current) => (current + 1) % wikiLinkOptions.length)
            return
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveWikiOptionIndex((current) => (current - 1 + wikiLinkOptions.length) % wikiLinkOptions.length)
            return
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            handleWikiOptionCommit(wikiLinkOptions[activeWikiOptionIndex])
            return
        }

        if (event.key === 'Escape') {
            event.preventDefault()
            setWikiDraft(null)
        }
    }, [activeWikiOptionIndex, handleWikiOptionCommit, wikiDraft, wikiLinkOptions])

    const handleContentBlur = useCallback(() => {
        if (wikiDraftRetainTimerRef.current !== null) {
            window.clearTimeout(wikiDraftRetainTimerRef.current)
        }
        wikiDraftRetainTimerRef.current = window.setTimeout(() => {
            setWikiDraft(null)
            wikiDraftRetainTimerRef.current = null
        }, 120)
    }, [])

    const handleContentFocus = useCallback(() => {
        if (wikiDraftRetainTimerRef.current !== null) {
            window.clearTimeout(wikiDraftRetainTimerRef.current)
            wikiDraftRetainTimerRef.current = null
        }
        syncWikiDraftFromTextarea(getContentTextarea())
    }, [getContentTextarea, syncWikiDraftFromTextarea])

    const handleMarkdownTool = useCallback((tool: MobileMarkdownTool) => {
        if (tool === 'image') {
            openImageAdd()
            return
        }
        const textarea = getContentTextarea()
        const start = textarea?.selectionStart ?? content.length
        const end = textarea?.selectionEnd ?? start
        const result = transformMarkdownContent(tool, content, start, end)
        setContent(result.value)
        window.requestAnimationFrame(() => {
            const nextTextarea = getContentTextarea()
            nextTextarea?.focus()
            nextTextarea?.setSelectionRange(result.selectionStart, result.selectionEnd)
            syncWikiDraftFromTextarea(nextTextarea ?? null, result.value)
        })
    }, [content, getContentTextarea, openImageAdd, setContent, syncWikiDraftFromTextarea])

    useEffect(() => {
        if (!immersiveEditorOpen) return
        window.requestAnimationFrame(() => {
            const textarea = immersiveContentEditorRef.current?.getTextareaElement()
            textarea?.focus()
            syncWikiDraftFromTextarea(textarea ?? null)
        })
    }, [immersiveContentEditorRef, immersiveEditorOpen, syncWikiDraftFromTextarea])

    return {
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
    }
}
