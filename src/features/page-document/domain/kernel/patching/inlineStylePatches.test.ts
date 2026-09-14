// 本模块验证行内样式补丁只触及目标声明，并在 HTML 实体解码后遵守统一 CSS 语法。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseHtmlSource} from '../syntax/index.ts'
import {sourceKey, type SourceDocument} from '../contracts/index.ts'
import {
    createInlineStylePropertiesPatch,
    createInlineStylePropertyPatch,
} from './inlineStylePatches.ts'
import {applySourcePatches} from './sourcePatches.ts'
import {parseSourceSnapshot} from '../contracts/source.ts'

const NODE_ID = '22222222-2222-4222-8222-222222222222'

function document(content: string): SourceDocument {
    return Object.freeze({
        key: sourceKey('entry', 'article.html'),
        content,
        contentHash: 'fixture',
        persistentRevision: 1,
    })
}

function elementOf(source: SourceDocument) {
    const parsed = parseHtmlSource(source.content, {mode: 'fragment', scope: 'entry'})
    const element = parsed.elements.find(item =>
        item.attrs.some(attribute => attribute.name === 'data-fc-node-id'),
    )
    assert.ok(element)
    return element
}

function apply(documentInput: SourceDocument, property: string, value: string | null): string {
    const patch = createInlineStylePropertyPatch(
        documentInput,
        elementOf(documentInput),
        property,
        value,
    )
    assert.equal(patch.status, 'ready')
    if (patch.status !== 'ready') return documentInput.content
    const snapshot = parseSourceSnapshot({
        id: 'snapshot:inline-style',
        templateVersion: 1,
        documents: [documentInput],
    })
    const result = applySourcePatches(snapshot, [patch.patch])
    assert.equal(result.status, 'applied')
    return result.snapshot.documents[0].content
}

describe('precise inline style patches', () => {
    it('修改单一值时保留引号、注释、回退声明、实体和空白', () => {
        const source = document(
            `<p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph" style=' color:red; /* keep */ color: color(display-p3 1 0 0); font-family: &quot;Times New Roman&quot;;  border-radius:4px;  '>正文</p>`,
        )
        const result = apply(source, 'border-radius', '8px')

        assert.match(
            result,
            /style=' color:red; \/\* keep \*\/ color: color\(display-p3 1 0 0\); font-family: &quot;Times New Roman&quot;; {2}border-radius:8px; {2}'/u,
        )
    })

    it('清除目标属性不会删除同族简写或相邻方向', () => {
        const source = document(
            `<p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph" style="padding:12px; padding-top:20px; padding-bottom:30px;">正文</p>`,
        )
        const result = apply(source, 'padding-top', null)

        assert.match(result, /style="padding:12px; {2}padding-bottom:30px;"/u)
    })

    it('清除最后一个声明时一并移除空 style 属性', () => {
        const source = document(
            `<p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph" style="width:37%;">正文</p>`,
        )
        const result = apply(source, 'width', null)

        assert.doesNotMatch(result, /style=/u)
        assert.match(result, /data-fc-node-kind="paragraph">正文/u)
    })

    it('不存在 style 时只在开始标签末尾新增属性，重复值保持不变', () => {
        const source = document(
            `<p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">正文</p>`,
        )
        const result = apply(source, 'width', '37%')
        assert.match(result, /data-fc-node-kind="paragraph" style="width: 37%;">/u)

        const next = document(result)
        const repeated = createInlineStylePropertyPatch(next, elementOf(next), 'width', '37%')
        assert.equal(repeated.status, 'unchanged')
    })

    it('多属性批次重复设置相同网格位置保持不变', () => {
        const source = document(
            `<p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph" style="color: red; grid-column-start: auto; grid-column-end: auto; grid-row-start: auto; grid-row-end: auto;">正文</p>`,
        )
        const result = createInlineStylePropertiesPatch(source, elementOf(source), [
            {property: 'grid-area', value: null},
            {property: 'grid-column', value: null},
            {property: 'grid-row', value: null},
            {property: 'grid-column-start', value: 'auto'},
            {property: 'grid-column-end', value: 'auto'},
            {property: 'grid-row-start', value: 'auto'},
            {property: 'grid-row-end', value: 'auto'},
        ])

        assert.equal(result.status, 'unchanged')
    })

    it('实体解码后的非法换行字符串与样式表一样被拒绝', () => {
        const source = document(
            `<p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph" style="font-family: &quot;A&#10;B&quot;; width:37%;">正文</p>`,
        )
        const result = createInlineStylePropertyPatch(source, elementOf(source), 'width', '42%')

        assert.equal(result.status, 'rejected')
        if (result.status === 'rejected') assert.equal(result.code, 'invalid-inline-style')
    })
})
