// 本模块统一解析样式表、声明列表、属性值与选择器；各上下文共享严格字符串检查但不互相冒充。

import postcss, {CssSyntaxError, type Declaration, type Root, type Rule} from 'postcss'
import {parse as parseSelector} from 'css-what'
import {utf16Range, type SourceKey} from '../contracts/source.ts'
import type {SyntaxContext, SyntaxDiagnostic} from './diagnostics.ts'

const DECLARATION_WRAPPER_PREFIX = 'x{'
const DECLARATION_WRAPPER_SUFFIX = '}'

export interface ParsedStylesheetSyntax {
    readonly kind: 'stylesheet'
    readonly source: string
    readonly sourceKey: SourceKey
    readonly root: Root | null
    readonly diagnostics: readonly SyntaxDiagnostic[]
}

export interface ParsedDeclarationListSyntax {
    readonly kind: 'declaration-list'
    readonly source: string
    readonly sourceKey: SourceKey
    readonly root: Root | null
    readonly rule: Rule | null
    readonly declarations: readonly Declaration[]
    readonly diagnostics: readonly SyntaxDiagnostic[]
    readonly wrapperPrefixLength: number
}

export interface ParsedSelectorListSyntax {
    readonly kind: 'selector-list'
    readonly source: string
    readonly sourceKey: SourceKey
    readonly selectors: ReturnType<typeof parseSelector> | null
    readonly diagnostics: readonly SyntaxDiagnostic[]
}

/**
 * PostCSS 会容忍引号内的原始换行，但浏览器会把它视为 bad-string。
 * 返回第一个异常字符串开始前的安全边界；合法反斜杠续行不在此限。
 */
export function browserSafeCssPrefixEnd(source: string): number {
    let quote: '"' | "'" | null = null
    let quoteStart = -1
    let inComment = false
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index]
        const next = source[index + 1]
        if (inComment) {
            if (character === '*' && next === '/') {
                inComment = false
                index += 1
            }
            continue
        }
        if (quote) {
            if (character === '\\') {
                if (next === '\r' && source[index + 2] === '\n') index += 2
                else if (next !== undefined) index += 1
                continue
            }
            if (character === quote) {
                quote = null
                quoteStart = -1
                continue
            }
            if (character === '\n' || character === '\r' || character === '\f') return quoteStart
            continue
        }
        if (character === '/' && next === '*') {
            inComment = true
            index += 1
        } else if (character === '"' || character === "'") {
            quote = character
            quoteStart = index
        }
    }
    return quote ? quoteStart : source.length
}

export function parseStylesheetSyntax(
    source: string,
    sourceKey: SourceKey,
): ParsedStylesheetSyntax {
    const diagnostics = strictStringDiagnostics(source, sourceKey, 'css-stylesheet')
    if (diagnostics.length > 0) {
        return {kind: 'stylesheet', source, sourceKey, root: null, diagnostics}
    }
    try {
        return {
            kind: 'stylesheet',
            source,
            sourceKey,
            root: postcss.parse(source, {from: undefined}),
            diagnostics: [],
        }
    } catch (error) {
        return {
            kind: 'stylesheet',
            source,
            sourceKey,
            root: null,
            diagnostics: [postcssDiagnostic(error, source, sourceKey, 'css-stylesheet', 0)],
        }
    }
}

export function parseDeclarationListSyntax(
    source: string,
    sourceKey: SourceKey,
): ParsedDeclarationListSyntax {
    const diagnostics = strictStringDiagnostics(source, sourceKey, 'css-declaration-list')
    const empty = (items: readonly SyntaxDiagnostic[]): ParsedDeclarationListSyntax => ({
        kind: 'declaration-list',
        source,
        sourceKey,
        root: null,
        rule: null,
        declarations: [],
        diagnostics: items,
        wrapperPrefixLength: DECLARATION_WRAPPER_PREFIX.length,
    })
    if (diagnostics.length > 0) return empty(diagnostics)

    const wrapped = `${DECLARATION_WRAPPER_PREFIX}${source}${DECLARATION_WRAPPER_SUFFIX}`
    let root: Root
    try {
        root = postcss.parse(wrapped, {from: undefined})
    } catch (error) {
        return empty([
            postcssDiagnostic(
                error,
                source,
                sourceKey,
                'css-declaration-list',
                DECLARATION_WRAPPER_PREFIX.length,
            ),
        ])
    }
    const rule = root.nodes.length === 1 && root.first?.type === 'rule' ? root.first : null
    const onlyDeclarationsAndComments = rule?.nodes?.every(
        node => node.type === 'decl' || node.type === 'comment',
    )
    if (!rule || rule.selector !== 'x' || !onlyDeclarationsAndComments) {
        return empty([
            diagnostic(
                'css_declaration_list_expected',
                'CSS 行内样式必须只包含声明，不能包含规则或条件块。',
                sourceKey,
                'css-declaration-list',
                0,
                Math.min(source.length, 1),
            ),
        ])
    }
    return {
        kind: 'declaration-list',
        source,
        sourceKey,
        root,
        rule,
        declarations: Object.freeze(
            (rule.nodes ?? []).filter((node): node is Declaration => node.type === 'decl'),
        ),
        diagnostics: [],
        wrapperPrefixLength: DECLARATION_WRAPPER_PREFIX.length,
    }
}

export function parsePropertyValueSyntax(
    property: string,
    value: string,
    sourceKey: SourceKey,
): ParsedDeclarationListSyntax {
    const parsed = parseDeclarationListSyntax(`${property}:${value}`, sourceKey)
    if (parsed.diagnostics.length > 0) return parsed
    if (
        parsed.declarations.length !== 1 ||
        parsed.declarations[0].prop.toLowerCase() !== property.toLowerCase()
    ) {
        return {
            ...parsed,
            root: null,
            rule: null,
            declarations: [],
            diagnostics: [
                diagnostic(
                    'css_property_value_expected',
                    `CSS 属性 ${property} 的值包含额外声明或结构。`,
                    sourceKey,
                    'css-property-value',
                    0,
                    Math.min(value.length, 1),
                ),
            ],
        }
    }
    return parsed
}

export function parseSelectorListSyntax(
    source: string,
    sourceKey: SourceKey,
): ParsedSelectorListSyntax {
    try {
        return {
            kind: 'selector-list',
            source,
            sourceKey,
            selectors: parseSelector(source),
            diagnostics: [],
        }
    } catch (error) {
        return {
            kind: 'selector-list',
            source,
            sourceKey,
            selectors: null,
            diagnostics: [
                diagnostic(
                    'css_selector_syntax_error',
                    `CSS 选择器语法错误：${error instanceof Error ? error.message : String(error)}。`,
                    sourceKey,
                    'css-selector-list',
                    0,
                    Math.min(source.length, 1),
                ),
            ],
        }
    }
}

function strictStringDiagnostics(
    source: string,
    sourceKey: SourceKey,
    context: Extract<SyntaxContext, 'css-stylesheet' | 'css-declaration-list'>,
): SyntaxDiagnostic[] {
    const safePrefixEnd = browserSafeCssPrefixEnd(source)
    if (safePrefixEnd === source.length) return []
    return [
        diagnostic(
            'css_syntax_error',
            'CSS 语法错误：字符串未闭合或包含未转义的换行。',
            sourceKey,
            context,
            safePrefixEnd,
            Math.min(source.length, safePrefixEnd + 1),
        ),
    ]
}

function postcssDiagnostic(
    error: unknown,
    source: string,
    sourceKey: SourceKey,
    context: Extract<SyntaxContext, 'css-stylesheet' | 'css-declaration-list'>,
    offsetAdjustment: number,
): SyntaxDiagnostic {
    if (!(error instanceof CssSyntaxError)) throw error
    const rawFrom = error.input?.offset ?? offsetAdjustment
    const rawTo = error.input?.endOffset ?? rawFrom + 1
    const from = Math.max(0, Math.min(source.length, rawFrom - offsetAdjustment))
    const to = Math.max(from, Math.min(source.length, rawTo - offsetAdjustment))
    return diagnostic(
        'css_syntax_error',
        `CSS 语法错误：${error.reason}。`,
        sourceKey,
        context,
        from,
        to,
    )
}

function diagnostic(
    code: string,
    message: string,
    source: SourceKey,
    context: SyntaxContext,
    from: number,
    to: number,
): SyntaxDiagnostic {
    return Object.freeze({code, message, source, context, range: utf16Range(from, to)})
}
