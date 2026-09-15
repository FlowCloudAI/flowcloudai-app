// 本测试锁定内联运行时的 DOM 就绪顺序，并保证启动错误既可诊断又不会泄露会话 token。

import assert from 'node:assert/strict'
import test from 'node:test'
import {requireCanvasStartupContext, startCanvasRuntimeWhenReady} from './startup.ts'

test('文档仍在解析时延迟到 DOMContentLoaded 才启动画布', () => {
    let listener: (() => void) | null = null
    let options: AddEventListenerOptions | boolean | undefined
    const documentScope = {
        readyState: 'loading',
        addEventListener(type: string, callback: EventListenerOrEventListenerObject, nextOptions?: AddEventListenerOptions | boolean) {
            assert.equal(type, 'DOMContentLoaded')
            listener = typeof callback === 'function' ? () => callback(new Event(type)) : () => callback.handleEvent(new Event(type))
            options = nextOptions
        },
    } as unknown as Document
    let starts = 0

    startCanvasRuntimeWhenReady(documentScope, () => {
        starts += 1
    })

    assert.equal(starts, 0)
    assert.deepEqual(options, {once: true})
    assert.ok(listener)
    listener()
    assert.equal(starts, 1)

    const readyDocument = {
        readyState: 'complete',
        addEventListener: () => assert.fail('DOM 已就绪时不应注册 DOMContentLoaded'),
    } as unknown as Document
    startCanvasRuntimeWhenReady(readyDocument, () => {
        starts += 1
    })
    assert.equal(starts, 2)
})

test('缺少 token 时给出专用错误且不回显候选值', () => {
    const invalidToken = 'not-a-session-token'
    const documentScope = {querySelector: () => ({})} as unknown as Document
    const windowScope = {location: {hash: `#token=${invalidToken}`}} as Pick<Window, 'location'>

    assert.throws(
        () => requireCanvasStartupContext(documentScope, windowScope),
        error => error instanceof Error
            && error.message === '隔离画布缺少可信会话令牌。'
            && !error.message.includes(invalidToken),
    )
})

test('token 合法但缺少根节点时给出不同错误', () => {
    const token = 'ab'.repeat(32)
    const documentScope = {querySelector: () => null} as unknown as Document
    const windowScope = {location: {hash: `#token=${token}`}} as Pick<Window, 'location'>

    assert.throws(
        () => requireCanvasStartupContext(documentScope, windowScope),
        error => error instanceof Error
            && error.message === '隔离画布缺少根节点。'
            && !error.message.includes(token),
    )
})
