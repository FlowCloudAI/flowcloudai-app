// 本 hook 维持只读画布的内链导航与悬停预览边界；编辑模式仍不会弹出链接浮窗。

import {useCallback} from 'react'
import {useAlert} from 'flowcloudai-ui'
import {openUrl} from '../../../api/opener.ts'
import {logger} from '../../../shared/logger'
import type {EntryEditorMode} from '../lib/entryEditorShortcutModel.ts'
import {parseCanvasHoverEntryTarget} from '../lib/entryCanvasHoverTarget.ts'
import {isSafeExternalHref, parseInternalEntryHref} from '../lib/entryMarkdown.ts'
import type useLinkPreview from './useLinkPreview.ts'

type LinkPreviewController = ReturnType<typeof useLinkPreview>

interface UseEntryPageDocumentNavigationOptions {
    active: boolean
    editorMode: EntryEditorMode
    ensureProjectEntriesLoaded: () => Promise<void> | undefined
    linkPreview: LinkPreviewController
}

export default function useEntryPageDocumentNavigation({
    active,
    editorMode,
    ensureProjectEntriesLoaded,
    linkPreview,
}: UseEntryPageDocumentNavigationOptions) {
    const {showAlert} = useAlert()
    const navigate = useCallback((href: string) => {
        const internalLink = parseInternalEntryHref(href)
        if (internalLink) {
            void ensureProjectEntriesLoaded()?.then(() => linkPreview.handleOpenLinkedEntry(internalLink))
            return
        }
        if (!isSafeExternalHref(href)) return
        void openUrl(href).catch(error => {
            logger.error('open page document external link failed', error)
            void showAlert('打开链接失败', 'error', 'nonInvasive', 1500)
        })
    }, [ensureProjectEntriesLoaded, linkPreview, showAlert])

    const hover = useCallback((event: {
        href: string | null
        rect: {top: number; left: number; width: number; height: number} | null
    }) => {
        if (!active || editorMode !== 'browse') {
            linkPreview.closeLinkPreview()
            return
        }
        if (event.href === null) {
            linkPreview.scheduleLinkPreviewClose()
            return
        }
        const target = parseCanvasHoverEntryTarget(event.href)
        if (!target || !event.rect) {
            linkPreview.closeLinkPreview()
            return
        }
        linkPreview.openLinkPreviewAtRect(event.rect, target)
    }, [active, editorMode, linkPreview])

    return {navigate, hover}
}
