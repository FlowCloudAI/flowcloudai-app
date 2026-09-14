// 本模块把连续图形输入压缩为最新一次提交；它只传递历史分组，不理解或持久化文档内容。
import type {DocumentHistoryOptions} from './documentDraftModel.ts'

export type LiveVisualCommitStatus = 'idle' | 'pending' | 'applying' | 'applied' | 'error'

export type LiveVisualCommitMetadata = DocumentHistoryOptions

export interface LiveVisualScheduleOptions extends LiveVisualCommitMetadata {
    immediate?: boolean
}

export interface LiveVisualCommitScheduler<T> {
    schedule: (value: T, options?: LiveVisualScheduleOptions) => void
    flush: () => void
    cancel: () => void
    dispose: () => void
}

interface SchedulerTimer {
    set: (callback: () => void, delayMs: number) => unknown
    clear: (handle: unknown) => void
}

interface LiveVisualCommitSchedulerOptions<T> {
    delayMs: number
    commit: (value: T, metadata: LiveVisualCommitMetadata) => Promise<boolean>
    onStatus: (status: LiveVisualCommitStatus) => void
    onRejected?: () => void
    timer?: SchedulerTimer
}

const browserTimer: SchedulerTimer = {
    set: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clear: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** 同一等待窗口只提交最后一个值；提交中的新值会等待前一项完成，绝不并发写草稿。 */
export function createLiveVisualCommitScheduler<T>({
    delayMs,
    commit,
    onStatus,
    onRejected,
    timer = browserTimer,
}: LiveVisualCommitSchedulerOptions<T>): LiveVisualCommitScheduler<T> {
    let timerHandle: unknown | null = null
    let pendingValue: T | undefined
    let pendingMetadata: LiveVisualCommitMetadata = {}
    let hasPendingValue = false
    let applying = false
    let flushAfterApply = false
    let generation = 0
    let disposed = false

    const clearTimer = () => {
        if (timerHandle === null) return
        timer.clear(timerHandle)
        timerHandle = null
    }

    const rejectPending = () => {
        pendingValue = undefined
        pendingMetadata = {}
        hasPendingValue = false
        clearTimer()
        onRejected?.()
        onStatus('error')
    }

    const applyLatest = async () => {
        if (disposed || applying || !hasPendingValue) return
        const value = pendingValue as T
        const metadata = pendingMetadata
        const operationGeneration = generation
        pendingValue = undefined
        pendingMetadata = {}
        hasPendingValue = false
        applying = true
        onStatus('applying')

        let accepted = false
        try {
            accepted = await commit(value, metadata)
        } catch {
            accepted = false
        }
        applying = false

        if (disposed) return
        if (operationGeneration !== generation) {
            if (hasPendingValue) arm(flushAfterApply ? 0 : delayMs)
            flushAfterApply = false
            return
        }
        if (!accepted) {
            flushAfterApply = false
            rejectPending()
            return
        }
        if (hasPendingValue) {
            onStatus('pending')
            arm(flushAfterApply ? 0 : delayMs)
            flushAfterApply = false
            return
        }
        flushAfterApply = false
        onStatus('applied')
    }

    const arm = (waitMs: number) => {
        clearTimer()
        timerHandle = timer.set(() => {
            timerHandle = null
            void applyLatest()
        }, waitMs)
    }

    return {
        schedule(value, options = {}) {
            if (disposed) return
            pendingValue = value
            pendingMetadata = {
                historyGroupId: options.historyGroupId,
            }
            hasPendingValue = true
            onStatus('pending')
            if (applying) {
                flushAfterApply ||= options.immediate ?? false
                return
            }
            if (options.immediate) {
                clearTimer()
                void applyLatest()
                return
            }
            arm(delayMs)
        },
        flush() {
            if (disposed || !hasPendingValue) return
            if (applying) {
                flushAfterApply = true
                return
            }
            clearTimer()
            void applyLatest()
        },
        cancel() {
            generation += 1
            pendingValue = undefined
            pendingMetadata = {}
            hasPendingValue = false
            flushAfterApply = false
            clearTimer()
            onStatus('idle')
        },
        dispose() {
            disposed = true
            generation += 1
            pendingValue = undefined
            pendingMetadata = {}
            hasPendingValue = false
            clearTimer()
        },
    }
}
