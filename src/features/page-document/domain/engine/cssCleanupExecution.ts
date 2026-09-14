// 本模块把 CSS 清理分析转成可审阅候选，并以源码前置条件执行；它不持久化，也不接管需确认或源码专属规则。
import postcss, {type Root, type Rule} from 'postcss'
import type {SourceEdit, SourceRange} from '../contract.ts'
import {applySourceEdits, createUtf8SourceEdit} from '../sourceEdits.ts'
import {
    analyzeCssCleanup,
    type CssCleanupAnalysis,
    type CssCleanupAnalysisInput,
    type CssCleanupFinding,
    type CssCleanupFindingCode,
} from './cssCleanupAnalysis.ts'
import {browserSafeCssPrefixEnd, cssNodeRange, parseCssSource} from './cssParser.ts'

const MAX_CLEANUP_PASSES = 32

const WHOLE_NODE_FINDINGS = new Set<CssCleanupFindingCode>([
    'empty-css-block',
    'duplicate-css-rule',
    'orphan-managed-node-rule',
])

const DECLARATION_FINDINGS = new Set<CssCleanupFindingCode>([
    'duplicate-css-declaration',
    'duplicate-theme-token',
])

export type CssCleanupPreviewStatus = 'ready' | 'unchanged' | 'blocked'

export type CssCleanupBlockCode =
    'repair-required' | 'execution-stalled' | 'postcondition-failed' | 'iteration-limit-reached'

export interface CssCleanupAppliedCount {
    code: CssCleanupFindingCode
    count: number
}

export interface CssCleanupBlock {
    code: CssCleanupBlockCode
    message: string
}

export interface CssCleanupPreview {
    /** 宿主应用候选前必须逐字比较；不能用 revision 或长度代替。 */
    baseStyleCss: string
    styleCss: string
    status: CssCleanupPreviewStatus
    changed: boolean
    passes: number
    applied: CssCleanupAppliedCount[]
    initialAnalysis: CssCleanupAnalysis
    remainingAnalysis: CssCleanupAnalysis
    block?: CssCleanupBlock
}

export type CssCleanupApplyReason = 'applied' | 'unchanged' | 'preview-blocked' | 'stale-preview'

export interface CssCleanupApplyResult {
    styleCss: string
    applied: boolean
    reason: CssCleanupApplyReason
    preview: CssCleanupPreview
}

interface CleanupAction {
    range: SourceRange
    insert: string
    finding: CssCleanupFinding
}

function actionPriority(finding: CssCleanupFinding): number {
    if (WHOLE_NODE_FINDINGS.has(finding.code)) return 0
    if (finding.code === 'orphan-managed-node-selector') return 1
    if (DECLARATION_FINDINGS.has(finding.code)) return 2
    return 3
}

function rangesOverlap(left: SourceRange, right: SourceRange): boolean {
    return left.from < right.to && right.from < left.to
}

function findRule(root: Root, target: SourceRange): Rule | null {
    let matched: Rule | null = null
    root.walkRules(rule => {
        const range = cssNodeRange(rule)
        if (range?.from === target.from && range.to === target.to) matched = rule
    })
    return matched
}

function selectorPruneAction(
    root: Root,
    source: string,
    finding: CssCleanupFinding,
): CleanupAction | null {
    const range = finding.ranges[0]
    if (!range || !finding.selectors?.length) return null
    const rule = findRule(root, range)
    if (!rule) return null
    const removed = new Set(finding.selectors.map(selector => selector.trim()))
    const selectors = postcss.list.comma(rule.selector)
    const retained = selectors.filter(selector => !removed.has(selector.trim()))
    if (retained.length === 0 || retained.length === selectors.length) return null

    const replacement = rule.clone()
    replacement.selector = retained.join(', ')
    const insert = replacement.toString()
    if (insert === source.slice(range.from, range.to)) return null
    return {range, insert, finding}
}

function cleanupActionsForPass(
    source: string,
    analysis: CssCleanupAnalysis,
    scope: CssCleanupAnalysisInput['scope'],
): CleanupAction[] {
    const parsed = parseCssSource(source, scope)
    if (!parsed.root || parsed.diagnostics.some(item => item.severity === 'error')) return []

    const candidates: CleanupAction[] = []
    analysis.findings
        .filter(finding => finding.disposition === 'automatic')
        .sort((left, right) => {
            const byPriority = actionPriority(left) - actionPriority(right)
            return byPriority || (left.ranges[0]?.from ?? -1) - (right.ranges[0]?.from ?? -1)
        })
        .forEach(finding => {
            if (finding.code === 'orphan-managed-node-selector') {
                const action = selectorPruneAction(parsed.root!, source, finding)
                if (action) candidates.push(action)
                return
            }
            if (!WHOLE_NODE_FINDINGS.has(finding.code) && !DECLARATION_FINDINGS.has(finding.code))
                return
            finding.ranges.forEach(range => candidates.push({range, insert: '', finding}))
        })

    const selected: CleanupAction[] = []
    candidates.forEach(candidate => {
        if (selected.some(action => rangesOverlap(action.range, candidate.range))) return
        selected.push(candidate)
    })
    return selected.sort((left, right) => left.range.from - right.range.from)
}

function incrementApplied(
    counts: Map<CssCleanupFindingCode, number>,
    actions: readonly CleanupAction[],
): void {
    actions.forEach(action => {
        counts.set(action.finding.code, (counts.get(action.finding.code) ?? 0) + 1)
    })
}

function appliedCounts(
    counts: ReadonlyMap<CssCleanupFindingCode, number>,
): CssCleanupAppliedCount[] {
    return [...counts]
        .map(([code, count]) => ({code, count}))
        .sort((left, right) => left.code.localeCompare(right.code))
}

function blockedPreview(
    input: CssCleanupAnalysisInput,
    initialAnalysis: CssCleanupAnalysis,
    remainingAnalysis: CssCleanupAnalysis,
    passes: number,
    block: CssCleanupBlock,
): CssCleanupPreview {
    return {
        baseStyleCss: input.styleCss,
        styleCss: input.styleCss,
        status: 'blocked',
        changed: false,
        passes,
        applied: [],
        initialAnalysis,
        remainingAnalysis,
        block,
    }
}

/**
 * 生成仅包含 automatic 项的完整候选。任何一步失去源码位置、产生非法 CSS 或无法收敛时，
 * 都回退到原始字符串；confirmation / preserve 项只留在分析结果中供界面解释。
 */
export function createAutomaticCssCleanupPreview(
    input: CssCleanupAnalysisInput,
): CssCleanupPreview {
    const initialAnalysis = analyzeCssCleanup(input)
    const counts = new Map<CssCleanupFindingCode, number>()
    if (!initialAnalysis.canApplyAutomaticCleanup) {
        return blockedPreview(input, initialAnalysis, initialAnalysis, 0, {
            code: 'repair-required',
            message: 'CSS 存在损坏边界或阻断诊断，修复前不会生成自动清理候选。',
        })
    }

    let styleCss = input.styleCss
    let analysis = initialAnalysis
    let passes = 0
    while (analysis.summary.automatic > 0) {
        if (passes >= MAX_CLEANUP_PASSES) {
            return blockedPreview(input, initialAnalysis, analysis, passes, {
                code: 'iteration-limit-reached',
                message: 'CSS 自动清理未在安全轮次内收敛，原始源码保持不变。',
            })
        }
        const actions = cleanupActionsForPass(styleCss, analysis, input.scope)
        if (actions.length === 0) {
            return blockedPreview(input, initialAnalysis, analysis, passes, {
                code: 'execution-stalled',
                message: 'CSS 清理项无法转换为无重叠源码修改，原始源码保持不变。',
            })
        }
        const edits: SourceEdit[] = actions.map(action =>
            createUtf8SourceEdit('style.css', styleCss, action.range, action.insert),
        )
        const applied = applySourceEdits({'article.html': '', 'style.css': styleCss}, edits)
        const nextStyleCss = applied.sources['style.css']
        if (nextStyleCss === styleCss) {
            return blockedPreview(input, initialAnalysis, analysis, passes, {
                code: 'execution-stalled',
                message: 'CSS 清理没有改变源码，原始源码保持不变。',
            })
        }

        const parsed = parseCssSource(nextStyleCss, input.scope)
        if (
            !parsed.root ||
            parsed.diagnostics.some(item => item.severity === 'error') ||
            browserSafeCssPrefixEnd(nextStyleCss) !== nextStyleCss.length
        ) {
            const remainingAnalysis = analyzeCssCleanup({...input, styleCss: nextStyleCss})
            return blockedPreview(input, initialAnalysis, remainingAnalysis, passes, {
                code: 'postcondition-failed',
                message: '清理候选未通过 CSS 后置校验，原始源码保持不变。',
            })
        }

        incrementApplied(counts, actions)
        styleCss = nextStyleCss
        passes += 1
        analysis = analyzeCssCleanup({...input, styleCss})
        if (!analysis.canApplyAutomaticCleanup) {
            return blockedPreview(input, initialAnalysis, analysis, passes, {
                code: 'postcondition-failed',
                message: '清理候选产生了新的阻断诊断，原始源码保持不变。',
            })
        }
    }

    return {
        baseStyleCss: input.styleCss,
        styleCss,
        status: styleCss === input.styleCss ? 'unchanged' : 'ready',
        changed: styleCss !== input.styleCss,
        passes,
        applied: appliedCounts(counts),
        initialAnalysis,
        remainingAnalysis: analysis,
    }
}

/**
 * 对当前源码重新计算候选，并要求它与用户看到的预览逐字一致。调用成功也只返回新字符串，
 * 是否写入浏览器草稿仍由会话层决定，持久化继续只能走显式保存。
 */
export function applyAutomaticCssCleanupPreview(
    input: CssCleanupAnalysisInput,
    preview: CssCleanupPreview,
): CssCleanupApplyResult {
    if (input.styleCss !== preview.baseStyleCss) {
        return {styleCss: input.styleCss, applied: false, reason: 'stale-preview', preview}
    }
    const current = createAutomaticCssCleanupPreview(input)
    if (
        current.status !== preview.status ||
        current.styleCss !== preview.styleCss ||
        current.baseStyleCss !== preview.baseStyleCss
    ) {
        return {styleCss: input.styleCss, applied: false, reason: 'stale-preview', preview: current}
    }
    if (current.status === 'blocked') {
        return {
            styleCss: input.styleCss,
            applied: false,
            reason: 'preview-blocked',
            preview: current,
        }
    }
    if (current.status === 'unchanged') {
        return {styleCss: input.styleCss, applied: false, reason: 'unchanged', preview: current}
    }
    return {styleCss: current.styleCss, applied: true, reason: 'applied', preview: current}
}
