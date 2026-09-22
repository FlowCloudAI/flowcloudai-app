import assert from 'node:assert/strict'
import test from 'node:test'
import {createStructuralInputFence} from './structuralInputFence.ts'

test('围栏期间的输入按序缓冲，结束时一次取出', () => {
    const fence = createStructuralInputFence()
    fence.begin('AAAA0000-0000-7000-8000-000000000000')
    assert.equal(fence.intentId, 'aaaa0000-0000-7000-8000-000000000000')
    fence.enqueue({inputType: 'insertText', text: '新'})
    fence.enqueue({inputType: 'deleteContentBackward', text: ''})
    fence.enqueue({inputType: 'insertCompositionText', text: '段落'})
    assert.deepEqual(fence.release(), [
        {inputType: 'insertText', text: '新'},
        {inputType: 'deleteContentBackward', text: ''},
        {inputType: 'insertCompositionText', text: '段落'},
    ])
    assert.equal(fence.intentId, null)
    assert.deepEqual(fence.release(), [])
})

test('未处于围栏时不缓冲', () => {
    const fence = createStructuralInputFence()
    fence.enqueue({inputType: 'insertText', text: '旧'})
    assert.deepEqual(fence.release(), [])
})

test('重放中再次拆块会开启新围栏，后续输入继续排在其后', () => {
    const fence = createStructuralInputFence()
    fence.begin('bbbb0000-0000-7000-8000-000000000000')
    fence.enqueue({inputType: 'insertParagraph', text: ''})
    fence.enqueue({inputType: 'insertText', text: '尾'})
    const released = fence.release()
    fence.begin('cccc0000-0000-7000-8000-000000000000')
    fence.enqueue(released[1])
    assert.deepEqual(fence.release(), [{inputType: 'insertText', text: '尾'}])
})
