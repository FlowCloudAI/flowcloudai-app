// 本模块沿组合树读取文本选区及逐段作者格式；补丁规划与功能区共用该结果，不各自解释行内结构。

import type {DefaultTreeAdapterTypes} from 'parse5'
import type {HtmlCompositionElement, HtmlCompositionNode} from '../composition/index.ts'
import type {
    PropertyInspection,
    TextRangeLinkInspection,
    TextRangeLinkSegment,
    TextRangePropertyInspection,
    TextRangeValueSegment,
} from '../contracts/analysis.ts'
import type {DependencySet} from '../contracts/context.ts'
import type {AnalysisStampId, NodeId} from '../contracts/identity.ts'
import {
    sourceKeyString,
    utf16Range,
    type SourceDocument,
    type SourceOrigin,
    type Utf16SourceRange,
} from '../contracts/source.ts'
import {isUtf16TextBoundary} from '../syntax/index.ts'

export interface ManagedFormatOwner {
    readonly element: HtmlCompositionElement
    readonly from: number
    to: number
    readonly hasDirectProperty: boolean
}

export interface TextRangeTextUnit {
    readonly kind: 'text' | 'break'
    readonly text: string
    readonly from: number
    readonly to: number
    readonly origin: SourceOrigin
    readonly propertyValue: string | null
    readonly propertyValueWithoutManagedOverride: string | null
    readonly writeOwner: ManagedFormatOwner | null
    readonly overrideOwners: readonly ManagedFormatOwner[]
}

export interface CollectedTextRangeProperty {
    readonly units: readonly TextRangeTextUnit[]
    readonly text: string
    readonly inspections: readonly PropertyInspection[]
}

export interface TextSourceUnit {
    readonly kind: 'text' | 'break'
    readonly text: string
    readonly from: number
    readonly to: number
    readonly origin: SourceOrigin
    readonly node: HtmlCompositionNode
    readonly linkOwner: HtmlCompositionElement | null
    readonly href: string | null
}

export interface CollectedTextSource {
    readonly units: readonly TextSourceUnit[]
    readonly text: string
}

export type TextRangePropertyResolver = (
    element: HtmlCompositionElement,
    property: string,
) => PropertyInspection

export type TextRangeCollectionResult =
    CollectedTextRangeProperty | {readonly code: string; readonly message: string}

export type TextRangeInspectionResult =
    | {readonly status: 'ready'; readonly inspection: TextRangePropertyInspection}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export type TextRangeLinkInspectionResult =
    | {readonly status: 'ready'; readonly inspection: TextRangeLinkInspection}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

const NON_TEXT_CONTENT = new Set(['script', 'style', 'template', 'textarea', 'title', 'noscript'])

export function collectTextSource(
    element: HtmlCompositionElement,
    originOfNode: (node: HtmlCompositionNode) => SourceOrigin | null,
    document: SourceDocument,
): CollectedTextSource | {readonly code: string; readonly message: string} {
    const units: TextSourceUnit[] = []
    let cursor = 0
    let failure: {readonly code: string; readonly message: string} | null = null
    const visit = (
        node: HtmlCompositionNode,
        linkOwner: HtmlCompositionElement | null,
        href: string | null,
    ): void => {
        if (failure) return
        if (isText(node)) {
            const origin = originOfNode(node)
            if (!isReadableTextOrigin(origin, document)) {
                failure = {
                    code: 'text-source-origin-unavailable',
                    message: '文本没有可读取的同作用域作者来源。',
                }
                return
            }
            const from = cursor
            cursor += node.value.length
            units.push({
                kind: 'text',
                text: node.value,
                from,
                to: cursor,
                origin,
                node,
                linkOwner,
                href,
            })
            return
        }
        if (!isElement(node)) return
        if (NON_TEXT_CONTENT.has(node.tagName)) {
            failure = {
                code: 'unsupported-inline-source',
                message: `行内元素 <${node.tagName}> 不能通过文本操作修改。`,
            }
            return
        }
        if (node !== element && attribute(node, 'data-fc-node-id') !== null) {
            failure = {
                code: 'nested-component-text-range',
                message: '文本选区不能跨入另一个托管组件。',
            }
            return
        }
        if (node.tagName === 'br') {
            const origin = originOfNode(node)
            if (!isReadableTextOrigin(origin, document)) {
                failure = {
                    code: 'text-source-origin-unavailable',
                    message: '换行没有可读取的同作用域作者来源。',
                }
                return
            }
            units.push({
                kind: 'break',
                text: '\n',
                from: cursor,
                to: cursor + 1,
                origin,
                node,
                linkOwner,
                href,
            })
            cursor += 1
            return
        }
        let nextOwner = linkOwner
        let nextHref = href
        if (node.tagName === 'a') {
            if (linkOwner) {
                failure = {code: 'nested-link', message: '嵌套链接不能通过文本操作修改。'}
                return
            }
            const linkHref = attribute(node, 'href')
            nextOwner = node
            nextHref = linkHref
        }
        for (const child of childrenOf(node)) visit(child, nextOwner, nextHref)
    }
    for (const child of childrenOf(element)) visit(child, null, null)
    if (failure) return failure
    return Object.freeze({
        units: Object.freeze(units),
        text: units.map(unit => unit.text).join(''),
    })
}

export function inspectTextRangeLink(
    element: HtmlCompositionElement,
    originOfNode: (node: HtmlCompositionNode) => SourceOrigin | null,
    document: SourceDocument,
    range: Utf16SourceRange,
    expected: string,
    componentNodeId: NodeId,
    analysisStamp: AnalysisStampId,
): TextRangeLinkInspectionResult {
    const collected = collectTextSource(element, originOfNode, document)
    if ('code' in collected) return {status: 'rejected', ...collected}
    const invalid = validateTextRange(collected.text, range, expected)
    if (invalid) return {status: 'rejected', ...invalid}
    const from = Number(range.from)
    const to = Number(range.to)
    const segments: TextRangeLinkSegment[] = collected.units.flatMap(unit => {
        const selectedFrom = Math.max(from, unit.from)
        const selectedTo = Math.min(to, unit.to)
        if (selectedFrom >= selectedTo) return []
        return [
            Object.freeze({
                range: utf16Range(selectedFrom, selectedTo),
                href: unit.href,
                textOrigin: unit.origin,
                linkOrigin: unit.linkOwner ? originOfNode(unit.linkOwner) : null,
            }),
        ]
    })
    const values = uniqueValues(segments.map(segment => segment.href))
    const origins = segments.flatMap(segment => [segment.textOrigin, segment.linkOrigin])
    const sources = [
        ...new Map(
            origins.flatMap(origin =>
                origin?.source ? [[sourceKeyString(origin.source), origin.source] as const] : [],
            ),
        ).values(),
    ]
    return Object.freeze({
        status: 'ready',
        inspection: Object.freeze({
            range,
            selectedText: expected,
            valueState:
                values.length <= 1
                    ? Object.freeze({kind: 'uniform', value: values[0] ?? null})
                    : Object.freeze({kind: 'mixed', values: Object.freeze(values)}),
            segments: Object.freeze(segments),
            dependencies: Object.freeze({
                nodeIds: Object.freeze([componentNodeId]),
                parentNodeIds: Object.freeze([]),
                sources: Object.freeze(sources),
                declarations: Object.freeze([]),
                variables: Object.freeze([]),
                contexts: Object.freeze([]),
                analysisStamp,
            }),
            diagnostics: Object.freeze([]),
        }),
    })
}

export function collectTextRangeProperty(
    element: HtmlCompositionElement,
    originOfNode: (node: HtmlCompositionNode) => SourceOrigin | null,
    property: string,
    document: SourceDocument,
    resolveProperty: TextRangePropertyResolver,
): TextRangeCollectionResult {
    const units: TextRangeTextUnit[] = []
    const inspections: PropertyInspection[] = []
    let cursor = 0
    let failure: {readonly code: string; readonly message: string} | null = null
    const visit = (
        node: HtmlCompositionNode,
        inheritedValue: string | null,
        inheritedValueWithoutManagedOverride: string | null,
        writeOwner: ManagedFormatOwner | null,
        overrideOwners: readonly ManagedFormatOwner[],
    ): void => {
        if (failure) return
        if (isText(node)) {
            const origin = originOfNode(node)
            if (!isReadableTextOrigin(origin, document)) {
                failure = {
                    code: 'text-source-origin-unavailable',
                    message: '选区文本没有可读取的同作用域作者来源。',
                }
                return
            }
            const from = cursor
            cursor += node.value.length
            units.push({
                kind: 'text',
                text: node.value,
                from,
                to: cursor,
                origin,
                propertyValue: inheritedValue,
                propertyValueWithoutManagedOverride: inheritedValueWithoutManagedOverride,
                writeOwner,
                overrideOwners,
            })
            return
        }
        if (!isElement(node)) return
        if (NON_TEXT_CONTENT.has(node.tagName)) {
            failure = {
                code: 'unsupported-inline-source',
                message: `行内元素 <${node.tagName}> 不能通过文本格式操作修改。`,
            }
            return
        }
        if (node !== element && attribute(node, 'data-fc-node-id') !== null) {
            failure = {
                code: 'nested-component-text-range',
                message: '文本选区不能跨入另一个托管组件。',
            }
            return
        }
        if (node.tagName === 'br') {
            const origin = originOfNode(node)
            if (!isReadableTextOrigin(origin, document)) {
                failure = {
                    code: 'text-source-origin-unavailable',
                    message: '换行没有可读取的同作用域作者来源。',
                }
                return
            }
            units.push({
                kind: 'break',
                text: '\n',
                from: cursor,
                to: cursor + 1,
                origin,
                propertyValue: inheritedValue,
                propertyValueWithoutManagedOverride: inheritedValueWithoutManagedOverride,
                writeOwner,
                overrideOwners,
            })
            cursor += 1
            return
        }
        const managedOwner = isManagedFormatOwner(node, property)
        const next = propertyValueOnElement(
            node,
            property,
            inheritedValue,
            resolveProperty,
            inspections,
        )
        if ('code' in next) {
            failure = next
            return
        }
        const nextValueWithoutManagedOverride =
            next.direct && !managedOwner
                ? next.value
                : (semanticPropertyValue(node.tagName, property) ??
                  inheritedValueWithoutManagedOverride)
        const managed = managedOwner
            ? {
                  element: node,
                  from: cursor,
                  to: cursor,
                  hasDirectProperty: next.direct,
              }
            : null
        const nextWriteOwner = managed ?? writeOwner
        const nextOverrideOwners = managed?.hasDirectProperty
            ? [...overrideOwners, managed]
            : overrideOwners
        for (const child of childrenOf(node)) {
            visit(
                child,
                next.value,
                nextValueWithoutManagedOverride,
                nextWriteOwner,
                nextOverrideOwners,
            )
        }
        if (managed) managed.to = cursor
    }
    const root = resolvedAuthorPropertyValue(element, property, resolveProperty, inspections)
    if ('code' in root) return root
    for (const child of childrenOf(element)) visit(child, root.value, root.value, null, [])
    if (failure) return failure
    return Object.freeze({
        units: Object.freeze(units),
        text: units.map(unit => unit.text).join(''),
        inspections: Object.freeze(inspections),
    })
}

export function inspectTextRangeProperty(
    element: HtmlCompositionElement,
    originOfNode: (node: HtmlCompositionNode) => SourceOrigin | null,
    property: string,
    document: SourceDocument,
    range: Utf16SourceRange,
    expected: string,
    resolveProperty: TextRangePropertyResolver,
): TextRangeInspectionResult {
    const collected = collectTextRangeProperty(
        element,
        originOfNode,
        property,
        document,
        resolveProperty,
    )
    if ('code' in collected) return {status: 'rejected', ...collected}
    const from = Number(range.from)
    const to = Number(range.to)
    const invalid = validateTextRange(collected.text, range, expected)
    if (invalid) return {status: 'rejected', ...invalid}
    const segments: TextRangeValueSegment[] = collected.units.flatMap(unit => {
        const selectedFrom = Math.max(from, unit.from)
        const selectedTo = Math.min(to, unit.to)
        return selectedFrom < selectedTo
            ? [
                  Object.freeze({
                      range: utf16Range(selectedFrom, selectedTo),
                      value: unit.propertyValue,
                      valueWithoutManagedOverride: unit.propertyValueWithoutManagedOverride,
                      textOrigin: unit.origin,
                      managedOverride: unit.overrideOwners.length > 0,
                  }),
              ]
            : []
    })
    const values = uniqueValues(segments.map(segment => segment.value))
    return Object.freeze({
        status: 'ready',
        inspection: Object.freeze({
            propertyFamily: property,
            range,
            selectedText: expected,
            valueState:
                values.length <= 1
                    ? Object.freeze({kind: 'uniform', value: values[0] ?? null})
                    : Object.freeze({kind: 'mixed', values: Object.freeze(values)}),
            segments: Object.freeze(segments),
            dependencies: mergeDependencies(collected.inspections.map(item => item.dependencies)),
            diagnostics: Object.freeze(
                collected.inspections.flatMap(inspection => inspection.diagnostics),
            ),
        }),
    })
}

function validateTextRange(
    text: string,
    range: Utf16SourceRange,
    expected: string,
): {readonly code: string; readonly message: string} | null {
    const from = Number(range.from)
    const to = Number(range.to)
    return from >= to ||
        to > text.length ||
        !isUtf16TextBoundary(text, from) ||
        !isUtf16TextBoundary(text, to) ||
        text.slice(from, to) !== expected
        ? {
              code: 'text-precondition-failed',
              message: '文本选区、字符边界或 expected 已漂移。',
          }
        : null
}

function uniqueValues(values: readonly (string | null)[]): (string | null)[] {
    const result: (string | null)[] = []
    for (const value of values) {
        if (!result.some(item => normalizeValue(item) === normalizeValue(value))) result.push(value)
    }
    return result
}

function normalizeValue(value: string | null): string | null {
    return value?.trim().replace(/\s+/gu, ' ') ?? null
}

function mergeDependencies(dependencies: readonly DependencySet[]): DependencySet {
    const first = dependencies[0]
    if (!first) throw new TypeError('文本选区属性分析缺少根节点依赖。')
    const collect = <Value>(select: (item: DependencySet) => readonly Value[]): readonly Value[] =>
        Object.freeze([...new Set(dependencies.flatMap(item => [...select(item)]))])
    return Object.freeze({
        nodeIds: collect(item => item.nodeIds),
        parentNodeIds: collect(item => item.parentNodeIds),
        sources: collect(item => item.sources),
        declarations: collect(item => item.declarations),
        variables: collect(item => item.variables),
        contexts: collect(item => item.contexts),
        analysisStamp: first.analysisStamp,
    })
}

function propertyValueOnElement(
    element: HtmlCompositionElement,
    property: string,
    inheritedValue: string | null,
    resolveProperty: TextRangePropertyResolver,
    inspections: PropertyInspection[],
):
    | {readonly value: string | null; readonly direct: boolean}
    | {readonly code: string; readonly message: string} {
    const resolved = resolvedAuthorPropertyValue(element, property, resolveProperty, inspections)
    if ('code' in resolved) return resolved
    const direct = resolved.inspection.directDeclarations.some(item => item.condition === 'active')
    return {
        value: direct
            ? resolved.value
            : (semanticPropertyValue(element.tagName, property) ?? inheritedValue),
        direct,
    }
}

function resolvedAuthorPropertyValue(
    element: HtmlCompositionElement,
    property: string,
    resolveProperty: TextRangePropertyResolver,
    inspections: PropertyInspection[],
):
    | {readonly value: string | null; readonly inspection: PropertyInspection}
    | {readonly code: string; readonly message: string} {
    const inspection = resolveProperty(element, property)
    inspections.push(inspection)
    if (inspection.confidence.kind !== 'proven') {
        return {
            code: 'text-format-state-unknown',
            message: `无法可靠读取选区格式：${inspection.confidence.reason}`,
        }
    }
    return {
        value: inspection.effectiveValue?.resolvedValue ?? null,
        inspection,
    }
}

function semanticPropertyValue(tagName: string, property: string): string | null {
    if (property === 'font-weight' && (tagName === 'strong' || tagName === 'b')) return '700'
    if (property === 'font-style' && (tagName === 'em' || tagName === 'i')) return 'italic'
    if (property === 'text-decoration-line') {
        if (tagName === 'u') return 'underline'
        if (tagName === 's' || tagName === 'del') return 'line-through'
    }
    return null
}

function isManagedFormatOwner(element: HtmlCompositionElement, property: string): boolean {
    return (
        element.tagName === 'span' &&
        attribute(element, 'data-fc-inline-format') === property &&
        element.attrs.some(item => item.name === 'style')
    )
}

function isReadableTextOrigin(
    origin: SourceOrigin | null,
    document: SourceDocument,
): origin is SourceOrigin {
    return (
        origin?.kind === 'author' &&
        origin.range !== null &&
        origin.source?.scope === document.key.scope &&
        origin.source.file === document.key.file
    )
}

function childrenOf(node: HtmlCompositionNode): readonly DefaultTreeAdapterTypes.ChildNode[] {
    if (isElement(node) && node.tagName === 'template' && 'content' in node) {
        return node.content.childNodes
    }
    return 'childNodes' in node ? node.childNodes : []
}

function isElement(node: HtmlCompositionNode): node is HtmlCompositionElement {
    return 'tagName' in node
}

function isText(node: HtmlCompositionNode): node is DefaultTreeAdapterTypes.TextNode {
    return node.nodeName === '#text' && 'value' in node
}

function attribute(element: HtmlCompositionElement, name: string): string | null {
    return element.attrs.find(item => item.name === name)?.value ?? null
}
