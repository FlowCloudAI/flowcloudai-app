// 本模块建立 HTML 作者源码与解析后 UTF-16 文本之间的边界映射；实体、换行和代理对只能在完整边界写入。

import {DecodingMode, EntityDecoder, htmlDecodeTree} from 'entities/decode'
import type {Utf16SourceRange} from '../contracts/source.ts'

export interface DecodedHtmlSourceMapping {
    readonly decoded: string
    readonly boundaries: ReadonlyMap<number, number>
}

export function decodeHtmlSourceWithBoundaries(
    raw: string,
    context: 'attribute' | 'text',
): DecodedHtmlSourceMapping {
    const boundaries = new Map<number, number>([[0, 0]])
    let sourceOffset = 0
    let textOffset = 0
    let decoded = ''
    while (sourceOffset < raw.length) {
        const start = sourceOffset
        let sourceLength = 1
        let value = raw[sourceOffset]
        if (value === '&') {
            const codePoints: number[] = []
            const decoder = new EntityDecoder(htmlDecodeTree, codePoint =>
                codePoints.push(codePoint),
            )
            decoder.startEntity(
                context === 'attribute' ? DecodingMode.Attribute : DecodingMode.Legacy,
            )
            let entityLength = decoder.write(raw.slice(sourceOffset), 1)
            if (entityLength < 0) entityLength = decoder.end()
            if (entityLength > 0 && codePoints.length > 0) {
                sourceLength = entityLength
                value = String.fromCodePoint(...codePoints)
            }
        } else if (context === 'text' && value === '\r') {
            sourceLength = raw[sourceOffset + 1] === '\n' ? 2 : 1
            value = '\n'
        } else if (context === 'text' && value === '\0') {
            value = '\uFFFD'
        } else {
            const codePoint = raw.codePointAt(sourceOffset)
            if (codePoint !== undefined) {
                sourceLength = codePoint > 0xffff ? 2 : 1
                value = String.fromCodePoint(codePoint)
            }
        }
        decoded += value
        sourceOffset = start + sourceLength
        textOffset += value.length
        boundaries.set(textOffset, sourceOffset)
    }
    return Object.freeze({decoded, boundaries})
}

export function isUtf16TextBoundary(value: string, offset: number): boolean {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > value.length) return false
    if (offset === 0 || offset === value.length) return true
    const previous = value.charCodeAt(offset - 1)
    const next = value.charCodeAt(offset)
    return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
}

export function decodedTextSourceRange(
    source: string,
    sourceRange: Utf16SourceRange,
    decodedText: string,
    relativeFrom: number,
    relativeTo: number,
): {readonly from: number; readonly to: number} | null {
    const from = Number(sourceRange.from)
    const to = Number(sourceRange.to)
    const mapping = decodeHtmlSourceWithBoundaries(source.slice(from, to), 'text')
    if (mapping.decoded !== decodedText) return null
    const mappedFrom = mapping.boundaries.get(relativeFrom)
    const mappedTo = mapping.boundaries.get(relativeTo)
    return mappedFrom === undefined || mappedTo === undefined
        ? null
        : {from: from + mappedFrom, to: from + mappedTo}
}
