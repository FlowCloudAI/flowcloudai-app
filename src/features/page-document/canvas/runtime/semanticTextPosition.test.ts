import assert from 'node:assert/strict'
import test from 'node:test'
import {DOMParser} from '@xmldom/xmldom'
import {
    locateTextOffset,
    semanticLength,
    semanticOffset,
    semanticText,
} from './semanticTextPosition.ts'

function parseRoot(markup: string): Node {
    const document = new DOMParser().parseFromString(`<root>${markup}</root>`, 'application/xml')
    return document.documentElement as unknown as Node
}

function assertRoundTrip(markup: string, expectedText: string): void {
    const root = parseRoot(markup)
    assert.equal(semanticText(root), expectedText)
    assert.equal(semanticLength(root), expectedText.length)
    for (let offset = 0; offset <= expectedText.length; offset += 1) {
        const position = locateTextOffset(root, offset)
        assert.ok(position, `应能定位偏移 ${offset}`)
        assert.equal(semanticOffset(root, position.node, position.offset), offset)
    }
}

test('语义偏移与 DOM 位置对 span、嵌套 span 和 br 严格互逆', () => {
    assertRoundTrip('前<span>中<span>内</span>后</span><br/>尾', '前中内后\n尾')
    assertRoundTrip('<span>首</span>中<span>尾</span>', '首中尾')
    assertRoundTrip('<span>左</span><span>右</span>', '左右')
})

test('行内元素边界归属共同父级而不归属任一相邻 span', () => {
    const root = parseRoot('<span>左</span><span>右</span>')
    const between = locateTextOffset(root, 1)
    assert.ok(between)
    assert.equal(between.node, root)
    assert.equal(between.offset, 1)

    const start = locateTextOffset(root, 0)
    const end = locateTextOffset(root, 2)
    assert.equal(start?.node, root)
    assert.equal(start?.offset, 0)
    assert.equal(end?.node, root)
    assert.equal(end?.offset, 2)
})

test('嵌套行内元素的内部边界归属仍保持在外层 span', () => {
    const root = parseRoot('<span>前<span>内</span>后</span>')
    const outer = root.firstChild
    assert.ok(outer)

    const beforeInner = locateTextOffset(root, 1)
    const afterInner = locateTextOffset(root, 2)
    assert.equal(beforeInner?.node, outer)
    assert.equal(beforeInner?.offset, 1)
    assert.equal(afterInner?.node, outer)
    assert.equal(afterInner?.offset, 2)
})

test('br 的前后边界分别定位到父级两侧且语义为换行', () => {
    const root = parseRoot('前<br/>后')
    const beforeBreak = locateTextOffset(root, 1)
    const afterBreak = locateTextOffset(root, 2)
    assert.equal(beforeBreak?.node, root)
    assert.equal(beforeBreak?.offset, 1)
    assert.equal(afterBreak?.node, root)
    assert.equal(afterBreak?.offset, 2)
    assert.equal(semanticText(root), '前\n后')
})

test('非法偏移与根外 DOM 位置被拒绝', () => {
    const root = parseRoot('<span>正文</span>')
    const outside = parseRoot('外部')
    assert.equal(locateTextOffset(root, -1), null)
    assert.equal(locateTextOffset(root, 3), null)
    assert.equal(semanticOffset(root, outside, 0), null)
})
