// 本模块以纯函数换算并应用 UTF-8 字节源码区间；调用方负责 revision、持久化和诊断展示。
import {
    SOURCE_FILE_NAMES,
    type SourceEdit,
    type SourceFileName,
    type SourceFileSet,
    type SourceRange,
    type Utf8SourceRange,
} from './contract.ts'
import {utf8ByteLength} from './utf8.ts'

export type SourceEditErrorCode =
    | 'invalid_source_file'
    | 'invalid_source_range'
    | 'source_precondition_failed'
    | 'overlapping_source_edits'

export class SourceEditError extends Error {
    readonly code: SourceEditErrorCode
    readonly file?: SourceFileName
    readonly editIndex?: number
    readonly details?: unknown

    constructor(
        code: SourceEditErrorCode,
        message: string,
        options: {file?: SourceFileName; editIndex?: number; details?: unknown} = {},
    ) {
        super(message)
        this.name = 'SourceEditError'
        this.code = code
        this.file = options.file
        this.editIndex = options.editIndex
        this.details = options.details
    }
}

export interface AppliedSourceEdits {
    sources: SourceFileSet
    changedFiles: SourceFileName[]
}

interface IndexedSourceEdit {
    edit: SourceEdit
    index: number
}

interface ResolvedSourceEdit extends IndexedSourceEdit {
    stringRange: SourceRange
}

interface Utf8OffsetIndex {
    byteLength: number
    byteByStringOffset: ReadonlyMap<number, number>
    stringOffsetByByte: ReadonlyMap<number, number>
}

function createUtf8OffsetIndex(source: string): Utf8OffsetIndex {
    const byteByStringOffset = new Map<number, number>([[0, 0]])
    const stringOffsetByByte = new Map<number, number>([[0, 0]])
    let stringOffset = 0
    let byteOffset = 0
    for (const character of source) {
        stringOffset += character.length
        byteOffset += utf8ByteLength(character)
        byteByStringOffset.set(stringOffset, byteOffset)
        stringOffsetByByte.set(byteOffset, stringOffset)
    }
    return {byteLength: byteOffset, byteByStringOffset, stringOffsetByByte}
}

/** 把 JavaScript 字符串区间换算成同一字符串 UTF-8 编码后的字节区间。 */
export function utf8ByteRangeFromStringRange(source: string, range: SourceRange): Utf8SourceRange {
    const index = createUtf8OffsetIndex(source)
    const from = index.byteByStringOffset.get(range.from)
    const to = index.byteByStringOffset.get(range.to)
    if (from === undefined || to === undefined || to < from) {
        throw new RangeError('字符串区间无效或落在 Unicode 代理对内部。')
    }
    return {from, to}
}

/** 把 UTF-8 字节区间换算回 JavaScript 字符串区间；非字符边界返回 null。 */
export function stringRangeFromUtf8ByteRange(
    source: string,
    range: Utf8SourceRange,
): SourceRange | null {
    const index = createUtf8OffsetIndex(source)
    const from = index.stringOffsetByByte.get(range.from)
    const to = index.stringOffsetByByte.get(range.to)
    if (from === undefined || to === undefined || to < from) return null
    return {from, to}
}

/** 从解析器/DOM 的 UTF-16 区间创建对外 UTF-8 字节 SourceEdit。 */
export function createUtf8SourceEdit(
    file: SourceFileName,
    source: string,
    range: SourceRange,
    insert: string,
): SourceEdit {
    return {
        file,
        ...utf8ByteRangeFromStringRange(source, range),
        expected: source.slice(range.from, range.to),
        insert,
    }
}

function isSourceFileName(value: string): value is SourceFileName {
    return SOURCE_FILE_NAMES.includes(value as SourceFileName)
}

function resolveRange(
    file: SourceFileName,
    offsets: Utf8OffsetIndex,
    edit: SourceEdit,
    index: number,
): SourceRange {
    if (!isSourceFileName(edit.file)) {
        throw new SourceEditError('invalid_source_file', '源码 edit 指向未知文件。', {
            editIndex: index,
            details: {received: edit.file},
        })
    }
    const stringFrom = offsets.stringOffsetByByte.get(edit.from)
    const stringTo = offsets.stringOffsetByByte.get(edit.to)
    if (
        !Number.isInteger(edit.from) ||
        !Number.isInteger(edit.to) ||
        edit.from < 0 ||
        edit.to < edit.from ||
        edit.to > offsets.byteLength ||
        stringFrom === undefined ||
        stringTo === undefined
    ) {
        throw new SourceEditError(
            'invalid_source_range',
            '源码 edit 的 UTF-8 字节区间无效或未落在字符边界。',
            {
                file,
                editIndex: index,
                details: {
                    from: edit.from,
                    to: edit.to,
                    sourceByteLength: offsets.byteLength,
                    offsetUnit: 'utf8-byte',
                },
            },
        )
    }
    return {from: stringFrom, to: stringTo}
}

function editsConflict(previous: SourceEdit, current: SourceEdit): boolean {
    if (current.from < previous.to) return true
    return (
        current.from === previous.from &&
        (previous.from === previous.to || current.from === current.to)
    )
}

function validateFileEdits(
    file: SourceFileName,
    source: string,
    indexedEdits: IndexedSourceEdit[],
): ResolvedSourceEdit[] {
    const sorted = [...indexedEdits].sort(
        (left, right) =>
            left.edit.from - right.edit.from ||
            left.edit.to - right.edit.to ||
            left.index - right.index,
    )
    const offsets = createUtf8OffsetIndex(source)
    const resolved: ResolvedSourceEdit[] = []

    for (let position = 0; position < sorted.length; position += 1) {
        const {edit, index} = sorted[position]
        const stringRange = resolveRange(file, offsets, edit, index)
        const actual = source.slice(stringRange.from, stringRange.to)
        if (actual !== edit.expected) {
            throw new SourceEditError(
                'source_precondition_failed',
                '源码区间与 expected 不一致。',
                {
                    file,
                    editIndex: index,
                    details: {from: edit.from, to: edit.to, expected: edit.expected, actual},
                },
            )
        }

        const previous = sorted[position - 1]
        if (previous && editsConflict(previous.edit, edit)) {
            throw new SourceEditError(
                'overlapping_source_edits',
                '同一请求中的源码 edit 不得重叠或共享插入起点。',
                {
                    file,
                    editIndex: index,
                    details: {previousIndex: previous.index},
                },
            )
        }
        resolved.push({...sorted[position], stringRange})
    }
    return resolved
}

/**
 * 全部前置条件先基于原始两份源码完成，再产生新字符串，因此任一失败都不会得到半应用结果。
 */
export function applySourceEdits(
    sources: SourceFileSet,
    edits: readonly SourceEdit[],
): AppliedSourceEdits {
    const byFile = new Map<SourceFileName, IndexedSourceEdit[]>(
        SOURCE_FILE_NAMES.map(file => [file, []]),
    )
    edits.forEach((edit, index) => {
        if (!isSourceFileName(edit.file)) {
            throw new SourceEditError('invalid_source_file', '源码 edit 指向未知文件。', {
                editIndex: index,
                details: {received: edit.file},
            })
        }
        byFile.get(edit.file)!.push({edit, index})
    })

    const validated = new Map<SourceFileName, ResolvedSourceEdit[]>()
    for (const file of SOURCE_FILE_NAMES) {
        validated.set(file, validateFileEdits(file, sources[file], byFile.get(file)!))
    }

    const nextSources: SourceFileSet = {...sources}
    const changedFiles: SourceFileName[] = []
    for (const file of SOURCE_FILE_NAMES) {
        const fileEdits = validated.get(file)!
        if (fileEdits.length === 0) continue

        let source = sources[file]
        for (const {edit, stringRange} of [...fileEdits].reverse()) {
            source = source.slice(0, stringRange.from) + edit.insert + source.slice(stringRange.to)
        }
        nextSources[file] = source
        if (source !== sources[file]) changedFiles.push(file)
    }

    return {sources: nextSources, changedFiles}
}
