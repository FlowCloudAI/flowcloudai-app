// 本模块在组合后的 parse5 树上匹配选择器；只解释冻结上下文可证明的伪类，其余条件返回不确定而非猜测。

import {is as selectorMatches, type Options} from 'css-select'
import {parse, SelectorType, stringify, type Selector} from 'css-what'
import postcss from 'postcss'
import type {DefaultTreeAdapterTypes} from 'parse5'
import type {HtmlComposition, HtmlCompositionElement} from '../composition/index.ts'
import type {ReadContext} from '../contracts/context.ts'

export type SelectorCondition = 'active' | 'inactive' | 'not-matched' | 'indeterminate'

export interface SelectorBranchMatchResult {
    readonly selector: string
    readonly condition: SelectorCondition
    readonly specificity: number
    readonly reason: string | null
}

export interface SelectorMatchResult {
    readonly condition: SelectorCondition
    readonly specificity: number
    readonly reason: string | null
    /** 选择器列表各分支必须独立参与级联；汇总结论只供状态展示。 */
    readonly branches: readonly SelectorBranchMatchResult[]
}

type HtmlNode = DefaultTreeAdapterTypes.Node
type SourceSelectorAdapter = NonNullable<Options<HtmlNode, HtmlCompositionElement>['adapter']>

const STRUCTURAL_PSEUDOS = new Set([
    'root',
    'empty',
    'first-child',
    'last-child',
    'only-child',
    'first-of-type',
    'last-of-type',
    'only-of-type',
    'nth-child',
    'nth-last-child',
    'nth-of-type',
    'nth-last-of-type',
    'scope',
])
const SELECTOR_PSEUDOS = new Set(['is', 'where', 'not', 'has'])
const NTH_OF_PSEUDOS = new Set(['nth-child', 'nth-last-child'])
const NTH_OF_PATTERN = /^(.+?)\s+of\s+(.+)$/isu

export interface SelectorEnvironment {
    match(
        selector: string,
        element: HtmlCompositionElement,
        context: ReadContext,
    ): SelectorMatchResult
}

export function createSelectorEnvironment(composition: HtmlComposition): SelectorEnvironment {
    const adapter = createAdapter(composition.root)
    return Object.freeze({
        match: (selector: string, element: HtmlCompositionElement, context: ReadContext) =>
            matchSelector(selector, element, context, adapter),
    })
}

function matchSelector(
    selector: string,
    element: HtmlCompositionElement,
    context: ReadContext,
    adapter: SourceSelectorAdapter,
): SelectorMatchResult {
    const branches = postcss.list.comma(selector)
    const matches: SelectorBranchMatchResult[] = []
    for (const branch of branches) {
        const specificity = selectorSpecificity(branch)
        const prepared = prepareRuntimeSuffixes(branch, context)
        if (prepared.condition === 'inactive') {
            matches.push(
                matchesParsed(prepared.selector, element, adapter)
                    ? {
                          selector: branch,
                          condition: 'inactive',
                          specificity,
                          reason: '选择器在当前交互状态下未激活。',
                      }
                    : {
                          selector: branch,
                          condition: 'not-matched',
                          specificity,
                          reason: null,
                      },
            )
            continue
        }
        let tokens: ReturnType<typeof parse>
        try {
            tokens = parse(prepared.selector)
        } catch {
            matches.push({
                selector: branch,
                condition: 'indeterminate',
                specificity,
                reason: '选择器无法解析。',
            })
            continue
        }
        if (containsPseudoElement(tokens)) {
            matches.push({
                selector: branch,
                condition: 'not-matched',
                specificity,
                reason: null,
            })
            continue
        }
        if (hasUnknownRuntimeCondition(tokens)) {
            matches.push(
                matchesPotential(tokens, element, adapter)
                    ? {
                          selector: branch,
                          condition: 'indeterminate',
                          specificity,
                          reason: '选择器依赖当前解释器未建模的运行时条件。',
                      }
                    : {
                          selector: branch,
                          condition: 'not-matched',
                          specificity,
                          reason: null,
                      },
            )
            continue
        }
        matches.push({
            selector: branch,
            condition: matchesTokens(tokens, element, adapter) ? 'active' : 'not-matched',
            specificity,
            reason: null,
        })
    }
    return summarizeBranchMatches(matches)
}

function summarizeBranchMatches(
    branches: readonly SelectorBranchMatchResult[],
): SelectorMatchResult {
    for (const condition of ['active', 'indeterminate', 'inactive'] as const) {
        const matching = branches.filter(branch => branch.condition === condition)
        if (matching.length === 0) continue
        const strongest = matching.reduce((current, branch) =>
            branch.specificity > current.specificity ? branch : current,
        )
        return {
            condition,
            specificity: strongest.specificity,
            reason: strongest.reason,
            branches: Object.freeze([...branches]),
        }
    }
    return {
        condition: 'not-matched',
        specificity: 0,
        reason: null,
        branches: Object.freeze([...branches]),
    }
}

function prepareRuntimeSuffixes(
    source: string,
    context: ReadContext,
): {selector: string; condition: 'active' | 'inactive'} {
    let selector = source.trim()
    let active = true
    const suffixes = [
        {pattern: /:where\(\s*:hover\s*\)\s*$/iu, enabled: context.interactions.hover},
        {pattern: /:hover\s*$/iu, enabled: context.interactions.hover},
        {
            pattern: /:focus-within\s*$/iu,
            enabled: context.interactions.focusWithin,
        },
    ]
    let changed = true
    while (changed) {
        changed = false
        for (const suffix of suffixes) {
            if (!suffix.pattern.test(selector)) continue
            selector = selector.replace(suffix.pattern, '').trim()
            active &&= suffix.enabled
            changed = true
            break
        }
    }
    return {selector: selector || '*', condition: active ? 'active' : 'inactive'}
}

function createAdapter(root: HtmlComposition['root']): SourceSelectorAdapter {
    const parents = new Map<HtmlNode, HtmlNode>()
    const visit = (node: HtmlNode): void => {
        for (const child of childrenOf(node)) {
            parents.set(child, node)
            visit(child)
        }
    }
    visit(root)
    const getParent = (node: HtmlNode): HtmlNode | null =>
        parents.get(node) ?? ('parentNode' in node ? node.parentNode : null)
    return {
        isTag: isElement,
        getAttributeValue: attribute,
        getChildren: childrenOf,
        getName: element => element.tagName,
        getParent,
        getSiblings: node => {
            const parent = getParent(node)
            return parent ? childrenOf(parent) : [node]
        },
        getText: nodeText,
        hasAttrib: (element, name) => attribute(element, name) !== undefined,
        removeSubsets: nodes =>
            nodes.filter((node, index) => {
                if (nodes.indexOf(node) !== index) return false
                for (let parent = getParent(node); parent; parent = getParent(parent)) {
                    if (nodes.includes(parent)) return false
                }
                return true
            }),
    }
}

function matchesParsed(
    selector: string,
    element: HtmlCompositionElement,
    adapter: SourceSelectorAdapter,
): boolean {
    try {
        return matchesTokens(parse(selector), element, adapter)
    } catch {
        return false
    }
}

function matchesTokens(
    selectors: ReturnType<typeof parse>,
    element: HtmlCompositionElement,
    adapter: SourceSelectorAdapter,
): boolean {
    try {
        return selectorMatches(element, selectors, {
            adapter,
            relativeSelector: false,
            cacheResults: false,
        })
    } catch {
        return false
    }
}

function matchesPotential(
    selectors: ReturnType<typeof parse>,
    element: HtmlCompositionElement,
    adapter: SourceSelectorAdapter,
): boolean {
    const potential = selectors.map(tokens => potentialSelector(tokens))
    return matchesTokens(potential, element, adapter)
}

function potentialSelector(tokens: readonly Selector[]): Selector[] {
    const result = tokens.flatMap((token): Selector[] => {
        if (token.type !== SelectorType.Pseudo) return [token]
        const nthOf = parseNthOfSelector(token)
        if (nthOf) {
            // 未知过滤条件会改变参与序号计算的兄弟集合；将它放宽为通配符后继续
            // 判断原序号会产生假阴性，因此这里只保留复合选择器中的其余可证明条件。
            if (hasUnknownRuntimeCondition(nthOf.selectors)) return []
            return [
                {
                    ...token,
                    data: `${nthOf.formula} of ${stringify(
                        nthOf.selectors.map(selector => potentialSelector(selector)),
                    )}`,
                },
            ]
        }
        if (Array.isArray(token.data) && SELECTOR_PSEUDOS.has(token.name)) {
            if (token.name === 'not' && token.data.some(hasUnknownRuntimeTokens)) return []
            return [{...token, data: token.data.map(potentialSelector)}]
        }
        return STRUCTURAL_PSEUDOS.has(token.name) ? [token] : []
    })
    return result.length > 0 ? result : [{type: SelectorType.Universal, namespace: null}]
}

function hasUnknownRuntimeCondition(selectors: readonly (readonly Selector[])[]): boolean {
    return selectors.some(hasUnknownRuntimeTokens)
}

function hasUnknownRuntimeTokens(tokens: readonly Selector[]): boolean {
    return tokens.some(token => {
        if (token.type !== SelectorType.Pseudo) return false
        const nthOf = parseNthOfSelector(token)
        if (nthOf) return hasUnknownRuntimeCondition(nthOf.selectors)
        if (!STRUCTURAL_PSEUDOS.has(token.name) && !SELECTOR_PSEUDOS.has(token.name)) return true
        return Array.isArray(token.data) && hasUnknownRuntimeCondition(token.data)
    })
}

function containsPseudoElement(selectors: readonly (readonly Selector[])[]): boolean {
    return selectors.some(tokens =>
        tokens.some(
            token =>
                token.type === SelectorType.PseudoElement ||
                (token.type === SelectorType.Pseudo &&
                    ['before', 'after', 'first-letter', 'first-line'].includes(token.name)),
        ),
    )
}

function selectorSpecificity(selector: string): number {
    try {
        return Math.max(...parse(selector).map(tokens => specificityOfTokens(tokens)))
    } catch {
        return 0
    }
}

function specificityOfTokens(tokens: readonly Selector[]): number {
    let ids = 0
    let classes = 0
    let tags = 0
    for (const token of tokens) {
        if (token.type === SelectorType.Attribute) {
            if (
                token.name.toLowerCase() === 'id' &&
                token.action === 'equals' &&
                token.ignoreCase === 'quirks'
            )
                ids += 1
            else classes += 1
        } else if (token.type === SelectorType.Tag || token.type === SelectorType.PseudoElement) {
            tags += 1
        } else if (token.type === SelectorType.Pseudo) {
            if (token.name === 'where') continue
            if (Array.isArray(token.data) && SELECTOR_PSEUDOS.has(token.name)) {
                const branchSpecificity = Math.max(
                    0,
                    ...token.data.map(branch => specificityOfTokens(branch)),
                )
                ids += Math.floor(branchSpecificity / 1_000_000)
                classes += Math.floor((branchSpecificity % 1_000_000) / 1_000)
                tags += branchSpecificity % 1_000
            } else {
                classes += 1
                const nthOf = parseNthOfSelector(token)
                if (nthOf) {
                    const branchSpecificity = Math.max(
                        0,
                        ...nthOf.selectors.map(branch => specificityOfTokens(branch)),
                    )
                    ids += Math.floor(branchSpecificity / 1_000_000)
                    classes += Math.floor((branchSpecificity % 1_000_000) / 1_000)
                    tags += branchSpecificity % 1_000
                }
            }
        }
    }
    return ids * 1_000_000 + classes * 1_000 + tags
}

function parseNthOfSelector(
    token: Extract<Selector, {type: SelectorType.Pseudo}>,
): {readonly formula: string; readonly selectors: ReturnType<typeof parse>} | null {
    if (!NTH_OF_PSEUDOS.has(token.name) || typeof token.data !== 'string') return null
    const match = NTH_OF_PATTERN.exec(token.data)
    if (!match?.[1] || !match[2]) return null
    try {
        return {formula: match[1].trim(), selectors: parse(match[2].trim())}
    } catch {
        return null
    }
}

function attribute(element: HtmlCompositionElement, name: string): string | undefined {
    return element.attrs.find(item => item.name === name)?.value
}

function isElement(node: HtmlNode): node is HtmlCompositionElement {
    return 'tagName' in node
}

function childrenOf(node: HtmlNode): DefaultTreeAdapterTypes.ChildNode[] {
    if (isElement(node) && node.tagName === 'template' && 'content' in node) {
        return node.content.childNodes
    }
    return 'childNodes' in node ? node.childNodes : []
}

function nodeText(node: HtmlNode): string {
    if ('value' in node && typeof node.value === 'string') return node.value
    if (isElement(node) && node.tagName === 'br') return '\n'
    return childrenOf(node).map(nodeText).join('')
}
