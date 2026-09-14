// 这些测试固定组件创建只插入定义生成的结构，并让容器初始布局与 HTML 在同一补丁批次产生。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {nodeId, parseSourceSnapshot, sourceKey, type SourceDocument} from '../contracts/index.ts'
import {findElementsByAttribute, parseHtmlSource} from '../syntax/index.ts'
import {createComponentInsertionPatches} from './componentInsertionPatches.ts'
import {applySourcePatches} from './sourcePatches.ts'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const NODE_ID = '22222222-2222-4222-8222-222222222222'
const CONTAINER_ID = '33333333-3333-4333-8333-333333333333'

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
        assert.match(html ?? '', new RegExp(`${NODE_ID}.*${CONTAINER_ID}`, 'u'))
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
})
