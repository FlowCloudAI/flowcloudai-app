// 本模块是旧 Markdown 数据的一次性过渡转换层；它只生成页面草稿，不写旧正文，也不自动保存。
// 正式上线不再支持旧格式；当全部旧数据至少完成一次页面文档保存后删除本模块及其调用点。

import {wrapMarkdownFallback} from '../canvas/host/compiledPreview.ts'
import {validateAuthorHref} from '../domain/kernel/policy/hrefPolicy.ts'
import {nodeId} from '../domain/kernel/index.ts'
import {RFC_9562_UUID_SOURCE} from '../domain/uuidPolicy.ts'

export interface MarkdownDocumentConversion {
    articleHtml: string
    derivedText: string
    blockCount: number
}

interface RenderedInline {
    html: string
    text: string
}

interface RenderedBlock {
    html: string
    text: string
}

const IMAGE_PATTERN = new RegExp(
    `^!\\[([^\\]\\r\\n]*)\\]\\((?:fc://self/image/(${RFC_9562_UUID_SOURCE})|fcimg:(${RFC_9562_UUID_SOURCE}))\\)$`,
    'iu',
)
const HEADING_PATTERN = /^(#{1,6})[\t ]+(.+)$/u
const UNORDERED_LIST_PATTERN = /^[\t ]*[-+*][\t ]+(.+)$/u
const ORDERED_LIST_PATTERN = /^[\t ]*\d+[.)][\t ]+(.+)$/u
const FENCE_PATTERN = /^[\t ]*(`{3,}|~{3,})/u
const TABLE_DIVIDER_PATTERN = /^[\t ]*\|?[\t ]*:?-{3,}:?[\t ]*(?:\|[\t ]*:?-{3,}:?[\t ]*)+\|?[\t ]*$/u

function escapeHtml(value: string): string {
    return value
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&#39;')
}

function managedAttributes(kind: string, allocateNodeId: () => string): string {
    return `data-fc-node-id="${nodeId(allocateNodeId())}" data-fc-node-kind="${kind}"`
}

function isConvertibleHref(href: string): boolean {
    if (!validateAuthorHref(href).allowed) return false
    return /^(?:fc:\/\/self\/entry\/|entry:\/\/|https?:\/\/|mailto:|tel:)/iu.test(href)
        && !/^entry:\/\/[^/]+\//iu.test(href)
}

function renderInline(source: string): RenderedInline {
    let html = ''
    let text = ''
    let cursor = 0

    const appendLiteral = (value: string) => {
        html += escapeHtml(value)
        text += value
    }

    while (cursor < source.length) {
        if (source.startsWith('[[', cursor)) {
            const close = source.indexOf(']]', cursor + 2)
            if (close >= 0) {
                const title = source.slice(cursor + 2, close)
                if (title.trim()) {
                    html += `<a href="entry-title://${encodeURIComponent(title)}">${escapeHtml(title)}</a>`
                    text += title
                    cursor = close + 2
                    continue
                }
            }
        }

        if (source[cursor] === '[') {
            const labelEnd = source.indexOf('](', cursor + 1)
            const hrefEnd = labelEnd >= 0 ? source.indexOf(')', labelEnd + 2) : -1
            if (labelEnd >= 0 && hrefEnd >= 0) {
                const label = source.slice(cursor + 1, labelEnd)
                const href = source.slice(labelEnd + 2, hrefEnd)
                if (label && isConvertibleHref(href)) {
                    const renderedLabel = renderInline(label)
                    html += `<a href="${escapeHtml(href)}">${renderedLabel.html}</a>`
                    text += renderedLabel.text
                    cursor = hrefEnd + 1
                    continue
                }
            }
        }

        const marker = source.startsWith('**', cursor) ? '**' : source[cursor] === '*' ? '*' : null
        if (marker) {
            const close = source.indexOf(marker, cursor + marker.length)
            if (close > cursor + marker.length) {
                const rendered = renderInline(source.slice(cursor + marker.length, close))
                html += rendered.html
                text += rendered.text
                cursor = close + marker.length
                continue
            }
        }

        if (source[cursor] === '`') {
            const close = source.indexOf('`', cursor + 1)
            if (close > cursor + 1) {
                appendLiteral(source.slice(cursor + 1, close))
                cursor = close + 1
                continue
            }
        }

        const codePoint = source.codePointAt(cursor)
        if (codePoint === undefined) break
        const character = String.fromCodePoint(codePoint)
        appendLiteral(character)
        cursor += character.length
    }

    return {html, text}
}

function renderRawParagraph(source: string, allocateNodeId: () => string): RenderedBlock {
    return {
        html: `<p ${managedAttributes('paragraph', allocateNodeId)}>${escapeHtml(source).replace(/\n/gu, '<br>')}</p>`,
        text: source,
    }
}

function containsUnsupportedBlockSyntax(lines: readonly string[]): boolean {
    const source = lines.join('\n')
    return (
        lines.some(line => /^[\t ]*(?:>|<| {4}|\t)/u.test(line)) ||
        lines.some((line, index) => index > 0 && TABLE_DIVIDER_PATTERN.test(line)) ||
        /!\[[^\]]*\]\([^)]*\)/u.test(source) ||
        /<\/?[a-z][^>]*>/iu.test(source)
    )
}

function renderParagraph(lines: readonly string[], allocateNodeId: () => string): RenderedBlock {
    if (containsUnsupportedBlockSyntax(lines)) {
        return renderRawParagraph(lines.join('\n'), allocateNodeId)
    }
    const renderedLines = lines.map(renderInline)
    return {
        html: `<p ${managedAttributes('paragraph', allocateNodeId)}>${renderedLines.map(line => line.html).join('<br>')}</p>`,
        text: renderedLines.map(line => line.text).join('\n'),
    }
}

function startsNewBlock(lines: readonly string[], index: number): boolean {
    const line = lines[index] ?? ''
    return (
        FENCE_PATTERN.test(line) ||
        HEADING_PATTERN.test(line) ||
        UNORDERED_LIST_PATTERN.test(line) ||
        ORDERED_LIST_PATTERN.test(line) ||
        IMAGE_PATTERN.test(line.trim()) ||
        (index + 1 < lines.length && TABLE_DIVIDER_PATTERN.test(lines[index + 1]))
    )
}

/**
 * 把旧 Markdown 的有限安全子集转换为首次页面草稿。调用方必须显式保存，转换本身没有副作用。
 */
export function convertMarkdownToPageDocument(
    entryId: string,
    markdown: string,
    allocateNodeId: () => string = () => crypto.randomUUID(),
): MarkdownDocumentConversion {
    const lines = markdown.replace(/\r\n?/gu, '\n').split('\n')
    const blocks: RenderedBlock[] = []
    let index = 0

    while (index < lines.length) {
        if (!lines[index].trim()) {
            index += 1
            continue
        }

        const fence = FENCE_PATTERN.exec(lines[index])
        if (fence) {
            const raw = [lines[index]]
            index += 1
            while (index < lines.length) {
                raw.push(lines[index])
                const closes = new RegExp(`^[\\t ]*${fence[1][0]}{${fence[1].length},}[\\t ]*$`, 'u')
                    .test(lines[index])
                index += 1
                if (closes) break
            }
            blocks.push(renderRawParagraph(raw.join('\n'), allocateNodeId))
            continue
        }

        const heading = HEADING_PATTERN.exec(lines[index])
        if (heading) {
            const rendered = renderInline(heading[2])
            // h1 由项目模板绑定词条标题；旧 Markdown 六级标题仍都转为 heading，标签收敛到 h2–h6。
            const level = Math.min(heading[1].length + 1, 6)
            blocks.push({
                html: `<h${level} ${managedAttributes('heading', allocateNodeId)}>${rendered.html}</h${level}>`,
                text: rendered.text,
            })
            index += 1
            continue
        }

        const listMatch = UNORDERED_LIST_PATTERN.exec(lines[index]) ?? ORDERED_LIST_PATTERN.exec(lines[index])
        if (listMatch) {
            const ordered = ORDERED_LIST_PATTERN.test(lines[index])
            const pattern = ordered ? ORDERED_LIST_PATTERN : UNORDERED_LIST_PATTERN
            const items: RenderedInline[] = []
            while (index < lines.length) {
                const match = pattern.exec(lines[index])
                if (!match) break
                items.push(renderInline(match[1]))
                index += 1
            }
            const tag = ordered ? 'ol' : 'ul'
            const itemHtml = items.map(item => (
                `<li ${managedAttributes('list-item', allocateNodeId)}>${item.html}</li>`
            )).join('')
            blocks.push({
                html: `<${tag} ${managedAttributes('list', allocateNodeId)}>${itemHtml}</${tag}>`,
                text: items.map(item => item.text).join('\n'),
            })
            continue
        }

        const image = IMAGE_PATTERN.exec(lines[index].trim())
        if (image) {
            const assetId = (image[2] ?? image[3]).toLowerCase()
            const alt = image[1]
            blocks.push({
                html: `<figure ${managedAttributes('asset', allocateNodeId)}><img src="fcasset://${assetId}" data-fc-asset-id="${assetId}" alt="${escapeHtml(alt)}"></figure>`,
                text: alt,
            })
            index += 1
            continue
        }

        const paragraphLines = [lines[index]]
        index += 1
        while (index < lines.length && lines[index].trim() && !startsNewBlock(lines, index)) {
            paragraphLines.push(lines[index])
            index += 1
        }
        blocks.push(renderParagraph(paragraphLines, allocateNodeId))
    }

    return {
        articleHtml: wrapMarkdownFallback(entryId, blocks.map(block => block.html).join('\n')),
        derivedText: blocks.map(block => block.text).filter(Boolean).join('\n'),
        blockCount: blocks.length,
    }
}
