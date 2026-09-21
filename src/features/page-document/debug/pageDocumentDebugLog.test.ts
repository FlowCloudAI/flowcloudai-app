import assert from 'node:assert/strict'
import test from 'node:test'
import {
    appendCanvasDebugEntries,
    clearPageDocumentDebugLog,
    debugLog,
    formatPageDocumentDebugLog,
    pageDocumentDebugEntries,
    setPageDocumentDebugEnabled,
} from './pageDocumentDebugLog.ts'

test('未开启时宿主与画布日志都不记录', () => {
    setPageDocumentDebugEnabled(false)
    clearPageDocumentDebugLog()
    debugLog('send:render', {requestId: 'a'})
    appendCanvasDebugEntries([{at: 1, kind: 'keydown', detail: ''}])
    assert.equal(pageDocumentDebugEntries().length, 0)
})

test('画布批量回传的较早事件按时间戳排在宿主事件之前', () => {
    setPageDocumentDebugEnabled(true)
    clearPageDocumentDebugLog()
    debugLog('recv:input-intent', {intentId: 'x'})
    const hostAt = pageDocumentDebugEntries()[0].at
    appendCanvasDebugEntries([
        {at: hostAt - 5, kind: 'keydown', detail: '{"key":"a"}'},
        {at: hostAt - 4, kind: 'beforeinput', detail: '{"inputType":"insertText"}'},
    ])
    assert.deepEqual(
        pageDocumentDebugEntries().map(entry => `${entry.source}:${entry.kind}`),
        ['canvas:keydown', 'canvas:beforeinput', 'host:recv:input-intent'],
    )
    setPageDocumentDebugEnabled(false)
})

test('导出文本含说明头与来源标签，零宽字符可见', () => {
    setPageDocumentDebugEnabled(true)
    clearPageDocumentDebugLog()
    debugLog('draft', {html: '<p>上\u200B</p>'})
    const text = formatPageDocumentDebugLog({entryId: 'e'})
    assert.match(text, /^FlowCloudAI 页面编辑调试日志/u)
    assert.match(text, /\[宿主\] draft/u)
    assert.match(text, /⟦ZWSP⟧/u)
    assert.doesNotMatch(text, /\u200B/u)
    setPageDocumentDebugEnabled(false)
})
