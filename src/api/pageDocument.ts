/**
 * 页面文档 Tauri API：只暴露独立 HTML/CSS 存取，并把保存错误归一化为编辑会话可分支的结果。
 */
import {invoke} from '@tauri-apps/api/core'
import {ErrorCode, toApiError} from './error.ts'

export interface PageDocument {
    entryId: string
    projectId: string
    html: string
    css: string
    derivedText: string
    revision: number
    modifiedBy: string
    updatedAt: string
}

export interface SavePageDocumentInput {
    entryId: string
    projectId: string
    html: string
    css: string
    expectedRevision?: number
    requestKey: string
    modifiedBy?: string
}

export interface SavePageDocumentResult {
    document: PageDocument
    revision: number
    requestKey: string
}

export interface PageDocumentDiagnostic {
    severity: 'error' | 'warning'
    category: string
    code: string
    message: string
    file?: 'article.html' | 'style.css'
    range?: {from: number; to: number}
    nodeId?: string
    details?: unknown
}

export interface PageDocumentValidation {
    valid: boolean
    diagnostics: PageDocumentDiagnostic[]
    derivedText: string
    textBlocks: Array<{nodeId: string; text: string}>
    linkTargets: Array<{entryId: string | null; title: string}>
    assetIds: string[]
}

export interface PageDocumentProjectionRebuildReport {
    rebuilt: number
    skippedCount: number
    skipped: string[]
}

/** 项目打开时补建缺失的页面派生索引；命令只更新投影，不写源码或 revision。 */
export function pageDocumentRebuildProjection(projectId: string): Promise<PageDocumentProjectionRebuildReport> {
    return invoke('page_document_rebuild_projection', {projectId})
}

export interface PageDocumentAsset {
    id: string
    projectId: string
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
    sizeBytes: number
    sha256: string
    width: number
    height: number
    createdAt: string
}

export interface PageDocumentAssetFrame {
    assetId: string
    width: number
    height: number
    originalWidth: number
    originalHeight: number
    rgbaBase64: string
}

export function pageDocumentListAssets(projectId: string): Promise<PageDocumentAsset[]> {
    return invoke('page_document_list_assets', {projectId})
}

export function pageDocumentCheckAsset(projectId: string, assetId: string): Promise<PageDocumentAsset> {
    return invoke('page_document_check_asset', {projectId, assetId})
}

export function pageDocumentReadAssetFrame(projectId: string, assetId: string): Promise<PageDocumentAssetFrame> {
    return invoke('page_document_read_asset_frame', {projectId, assetId})
}

export async function pageDocumentChooseAndImportAsset(projectId: string): Promise<PageDocumentAsset | null> {
    return invoke('page_document_import_asset', {projectId})
}

export function pageDocumentAssetErrorMessage(value: unknown): string {
    const error = toApiError(value)
    const status = error.detail?.assetStatus
    if (status === 'unavailable') return `图片不存在、无权读取或原件已损坏：${error.message}`
    if (status === 'invalid') return `不支持或无效的图片：${error.message}`
    return error.message
}

export function pageDocumentAssetErrorStatus(value: unknown): 'unavailable' | 'invalid' {
    return toApiError(value).detail?.assetStatus === 'invalid' ? 'invalid' : 'unavailable'
}

interface PageDocumentWire extends Omit<PageDocument, 'entryId' | 'projectId' | 'derivedText' | 'modifiedBy' | 'updatedAt'> {
    entry_id: string
    project_id: string
    derived_text: string
    modified_by: string
    updated_at: string
}

interface SavePageDocumentResultWire {
    document: PageDocumentWire
    revision: number
    request_key: string
}

export type PageDocumentSaveError =
    | {kind: 'conflict'; message: string; currentRevision: number | null}
    | {kind: 'validation'; message: string; diagnostics: PageDocumentDiagnostic[]}
    | {kind: 'other'; message: string; code: string}

function diagnosticsFromDetail(value: unknown): PageDocumentDiagnostic[] {
    if (!Array.isArray(value)) return []
    return value.filter((item): item is PageDocumentDiagnostic => {
        if (!item || typeof item !== 'object') return false
        const diagnostic = item as Record<string, unknown>
        return (
            (diagnostic.severity === 'error' || diagnostic.severity === 'warning') &&
            typeof diagnostic.category === 'string' &&
            typeof diagnostic.code === 'string' &&
            typeof diagnostic.message === 'string'
        )
    })
}

/** 保存错误只在有明确后端证据时分类，格式异常等模糊错误继续走 other。 */
export function parsePageDocumentSaveError(value: unknown): PageDocumentSaveError {
    const error = toApiError(value)
    if (error.code === ErrorCode.DocumentRevisionConflict) {
        const revision = error.detail?.currentRevision
        return {
            kind: 'conflict',
            message: error.message,
            currentRevision:
                typeof revision === 'number' && Number.isInteger(revision) && revision >= 1
                    ? revision
                    : null,
        }
    }
    const diagnostics = diagnosticsFromDetail(error.detail?.diagnostics)
    if (error.code === ErrorCode.ValidationFormatError && diagnostics.length > 0) {
        return {kind: 'validation', message: error.message, diagnostics}
    }
    return {kind: 'other', message: error.message, code: error.code}
}

function fromWireDocument(document: PageDocumentWire): PageDocument {
    return {
        entryId: document.entry_id,
        projectId: document.project_id,
        html: document.html,
        css: document.css,
        derivedText: document.derived_text,
        revision: document.revision,
        modifiedBy: document.modified_by,
        updatedAt: document.updated_at,
    }
}

export async function pageDocumentReadEntry(entryId: string): Promise<PageDocument | null> {
    const document = await invoke<PageDocumentWire | null>('page_document_read_entry', {entryId})
    return document ? fromWireDocument(document) : null
}

export async function pageDocumentSaveEntry(
    input: SavePageDocumentInput,
): Promise<SavePageDocumentResult> {
    const result = await invoke<SavePageDocumentResultWire>('page_document_save_entry', {input})
    return {
        document: fromWireDocument(result.document),
        revision: result.revision,
        requestKey: result.request_key,
    }
}

export function pageDocumentValidate(html: string, css: string, projectId?: string) {
    return invoke<PageDocumentValidation>('page_document_validate', {html, css, projectId})
}
