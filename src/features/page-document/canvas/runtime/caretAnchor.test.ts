import assert from 'node:assert/strict'
import test from 'node:test'
import {DOMParser} from '@xmldom/xmldom'
import {
    CARET_ANCHOR_ATTRIBUTE,
    CARET_ANCHOR_FILLER,
    createCaretAnchor,
    findCaretAnchors,
    isCaretAnchor,
    removeCaretAnchor,
} from './caretAnchor.ts'
import {locateTextOffset, semanticLength, semanticOffset, semanticText} from './semanticTextPosition.ts'

const ANCHOR = `<span ${CARET_ANCHOR_ATTRIBUTE}="" style="color: #c43c35">${CARET_ANCHOR_FILLER}</span>`

function parse(markup: string): {documentNode: Document; root: Element} {
    const parsed = new DOMParser().parseFromString(`<p>${markup}</p>`, 'application/xml')
    return {
        documentNode: parsed as unknown as Document,
        root: parsed.documentElement as unknown as Element,
    }
}

test('锚点携带标记声明与零宽填充字符', () => {
    const {documentNode} = parse('')
    const {anchor, filler} = createCaretAnchor(documentNode, 'color: #c43c35')
    assert.ok(isCaretAnchor(anchor))
    assert.equal(anchor.getAttribute('style'), 'color: #c43c35')
    assert.equal(filler.nodeValue, CARET_ANCHOR_FILLER)
    assert.equal(anchor.firstChild, filler)
})

test('锚点不计入语义文本与语义长度', () => {
    const {root} = parse(`上<br/>${ANCHOR}`)
    assert.equal(semanticText(root), '上\n')
    assert.equal(semanticLength(root), 2)
})

test('锚点内任何位置都映射到锚点起点', () => {
    const {root} = parse(`上<br/>${ANCHOR}下`)
    const anchor = findCaretAnchors(root)[0]
    const filler = anchor.firstChild as Node
    assert.equal(semanticOffset(root, anchor, 0), 2)
    assert.equal(semanticOffset(root, filler, 0), 2)
    assert.equal(semanticOffset(root, filler, 1), 2)
    // 锚点之后的文字偏移不受填充字符影响。
    const after = root.lastChild as Node
    assert.equal(semanticOffset(root, after, 1), 3)
})

test('语义偏移永远不会被定位进锚点内部，且含锚点时仍然互逆', () => {
    const {root} = parse(`上<br/>${ANCHOR}下`)
    const anchor = findCaretAnchors(root)[0]
    for (let offset = 0; offset <= semanticLength(root); offset += 1) {
        const position = locateTextOffset(root, offset)
        assert.ok(position)
        let current: Node | null = position.node
        while (current) {
            assert.notEqual(current, anchor, `偏移 ${offset} 不应落进锚点`)
            current = current.parentNode
        }
        assert.equal(semanticOffset(root, position.node, position.offset), offset)
    }
})

test('只含填充字符的锚点移除后不留痕迹', () => {
    const {root} = parse(`上${ANCHOR}`)
    removeCaretAnchor(findCaretAnchors(root)[0])
    assert.equal(findCaretAnchors(root).length, 0)
    assert.equal(semanticText(root), '上')
    assert.equal(root.textContent?.includes(CARET_ANCHOR_FILLER), false)
})

test('锚点意外含有文字时移除后保留文字，只去掉填充字符', () => {
    const {root} = parse(`<span ${CARET_ANCHOR_ATTRIBUTE}="" style="color: red">${CARET_ANCHOR_FILLER}你好</span>`)
    removeCaretAnchor(findCaretAnchors(root)[0])
    assert.equal(root.textContent, '你好')
})
