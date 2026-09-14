// 本模块只分析 CSS 整理机会并生成分级计划；它不修改源码，也不把复杂作者样式降级为可视预设。
import postcss, {type AtRule, type ChildNode, type Declaration, type Root, type Rule} from 'postcss'
import {ENTRY_DESKTOP_MEDIA_QUERY, type DocumentDiagnostic, type SourceRange} from '../contract.ts'
import {
    browserSafeCssPrefixEnd,
    cssNodeRange,
    parseCssSource,
    type CssAuthorScope,
} from './cssParser.ts'
import {getAttribute, type ParsedHtmlSource} from './htmlParser.ts'
import {cssMediaMatches, cssPropertyName, managedCssRuleContext} from './managedCssContext.ts'
import {parseManagedNodeSelector} from './managedNodeSelector.ts'
import {parseManagedNodeConditionalSelector} from './managedStyleContext.ts'
import {collectThemeCleanupCandidates} from './cssThemeCleanupAnalysis.ts'

export {VISUAL_THEME_TOKEN_NAMES} from './cssThemeCleanupAnalysis.ts'

export type CssCleanupDisposition = 'automatic' | 'confirmation' | 'preserve' | 'repair'

export type CssCleanupFindingCode =
    | 'browser-incompatible-string'
    | 'invalid-css-contract'
    | 'empty-css-block'
    | 'duplicate-css-rule'
    | 'duplicate-css-declaration'
    | 'orphan-managed-node-rule'
    | 'orphan-managed-node-selector'
    | 'duplicate-theme-token'
    | 'competing-theme-token'
    | 'source-only-managed-rule'

export interface CssCleanupFinding {
    id: string
    code: CssCleanupFindingCode
    disposition: CssCleanupDisposition
    message: string
    ranges: SourceRange[]
    layer?: string
    selectors?: string[]
    nodeIds?: string[]
    properties?: string[]
}

export interface CssCleanupSummary {
    automatic: number
    confirmation: number
    preserve: number
    repair: number
    total: number
}

export interface CssCleanupAnalysis {
    findings: CssCleanupFinding[]
    diagnostics: DocumentDiagnostic[]
    summary: CssCleanupSummary
    browserSafePrefixEnd: number
    canApplyAutomaticCleanup: boolean
}

export interface CssCleanupAnalysisInput {
    styleCss: string
    scope: CssAuthorScope
    /** 必须来自已经完成模板合并的真实文档；省略时不推断孤儿节点。 */
    liveManagedNodeIds?: ReadonlySet<string>
    /** 词条作用域用它识别会压过标准主题面板的根选择器。 */
    entryId?: string
}

type CssContainerNode = Rule | AtRule

function findingId(code: CssCleanupFindingCode, ranges: readonly SourceRange[]): string {
    const first = ranges[0]
    return `${code}:${first?.from ?? -1}:${first?.to ?? -1}`
}

function finding(
    code: CssCleanupFindingCode,
    disposition: CssCleanupDisposition,
    message: string,
    ranges: SourceRange[],
    details: Omit<CssCleanupFinding, 'id' | 'code' | 'disposition' | 'message' | 'ranges'> = {},
): CssCleanupFinding {
    return {
        id: findingId(code, ranges),
        code,
        disposition,
        message,
        ranges,
        ...details,
    }
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

function isContainerNode(node: ChildNode): node is CssContainerNode {
    return node.type === 'rule' || (node.type === 'atrule' && node.nodes !== undefined)
}

function isSemanticallyEmpty(node: CssContainerNode): boolean {
    if (!node.nodes) return false
    return node.nodes.every(child => isContainerNode(child) && isSemanticallyEmpty(child))
}

function rangeWithinPrefix(node: ChildNode | Root, safePrefixEnd: number): SourceRange | undefined {
    const range = cssNodeRange(node)
    return range && range.to <= safePrefixEnd ? range : undefined
}

function rangeCovered(range: SourceRange, covered: readonly SourceRange[]): boolean {
    return covered.some(candidate => candidate.from <= range.from && candidate.to >= range.to)
}

function directDeclarationSignature(declaration: Declaration): string {
    return JSON.stringify([
        cssPropertyName(declaration.prop),
        declaration.value.trim(),
        declaration.important,
    ])
}

function exactRuleSignature(rule: Rule): string | null {
    if (rule.nodes.length === 0 || rule.nodes.some(node => node.type !== 'decl')) return null
    return JSON.stringify([
        rule.selector.trim(),
        rule.nodes.map(node => directDeclarationSignature(node as Declaration)),
    ])
}

function walkContainers(
    node: ChildNode | Root,
    visitor: (node: Rule | AtRule | Root, nodes: ChildNode[]) => void,
): void {
    if (node.type === 'decl' || node.type === 'comment' || !Array.isArray(node.nodes)) return
    visitor(node, node.nodes)
    node.nodes.forEach(child => walkContainers(child, visitor))
}

function collectEmptyBlocks(
    nodes: readonly ChildNode[],
    safePrefixEnd: number,
    findings: CssCleanupFinding[],
    covered: SourceRange[],
): void {
    nodes.forEach(node => {
        if (!isContainerNode(node)) return
        const range = rangeWithinPrefix(node, safePrefixEnd)
        if (range && isSemanticallyEmpty(node)) {
            findings.push(
                finding(
                    'empty-css-block',
                    'automatic',
                    node.type === 'rule'
                        ? `空规则 ${node.selector} 不产生样式，可以安全移除。`
                        : `空 @${node.name} 块不产生样式，可以安全移除。`,
                    [range],
                    {layer: nearestLayerName(node)},
                ),
            )
            covered.push(range)
            return
        }
        if (node.nodes) collectEmptyBlocks(node.nodes, safePrefixEnd, findings, covered)
    })
}

function collectOrphanManagedSelectors(
    root: Root,
    safePrefixEnd: number,
    liveManagedNodeIds: ReadonlySet<string> | undefined,
    findings: CssCleanupFinding[],
    covered: SourceRange[],
): void {
    if (!liveManagedNodeIds) return
    const liveIds = new Set([...liveManagedNodeIds].map(nodeId => nodeId.toLowerCase()))
    root.walkRules((rule: Rule) => {
        const range = rangeWithinPrefix(rule, safePrefixEnd)
        if (!range || rangeCovered(range, covered) || nearestLayerName(rule) !== 'fc-node') return
        const selectors = postcss.list.comma(rule.selector)
        const media = managedCssRuleContext(rule)?.media?.params ?? null
        const identities = selectors.map(
            selector =>
                parseManagedNodeSelector(selector) ??
                parseManagedNodeConditionalSelector(selector, media),
        )
        const orphanSelectors = selectors.filter((_, index) => {
            const identity = identities[index]
            return identity !== null && !liveIds.has(identity.nodeId)
        })
        if (orphanSelectors.length === 0) return
        const nodeIds = [
            ...new Set(
                identities
                    .filter(identity => identity && !liveIds.has(identity.nodeId))
                    .map(identity => identity!.nodeId),
            ),
        ]
        if (
            orphanSelectors.length === selectors.length &&
            identities.every(identity => identity !== null)
        ) {
            findings.push(
                finding(
                    'orphan-managed-node-rule',
                    'automatic',
                    '这条 fc-node 规则只指向当前合并文档中不存在的节点，可以整条移除。',
                    [range],
                    {layer: 'fc-node', selectors, nodeIds},
                ),
            )
            covered.push(range)
            return
        }
        findings.push(
            finding(
                'orphan-managed-node-selector',
                'automatic',
                '选择器列表中有精确指向已不存在节点的分支；可只移除这些分支并保留其余规则。',
                [range],
                {layer: 'fc-node', selectors: orphanSelectors, nodeIds},
            ),
        )
    })
}

function collectDuplicateRules(
    root: Root,
    safePrefixEnd: number,
    findings: CssCleanupFinding[],
    covered: SourceRange[],
): void {
    walkContainers(root, (_container, nodes) => {
        for (let index = 1; index < nodes.length; index += 1) {
            const previous = nodes[index - 1]
            const current = nodes[index]
            if (previous.type !== 'rule' || current.type !== 'rule') continue
            const range = rangeWithinPrefix(current, safePrefixEnd)
            if (
                !range ||
                rangeCovered(range, covered) ||
                exactRuleSignature(previous) === null ||
                exactRuleSignature(previous) !== exactRuleSignature(current)
            )
                continue
            findings.push(
                finding(
                    'duplicate-css-rule',
                    'automatic',
                    `相邻规则 ${current.selector} 的声明完全相同，后一条可以安全移除。`,
                    [range],
                    {layer: nearestLayerName(current), selectors: [current.selector]},
                ),
            )
            covered.push(range)
        }
    })
}

function collectDuplicateDeclarations(
    root: Root,
    safePrefixEnd: number,
    findings: CssCleanupFinding[],
    covered: SourceRange[],
): void {
    walkContainers(root, (_container, nodes) => {
        const declarations = nodes.filter((node): node is Declaration => node.type === 'decl')
        const groups = new Map<string, Declaration[]>()
        declarations.forEach(declaration => {
            const signature = directDeclarationSignature(declaration)
            groups.set(signature, [...(groups.get(signature) ?? []), declaration])
        })
        groups.forEach(group => {
            group.slice(0, -1).forEach(declaration => {
                const range = rangeWithinPrefix(declaration, safePrefixEnd)
                if (!range || rangeCovered(range, covered)) return
                const property = cssPropertyName(declaration.prop)
                findings.push(
                    finding(
                        'duplicate-css-declaration',
                        'automatic',
                        `${property} 在同一规则中以相同值重复声明；保留最后一处即可。`,
                        [range],
                        {layer: nearestLayerName(declaration), properties: [property]},
                    ),
                )
                covered.push(range)
            })
        })
    })
}

function collectSourceOnlyManagedRules(
    root: Root,
    safePrefixEnd: number,
    findings: CssCleanupFinding[],
    covered: readonly SourceRange[],
): void {
    root.walkRules((rule: Rule) => {
        if (!/data-fc-node-id/iu.test(rule.selector)) return
        const range = rangeWithinPrefix(rule, safePrefixEnd)
        if (!range || rangeCovered(range, covered)) return
        const selectors = postcss.list.comma(rule.selector)
        const context = managedCssRuleContext(rule)
        const identity =
            selectors.length === 1
                ? (parseManagedNodeSelector(selectors[0]) ??
                  parseManagedNodeConditionalSelector(selectors[0], context?.media?.params ?? null))
                : null
        const standardContext =
            context?.layer.params.trim() === 'fc-node' &&
            (parseManagedNodeConditionalSelector(
                selectors[0] ?? '',
                context.media?.params ?? null,
            ) !== null ||
                !context.media ||
                cssMediaMatches(context.media.params, ENTRY_DESKTOP_MEDIA_QUERY))
        if (identity && standardContext) return
        findings.push(
            finding(
                'source-only-managed-rule',
                'preserve',
                '该托管节点规则使用后代/状态选择器、选择器列表或自定义条件；自动整理必须原样保留。',
                [range],
                {layer: nearestLayerName(rule), selectors},
            ),
        )
    })
}

function summarize(findings: readonly CssCleanupFinding[]): CssCleanupSummary {
    const summary: CssCleanupSummary = {
        automatic: 0,
        confirmation: 0,
        preserve: 0,
        repair: 0,
        total: findings.length,
    }
    findings.forEach(item => {
        summary[item.disposition] += 1
    })
    return summary
}

/** 从已经完成模板合并的 HTML 读取真实节点身份；不要把项目模板和词条补丁简单相加。 */
export function collectLiveManagedNodeIds(parsedHtml: ParsedHtmlSource): Set<string> {
    return new Set(
        parsedHtml.elements
            .map(element => getAttribute(element, 'data-fc-node-id')?.toLowerCase())
            .filter((nodeId): nodeId is string => Boolean(nodeId)),
    )
}

export function analyzeCssCleanup(input: CssCleanupAnalysisInput): CssCleanupAnalysis {
    const parsed = parseCssSource(input.styleCss, input.scope)
    const safePrefixEnd = browserSafeCssPrefixEnd(input.styleCss)
    const findings: CssCleanupFinding[] = []
    const covered: SourceRange[] = []

    if (safePrefixEnd < input.styleCss.length) {
        const range = {from: safePrefixEnd, to: Math.min(safePrefixEnd + 1, input.styleCss.length)}
        findings.push(
            finding(
                'browser-incompatible-string',
                'repair',
                'CSS 字符串中含浏览器不接受的原始换行；必须先修复损坏边界，再应用任何自动清理。',
                [range],
            ),
        )
    }
    parsed.diagnostics
        .filter(diagnostic => diagnostic.severity === 'error')
        .forEach(diagnostic => {
            const ranges = diagnostic.range ? [diagnostic.range] : []
            findings.push(
                finding('invalid-css-contract', 'repair', diagnostic.message, ranges, {
                    properties: [diagnostic.code],
                }),
            )
        })

    if (parsed.root) {
        collectEmptyBlocks(parsed.root.nodes, safePrefixEnd, findings, covered)
        collectOrphanManagedSelectors(
            parsed.root,
            safePrefixEnd,
            input.liveManagedNodeIds,
            findings,
            covered,
        )
        collectDuplicateRules(parsed.root, safePrefixEnd, findings, covered)
        collectThemeCleanupCandidates(
            parsed.root,
            input.scope,
            input.entryId,
            safePrefixEnd,
            covered,
        ).forEach(candidate => {
            findings.push(
                finding(
                    candidate.code,
                    candidate.disposition,
                    candidate.message,
                    candidate.ranges,
                    {
                        layer: candidate.layer,
                        selectors: candidate.selectors,
                        properties: candidate.properties,
                    },
                ),
            )
            if (candidate.disposition === 'automatic') covered.push(...candidate.ranges)
        })
        collectDuplicateDeclarations(parsed.root, safePrefixEnd, findings, covered)
        collectSourceOnlyManagedRules(parsed.root, safePrefixEnd, findings, covered)
    }

    findings.sort((left, right) => {
        const byRange = (left.ranges[0]?.from ?? -1) - (right.ranges[0]?.from ?? -1)
        return byRange || left.code.localeCompare(right.code)
    })
    const idOccurrences = new Map<string, number>()
    findings.forEach(item => {
        const occurrence = idOccurrences.get(item.id) ?? 0
        idOccurrences.set(item.id, occurrence + 1)
        if (occurrence > 0) item.id = `${item.id}:${occurrence}`
    })
    const summary = summarize(findings)
    return {
        findings,
        diagnostics: parsed.diagnostics,
        summary,
        browserSafePrefixEnd: safePrefixEnd,
        canApplyAutomaticCleanup:
            summary.repair === 0 && !parsed.diagnostics.some(item => item.severity === 'error'),
    }
}
