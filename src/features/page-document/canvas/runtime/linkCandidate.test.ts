// 本测试固定双链候选的受管文本范围、意图身份复用与取消语义，避免连续输入重复触发。

import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {createCanvasLinkCandidateTracker, findCanvasLinkCandidate} from './linkCandidate.ts'

const NODE_ID = '018f47a2-3b4c-7d5e-8f90-123456789abc'
const OTHER_NODE_ID = '44444444-4444-4444-8444-444444444444'
const FIRST_INTENT = '55555555-5555-4555-8555-555555555555'
const SECOND_INTENT = '66666666-6666-4666-8666-666666666666'

test('双链候选按当前块的 UTF-16 光标偏移提取未闭合的 [[ 查询', () => {
    assert.deepEqual(findCanvasLinkCandidate('前文[[词条', 6), {query: '词条', from: 2, to: 6})
    assert.deepEqual(findCanvasLinkCandidate('[[', 2), {query: '', from: 0, to: 2})
    assert.equal(findCanvasLinkCandidate('[[词条]]', 6), null)
    assert.equal(findCanvasLinkCandidate('普通正文', 4), null)
    assert.equal(findCanvasLinkCandidate(`[[${'字'.repeat(201)}`, 203), null)
    assert.equal(findCanvasLinkCandidate('[[字', 65_537), null)
})

test('同一双链候选复用 intentId，只有查询或区间变化才再次上报', () => {
    const tracker = createCanvasLinkCandidateTracker(() => FIRST_INTENT)
    const first = tracker.update({nodeId: NODE_ID, text: '[[词', caret: 3})
    assert.deepEqual(first, [{type: 'link-candidate-intent', intentId: FIRST_INTENT, nodeId: NODE_ID, query: '词', from: 0, to: 3}])
    assert.deepEqual(tracker.update({nodeId: NODE_ID, text: '[[词', caret: 3}), [])
    assert.deepEqual(tracker.update({nodeId: NODE_ID, text: '[[词条', caret: 4}), [
        {type: 'link-candidate-intent', intentId: FIRST_INTENT, nodeId: NODE_ID, query: '词条', from: 0, to: 4},
    ])
    assert.deepEqual(tracker.clear(), {
        type: 'link-candidate-intent', intentId: FIRST_INTENT, nodeId: NODE_ID, query: null, from: 0, to: 4,
    })
    assert.equal(tracker.clear(), null)
})

test('光标离开节点先取消旧候选，进入另一节点分配新 intentId', () => {
    const ids = [FIRST_INTENT, SECOND_INTENT]
    const tracker = createCanvasLinkCandidateTracker(() => ids.shift() ?? '')
    tracker.update({nodeId: NODE_ID, text: '[[甲', caret: 3})
    assert.deepEqual(tracker.update({nodeId: OTHER_NODE_ID, text: '[[乙', caret: 3}), [
        {type: 'link-candidate-intent', intentId: FIRST_INTENT, nodeId: NODE_ID, query: null, from: 0, to: 3},
        {type: 'link-candidate-intent', intentId: SECOND_INTENT, nodeId: OTHER_NODE_ID, query: '乙', from: 0, to: 3},
    ])
    assert.deepEqual(tracker.update(null), [
        {type: 'link-candidate-intent', intentId: SECOND_INTENT, nodeId: OTHER_NODE_ID, query: null, from: 0, to: 3},
    ])
})

test('运行时在受控写入后及原生 input 后检测，组合期间不报告，Escape 可取消', () => {
    const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
    assert.match(source, /send\(\{\s*type: 'input-intent',[\s\S]*?\}\s*satisfies[\s\S]*?reportLinkCandidate\(\)/u)
    assert.match(source, /addEventListener\('input',[\s\S]*?reportLinkCandidate\(\)/u)
    assert.match(source, /addEventListener\('selectionchange',[\s\S]*?reportLinkCandidate\(\)/u)
    assert.match(source, /if \(!editingEnabled \|\| composition\.isComposing\) return/u)
    assert.match(source, /event\.key === 'Escape'[\s\S]*?linkCandidate\.clear\(\)/u)
})
