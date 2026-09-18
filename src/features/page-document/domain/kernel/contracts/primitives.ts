// 本模块定义文档内核最底层的稳定枚举与结构类型；旧 API 契约与新内核都只能从这里取得这些事实。

export const DOCUMENT_VERSION = 1 as const
export const SOURCE_FILE_NAMES = ['article.html', 'style.css'] as const
export const DOCUMENT_NODE_KINDS = [
    'paragraph',
    'heading',
    'list',
    'list-item',
    'table',
    'table-cell',
    'asset',
    'gallery',
    'divider',
    'container',
    'component',
] as const
export const ENTRY_ASSET_MEDIA_TYPES = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
] as const
export const DOCUMENT_MUTABLE_NODE_TAGS = ['h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol'] as const
export const MANAGED_DESCENDANT_TARGETS = ['asset-image'] as const
export const MANAGED_NODE_STYLE_CONTEXTS = ['mobile', 'desktop', 'hover', 'focus-within'] as const
export const DOCUMENT_DIAGNOSTIC_CATEGORIES = [
    'security',
    'capability',
    'portability',
    'resource',
] as const

export const ENTRY_DESKTOP_MEDIA_QUERY = '(min-width: 48rem)' as const
export const ENTRY_HOVER_MEDIA_QUERY = '(hover: hover)' as const

export type SourceFileName = (typeof SOURCE_FILE_NAMES)[number]
export type DocumentNodeKind = (typeof DOCUMENT_NODE_KINDS)[number]
export type DocumentMutableNodeTag = (typeof DOCUMENT_MUTABLE_NODE_TAGS)[number]
export type ManagedDescendantTarget = (typeof MANAGED_DESCENDANT_TARGETS)[number]
export type ManagedNodeStyleContext = (typeof MANAGED_NODE_STYLE_CONTEXTS)[number]
export type EntryAssetMediaType = (typeof ENTRY_ASSET_MEDIA_TYPES)[number]
export type DocumentDiagnosticCategory = (typeof DOCUMENT_DIAGNOSTIC_CATEGORIES)[number]
