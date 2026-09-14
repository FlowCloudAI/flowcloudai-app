// 本模块统一完整文档与片段 HTML 的语法解析；托管组件和模板契约由更高层分别检查。

import {parse, parseFragment, type DefaultTreeAdapterTypes, type ParserError} from 'parse5'
import {utf16Range, type SourceKey} from '../contracts/source.ts'
import type {SyntaxDiagnostic} from './diagnostics.ts'

export type HtmlSyntaxMode = 'document' | 'fragment'
export type HtmlSyntaxRoot =
    DefaultTreeAdapterTypes.Document | DefaultTreeAdapterTypes.DocumentFragment

export interface ParsedHtmlSyntax {
    readonly kind: HtmlSyntaxMode
    readonly source: string
    readonly sourceKey: SourceKey
    readonly root: HtmlSyntaxRoot
    readonly diagnostics: readonly SyntaxDiagnostic[]
}

export function parseHtmlSyntax(
    source: string,
    options: {readonly mode: HtmlSyntaxMode; readonly sourceKey: SourceKey},
): ParsedHtmlSyntax {
    const diagnostics: SyntaxDiagnostic[] = []
    const parserOptions = {
        sourceCodeLocationInfo: true,
        scriptingEnabled: false,
        onParseError: (error: ParserError) => diagnostics.push(parserDiagnostic(error, options)),
    }
    const root =
        options.mode === 'document'
            ? parse(source, parserOptions)
            : parseFragment(source, parserOptions)
    return Object.freeze({
        kind: options.mode,
        source,
        sourceKey: options.sourceKey,
        root,
        diagnostics: Object.freeze(diagnostics),
    })
}

function parserDiagnostic(
    error: ParserError,
    options: {readonly mode: HtmlSyntaxMode; readonly sourceKey: SourceKey},
): SyntaxDiagnostic {
    return Object.freeze({
        code: `html_${error.code}`,
        message: `HTML 语法错误：${error.code}。`,
        source: options.sourceKey,
        range: utf16Range(error.startOffset, Math.max(error.startOffset, error.endOffset)),
        context: options.mode === 'document' ? 'html-document' : 'html-fragment',
    })
}
