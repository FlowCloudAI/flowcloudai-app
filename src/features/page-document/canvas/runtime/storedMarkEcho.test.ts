import assert from 'node:assert/strict'
import test from 'node:test'
import {DOMParser} from '@xmldom/xmldom'
import type {CanvasStoredMarks} from '../protocol/index.ts'
import {
    STORED_MARK_ECHO_ATTRIBUTE,
    absorbableEchoElement,
    buildOptimisticTextFragment,
    echoInsertionPoint,
    storedMarkStyle,
} from './storedMarkEcho.ts'

function parseRoot(markup: string): {documentNode: Document; root: Element} {
    const parsed = new DOMParser().parseFromString(`<p>${markup}</p>`, 'application/xml')
    return {
        documentNode: parsed as unknown as Document,
        root: parsed.documentElement as unknown as Element,
    }
}

function marks(values: Record<string, string>): CanvasStoredMarks {
    return {styleContext: 'mobile', values} as CanvasStoredMarks
}

function serialize(node: Node): string {
    return Array.from(node.childNodes)
        .map(child => child.nodeType === 3
            ? child.textContent ?? ''
            : `<${(child as Element).tagName}${
                Array.from((child as Element).attributes ?? [])
                    .map(attribute => ` ${attribute.name}="${attribute.value}"`)
                    .join('')
            }>${serialize(child)}</${(child as Element).tagName}>`)
        .join('')
}

test('标记集序列化成稳定顺序的行内声明', () => {
    assert.equal(
        storedMarkStyle(marks({'font-weight': '700', color: '#c43c35'})),
        'color: #c43c35; font-weight: 700',
    )
    assert.equal(
        storedMarkStyle(marks({color: '  var(--fc-entry-accent) '})),
        'color: var(--fc-entry-accent)',
    )
})

test('空标记集与空取值不产生回显结构', () => {
    assert.equal(storedMarkStyle(null), null)
    assert.equal(storedMarkStyle(marks({})), null)
    assert.equal(storedMarkStyle(marks({color: '   '})), null)
})

test('无标记集时仍插入裸文本节点', () => {
    const {documentNode} = parseRoot('')
    const fragment = buildOptimisticTextFragment(documentNode, '词条', null)
    assert.equal(serialize(fragment), '词条')
})

test('带标记集时插入携带同一声明的回显元素', () => {
    const {documentNode} = parseRoot('')
    const style = storedMarkStyle(marks({color: '#c43c35'}))
    const fragment = buildOptimisticTextFragment(documentNode, '词条', style)
    assert.equal(
        serialize(fragment),
        `<span style="color: #c43c35" ${STORED_MARK_ECHO_ATTRIBUTE}="color: #c43c35">词条</span>`,
    )
})

test('换行位置产生 br，两侧各自成段', () => {
    const {documentNode} = parseRoot('')
    const fragment = buildOptimisticTextFragment(documentNode, '上\n下', null)
    assert.equal(serialize(fragment), '上<br></br>下')
})

test('插入点落在文本节点内部时没有可并入的相邻回显元素', () => {
    const {root} = parseRoot('词条')
    const textNode = root.childNodes[0] as unknown as Node
    assert.equal(echoInsertionPoint(textNode, 2), null)
    assert.deepEqual(echoInsertionPoint(textNode, 0)?.index, 0)
})

test('连续输入并入同签名的前一个回显元素', () => {
    const style = 'color: #c43c35'
    const {root} = parseRoot(`<span style="${style}" ${STORED_MARK_ECHO_ATTRIBUTE}="${style}">词</span>`)
    assert.ok(absorbableEchoElement(root as unknown as Node, 1, style))
})

test('签名不同或不是回显元素时另起一个', () => {
    const style = 'color: #c43c35'
    const other = 'color: #358257'
    const {root} = parseRoot(`<span style="${other}" ${STORED_MARK_ECHO_ATTRIBUTE}="${other}">词</span>`)
    assert.equal(absorbableEchoElement(root as unknown as Node, 1, style), null)

    const plain = parseRoot(`<span style="${style}">词</span>`)
    assert.equal(absorbableEchoElement(plain.root as unknown as Node, 1, style), null)
})

test('插入点位于首位或无标记集时不并入', () => {
    const style = 'color: #c43c35'
    const {root} = parseRoot(`<span style="${style}" ${STORED_MARK_ECHO_ATTRIBUTE}="${style}">词</span>`)
    assert.equal(absorbableEchoElement(root as unknown as Node, 0, style), null)
    assert.equal(absorbableEchoElement(root as unknown as Node, 1, null), null)
})
