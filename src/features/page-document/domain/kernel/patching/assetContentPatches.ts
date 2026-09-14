// 本模块把图片替代文本和可选图注编译为最小 HTML 补丁；复杂图注的替换损失由计划器显式报告。

import type {HtmlCompositionElement} from '../composition/index.ts'
import type {AssetCaptionExpectation} from '../contracts/edit.ts'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import {
    childNodes,
    elementInnerRange,
    elementRange,
    isElement,
    walkElements,
} from '../syntax/index.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type AssetAltPatchResult =
    | {readonly status: 'ready'; readonly patch: SourcePatch}
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export type AssetCaptionPatchResult =
    | {
          readonly status: 'ready'
          readonly patch: SourcePatch
          readonly replacedStructuredContent: boolean
      }
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export type AssetCaptionStateResult =
    | {readonly status: 'ready'; readonly state: AssetCaptionExpectation}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

const MAX_ASSET_TEXT_LENGTH = 100_000

export function createAssetAltPatch(
    document: SourceDocument,
    image: HtmlCompositionElement,
    expectedAlt: string | null,
    alt: string,
): AssetAltPatchResult {
    if (document.key.file !== 'article.html') {
        return rejected('asset-alt-source-invalid', '图片替代文本只能写入 article.html。')
    }
    if (alt.length > MAX_ASSET_TEXT_LENGTH) {
        return rejected('asset-text-limit', `图片说明最多包含 ${MAX_ASSET_TEXT_LENGTH} 个字符。`)
    }
    const current = attribute(image, 'alt')
    if (current !== expectedAlt) {
        return rejected('asset-alt-precondition-failed', '图片替代文本已变化，请重新读取。')
    }
    if (current === alt) return {status: 'unchanged'}
    const range = image.sourceCodeLocation?.attrs?.alt
    if (range) {
        return Object.freeze({
            status: 'ready',
            patch: Object.freeze({
                source: document.key,
                range: utf16Range(range.startOffset, range.endOffset),
                expected: document.content.slice(range.startOffset, range.endOffset),
                insert: `alt="${htmlAttribute(alt)}"`,
            }),
        })
    }
    const at = startTagInsertionOffset(document.content, image)
    if (at === null) return rejected('source-location-missing', '无法定位内部图片开始标签。')
    return Object.freeze({
        status: 'ready',
        patch: Object.freeze({
            source: document.key,
            range: utf16Range(at, at),
            expected: '',
            insert: ` alt="${htmlAttribute(alt)}"`,
        }),
    })
}

export function createAssetCaptionPatch(
    document: SourceDocument,
    root: HtmlCompositionElement,
    expected: AssetCaptionExpectation,
    caption: string | null,
): AssetCaptionPatchResult {
    if (document.key.file !== 'article.html') {
        return rejected('asset-caption-source-invalid', '图片图注只能写入 article.html。')
    }
    if (caption !== null && caption.length > MAX_ASSET_TEXT_LENGTH) {
        return rejected('asset-text-limit', `图片说明最多包含 ${MAX_ASSET_TEXT_LENGTH} 个字符。`)
    }
    const inspected = readAssetCaptionState(root)
    if (inspected.status === 'rejected') return inspected
    if (!sameCaptionState(inspected.state, expected)) {
        return rejected('asset-caption-precondition-failed', '图片图注已变化，请重新读取。')
    }
    const direct = directFigcaptions(root)[0] ?? null
    const normalized = caption === null ? null : normalizeText(caption)
    if (normalized === null && inspected.state.kind === 'absent') return {status: 'unchanged'}
    if (
        normalized !== null &&
        inspected.state.kind === 'plain' &&
        inspected.state.text === normalized
    ) {
        return {status: 'unchanged'}
    }
    if (direct) {
        const range = normalized === null ? elementRange(direct) : elementInnerRange(direct)
        if (!range) return rejected('source-location-missing', '无法定位图片图注源码。')
        return Object.freeze({
            status: 'ready',
            patch: Object.freeze({
                source: document.key,
                range: utf16Range(range.from, range.to),
                expected: document.content.slice(range.from, range.to),
                insert: normalized === null ? '' : renderPlainText(normalized),
            }),
            replacedStructuredContent: inspected.state.kind === 'structured',
        })
    }
    if (normalized === null) return {status: 'unchanged'}
    const inner = elementInnerRange(root)
    const outer = elementRange(root)
    if (!inner || !outer) return rejected('source-location-missing', '无法定位图片组件内部源码。')
    const existing = document.content.slice(inner.from, inner.to)
    const trailingWhitespace = existing.match(/\s*$/u)?.[0] ?? ''
    const at = inner.to - trailingWhitespace.length
    const childIndent = `${indentationAt(document.content, outer.from)}  `
    const prefix = existing.includes('\n') ? `\n${childIndent}` : ''
    return Object.freeze({
        status: 'ready',
        patch: Object.freeze({
            source: document.key,
            range: utf16Range(at, at),
            expected: '',
            insert: `${prefix}<figcaption>${renderPlainText(normalized)}</figcaption>`,
        }),
        replacedStructuredContent: false,
    })
}

export function readAssetCaptionState(root: HtmlCompositionElement): AssetCaptionStateResult {
    if (root.tagName !== 'figure') {
        return rejected('asset-caption-requires-figure', '只有 figure 图片组件支持图注。')
    }
    const direct = directFigcaptions(root)
    let total = 0
    walkElements(root, candidate => {
        if (candidate !== root && candidate.tagName === 'figcaption') total += 1
    })
    if (direct.length > 1 || total !== direct.length) {
        return rejected(
            'asset-caption-ambiguous',
            '图片组件包含嵌套或重复图注，不能由可视编辑器接管。',
        )
    }
    const caption = direct[0]
    if (!caption) return Object.freeze({status: 'ready', state: Object.freeze({kind: 'absent'})})
    return Object.freeze({
        status: 'ready',
        state: Object.freeze({
            kind: childNodes(caption).every(isPlainTextChild) ? 'plain' : 'structured',
            text: textContent(caption),
        }),
    })
}

function directFigcaptions(root: HtmlCompositionElement): HtmlCompositionElement[] {
    return childNodes(root).filter(
        (child): child is HtmlCompositionElement =>
            isElement(child) && child.tagName === 'figcaption',
    )
}

function isPlainTextChild(node: Parameters<typeof isElement>[0]): boolean {
    if ('value' in node && typeof node.value === 'string') return true
    return isElement(node) && node.tagName === 'br' && node.attrs.length === 0
}

function textContent(node: Parameters<typeof isElement>[0]): string {
    if ('value' in node && typeof node.value === 'string') return node.value
    if (isElement(node) && node.tagName === 'br') return '\n'
    return childNodes(node).map(textContent).join('')
}

function sameCaptionState(left: AssetCaptionExpectation, right: AssetCaptionExpectation): boolean {
    return (
        left.kind === right.kind &&
        (left.kind === 'absent' || (right.kind !== 'absent' && left.text === right.text))
    )
}

function normalizeText(value: string): string {
    return value.replace(/\r\n?/gu, '\n').replaceAll('\0', '\uFFFD')
}

function renderPlainText(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('\n', '<br>')
}

function htmlAttribute(value: string): string {
    return renderPlainText(value).replaceAll('<br>', '&#10;').replaceAll('"', '&quot;')
}

function attribute(element: HtmlCompositionElement, name: string): string | null {
    return element.attrs.find(candidate => candidate.name === name)?.value ?? null
}

function startTagInsertionOffset(source: string, element: HtmlCompositionElement): number | null {
    const range = element.sourceCodeLocation?.startTag
    if (!range) return null
    const raw = source.slice(range.startOffset, range.endOffset)
    return range.endOffset - (raw.endsWith('/>') ? 2 : 1)
}

function indentationAt(source: string, offset: number): string {
    const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
    return /^[\t ]*/u.exec(source.slice(lineStart, offset))?.[0] ?? ''
}

function rejected(code: string, message: string) {
    return Object.freeze({status: 'rejected' as const, code, message})
}
