// 本模块定义解析上下文无关的语法诊断，并在旧文档 API 仍存在期间提供单向适配。

import type {DocumentDiagnostic} from '../../contract.ts'
import type {SourceKey, Utf16SourceRange} from '../contracts/source.ts'

export type SyntaxContext =
    | 'html-document'
    | 'html-fragment'
    | 'css-stylesheet'
    | 'css-declaration-list'
    | 'css-selector-list'
    | 'css-property-value'

export interface SyntaxDiagnostic {
    readonly code: string
    readonly message: string
    readonly source: SourceKey
    readonly range: Utf16SourceRange | null
    readonly context: SyntaxContext
}

export function syntaxDocumentDiagnostic(diagnostic: SyntaxDiagnostic): DocumentDiagnostic {
    return {
        severity: 'error',
        category: 'capability',
        code: diagnostic.code,
        message: diagnostic.message,
        file: diagnostic.source.file,
        range: diagnostic.range
            ? {from: diagnostic.range.from, to: diagnostic.range.to}
            : undefined,
        details: {
            sourceScope: diagnostic.source.scope,
            syntaxContext: diagnostic.context,
            coordinateUnit: 'utf16-code-unit',
        },
    }
}
