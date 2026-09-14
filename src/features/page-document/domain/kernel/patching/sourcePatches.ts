// 本模块在单一源码快照上原子校验并应用带作用域补丁；不负责规划写入位置或推进持久化 revision。

import {documentFingerprint} from '../contracts/hash.ts'
import {snapshotId, type SnapshotId} from '../contracts/identity.ts'
import {
    sourceKeyString,
    type SourceDocument,
    type SourceKey,
    type SourceSnapshot,
    type Utf16SourceRange,
} from '../contracts/source.ts'

export interface SourcePatch {
    readonly source: SourceKey
    readonly range: Utf16SourceRange
    readonly expected: string
    readonly insert: string
}

export type SourcePatchFailureCode =
    | 'source-not-found'
    | 'invalid-source-range'
    | 'source-precondition-failed'
    | 'overlapping-source-patches'

export interface SourcePatchFailure {
    readonly code: SourcePatchFailureCode
    readonly patchIndex: number
    readonly source: SourceKey
    readonly message: string
}

export type ApplySourcePatchesResult =
    | {
          readonly status: 'applied' | 'unchanged'
          readonly snapshot: SourceSnapshot
          readonly changedSources: readonly SourceKey[]
      }
    | {
          readonly status: 'rejected'
          readonly snapshot: SourceSnapshot
          readonly failures: readonly SourcePatchFailure[]
      }

interface IndexedPatch {
    readonly patch: SourcePatch
    readonly index: number
}

const MAX_PATCH_COUNT = 2_048

export function applySourcePatches(
    sourceSnapshot: SourceSnapshot,
    patches: readonly SourcePatch[],
): ApplySourcePatchesResult {
    if (patches.length > MAX_PATCH_COUNT) {
        throw new RangeError(`一次最多应用 ${MAX_PATCH_COUNT} 个源码补丁。`)
    }
    const documents = new Map(
        sourceSnapshot.documents.map(document => [sourceKeyString(document.key), document]),
    )
    const indexedBySource = new Map<string, IndexedPatch[]>()
    const failures: SourcePatchFailure[] = []
    patches.forEach((patch, index) => {
        const key = sourceKeyString(patch.source)
        const document = documents.get(key)
        if (!document) {
            failures.push(failure('source-not-found', index, patch, `源码快照不包含 ${key}。`))
            return
        }
        const range = patch.range
        if (
            range.unit !== 'utf16-code-unit' ||
            !Number.isSafeInteger(range.from) ||
            !Number.isSafeInteger(range.to) ||
            range.from < 0 ||
            range.to < range.from ||
            range.to > document.content.length ||
            splitsSurrogatePair(document.content, range.from) ||
            splitsSurrogatePair(document.content, range.to)
        ) {
            failures.push(
                failure(
                    'invalid-source-range',
                    index,
                    patch,
                    '源码补丁区间无效或落在 Unicode 代理对内部。',
                ),
            )
            return
        }
        if (document.content.slice(range.from, range.to) !== patch.expected) {
            failures.push(
                failure(
                    'source-precondition-failed',
                    index,
                    patch,
                    '源码补丁 expected 与起始快照不一致。',
                ),
            )
            return
        }
        const indexed = indexedBySource.get(key) ?? []
        indexed.push({patch, index})
        indexedBySource.set(key, indexed)
    })

    for (const indexed of indexedBySource.values()) {
        indexed.sort(
            (left, right) =>
                left.patch.range.from - right.patch.range.from ||
                left.patch.range.to - right.patch.range.to ||
                left.index - right.index,
        )
        for (let position = 1; position < indexed.length; position += 1) {
            const previous = indexed[position - 1]
            const current = indexed[position]
            if (patchesOverlap(previous.patch, current.patch)) {
                failures.push(
                    failure(
                        'overlapping-source-patches',
                        current.index,
                        current.patch,
                        `源码补丁与同批次第 ${previous.index} 项重叠。`,
                    ),
                )
            }
        }
    }
    if (failures.length > 0) {
        return Object.freeze({
            status: 'rejected',
            snapshot: sourceSnapshot,
            failures: Object.freeze(failures),
        })
    }

    const changedSources: SourceKey[] = []
    const nextDocuments = sourceSnapshot.documents.map(document => {
        const indexed = indexedBySource.get(sourceKeyString(document.key)) ?? []
        if (indexed.length === 0) return document
        let content = document.content
        for (const {patch} of [...indexed].reverse()) {
            content = `${content.slice(0, patch.range.from)}${patch.insert}${content.slice(patch.range.to)}`
        }
        if (content === document.content) return document
        changedSources.push(document.key)
        return freezeSourceDocument(document, content)
    })
    if (changedSources.length === 0) {
        return Object.freeze({
            status: 'unchanged',
            snapshot: sourceSnapshot,
            changedSources: Object.freeze([]),
        })
    }
    const nextSnapshot = Object.freeze({
        id: candidateSnapshotId(sourceSnapshot, nextDocuments),
        documents: Object.freeze(nextDocuments),
        templateVersion: sourceSnapshot.templateVersion,
    })
    return Object.freeze({
        status: 'applied',
        snapshot: nextSnapshot,
        changedSources: Object.freeze(changedSources),
    })
}

function failure(
    code: SourcePatchFailureCode,
    patchIndex: number,
    patch: SourcePatch,
    message: string,
): SourcePatchFailure {
    return Object.freeze({code, patchIndex, source: patch.source, message})
}

function patchesOverlap(left: SourcePatch, right: SourcePatch): boolean {
    if (right.range.from < left.range.to) return true
    return (
        right.range.from === left.range.from &&
        (left.range.from === left.range.to || right.range.from === right.range.to)
    )
}

function splitsSurrogatePair(source: string, offset: number): boolean {
    if (offset <= 0 || offset >= source.length) return false
    const previous = source.charCodeAt(offset - 1)
    const current = source.charCodeAt(offset)
    return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff
}

function freezeSourceDocument(document: SourceDocument, content: string): SourceDocument {
    return Object.freeze({
        key: document.key,
        content,
        contentHash: `candidate:${documentFingerprint(content)}`,
        persistentRevision: document.persistentRevision,
    })
}

function candidateSnapshotId(
    previous: SourceSnapshot,
    documents: readonly SourceDocument[],
): SnapshotId {
    const fingerprint = JSON.stringify({
        previous: previous.id,
        documents: documents.map(document => ({
            key: sourceKeyString(document.key),
            contentHash: document.contentHash,
        })),
    })
    return snapshotId(`candidate:${documentFingerprint(fingerprint)}`)
}
