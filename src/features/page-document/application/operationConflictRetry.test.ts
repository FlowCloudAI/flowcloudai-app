// 这里锁定可视 operation 只在修订冲突时刷新并重试一次，避免上传资产后因陈旧快照留下孤立引用。
import assert from 'node:assert/strict'
import test from 'node:test'
import {runWithOneConflictRetry} from './operationConflictRetry.ts'

test('首次成功时不刷新上下文', async () => {
    let refreshes = 0
    const outcome = await runWithOneConflictRetry({
        initialContext: {revision: 4},
        execute: async context => context.revision + 1,
        refresh: async () => {
            refreshes += 1
            return {revision: 5}
        },
        isConflict: () => false,
    })

    assert.deepEqual(outcome, {context: {revision: 4}, value: 5, retried: false})
    assert.equal(refreshes, 0)
})

test('修订冲突后使用最新上下文重试一次', async () => {
    const attemptedRevisions: number[] = []
    const conflict = new Error('revision conflict')
    const outcome = await runWithOneConflictRetry({
        initialContext: {revision: 4},
        execute: async context => {
            attemptedRevisions.push(context.revision)
            if (context.revision === 4) throw conflict
            return context.revision + 1
        },
        refresh: async () => ({revision: 7}),
        isConflict: error => error === conflict,
    })

    assert.deepEqual(attemptedRevisions, [4, 7])
    assert.deepEqual(outcome, {context: {revision: 7}, value: 8, retried: true})
})

test('非冲突错误以及第二次失败都原样抛出', async () => {
    const ordinary = new Error('ordinary failure')
    await assert.rejects(
        runWithOneConflictRetry({
            initialContext: {revision: 1},
            execute: async () => {
                throw ordinary
            },
            refresh: async () => ({revision: 2}),
            isConflict: () => false,
        }),
        error => error === ordinary,
    )

    const conflict = new Error('revision conflict')
    const retryFailure = new Error('retry failure')
    let attempts = 0
    await assert.rejects(
        runWithOneConflictRetry({
            initialContext: {revision: 1},
            execute: async () => {
                attempts += 1
                if (attempts === 1) throw conflict
                throw retryFailure
            },
            refresh: async () => ({revision: 2}),
            isConflict: error => error === conflict,
        }),
        error => error === retryFailure,
    )
    assert.equal(attempts, 2)
})
