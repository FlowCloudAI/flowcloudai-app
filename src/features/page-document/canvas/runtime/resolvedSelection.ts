// 本模块在安全重挂 DOM 后恢复宿主确认的光标；目标尚未出现时保留回执给下一帧。

import type {CanvasTextSelectionSnapshot} from './inputPolicy.ts'

export interface CanvasResolvedSelection {
    readonly nodeId: string
    readonly offset: number
}

export interface CanvasResolvedSelectionResult {
    readonly restoredSelection: CanvasTextSelectionSnapshot | null
    readonly pendingSelection: CanvasResolvedSelection | null
}

export function restoreCanvasResolvedSelection(
    selection: CanvasResolvedSelection,
    findNode: (nodeId: string) => Pick<HTMLElement, 'focus'> | null,
    restoreTextSelection: (snapshot: CanvasTextSelectionSnapshot) => boolean,
): CanvasResolvedSelectionResult {
    const node = findNode(selection.nodeId)
    if (!node) return {restoredSelection: null, pendingSelection: selection}
    node.focus({preventScroll: true})
    const snapshot: CanvasTextSelectionSnapshot = {
        nodeId: selection.nodeId,
        from: selection.offset,
        to: selection.offset,
        expected: '',
        collapsed: true,
    }
    return restoreTextSelection(snapshot)
        ? {restoredSelection: snapshot, pendingSelection: null}
        : {restoredSelection: null, pendingSelection: selection}
}
