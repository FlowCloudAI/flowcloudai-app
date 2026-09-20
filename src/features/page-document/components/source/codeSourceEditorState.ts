// 本模块保存源码编辑器可跨页签恢复的文件级状态，并保证会话回写不冒充用户编辑进入撤销历史。

import {type EditorState, Transaction} from '@codemirror/state'
import {redoDepth, undoDepth} from '@codemirror/commands'
import type {SourceFileName} from '../../domain/contract.ts'

export interface CodeSourceEditorHistory {
    canUndo: boolean
    canRedo: boolean
}

export type CodeSourceEditorStateCache = Map<SourceFileName, EditorState>

export function sourceEditorHistory(state: EditorState | undefined): CodeSourceEditorHistory {
    return {
        canUndo: Boolean(state && undoDepth(state) > 0),
        canRedo: Boolean(state && redoDepth(state) > 0),
    }
}

function minimalReplacement(current: string, incoming: string) {
    let from = 0
    const sharedLength = Math.min(current.length, incoming.length)
    while (from < sharedLength && current.charCodeAt(from) === incoming.charCodeAt(from)) from += 1

    let currentTo = current.length
    let incomingTo = incoming.length
    while (
        currentTo > from &&
        incomingTo > from &&
        current.charCodeAt(currentTo - 1) === incoming.charCodeAt(incomingTo - 1)
    ) {
        currentTo -= 1
        incomingTo -= 1
    }
    return {from, to: currentTo, insert: incoming.slice(from, incomingTo)}
}

export function synchronizeExternalEditorState(state: EditorState, value: string): EditorState {
    const current = state.doc.toString()
    if (current === value) return state
    return state.update({
        changes: minimalReplacement(current, value),
        annotations: Transaction.addToHistory.of(false),
    }).state
}
