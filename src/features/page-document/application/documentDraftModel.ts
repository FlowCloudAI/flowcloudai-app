// 本模块是 V2 编辑器唯一的内存文档模型；源码候选、历史、校验与冲突共享同一双作用域状态。
import type {
    DocumentDiagnostic,
    DocumentSaveBundleResult,
    DocumentSourceStatus,
    EntrySourceSnapshot,
    SourceFileName,
    SourceFileSet,
} from '../domain/contract.ts'
import {
    validateAiCandidateNodeIdentities,
    type DocumentNodeKind,
    type EditImpact,
    nodeId,
    type NodeIdentityAllocator,
    type NodeIdentityDescriptor,
} from '../domain/kernel/index.ts'
import {normalizeManagedNodeIdentities} from '../domain/kernel/syntax/index.ts'
import {createLayerProjection, type LayerProjectionNode} from '../domain/layerProjection.ts'
import type {
    SourceDraftModel,
    SourceEditorPhase,
    SourceEditorScope,
    SourceValidationPhase,
} from './source/sourceSessionModel.ts'

export interface DocumentSourceBatch {
    label: string
    sources: SourceFileSet
    diagnostics: DocumentDiagnostic[]
    /** 同一次修改横跨两个源码作用域时，两侧历史共享此身份并必须原子撤销。 */
    transactionId?: string
    historyGroupId?: string
    historyGroupStartSources?: SourceFileSet
}

export type DocumentHistoryBatch = DocumentSourceBatch

export interface DocumentDraftConflict {
    revision: number
    templateVersion: number
    sources: SourceFileSet
    sourceStatus: DocumentSourceStatus
}

export interface DocumentScopeDraft {
    baseRevision: number
    baseTemplateVersion: number
    baseSources: SourceFileSet
    baseDiagnostics: DocumentDiagnostic[]
    historyBaseSources: SourceFileSet
    historyBaseDiagnostics: DocumentDiagnostic[]
    sources: SourceFileSet
    latestRevision: number
    latestTemplateVersion: number
    latestSources: SourceFileSet
    sourceStatus: DocumentSourceStatus
    phase: SourceEditorPhase
    validationPhase: SourceValidationPhase
    diagnostics: DocumentDiagnostic[]
    error: string | null
    conflictCode: string | null
    undo: readonly DocumentHistoryBatch[]
    redo: readonly DocumentHistoryBatch[]
    conflict: DocumentDraftConflict | null
}

export interface DocumentDraftModel {
    entryId: string
    entry: DocumentScopeDraft
    project: DocumentScopeDraft
    changeVersion: number
}

export interface DocumentDraftUpdate {
    model: DocumentDraftModel
    applied: boolean
    diagnostics: DocumentDiagnostic[]
}

export interface DocumentHistoryOptions {
    historyGroupId?: string
}

const HISTORY_LIMIT = 50

function cloneSources(sources: SourceFileSet): SourceFileSet {
    return {'article.html': sources['article.html'], 'style.css': sources['style.css']}
}

export function documentSourcesEqual(left: SourceFileSet, right: SourceFileSet): boolean {
    return (
        left['article.html'] === right['article.html'] && left['style.css'] === right['style.css']
    )
}

/** 同一交互只保留最终源码快照；回到交互起点时连同该历史步骤一起移除。 */
function mergeHistoryBatch(
    scope: DocumentScopeDraft,
    batch: DocumentHistoryBatch,
): Pick<DocumentScopeDraft, 'undo' | 'historyBaseSources' | 'historyBaseDiagnostics'> {
    const history = scope.undo
    const groupId = batch.historyGroupId
    const previous = history.at(-1)
    if (!groupId || previous?.historyGroupId !== groupId) {
        const combined = [...history, batch]
        const evicted = combined.length > HISTORY_LIMIT ? combined.at(-HISTORY_LIMIT - 1) : null
        return {
            undo: combined.slice(-HISTORY_LIMIT),
            historyBaseSources: cloneSources(evicted?.sources ?? scope.historyBaseSources),
            historyBaseDiagnostics: [...(evicted?.diagnostics ?? scope.historyBaseDiagnostics)],
        }
    }

    const beforeInteraction = previous.historyGroupStartSources
    const prefix = history.slice(0, -1)
    if (beforeInteraction && documentSourcesEqual(beforeInteraction, batch.sources)) {
        return {
            undo: prefix,
            historyBaseSources: scope.historyBaseSources,
            historyBaseDiagnostics: scope.historyBaseDiagnostics,
        }
    }

    const merged: DocumentSourceBatch = {
        label: batch.label,
        sources: cloneSources(batch.sources),
        diagnostics: [...batch.diagnostics],
        ...((batch.transactionId ?? previous.transactionId)
            ? {transactionId: batch.transactionId ?? previous.transactionId}
            : {}),
        historyGroupId: groupId,
        historyGroupStartSources: cloneSources(
            beforeInteraction ?? batch.historyGroupStartSources ?? batch.sources,
        ),
    }
    return {
        undo: [...prefix, merged].slice(-HISTORY_LIMIT),
        historyBaseSources: scope.historyBaseSources,
        historyBaseDiagnostics: scope.historyBaseDiagnostics,
    }
}

function entrySources(snapshot: EntrySourceSnapshot): SourceFileSet {
    return {'article.html': snapshot.articleHtml, 'style.css': snapshot.styleCss}
}

function projectSources(snapshot: EntrySourceSnapshot): SourceFileSet {
    return {
        'article.html': snapshot.project.defaultArticleHtml,
        'style.css': snapshot.project.defaultStyleCss,
    }
}

function initialValidation(
    sourceStatus: DocumentSourceStatus,
    diagnostics: readonly DocumentDiagnostic[],
): SourceValidationPhase {
    return sourceStatus === 'ready' && !diagnostics.some(item => item.severity === 'error')
        ? 'valid'
        : 'invalid'
}

function createScope(
    revision: number,
    templateVersion: number,
    sources: SourceFileSet,
    diagnostics: DocumentDiagnostic[],
    sourceStatus: DocumentSourceStatus,
): DocumentScopeDraft {
    return {
        baseRevision: revision,
        baseTemplateVersion: templateVersion,
        baseSources: cloneSources(sources),
        baseDiagnostics: diagnostics,
        historyBaseSources: cloneSources(sources),
        historyBaseDiagnostics: [...diagnostics],
        sources: cloneSources(sources),
        latestRevision: revision,
        latestTemplateVersion: templateVersion,
        latestSources: cloneSources(sources),
        sourceStatus,
        phase: 'clean',
        validationPhase: initialValidation(sourceStatus, diagnostics),
        diagnostics,
        error: null,
        conflictCode: null,
        undo: [],
        redo: [],
        conflict: null,
    }
}

function historyHasLinkedTransaction(scope: DocumentScopeDraft): boolean {
    return [...scope.undo, ...scope.redo].some(item => item.transactionId)
}

function resetScopeHistory(scope: DocumentScopeDraft): DocumentScopeDraft {
    return {
        ...scope,
        historyBaseSources: cloneSources(scope.sources),
        historyBaseDiagnostics: [...scope.diagnostics],
        undo: [],
        redo: [],
    }
}

/** 单侧重置无法继续保留双作用域事务；两侧以当前源码建立新的安全历史起点。 */
function severLinkedHistory(model: DocumentDraftModel): DocumentDraftModel {
    if (!historyHasLinkedTransaction(model.entry) && !historyHasLinkedTransaction(model.project)) {
        return model
    }
    return {
        ...model,
        entry: resetScopeHistory(model.entry),
        project: resetScopeHistory(model.project),
    }
}

/** 新分支会废弃当前作用域的 redo；若其中包含关联事务，另一侧也必须同时废弃。 */
function discardLinkedRedoBranches(
    model: DocumentDraftModel,
    changedScopes: readonly SourceEditorScope[],
): DocumentDraftModel {
    const discardsLinkedRedo = changedScopes.some(scope =>
        model[scope].redo.some(item => item.transactionId),
    )
    if (!discardsLinkedRedo) return model
    return {
        ...model,
        entry: {...model.entry, redo: []},
        project: {...model.project, redo: []},
    }
}

type LinkedHistoryStack = 'undo' | 'redo'

function linkedHistoryLocations(scope: DocumentScopeDraft): Map<string, LinkedHistoryStack> {
    const locations = new Map<string, LinkedHistoryStack>()
    for (const stack of ['undo', 'redo'] as const) {
        for (const item of scope[stack]) {
            if (item.transactionId) locations.set(item.transactionId, stack)
        }
    }
    return locations
}

/**
 * 淘汰 undo 中的关联事务时，其结果已进入历史基线，另一侧也必须推进到同一事务之后。
 * redo 中较新的步骤依赖被淘汰事务，故从该事务起一并丢弃，只保留更早且仍可连续重做的尾部。
 */
function pruneOrphanedLinkedHistory(
    scope: DocumentScopeDraft,
    orphaned: ReadonlySet<string>,
): DocumentScopeDraft {
    let historyBaseSources = scope.historyBaseSources
    let historyBaseDiagnostics = scope.historyBaseDiagnostics
    let undo = scope.undo
    let redo = scope.redo
    let undoCut = -1
    let redoCut = -1
    for (const [index, item] of undo.entries()) {
        if (item.transactionId && orphaned.has(item.transactionId)) undoCut = index
    }
    for (const [index, item] of redo.entries()) {
        if (item.transactionId && orphaned.has(item.transactionId)) redoCut = index
    }
    if (undoCut >= 0) {
        const boundary = undo[undoCut]
        if (boundary) {
            historyBaseSources = cloneSources(boundary.sources)
            historyBaseDiagnostics = [...boundary.diagnostics]
        }
        undo = undo.slice(undoCut + 1)
    }
    if (redoCut >= 0) redo = redo.slice(redoCut + 1)
    if (undo === scope.undo && redo === scope.redo) return scope
    return {...scope, historyBaseSources, historyBaseDiagnostics, undo, redo}
}

/** 两套作用域历史容量不同，但任何关联事务必须始终在两侧同栈存在或同时退出。 */
function normalizeLinkedHistory(model: DocumentDraftModel): DocumentDraftModel {
    let current = model
    const maximumPasses =
        current.entry.undo.length +
        current.entry.redo.length +
        current.project.undo.length +
        current.project.redo.length +
        1
    for (let pass = 0; pass < maximumPasses; pass += 1) {
        const entry = linkedHistoryLocations(current.entry)
        const project = linkedHistoryLocations(current.project)
        for (const [transactionId, stack] of entry) {
            const counterpart = project.get(transactionId)
            if (counterpart && counterpart !== stack) return severLinkedHistory(current)
        }
        const orphaned = new Set<string>()
        for (const transactionId of entry.keys()) {
            if (!project.has(transactionId)) orphaned.add(transactionId)
        }
        for (const transactionId of project.keys()) {
            if (!entry.has(transactionId)) orphaned.add(transactionId)
        }
        if (orphaned.size === 0) return current
        const next = {
            ...current,
            entry: pruneOrphanedLinkedHistory(current.entry, orphaned),
            project: pruneOrphanedLinkedHistory(current.project, orphaned),
        }
        if (next.entry === current.entry && next.project === current.project) {
            return severLinkedHistory(current)
        }
        current = next
    }
    return severLinkedHistory(current)
}

export function createDocumentDraft(snapshot: EntrySourceSnapshot): DocumentDraftModel {
    return {
        entryId: snapshot.entry.id,
        entry: createScope(
            snapshot.revision,
            snapshot.baseTemplateVersion,
            entrySources(snapshot),
            snapshot.diagnostics,
            snapshot.sourceStatus,
        ),
        project: createScope(
            snapshot.project.projectRevision,
            snapshot.project.templateVersion,
            projectSources(snapshot),
            snapshot.project.diagnostics,
            snapshot.project.sourceStatus,
        ),
        changeVersion: 0,
    }
}

export function isDocumentScopeDirty(scope: {
    baseSources: SourceFileSet
    sources: SourceFileSet
}): boolean {
    return !documentSourcesEqual(scope.baseSources, scope.sources)
}

export function isDocumentDraftDirty(model: DocumentDraftModel): boolean {
    return isDocumentScopeDirty(model.entry) || isDocumentScopeDirty(model.project)
}

function dirtyPhase(scope: {
    baseSources: SourceFileSet
    sources: SourceFileSet
    conflict: DocumentDraftConflict | null
}): SourceEditorPhase {
    if (scope.conflict) return 'conflict'
    return isDocumentScopeDirty(scope) ? 'dirty' : 'clean'
}

/** 内核已校验的源码候选及其历史快照不会退回待校验；保存端仍执行最终预检。 */
function validationAfterTrustedChange(
    scope: DocumentScopeDraft,
    sources: SourceFileSet,
    diagnostics: DocumentDiagnostic[],
): Pick<DocumentScopeDraft, 'validationPhase' | 'diagnostics'> {
    if (!documentSourcesEqual(scope.baseSources, sources)) {
        return {validationPhase: 'valid', diagnostics}
    }
    return {
        validationPhase: initialValidation(scope.sourceStatus, scope.baseDiagnostics),
        diagnostics: scope.baseDiagnostics,
    }
}

function undoScope(scope: DocumentScopeDraft): {
    scope: DocumentScopeDraft
    applied: boolean
    diagnostics: DocumentDiagnostic[]
} {
    const item = scope.undo.at(-1)
    if (!item) return {scope, applied: false, diagnostics: []}
    const undo = scope.undo.slice(0, -1)
    const previous = undo.at(-1)
    const sources = cloneSources(previous?.sources ?? scope.historyBaseSources)
    const diagnostics = [...(previous?.diagnostics ?? scope.historyBaseDiagnostics)]
    const validation = validationAfterTrustedChange(scope, sources, diagnostics)
    const next: DocumentScopeDraft = {
        ...scope,
        sources,
        undo,
        redo: [...scope.redo, item].slice(-HISTORY_LIMIT),
        ...validation,
        error: null,
    }
    return {
        scope: {...next, phase: dirtyPhase(next)},
        applied: true,
        diagnostics,
    }
}

function redoScope(scope: DocumentScopeDraft): {
    scope: DocumentScopeDraft
    applied: boolean
    diagnostics: DocumentDiagnostic[]
} {
    const item = scope.redo.at(-1)
    if (!item) return {scope, applied: false, diagnostics: []}
    const sources = cloneSources(item.sources)
    const diagnostics = [...item.diagnostics]
    const validation = validationAfterTrustedChange(scope, sources, diagnostics)
    const next: DocumentScopeDraft = {
        ...scope,
        sources,
        undo: [...scope.undo, item].slice(-HISTORY_LIMIT),
        redo: scope.redo.slice(0, -1),
        ...validation,
        error: null,
    }
    return {
        scope: {...next, phase: dirtyPhase(next)},
        applied: true,
        diagnostics,
    }
}

function historyUpdate(
    model: DocumentDraftModel,
    scope: SourceEditorScope,
    direction: 'undo' | 'redo',
): DocumentDraftUpdate {
    const sourceScope = model[scope]
    const item = (direction === 'undo' ? sourceScope.undo : sourceScope.redo).at(-1)
    const linkedScope: SourceEditorScope = scope === 'entry' ? 'project' : 'entry'
    const linkedItem = item?.transactionId
        ? (direction === 'undo' ? model[linkedScope].undo : model[linkedScope].redo).at(-1)
        : null
    if (item?.transactionId && linkedItem?.transactionId !== item.transactionId) {
        return {
            model,
            applied: false,
            diagnostics: [
                {
                    severity: 'error',
                    category: 'capability',
                    code: 'linked_history_order_conflict',
                    message:
                        '这一步同时修改了项目与词条，但另一作用域还有较新的历史，不能拆分撤销。',
                },
            ],
        }
    }

    const update = direction === 'undo' ? undoScope(sourceScope) : redoScope(sourceScope)
    const linkedUpdate = item?.transactionId
        ? direction === 'undo'
            ? undoScope(model[linkedScope])
            : redoScope(model[linkedScope])
        : null
    const updatedModel = update.applied
        ? ({
              ...model,
              [scope]: update.scope,
              ...(linkedUpdate?.applied ? {[linkedScope]: linkedUpdate.scope} : {}),
              changeVersion: model.changeVersion + 1,
          } as DocumentDraftModel)
        : model
    return {
        model: update.applied ? normalizeLinkedHistory(updatedModel) : model,
        applied: update.applied,
        diagnostics: linkedUpdate
            ? [...update.diagnostics, ...linkedUpdate.diagnostics]
            : update.diagnostics,
    } as DocumentDraftUpdate
}

export const undoEntryDraft = (model: DocumentDraftModel): DocumentDraftUpdate =>
    historyUpdate(model, 'entry', 'undo')
export const redoEntryDraft = (model: DocumentDraftModel): DocumentDraftUpdate =>
    historyUpdate(model, 'entry', 'redo')
export const undoProjectDraft = (model: DocumentDraftModel): DocumentDraftUpdate =>
    historyUpdate(model, 'project', 'undo')
export const redoProjectDraft = (model: DocumentDraftModel): DocumentDraftUpdate =>
    historyUpdate(model, 'project', 'redo')

function applySourceBatch(
    scope: DocumentScopeDraft,
    sources: SourceFileSet,
    label: string,
    diagnostics: DocumentDiagnostic[],
    options: DocumentHistoryOptions,
    transactionId?: string,
): DocumentScopeDraft {
    const batch: DocumentSourceBatch = options.historyGroupId
        ? {
              label,
              sources: cloneSources(sources),
              diagnostics: [...diagnostics],
              ...(transactionId ? {transactionId} : {}),
              historyGroupId: options.historyGroupId,
              historyGroupStartSources: cloneSources(scope.sources),
          }
        : {
              label,
              sources: cloneSources(sources),
              diagnostics: [...diagnostics],
              ...(transactionId ? {transactionId} : {}),
          }
    const validation = validationAfterTrustedChange(scope, sources, diagnostics)
    const history = mergeHistoryBatch(scope, batch)
    const next: DocumentScopeDraft = {
        ...scope,
        sources: cloneSources(sources),
        ...history,
        redo: [],
        ...validation,
        error: null,
    }
    return {...next, phase: dirtyPhase(next)}
}

export interface DocumentDraftSourceBatch {
    expectedEntrySources: SourceFileSet
    expectedProjectSources: SourceFileSet
    entrySources: SourceFileSet
    projectSources: SourceFileSet
    diagnostics: DocumentDiagnostic[]
}

export interface AiDraftDecisionAuthorization {
    readonly planId: string
    readonly impacts: readonly EditImpact[]
    readonly confirmedPlanId?: string
}

export interface AiDraftSourceBatch extends DocumentDraftSourceBatch {
    readonly decision?: AiDraftDecisionAuthorization
}

export interface AiDraftApplyOptions {
    /** 宿主的节点身份分配器；默认使用当前运行时的随机 UUID。 */
    readonly allocateNodeId?: NodeIdentityAllocator
}

/** 源码候选进入唯一草稿历史；expected 防止等待模型或人工确认途中发生的编辑被覆盖。 */
function applyDraftSources(
    model: DocumentDraftModel,
    batch: DocumentDraftSourceBatch,
    label: string,
    origin: 'ai' | 'visual',
    options: DocumentHistoryOptions = {},
): DocumentDraftUpdate {
    if (batch.diagnostics.some(item => item.severity === 'error')) {
        return {model, applied: false, diagnostics: batch.diagnostics}
    }
    if (
        !documentSourcesEqual(model.entry.sources, batch.expectedEntrySources) ||
        !documentSourcesEqual(model.project.sources, batch.expectedProjectSources)
    ) {
        return {
            model,
            applied: false,
            diagnostics: [
                {
                    severity: 'error',
                    category: 'capability',
                    code: `${origin}_draft_changed`,
                    message:
                        origin === 'ai'
                            ? 'AI 请求执行期间当前内存草稿已经变化，已拒绝覆盖较新的编辑。'
                            : '确认期间文档已经变化，未覆盖新内容；请重新执行这次可视操作。',
                },
            ],
        }
    }
    if (model.entry.phase === 'saving' || model.project.phase === 'saving') {
        return {
            model,
            applied: false,
            diagnostics: [
                {
                    severity: 'error',
                    category: 'capability',
                    code: `${origin}_draft_saving`,
                    message: '源码正在保存，暂不能接收新的源码候选。',
                },
            ],
        }
    }

    const entryChanged = !documentSourcesEqual(model.entry.sources, batch.entrySources)
    const projectChanged = !documentSourcesEqual(model.project.sources, batch.projectSources)
    if (!entryChanged && !projectChanged)
        return {model, applied: true, diagnostics: batch.diagnostics}

    const transactionId =
        entryChanged && projectChanged ? `document-change:${model.changeVersion + 1}` : undefined
    const historyModel = discardLinkedRedoBranches(
        model,
        [entryChanged ? 'entry' : null, projectChanged ? 'project' : null].filter(
            (scope): scope is SourceEditorScope => scope !== null,
        ),
    )
    const updatedModel: DocumentDraftModel = {
        ...historyModel,
        entry: entryChanged
            ? applySourceBatch(
                  historyModel.entry,
                  batch.entrySources,
                  label,
                  batch.diagnostics,
                  options,
                  transactionId,
              )
            : historyModel.entry,
        project: projectChanged
            ? applySourceBatch(
                  historyModel.project,
                  batch.projectSources,
                  label,
                  batch.diagnostics,
                  options,
                  transactionId,
              )
            : historyModel.project,
        changeVersion: model.changeVersion + 1,
    }
    return {
        model: normalizeLinkedHistory(updatedModel),
        applied: true,
        diagnostics: batch.diagnostics,
    }
}

export function applyAiDraftSources(
    model: DocumentDraftModel,
    batch: AiDraftSourceBatch,
    label: string,
    options: AiDraftApplyOptions = {},
): DocumentDraftUpdate {
    if (batch.decision && batch.decision.confirmedPlanId !== batch.decision.planId) {
        return {
            model,
            applied: false,
            diagnostics: [
                {
                    severity: 'error',
                    category: 'capability',
                    code: 'ai_edit_decision_required',
                    message: '这份 AI 候选包含需要人工确认的影响，尚未取得对应计划的授权。',
                    details: {
                        planId: batch.decision.planId,
                        impacts: batch.decision.impacts,
                    },
                },
            ],
        }
    }
    const prepared = allocateAiCandidateNodeIdentities(model, batch, options.allocateNodeId)
    const identityDiagnostics = validateAiDraftNodeIdentities(
        model,
        prepared.batch,
        prepared.hostAllocatedNodeIds,
    )
    if (identityDiagnostics.length > 0) {
        return {model, applied: false, diagnostics: identityDiagnostics}
    }
    return applyDraftSources(model, prepared.batch, label, 'ai')
}

interface PreparedAiDraft {
    readonly batch: AiDraftSourceBatch
    readonly hostAllocatedNodeIds: Readonly<Record<SourceEditorScope, readonly string[]>>
}

/**
 * AI 只能描述新增节点，不能决定其最终身份。宿主在身份校验前补齐缺失 ID，
 * 并把本批实际分配的集合交给契约层；候选显式携带的未知 UUID 仍会被拒绝。
 */
function allocateAiCandidateNodeIdentities(
    model: DocumentDraftModel,
    batch: AiDraftSourceBatch,
    allocateNodeId: NodeIdentityAllocator = () => globalThis.crypto.randomUUID(),
): PreparedAiDraft {
    const unavailable = new Set<string>([
        ...managedNodeIdentityDescriptors(model.entry.sources['article.html']).map(item => item.id),
        ...managedNodeIdentityDescriptors(model.project.sources['article.html']).map(item => item.id),
    ])
    const allocated: Record<SourceEditorScope, string[]> = {entry: [], project: []}
    const normalizedSources: Record<SourceEditorScope, SourceFileSet> = {
        entry: {...batch.entrySources},
        project: {...batch.projectSources},
    }

    for (const scope of ['entry', 'project'] as const) {
        const normalized = normalizeManagedNodeIdentities(
            batch[`${scope}Sources`]['article.html'],
            allocateNodeId,
            unavailable,
        )
        normalizedSources[scope] = {
            ...batch[`${scope}Sources`],
            'article.html': normalized.source,
        }
        for (const diagnostic of normalized.diagnostics) {
            if (diagnostic.nodeId) {
                allocated[scope].push(diagnostic.nodeId)
                unavailable.add(diagnostic.nodeId)
            }
        }
    }

    return Object.freeze({
        batch: Object.freeze({
            ...batch,
            entrySources: Object.freeze(normalizedSources.entry),
            projectSources: Object.freeze(normalizedSources.project),
        }),
        hostAllocatedNodeIds: Object.freeze({
            entry: Object.freeze(allocated.entry),
            project: Object.freeze(allocated.project),
        }),
    })
}

function validateAiDraftNodeIdentities(
    model: DocumentDraftModel,
    batch: AiDraftSourceBatch,
    hostAllocatedNodeIds: Readonly<Record<SourceEditorScope, readonly string[]>>,
): DocumentDiagnostic[] {
    const diagnostics: DocumentDiagnostic[] = []
    for (const scope of ['entry', 'project'] as const) {
        const current = managedNodeIdentityDescriptors(model[scope].sources['article.html'])
        const candidate = managedNodeIdentityDescriptors(batch[`${scope}Sources`]['article.html'])
        const result = validateAiCandidateNodeIdentities(
            current,
            candidate,
            hostAllocatedNodeIds[scope],
        )
        if (result.status === 'rejected') {
            diagnostics.push({
                severity: 'error',
                category: 'capability',
                code: result.code,
                message: result.message,
                file: 'article.html',
            })
        }
    }
    return diagnostics
}

function managedNodeIdentityDescriptors(source: string): NodeIdentityDescriptor[] {
    const result: NodeIdentityDescriptor[] = []
    const visit = (nodes: readonly LayerProjectionNode[]): void => {
        for (const node of nodes) {
            if (node.managed && node.kind !== 'source' && node.kind !== 'operation') {
                try {
                    result.push({id: nodeId(node.id), kind: node.kind as DocumentNodeKind})
                } catch {
                    // 归一化或校验会报告无效身份；AI 身份策略只处理可解析的托管节点。
                }
            }
            visit(node.children)
        }
    }
    visit(createLayerProjection(source).nodes)
    return result
}

export function applyVisualDraftSources(
    model: DocumentDraftModel,
    batch: DocumentDraftSourceBatch,
    label: string,
    options: DocumentHistoryOptions = {},
): DocumentDraftUpdate {
    return applyDraftSources(model, batch, label, 'visual', options)
}

/** 直接源码输入清空受控历史，并以当前源码建立后续快照历史的起点。 */
export function editDocumentDraftSource(
    model: DocumentDraftModel,
    scopeName: SourceEditorScope,
    file: SourceFileName,
    value: string,
): DocumentDraftModel {
    const historyModel = severLinkedHistory(model)
    const scope = historyModel[scopeName]
    const sources = {...scope.sources, [file]: value}
    if (documentSourcesEqual(scope.sources, sources)) return model
    const resetToBase = documentSourcesEqual(scope.baseSources, sources)
    const next: typeof scope = {
        ...scope,
        historyBaseSources: cloneSources(sources),
        historyBaseDiagnostics: resetToBase ? [...scope.baseDiagnostics] : [],
        sources,
        undo: [],
        redo: [],
        validationPhase: resetToBase
            ? initialValidation(scope.sourceStatus, scope.baseDiagnostics)
            : 'pending',
        diagnostics: resetToBase ? scope.baseDiagnostics : [],
        error: null,
    }
    return {
        ...historyModel,
        [scopeName]: {...next, phase: dirtyPhase(next)},
        changeVersion: model.changeVersion + 1,
    } as DocumentDraftModel
}

export function scopeValidationSignature(
    model: DocumentDraftModel,
    scopeName: SourceEditorScope,
): string | null {
    const scope = model[scopeName]
    if (
        !isDocumentScopeDirty(scope) ||
        scope.phase === 'saving' ||
        (scope.validationPhase !== 'pending' && scope.validationPhase !== 'validating')
    )
        return null
    return JSON.stringify({
        scope: scopeName,
        revision: scope.baseRevision,
        templateVersion: scope.baseTemplateVersion,
        sources: scope.sources,
    })
}

export function markDraftValidating(
    model: DocumentDraftModel,
    scopeName: SourceEditorScope,
): DocumentDraftModel {
    const scope = model[scopeName]
    return {
        ...model,
        [scopeName]: {
            ...scope,
            validationPhase: 'validating',
            error: scope.phase === 'conflict' ? scope.error : null,
        },
    } as DocumentDraftModel
}

export function acceptDraftValidation(
    model: DocumentDraftModel,
    scopeName: SourceEditorScope,
    valid: boolean,
    diagnostics: DocumentDiagnostic[],
): DocumentDraftModel {
    const scope = model[scopeName]
    return {
        ...model,
        [scopeName]: {
            ...scope,
            validationPhase: valid ? 'valid' : 'invalid',
            diagnostics,
            historyBaseDiagnostics:
                scope.undo.length === 0 &&
                documentSourcesEqual(scope.sources, scope.historyBaseSources)
                    ? [...diagnostics]
                    : scope.historyBaseDiagnostics,
            error: scope.phase === 'conflict' ? scope.error : null,
        },
    } as DocumentDraftModel
}

export function failDraftValidation(
    model: DocumentDraftModel,
    scopeName: SourceEditorScope,
    message: string,
): DocumentDraftModel {
    const scope = model[scopeName]
    return {
        ...model,
        [scopeName]: {
            ...scope,
            validationPhase: 'failed',
            phase: scope.phase === 'conflict' ? 'conflict' : 'failed',
            error: message,
        },
    } as DocumentDraftModel
}

function incomingScope(
    snapshot: EntrySourceSnapshot,
    scopeName: SourceEditorScope,
): {
    revision: number
    templateVersion: number
    sources: SourceFileSet
    diagnostics: DocumentDiagnostic[]
    sourceStatus: DocumentSourceStatus
} {
    return scopeName === 'entry'
        ? {
              revision: snapshot.revision,
              templateVersion: snapshot.baseTemplateVersion,
              sources: entrySources(snapshot),
              diagnostics: snapshot.diagnostics,
              sourceStatus: snapshot.sourceStatus,
          }
        : {
              revision: snapshot.project.projectRevision,
              templateVersion: snapshot.project.templateVersion,
              sources: projectSources(snapshot),
              diagnostics: snapshot.project.diagnostics,
              sourceStatus: snapshot.project.sourceStatus,
          }
}

function syncScope(
    scope: DocumentScopeDraft,
    incoming: ReturnType<typeof incomingScope>,
): DocumentScopeDraft {
    const latest = {
        latestRevision: incoming.revision,
        latestTemplateVersion: incoming.templateVersion,
        latestSources: cloneSources(incoming.sources),
        sourceStatus: incoming.sourceStatus,
    }
    const changed =
        incoming.revision !== scope.baseRevision ||
        incoming.templateVersion !== scope.baseTemplateVersion ||
        !documentSourcesEqual(incoming.sources, scope.baseSources) ||
        incoming.sourceStatus !== scope.sourceStatus
    if (!changed) return {...scope, ...latest}
    if (isDocumentScopeDirty(scope) || scope.phase === 'saving') {
        const conflict: DocumentDraftConflict = {
            revision: incoming.revision,
            templateVersion: incoming.templateVersion,
            sources: cloneSources(incoming.sources),
            sourceStatus: incoming.sourceStatus,
        }
        return {
            ...scope,
            ...latest,
            phase: 'conflict',
            conflict,
            conflictCode:
                incoming.sourceStatus === 'ready'
                    ? incoming.templateVersion === scope.baseTemplateVersion
                        ? 'external_revision_changed'
                        : 'template_version_changed'
                    : incoming.sourceStatus,
            error: '磁盘源码已在本地编辑期间变化；本地草稿与撤销历史已保留，禁止直接覆盖。',
        }
    }
    return createScope(
        incoming.revision,
        incoming.templateVersion,
        incoming.sources,
        incoming.diagnostics,
        incoming.sourceStatus,
    )
}

export function syncDocumentDraft(
    model: DocumentDraftModel,
    snapshot: EntrySourceSnapshot,
): DocumentDraftModel {
    if (snapshot.entry.id.toLowerCase() !== model.entryId.toLowerCase())
        return createDocumentDraft(snapshot)
    const entry = syncScope(model.entry, incomingScope(snapshot, 'entry'))
    const project = syncScope(model.project, incomingScope(snapshot, 'project'))
    if (entry === model.entry && project === model.project) return model
    const synced = {...model, entry, project}
    const linkedHistoryWasReset =
        historyHasLinkedTransaction(model.entry) !== historyHasLinkedTransaction(entry) ||
        historyHasLinkedTransaction(model.project) !== historyHasLinkedTransaction(project)
    return linkedHistoryWasReset ? severLinkedHistory(synced) : synced
}

export function markDraftSaving(
    model: DocumentDraftModel,
    scopeName: SourceEditorScope,
): DocumentDraftModel {
    return {
        ...model,
        [scopeName]: {...model[scopeName], phase: 'saving', error: null},
    } as DocumentDraftModel
}

export function markDraftBundleSaving(model: DocumentDraftModel): DocumentDraftModel {
    return {
        ...model,
        entry: {...model.entry, phase: 'saving', error: null},
        project: {...model.project, phase: 'saving', error: null},
    }
}

export function markDraftBundleSaveFailure(
    model: DocumentDraftModel,
    message: string,
    conflictCode: string | null,
): DocumentDraftModel {
    const failedScope = (scope: DocumentScopeDraft): DocumentScopeDraft => ({
        ...scope,
        phase: conflictCode ? 'conflict' : 'failed',
        conflictCode: conflictCode ?? scope.conflictCode,
        error: message,
    })
    return {...model, entry: failedScope(model.entry), project: failedScope(model.project)}
}

export function markDraftSaveFailure(
    model: DocumentDraftModel,
    scopeName: SourceEditorScope,
    message: string,
    conflictCode: string | null,
): DocumentDraftModel {
    const scope = model[scopeName]
    return {
        ...model,
        [scopeName]: {
            ...scope,
            phase: conflictCode ? 'conflict' : 'failed',
            conflictCode: conflictCode ?? scope.conflictCode,
            error: message,
        },
    } as DocumentDraftModel
}

function acceptScopeSave(
    scope: DocumentScopeDraft,
    revision: number,
    sources: SourceFileSet,
    diagnostics: DocumentDiagnostic[],
    templateVersion = scope.baseTemplateVersion,
): DocumentScopeDraft {
    return createScope(revision, templateVersion, sources, diagnostics, 'ready')
}

export function acceptDocumentSaveBundle(
    model: DocumentDraftModel,
    result: DocumentSaveBundleResult,
): DocumentDraftModel {
    return {
        ...model,
        project: acceptScopeSave(
            model.project,
            result.projectRevision,
            result.project.sources,
            result.project.diagnostics,
            result.templateVersion,
        ),
        entry: acceptScopeSave(
            model.entry,
            result.entryRevision,
            result.entry.sources,
            result.entry.diagnostics,
            result.templateVersion,
        ),
    }
}

export function acceptEntryDraftSave(
    model: DocumentDraftModel,
    revision: number,
    sources: SourceFileSet,
    diagnostics: DocumentDiagnostic[] = [],
): DocumentDraftModel {
    const historyModel = severLinkedHistory(model)
    return {
        ...historyModel,
        entry: acceptScopeSave(historyModel.entry, revision, sources, diagnostics),
    }
}

export function acceptProjectDraftSave(
    model: DocumentDraftModel,
    revision: number,
    sources: SourceFileSet,
    diagnostics: DocumentDiagnostic[] = [],
): DocumentDraftModel {
    const historyModel = severLinkedHistory(model)
    return {
        ...historyModel,
        project: acceptScopeSave(historyModel.project, revision, sources, diagnostics),
    }
}

function discardScope(
    _scope: DocumentScopeDraft,
    incoming: ReturnType<typeof incomingScope>,
): DocumentScopeDraft {
    return createScope(
        incoming.revision,
        incoming.templateVersion,
        incoming.sources,
        incoming.diagnostics,
        incoming.sourceStatus,
    )
}

export function discardEntryDraft(
    model: DocumentDraftModel,
    snapshot: EntrySourceSnapshot,
): DocumentDraftModel {
    const historyModel = severLinkedHistory(model)
    return {
        ...historyModel,
        entry: discardScope(historyModel.entry, incomingScope(snapshot, 'entry')),
        changeVersion: model.changeVersion + 1,
    }
}

export function discardProjectDraft(
    model: DocumentDraftModel,
    snapshot: EntrySourceSnapshot,
): DocumentDraftModel {
    const historyModel = severLinkedHistory(model)
    return {
        ...historyModel,
        project: discardScope(historyModel.project, incomingScope(snapshot, 'project')),
        changeVersion: model.changeVersion + 1,
    }
}

export function applyDocumentDraftToSnapshot(
    snapshot: EntrySourceSnapshot,
    model: DocumentDraftModel,
): EntrySourceSnapshot {
    return {
        ...snapshot,
        articleHtml: model.entry.sources['article.html'],
        styleCss: model.entry.sources['style.css'],
        project: {
            ...snapshot.project,
            defaultArticleHtml: model.project.sources['article.html'],
            defaultStyleCss: model.project.sources['style.css'],
        },
    }
}

export function sourceDraftView(
    model: DocumentDraftModel,
    scopeName: SourceEditorScope,
    activeFile: SourceFileName,
): SourceDraftModel {
    const scope = model[scopeName]
    return {
        scope: scopeName,
        activeFile,
        baseRevision: scope.baseRevision,
        baseTemplateVersion: scope.baseTemplateVersion,
        baseSources: scope.baseSources,
        baseDiagnostics: scope.baseDiagnostics,
        sources: scope.sources,
        latestRevision: scope.latestRevision,
        latestTemplateVersion: scope.latestTemplateVersion,
        latestSources: scope.latestSources,
        sourceStatus: scope.sourceStatus,
        phase: scope.phase,
        validationPhase: scope.validationPhase,
        diagnostics: scope.diagnostics,
        error: scope.error,
        conflictCode: scope.conflictCode,
    }
}

export function canUseVisualDraft(model: DocumentDraftModel): boolean {
    return (
        model.entry.validationPhase === 'valid' &&
        model.project.validationPhase === 'valid' &&
        model.entry.phase !== 'saving' &&
        model.project.phase !== 'saving'
    )
}
