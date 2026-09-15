// 本模块定义带作用域的源码键、不可变源码快照、来源映射与互不混用的源码坐标。

import {SOURCE_FILE_NAMES, type SourceFileName} from './primitives.ts'
import {snapshotId, type SnapshotId} from './identity.ts'
import {utf8ByteLength} from '../../utf8.ts'

declare const COORDINATE_BRAND: unique symbol

export type SourceScope = 'project' | 'entry'
export type SourceOriginKind = 'author' | 'metadata-binding' | 'renderer-generated'
export type Utf16Offset = number & {readonly [COORDINATE_BRAND]: 'Utf16Offset'}
export type Utf8ByteOffset = number & {readonly [COORDINATE_BRAND]: 'Utf8ByteOffset'}

export interface Utf16SourceRange {
    readonly unit: 'utf16-code-unit'
    readonly from: Utf16Offset
    readonly to: Utf16Offset
}

export interface Utf8SourceRange {
    readonly unit: 'utf8-byte'
    readonly from: Utf8ByteOffset
    readonly to: Utf8ByteOffset
}

export interface SourceKey {
    readonly scope: SourceScope
    readonly file: SourceFileName
}

export interface SourceDocument {
    readonly key: SourceKey
    readonly content: string
    readonly contentHash: string
    readonly persistentRevision: number
}

export interface SourceSnapshot {
    readonly id: SnapshotId
    readonly documents: readonly SourceDocument[]
    readonly templateVersion: number
}

export interface SourceOrigin {
    readonly kind: SourceOriginKind
    readonly source: SourceKey | null
    readonly range: Utf16SourceRange | null
}

export function sourceKey(scope: SourceScope, file: SourceFileName): SourceKey {
    return Object.freeze({scope, file})
}

export function sourceKeyString(key: SourceKey): string {
    return `${key.scope}:${key.file}`
}

export function parseSourceKey(value: unknown): SourceKey {
    if (!isRecord(value)) throw new TypeError('SourceKey 必须是对象。')
    if (value.scope !== 'project' && value.scope !== 'entry') {
        throw new TypeError('SourceKey.scope 必须是 project 或 entry。')
    }
    if (!SOURCE_FILE_NAMES.includes(value.file as SourceFileName)) {
        throw new TypeError('SourceKey.file 不是受支持的逻辑文件。')
    }
    return sourceKey(value.scope, value.file as SourceFileName)
}

export function utf16Range(from: number, to: number): Utf16SourceRange {
    requireRange(from, to, 'UTF-16')
    return Object.freeze({
        unit: 'utf16-code-unit',
        from: from as Utf16Offset,
        to: to as Utf16Offset,
    })
}

export function utf8Range(from: number, to: number): Utf8SourceRange {
    requireRange(from, to, 'UTF-8')
    return Object.freeze({
        unit: 'utf8-byte',
        from: from as Utf8ByteOffset,
        to: to as Utf8ByteOffset,
    })
}

/** 把外部 UTF-8 字节坐标还原为内核使用的 UTF-16 字符串坐标；非字符边界返回 null。 */
export function utf16RangeFromUtf8ByteRange(
    source: string,
    range: Utf8SourceRange,
): Utf16SourceRange | null {
    let utf16Offset = 0
    let utf8Offset = 0
    let from: number | null = range.from === 0 ? 0 : null
    let to: number | null = range.to === 0 ? 0 : null
    for (const character of source) {
        utf16Offset += character.length
        utf8Offset += utf8ByteLength(character)
        if (utf8Offset === range.from) from = utf16Offset
        if (utf8Offset === range.to) to = utf16Offset
    }
    if (from === null || to === null || to < from) return null
    return utf16Range(from, to)
}

export function parseUtf8SourceRange(value: unknown): Utf8SourceRange {
    if (!isRecord(value) || value.unit !== 'utf8-byte') {
        throw new TypeError('UTF-8 源码区间必须声明 utf8-byte。')
    }
    return utf8Range(Number(value.from), Number(value.to))
}

export function parseUtf16SourceRange(value: unknown): Utf16SourceRange {
    if (!isRecord(value) || value.unit !== 'utf16-code-unit') {
        throw new TypeError('UTF-16 源码区间必须声明 utf16-code-unit。')
    }
    return utf16Range(Number(value.from), Number(value.to))
}

export function parseSourceOrigin(value: unknown): SourceOrigin {
    if (!isRecord(value)) throw new TypeError('SourceOrigin 必须是对象。')
    if (!['author', 'metadata-binding', 'renderer-generated'].includes(String(value.kind))) {
        throw new TypeError('SourceOrigin.kind 不受支持。')
    }
    const source = value.source === null ? null : parseSourceKey(value.source)
    const range = value.range === null ? null : parseUtf16SourceRange(value.range)
    return Object.freeze({
        kind: value.kind as SourceOriginKind,
        source,
        range,
    })
}

export function parseSourceSnapshot(value: unknown): SourceSnapshot {
    if (!isRecord(value)) throw new TypeError('SourceSnapshot 必须是对象。')
    if (typeof value.id !== 'string') throw new TypeError('SourceSnapshot.id 缺失。')
    if (!Array.isArray(value.documents))
        throw new TypeError('SourceSnapshot.documents 必须是数组。')
    if (!Number.isInteger(value.templateVersion) || Number(value.templateVersion) < 1) {
        throw new TypeError('SourceSnapshot.templateVersion 必须是正整数。')
    }
    const documents = value.documents.map(parseSourceDocument)
    const seen = new Set<string>()
    for (const document of documents) {
        const key = sourceKeyString(document.key)
        if (seen.has(key)) throw new TypeError(`SourceSnapshot 包含重复源码 ${key}。`)
        seen.add(key)
    }
    return Object.freeze({
        id: snapshotId(value.id),
        documents: Object.freeze(documents),
        templateVersion: Number(value.templateVersion),
    })
}

function parseSourceDocument(value: unknown): SourceDocument {
    if (!isRecord(value)) throw new TypeError('SourceDocument 必须是对象。')
    if (typeof value.content !== 'string' || typeof value.contentHash !== 'string') {
        throw new TypeError('SourceDocument 必须包含字符串 content 与 contentHash。')
    }
    if (!Number.isInteger(value.persistentRevision) || Number(value.persistentRevision) < 0) {
        throw new TypeError('SourceDocument.persistentRevision 必须是非负整数。')
    }
    return Object.freeze({
        key: parseSourceKey(value.key),
        content: value.content,
        contentHash: value.contentHash,
        persistentRevision: Number(value.persistentRevision),
    })
}

function requireRange(from: number, to: number, label: string): void {
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) {
        throw new RangeError(`${label} 源码区间必须是有序的非负安全整数。`)
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
