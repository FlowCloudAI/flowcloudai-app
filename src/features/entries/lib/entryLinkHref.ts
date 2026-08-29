/*
 * 词条链接的纯解析层：只做字符串与 DOM 判定，不碰 Tauri API、图片或任何副作用。
 *
 * 从 entryMarkdown.ts 拆出来，是为了让依赖它的模块（AI 回复的可渲染化管线）能在
 * node 里直接被单元测试导入——entryMarkdown.ts 一侧还引了 api/opener 与图片解析，
 * 那条链在测试环境里跑不起来。原有调用方无需改动：entryMarkdown.ts 原样再导出。
 */
const INTERNAL_ENTRY_HREF_PREFIX = 'fc://'
const LEGACY_INTERNAL_ENTRY_HREF_PREFIX = 'entry://'
const LEGACY_ENTRY_HREF_PREFIX = 'entry-title://'
const SELF_PROJECT_ID = 'self'

export type InternalEntryLink = {
    projectId: string | null
    entryId: string | null
    title: string
    isSelfProject?: boolean
}

export function buildInternalEntryHref(entryId: string, projectId?: string | null): string {
    if (projectId) {
        return `${INTERNAL_ENTRY_HREF_PREFIX}${SELF_PROJECT_ID}/entry/${encodeURIComponent(entryId)}`
    }
    return `${LEGACY_INTERNAL_ENTRY_HREF_PREFIX}${encodeURIComponent(entryId)}`
}

export function buildLegacyEntryHref(title: string): string {
    return `${LEGACY_ENTRY_HREF_PREFIX}${encodeURIComponent(title)}`
}

export function buildInternalEntryMarkdown(title: string, entryId: string, projectId?: string | null): string {
    return `[${title}](${buildInternalEntryHref(entryId, projectId)})`
}

export function resolveMarkdownAnchor(target: EventTarget | null): HTMLAnchorElement | null {
    if (!(target instanceof Element)) return null
    return target.closest('a') as HTMLAnchorElement | null
}

export function isSafeExternalHref(href: string): boolean {
    return /^(https?:|mailto:|tel:)/i.test(href)
}

export function resolveInternalEntryProjectId(
    link: { projectId?: string | null; isSelfProject?: boolean },
    currentProjectId?: string | null,
): string | null {
    return link.isSelfProject ? (currentProjectId?.trim() || null) : (link.projectId ?? null)
}

export function parseInternalEntryHref(href: string, fallbackTitle = ''): InternalEntryLink | null {
    if (href.startsWith(INTERNAL_ENTRY_HREF_PREFIX)) {
        const value = href.slice(INTERNAL_ENTRY_HREF_PREFIX.length).trim()
        const parts = value.split('/')
        const projectId = decodeURIComponent(parts[0] ?? '').trim()
        if (parts.length !== 3 || parts[1] !== 'entry' || !projectId) return null
        const entryId = decodeURIComponent(parts[2] ?? '').trim()
        if (!entryId) return null
        const isSelfProject = projectId.toLowerCase() === SELF_PROJECT_ID
        return {
            projectId: isSelfProject ? null : projectId,
            entryId,
            title: fallbackTitle.trim(),
            isSelfProject,
        }
    }

    if (href.startsWith(LEGACY_INTERNAL_ENTRY_HREF_PREFIX)) {
        const value = href.slice(LEGACY_INTERNAL_ENTRY_HREF_PREFIX.length).trim()
        const separatorIndex = value.indexOf('/')
        const projectId = separatorIndex >= 0
            ? decodeURIComponent(value.slice(0, separatorIndex)).trim()
            : null
        const entryId = decodeURIComponent(separatorIndex >= 0 ? value.slice(separatorIndex + 1) : value).trim()
        if (!entryId) return null
        return {
            projectId: projectId || null,
            entryId,
            title: fallbackTitle.trim(),
        }
    }

    if (href.startsWith(LEGACY_ENTRY_HREF_PREFIX)) {
        const title = decodeURIComponent(href.slice(LEGACY_ENTRY_HREF_PREFIX.length)).trim()
        if (!title) return null
        return {
            projectId: null,
            entryId: null,
            title,
        }
    }

    return null
}
