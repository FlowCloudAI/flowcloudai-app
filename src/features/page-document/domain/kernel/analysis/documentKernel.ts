// 本模块是 UI、AI 与文档服务共享的内核外观；组合树和可变解析对象只保留在版本绑定运行时中。

import type {DocumentDiagnostic} from '../../contract.ts'
import {
    createComponentIndex,
    propertyCapabilityForComponent,
    type ComponentBindingResult,
    type ComponentDescriptor,
    type ComponentIndex,
    type ComponentQuery,
    type ComponentSemanticPartId,
    type SemanticPartResolution,
} from '../components/index.ts'
import {mergeEntryTemplate, type HtmlCompositionElement} from '../composition/index.ts'
import type {
    DocumentAnalysisSnapshot,
    PropertyInspection,
    ThemeTokenInspection,
    TextRangeLinkInspection,
    TextRangePropertyInspection,
} from '../contracts/analysis.ts'
import {parseReadContext, type EditTarget, type ReadContext} from '../contracts/context.ts'
import type {EditBatch, PrepareEditResult, PreparedEdit} from '../contracts/edit.ts'
import {documentFingerprint} from '../contracts/hash.ts'
import {analysisStampId, editPlanId, type ComponentHandle} from '../contracts/identity.ts'
import {parseEditBatch, parseEditTarget} from '../contracts/runtime.ts'
import {
    sourceKeyString,
    type SourceOrigin,
    type SourceScope,
    type SourceSnapshot,
} from '../contracts/source.ts'
import {planPropertyEditBatch, type PlanningAnalysisRuntime} from '../planning/index.ts'
import {checkComponentRemovalPolicy, inspectComponentMovementPolicy} from '../policy/index.ts'
import {
    createAuthorStyleIndex,
    createPropertyAnalyzer,
    type PropertyAnalyzer,
    createThemeTokenAnalyzer,
    type ThemeTokenAnalyzer,
} from '../styles/index.ts'
import {
    childNodes,
    getAttribute,
    isElement,
    parseHtmlSource,
    readManagedTableStructure,
    syntaxDocumentDiagnostic,
    type HtmlNode,
    walkElements,
} from '../syntax/index.ts'
import {inspectTextRangeLink, inspectTextRangeProperty} from './textRangeAnalysis.ts'

export interface DocumentKernelMetadata {
    readonly id: string
    readonly title: string
    readonly summary: string
    readonly tags: readonly string[]
}

export interface DocumentAnalyzeRequest {
    readonly sourceSnapshot: SourceSnapshot
    readonly metadata: DocumentKernelMetadata
    readonly assetHash: string
    readonly componentRegistryVersion: string
    readonly policyVersion: string
    readonly writableScopes?: readonly SourceScope[]
}

export interface ComponentInspectionRequest {
    readonly handle: ComponentHandle
    readonly target?:
        {readonly kind: 'component-root'} | {readonly kind: 'semantic-part'; readonly part: string}
    readonly properties: readonly string[]
    readonly context: ReadContext
}

export interface InspectedComponent {
    readonly handle: ComponentHandle
    readonly target: Extract<EditTarget, {readonly kind: 'component-root' | 'semantic-part'}>
    readonly structure: ComponentStructureInspection
    readonly properties: Readonly<Record<string, PropertyInspection>>
}

export interface ComponentStructureInspection {
    readonly tagName: string
    readonly attributes: Readonly<Record<string, string>>
    readonly textContent: string
    readonly contentShape: 'empty' | 'plain-text' | 'structured'
    readonly origin: SourceOrigin | null
    readonly semanticParts: readonly SemanticPartResolution[]
    readonly table:
        | {readonly status: 'rectangular'; readonly rowCount: number; readonly columnCount: number}
        | {readonly status: 'unsupported'}
        | null
    readonly removal:
        | {
              readonly status: 'available'
              readonly parentNodeId: ComponentHandle['nodeId']
              readonly destinationScope: SourceScope
          }
        | {readonly status: 'unavailable'; readonly code: string; readonly reason: string}
    readonly movement:
        | {
              readonly status: 'available'
              readonly parentNodeId: ComponentHandle['nodeId']
              readonly siblingNodeIds: readonly ComponentHandle['nodeId'][]
              readonly currentIndex: number
              readonly destinationScope: SourceScope
          }
        | {readonly status: 'unavailable'; readonly code: string; readonly reason: string}
}

export interface ComponentInspectionFailure {
    readonly handle: ComponentHandle
    readonly code:
        | 'stale-component-handle'
        | 'invalid-component-target'
        | 'semantic-part-unavailable'
        | 'invalid-property-name'
    readonly property: string | null
}

export interface InspectComponentsResult {
    readonly components: readonly InspectedComponent[]
    readonly failures: readonly ComponentInspectionFailure[]
}

export interface TextRangeInspectionRequest {
    readonly target: Extract<EditTarget, {readonly kind: 'text-range'}>
    readonly properties: readonly string[]
    readonly context: ReadContext
}

export interface InspectedTextRange {
    readonly target: Extract<EditTarget, {readonly kind: 'text-range'}>
    readonly link: TextRangeLinkInspection
    readonly properties: Readonly<Record<string, TextRangePropertyInspection>>
}

export interface TextRangeInspectionFailure {
    readonly target: Extract<EditTarget, {readonly kind: 'text-range'}>
    readonly property: string | null
    readonly code: string
    readonly message: string
}

export interface InspectTextRangesResult {
    readonly ranges: readonly InspectedTextRange[]
    readonly failures: readonly TextRangeInspectionFailure[]
}

export interface ThemeTokenInspectionRequest {
    readonly scope: SourceScope
    readonly properties: readonly string[]
}

export interface InspectThemeTokensResult {
    readonly tokens: Readonly<Record<string, ThemeTokenInspection>>
    readonly failures: readonly Readonly<{
        property: string
        code: 'theme-token-unavailable' | 'invalid-theme-token-name'
    }>[]
}

export interface DocumentKernel {
    analyze(request: DocumentAnalyzeRequest): DocumentAnalysisSnapshot
    queryComponents(
        analysis: DocumentAnalysisSnapshot,
        query?: ComponentQuery,
    ): readonly ComponentDescriptor[]
    bindComponents(
        analysis: DocumentAnalysisSnapshot,
        nodeIds: readonly string[],
    ): ComponentBindingResult
    inspectComponents(
        analysis: DocumentAnalysisSnapshot,
        requests: readonly ComponentInspectionRequest[],
    ): InspectComponentsResult
    inspectTextRanges(
        analysis: DocumentAnalysisSnapshot,
        requests: readonly TextRangeInspectionRequest[],
    ): InspectTextRangesResult
    inspectThemeTokens(
        analysis: DocumentAnalysisSnapshot,
        request: ThemeTokenInspectionRequest,
    ): InspectThemeTokensResult
    prepareEdit(analysis: DocumentAnalysisSnapshot, batch: EditBatch): PrepareEditResult
}

interface AnalysisRuntime {
    readonly components: ComponentIndex | null
    readonly properties: PropertyAnalyzer | null
    readonly themeTokens: ThemeTokenAnalyzer | null
    readonly request: DocumentAnalyzeRequest
}

const REQUIRED_SOURCES = [
    'project:article.html',
    'project:style.css',
    'entry:article.html',
    'entry:style.css',
] as const
const CSS_PROPERTY_PATTERN = /^(?:--[A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9-]*)$/u
const MAX_INSPECTION_COMPONENTS = 256
const MAX_INSPECTION_PROPERTIES = 128

export function createDocumentKernel(): DocumentKernel {
    const runtimes = new WeakMap<DocumentAnalysisSnapshot, AnalysisRuntime>()
    const requireRuntime = (analysis: DocumentAnalysisSnapshot): AnalysisRuntime => {
        const runtime = runtimes.get(analysis)
        if (!runtime) throw new TypeError('分析快照不属于当前 DocumentKernel。')
        return runtime
    }
    return Object.freeze({
        analyze: (request: DocumentAnalyzeRequest) => {
            const analyzed = analyzeDocument(request)
            runtimes.set(analyzed.snapshot, analyzed.runtime)
            return analyzed.snapshot
        },
        queryComponents: (analysis: DocumentAnalysisSnapshot, query?: ComponentQuery) => {
            const components = requireRuntime(analysis).components
            return components?.query(query) ?? []
        },
        bindComponents: (analysis: DocumentAnalysisSnapshot, nodeIds: readonly string[]) => {
            const components = requireRuntime(analysis).components
            if (components) return components.bind(nodeIds)
            return Object.freeze({
                handles: Object.freeze([]),
                failures: Object.freeze(
                    nodeIds.map(nodeId => ({nodeId, code: 'component-not-found' as const})),
                ),
            })
        },
        inspectComponents: (
            analysis: DocumentAnalysisSnapshot,
            requests: readonly ComponentInspectionRequest[],
        ) => inspectComponents(requireRuntime(analysis), requests),
        inspectTextRanges: (
            analysis: DocumentAnalysisSnapshot,
            requests: readonly TextRangeInspectionRequest[],
        ) => inspectTextRanges(requireRuntime(analysis), requests),
        inspectThemeTokens: (
            analysis: DocumentAnalysisSnapshot,
            request: ThemeTokenInspectionRequest,
        ) => inspectThemeTokens(requireRuntime(analysis), request),
        prepareEdit: (analysis: DocumentAnalysisSnapshot, batch: EditBatch) => {
            const runtime = requireRuntime(analysis)
            let parsedBatch: EditBatch
            try {
                parsedBatch = parseEditBatch(batch)
            } catch (error) {
                return Object.freeze({
                    status: 'rejected',
                    diagnostics: Object.freeze([
                        Object.freeze({
                            severity: 'error',
                            category: 'capability',
                            code: 'invalid-edit-batch',
                            message:
                                error instanceof Error
                                    ? error.message
                                    : '编辑批次不符合运行时契约。',
                        } satisfies DocumentDiagnostic),
                    ]),
                })
            }
            const planned = planPropertyEditBatch(
                {
                    initial: planningRuntime(analysis, runtime),
                    analyzeCandidate: sourceSnapshot => {
                        const analyzed = analyzeDocument({...runtime.request, sourceSnapshot})
                        runtimes.set(analyzed.snapshot, analyzed.runtime)
                        return planningRuntime(analyzed.snapshot, analyzed.runtime)
                    },
                },
                parsedBatch,
            )
            if (planned.status === 'rejected') return planned
            if (planned.status === 'unchanged') {
                return Object.freeze({status: 'unchanged' as const})
            }
            const prepared: PreparedEdit = Object.freeze({
                planId: editPlanId(
                    `plan:${documentFingerprint(
                        JSON.stringify({
                            base: analysis.stamp.id,
                            request: parsedBatch.idempotencyKey,
                            candidate: planned.candidate.snapshot.stamp.id,
                            patches: planned.patches,
                        }),
                    )}`,
                ),
                idempotencyKey: parsedBatch.idempotencyKey,
                baseAnalysis: analysis.stamp.id,
                patches: planned.patches,
                candidateSnapshot: planned.candidate.snapshot.sourceSnapshot,
                candidateAnalysis: planned.candidate.snapshot,
                impacts: planned.impacts,
            })
            const decisions = Object.freeze(
                planned.impacts.filter(impact => impact.requiresDecision),
            )
            return decisions.length > 0
                ? Object.freeze({status: 'needs-decision', prepared, decisions})
                : Object.freeze({status: 'ready', prepared})
        },
    })
}

function analyzeDocument(request: DocumentAnalyzeRequest): {
    snapshot: DocumentAnalysisSnapshot
    runtime: AnalysisRuntime
} {
    const byKey = new Map(
        request.sourceSnapshot.documents.map(document => [sourceKeyString(document.key), document]),
    )
    const diagnostics: DocumentDiagnostic[] = []
    for (const required of REQUIRED_SOURCES) {
        if (!byKey.has(required)) diagnostics.push(missingSourceDiagnostic(required))
    }
    const stamp = Object.freeze({
        id: analysisStampId(`analysis:${documentFingerprint(analysisFingerprint(request))}`),
        snapshotId: request.sourceSnapshot.id,
        metadataHash: documentFingerprint(metadataFingerprint(request.metadata)),
        assetHash: request.assetHash,
        componentRegistryVersion: request.componentRegistryVersion,
        policyVersion: request.policyVersion,
    })
    let components: ComponentIndex | null = null
    let properties: PropertyAnalyzer | null = null
    let themeTokens: ThemeTokenAnalyzer | null = null
    if (diagnostics.length === 0) {
        const projectHtml = byKey.get('project:article.html')!
        const entryHtml = byKey.get('entry:article.html')!
        const merged = mergeEntryTemplate(
            parseHtmlSource(projectHtml.content, {mode: 'document', scope: 'project'}),
            parseHtmlSource(entryHtml.content, {mode: 'fragment', scope: 'entry'}),
            {
                id: request.metadata.id,
                title: request.metadata.title,
                summary: request.metadata.summary,
                tags: [...request.metadata.tags],
            },
        )
        diagnostics.push(...merged.diagnostics)
        const styles = createAuthorStyleIndex([
            {
                key: byKey.get('project:style.css')!.key,
                content: byKey.get('project:style.css')!.content,
            },
            {
                key: byKey.get('entry:style.css')!.key,
                content: byKey.get('entry:style.css')!.content,
            },
        ])
        diagnostics.push(...styles.diagnostics.map(syntaxDocumentDiagnostic))
        if (merged.composition) {
            components = createComponentIndex(merged.composition, {
                analysisStamp: stamp.id,
                instanceNamespace: request.metadata.id,
            })
            properties = createPropertyAnalyzer({
                composition: merged.composition,
                components,
                styles,
                analysisStamp: stamp.id,
                writableScopes: request.writableScopes,
            })
            let entryRoot: HtmlCompositionElement | null = null
            let projectRoot: HtmlCompositionElement | null = null
            walkElements(merged.composition.root, element => {
                if (!projectRoot && element.tagName === 'html') projectRoot = element
                if (!entryRoot && getAttribute(element, 'data-fc-slot') === 'entry-root') {
                    entryRoot = element
                }
            })
            if (entryRoot && projectRoot) {
                themeTokens = createThemeTokenAnalyzer({
                    effectiveRoot: entryRoot,
                    projectRoot,
                    properties,
                    entryId: request.metadata.id,
                    writableScopes: request.writableScopes ?? ['entry'],
                })
            }
        }
    }
    const snapshot: DocumentAnalysisSnapshot = Object.freeze({
        sourceSnapshot: request.sourceSnapshot,
        stamp,
        diagnostics: Object.freeze(diagnostics),
    })
    return {snapshot, runtime: Object.freeze({components, properties, themeTokens, request})}
}

function planningRuntime(
    snapshot: DocumentAnalysisSnapshot,
    runtime: AnalysisRuntime,
): PlanningAnalysisRuntime {
    return Object.freeze({
        snapshot,
        entryId: runtime.request.metadata.id,
        components: runtime.components,
        properties: runtime.properties,
        themeTokens: runtime.themeTokens,
    })
}

function inspectThemeTokens(
    runtime: AnalysisRuntime,
    request: ThemeTokenInspectionRequest,
): InspectThemeTokensResult {
    const properties = [...new Set(request.properties)]
    if (properties.length > MAX_INSPECTION_PROPERTIES) {
        throw new RangeError(`一次最多检查 ${MAX_INSPECTION_PROPERTIES} 个主题令牌。`)
    }
    const tokens: Record<string, ThemeTokenInspection> = {}
    const failures: Array<{
        property: string
        code: 'theme-token-unavailable' | 'invalid-theme-token-name'
    }> = []
    for (const rawProperty of properties) {
        const property = rawProperty.toLowerCase()
        if (!/^--fc-[A-Za-z0-9][A-Za-z0-9-]*$/u.test(property)) {
            failures.push({property: rawProperty, code: 'invalid-theme-token-name'})
            continue
        }
        const inspected = runtime.themeTokens?.inspect(request.scope, property)
        if (inspected) tokens[property] = inspected
        else failures.push({property, code: 'theme-token-unavailable'})
    }
    return Object.freeze({
        tokens: Object.freeze(tokens),
        failures: Object.freeze(failures.map(failure => Object.freeze(failure))),
    })
}

function inspectComponents(
    runtime: AnalysisRuntime,
    requests: readonly ComponentInspectionRequest[],
): InspectComponentsResult {
    if (requests.length > MAX_INSPECTION_COMPONENTS) {
        throw new RangeError(`一次最多检查 ${MAX_INSPECTION_COMPONENTS} 个组件。`)
    }
    const inspected: InspectedComponent[] = []
    const failures: ComponentInspectionFailure[] = []
    for (const request of requests) {
        if (!runtime.components?.resolveElement(request.handle) || !runtime.properties) {
            failures.push({handle: request.handle, code: 'stale-component-handle', property: null})
            continue
        }
        let target: Extract<EditTarget, {readonly kind: 'component-root' | 'semantic-part'}>
        try {
            const parsed = parseEditTarget({
                ...(request.target ?? {kind: 'component-root'}),
                component: request.handle,
            })
            if (parsed.kind === 'text-range') throw new TypeError('组件检查不接受文本选区。')
            target = parsed
        } catch {
            failures.push({
                handle: request.handle,
                code: 'invalid-component-target',
                property: null,
            })
            continue
        }
        if (target.kind === 'semantic-part') {
            const part = runtime.components
                .query()
                .find(component => component.handle.handleId === request.handle.handleId)
                ?.semanticParts.find(candidate => candidate.id === target.part)
            if (!part || part.status !== 'resolved') {
                failures.push({
                    handle: request.handle,
                    code: 'semantic-part-unavailable',
                    property: null,
                })
                continue
            }
        }
        const targetElement = resolveInspectionElement(runtime.components, request.handle, target)
        if (!targetElement) {
            failures.push({
                handle: request.handle,
                code: 'semantic-part-unavailable',
                property: null,
            })
            continue
        }
        const context = parseReadContext(request.context)
        const properties: Record<string, PropertyInspection> = {}
        const unique = [...new Set(request.properties)]
        if (unique.length > MAX_INSPECTION_PROPERTIES) {
            throw new RangeError(`单个组件一次最多检查 ${MAX_INSPECTION_PROPERTIES} 个属性。`)
        }
        for (const rawProperty of unique) {
            const property = rawProperty.startsWith('--') ? rawProperty : rawProperty.toLowerCase()
            if (!CSS_PROPERTY_PATTERN.test(property)) {
                failures.push({
                    handle: request.handle,
                    code: 'invalid-property-name',
                    property: rawProperty,
                })
                continue
            }
            const inspection = runtime.properties.inspectTarget(target, property, context)
            if (inspection) properties[property] = inspection
        }
        inspected.push(
            Object.freeze({
                handle: request.handle,
                target,
                structure: inspectComponentStructure(
                    runtime.components,
                    request.handle,
                    targetElement,
                ),
                properties: Object.freeze(properties),
            }),
        )
    }
    return Object.freeze({
        components: Object.freeze(inspected),
        failures: Object.freeze(failures),
    })
}

function resolveInspectionElement(
    components: ComponentIndex,
    handle: ComponentHandle,
    target: Extract<EditTarget, {readonly kind: 'component-root' | 'semantic-part'}>,
): HtmlCompositionElement | null {
    if (target.kind === 'component-root') return components.resolveElement(handle)
    const matches = components.resolveSemanticPart(handle, target.part as ComponentSemanticPartId)
    return matches?.length === 1 ? matches[0] : null
}

function inspectComponentStructure(
    components: ComponentIndex,
    handle: ComponentHandle,
    element: HtmlCompositionElement,
): ComponentStructureInspection {
    const descriptor = components
        .query()
        .find(candidate => candidate.handle.handleId === handle.handleId)
    const children = childNodes(element)
    const contentShape =
        children.length === 0
            ? 'empty'
            : children.every(isPlainTextChild)
              ? 'plain-text'
              : 'structured'
    const origin = components.originOfNode(element)
    return Object.freeze({
        tagName: element.tagName,
        attributes: Object.freeze(
            Object.fromEntries(element.attrs.map(attribute => [attribute.name, attribute.value])),
        ),
        textContent: componentTextContent(element),
        contentShape,
        origin,
        semanticParts: descriptor?.semanticParts ?? Object.freeze([]),
        table: inspectTableStructure(element),
        removal: inspectComponentRemoval(components, handle, origin),
        movement: inspectComponentMovement(components, handle, origin),
    })
}

function inspectComponentMovement(
    components: ComponentIndex,
    handle: ComponentHandle,
    origin: SourceOrigin | null,
): ComponentStructureInspection['movement'] {
    const policy = inspectComponentMovementPolicy(components, handle)
    if (policy.status === 'rejected') {
        return Object.freeze({
            status: 'unavailable',
            code: policy.code,
            reason: policy.message,
        })
    }
    if (
        origin?.kind !== 'author' ||
        !origin.source ||
        origin.source.file !== 'article.html' ||
        sourceKeyString(origin.source) !== sourceKeyString(policy.source)
    ) {
        return Object.freeze({
            status: 'unavailable',
            code: 'component-move-source-unavailable',
            reason: '组件与当前父级不在同一份可写作者 HTML 中。',
        })
    }
    return Object.freeze({
        status: 'available',
        parentNodeId: policy.parentNodeId,
        siblingNodeIds: policy.siblingNodeIds,
        currentIndex: policy.currentIndex,
        destinationScope: origin.source.scope,
    })
}

function inspectComponentRemoval(
    components: ComponentIndex,
    handle: ComponentHandle,
    origin: SourceOrigin | null,
): ComponentStructureInspection['removal'] {
    const policy = checkComponentRemovalPolicy(components, handle)
    if (policy.status === 'rejected') {
        return Object.freeze({
            status: 'unavailable',
            code: policy.code,
            reason: policy.message,
        })
    }
    if (!origin?.source || origin.source.file !== 'article.html') {
        return Object.freeze({
            status: 'unavailable',
            code: 'source-origin-unavailable',
            reason: '组件没有可写的作者 HTML 来源。',
        })
    }
    return Object.freeze({
        status: 'available',
        parentNodeId: policy.parentNodeId,
        destinationScope: origin.source.scope,
    })
}

function inspectTableStructure(
    element: HtmlCompositionElement,
): ComponentStructureInspection['table'] {
    if (element.tagName !== 'table') return null
    const table = readManagedTableStructure(element)
    return table
        ? Object.freeze({
              status: 'rectangular' as const,
              rowCount: table.rows.length,
              columnCount: table.columnCount,
          })
        : Object.freeze({status: 'unsupported' as const})
}

function isPlainTextChild(node: HtmlNode): boolean {
    if ('value' in node && typeof node.value === 'string') return true
    return isElement(node) && node.tagName === 'br' && node.attrs.length === 0
}

function componentTextContent(node: HtmlNode): string {
    if ('value' in node && typeof node.value === 'string') return node.value
    if (isElement(node) && node.tagName === 'br') return '\n'
    return childNodes(node).map(componentTextContent).join('')
}

function inspectTextRanges(
    runtime: AnalysisRuntime,
    requests: readonly TextRangeInspectionRequest[],
): InspectTextRangesResult {
    if (requests.length > MAX_INSPECTION_COMPONENTS) {
        throw new RangeError(`一次最多检查 ${MAX_INSPECTION_COMPONENTS} 个文本选区。`)
    }
    const ranges: InspectedTextRange[] = []
    const failures: TextRangeInspectionFailure[] = []
    for (const request of requests) {
        let parsedTarget: Extract<EditTarget, {readonly kind: 'text-range'}>
        try {
            const target = parseEditTarget(request.target)
            if (target.kind !== 'text-range') throw new TypeError('目标不是文本选区。')
            parsedTarget = target
        } catch (error) {
            failures.push({
                target: request.target,
                property: null,
                code: 'invalid-text-range-target',
                message: error instanceof Error ? error.message : '文本选区目标无效。',
            })
            continue
        }
        const element = runtime.components?.resolveElement(parsedTarget.component)
        if (!element || !runtime.components || !runtime.properties) {
            failures.push({
                target: parsedTarget,
                property: null,
                code: 'stale-component-handle',
                message: '文本选区组件句柄已经过期。',
            })
            continue
        }
        const source = parsedTarget.component.origin.source
        const document = source
            ? runtime.request.sourceSnapshot.documents.find(
                  item => sourceKeyString(item.key) === sourceKeyString(source),
              )
            : null
        if (!document || document.key.file !== 'article.html') {
            failures.push({
                target: parsedTarget,
                property: null,
                code: 'text-source-origin-unavailable',
                message: '文本选区没有可读取的作者 HTML 来源。',
            })
            continue
        }
        const context = parseReadContext(request.context)
        const link = inspectTextRangeLink(
            element,
            node => runtime.components!.originOfNode(node),
            document,
            parsedTarget.range,
            parsedTarget.expected,
            parsedTarget.component.nodeId,
            parsedTarget.component.analysisStamp,
        )
        if (link.status === 'rejected') {
            failures.push({
                target: parsedTarget,
                property: 'href',
                code: link.code,
                message: link.message,
            })
            continue
        }
        const properties: Record<string, TextRangePropertyInspection> = {}
        const unique = [...new Set(request.properties)]
        if (unique.length > MAX_INSPECTION_PROPERTIES) {
            throw new RangeError(`单个文本选区一次最多检查 ${MAX_INSPECTION_PROPERTIES} 个属性。`)
        }
        for (const rawProperty of unique) {
            const property = rawProperty.startsWith('--') ? rawProperty : rawProperty.toLowerCase()
            if (!CSS_PROPERTY_PATTERN.test(property)) {
                failures.push({
                    target: parsedTarget,
                    property: rawProperty,
                    code: 'invalid-property-name',
                    message: 'CSS 属性名无效。',
                })
                continue
            }
            if (
                !propertyCapabilityForComponent(parsedTarget.component.kind, 'text-range', property)
            ) {
                failures.push({
                    target: parsedTarget,
                    property,
                    code: 'property-capability-unavailable',
                    message: `${parsedTarget.component.kind} 的文本选区不支持属性 ${property}。`,
                })
                continue
            }
            const inspected = inspectTextRangeProperty(
                element,
                node => runtime.components!.originOfNode(node),
                property,
                document,
                parsedTarget.range,
                parsedTarget.expected,
                (target, targetProperty) =>
                    runtime.properties!.inspectElement(target, targetProperty, context),
            )
            if (inspected.status === 'rejected') {
                failures.push({
                    target: parsedTarget,
                    property,
                    code: inspected.code,
                    message: inspected.message,
                })
            } else {
                properties[property] = inspected.inspection
            }
        }
        ranges.push(
            Object.freeze({
                target: parsedTarget,
                link: link.inspection,
                properties: Object.freeze(properties),
            }),
        )
    }
    return Object.freeze({ranges: Object.freeze(ranges), failures: Object.freeze(failures)})
}

function missingSourceDiagnostic(key: (typeof REQUIRED_SOURCES)[number]): DocumentDiagnostic {
    const [scope, file] = key.split(':') as [SourceScope, 'article.html' | 'style.css']
    return {
        severity: 'error',
        category: 'capability',
        code: 'kernel_source_missing',
        message: `分析快照缺少 ${scope} 作用域的 ${file}。`,
        file,
        details: {scope},
    }
}

function analysisFingerprint(request: DocumentAnalyzeRequest): string {
    return JSON.stringify({
        snapshotId: request.sourceSnapshot.id,
        sources: request.sourceSnapshot.documents
            .map(document => ({
                key: sourceKeyString(document.key),
                hash: document.contentHash,
                content: document.content,
                revision: document.persistentRevision,
            }))
            .sort((left, right) => left.key.localeCompare(right.key)),
        templateVersion: request.sourceSnapshot.templateVersion,
        metadata: metadataFingerprint(request.metadata),
        assetHash: request.assetHash,
        componentRegistryVersion: request.componentRegistryVersion,
        policyVersion: request.policyVersion,
    })
}

function metadataFingerprint(metadata: DocumentKernelMetadata): string {
    return JSON.stringify({
        id: metadata.id,
        title: metadata.title,
        summary: metadata.summary,
        tags: [...metadata.tags],
    })
}
