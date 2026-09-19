// 本模块定义现有文档 API 与批量 operation；底层身份、源码和组件枚举来自共享内核契约。

import {
    DOCUMENT_DIAGNOSTIC_CATEGORIES,
    DOCUMENT_MUTABLE_NODE_TAGS,
    DOCUMENT_NODE_KINDS,
    DOCUMENT_VERSION,
    ENTRY_DESKTOP_MEDIA_QUERY,
    ENTRY_HOVER_MEDIA_QUERY,
    ENTRY_ASSET_MEDIA_TYPES,
    MANAGED_DESCENDANT_TARGETS,
    MANAGED_NODE_STYLE_CONTEXTS,
    SOURCE_FILE_NAMES,
    type DocumentDiagnosticCategory,
    type DocumentMutableNodeTag,
    type DocumentNodeKind,
    type EntryAssetMediaType,
    type ManagedDescendantTarget,
    type ManagedNodeStyleContext,
    type SourceFileName,
} from './kernel/contracts/primitives.ts'
import type {PublicComponentDefinitionContract} from './kernel/contracts/publicComponent.ts'

export {
    DOCUMENT_DIAGNOSTIC_CATEGORIES,
    DOCUMENT_MUTABLE_NODE_TAGS,
    DOCUMENT_NODE_KINDS,
    DOCUMENT_VERSION,
    ENTRY_DESKTOP_MEDIA_QUERY,
    ENTRY_HOVER_MEDIA_QUERY,
    ENTRY_ASSET_MEDIA_TYPES,
    MANAGED_DESCENDANT_TARGETS,
    MANAGED_NODE_STYLE_CONTEXTS,
    SOURCE_FILE_NAMES,
}
export type {
    DocumentDiagnosticCategory,
    DocumentMutableNodeTag,
    DocumentNodeKind,
    EntryAssetMediaType,
    ManagedDescendantTarget,
    ManagedNodeStyleContext,
    SourceFileName,
}

export const ENTRY_ASSET_MAX_BYTES = 10 * 1024 * 1024
export const TABLE_MIN_ROW_COUNT = 2
export const TABLE_MAX_ROW_COUNT = 20
export const TABLE_MIN_COLUMN_COUNT = 1
export const TABLE_MAX_COLUMN_COUNT = 12
export type DiagnosticSeverity = 'error' | 'warning'
export type DocumentSourceStatus =
    'ready' | 'external_invalid' | 'external_conflict' | 'template_conflict'
export type SourceHashes = Record<'article' | 'style', string>
export type SourceFileSet = Record<SourceFileName, string>
export type CssDeclarationPatch = Record<string, string | null>

/** 解析器、诊断与 DOM 文本使用 JavaScript UTF-16 code unit 下标。 */
export interface SourceRange {
    from: number
    to: number
}

/** 原始源码写入使用请求起始文件的 UTF-8 字节下标。 */
export interface Utf8SourceRange {
    from: number
    to: number
}

export interface DocumentDiagnostic {
    severity: DiagnosticSeverity
    category: DocumentDiagnosticCategory
    code: string
    message: string
    file?: SourceFileName
    range?: SourceRange
    nodeId?: string
    details?: unknown
}

export interface ProjectSourceSnapshot {
    projectRevision: number
    templateVersion: number
    hashes: SourceHashes
    defaultArticleHtml: string
    defaultStyleCss: string
    diagnostics: DocumentDiagnostic[]
    sourceStatus: DocumentSourceStatus
}

export interface EntryMetadataSnapshot {
    id: string
    title: string
    summary: string
    tags: string[]
}

export interface EntryAssetSnapshot {
    id: string
    mediaType: EntryAssetMediaType
    sizeBytes: number
    sha256: string
}

export interface EntryEditorLimits {
    paragraph: number
    asset: number
    managedNodes: number
    containerDepth: number
    containerChildren: number
}

export interface EntrySourceSnapshot {
    project: ProjectSourceSnapshot
    entry: EntryMetadataSnapshot
    documentVersion: typeof DOCUMENT_VERSION
    baseTemplateVersion: number
    revision: number
    hashes: SourceHashes
    articleHtml: string
    styleCss: string
    assets: EntryAssetSnapshot[]
    componentDefinitions: PublicComponentDefinitionContract[]
    editorLimits: EntryEditorLimits
    diagnostics: DocumentDiagnostic[]
    sourceStatus: DocumentSourceStatus
}

/** from/to 是相对请求开始时对应源码文件的 UTF-8 字节下标。 */
export interface SourceEdit extends Utf8SourceRange {
    file: SourceFileName
    expected: string
    insert: string
}

/**
 * 保存始终携带当前词条与项目模板的完整候选；服务端在同一 SQLite 事务中完成关联校验与写入。
 * 未变化的作用域不会单独推进 revision，但仍参与最终候选校验。
 */
export interface DocumentSaveBundleRequest {
    baseProjectRevision: number
    baseEntryRevision: number
    baseTemplateVersion: number
    projectSources: SourceFileSet
    entrySources: SourceFileSet
    idempotencyKey: string
}

export interface DocumentSaveBundleResult {
    projectRevision: number
    entryRevision: number
    templateVersion: number
    project: SourceMutationResult
    entry: SourceMutationResult
}

export interface SourceValidationRequest {
    sources: SourceFileSet
}

/** 词条候选预览可同时覆盖项目默认源；省略时继续读取当前已保存项目源。 */
export interface EntryPreviewRequest {
    sources: SourceFileSet
    projectSources?: SourceFileSet
}

export interface SourceMutationResult {
    dryRun: boolean
    revision: number
    sources: SourceFileSet
    diagnostics: DocumentDiagnostic[]
    changedFiles: SourceFileName[]
}

export interface SourceValidationResult {
    valid: boolean
    sources: SourceFileSet
    diagnostics: DocumentDiagnostic[]
    textProjection?: string | null
    templateVersion?: number | null
}

export interface PreviewArtifactResult {
    projectRevision: number
    revision: number
    srcdoc: string | null
    textProjection: string | null
    diagnostics: DocumentDiagnostic[]
    referencedAssetIds: string[]
    templateVersion: number | null
}
