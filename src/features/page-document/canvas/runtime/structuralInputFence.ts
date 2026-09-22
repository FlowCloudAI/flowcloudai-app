/**
 * 拆块围栏：Shift+Enter 提交后到新块挂载、光标落进新块之前，画布里还没有新块，
 * 这段时间（实测约 80 ms）键入的文字会落进旧块的拆分点。围栏期间的输入先按序缓冲，
 * 落点就绪、拆块被拒或超时后再在当时的光标处重放。
 *
 * 只缓冲输入类型与文字：删除类输入的范围必须按重放时的光标重新展开，不能沿用旧块里的快照。
 */

import type {CanvasInputType} from '../protocol/index.ts'

export interface FencedCanvasInput {
    readonly inputType: CanvasInputType
    readonly text: string
}

export interface StructuralInputFence {
    readonly intentId: string | null
    begin(intentId: string): void
    enqueue(input: FencedCanvasInput): void
    /** 结束当前围栏并取出全部缓冲；未处于围栏时返回空数组。 */
    release(): FencedCanvasInput[]
}

export function createStructuralInputFence(): StructuralInputFence {
    let intentId: string | null = null
    let queued: FencedCanvasInput[] = []
    return {
        get intentId() {
            return intentId
        },
        begin(next) {
            intentId = next.toLowerCase()
        },
        enqueue(input) {
            if (intentId !== null) queued.push(input)
        },
        release() {
            intentId = null
            const released = queued
            queued = []
            return released
        },
    }
}
