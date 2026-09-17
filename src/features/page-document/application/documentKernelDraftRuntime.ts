// 本模块把纯 DocumentKernel 候选接入唯一草稿与历史；不解析控件语义，也不直接保存或推进持久化 revision。

import type {
    DocumentDiagnostic,
    EntrySourceSnapshot,
    SourceFileName,
    SourceFileSet,
} from '../domain/contract.ts'
import {compilePreviewArtifact} from '../domain/engine/previewCompiler.ts'
import {parseHtmlSource} from '../domain/engine/htmlParser.ts'
import {parseCssSource} from '../domain/engine/cssParser.ts'
import {guardDocumentSources} from '../domain/engine/guard.ts'
import {
    createDocumentKernel,
    documentFingerprint,
    parseSourceSnapshot,
    sourceKeyString,
    type ComponentDescriptor,
    type ComponentHandle,
    type ComponentQuery,
    type ComponentSemanticPartId,
    type DocumentAnalysisSnapshot,
    type EditIntent,
    type IdempotencyKey,
    type InspectedComponent,
    type InspectedTextRange,
    type InteractionId,
    type ReadContext,
    type EditImpact,
    type PreparedEdit,
    type SourceScope,
    type ThemeTokenInspection,
    utf16Range,
} from '../domain/kernel/index.ts'
import {
    applyVisualDraftSources,
    type DocumentDraftModel,
    type DocumentDraftUpdate,
    type DocumentHistoryOptions,
} from './documentDraftModel.ts'

export interface KernelDraftEditRequest {
    readonly nodeIds: readonly string[]
    readonly idempotencyKey: IdempotencyKey
    readonly interactionId: InteractionId | null
    readonly authorizedScopes: readonly SourceScope[]
    createIntents(handles: KernelComponentBindings): readonly EditIntent[]
}

export type KernelComponentBindings = ReadonlyMap<string, ComponentHandle>

export function requireKernelComponentHandle(
    handles: KernelComponentBindings,
    nodeId: string,
): ComponentHandle {
    const handle = handles.get(nodeId.toLowerCase())
    if (!handle) throw new TypeError(`内核请求缺少组件绑定：${nodeId}`)
    return handle
}

export interface KernelTextRangeInspectionRequest {
    readonly nodeId: string
    readonly from: number
    readonly to: number
    readonly expected: string
    readonly properties: readonly string[]
    readonly context: ReadContext
}

export interface KernelComponentInspectionRequest {
    readonly nodeId: string
    readonly semanticPart?: ComponentSemanticPartId
    readonly properties: readonly string[]
    readonly context: ReadContext
}

export interface KernelThemeTokenInspectionRequest {
    readonly scope: SourceScope
    readonly properties: readonly string[]
}

export type KernelThemeTokenInspectionResult =
    | {
          readonly status: 'ready'
          readonly tokens: Readonly<Record<string, ThemeTokenInspection>>
          readonly failures: readonly Readonly<{property: string; code: string}>[]
      }
    | {
          readonly status: 'rejected'
          readonly tokens: Readonly<Record<string, never>>
          readonly failures: readonly Readonly<{property: string; code: string}>[]
      }

export type KernelComponentInspectionResult =
    | {
          readonly status: 'ready'
          readonly inspection: InspectedComponent
          readonly failures: readonly Readonly<{
              code: string
              property: string | null
          }>[]
      }
    | {
          readonly status: 'rejected'
          readonly failures: readonly Readonly<{
              code: string
              property: string | null
          }>[]
      }

export type KernelTextRangeInspectionResult =
    | {
          readonly status: 'ready'
          readonly inspection: InspectedTextRange
          readonly failures: readonly Readonly<{
              code: string
              message: string
              property: string | null
          }>[]
      }
    | {
          readonly status: 'rejected'
          readonly failures: readonly Readonly<{
              code: string
              message: string
              property: string | null
          }>[]
      }

export interface DocumentKernelDraftRuntime {
    analyze(model: DocumentDraftModel, snapshot: EntrySourceSnapshot): DocumentAnalysisSnapshot
    queryComponents(
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        query?: ComponentQuery,
    ): readonly ComponentDescriptor[]
    inspectComponent(
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        request: KernelComponentInspectionRequest,
    ): KernelComponentInspectionResult
    inspectTextRange(
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        request: KernelTextRangeInspectionRequest,
    ): KernelTextRangeInspectionResult
    inspectThemeTokens(
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        request: KernelThemeTokenInspectionRequest,
    ): KernelThemeTokenInspectionResult
    prepare(
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        request: KernelDraftEditRequest,
    ): KernelDraftPreparationResult
    /** 仅供请求级事务构造中间候选；完整接纳必须在整批结束后调用 validateCandidate。 */
    prepareBatchStep(
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        request: KernelDraftEditRequest,
    ): KernelDraftPreparationResult
    applyPrepared(
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        prepared: KernelPreparedDraftEdit,
        label: string,
        history?: DocumentHistoryOptions,
    ): DocumentDraftUpdate
    applyPreparedBatchStep(
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        prepared: KernelPreparedDraftEdit,
        label: string,
    ): DocumentDraftUpdate
    validateCandidate(
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
    ): readonly DocumentDiagnostic[]
    apply(
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        request: KernelDraftEditRequest,
        label: string,
        history?: DocumentHistoryOptions,
    ): DocumentDraftUpdate
}

export interface KernelPreparedDraftEdit {
    readonly baseSignature: string
    readonly nodeIds: readonly string[]
    readonly prepared: PreparedEdit
    /** 中间批次只延迟完整候选接纳，内核自身的操作级契约仍已执行。 */
    readonly acceptance: 'validated' | 'deferred'
    /** 最终候选通过与预览、保存一致的安全/资源/结构接纳后留下的诊断证据。 */
    readonly acceptanceDiagnostics: readonly DocumentDiagnostic[]
}

export type KernelDraftPreparationResult =
    | {readonly status: 'ready'; readonly edit: KernelPreparedDraftEdit}
    | {
          readonly status: 'needs-decision'
          readonly edit: KernelPreparedDraftEdit
          readonly decisions: readonly EditImpact[]
      }
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly diagnostics: readonly DocumentDiagnostic[]}

interface CachedAnalysis {
    readonly signature: string
    readonly analysis: DocumentAnalysisSnapshot
}

export function createDocumentKernelDraftRuntime(): DocumentKernelDraftRuntime {
    const kernel = createDocumentKernel()
    let cached: CachedAnalysis | null = null
    const analyze = (
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
    ): DocumentAnalysisSnapshot => {
        const signature = draftSignature(model, snapshot)
        if (cached?.signature === signature) return cached.analysis
        const analysis = kernel.analyze({
            sourceSnapshot: draftSourceSnapshot(model),
            metadata: snapshot.entry,
            assetHash: documentFingerprint(JSON.stringify(snapshot.assets)),
            componentRegistryVersion: `components:${snapshot.documentVersion}`,
            policyVersion: `policy:${documentFingerprint(JSON.stringify(snapshot.editorLimits))}`,
            writableScopes: ['project', 'entry'],
        })
        cached = Object.freeze({signature, analysis})
        return analysis
    }

    const prepareWithAcceptance = (
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        request: KernelDraftEditRequest,
        acceptance: KernelPreparedDraftEdit['acceptance'],
    ): KernelDraftPreparationResult => {
        const analysis = analyze(model, snapshot)
        const nodeIds = Object.freeze([...new Set(request.nodeIds.map(id => id.toLowerCase()))])
        const binding = kernel.bindComponents(analysis, nodeIds)
        if (binding.failures.length > 0 || binding.handles.length !== nodeIds.length) {
            const failure = binding.failures[0]
            return Object.freeze({
                status: 'rejected' as const,
                diagnostics: Object.freeze([
                    diagnostic(
                        failure?.code ?? 'component-not-found',
                        '编辑目标已删除、身份重复或不再是受管组件。',
                        failure?.nodeId ?? nodeIds[0],
                    ),
                ]),
            })
        }
        const handles = new Map<string, ComponentHandle>(
            binding.handles.map(handle => [handle.nodeId, handle]),
        )
        let intents: readonly EditIntent[]
        try {
            intents = request.createIntents(handles)
        } catch (error) {
            return Object.freeze({
                status: 'rejected' as const,
                diagnostics: Object.freeze([
                    diagnostic(
                        'kernel-edit-intent-invalid',
                        error instanceof Error ? error.message : '无法建立文档编辑意图。',
                        nodeIds[0],
                    ),
                ]),
            })
        }
        if (
            intents.length === 0 ||
            (nodeIds.length === 0 &&
                intents.some(
                    intent =>
                        intent.kind !== 'adopt-opaque-element' &&
                        intent.kind !== 'edit-theme-token' &&
                        intent.kind !== 'apply-source-edits',
                ))
        ) {
            return Object.freeze({
                status: 'rejected' as const,
                diagnostics: Object.freeze([
                    diagnostic(
                        'kernel-edit-target-missing',
                        '编辑请求没有声明已有组件，且未提供可独立定位的源码目标。',
                        undefined,
                    ),
                ]),
            })
        }
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: request.idempotencyKey,
            interactionId: request.interactionId,
            authorizedScopes: request.authorizedScopes,
            intents,
        })
        if (result.status === 'rejected') {
            return Object.freeze({status: 'rejected' as const, diagnostics: result.diagnostics})
        }
        if (result.status === 'unchanged') {
            return Object.freeze({status: 'unchanged' as const})
        }
        const candidate = sourceSets(result.prepared.candidateSnapshot)
        if (!candidate) {
            return Object.freeze({
                status: 'rejected' as const,
                diagnostics: Object.freeze([
                    diagnostic(
                        'kernel-candidate-source-missing',
                        '内核候选缺少项目或词条逻辑源码。',
                        nodeIds[0],
                    ),
                ]),
            })
        }
        // 说明文字不更换资源身份：只容许原已保存源码中的引用继续存在，不把它们冒充已验真的资产。
        const preservesAssetReferences = intents.every(intent =>
            intent.kind === 'set-asset-alt' || intent.kind === 'set-asset-caption')
        const acceptanceDiagnostics = acceptance === 'validated'
            ? validateCandidateSources(snapshot, candidate, preservesAssetReferences)
            : []
        if (acceptanceDiagnostics.some(item => item.severity === 'error')) {
            return Object.freeze({
                status: 'rejected' as const,
                diagnostics: acceptanceDiagnostics,
            })
        }
        const edit = Object.freeze({
            baseSignature: draftSignature(model, snapshot),
            nodeIds,
            prepared: result.prepared,
            acceptance,
            acceptanceDiagnostics,
        })
        return result.status === 'needs-decision'
            ? Object.freeze({status: 'needs-decision' as const, edit, decisions: result.decisions})
            : Object.freeze({status: 'ready' as const, edit})
    }

    const prepare = (
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        request: KernelDraftEditRequest,
    ): KernelDraftPreparationResult => prepareWithAcceptance(model, snapshot, request, 'validated')

    const prepareBatchStep = (
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        request: KernelDraftEditRequest,
    ): KernelDraftPreparationResult => prepareWithAcceptance(model, snapshot, request, 'deferred')

    const applyPreparedWithAcceptance = (
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        edit: KernelPreparedDraftEdit,
        label: string,
        expectedAcceptance: KernelPreparedDraftEdit['acceptance'],
        history: DocumentHistoryOptions = {},
    ): DocumentDraftUpdate => {
        if (edit.acceptance !== expectedAcceptance) {
            return failure(
                model,
                'kernel-edit-acceptance-mode-invalid',
                edit.acceptance === 'deferred'
                    ? '批次中间候选尚未完成整批接纳，不能直接进入用户草稿。'
                    : '已完成接纳的候选不能作为批次中间步骤重复处理。',
                edit.nodeIds[0] ?? null,
            )
        }
        if (draftSignature(model, snapshot) !== edit.baseSignature) {
            return failure(
                model,
                'kernel-edit-plan-stale',
                '确认期间文档已经变化，未应用旧计划；请重新执行这次操作。',
                edit.nodeIds[0] ?? null,
            )
        }
        const candidate = sourceSets(edit.prepared.candidateSnapshot)
        if (!candidate) {
            return failure(
                model,
                'kernel-candidate-source-missing',
                '内核候选缺少项目或词条逻辑源码。',
                edit.nodeIds[0] ?? null,
            )
        }
        const diagnostics = [...edit.acceptanceDiagnostics]
        const update = applyVisualDraftSources(
            model,
            {
                expectedEntrySources: model.entry.sources,
                expectedProjectSources: model.project.sources,
                entrySources: candidate.entry,
                projectSources: candidate.project,
                diagnostics,
            },
            label,
            history,
        )
        if (update.applied) {
            cached = Object.freeze({
                signature: draftSignature(update.model, snapshot),
                analysis: edit.prepared.candidateAnalysis,
            })
        }
        return update
    }

    const applyPrepared = (
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        edit: KernelPreparedDraftEdit,
        label: string,
        history: DocumentHistoryOptions = {},
    ): DocumentDraftUpdate =>
        applyPreparedWithAcceptance(model, snapshot, edit, label, 'validated', history)

    const applyPreparedBatchStep = (
        model: DocumentDraftModel,
        snapshot: EntrySourceSnapshot,
        edit: KernelPreparedDraftEdit,
        label: string,
    ): DocumentDraftUpdate => applyPreparedWithAcceptance(model, snapshot, edit, label, 'deferred')

    return Object.freeze({
        analyze,
        queryComponents: (
            model: DocumentDraftModel,
            snapshot: EntrySourceSnapshot,
            query?: ComponentQuery,
        ) => kernel.queryComponents(analyze(model, snapshot), query),
        prepare,
        prepareBatchStep,
        applyPrepared,
        applyPreparedBatchStep,
        validateCandidate: (model: DocumentDraftModel, snapshot: EntrySourceSnapshot) =>
            validateCandidateSources(snapshot, {
                entry: model.entry.sources,
                project: model.project.sources,
            }),
        inspectComponent: (
            model: DocumentDraftModel,
            snapshot: EntrySourceSnapshot,
            request: KernelComponentInspectionRequest,
        ) => {
            const analysis = analyze(model, snapshot)
            const binding = kernel.bindComponents(analysis, [request.nodeId])
            const handle = binding.handles[0]
            if (!handle) {
                return Object.freeze({
                    status: 'rejected' as const,
                    failures: Object.freeze([
                        Object.freeze({
                            code: binding.failures[0]?.code ?? 'component-not-found',
                            property: null,
                        }),
                    ]),
                })
            }
            const result = kernel.inspectComponents(analysis, [
                {
                    handle,
                    target: request.semanticPart
                        ? {kind: 'semantic-part', part: request.semanticPart}
                        : {kind: 'component-root'},
                    properties: request.properties,
                    context: request.context,
                },
            ])
            const failures = Object.freeze(
                result.failures.map(failure =>
                    Object.freeze({code: failure.code, property: failure.property}),
                ),
            )
            const inspection = result.components[0]
            return inspection
                ? Object.freeze({status: 'ready' as const, inspection, failures})
                : Object.freeze({status: 'rejected' as const, failures})
        },
        inspectTextRange: (
            model: DocumentDraftModel,
            snapshot: EntrySourceSnapshot,
            request: KernelTextRangeInspectionRequest,
        ) => {
            const analysis = analyze(model, snapshot)
            const binding = kernel.bindComponents(analysis, [request.nodeId])
            const handle = binding.handles[0]
            if (!handle) {
                return Object.freeze({
                    status: 'rejected' as const,
                    failures: Object.freeze([
                        Object.freeze({
                            code: binding.failures[0]?.code ?? 'component-not-found',
                            message: '选区目标已删除、身份重复或不再是受管组件。',
                            property: null,
                        }),
                    ]),
                })
            }
            const result = kernel.inspectTextRanges(analysis, [
                {
                    target: {
                        kind: 'text-range',
                        component: handle,
                        range: utf16Range(request.from, request.to),
                        expected: request.expected,
                    },
                    properties: request.properties,
                    context: request.context,
                },
            ])
            const inspection = result.ranges[0]
            const failures = Object.freeze(
                result.failures.map(failure =>
                    Object.freeze({
                        code: failure.code,
                        message: failure.message,
                        property: failure.property,
                    }),
                ),
            )
            return inspection
                ? Object.freeze({status: 'ready' as const, inspection, failures})
                : Object.freeze({
                      status: 'rejected' as const,
                      failures,
                  })
        },
        inspectThemeTokens: (
            model: DocumentDraftModel,
            snapshot: EntrySourceSnapshot,
            request: KernelThemeTokenInspectionRequest,
        ) => {
            const analysis = analyze(model, snapshot)
            const result = kernel.inspectThemeTokens(analysis, request)
            const failures = Object.freeze(
                result.failures.map(failure => Object.freeze({...failure})),
            )
            return Object.keys(result.tokens).length > 0
                ? Object.freeze({status: 'ready' as const, tokens: result.tokens, failures})
                : Object.freeze({
                      status: 'rejected' as const,
                      tokens: Object.freeze({}),
                      failures,
                  })
        },
        apply: (
            model: DocumentDraftModel,
            snapshot: EntrySourceSnapshot,
            request: KernelDraftEditRequest,
            label: string,
            history: DocumentHistoryOptions = {},
        ) => {
            const result = prepare(model, snapshot, request)
            if (result.status === 'rejected') {
                return {model, applied: false, diagnostics: [...result.diagnostics]}
            }
            if (result.status === 'unchanged') {
                return {model, applied: true, diagnostics: []}
            }
            if (result.status === 'needs-decision') {
                return {
                    model,
                    applied: false,
                    diagnostics: [
                        diagnostic(
                            'kernel-edit-decision-required',
                            '本次修改包含无法等价保留的源码语义，必须由上层绑定计划后确认。',
                            request.nodeIds[0] ?? null,
                            result.decisions,
                        ),
                    ],
                }
            }
            return applyPrepared(model, snapshot, result.edit, label, history)
        },
    })
}

function validateCandidateSources(
    snapshot: EntrySourceSnapshot,
    candidate: {readonly entry: SourceFileSet; readonly project: SourceFileSet},
    preserveStoredAssets = false,
): readonly DocumentDiagnostic[] {
    const knownAssetIds = snapshot.assets.map(asset => asset.id)
    if (preserveStoredAssets) {
        const stored = guardDocumentSources(
            [parseHtmlSource(snapshot.articleHtml, {mode: 'fragment', scope: 'entry'})],
            [parseCssSource(snapshot.styleCss, 'entry')],
        )
        knownAssetIds.push(...stored.referencedAssetIds)
    }
    return Object.freeze(
        compilePreviewArtifact({
            projectArticleHtml: candidate.project['article.html'],
            projectStyleCss: candidate.project['style.css'],
            entryArticleHtml: candidate.entry['article.html'],
            entryStyleCss: candidate.entry['style.css'],
            metadata: snapshot.entry,
            assetIds: knownAssetIds,
            paragraphLimit: snapshot.editorLimits.paragraph,
            assetLimit: snapshot.editorLimits.asset,
        }).diagnostics,
    )
}

function draftSourceSnapshot(model: DocumentDraftModel) {
    const documents = (['project', 'entry'] as const).flatMap(scope =>
        (['article.html', 'style.css'] as const).map(file => {
            const content = model[scope].sources[file]
            return {
                key: {scope, file},
                content,
                contentHash: `draft:${documentFingerprint(content)}`,
                persistentRevision: model[scope].baseRevision,
            }
        }),
    )
    return parseSourceSnapshot({
        id: `snapshot:${documentFingerprint(
            JSON.stringify({
                entryId: model.entryId,
                templateVersion: model.entry.baseTemplateVersion,
                documents: documents.map(document => ({
                    key: sourceKeyString(document.key),
                    hash: document.contentHash,
                    revision: document.persistentRevision,
                })),
            }),
        )}`,
        documents,
        templateVersion: model.entry.baseTemplateVersion,
    })
}

function sourceSets(snapshot: DocumentAnalysisSnapshot['sourceSnapshot']): {
    readonly entry: SourceFileSet
    readonly project: SourceFileSet
} | null {
    const find = (scope: SourceScope, file: SourceFileName): string | null =>
        snapshot.documents.find(
            document => document.key.scope === scope && document.key.file === file,
        )?.content ?? null
    const entryArticle = find('entry', 'article.html')
    const entryStyle = find('entry', 'style.css')
    const projectArticle = find('project', 'article.html')
    const projectStyle = find('project', 'style.css')
    return entryArticle === null ||
        entryStyle === null ||
        projectArticle === null ||
        projectStyle === null
        ? null
        : {
              entry: {'article.html': entryArticle, 'style.css': entryStyle},
              project: {'article.html': projectArticle, 'style.css': projectStyle},
          }
}

function draftSignature(model: DocumentDraftModel, snapshot: EntrySourceSnapshot): string {
    return documentFingerprint(
        JSON.stringify({
            entryId: model.entryId,
            changeVersion: model.changeVersion,
            entrySources: model.entry.sources,
            projectSources: model.project.sources,
            revisions: [model.entry.baseRevision, model.project.baseRevision],
            templateVersion: model.entry.baseTemplateVersion,
            metadata: snapshot.entry,
            assets: snapshot.assets,
            limits: snapshot.editorLimits,
            documentVersion: snapshot.documentVersion,
        }),
    )
}

function failure(
    model: DocumentDraftModel,
    code: string,
    message: string,
    nodeId?: string,
): DocumentDraftUpdate {
    return {model, applied: false, diagnostics: [diagnostic(code, message, nodeId)]}
}

function diagnostic(
    code: string,
    message: string,
    nodeId?: string,
    details?: unknown,
): DocumentDiagnostic {
    return {severity: 'error', category: 'capability', code, message, nodeId, details}
}
