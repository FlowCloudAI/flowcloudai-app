// 本测试冻结文档写操作的接收顺序；连续图形输入还应在入队前压缩为最后一个值。
import assert from 'node:assert/strict'
import test from 'node:test'
import {createLiveVisualCommitScheduler} from './liveVisualCommitScheduler.ts'
import {createVisualOperationQueue} from './visualOperationQueue.ts'

function fakeTimer() {
    let nextId = 0
    const callbacks = new Map<number, () => void>()
    return {
        timer: {
            set(callback: () => void) {
                nextId += 1
                callbacks.set(nextId, callback)
                return nextId
            },
            clear(handle: unknown) {
                callbacks.delete(handle as number)
            },
        },
        runAll() {
            const pending = [...callbacks.values()]
            callbacks.clear()
            pending.forEach(callback => callback())
        },
        size: () => callbacks.size,
    }
}

function deferred(): {promise: Promise<void>; resolve: () => void} {
    let resolve: () => void = () => {}
    const promise = new Promise<void>(done => {
        resolve = done
    })
    return {promise, resolve}
}

test('连续提交的可视操作按接收顺序执行', async () => {
    const queue = createVisualOperationQueue()
    const firstGate = deferred()
    const events: string[] = []

    const first = queue.enqueue(async () => {
        events.push('first:start')
        await firstGate.promise
        events.push('first:end')
        return 1
    })
    const second = queue.enqueue(async () => {
        events.push('second:start')
        return 2
    })

    await Promise.resolve()
    assert.deepEqual(events, ['first:start'])
    firstGate.resolve()

    assert.deepEqual(await Promise.all([first, second]), [1, 2])
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start'])
})

test('前一项失败后仍会执行下一项', async () => {
    const queue = createVisualOperationQueue()
    const failure = queue.enqueue(async () => {
        throw new Error('expected failure')
    })
    const success = queue.enqueue(async () => 'continued')

    await assert.rejects(failure, /expected failure/)
    assert.equal(await success, 'continued')
})

test('实时属性防抖窗口内只提交最后一个值，flush 可以立即提交', async () => {
    const clock = fakeTimer()
    const committed: number[] = []
    const statuses: string[] = []
    const scheduler = createLiveVisualCommitScheduler<number>({
        delayMs: 140,
        timer: clock.timer,
        commit: async value => {
            committed.push(value)
            return true
        },
        onStatus: status => statuses.push(status),
    })

    scheduler.schedule(1)
    scheduler.schedule(2)
    scheduler.schedule(3)
    assert.equal(clock.size(), 1)
    scheduler.flush()
    await Promise.resolve()

    assert.deepEqual(committed, [3])
    assert.equal(statuses.at(-1), 'applied')
})

test('实时属性提交进行中只保留较新的待提交值', async () => {
    const clock = fakeTimer()
    const committed: number[] = []
    let releaseFirst: ((accepted: boolean) => void) | undefined
    const scheduler = createLiveVisualCommitScheduler<number>({
        delayMs: 140,
        timer: clock.timer,
        commit: value => {
            committed.push(value)
            if (value !== 1) return Promise.resolve(true)
            return new Promise(resolve => {
                releaseFirst = resolve
            })
        },
        onStatus: () => undefined,
    })

    scheduler.schedule(1, {immediate: true})
    clock.runAll()
    scheduler.schedule(2)
    scheduler.schedule(3)
    releaseFirst?.(true)
    await Promise.resolve()
    clock.runAll()
    await Promise.resolve()

    assert.deepEqual(committed, [1, 3])
})

test('实时属性取消尚未开始的提交后不会写入旧元素', () => {
    const clock = fakeTimer()
    const committed: number[] = []
    const scheduler = createLiveVisualCommitScheduler<number>({
        delayMs: 140,
        timer: clock.timer,
        commit: async value => {
            committed.push(value)
            return true
        },
        onStatus: () => undefined,
    })

    scheduler.schedule(1)
    scheduler.cancel()
    clock.runAll()

    assert.deepEqual(committed, [])
})

test('实时属性防抖会把最终值与同一次交互身份一并提交', async () => {
    const clock = fakeTimer()
    const committed: Array<{value: number; historyGroupId?: string}> = []
    const scheduler = createLiveVisualCommitScheduler<number>({
        delayMs: 140,
        timer: clock.timer,
        commit: async (value, metadata) => {
            committed.push({value, historyGroupId: metadata.historyGroupId})
            return true
        },
        onStatus: () => undefined,
    })

    scheduler.schedule(1, {historyGroupId: 'drag-1'})
    scheduler.schedule(2, {historyGroupId: 'drag-1'})
    scheduler.flush()
    await Promise.resolve()

    assert.deepEqual(committed, [{value: 2, historyGroupId: 'drag-1'}])
})
