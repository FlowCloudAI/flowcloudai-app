// 本模块在安全重挂 DOM 后恢复宿主确认的光标；目标尚未出现时保留回执给下一帧。

import type {CanvasTextSelectionSnapshot} from './inputPolicy.ts'
import type {CanvasRenderCommand} from '../protocol/index.ts'

export interface CanvasResolvedSelection {
    readonly nodeId: string
    readonly offset: number
}

export interface CanvasResolvedSelectionResult {
    readonly restoredSelection: CanvasTextSelectionSnapshot | null
    readonly pendingSelection: CanvasResolvedSelection | null
}

/**
 * 最后一个待决输入结算时，处理组合或输入期间暂存的预览。
 *
 * 宿主总是先发回执、再在草稿提交后的下一帧发出该次提交的预览，因此成功回执到达时暂存的预览
 * 必然早于这次提交：挂载它会把刚输入的文字短暂撤回，并让宿主落点在旧文本里越界、光标跳走。
 * 成功时丢弃它，落点留给随后到达的预览；只有拒绝时宿主会先补发当前草稿，挂载它完成回滚。
 */
export function settleCanvasInputRender(
    render: CanvasRenderCommand | null,
    rejected: boolean,
    rollbackSelection: CanvasResolvedSelection | null,
    applyRender: (render: CanvasRenderCommand, selection: CanvasResolvedSelection | null) => void,
): 'applied' | 'discarded' | 'none' {
    if (!render) return 'none'
    if (!rejected) return 'discarded'
    applyRender(render, rollbackSelection)
    return 'applied'
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
