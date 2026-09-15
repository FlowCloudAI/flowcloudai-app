// 本模块把保存基线与当前源码转换为有界逐行差异；编辑器只负责展示，不据此写回源码。

import {diffLines} from 'diff'

export type SourceDiffRowKind = 'context' | 'added' | 'removed' | 'omitted'

export interface SourceDiffRow {
    kind: SourceDiffRowKind
    text: string
    oldLine: number | null
    newLine: number | null
}

export interface SourceDiffResult {
    rows: SourceDiffRow[]
    addedLines: number
    removedLines: number
    truncated: boolean
}

function lines(value: string): string[] {
    const normalized = value.replace(/\r\n?/g, '\n')
    const result = normalized.split('\n')
    if (result.at(-1) === '') result.pop()
    return result
}

export function createSourceDiff(before: string, after: string, maxRows = 600): SourceDiffResult {
    const rows: SourceDiffRow[] = []
    let oldLine = 1
    let newLine = 1
    let addedLines = 0
    let removedLines = 0

    for (const part of diffLines(before, after)) {
        for (const text of lines(part.value)) {
            if (part.added) {
                rows.push({kind: 'added', text, oldLine: null, newLine: newLine++})
                addedLines += 1
            } else if (part.removed) {
                rows.push({kind: 'removed', text, oldLine: oldLine++, newLine: null})
                removedLines += 1
            } else {
                rows.push({kind: 'context', text, oldLine: oldLine++, newLine: newLine++})
            }
        }
    }

    if (rows.length <= maxRows) return {rows, addedLines, removedLines, truncated: false}
    const edge = Math.max(1, Math.floor((maxRows - 1) / 2))
    return {
        rows: [
            ...rows.slice(0, edge),
            {
                kind: 'omitted',
                text: `省略 ${rows.length - edge * 2} 行差异`,
                oldLine: null,
                newLine: null,
            },
            ...rows.slice(-edge),
        ],
        addedLines,
        removedLines,
        truncated: true,
    }
}
