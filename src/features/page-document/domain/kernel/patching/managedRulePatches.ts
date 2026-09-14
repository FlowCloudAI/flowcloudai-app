// 本模块把基础、设备与交互属性写入规范 fc-node 规则；未知 CSS 原样保留且不参与模糊接管。

import type {AtRule, Declaration, Node, Rule} from 'postcss'
import type {WriteChannel} from '../contracts/context.ts'
import type {ComponentSemanticPartId} from '../components/definitions.ts'
import type {DocumentNodeKind} from '../contracts/primitives.ts'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import {parsePropertyValueSyntax, parseStylesheetSyntax} from '../syntax/index.ts'
import {propertyName} from '../styles/index.ts'
import {
    managedRuleTarget,
    normalizeManagedCondition,
    type ManagedRuleTarget,
} from './managedRuleTarget.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type ManagedRulePatchResult =
    | {readonly status: 'ready'; readonly patches: readonly SourcePatch[]}
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

const MAX_DECLARATION_VALUE_LENGTH = 4_096

export interface ManagedRulePatchOptions {
    /** 目的地已有同值声明但被后续规则覆盖时，把该属性移到最后一个受管层末尾重新确立级联。 */
    readonly forceWinningWrite?: boolean
}

export function createManagedRulePropertyPatches(
    document: SourceDocument,
    nodeId: string,
    nodeKind: DocumentNodeKind,
    channel: Exclude<WriteChannel, {readonly kind: 'inline'}>,
    propertyInput: string,
    value: string | null,
    semanticPart: ComponentSemanticPartId | null = null,
    options: ManagedRulePatchOptions = {},
): ManagedRulePatchResult {
    if (document.key.file !== 'style.css') {
        return rejected('managed-rule-source-invalid', '受管规则只能写入 style.css。')
    }
    const property = propertyName(propertyInput)
    if (value !== null) {
        if (value.length > MAX_DECLARATION_VALUE_LENGTH) {
            return rejected('css-value-too-large', `属性 ${property} 的值超过长度限制。`)
        }
        const parsedValue = parsePropertyValueSyntax(property, value, document.key)
        const declaration = parsedValue.declarations[0]
        if (parsedValue.diagnostics.length > 0 || !declaration || declaration.important) {
            return rejected('invalid-property-value', `属性 ${property} 的值不是单一普通声明。`)
        }
    }
    const parsed = parseStylesheetSyntax(document.content, document.key)
    if (!parsed.root || parsed.diagnostics.length > 0) {
        return rejected('invalid-stylesheet', '现有样式表语法无效，不能建立受管规则。')
    }
    let target: ManagedRuleTarget
    try {
        target = managedRuleTarget(nodeId, nodeKind, channel, semanticPart)
    } catch (error) {
        return rejected(
            'managed-rule-target-unsupported',
            error instanceof Error ? error.message : '目标语义部位不支持受管样式规则。',
        )
    }
    const layers = parsed.root.nodes.filter(isManagedNodeLayer)
    const rules = layers.flatMap(layer => matchingRules(layer, target))
    const declarations = rules.flatMap(rule =>
        (rule.nodes ?? []).filter(
            (node): node is Declaration =>
                node.type === 'decl' && propertyName(node.prop) === property,
        ),
    )
    if (declarations.some(declaration => declaration.important)) {
        return rejected(
            'managed-important-declaration',
            '目标受管声明包含 !important，当前操作不能无损改变其优先级。',
        )
    }
    if (value === null) {
        if (declarations.length === 0) return {status: 'unchanged'}
        const removableRules = new Set(
            rules.filter(rule => ruleContainsOnlyPropertyDeclarations(rule, property)),
        )
        const removableMedia = new Set<AtRule>()
        for (const rule of removableRules) {
            const parent = rule.parent
            if (
                parent?.type === 'atrule' &&
                parent.name.toLowerCase() === 'media' &&
                parent.nodes.length > 0 &&
                parent.nodes.every(node => node.type === 'rule' && removableRules.has(node))
            ) {
                removableMedia.add(parent)
            }
        }
        const removableLayers = new Set(
            layers.filter(layer => {
                const nodes = layer.nodes ?? []
                return (
                    nodes.length > 0 &&
                    nodes.every(
                        node =>
                            (node.type === 'rule' && removableRules.has(node)) ||
                            (node.type === 'atrule' && removableMedia.has(node)),
                    ) &&
                    isWriterCreatedManagedLayer(layer)
                )
            }),
        )
        const patches = [
            ...[...removableLayers].map(layer => removeWriterCreatedLayerPatch(document, layer)),
            ...[...removableMedia]
                .filter(media => !removableLayers.has(media.parent as AtRule))
                .map(media => removeNodePatch(document, media)),
            ...rules
                .filter(
                    rule =>
                        !removableMedia.has(rule.parent as AtRule) &&
                        !removableLayers.has(managedLayerForNode(rule) as AtRule),
                )
                .flatMap(rule => {
                    if (removableRules.has(rule)) return [removeNodePatch(document, rule)]
                    return (rule.nodes ?? [])
                        .filter(
                            (node): node is Declaration =>
                                node.type === 'decl' && propertyName(node.prop) === property,
                        )
                        .map(declaration => removeDeclarationPatch(document, declaration))
                }),
        ]
        if (patches.some(patch => patch === null)) {
            return rejected('source-location-missing', '无法定位待清除的受管声明。')
        }
        return ready(patches.filter((patch): patch is SourcePatch => patch !== null))
    }

    if (options.forceWinningWrite && declarations.length > 0) {
        const removals = declarations.map(declaration =>
            removeDeclarationPatch(document, declaration),
        )
        if (removals.some(patch => patch === null)) {
            return rejected('source-location-missing', '无法定位待重新确立的受管声明。')
        }
        const layer = layers.at(-1)
        if (!layer) {
            return rejected('managed-layer-missing', '无法在缺失的 fc-node 层中重新确立声明。')
        }
        const at = closingBraceOffset(document.content, layer)
        if (at === null) return rejected('source-location-missing', '无法定位 fc-node layer 结尾。')
        return ready([
            ...removals.filter((patch): patch is SourcePatch => patch !== null),
            insertionPatch(document, at, renderRule(target, property, value, '  ')),
        ])
    }

    const retained = declarations.at(-1)
    if (retained) {
        if (retained.value === value) return {status: 'unchanged'}
        const conditionalBoundary = firstConditionalBoundary(layers)
        const retainedAt = retained.source?.start?.offset
        if (
            target.media === null &&
            conditionalBoundary &&
            retainedAt !== undefined &&
            retainedAt > conditionalBoundary.at
        ) {
            const removals = declarations.map(declaration =>
                removeDeclarationPatch(document, declaration),
            )
            if (removals.some(patch => patch === null)) {
                return rejected('source-location-missing', '无法定位顺序错误的基础声明。')
            }
            return ready([
                ...removals.filter((patch): patch is SourcePatch => patch !== null),
                insertionPatch(
                    document,
                    conditionalBoundary.at,
                    renderRule(target, property, value, conditionalBoundary.indent),
                ),
            ])
        }
        const patch = replaceDeclarationValuePatch(document, retained, value)
        return patch ? ready([patch]) : rejected('source-location-missing', '无法定位声明值。')
    }

    const rule = rules.at(-1)
    if (rule) {
        const at = closingBraceOffset(document.content, rule)
        if (at === null) return rejected('source-location-missing', '无法定位受管规则结尾。')
        const insertion = declarationInsertion(document.content, rule, property, value)
        return ready([insertionPatch(document, at, insertion)])
    }
    const layer = layers.at(-1)
    if (layer) {
        const conditionalBoundary = target.media === null ? firstConditionalBoundary(layers) : null
        if (conditionalBoundary) {
            return ready([
                insertionPatch(
                    document,
                    conditionalBoundary.at,
                    renderRule(target, property, value, conditionalBoundary.indent),
                ),
            ])
        }
        const at = closingBraceOffset(document.content, layer)
        if (at === null) return rejected('source-location-missing', '无法定位 fc-node layer 结尾。')
        return ready([insertionPatch(document, at, renderRule(target, property, value, '  '))])
    }
    const separator = document.content.length === 0 ? '' : '\n'
    return ready([
        insertionPatch(
            document,
            document.content.length,
            `${separator}@layer fc-node {${renderRule(target, property, value, '  ')}\n}\n`,
        ),
    ])
}

function firstConditionalBoundary(
    layers: readonly AtRule[],
): {readonly at: number; readonly indent: string} | null {
    const candidates = layers.flatMap(layer =>
        (layer.nodes ?? []).flatMap(node => {
            if (node.type !== 'atrule') return []
            const at = node.source?.start?.offset
            if (at === undefined) return []
            const before = node.raws.before ?? ''
            const indent = before.slice(before.lastIndexOf('\n') + 1) || '  '
            return [{at, indent}]
        }),
    )
    return candidates.reduce<(typeof candidates)[number] | null>(
        (current, candidate) => (!current || candidate.at < current.at ? candidate : current),
        null,
    )
}

function isManagedNodeLayer(node: Node): node is AtRule {
    if (node.type !== 'atrule') return false
    const atRule = node as AtRule
    return (
        atRule.name.toLowerCase() === 'layer' &&
        atRule.params.trim() === 'fc-node' &&
        Array.isArray(atRule.nodes)
    )
}

function managedLayerForNode(node: Node): AtRule | null {
    let parent = node.parent
    while (parent) {
        if (isManagedNodeLayer(parent)) return parent
        parent = parent.parent
    }
    return null
}

function isWriterCreatedManagedLayer(layer: AtRule): boolean {
    // 新建 layer 的模板在末节点后留双换行；向已有空 layer 写入时只留单换行。
    // 只回收前一种形态，避免把作者原本保留的空 layer 一并抹去。
    return ((layer.raws.after ?? '').match(/\n/gu) ?? []).length >= 2
}

function matchingRules(layer: AtRule, target: ManagedRuleTarget): Rule[] {
    const candidates: Rule[] = []
    for (const node of layer.nodes ?? []) {
        if (target.media) {
            if (
                node.type !== 'atrule' ||
                node.name.toLowerCase() !== 'media' ||
                normalizeManagedCondition(node.params) !== normalizeManagedCondition(target.media)
            ) {
                continue
            }
            for (const child of node.nodes ?? []) {
                if (child.type === 'rule' && child.selector.trim() === target.selector) {
                    candidates.push(child)
                }
            }
        } else if (node.type === 'rule' && node.selector.trim() === target.selector) {
            candidates.push(node)
        }
    }
    return candidates
}

function replaceDeclarationValuePatch(
    document: SourceDocument,
    declaration: Declaration,
    value: string,
): SourcePatch | null {
    const start = declaration.source?.start?.offset
    if (start === undefined) return null
    const rawValue = declaration.raws.value?.raw ?? declaration.value
    const from = start + declaration.prop.length + (declaration.raws.between ?? ':').length
    return Object.freeze({
        source: document.key,
        range: utf16Range(from, from + rawValue.length),
        expected: rawValue,
        insert: value,
    })
}

function removeDeclarationPatch(
    document: SourceDocument,
    declaration: Declaration,
): SourcePatch | null {
    const start = declaration.source?.start?.offset
    const end = declaration.source?.end?.offset
    if (start === undefined || end === undefined) return null
    let to = end
    if (document.content[to] === ';') to += 1
    return Object.freeze({
        source: document.key,
        range: utf16Range(start, to),
        expected: document.content.slice(start, to),
        insert: '',
    })
}

function ruleContainsOnlyPropertyDeclarations(rule: Rule, property: string): boolean {
    const nodes = rule.nodes ?? []
    return (
        nodes.length > 0 &&
        nodes.every(node => node.type === 'decl' && propertyName(node.prop) === property)
    )
}

function removeNodePatch(document: SourceDocument, node: AtRule | Rule): SourcePatch | null {
    const start = node.source?.start?.offset
    const end = node.source?.end?.offset
    if (start === undefined || end === undefined) return null
    const before = node.raws.before ?? ''
    const ownedPrefixLength = ownedInsertionPrefixLength(before)
    const from = start - ownedPrefixLength
    if (from < 0) return null
    const siblings = node.parent?.nodes ?? []
    const ownsTrailingLineBreak = siblings.at(-1) === node || ownedPrefixLength < before.length
    const to = end + (ownsTrailingLineBreak ? lineBreakLengthAt(document.content, end) : 0)
    return Object.freeze({
        source: document.key,
        range: utf16Range(from, to),
        expected: document.content.slice(from, to),
        insert: '',
    })
}

function removeWriterCreatedLayerPatch(
    document: SourceDocument,
    layer: AtRule,
): SourcePatch | null {
    const start = layer.source?.start?.offset
    const end = layer.source?.end?.offset
    if (start === undefined || end === undefined) return null
    // 新建模板只拥有紧邻 layer 的一个 LF；更早的换行属于写入前源码，不能随 layer 回收。
    const from = start > 0 && document.content[start - 1] === '\n' ? start - 1 : start
    const to = end + lineBreakLengthAt(document.content, end)
    return Object.freeze({
        source: document.key,
        range: utf16Range(from, to),
        expected: document.content.slice(from, to),
        insert: '',
    })
}

function ownedInsertionPrefixLength(before: string): number {
    const lf = before.lastIndexOf('\n')
    if (lf >= 0) return before.length - (lf > 0 && before[lf - 1] === '\r' ? lf - 1 : lf)
    const cr = before.lastIndexOf('\r')
    return cr >= 0 ? before.length - cr : before.length
}

function lineBreakLengthAt(source: string, at: number): number {
    if (source.startsWith('\r\n', at)) return 2
    return source[at] === '\n' || source[at] === '\r' ? 1 : 0
}

function closingBraceOffset(source: string, node: AtRule | Rule): number | null {
    const end = node.source?.end?.offset
    if (end === undefined) return null
    return source[end - 1] === '}' ? end - 1 : null
}

function declarationInsertion(source: string, rule: Rule, property: string, value: string): string {
    const closing = closingBraceOffset(source, rule)
    if (closing === null) return `\n  ${property}: ${value};\n`
    const lineStart = source.lastIndexOf('\n', closing - 1) + 1
    const braceIndent = source.slice(lineStart, closing).match(/^\s*/u)?.[0] ?? ''
    return `\n${braceIndent}  ${property}: ${value};\n${braceIndent}`
}

function renderRule(
    target: ManagedRuleTarget,
    property: string,
    value: string,
    indent: string,
): string {
    if (target.media) {
        return `\n${indent}@media ${target.media} {\n${indent}  ${target.selector} {\n${indent}    ${property}: ${value};\n${indent}  }\n${indent}}\n`
    }
    return `\n${indent}${target.selector} {\n${indent}  ${property}: ${value};\n${indent}}\n`
}

function insertionPatch(document: SourceDocument, at: number, insert: string): SourcePatch {
    return Object.freeze({
        source: document.key,
        range: utf16Range(at, at),
        expected: '',
        insert,
    })
}

function ready(patches: readonly SourcePatch[]): ManagedRulePatchResult {
    return Object.freeze({status: 'ready', patches: Object.freeze(patches)})
}

function rejected(code: string, message: string): ManagedRulePatchResult {
    return Object.freeze({status: 'rejected', code, message})
}
