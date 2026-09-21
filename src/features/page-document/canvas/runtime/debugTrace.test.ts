import assert from 'node:assert/strict'
import test from 'node:test'
import {DOMParser} from '@xmldom/xmldom'
import type {CanvasDebugLogEntry} from '../protocol/index.ts'
import {CANVAS_DEBUG_BATCH_MAX_ENTRIES, CANVAS_DEBUG_DETAIL_MAX_CODE_UNITS} from '../protocol/index.ts'
import {createCanvasDebugTrace, debugDetailText, describeDomPosition} from './debugTrace.ts'

function harness() {
    const sent: CanvasDebugLogEntry[][] = []
    const pending: (() => void)[] = []
    let clock = 1_000
    const trace = createCanvasDebugTrace(
        entries => sent.push(entries),
        () => clock++,
        callback => pending.push(callback),
    )
    return {sent, trace, runTimers: () => pending.splice(0).forEach(callback => callback())}
}

test('未开启时不缓冲也不发送', () => {
    const {sent, trace, runTimers} = harness()
    trace.trace('keydown', {key: 'a'})
    runTimers()
    assert.equal(sent.length, 0)
})

test('开启后按批发送，时间戳单调且保持顺序', () => {
    const {sent, trace, runTimers} = harness()
    trace.setEnabled(true)
    trace.trace('keydown', {key: 'a'})
    trace.trace('beforeinput', {inputType: 'insertText'})
    assert.equal(sent.length, 0)
    runTimers()
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0].map(entry => entry.kind), ['keydown', 'beforeinput'])
    assert.ok(sent[0][0].at < sent[0][1].at)
})

test('达到批量上限立即发送，单批不超过上限', () => {
    const {sent, trace} = harness()
    trace.setEnabled(true)
    for (let index = 0; index < CANVAS_DEBUG_BATCH_MAX_ENTRIES; index += 1) trace.trace('tick', index)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].length, CANVAS_DEBUG_BATCH_MAX_ENTRIES)
})

test('关闭时丢弃缓冲', () => {
    const {sent, trace, runTimers} = harness()
    trace.setEnabled(true)
    trace.trace('keydown')
    trace.setEnabled(false)
    runTimers()
    assert.equal(sent.length, 0)
})

test('零宽填充字符在日志中可见，超长内容被截断', () => {
    assert.equal(debugDetailText('上\u200B下'), '上⟦ZWSP⟧下')
    const long = debugDetailText('x'.repeat(CANVAS_DEBUG_DETAIL_MAX_CODE_UNITS * 2))
    assert.ok(long.length <= CANVAS_DEBUG_DETAIL_MAX_CODE_UNITS)
    assert.match(long, /截断/u)
})

test('DOM 位置描述从受管节点出发并标出锚点与文本内容', () => {
    const parsed = new DOMParser().parseFromString(
        '<p data-fc-node-id="1a2b3c4d-0000-4000-8000-000000000000">上<br/><span data-fc-canvas-caret-anchor="">\u200B</span></p>',
        'application/xml',
    )
    const root = parsed.documentElement as unknown as Node
    const anchor = root.childNodes[2] as Node
    const filler = anchor.firstChild as Node
    assert.equal(
        describeDomPosition(root, filler, 1),
        'p#1a2b3c4d/span(锚点)[2]/#text[0]@1 "⟦ZWSP⟧"',
    )
    assert.equal(describeDomPosition(root, root, 2), 'p#1a2b3c4d@2')
    assert.equal(describeDomPosition(null, null, 0), '无')
})
