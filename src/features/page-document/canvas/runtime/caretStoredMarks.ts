// 本模块拥有画布光标及其待输入标记；宿主只通过协议更新标记并展示这里回报的快照。

import type {CanvasStoredMarks} from '../protocol/index.ts'
import type {CanvasTextSelectionSnapshot} from './inputPolicy.ts'

export interface CanvasCaretStoredMarksState {
    readonly selection: CanvasTextSelectionSnapshot | null
    readonly storedMarks: CanvasStoredMarks | null
    observeSelection(selection: CanvasTextSelectionSnapshot | null): void
    restoreSelection(selection: CanvasTextSelectionSnapshot): void
    updateStoredMarks(mode: 'merge' | 'replace', storedMarks: CanvasStoredMarks | null): boolean
    authorPointer(): void
    authorDirection(): void
    beginComposition(nodeId: string): void
    clearStoredMarks(): void
    exitEditing(): void
}

function freezeStoredMarks(storedMarks: CanvasStoredMarks): CanvasStoredMarks {
    return Object.freeze({
        styleContext: storedMarks.styleContext,
        values: Object.freeze({...storedMarks.values}),
    })
}

/**
 * DOM 重挂只调用 restoreSelection，因此不会触发作者手势清理；普通 DOM 观察仅在目标节点
 * 改变或形成非折叠选区时清理。指针、方向键与组合起点则由各自事件显式标记因果。
 */
export function createCanvasCaretStoredMarksState(): CanvasCaretStoredMarksState {
    let selection: CanvasTextSelectionSnapshot | null = null
    let storedMarks: CanvasStoredMarks | null = null
    return {
        get selection() {
            return selection
        },
        get storedMarks() {
            return storedMarks
        },
        observeSelection(next) {
            const targetChanged = Boolean(selection && next && selection.nodeId !== next.nodeId)
            selection = next
            if (!next || !next.collapsed || targetChanged) storedMarks = null
        },
        restoreSelection(next) {
            selection = next
        },
        updateStoredMarks(mode, next) {
            if (!selection?.collapsed) return false
            if (mode === 'replace') {
                storedMarks = next ? freezeStoredMarks(next) : null
                return true
            }
            if (!next) return false
            storedMarks = freezeStoredMarks({
                styleContext: next.styleContext,
                values: storedMarks?.styleContext === next.styleContext
                    ? {...storedMarks.values, ...next.values}
                    : next.values,
            })
            return true
        },
        authorPointer() {
            storedMarks = null
        },
        authorDirection() {
            storedMarks = null
        },
        beginComposition(nodeId) {
            if (selection?.nodeId !== nodeId) storedMarks = null
        },
        clearStoredMarks() {
            storedMarks = null
        },
        exitEditing() {
            selection = null
            storedMarks = null
        },
    }
}
