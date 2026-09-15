// 本模块在宿主下发前复用领域解析器与 guard；画布运行时仍保留独立的第二道校验。

import type {DocumentDiagnostic} from '../../domain/contract.ts'
import {parseCssSource} from '../../domain/engine/cssParser.ts'
import {guardDocumentSources} from '../../domain/engine/guard.ts'
import {parseHtmlSource} from '../../domain/engine/htmlParser.ts'

export function validateCanvasAuthorSources(html: string, css: string): DocumentDiagnostic[] {
    const parsedHtml = parseHtmlSource(html, {mode: 'fragment', scope: 'entry'})
    const parsedCss = parseCssSource(css, 'entry')
    const guarded = guardDocumentSources([parsedHtml], [parsedCss])
    return [...parsedHtml.diagnostics, ...parsedCss.diagnostics, ...guarded.diagnostics]
        .filter(diagnostic => diagnostic.severity === 'error')
}
