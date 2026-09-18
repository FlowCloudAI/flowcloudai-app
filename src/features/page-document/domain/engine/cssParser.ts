// 本模块用 PostCSS 解析作者 CSS、保留源码位置并固定 layer 边界；未知合法声明不会被重写。
import type {AtRule, ChildNode, Root} from 'postcss'
import type {DocumentDiagnostic, SourceRange} from '../contract.ts'
import {sourceKey} from '../kernel/contracts/source.ts'
import {
    browserSafeCssPrefixEnd,
    parseStylesheetSyntax,
    syntaxDocumentDiagnostic,
} from '../kernel/syntax/index.ts'

export {browserSafeCssPrefixEnd}

export const CSS_LAYER_ORDER = [
    'fc-canvas-defaults', 'fc-renderer', 'fc-component', 'fc-project', 'fc-entry', 'fc-node', 'fc-author',
] as const
// 旧项目的四层声明已落库；画布运行时先声明完整顺序后，它不会重排任何层。
const LEGACY_CSS_LAYER_ORDER = ['fc-renderer', 'fc-project', 'fc-entry', 'fc-node'] as const
export type CssAuthorScope = 'project' | 'entry'

export interface ParsedCssSource {
    source: string
    scope: CssAuthorScope
    root: Root | null
    diagnostics: DocumentDiagnostic[]
}

export interface ParsedCssSyntax {
    root: Root | null
    diagnostics: DocumentDiagnostic[]
}

export function cssNodeRange(node: ChildNode | Root): SourceRange | undefined {
    const start = node.source?.start?.offset
    const end = node.source?.end?.offset
    if (start === undefined || end === undefined) return undefined
    return {from: start, to: end}
}

function diagnosticForNode(code: string, message: string, node: ChildNode): DocumentDiagnostic {
    return {
        severity: 'error',
        category: 'portability',
        code,
        message,
        file: 'style.css',
        range: cssNodeRange(node),
    }
}

function normalizedLayerNames(params: string): string[] {
    return params
        .split(',')
        .map(name => name.trim())
        .filter(Boolean)
}

function validateLayerBlock(
    rule: AtRule,
    scope: CssAuthorScope,
    diagnostics: DocumentDiagnostic[],
): void {
    const names = normalizedLayerNames(rule.params)
    if (names.length !== 1) {
        diagnostics.push(
            diagnosticForNode('invalid_layer_block', '@layer 块必须只声明一个受管 layer。', rule),
        )
        return
    }
    const allowed =
        scope === 'project'
            ? new Set(['fc-component', 'fc-project', 'fc-node'])
            : new Set(['fc-entry', 'fc-node'])
    if (!allowed.has(names[0])) {
        diagnostics.push(
            diagnosticForNode(
                'layer_scope_violation',
                `${scope === 'project' ? '项目' : '词条'} CSS 不能写入 ${names[0]} layer。`,
                rule,
            ),
        )
    }
    rule.walkAtRules('layer', nested => {
        diagnostics.push(
            diagnosticForNode(
                'nested_layer_not_supported',
                '受管 layer 内不允许再次嵌套 @layer。',
                nested,
            ),
        )
    })
}

function validateLayerContract(
    root: Root,
    scope: CssAuthorScope,
    diagnostics: DocumentDiagnostic[],
): void {
    let orderDeclarationCount = 0
    for (const node of root.nodes) {
        if (node.type === 'comment') continue
        if (node.type !== 'atrule' || node.name.toLowerCase() !== 'layer') {
            diagnostics.push(
                diagnosticForNode(
                    'unlayered_css_not_allowed',
                    '作者 CSS 的顶层内容必须放入受管 @layer。',
                    node,
                ),
            )
            continue
        }

        if (node.nodes) {
            validateLayerBlock(node, scope, diagnostics)
            continue
        }

        orderDeclarationCount += 1
        const names = normalizedLayerNames(node.params)
        const declaredOrder = names.join(',')
        if (scope !== 'project' || (
            declaredOrder !== CSS_LAYER_ORDER.join(',')
            && declaredOrder !== LEGACY_CSS_LAYER_ORDER.join(',')
        )) {
            diagnostics.push(
                diagnosticForNode(
                    'invalid_layer_order',
                    `layer 顺序必须固定为 ${CSS_LAYER_ORDER.join(' -> ')}，且只能由项目 CSS 声明。`,
                    node,
                ),
            )
        }
    }

    if (scope === 'project' && orderDeclarationCount === 0) {
        diagnostics.push({
            severity: 'error',
            category: 'portability',
            code: 'missing_layer_order',
            message: `项目 CSS 必须声明固定 layer 顺序：${CSS_LAYER_ORDER.join(' -> ')}。`,
            file: 'style.css',
        })
    } else if (orderDeclarationCount > 1) {
        diagnostics.push({
            severity: 'error',
            category: 'portability',
            code: 'duplicate_layer_order',
            message: 'CSS 中只能声明一次全局 layer 顺序。',
            file: 'style.css',
        })
    }
}

/** PostCSS 会容忍少数浏览器会从中断开恢复的错误；公共读写链路必须先使用同一严格语法边界。 */
export function parseCssSyntax(source: string): ParsedCssSyntax {
    const parsed = parseStylesheetSyntax(source, sourceKey('entry', 'style.css'))
    return {root: parsed.root, diagnostics: parsed.diagnostics.map(syntaxDocumentDiagnostic)}
}

export function parseCssSource(source: string, scope: CssAuthorScope): ParsedCssSource {
    const syntax = parseStylesheetSyntax(source, sourceKey(scope, 'style.css'))
    const diagnostics = syntax.diagnostics.map(syntaxDocumentDiagnostic)
    if (!syntax.root) return {source, scope, root: null, diagnostics}
    validateLayerContract(syntax.root, scope, diagnostics)
    return {source, scope, root: syntax.root, diagnostics}
}
