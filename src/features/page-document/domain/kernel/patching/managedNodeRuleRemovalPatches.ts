// 本模块仅回收 fc-node layer 中精确指向已删除组件的独立规则；共享选择器与自定义规则保留。

import {AttributeAction, SelectorType, type Selector} from 'css-what'
import type {AtRule, Node, Rule} from 'postcss'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import {parseSelectorListSyntax, parseStylesheetSyntax} from '../syntax/index.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type ManagedNodeRuleRemovalResult =
    | {readonly status: 'ready'; readonly patches: readonly SourcePatch[]}
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export function createManagedNodeRuleRemovalPatches(
    document: SourceDocument,
    nodeIds: readonly string[],
): ManagedNodeRuleRemovalResult {
    if (document.key.file !== 'style.css') {
        return rejected('managed-rule-source-invalid', '节点样式只能从 style.css 回收。')
    }
    if (nodeIds.length === 0) return {status: 'unchanged'}
    const parsed = parseStylesheetSyntax(document.content, document.key)
    if (!parsed.root || parsed.diagnostics.length > 0) {
        return rejected('invalid-stylesheet', '现有样式表语法无效，不能安全回收组件规则。')
    }
    const targets = new Set(nodeIds.map(value => value.toLowerCase()))
    const rules: Rule[] = []
    parsed.root.walkRules(rule => {
        if (!insideFcNodeLayer(rule)) return
        const id = exactManagedSelectorNodeId(rule.selector, document)
        if (id && targets.has(id)) rules.push(rule)
    })
    if (rules.length === 0) return {status: 'unchanged'}
    const patches: SourcePatch[] = []
    for (const rule of rules) {
        const start = rule.source?.start?.offset
        const end = rule.source?.end?.offset
        if (start === undefined || end === undefined) {
            return rejected('source-location-missing', '无法定位待回收的组件 CSS 规则。')
        }
        patches.push(
            Object.freeze({
                source: document.key,
                range: utf16Range(start, end),
                expected: document.content.slice(start, end),
                insert: '',
            }),
        )
    }
    return Object.freeze({status: 'ready', patches: Object.freeze(patches)})
}

function insideFcNodeLayer(node: Node): boolean {
    let parent = node.parent
    while (parent) {
        if (parent.type === 'atrule') {
            const atRule = parent as AtRule
            if (atRule.name.toLowerCase() === 'layer') return atRule.params.trim() === 'fc-node'
        }
        parent = parent.parent
    }
    return false
}

function exactManagedSelectorNodeId(selector: string, document: SourceDocument): string | null {
    const parsed = parseSelectorListSyntax(selector, document.key)
    if (!parsed.selectors || parsed.selectors.length !== 1) return null
    let id: string | null = null
    let kindSeen = false
    for (const token of parsed.selectors[0]) {
        if (token.type === SelectorType.Attribute) {
            if (
                token.action !== AttributeAction.Equals ||
                token.namespace !== null ||
                token.ignoreCase === true
            ) {
                return null
            }
            const name = token.name.toLowerCase()
            if (name === 'data-fc-node-id' && id === null) id = token.value.toLowerCase()
            else if (name === 'data-fc-node-kind' && !kindSeen) kindSeen = true
            else return null
            continue
        }
        if (token.type !== SelectorType.Pseudo || !isManagedInteractionPseudo(token)) return null
    }
    return id
}

function isManagedInteractionPseudo(
    token: Extract<Selector, {type: SelectorType.Pseudo}>,
): boolean {
    if ((token.name === 'hover' || token.name === 'focus-within') && token.data === null)
        return true
    if (token.name !== 'where' || !Array.isArray(token.data) || token.data.length !== 1)
        return false
    const nested = token.data[0]
    return (
        nested.length === 1 &&
        nested[0].type === SelectorType.Pseudo &&
        (nested[0].name === 'hover' || nested[0].name === 'focus-within') &&
        nested[0].data === null
    )
}

function rejected(code: string, message: string): ManagedNodeRuleRemovalResult {
    return Object.freeze({status: 'rejected', code, message})
}
