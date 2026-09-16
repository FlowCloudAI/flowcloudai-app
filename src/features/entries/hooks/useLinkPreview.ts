import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {Entry, EntryBrief} from '../../../api'
import {normalizeEntryLookupTitle} from '../lib/entryCommon'
import {resolveInternalEntryProjectId} from '../lib/entryMarkdown'

interface UseLinkPreviewOptions {
    currentProjectId?: string | null
    entryCache: Record<string, Entry>
    projectEntries: EntryBrief[]
    ensureProjectEntriesLoaded: () => Promise<void>
    ensureEntryDetail?: (entryId: string) => Promise<void>
    onOpenEntry?: (projectId: string, entry: { id: string; title: string }) => void
    onMissingLink?: (message: string) => void
}

type EntryLinkTarget = {
    projectId?: string | null
    entryId?: string | null
    title: string
    isSelfProject?: boolean
}

type LinkPreviewState = {
    title: string
    projectId: string | null
    entryId: string | null
    missingReason?: string
}

export default function useLinkPreview({
                                           currentProjectId,
                                           entryCache,
                                           projectEntries,
                                           ensureProjectEntriesLoaded,
                                           ensureEntryDetail,
                                           onOpenEntry,
                                           onMissingLink,
                                       }: UseLinkPreviewOptions) {
    const [linkPreview, setLinkPreview] = useState<LinkPreviewState | null>(null)
    const [linkPreviewPosition, setLinkPreviewPosition] = useState<{ top: number; left: number }>({top: 16, left: 16})
    const linkPreviewCloseTimerRef = useRef<number | null>(null)
    const linkPreviewAnchorRef = useRef<HTMLAnchorElement | null>(null)
    const linkPreviewRequestRef = useRef<object | null>(null)

    const clearLinkPreviewCloseTimer = useCallback(() => {
        if (linkPreviewCloseTimerRef.current !== null) {
            window.clearTimeout(linkPreviewCloseTimerRef.current)
            linkPreviewCloseTimerRef.current = null
        }
    }, [])

    const closeLinkPreview = useCallback(() => {
        clearLinkPreviewCloseTimer()
        linkPreviewAnchorRef.current = null
        linkPreviewRequestRef.current = null
        setLinkPreview(null)
    }, [clearLinkPreviewCloseTimer])

    const scheduleLinkPreviewClose = useCallback(() => {
        clearLinkPreviewCloseTimer()
        linkPreviewCloseTimerRef.current = window.setTimeout(() => {
            linkPreviewAnchorRef.current = null
            linkPreviewRequestRef.current = null
            setLinkPreview(null)
            linkPreviewCloseTimerRef.current = null
        }, 90)
    }, [clearLinkPreviewCloseTimer])

    useEffect(() => {
        return () => {
            if (linkPreviewCloseTimerRef.current !== null) {
                window.clearTimeout(linkPreviewCloseTimerRef.current)
            }
        }
    }, [])

    useEffect(() => {
        if (!linkPreview) return
        const handleViewportChange = () => closeLinkPreview()
        window.addEventListener('resize', handleViewportChange)
        window.addEventListener('scroll', handleViewportChange, true)
        return () => {
            window.removeEventListener('resize', handleViewportChange)
            window.removeEventListener('scroll', handleViewportChange, true)
        }
    }, [closeLinkPreview, linkPreview])

    const linkPreviewEntry = useMemo(() => {
        if (!linkPreview) return null
        if (linkPreview.missingReason) return null
        if (linkPreview.projectId && linkPreview.projectId !== currentProjectId) return null
        if (linkPreview.entryId) return entryCache[linkPreview.entryId] ?? null
        const normalizedLinkTitle = normalizeEntryLookupTitle(linkPreview.title)
        return Object.values(entryCache).find((item) => (
            normalizeEntryLookupTitle(item.title) === normalizedLinkTitle
        )) ?? null
    }, [currentProjectId, entryCache, linkPreview])

    function updateLinkPreviewPositionFromRect(anchorRect: Pick<DOMRectReadOnly, 'top' | 'left' | 'width' | 'height'>) {
        const gap = 12
        const viewportPadding = 12
        const right = anchorRect.left + anchorRect.width
        const bottom = anchorRect.top + anchorRect.height
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const panelWidth = Math.min(320, Math.max(260, viewportWidth - viewportPadding * 2))
        const panelHeight = 260
        const preferRight = right + gap + panelWidth <= viewportWidth - viewportPadding
        const nextLeft = preferRight
            ? right + gap
            : Math.max(viewportPadding, anchorRect.left - panelWidth - gap)
        const preferBelow = bottom + gap + panelHeight <= viewportHeight - viewportPadding
        const centeredTop = anchorRect.top + anchorRect.height / 2 - panelHeight / 2
        const nextTop = preferBelow
            ? bottom + gap
            : Math.min(
                Math.max(viewportPadding, centeredTop),
                Math.max(viewportPadding, viewportHeight - panelHeight - viewportPadding),
            )

        setLinkPreviewPosition((current) => (
            current.left === nextLeft && current.top === nextTop
                ? current
                : {left: nextLeft, top: nextTop}
        ))
    }

    function updateLinkPreviewPosition(anchor: HTMLAnchorElement) {
        updateLinkPreviewPositionFromRect(anchor.getBoundingClientRect())
    }

    function getLinkProjectId(link: EntryLinkTarget): string | null {
        return resolveInternalEntryProjectId(link, currentProjectId)
    }

    function getOpenMissingReason(link: EntryLinkTarget): string | null {
        if (!link.entryId) return null
        const targetProjectId = getLinkProjectId(link)
        if (targetProjectId) return null
        return link.isSelfProject
            ? '当前没有项目上下文，无法定位词条。'
            : '旧版词条链接缺少项目 ID，无法定位词条。'
    }

    function getPreviewMissingReason(link: EntryLinkTarget): string | null {
        const targetProjectId = getLinkProjectId(link)
        if (link.entryId && targetProjectId && targetProjectId !== currentProjectId) {
            return '词条链接指向其他项目，点击后打开。'
        }
        if (link.entryId) return getOpenMissingReason(link)
        return null
    }

    function findProjectEntry(link: EntryLinkTarget): EntryBrief | undefined {
        if (link.entryId) {
            if (getPreviewMissingReason(link)) return undefined
            const targetById = projectEntries.find((item) => item.id === link.entryId)
            if (targetById) return targetById
        }
        const normalizedTitle = normalizeEntryLookupTitle(link.title)
        if (!normalizedTitle) return undefined
        return projectEntries.find((item) => (
            normalizeEntryLookupTitle(item.title) === normalizedTitle
        ))
    }

    function resolveLinkPreview(link: EntryLinkTarget, request: object) {
        const missingReason = getPreviewMissingReason(link)
        if (missingReason) {
            const targetProjectId = getLinkProjectId(link)
            setLinkPreview({
                title: link.title,
                projectId: targetProjectId,
                entryId: link.entryId ?? null,
                missingReason,
            })
            return
        }
        void ensureProjectEntriesLoaded().then(async () => {
            if (linkPreviewRequestRef.current !== request) return
            const target = findProjectEntry(link)
            if (target) await ensureEntryDetail?.(target.id)
            if (linkPreviewRequestRef.current !== request) return
            setLinkPreview({
                title: target?.title ?? link.title,
                projectId: currentProjectId ?? null,
                entryId: target?.id ?? null,
            })
        })
    }

    function openLinkPreview(anchor: HTMLAnchorElement, link: EntryLinkTarget) {
        clearLinkPreviewCloseTimer()
        linkPreviewAnchorRef.current = anchor
        linkPreviewRequestRef.current = anchor
        updateLinkPreviewPosition(anchor)
        resolveLinkPreview(link, anchor)
    }

    function openLinkPreviewAtRect(
        rect: Pick<DOMRectReadOnly, 'top' | 'left' | 'width' | 'height'>,
        link: EntryLinkTarget,
    ) {
        clearLinkPreviewCloseTimer()
        linkPreviewAnchorRef.current = null
        const request = {}
        linkPreviewRequestRef.current = request
        updateLinkPreviewPositionFromRect(rect)
        resolveLinkPreview(link, request)
    }

    function handleOpenLinkedEntry(link: EntryLinkTarget) {
        const missingReason = getOpenMissingReason(link)
        if (missingReason) {
            const targetProjectId = getLinkProjectId(link)
            onMissingLink?.(missingReason)
            setLinkPreview({
                title: link.title,
                projectId: targetProjectId,
                entryId: link.entryId ?? null,
                missingReason,
            })
            return
        }
        const targetProjectId = getLinkProjectId(link)
        if (link.entryId && targetProjectId && targetProjectId !== currentProjectId) {
            onOpenEntry?.(targetProjectId, {id: link.entryId, title: link.title || '词条'})
            return
        }
        const target = findProjectEntry(link)
        if (!target) {
            setLinkPreview({
                title: link.title,
                projectId: currentProjectId ?? null,
                entryId: null,
            })
            return
        }
        if (currentProjectId) onOpenEntry?.(currentProjectId, {id: target.id, title: target.title})
    }

    return {
        linkPreview,
        linkPreviewPosition,
        linkPreviewEntry,
        linkPreviewAnchorRef,
        linkPreviewCloseTimerRef,
        clearLinkPreviewCloseTimer,
        closeLinkPreview,
        scheduleLinkPreviewClose,
        updateLinkPreviewPosition,
        openLinkPreview,
        openLinkPreviewAtRect,
        handleOpenLinkedEntry,
        setLinkPreview,
    }
}
