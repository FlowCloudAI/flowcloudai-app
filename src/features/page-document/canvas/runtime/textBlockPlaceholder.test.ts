import assert from 'node:assert/strict'
import test from 'node:test'
import {DOMParser} from '@xmldom/xmldom'
import {CARET_ANCHOR_ATTRIBUTE, TEXT_BLOCK_PLACEHOLDER_ATTRIBUTE} from './canvasOnlyNodes.ts'
import {locateTextOffset, semanticLength, semanticOffset, semanticText} from './semanticTextPosition.ts'
import {syncTextBlockPlaceholder, syncTextBlockPlaceholders, textBlockNeedsPlaceholder} from './textBlockPlaceholder.ts'

const NODE = 'data-fc-node-id="33333333-3333-7333-8333-333333333333" data-fc-node-kind="paragraph"'
const PLACEHOLDER = `<br ${TEXT_BLOCK_PLACEHOLDER_ATTRIBUTE}=""/>`

function parse(markup: string): Element {
    return new DOMParser().parseFromString(markup, 'application/xml').documentElement as unknown as Element
}

function serialize(node: Node): string {
    return Array.from(node.childNodes).map(child => {
        if (child.nodeType === 3) return child.nodeValue ?? ''
        const element = child as Element
        const attributes = Array.from(element.attributes ?? [])
            .filter(attribute => !attribute.name.startsWith('data-fc-node'))
            .map(attribute => ` ${attribute.name}="${attribute.value}"`)
            .join('')
        return `<${element.tagName}${attributes}>${serialize(element)}</${element.tagName}>`
    }).join('')
}

test('空文本块与以换行结尾的文本块需要末行占位', () => {
    assert.equal(textBlockNeedsPlaceholder(''), true)
    assert.equal(textBlockNeedsPlaceholder('上\n'), true)
    assert.equal(textBlockNeedsPlaceholder('\n'), true)
    assert.equal(textBlockNeedsPlaceholder('上\n下'), false)
    assert.equal(textBlockNeedsPlaceholder('上'), false)
})

test('空块补一个占位，撑出一行', () => {
    const block = parse(`<p ${NODE}></p>`)
    assert.equal(syncTextBlockPlaceholder(block), true)
    assert.equal(serialize(block), `<br ${TEXT_BLOCK_PLACEHOLDER_ATTRIBUTE}=""></br>`)
    assert.equal(semanticText(block), '')
})

test('块末换行之后补占位，占位位于块的最后且位于同偏移的锚点之后', () => {
    const block = parse(`<p ${NODE}>上<span style="color: red">下<br/></span><span ${CARET_ANCHOR_ATTRIBUTE}="">\u200B</span></p>`)
    syncTextBlockPlaceholder(block)
    assert.equal(block.lastChild && (block.lastChild as Element).getAttribute(TEXT_BLOCK_PLACEHOLDER_ATTRIBUTE), '')
    assert.equal(semanticText(block), '上下\n')
    // 块末语义偏移定位在锚点与占位之前，乐观插入因此落在正确位置。
    const end = locateTextOffset(block, 3)
    assert.ok(end)
    assert.equal(end.node, block)
    assert.equal(end.offset, 2)
})

test('内容不再以换行结尾时移除占位，已一致时不改动', () => {
    const block = parse(`<p ${NODE}>上<br/>下${PLACEHOLDER}</p>`)
    assert.equal(syncTextBlockPlaceholder(block), true)
    assert.equal(serialize(block), '上<br></br>下')
    assert.equal(syncTextBlockPlaceholder(block), false)

    const ending = parse(`<p ${NODE}>上<br/>${PLACEHOLDER}</p>`)
    assert.equal(syncTextBlockPlaceholder(ending), false)
})

test('占位不计入语义文本，且含占位时偏移仍然互逆', () => {
    const block = parse(`<p ${NODE}>上<br/><br/>${PLACEHOLDER}</p>`)
    assert.equal(semanticText(block), '上\n\n')
    assert.equal(semanticLength(block), 3)
    for (let offset = 0; offset <= 3; offset += 1) {
        const position = locateTextOffset(block, offset)
        assert.ok(position)
        assert.equal(semanticOffset(block, position.node, position.offset), offset)
    }
    const placeholder = block.lastChild as Node
    assert.equal(semanticOffset(block, placeholder, 0), 3)
    assert.equal(semanticOffset(block, block, block.childNodes.length), 3)
})

test('只处理叶子文本块，不在包含文本块的外层重复补行', () => {
    const root = parse(`<div><div data-fc-node-id="44444444-4444-7444-8444-444444444444" data-fc-node-kind="table-cell"><p ${NODE}></p></div><p ${NODE.replace('3333', '5555')}>正文</p></div>`)
    syncTextBlockPlaceholders(root)
    assert.equal(
        serialize(root).replaceAll(' ', ''),
        `<div><p><br${TEXT_BLOCK_PLACEHOLDER_ATTRIBUTE}=""></br></p></div><p>正文</p>`.replaceAll(' ', ''),
    )
})
