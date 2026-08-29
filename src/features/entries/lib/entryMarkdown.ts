import {openUrl} from '../../../api/opener'
import type {FCImage} from '../../../api'
import {resolveEntryImageByMarkdownRef, toEntryImageSrc} from './entryImage'
import {
    buildLegacyEntryHref,
    type InternalEntryLink,
    isSafeExternalHref,
    parseInternalEntryHref,
} from './entryLinkHref'

/* 纯链接解析已下沉到 entryLinkHref.ts；这里原样再导出，调用方不必改 import。 */
export {
    buildInternalEntryHref,
    buildInternalEntryMarkdown,
    buildLegacyEntryHref,
    isSafeExternalHref,
    parseInternalEntryHref,
    resolveInternalEntryProjectId,
    resolveMarkdownAnchor,
    type InternalEntryLink,
} from './entryLinkHref'

export function parseInternalEntryLinks(content?: string | null): InternalEntryLink[] {
    if (!content) return []

    const links: InternalEntryLink[] = []
    const markdownMatches = content.matchAll(/\[([^\]\n]+?)]\(((?:fc|entry):\/\/[^)]+)\)/g)
    for (const match of markdownMatches) {
        const title = String(match[1] ?? '').trim()
        const link = parseInternalEntryHref(String(match[2] ?? '').trim(), title)
        if (!title || !link?.entryId) continue
        links.push(link)
    }

    const wikiMatches = content.matchAll(/\[\[([^[\]\n]+?)]]/g)
    for (const match of wikiMatches) {
        const title = String(match[1] ?? '').trim()
        if (!title) continue
        links.push({title, projectId: null, entryId: null})
    }

    return links
}

function encodeMarkdownUrl(value: string): string {
    return value.replace(/[\s()]/g, (char) => encodeURIComponent(char))
}

function buildImagePreviewSource(content: string, images: FCImage[]): string {
    if (!images.length || !/!\[[^\]\n]*]\((?:fcimg:|fc:\/\/[^)\s]+\/image\/)/i.test(content)) return content

    return content.replace(/!\[([^\]\n]*)]\(((?:fcimg:|fc:\/\/[^)\s]+\/image\/)[^)]+)\)/gi, (match, alt, rawSrc) => {
        const image = resolveEntryImageByMarkdownRef(String(rawSrc).trim(), images)
        const src = toEntryImageSrc(image)
        if (!src) return match
        return `![${alt}](${encodeMarkdownUrl(src)})`
    })
}

export function buildMarkdownPreviewSource(content: string, images: FCImage[] = []): string {
    const withImages = buildImagePreviewSource(content, images)
    return withImages.replace(/\[\[([^[\]\n]+?)]]/g, (_match, rawTitle) => {
        const title = String(rawTitle).trim()
        return `[${title}](${buildLegacyEntryHref(title)})`
    })
}

export function stripMarkdown(value: string): string {
    return value
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
        .replace(/[#>*_~-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

export function buildExcerpt(value?: string | null, maxLength = 120): string {
    const normalized = stripMarkdown(value ?? '')
    if (!normalized) return '暂无正文'
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
}

export function openExternalLink(href: string): void {
    if (isSafeExternalHref(href)) {
        void openUrl(href)
    }
}
