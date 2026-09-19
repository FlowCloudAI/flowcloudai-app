// 本模块从已合并的文档抽取可重建的查询单元；不修改 HTML、不把段内换行当成新段落。
import {
    childNodes,
    findFirstElementByTagName,
    getAttribute,
    isElement,
    type HtmlElement,
    type HtmlNode,
    type ParsedHtmlSource,
} from './htmlParser.ts'

export interface DocumentTextBlock {
    ordinal: number
    nodeId: string | null
    tag: string
    binding: string | null
    text: string
}

const BLOCK_TAGS = new Set([
    'address',
    'article',
    'aside',
    'blockquote',
    'caption',
    'dd',
    'div',
    'dl',
    'dt',
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
    'ol',
    'p',
    'pre',
    'section',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'ul',
])
const SKIPPED_TAGS = new Set(['head', 'script', 'style', 'template'])

interface TextRun {
    nodeId: string | null
    tag: string
    binding: string | null
    parts: string[]
}

function contextFor(element: HtmlElement, parent: TextRun): TextRun {
    return {
        nodeId: getAttribute(element, 'data-fc-node-id')?.toLowerCase() ?? parent.nodeId,
        tag: element.tagName,
        binding: getAttribute(element, 'data-fc-bind') ?? parent.binding,
        parts: [],
    }
}

/** 定位只在对应 revision/projectRevision 内有效；已有 UUID 优先，无 ID 时用文档序。 */
export function createTextBlocks(parsed: ParsedHtmlSource): DocumentTextBlock[] {
    const blocks: DocumentTextBlock[] = []
    const root = findFirstElementByTagName(parsed.root, 'body') ?? parsed.root
    const rootRun: TextRun = {nodeId: null, tag: 'body', binding: null, parts: []}

    function flush(run: TextRun): void {
        const text = run.parts
            .join('')
            .replace(/[\t\f\r ]+/gu, ' ')
            .split('\n')
            .map(line => line.trim())
            .join('\n')
            .trim()
        run.parts.length = 0
        if (!text) return
        blocks.push({
            ordinal: blocks.length,
            nodeId: run.nodeId,
            tag: run.tag,
            binding: run.binding,
            text,
        })
    }

    function visit(node: HtmlNode, run: TextRun, staticInherited = false): void {
        if (!isElement(node)) {
            if (!staticInherited && node.nodeName === '#text' && 'value' in node) run.parts.push(node.value)
            return
        }
        if (SKIPPED_TAGS.has(node.tagName) || getAttribute(node, 'hidden') !== undefined) return
        const instanceContent = getAttribute(node, 'data-fc-component-instance-content') !== undefined
        const componentStatic =
            getAttribute(node, 'data-fc-component-static') !== undefined && !instanceContent
        if (node.tagName === 'br') {
            if (!staticInherited && !componentStatic) run.parts.push('\n')
            return
        }
        if (node.tagName === 'img') {
            if (staticInherited || componentStatic) return
            flush(run)
            const image = contextFor(node, run)
            image.parts.push(getAttribute(node, 'alt') ?? '')
            flush(image)
            return
        }
        const separate =
            BLOCK_TAGS.has(node.tagName) || getAttribute(node, 'data-fc-bind') !== undefined
        if (separate) flush(run)
        const next = separate ? contextFor(node, run) : run
        const childStatic = instanceContent ? false : staticInherited || componentStatic
        for (const child of childNodes(node)) visit(child, next, childStatic)
        if (separate) flush(next)
    }

    for (const child of childNodes(root)) visit(child, rootRun)
    flush(rootRun)
    return blocks
}
