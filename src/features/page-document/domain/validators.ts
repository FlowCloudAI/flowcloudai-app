// 本模块在网络与文件边界校验共享文档 DTO；这里只判断契约形状，不执行 HTML/CSS 语义校验。
import {
    DOCUMENT_DIAGNOSTIC_CATEGORIES,
    DOCUMENT_VERSION,
    ENTRY_ASSET_MEDIA_TYPES,
    SOURCE_FILE_NAMES,
    type DocumentDiagnostic,
    type DocumentDiagnosticCategory,
    type DocumentSaveBundleRequest,
    type DocumentSaveBundleResult,
    type EntryPreviewRequest,
    type EntryAssetSnapshot,
    type EntrySourceSnapshot,
    type ProjectSourceSnapshot,
    type PreviewArtifactResult,
    type SourceFileSet,
    type SourceMutationResult,
    type SourceValidationResult,
    type SourceValidationRequest,
    type SourceFileName,
    type SourceHashes,
    type SourceRange,
} from './contract.ts'
import {RFC_9562_UUID_PATTERN} from './uuidPolicy.ts'

const SHA256_PATTERN = /^[0-9a-f]{64}$/i

export interface ContractValidationIssue {
    path: string
    code: string
    message: string
}

export type ContractParseResult<T> =
    {ok: true; value: T; issues: []} | {ok: false; value: null; issues: ContractValidationIssue[]}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function addIssue(
    issues: ContractValidationIssue[],
    path: string,
    code: string,
    message: string,
): void {
    issues.push({path, code, message})
}

function validateKnownKeys(
    value: Record<string, unknown>,
    knownKeys: readonly string[],
    path: string,
    issues: ContractValidationIssue[],
): void {
    const known = new Set(knownKeys)
    for (const key of Object.keys(value)) {
        if (!known.has(key))
            addIssue(issues, `${path}.${key}`, 'unknown_field', '字段未在当前契约中声明。')
    }
}

function validateString(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
    options: {nonEmpty?: boolean; pattern?: RegExp; code?: string} = {},
): value is string {
    if (typeof value !== 'string' || (options.nonEmpty && value.length === 0)) {
        addIssue(issues, path, options.code ?? 'invalid_string', '字段必须是字符串。')
        return false
    }
    if (options.pattern && !options.pattern.test(value)) {
        addIssue(issues, path, options.code ?? 'invalid_string', '字符串格式不符合契约。')
        return false
    }
    return true
}

function validateInteger(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
    minimum: number,
): value is number {
    if (!Number.isInteger(value) || (value as number) < minimum) {
        addIssue(issues, path, 'invalid_integer', `字段必须是大于等于 ${minimum} 的整数。`)
        return false
    }
    return true
}

function validateRange(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): value is SourceRange {
    if (!isRecord(value)) {
        addIssue(issues, path, 'invalid_range', '源码区间必须是对象。')
        return false
    }
    validateKnownKeys(value, ['from', 'to'], path, issues)
    const fromValid = validateInteger(value.from, `${path}.from`, issues, 0)
    const toValid = validateInteger(value.to, `${path}.to`, issues, 0)
    if (fromValid && toValid && (value.to as number) < (value.from as number)) {
        addIssue(issues, path, 'invalid_range', '源码区间的 to 不得小于 from。')
        return false
    }
    return fromValid && toValid
}

function validateDiagnostic(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): value is DocumentDiagnostic {
    if (!isRecord(value)) {
        addIssue(issues, path, 'invalid_diagnostic', '诊断必须是对象。')
        return false
    }
    validateKnownKeys(
        value,
        ['severity', 'category', 'code', 'message', 'file', 'range', 'nodeId', 'details'],
        path,
        issues,
    )
    let valid = true
    if (value.severity !== 'error' && value.severity !== 'warning') {
        addIssue(
            issues,
            `${path}.severity`,
            'invalid_severity',
            '诊断级别必须是 error 或 warning。',
        )
        valid = false
    }
    if (!DOCUMENT_DIAGNOSTIC_CATEGORIES.includes(value.category as DocumentDiagnosticCategory)) {
        addIssue(
            issues,
            `${path}.category`,
            'invalid_diagnostic_category',
            '诊断分类必须是 security、capability、portability 或 resource。',
        )
        valid = false
    }
    valid = validateString(value.code, `${path}.code`, issues, {nonEmpty: true}) && valid
    valid = validateString(value.message, `${path}.message`, issues, {nonEmpty: true}) && valid
    if (value.file !== undefined && !SOURCE_FILE_NAMES.includes(value.file as SourceFileName)) {
        addIssue(issues, `${path}.file`, 'invalid_source_file', '诊断指向未知源码文件。')
        valid = false
    }
    if (value.range !== undefined)
        valid = validateRange(value.range, `${path}.range`, issues) && valid
    if (value.nodeId !== undefined) {
        valid =
            validateString(value.nodeId, `${path}.nodeId`, issues, {
                pattern: RFC_9562_UUID_PATTERN,
                code: 'invalid_uuid',
            }) && valid
    }
    return valid
}

function validateDiagnostics(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): value is DocumentDiagnostic[] {
    if (!Array.isArray(value)) {
        addIssue(issues, path, 'invalid_diagnostics', '诊断集合必须是数组。')
        return false
    }
    return value.reduce<boolean>(
        (valid, diagnostic, index) =>
            validateDiagnostic(diagnostic, `${path}[${index}]`, issues) && valid,
        true,
    )
}

function validateHashes(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): value is SourceHashes {
    if (!isRecord(value)) {
        addIssue(issues, path, 'invalid_hashes', '源码 hash 必须是对象。')
        return false
    }
    validateKnownKeys(value, ['article', 'style'], path, issues)
    const articleValid = validateString(value.article, `${path}.article`, issues, {
        pattern: SHA256_PATTERN,
        code: 'invalid_sha256',
    })
    const styleValid = validateString(value.style, `${path}.style`, issues, {
        pattern: SHA256_PATTERN,
        code: 'invalid_sha256',
    })
    return articleValid && styleValid
}

function validateProjectSnapshot(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): value is ProjectSourceSnapshot {
    if (!isRecord(value)) {
        addIssue(issues, path, 'invalid_project_snapshot', '项目源码快照必须是对象。')
        return false
    }
    validateKnownKeys(
        value,
        [
            'projectRevision',
            'templateVersion',
            'hashes',
            'defaultArticleHtml',
            'defaultStyleCss',
            'diagnostics',
            'sourceStatus',
        ],
        path,
        issues,
    )
    return [
        validateInteger(value.projectRevision, `${path}.projectRevision`, issues, 1),
        validateInteger(value.templateVersion, `${path}.templateVersion`, issues, 1),
        validateHashes(value.hashes, `${path}.hashes`, issues),
        validateString(value.defaultArticleHtml, `${path}.defaultArticleHtml`, issues),
        validateString(value.defaultStyleCss, `${path}.defaultStyleCss`, issues),
        validateDiagnostics(value.diagnostics, `${path}.diagnostics`, issues),
        validateSourceStatus(value.sourceStatus, `${path}.sourceStatus`, issues),
    ].every(Boolean)
}

function validateEntryAssetSnapshot(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): value is EntryAssetSnapshot {
    if (!isRecord(value)) {
        addIssue(issues, path, 'invalid_asset', '资产必须是对象。')
        return false
    }
    validateKnownKeys(value, ['id', 'mediaType', 'sizeBytes', 'sha256'], path, issues)
    let valid = validateString(value.id, `${path}.id`, issues, {
        pattern: RFC_9562_UUID_PATTERN,
        code: 'invalid_uuid',
    })
    if (
        !ENTRY_ASSET_MEDIA_TYPES.includes(
            value.mediaType as (typeof ENTRY_ASSET_MEDIA_TYPES)[number],
        )
    ) {
        addIssue(
            issues,
            `${path}.mediaType`,
            'invalid_asset_media_type',
            '资产 MIME 不是受支持的光栅图片类型。',
        )
        valid = false
    }
    valid = validateInteger(value.sizeBytes, `${path}.sizeBytes`, issues, 1) && valid
    valid =
        validateString(value.sha256, `${path}.sha256`, issues, {
            pattern: SHA256_PATTERN,
            code: 'invalid_sha256',
        }) && valid
    return valid
}

function validateSourceStatus(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): boolean {
    if (
        !['ready', 'external_invalid', 'external_conflict', 'template_conflict'].includes(
            String(value),
        )
    ) {
        addIssue(issues, path, 'invalid_source_status', '源码状态不受当前契约支持。')
        return false
    }
    return true
}

function finish<T>(value: unknown, issues: ContractValidationIssue[]): ContractParseResult<T> {
    if (issues.length > 0) return {ok: false, value: null, issues}
    return {ok: true, value: value as T, issues: []}
}

export function parseDocumentDiagnostics(
    value: unknown,
): ContractParseResult<DocumentDiagnostic[]> {
    const issues: ContractValidationIssue[] = []
    validateDiagnostics(value, 'diagnostics', issues)
    return finish(value, issues)
}

export function parseProjectSourceSnapshot(
    value: unknown,
): ContractParseResult<ProjectSourceSnapshot> {
    const issues: ContractValidationIssue[] = []
    validateProjectSnapshot(value, 'project', issues)
    return finish(value, issues)
}

export function parseEntryAssetSnapshot(value: unknown): ContractParseResult<EntryAssetSnapshot> {
    const issues: ContractValidationIssue[] = []
    validateEntryAssetSnapshot(value, 'entryAsset', issues)
    return finish(value, issues)
}

export function parseEntrySourceSnapshot(value: unknown): ContractParseResult<EntrySourceSnapshot> {
    const issues: ContractValidationIssue[] = []
    if (!isRecord(value)) {
        addIssue(issues, 'entrySource', 'invalid_entry_snapshot', '词条源码快照必须是对象。')
        return finish(value, issues)
    }
    validateKnownKeys(
        value,
        [
            'project',
            'entry',
            'documentVersion',
            'baseTemplateVersion',
            'revision',
            'hashes',
            'articleHtml',
            'styleCss',
            'assets',
            'editorLimits',
            'diagnostics',
            'sourceStatus',
        ],
        'entrySource',
        issues,
    )
    validateProjectSnapshot(value.project, 'entrySource.project', issues)

    if (!isRecord(value.entry)) {
        addIssue(issues, 'entrySource.entry', 'invalid_entry_metadata', '词条元数据必须是对象。')
    } else {
        validateKnownKeys(
            value.entry,
            ['id', 'title', 'summary', 'tags'],
            'entrySource.entry',
            issues,
        )
        validateString(value.entry.id, 'entrySource.entry.id', issues, {
            pattern: RFC_9562_UUID_PATTERN,
            code: 'invalid_uuid',
        })
        validateString(value.entry.title, 'entrySource.entry.title', issues)
        validateString(value.entry.summary, 'entrySource.entry.summary', issues)
        if (!Array.isArray(value.entry.tags)) {
            addIssue(issues, 'entrySource.entry.tags', 'invalid_tags', 'tags 必须是字符串数组。')
        } else {
            value.entry.tags.forEach((tag, index) => {
                validateString(tag, `entrySource.entry.tags[${index}]`, issues)
            })
        }
    }

    if (value.documentVersion !== DOCUMENT_VERSION) {
        addIssue(
            issues,
            'entrySource.documentVersion',
            'unsupported_document_version',
            '文档版本不受支持。',
        )
    }
    validateInteger(value.baseTemplateVersion, 'entrySource.baseTemplateVersion', issues, 1)
    validateInteger(value.revision, 'entrySource.revision', issues, 1)
    validateHashes(value.hashes, 'entrySource.hashes', issues)
    validateString(value.articleHtml, 'entrySource.articleHtml', issues)
    validateString(value.styleCss, 'entrySource.styleCss', issues)
    validateDiagnostics(value.diagnostics, 'entrySource.diagnostics', issues)
    validateSourceStatus(value.sourceStatus, 'entrySource.sourceStatus', issues)

    if (!Array.isArray(value.assets)) {
        addIssue(issues, 'entrySource.assets', 'invalid_assets', '资产集合必须是数组。')
    } else {
        value.assets.forEach((asset, index) => {
            validateEntryAssetSnapshot(asset, `entrySource.assets[${index}]`, issues)
        })
    }
    if (!isRecord(value.editorLimits)) {
        addIssue(
            issues,
            'entrySource.editorLimits',
            'invalid_editor_limits',
            '编辑器限制必须是对象。',
        )
    } else {
        validateKnownKeys(
            value.editorLimits,
            ['paragraph', 'asset', 'managedNodes', 'containerDepth', 'containerChildren'],
            'entrySource.editorLimits',
            issues,
        )
        validateInteger(
            value.editorLimits.paragraph,
            'entrySource.editorLimits.paragraph',
            issues,
            1,
        )
        validateInteger(value.editorLimits.asset, 'entrySource.editorLimits.asset', issues, 0)
        validateInteger(
            value.editorLimits.managedNodes,
            'entrySource.editorLimits.managedNodes',
            issues,
            1,
        )
        validateInteger(
            value.editorLimits.containerDepth,
            'entrySource.editorLimits.containerDepth',
            issues,
            1,
        )
        validateInteger(
            value.editorLimits.containerChildren,
            'entrySource.editorLimits.containerChildren',
            issues,
            1,
        )
    }
    return finish(value, issues)
}

export function parsePreviewArtifactResult(
    value: unknown,
): ContractParseResult<PreviewArtifactResult> {
    const issues: ContractValidationIssue[] = []
    if (!isRecord(value)) {
        addIssue(issues, 'preview', 'invalid_preview_artifact', '预览 artifact 必须是对象。')
        return finish(value, issues)
    }
    validateKnownKeys(
        value,
        [
            'projectRevision',
            'revision',
            'srcdoc',
            'textProjection',
            'diagnostics',
            'referencedAssetIds',
            'templateVersion',
        ],
        'preview',
        issues,
    )
    validateInteger(value.projectRevision, 'preview.projectRevision', issues, 1)
    validateInteger(value.revision, 'preview.revision', issues, 1)
    if (value.srcdoc !== null) validateString(value.srcdoc, 'preview.srcdoc', issues)
    if (value.textProjection !== null)
        validateString(value.textProjection, 'preview.textProjection', issues)
    validateDiagnostics(value.diagnostics, 'preview.diagnostics', issues)
    if (!Array.isArray(value.referencedAssetIds)) {
        addIssue(
            issues,
            'preview.referencedAssetIds',
            'invalid_asset_ids',
            '预览资产引用必须是数组。',
        )
    } else {
        value.referencedAssetIds.forEach((id, index) => {
            validateString(id, `preview.referencedAssetIds[${index}]`, issues, {
                pattern: RFC_9562_UUID_PATTERN,
                code: 'invalid_uuid',
            })
        })
    }
    if (value.templateVersion !== null) {
        validateInteger(value.templateVersion, 'preview.templateVersion', issues, 1)
    }
    return finish(value, issues)
}

export function parseSourceValidationResult(
    value: unknown,
): ContractParseResult<SourceValidationResult> {
    const issues: ContractValidationIssue[] = []
    if (!isRecord(value)) {
        addIssue(issues, 'validation', 'invalid_validation_result', '源码校验结果必须是对象。')
        return finish(value, issues)
    }
    validateKnownKeys(
        value,
        ['valid', 'sources', 'diagnostics', 'textProjection', 'templateVersion'],
        'validation',
        issues,
    )
    if (typeof value.valid !== 'boolean') {
        addIssue(issues, 'validation.valid', 'invalid_boolean', 'valid 必须是布尔值。')
    }
    validateSourceFileSet(value.sources, 'validation.sources', issues)
    validateDiagnostics(value.diagnostics, 'validation.diagnostics', issues)
    if (value.textProjection !== undefined && value.textProjection !== null) {
        validateString(value.textProjection, 'validation.textProjection', issues)
    }
    if (value.templateVersion !== undefined && value.templateVersion !== null) {
        validateInteger(value.templateVersion, 'validation.templateVersion', issues, 1)
    }
    return finish(value, issues)
}

export function parseSourceMutationResult(
    value: unknown,
): ContractParseResult<SourceMutationResult> {
    const issues: ContractValidationIssue[] = []
    if (!isRecord(value)) {
        addIssue(issues, 'mutation', 'invalid_mutation_result', '源码提交结果必须是对象。')
        return finish(value, issues)
    }
    validateKnownKeys(
        value,
        ['dryRun', 'revision', 'sources', 'diagnostics', 'changedFiles'],
        'mutation',
        issues,
    )
    if (typeof value.dryRun !== 'boolean') {
        addIssue(issues, 'mutation.dryRun', 'invalid_boolean', 'dryRun 必须是布尔值。')
    }
    validateInteger(value.revision, 'mutation.revision', issues, 1)
    validateSourceFileSet(value.sources, 'mutation.sources', issues)
    validateDiagnostics(value.diagnostics, 'mutation.diagnostics', issues)
    if (!Array.isArray(value.changedFiles)) {
        addIssue(
            issues,
            'mutation.changedFiles',
            'invalid_changed_files',
            'changedFiles 必须是源码文件名数组。',
        )
    } else {
        value.changedFiles.forEach((file, index) => {
            if (!SOURCE_FILE_NAMES.includes(file as SourceFileName)) {
                addIssue(
                    issues,
                    `mutation.changedFiles[${index}]`,
                    'invalid_source_file',
                    '提交结果包含未知源码文件。',
                )
            }
        })
    }
    return finish(value, issues)
}

function validateSourceFileSet(
    value: unknown,
    path: string,
    issues: ContractValidationIssue[],
): value is SourceFileSet {
    if (!isRecord(value)) {
        addIssue(
            issues,
            path,
            'invalid_sources',
            'sources 必须同时包含 article.html 与 style.css。',
        )
        return false
    }
    validateKnownKeys(value, SOURCE_FILE_NAMES, path, issues)
    return SOURCE_FILE_NAMES.map(file =>
        validateString(value[file], `${path}.${file}`, issues),
    ).every(Boolean)
}

export function parseDocumentSaveBundleRequest(
    value: unknown,
): ContractParseResult<DocumentSaveBundleRequest> {
    const issues: ContractValidationIssue[] = []
    if (!isRecord(value)) {
        addIssue(issues, 'request', 'invalid_request', '文档保存包必须是对象。')
        return finish(value, issues)
    }
    validateKnownKeys(
        value,
        [
            'baseProjectRevision',
            'baseEntryRevision',
            'baseTemplateVersion',
            'projectSources',
            'entrySources',
            'idempotencyKey',
        ],
        'request',
        issues,
    )
    validateInteger(value.baseProjectRevision, 'request.baseProjectRevision', issues, 1)
    validateInteger(value.baseEntryRevision, 'request.baseEntryRevision', issues, 1)
    validateInteger(value.baseTemplateVersion, 'request.baseTemplateVersion', issues, 1)
    validateString(value.idempotencyKey, 'request.idempotencyKey', issues, {
        pattern: RFC_9562_UUID_PATTERN,
        code: 'invalid_uuid',
    })
    validateSourceFileSet(value.projectSources, 'request.projectSources', issues)
    validateSourceFileSet(value.entrySources, 'request.entrySources', issues)
    return finish(value, issues)
}

export function parseDocumentSaveBundleResult(
    value: unknown,
): ContractParseResult<DocumentSaveBundleResult> {
    const issues: ContractValidationIssue[] = []
    if (!isRecord(value)) {
        addIssue(issues, 'bundle', 'invalid_save_bundle_result', '文档保存结果必须是对象。')
        return finish(value, issues)
    }
    validateKnownKeys(
        value,
        ['projectRevision', 'entryRevision', 'templateVersion', 'project', 'entry'],
        'bundle',
        issues,
    )
    const projectRevisionValid = validateInteger(
        value.projectRevision,
        'bundle.projectRevision',
        issues,
        1,
    )
    const entryRevisionValid = validateInteger(
        value.entryRevision,
        'bundle.entryRevision',
        issues,
        1,
    )
    validateInteger(value.templateVersion, 'bundle.templateVersion', issues, 1)
    for (const scope of ['project', 'entry'] as const) {
        const parsed = parseSourceMutationResult(value[scope])
        if (!parsed.ok) {
            for (const issue of parsed.issues) {
                issues.push({
                    ...issue,
                    path: issue.path.replace(/^mutation/u, `bundle.${scope}`),
                })
            }
        }
    }
    if (
        projectRevisionValid &&
        isRecord(value.project) &&
        Number.isInteger(value.project.revision) &&
        value.project.revision !== value.projectRevision
    ) {
        addIssue(
            issues,
            'bundle.project.revision',
            'revision_mismatch',
            '项目结果 revision 必须与 projectRevision 一致。',
        )
    }
    if (
        entryRevisionValid &&
        isRecord(value.entry) &&
        Number.isInteger(value.entry.revision) &&
        value.entry.revision !== value.entryRevision
    ) {
        addIssue(
            issues,
            'bundle.entry.revision',
            'revision_mismatch',
            '词条结果 revision 必须与 entryRevision 一致。',
        )
    }
    return finish(value, issues)
}

export function parseSourceValidationRequest(
    value: unknown,
): ContractParseResult<SourceValidationRequest> {
    const issues: ContractValidationIssue[] = []
    if (!isRecord(value)) {
        addIssue(issues, 'request', 'invalid_request', '源码校验请求必须是对象。')
        return finish(value, issues)
    }
    validateKnownKeys(value, ['sources'], 'request', issues)
    validateSourceFileSet(value.sources, 'request.sources', issues)
    return finish(value, issues)
}

export function parseEntryPreviewRequest(value: unknown): ContractParseResult<EntryPreviewRequest> {
    const issues: ContractValidationIssue[] = []
    if (!isRecord(value)) {
        addIssue(issues, 'request', 'invalid_request', '词条预览请求必须是对象。')
        return finish(value, issues)
    }
    validateKnownKeys(value, ['sources', 'projectSources'], 'request', issues)
    validateSourceFileSet(value.sources, 'request.sources', issues)
    if (value.projectSources !== undefined) {
        validateSourceFileSet(value.projectSources, 'request.projectSources', issues)
    }
    return finish(value, issues)
}
