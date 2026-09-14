// 本模块只识别主题根选择器与令牌竞争；自定义局部变量不被误当成全局主题清理目标。
import postcss, {type ChildNode, type Declaration, type Root, type Rule} from 'postcss'
import type {SourceRange} from '../contract.ts'
import {cssNodeRange, type CssAuthorScope} from './cssParser.ts'
import {cssPropertyName, managedCssRuleContext} from './managedCssContext.ts'

export const VISUAL_THEME_TOKEN_NAMES = [
    '--fc-entry-surface',
    '--fc-entry-text',
    '--fc-entry-accent',
    '--fc-entry-content-width',
] as const

export interface CssThemeCleanupCandidate {
    code: 'duplicate-theme-token' | 'competing-theme-token'
    disposition: 'automatic' | 'confirmation'
    message: string
    ranges: SourceRange[]
    layer: string
    selectors: string[]
    properties: string[]
}

interface ThemeDeclaration {
    declaration: Declaration
    range: SourceRange
    selector: string
    canonical: boolean
}

function nearestLayerName(node: ChildNode | Root): string | undefined {
    for (
        let current: ChildNode | Root | undefined = node;
        current;
        current = current.parent as ChildNode | Root | undefined
    ) {
        if (current.type === 'atrule' && current.name.toLowerCase() === 'layer') {
            return current.params.trim()
        }
    }
    return undefined
}

function rangeWithinPrefix(node: ChildNode | Root, safePrefixEnd: number): SourceRange | undefined {
    const range = cssNodeRange(node)
    return range && range.to <= safePrefixEnd ? range : undefined
}

function rangeCovered(range: SourceRange, covered: readonly SourceRange[]): boolean {
    return covered.some(candidate => candidate.from <= range.from && candidate.to >= range.to)
}

function declarationSignature(declaration: Declaration): string {
    return JSON.stringify([
        cssPropertyName(declaration.prop),
        declaration.value.trim(),
        declaration.important,
    ])
}

function isSingleCompoundSelector(selector: string): boolean {
    const source = selector.trim()
    let squareDepth = 0
    let parenthesisDepth = 0
    let quote: '"' | "'" | null = null
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index]
        if (quote) {
            if (character === '\\') index += 1
            else if (character === quote) quote = null
            continue
        }
        if (character === '"' || character === "'") {
            quote = character
            continue
        }
        if (character === '[') squareDepth += 1
        else if (character === ']') squareDepth -= 1
        else if (character === '(') parenthesisDepth += 1
        else if (character === ')') parenthesisDepth -= 1
        else if (squareDepth === 0 && parenthesisDepth === 0) {
            if (
                character === '>' ||
                character === '+' ||
                character === '~' ||
                /\s/u.test(character)
            )
                return false
        }
    }
    return squareDepth === 0 && parenthesisDepth === 0 && quote === null
}

function topLevelAttributeBodies(selector: string): string[] {
    const result: string[] = []
    let parenthesisDepth = 0
    let quote: '"' | "'" | null = null
    for (let index = 0; index < selector.length; index += 1) {
        const character = selector[index]
        if (quote) {
            if (character === '\\') index += 1
            else if (character === quote) quote = null
            continue
        }
        if (character === '"' || character === "'") {
            quote = character
            continue
        }
        if (character === '(') {
            parenthesisDepth += 1
            continue
        }
        if (character === ')') {
            parenthesisDepth -= 1
            continue
        }
        if (character !== '[' || parenthesisDepth !== 0) continue
        const start = index + 1
        let attributeQuote: '"' | "'" | null = null
        for (index = start; index < selector.length; index += 1) {
            const attributeCharacter = selector[index]
            if (attributeQuote) {
                if (attributeCharacter === '\\') index += 1
                else if (attributeCharacter === attributeQuote) attributeQuote = null
            } else if (attributeCharacter === '"' || attributeCharacter === "'") {
                attributeQuote = attributeCharacter
            } else if (attributeCharacter === ']') {
                result.push(selector.slice(start, index))
                break
            }
        }
    }
    return result
}

export function selectorTargetsEntryRoot(selector: string, entryId: string): boolean {
    if (!isSingleCompoundSelector(selector)) return false
    return topLevelAttributeBodies(selector).some(body => {
        const match = body.match(
            /^\s*data-fc-entry-id\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?\s*$/iu,
        )
        if (!match) return false
        const value = match[1] ?? match[2] ?? match[3]
        return value === undefined || value.toLowerCase() === entryId.toLowerCase()
    })
}

export function hasTopLevelRootPseudo(selector: string): boolean {
    if (!isSingleCompoundSelector(selector)) return false
    let squareDepth = 0
    let parenthesisDepth = 0
    let quote: '"' | "'" | null = null
    for (let index = 0; index < selector.length; index += 1) {
        const character = selector[index]
        if (quote) {
            if (character === '\\') index += 1
            else if (character === quote) quote = null
            continue
        }
        if (character === '"' || character === "'") {
            quote = character
            continue
        }
        if (character === '\\') {
            index += 1
            continue
        }
        if (character === '[') squareDepth += 1
        else if (character === ']') squareDepth -= 1
        else if (character === '(') parenthesisDepth += 1
        else if (character === ')') parenthesisDepth -= 1
        else if (
            squareDepth === 0 &&
            parenthesisDepth === 0 &&
            selector.slice(index).startsWith(':root')
        ) {
            const next = selector[index + 5]
            return next === undefined || !/[a-z0-9_-]/iu.test(next)
        }
    }
    return false
}

function collectThemeDeclarations(
    root: Root,
    scope: CssAuthorScope,
    entryId: string | undefined,
    safePrefixEnd: number,
    covered: readonly SourceRange[],
): Map<string, ThemeDeclaration[]> {
    const declarations = new Map<string, ThemeDeclaration[]>()
    if (scope === 'entry' && !entryId) return declarations
    const layerName = `fc-${scope}`
    const canonicalSelector =
        scope === 'project' ? ':root' : `[data-fc-entry-id="${entryId!.toLowerCase()}"]`
    root.walkRules((rule: Rule) => {
        const ruleRange = rangeWithinPrefix(rule, safePrefixEnd)
        if (!ruleRange || rangeCovered(ruleRange, covered) || nearestLayerName(rule) !== layerName)
            return
        const selectors = postcss.list.comma(rule.selector)
        const targetsRoot = selectors.some(selector =>
            scope === 'project'
                ? hasTopLevelRootPseudo(selector)
                : selectorTargetsEntryRoot(selector, entryId!),
        )
        if (!targetsRoot) return
        const context = managedCssRuleContext(rule)
        rule.nodes.forEach(node => {
            if (node.type !== 'decl') return
            const property = cssPropertyName(node.prop)
            if (
                !VISUAL_THEME_TOKEN_NAMES.includes(
                    property as (typeof VISUAL_THEME_TOKEN_NAMES)[number],
                )
            )
                return
            const range = rangeWithinPrefix(node, safePrefixEnd)
            if (!range) return
            const canonical =
                selectors.length === 1 &&
                selectors[0].trim() === canonicalSelector &&
                context?.layer.params.trim() === layerName &&
                context.media === null &&
                !node.important
            const current = declarations.get(property) ?? []
            current.push({declaration: node, range, selector: rule.selector, canonical})
            declarations.set(property, current)
        })
    })
    return declarations
}

export function collectThemeCleanupCandidates(
    root: Root,
    scope: CssAuthorScope,
    entryId: string | undefined,
    safePrefixEnd: number,
    covered: readonly SourceRange[],
): CssThemeCleanupCandidate[] {
    const candidates: CssThemeCleanupCandidate[] = []
    for (const [property, declarations] of collectThemeDeclarations(
        root,
        scope,
        entryId,
        safePrefixEnd,
        covered,
    )) {
        if (declarations.length === 1 && declarations[0].canonical) continue
        const equivalentCanonical =
            declarations.length > 1 &&
            declarations.every(item => item.canonical) &&
            declarations.every(
                item =>
                    declarationSignature(item.declaration) ===
                    declarationSignature(declarations.at(-1)!.declaration),
            )
        if (equivalentCanonical) {
            declarations.slice(0, -1).forEach(item => {
                candidates.push({
                    code: 'duplicate-theme-token',
                    disposition: 'automatic',
                    message: `${property} 在标准主题选择器中重复为相同值；保留最后一处即可。`,
                    ranges: [item.range],
                    layer: `fc-${scope}`,
                    selectors: [item.selector],
                    properties: [property],
                })
            })
            continue
        }
        candidates.push({
            code: 'competing-theme-token',
            disposition: 'confirmation',
            message: `${property} 存在非标准选择器、条件上下文或相互竞争的值；归并前必须展示差异并确认。`,
            ranges: declarations.map(item => item.range),
            layer: `fc-${scope}`,
            selectors: [...new Set(declarations.map(item => item.selector))],
            properties: [property],
        })
    }
    return candidates
}
