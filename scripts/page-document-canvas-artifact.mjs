// 本模块统一画布内联脚本的转义、换行归一化与 CSP 哈希，构建和产物检查必须共用同一规则。

import {createHash} from 'node:crypto'

export const CANVAS_CSP_PLACEHOLDER = '__PAGE_DOCUMENT_CANVAS_SCRIPT_CSP__'
export const CANVAS_RUNTIME_PLACEHOLDER = '<!-- PAGE_DOCUMENT_CANVAS_RUNTIME -->'

export function escapeInlineScript(source) {
    return source.replace(/<\/script/giu, '<\\/script')
}

export function normalizeScriptForCsp(source) {
    return source.replace(/\r\n?/gu, '\n')
}

export function createInlineScriptCspSource(source) {
    const normalized = normalizeScriptForCsp(source)
    const digest = createHash('sha256').update(normalized, 'utf8').digest('base64')
    return `'sha256-${digest}'`
}

export function replaceExactlyOnce(source, marker, replacement) {
    const firstIndex = source.indexOf(marker)
    if (firstIndex < 0 || source.indexOf(marker, firstIndex + marker.length) >= 0) {
        throw new Error(`画布骨架中的占位必须恰好出现一次：${marker}`)
    }
    return `${source.slice(0, firstIndex)}${replacement}${source.slice(firstIndex + marker.length)}`
}

/** 生产构建与开发中间件共用同一组装入口，避免转义文本与 CSP 哈希发生分叉。 */
export function assemblePageDocumentCanvasHtml(skeleton, runtimeSource) {
    const runtime = escapeInlineScript(runtimeSource)
    const cspSource = createInlineScriptCspSource(runtime)
    let html = replaceExactlyOnce(skeleton, CANVAS_CSP_PLACEHOLDER, cspSource)
    html = replaceExactlyOnce(html, CANVAS_RUNTIME_PLACEHOLDER, `<script>${runtime}</script>`)
    return Object.freeze({html, runtime, cspSource})
}
