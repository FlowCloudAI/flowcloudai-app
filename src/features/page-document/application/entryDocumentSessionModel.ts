// 本模块把词条页面文档接入既有草稿模型；项目模板只作为只读编译基线，不参与本批保存。

import type {
    PageDocument,
    PageDocumentDiagnostic,
    PageDocumentSaveError,
    SavePageDocumentInput,
    SavePageDocumentResult,
} from '../../../api/pageDocument.ts'
import type {
    DocumentDiagnostic,
    EntrySourceSnapshot,
    SourceFileName,
    SourceFileSet,
} from '../domain/contract.ts'
import {
    CANVAS_BASE_PROJECT_CSS,
    CANVAS_BASE_PROJECT_HTML,
    compileCanvasPreview,
    type CompiledCanvasPreview,
    wrapMarkdownFallback,
} from '../canvas/host/compiledPreview.ts'
import {parseDocumentDiagnostics} from '../domain/validators.ts'
import {managedMarkdownParagraphsToHtml} from './managedMarkdownFallback.ts'
import {
    acceptDraftValidation,
    acceptEntryDraftSave,
    createDocumentDraft,
    discardEntryDraft,
    editDocumentDraftSource,
    isDocumentScopeDirty,
    markDraftSaveFailure,
    markDraftSaving,
    markDraftValidating,
    redoEntryDraft,
    undoEntryDraft,
    type DocumentDraftUpdate,
    type DocumentDraftModel,
} from './documentDraftModel.ts'

const EMPTY_HASH = '0'.repeat(64)

export interface EntryDocumentIdentity {
    entryId: string
    projectId: string
    title: string
    summary: string
    markdown: string
}

export interface EntryDocumentConflictState {
    currentRevision: number | null
    latestDocument: PageDocument | null
    resolutionError: string | null
}

export interface EntryDocumentPendingSave {
    signature: string
    requestKey: string
    sources: SourceFileSet
}

export interface EntryDocumentSessionState {
    identity: EntryDocumentIdentity
    snapshot: EntrySourceSnapshot
    model: DocumentDraftModel
    persistedRevision: number | undefined
    pendingSave: EntryDocumentPendingSave | null
    preview: CompiledCanvasPreview | null
    previewStale: boolean
    saveError: PageDocumentSaveError | null
    conflict: EntryDocumentConflictState | null
}

export type EntryDocumentSavePreparation =
    | {status: 'ready'; state: EntryDocumentSessionState; input: SavePageDocumentInput}
    | {status: 'blocked'; state: EntryDocumentSessionState; reason: string}

function snapshotFor(
    identity: EntryDocumentIdentity,
    document: PageDocument | null,
): EntrySourceSnapshot {
    return {
        project: {
            projectRevision: 1,
            templateVersion: 1,
            hashes: {article: EMPTY_HASH, style: EMPTY_HASH},
            defaultArticleHtml: CANVAS_BASE_PROJECT_HTML,
            defaultStyleCss: CANVAS_BASE_PROJECT_CSS,
            diagnostics: [],
            sourceStatus: 'ready',
        },
        entry: {
            id: identity.entryId,
            title: identity.title,
            summary: identity.summary,
            tags: [],
        },
        documentVersion: 1,
        baseTemplateVersion: 1,
        revision: document?.revision ?? 0,
        hashes: {article: EMPTY_HASH, style: EMPTY_HASH},
        articleHtml:
            document?.html ??
            wrapMarkdownFallback(
                identity.entryId,
                managedMarkdownParagraphsToHtml(identity.markdown),
            ),
        styleCss: document?.css ?? '',
        assets: [],
        editorLimits: {
            paragraph: 100,
            asset: 100,
            managedNodes: 512,
            containerDepth: 3,
            containerChildren: 32,
        },
        diagnostics: [],
        sourceStatus: 'ready',
    }
}

function compileState(
    state: Pick<EntryDocumentSessionState, 'identity' | 'model'>,
): CompiledCanvasPreview {
    return compileCanvasPreview({
        projectArticleHtml: CANVAS_BASE_PROJECT_HTML,
        projectStyleCss: CANVAS_BASE_PROJECT_CSS,
        entryArticleHtml: state.model.entry.sources['article.html'],
        entryStyleCss: state.model.entry.sources['style.css'],
        metadata: {
            id: state.identity.entryId,
            title: state.identity.title,
            summary: state.identity.summary,
            tags: [],
        },
    })
}

function hasBlockingDiagnostics(diagnostics: readonly DocumentDiagnostic[]): boolean {
    return diagnostics.some(item => item.severity === 'error')
}

function isRenderable(preview: CompiledCanvasPreview): boolean {
    return (
        preview.html !== null &&
        preview.css !== null &&
        !hasBlockingDiagnostics(preview.diagnostics)
    )
}

export function createEntryDocumentSessionState(
    identity: EntryDocumentIdentity,
    document: PageDocument | null,
): EntryDocumentSessionState {
    const snapshot = snapshotFor(identity, document)
    const initial: EntryDocumentSessionState = {
        identity,
        snapshot,
        model: createDocumentDraft(snapshot),
        persistedRevision: document?.revision,
        pendingSave: null,
        preview: null,
        previewStale: false,
        saveError: null,
        conflict: null,
    }
    const preview = compileState(initial)
    return {
        ...initial,
        model: acceptDraftValidation(
            initial.model,
            'entry',
            !hasBlockingDiagnostics(preview.diagnostics),
            preview.diagnostics,
        ),
        preview: isRenderable(preview) ? preview : null,
        previewStale: !isRenderable(preview),
    }
}

export function updateEntryDocumentMetadata(
    state: EntryDocumentSessionState,
    metadata: Pick<EntryDocumentIdentity, 'title' | 'summary'>,
): EntryDocumentSessionState {
    if (
        state.identity.title === metadata.title &&
        state.identity.summary === metadata.summary
    ) {
        return state
    }
    const next = {
        ...state,
        identity: {...state.identity, ...metadata},
        snapshot: {
            ...state.snapshot,
            entry: {...state.snapshot.entry, ...metadata},
        },
    }
    const preview = compileState(next)
    return isRenderable(preview) ? {...next, preview, previewStale: false} : next
}

export function editEntryDocumentSource(
    state: EntryDocumentSessionState,
    file: SourceFileName,
    value: string,
): EntryDocumentSessionState {
    const model = editDocumentDraftSource(state.model, 'entry', file, value)
    if (model === state.model) return state
    return {
        ...state,
        model,
        saveError: null,
    }
}

export function beginEntryDocumentValidation(
    state: EntryDocumentSessionState,
): EntryDocumentSessionState {
    if (state.model.entry.validationPhase !== 'pending') return state
    return {...state, model: markDraftValidating(state.model, 'entry')}
}

export function finishEntryDocumentValidation(
    state: EntryDocumentSessionState,
): EntryDocumentSessionState {
    const preview = compileState(state)
    const valid = !hasBlockingDiagnostics(preview.diagnostics)
    return {
        ...state,
        model: acceptDraftValidation(state.model, 'entry', valid, preview.diagnostics),
        preview: isRenderable(preview) ? preview : state.preview,
        previewStale: !isRenderable(preview),
    }
}

/** 已由内核接纳的可视候选回到同一会话，并立即刷新代码模式与隔离预览。 */
export function acceptEntryDocumentVisualUpdate(
    state: EntryDocumentSessionState,
    update: DocumentDraftUpdate,
): EntryDocumentSessionState {
    if (!update.applied || update.model === state.model) return state
    const next = {
        ...state,
        model: update.model,
        pendingSave: null,
        saveError: null,
    }
    const preview = compileState(next)
    return {
        ...next,
        preview: isRenderable(preview) ? preview : state.preview,
        previewStale: !isRenderable(preview),
    }
}

function saveSignature(state: EntryDocumentSessionState): string {
    return JSON.stringify({
        entryId: state.identity.entryId,
        projectId: state.identity.projectId,
        expectedRevision: state.persistedRevision ?? null,
        sources: state.model.entry.sources,
    })
}

export function canSaveEntryDocument(state: EntryDocumentSessionState): boolean {
    return (
        (state.persistedRevision === undefined || isDocumentScopeDirty(state.model.entry)) &&
        state.conflict === null &&
        state.model.entry.phase !== 'saving' &&
        state.model.entry.phase !== 'conflict' &&
        state.model.entry.validationPhase === 'valid' &&
        !hasBlockingDiagnostics(state.model.entry.diagnostics)
    )
}

export function prepareEntryDocumentSave(
    state: EntryDocumentSessionState,
    createRequestKey: () => string,
): EntryDocumentSavePreparation {
    if (state.persistedRevision !== undefined && !isDocumentScopeDirty(state.model.entry)) {
        return {status: 'blocked', state, reason: '当前页面文档没有未保存修改。'}
    }
    if (!canSaveEntryDocument(state)) {
        return {status: 'blocked', state, reason: '当前页面文档尚未通过校验。'}
    }
    const signature = saveSignature(state)
    const requestKey =
        state.pendingSave?.signature === signature
            ? state.pendingSave.requestKey
            : createRequestKey()
    const sources = {...state.model.entry.sources}
    const pendingSave = {signature, requestKey, sources}
    const input: SavePageDocumentInput = {
        entryId: state.identity.entryId,
        projectId: state.identity.projectId,
        html: sources['article.html'],
        css: sources['style.css'],
        ...(state.persistedRevision === undefined
            ? {}
            : {expectedRevision: state.persistedRevision}),
        requestKey,
    }
    return {
        status: 'ready',
        input,
        state: {
            ...state,
            model: markDraftSaving(state.model, 'entry'),
            pendingSave,
            saveError: null,
        },
    }
}

export function acceptEntryDocumentSave(
    state: EntryDocumentSessionState,
    result: SavePageDocumentResult,
): EntryDocumentSessionState {
    const sources = state.pendingSave?.sources ?? state.model.entry.sources
    const snapshot = snapshotFor(state.identity, result.document)
    return {
        ...state,
        snapshot,
        model: acceptEntryDraftSave(state.model, result.revision, sources),
        persistedRevision: result.revision,
        pendingSave: null,
        saveError: null,
        conflict: null,
        previewStale: false,
    }
}

function domainDiagnostics(
    diagnostics: readonly PageDocumentDiagnostic[],
): DocumentDiagnostic[] {
    const parsed = parseDocumentDiagnostics(diagnostics)
    if (parsed.ok) return parsed.value
    return [
        {
            severity: 'error',
            category: 'capability',
            code: 'invalid_server_diagnostics',
            message: '保存端返回了无法识别的页面文档诊断。',
        },
    ]
}

export function rejectEntryDocumentSave(
    state: EntryDocumentSessionState,
    error: PageDocumentSaveError,
    latestDocument: PageDocument | null = null,
): EntryDocumentSessionState {
    if (error.kind === 'validation') {
        const diagnostics = domainDiagnostics(error.diagnostics)
        const invalid = acceptDraftValidation(state.model, 'entry', false, diagnostics)
        return {
            ...state,
            model: markDraftSaveFailure(invalid, 'entry', error.message, null),
            saveError: error,
        }
    }
    if (error.kind === 'conflict') {
        return {
            ...state,
            model: markDraftSaveFailure(
                state.model,
                'entry',
                error.message,
                'document_revision_conflict',
            ),
            saveError: error,
            conflict: {
                currentRevision: latestDocument?.revision ?? error.currentRevision,
                latestDocument,
                resolutionError: null,
            },
        }
    }
    return {
        ...state,
        model: markDraftSaveFailure(state.model, 'entry', error.message, null),
        saveError: error,
    }
}

export function keepEntryDocumentDraft(
    state: EntryDocumentSessionState,
    latestDocument: PageDocument | null = state.conflict?.latestDocument ?? null,
): EntryDocumentSessionState {
    if (!state.conflict) return state
    if (!latestDocument) {
        return {
            ...state,
            conflict: {
                ...state.conflict,
                resolutionError: '无法读取最新版本，暂不能覆盖保存',
            },
        }
    }

    const snapshot = snapshotFor(state.identity, latestDocument)
    const baseSources: SourceFileSet = {
        'article.html': latestDocument.html,
        'style.css': latestDocument.css,
    }
    const entry = state.model.entry
    const dirty =
        entry.sources['article.html'] !== baseSources['article.html'] ||
        entry.sources['style.css'] !== baseSources['style.css']
    return {
        ...state,
        snapshot,
        model: {
            ...state.model,
            entry: {
                ...entry,
                baseRevision: latestDocument.revision,
                baseTemplateVersion: snapshot.baseTemplateVersion,
                baseSources,
                baseDiagnostics: snapshot.diagnostics,
                latestRevision: latestDocument.revision,
                latestTemplateVersion: snapshot.baseTemplateVersion,
                latestSources: baseSources,
                sourceStatus: snapshot.sourceStatus,
                phase: dirty ? 'dirty' : 'clean',
                error: null,
                conflictCode: null,
                conflict: null,
            },
            changeVersion: state.model.changeVersion + 1,
        },
        persistedRevision: latestDocument.revision,
        pendingSave: null,
        saveError: null,
        conflict: null,
    }
}

export function discardEntryDocumentChanges(
    state: EntryDocumentSessionState,
): EntryDocumentSessionState {
    return {
        ...state,
        model: discardEntryDraft(state.model, state.snapshot),
        pendingSave: null,
        saveError: null,
        conflict: null,
        previewStale: false,
    }
}

export function loadLatestEntryDocument(
    state: EntryDocumentSessionState,
): EntryDocumentSessionState {
    if (!state.conflict?.latestDocument) return state
    return createEntryDocumentSessionState(state.identity, state.conflict.latestDocument)
}

export function undoEntryDocumentSession(
    state: EntryDocumentSessionState,
): EntryDocumentSessionState {
    const update = undoEntryDraft(state.model)
    return update.applied
        ? finishEntryDocumentValidation({...state, model: update.model, saveError: null})
        : state
}

export function redoEntryDocumentSession(
    state: EntryDocumentSessionState,
): EntryDocumentSessionState {
    const update = redoEntryDraft(state.model)
    return update.applied
        ? finishEntryDocumentValidation({...state, model: update.model, saveError: null})
        : state
}
