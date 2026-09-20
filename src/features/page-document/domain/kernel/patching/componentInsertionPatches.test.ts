// 这些测试固定组件创建只插入定义生成的结构，并让容器初始布局与 HTML 在同一补丁批次产生。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {createTextBlocks} from '../../engine/textBlocks.ts'
import {nodeId, parseSourceSnapshot, sourceKey, type SourceDocument} from '../contracts/index.ts'
import {elementRange, findElementsByAttribute, parseHtmlSource} from '../syntax/index.ts'
import {createComponentInsertionPatches} from './componentInsertionPatches.ts'
import {applySourcePatches} from './sourcePatches.ts'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const NODE_ID = '22222222-2222-4222-8222-222222222222'
const CONTAINER_ID = '33333333-3333-4333-8333-333333333333'
const TABLE_ID = '44444444-4444-4444-8444-444444444444'
const LIST_ID = '55555555-5555-4555-8555-555555555555'
const HEADING_ID = '66666666-6666-4666-8666-666666666666'
const TABLE_CELL_IDS = [
    '70000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000004',
    '70000000-0000-4000-8000-000000000005',
    '70000000-0000-4000-8000-000000000006',
    '70000000-0000-4000-8000-000000000007',
    '70000000-0000-4000-8000-000000000008',
    '70000000-0000-4000-8000-000000000009',
] as const

function document(file: 'article.html' | 'style.css', content: string): SourceDocument {
    return Object.freeze({
        key: sourceKey('entry', file),
        content,
        contentHash: `fixture:${file}`,
        persistentRevision: 1,
    })
}

function articleSource() {
    return `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">甲</p></template></template>`
}

function formattedArticleSource(body: string): string {
    return `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1">
  <template data-fc-fill="body">
    <div data-fc-node-id="${CONTAINER_ID}" data-fc-node-kind="container">
${body}
    </div>
  </template>
</template>`
}

function insertIntoFormattedContainer(
    kind: Parameters<typeof createComponentInsertionPatches>[4],
    newId: string,
    childIds: readonly string[],
): string {
    const article = document(
        'article.html',
        formattedArticleSource(
            `      <p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">甲</p>`,
        ),
    )
    const stylesheet = document('style.css', '')
    const parsed = parseHtmlSource(article.content, {mode: 'fragment', scope: 'entry'})
    const sourceContainer = findElementsByAttribute(parsed, 'data-fc-node-id', CONTAINER_ID)[0]
    const after = findElementsByAttribute(parsed, 'data-fc-node-id', NODE_ID)[0]
    assert.ok(sourceContainer)
    assert.ok(after)
    const planned = createComponentInsertionPatches(
        article,
        stylesheet,
        sourceContainer,
        after,
        kind,
        nodeId(newId),
        childIds.map(nodeId),
        null,
    )
    assert.equal(planned.status, 'ready')
    if (planned.status !== 'ready') return article.content
    const applied = applySourcePatches(
        parseSourceSnapshot({
            id: `snapshot:formatted-${kind}`,
            templateVersion: 1,
            documents: [article, stylesheet],
        }),
        planned.patches,
    )
    assert.equal(applied.status, 'applied')
    if (applied.status !== 'applied') return article.content
    return applied.snapshot.documents.find(item => item.key.file === 'article.html')?.content ?? ''
}

function semanticTextForNode(html: string, id: string): string | undefined {
    const parsed = parseHtmlSource(html, {mode: 'fragment', scope: 'entry'})
    const element = findElementsByAttribute(parsed, 'data-fc-node-id', id)[0]
    const range = element ? elementRange(element) : null
    if (!range) return undefined
    const fragment = parseHtmlSource(html.slice(range.from, range.to), {
        mode: 'fragment',
        scope: 'entry',
    })
    return createTextBlocks(fragment).find(block => block.nodeId === id)?.text
}

describe('component insertion patches', () => {
    it('在词条 fill 中插入容器并原子生成默认响应式布局', () => {
        const article = document('article.html', articleSource())
        const stylesheet = document('style.css', '/* keep */\n')
        const parsed = parseHtmlSource(article.content, {mode: 'fragment', scope: 'entry'})
        const sourceContainer = findElementsByAttribute(parsed, 'data-fc-fill', 'body')[0]
        const after = findElementsByAttribute(parsed, 'data-fc-node-id', NODE_ID)[0]
        assert.ok(sourceContainer)
        assert.ok(after)

        const planned = createComponentInsertionPatches(
            article,
            stylesheet,
            sourceContainer,
            after,
            'container',
            nodeId(CONTAINER_ID),
            [],
            null,
        )
        assert.equal(planned.status, 'ready')
        if (planned.status !== 'ready') return
        assert.equal(planned.patches[0]?.range.from, planned.patches[0]?.range.to)
        assert.equal(planned.patches[0]?.expected, '')
        const snapshot = parseSourceSnapshot({
            id: 'snapshot:component-insert',
            templateVersion: 1,
            documents: [article, stylesheet],
        })
        const applied = applySourcePatches(snapshot, planned.patches)
        assert.equal(applied.status, 'applied')
        const html = applied.snapshot.documents.find(
            item => item.key.file === 'article.html',
        )?.content
        const css = applied.snapshot.documents.find(item => item.key.file === 'style.css')?.content
        assert.match(html ?? '', new RegExp(`${NODE_ID}[\\s\\S]*${CONTAINER_ID}`, 'u'))
        assert.match(
            html ?? '',
            new RegExp(`\\n {2}<div[^>]+${CONTAINER_ID}[^>]*>\\n {2}</div>\\n</template>`, 'u'),
        )
        assert.match(css ?? '', /\/\* keep \*\//u)
        assert.match(css ?? '', /display: grid/u)
        assert.match(css ?? '', /gap: 1rem/u)
        assert.match(css ?? '', /@media \(min-width: 48rem\)/u)
        assert.match(css ?? '', /gap: 1\.5rem/u)
    })

    it('拒绝缺少资产及子组件身份数量错误的创建参数', () => {
        const article = document('article.html', articleSource())
        const stylesheet = document('style.css', '')
        const parsed = parseHtmlSource(article.content, {mode: 'fragment', scope: 'entry'})
        const sourceContainer = findElementsByAttribute(parsed, 'data-fc-fill', 'body')[0]
        assert.ok(sourceContainer)

        const asset = createComponentInsertionPatches(
            article,
            stylesheet,
            sourceContainer,
            null,
            'asset',
            nodeId(CONTAINER_ID),
            [],
            null,
        )
        assert.equal(asset.status, 'rejected')
        if (asset.status === 'rejected') assert.equal(asset.code, 'component-asset-required')

        const list = createComponentInsertionPatches(
            article,
            stylesheet,
            sourceContainer,
            null,
            'list',
            nodeId(CONTAINER_ID),
            [],
            null,
        )
        assert.equal(list.status, 'rejected')
        if (list.status === 'rejected') {
            assert.equal(list.code, 'component-child-identity-count-invalid')
        }
    })

    it('表格结构逐层换行缩进，单元格文字仍与标签保持同一行', () => {
        const html = insertIntoFormattedContainer('table', TABLE_ID, TABLE_CELL_IDS)
        assert.match(html, new RegExp(`\n {6}<table[^>]+${TABLE_ID}[^>]*>\n {8}<thead>\n {10}<tr>`, 'u'))
        assert.match(html, new RegExp(`\n {12}<th[^>]+${TABLE_CELL_IDS[0]}[^>]*>列 1</th>`, 'u'))
        assert.match(html, /\n {8}<tbody>\n {10}<tr>\n/u)
        assert.match(html, new RegExp(`\n {12}<td[^>]+${TABLE_CELL_IDS[3]}[^>]*>单元格</td>`, 'u'))
        assert.match(html, /\n {10}<\/tr>\n {8}<\/tbody>\n {6}<\/table>\n {4}<\/div>/u)

        assert.equal(semanticTextForNode(html, TABLE_CELL_IDS[0]), '列 1')
        assert.equal(semanticTextForNode(html, TABLE_CELL_IDS[3]), '单元格')
    })

    it('列表与空容器只在结构边界换行，列表项语义文字不增加空白', () => {
        const listItemId = TABLE_CELL_IDS[0]
        const listHtml = insertIntoFormattedContainer('list', LIST_ID, [listItemId])
        assert.match(
            listHtml,
            new RegExp(
                `\\n {6}<ul[^>]+${LIST_ID}[^>]*>\\n {8}<li[^>]+${listItemId}[^>]*>新列表项</li>\\n {6}</ul>`,
                'u',
            ),
        )
        assert.equal(semanticTextForNode(listHtml, listItemId), '新列表项')

        const containerHtml = insertIntoFormattedContainer('container', HEADING_ID, [])
        assert.match(
            containerHtml,
            new RegExp(`\\n {6}<div[^>]+${HEADING_ID}[^>]*>\\n {6}</div>`, 'u'),
        )
    })

    it('段落与标题叶子保持整行，并沿插入点的现有六格缩进写入', () => {
        const paragraphHtml = insertIntoFormattedContainer('paragraph', LIST_ID, [])
        assert.match(
            paragraphHtml,
            new RegExp(`\\n {6}<p[^>]+${LIST_ID}[^>]*>新段落</p>\\n {4}</div>`, 'u'),
        )
        const headingHtml = insertIntoFormattedContainer('heading', HEADING_ID, [])
        assert.match(
            headingHtml,
            new RegExp(`\\n {6}<h2[^>]+${HEADING_ID}[^>]*>新标题</h2>\\n {4}</div>`, 'u'),
        )
        assert.equal(semanticTextForNode(paragraphHtml, LIST_ID), '新段落')
        assert.equal(semanticTextForNode(headingHtml, HEADING_ID), '新标题')
    })

    it('列表项插入后与既有同级缩进一致，标签与文字之间不引入格式空白', () => {
        const article = document(
            'article.html',
            formattedArticleSource(
                `      <ul data-fc-node-id="${LIST_ID}" data-fc-node-kind="list">
        <li data-fc-node-id="${NODE_ID}" data-fc-node-kind="list-item">原列表项</li>
      </ul>`,
            ),
        )
        const stylesheet = document('style.css', '')
        const parsed = parseHtmlSource(article.content, {mode: 'fragment', scope: 'entry'})
        const sourceContainer = findElementsByAttribute(parsed, 'data-fc-node-id', LIST_ID)[0]
        const after = findElementsByAttribute(parsed, 'data-fc-node-id', NODE_ID)[0]
        assert.ok(sourceContainer)
        assert.ok(after)
        const planned = createComponentInsertionPatches(
            article,
            stylesheet,
            sourceContainer,
            after,
            'list-item',
            nodeId(HEADING_ID),
            [],
            null,
        )
        assert.equal(planned.status, 'ready')
        if (planned.status !== 'ready') return
        const applied = applySourcePatches(
            parseSourceSnapshot({
                id: 'snapshot:list-item-formatting',
                templateVersion: 1,
                documents: [article, stylesheet],
            }),
            planned.patches,
        )
        assert.equal(applied.status, 'applied')
        if (applied.status !== 'applied') return
        const html = applied.snapshot.documents.find(
            item => item.key.file === 'article.html',
        )?.content ?? ''
        assert.match(
            html,
            new RegExp(`\\n {8}<li[^>]+${HEADING_ID}[^>]*>新列表项</li>\\n {6}</ul>`, 'u'),
        )
        assert.equal(semanticTextForNode(html, HEADING_ID), '新列表项')
    })
})
