// 本模块在客户端与服务端共享，从合并后的派生 DOM 生成确定性纯文本；投影可重建，不参与作者源码真值。
import {
    childNodes,
    findFirstElementByTagName,
    getAttribute,
    isElement,
    type HtmlNode,
    type ParsedHtmlSource,
} from './htmlParser.ts'

const BLOCK_TAGS = new Set([
    'address',
    'article',
    'aside',
    'blockquote',
    'div',
    'figcaption',
    'figure',
    'footer',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'li',
    'main',
    'nav',
    'p',
    'section',
    'table',
    'tr',
])
const SKIPPED_TAGS = new Set(['head', 'script', 'style', 'template'])

function appendBoundary(parts: string[]): void {
    if (parts.length > 0 && parts[parts.length - 1] !== '\n') parts.push('\n')
}

function collect(node: HtmlNode, parts: string[]): void {
    if (!isElement(node) && node.nodeName === '#text' && 'value' in node) {
        parts.push(node.value)
        return
    }
    if (!isElement(node)) return
    if (SKIPPED_TAGS.has(node.tagName) || getAttribute(node, 'hidden') !== undefined) return
    if (node.tagName === 'br') {
        appendBoundary(parts)
        return
    }

    const block = BLOCK_TAGS.has(node.tagName)
    if (block) appendBoundary(parts)
    if (node.tagName === 'img') {
        const alt = getAttribute(node, 'alt')
        if (alt) parts.push(alt)
    }
    for (const child of childNodes(node)) collect(child, parts)
    if (block) appendBoundary(parts)
}

export function createTextProjection(parsed: ParsedHtmlSource): string {
    const root = findFirstElementByTagName(parsed.root, 'body') ?? parsed.root
    const parts: string[] = []
    for (const child of childNodes(root)) collect(child, parts)
    return parts
        .join('')
        .split('\n')
        .map(line => line.replace(/[\t\f\r ]+/gu, ' ').trim())
        .filter(Boolean)
        .join('\n')
}
