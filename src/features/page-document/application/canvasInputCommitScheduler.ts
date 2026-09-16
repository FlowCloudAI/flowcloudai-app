// 本模块在宿主侧合并连续画布输入；范围先对纯文本暂存态复核，再把一个窗口内的意图批量交给内核。

import type {CanvasInputIntentMessage} from '../canvas/protocol/index.ts'
import {applyCanvasInputToText} from './canvasInputOperation.ts'
import {
    createLiveVisualCommitScheduler,
    type LiveVisualCommitMetadata,
    type LiveVisualCommitScheduler,
} from './liveVisualCommitScheduler.ts'

interface CanvasInputBatch {
    readonly nodeId: string
    readonly historyGroupId: string
    readonly messages: readonly CanvasInputIntentMessage[]
}

export interface CanvasInputCommitScheduler {
    schedule(message: CanvasInputIntentMessage, options?: {immediate?: boolean}): Promise<boolean>
    flush(): Promise<boolean>
    endInteraction(): Promise<boolean>
    cancel(): void
}

interface CanvasInputCommitSchedulerOptions {
    delayMs: number
    readNodeText(nodeId: string): string | null
    commit(
        messages: readonly CanvasInputIntentMessage[],
        metadata: LiveVisualCommitMetadata,
    ): Promise<boolean>
    createHistoryGroupId?: () => string
}

/**
 * 调度器会在 commit 开始前切走当前批次，所以提交中的新按键会进入下一批，
 * 且下一批只会在前一批完成后应用到已经前进的草稿。
 */
export function createCanvasInputCommitScheduler({
    delayMs,
    readNodeText,
    commit,
    createHistoryGroupId = () => `canvas-input-history:${crypto.randomUUID()}`,
}: CanvasInputCommitSchedulerOptions): CanvasInputCommitScheduler {
    let pendingBatch: CanvasInputBatch | null = null
    let activeNodeId: string | null = null
    let historyGroupId: string | null = null
    const stagedText = new Map<string, string>()
    let latestCompletion = Promise.resolve(true)

    const resetStagedText = () => stagedText.clear()
    const forgetEndedText = (nodeId: string, completion: Promise<boolean>) => {
        void completion.then(() => {
            if (activeNodeId !== nodeId && pendingBatch?.nodeId !== nodeId) {
                stagedText.delete(nodeId)
            }
        })
    }
    const scheduler: LiveVisualCommitScheduler<CanvasInputBatch> = createLiveVisualCommitScheduler<CanvasInputBatch>({
        delayMs,
        commit: async (batch, metadata) => {
            if (pendingBatch === batch) pendingBatch = null
            const accepted = await commit(batch.messages, metadata)
            if (!accepted) resetStagedText()
            return accepted
        },
        onStatus: () => undefined,
        onRejected: resetStagedText,
    })

    const beginInteraction = (nodeId: string): string => {
        if (activeNodeId !== nodeId) {
            scheduler.flush()
            activeNodeId = nodeId
            historyGroupId = null
        }
        historyGroupId ??= createHistoryGroupId()
        return historyGroupId
    }

    const schedule = (
        message: CanvasInputIntentMessage,
        options: {immediate?: boolean} = {},
    ): Promise<boolean> => {
        const nodeId = message.nodeId.toLowerCase()
        if (pendingBatch && pendingBatch.nodeId !== nodeId) {
            scheduler.flush()
            const previous = latestCompletion
            return previous.then(accepted => accepted ? schedule(message, options) : false)
        }
        const groupId = beginInteraction(nodeId)
        const currentText = stagedText.get(nodeId) ?? readNodeText(nodeId)
        if (currentText === null) return Promise.resolve(false)
        const update = applyCanvasInputToText(currentText, message)
        if (!update.accepted) return Promise.resolve(false)
        stagedText.set(nodeId, update.text)
        const messages = pendingBatch?.nodeId === nodeId
            ? [...pendingBatch.messages, message]
            : [message]
        const batch = Object.freeze({
            nodeId,
            historyGroupId: groupId,
            messages: Object.freeze(messages),
        })
        pendingBatch = batch
        const completion = scheduler.schedule(batch, {
            immediate: options.immediate,
            historyGroupId: groupId,
        })
        latestCompletion = completion
        void completion.then(() => {
            if (latestCompletion === completion) latestCompletion = Promise.resolve(true)
        })
        if (options.immediate) {
            activeNodeId = null
            historyGroupId = null
            forgetEndedText(nodeId, completion)
        }
        return completion
    }

    return {
        schedule,
        flush() {
            scheduler.flush()
            return latestCompletion
        },
        endInteraction() {
            scheduler.flush()
            const endedNodeId = activeNodeId
            const completion = latestCompletion
            activeNodeId = null
            historyGroupId = null
            if (endedNodeId) forgetEndedText(endedNodeId, completion)
            return completion
        },
        cancel() {
            scheduler.cancel()
            pendingBatch = null
            activeNodeId = null
            historyGroupId = null
            resetStagedText()
        },
    }
}
