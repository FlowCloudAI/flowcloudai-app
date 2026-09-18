// 本模块验证模板组合不污染解析缓存，并让项目、词条、元数据及渲染生成内容保持可追溯来源。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {serialize} from 'parse5'
import {createComponentIndex} from '../kernel/components/index.ts'
import {analysisStampId, nodeId} from '../kernel/contracts/identity.ts'
import {childNodes, getAttribute, parseHtmlSource, walkElements} from './htmlParser.ts'
import {mergeEntryTemplate} from './templateMerge.ts'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT_NODE_ID = '22222222-2222-4222-8222-222222222222'
const ENTRY_NODE_ID = '33333333-3333-4333-8333-333333333333'
const ENTRY_CONTAINER_ID = '44444444-4444-4444-8444-444444444444'
const COMPONENT_NODE_ID = '55555555-5555-4555-8555-555555555555'
const COMPONENT_INSTANCE_ID = '66666666-6666-4666-8666-666666666666'
const COMPONENT_DEFINITION_ID = '77777777-7777-4777-8777-777777777777'
const METADATA = {id: ENTRY_ID, title: '组合标题', summary: '摘要', tags: ['标签']}

function projectSource(extra = ''): string {
    return `<!doctype html>
<html data-fc-document-version="1" data-fc-template-version="1">
<head><title data-fc-bind="title"></title></head>
<body><main data-fc-slot="entry-root"><h1 data-fc-bind="title"></h1><div data-fc-slot="body"></div>${extra}</main></body>
</html>`
}

function entrySource(nodeId = ENTRY_NODE_ID): string {
    return `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1">
<template data-fc-fill="body"><p data-fc-node-id="${nodeId}" data-fc-node-kind="paragraph">词条正文</p></template>
</template>`
}

describe('template composition source mapping', () => {
    it('组合副本不污染输入 AST，并分别追溯节点、属性和绑定文本', () => {
        const project = parseHtmlSource(
            projectSource(
                `<p data-fc-node-id="${PROJECT_NODE_ID}" data-fc-node-kind="paragraph">模板正文</p>`,
            ),
            {mode: 'document', scope: 'project'},
        )
        const entry = parseHtmlSource(entrySource(), {mode: 'fragment', scope: 'entry'})
        const projectBefore = serialize(project.root)
        const entryBefore = serialize(entry.root)

        const result = mergeEntryTemplate(project, entry, METADATA)

        assert.ok(result.parsedHtml)
        assert.ok(result.composition)
        assert.equal(serialize(project.root), projectBefore)
        assert.equal(serialize(entry.root), entryBefore)
        assert.notEqual(result.composition.root, project.root)

        const elements = result.parsedHtml.elements
        const projectNode = elements.find(
            element => getAttribute(element, 'data-fc-node-id') === PROJECT_NODE_ID,
        )
        const entryNode = elements.find(
            element => getAttribute(element, 'data-fc-node-id') === ENTRY_NODE_ID,
        )
        const entryRoot = elements.find(
            element => getAttribute(element, 'data-fc-slot') === 'entry-root',
        )
        const bodySlot = elements.find(element => getAttribute(element, 'data-fc-slot') === 'body')
        const title = elements.find(
            element =>
                element.tagName === 'h1' && getAttribute(element, 'data-fc-bind') === 'title',
        )
        assert.ok(projectNode)
        assert.ok(entryNode)
        assert.ok(entryRoot)
        assert.ok(bodySlot)
        assert.ok(title)

        const sourceMap = result.composition.sourceMap
        assert.deepEqual(sourceMap.originOfNode(projectNode)?.source, {
            scope: 'project',
            file: 'article.html',
        })
        assert.deepEqual(sourceMap.originOfNode(entryNode)?.source, {
            scope: 'entry',
            file: 'article.html',
        })
        assert.equal(
            sourceMap.originOfAttribute(entryNode, 'data-fc-node-id')?.source?.scope,
            'entry',
        )
        assert.equal(
            sourceMap.originOfAttribute(entryRoot, 'data-fc-entry-id')?.kind,
            'renderer-generated',
        )
        assert.equal(sourceMap.originOfNode(childNodes(title)[0])?.kind, 'metadata-binding')
        assert.deepEqual(
            sourceMap.childListSources(bodySlot).map(item => ({
                scope: item.source.scope,
                mode: item.mode,
                tagName: item.container.tagName,
                replacesOwnChildren: item.replacesOwnChildren,
            })),
            [
                {
                    scope: 'entry',
                    mode: 'fill',
                    tagName: 'template',
                    replacesOwnChildren: true,
                },
            ],
        )
    })

    it('在同一个组合实例中检查跨项目与词条的重复组件身份', () => {
        const project = parseHtmlSource(
            projectSource(
                `<p data-fc-node-id="${ENTRY_NODE_ID}" data-fc-node-kind="paragraph">模板节点</p>`,
            ),
            {mode: 'document', scope: 'project'},
        )
        const entry = parseHtmlSource(entrySource(), {mode: 'fragment', scope: 'entry'})
        const result = mergeEntryTemplate(project, entry, METADATA)

        assert.equal(result.html, null)
        assert.equal(result.composition, null)
        assert.equal(
            result.diagnostics.some(item => item.code === 'duplicate_node_id'),
            true,
        )
    })

    it('来源映射覆盖模板 content 中的普通文本而非只覆盖托管元素', () => {
        const project = parseHtmlSource(projectSource(), {mode: 'document', scope: 'project'})
        const entry = parseHtmlSource(entrySource(), {mode: 'fragment', scope: 'entry'})
        const result = mergeEntryTemplate(project, entry, METADATA)
        assert.ok(result.composition)

        let entryTextOrigin = false
        walkElements(result.composition.root, element => {
            if (getAttribute(element, 'data-fc-node-id') !== ENTRY_NODE_ID) return
            const text = childNodes(element)[0]
            entryTextOrigin =
                result.composition?.sourceMap.originOfNode(text)?.source?.scope === 'entry'
        })
        assert.equal(entryTextOrigin, true)
    })

    it('组件索引绑定来源、父子关系和分析版本，旧句柄不能定位新快照', () => {
        const project = parseHtmlSource(projectSource(), {mode: 'document', scope: 'project'})
        const entry = parseHtmlSource(
            `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1">
<template data-fc-fill="body"><div data-fc-node-id="${ENTRY_CONTAINER_ID}" data-fc-node-kind="container"><p data-fc-node-id="${ENTRY_NODE_ID}" data-fc-node-kind="paragraph">正文</p></div></template>
</template>`,
            {mode: 'fragment', scope: 'entry'},
        )
        const result = mergeEntryTemplate(project, entry, METADATA)
        assert.ok(result.composition)

        const firstStamp = analysisStampId('analysis:first')
        const first = createComponentIndex(result.composition, {
            analysisStamp: firstStamp,
            instanceNamespace: ENTRY_ID,
        })
        const paragraph = first.query({kinds: ['paragraph'], sourceScope: 'entry'})[0]
        assert.ok(paragraph)
        assert.equal(paragraph.parentNodeId, nodeId(ENTRY_CONTAINER_ID))
        assert.deepEqual(first.bind([ENTRY_NODE_ID]).handles, [paragraph.handle])
        assert.ok(first.resolveElement(paragraph.handle))

        const second = createComponentIndex(result.composition, {
            analysisStamp: analysisStampId('analysis:second'),
            instanceNamespace: ENTRY_ID,
        })
        assert.equal(second.resolveElement(paragraph.handle), null)
    })

    it('组件索引从真实公共组件入口保留独立的节点与实例身份', () => {
        const project = parseHtmlSource(projectSource(), {mode: 'document', scope: 'project'})
        const entry = parseHtmlSource(
            `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1">
<template data-fc-fill="body"><div data-fc-node-id="${COMPONENT_NODE_ID}" data-fc-node-kind="component" data-fc-component="${COMPONENT_DEFINITION_ID}" data-fc-component-revision="latest" data-fc-instance="${COMPONENT_INSTANCE_ID}"><span data-fc-part="label">组件</span></div></template>
</template>`,
            {mode: 'fragment', scope: 'entry'},
        )
        const result = mergeEntryTemplate(project, entry, METADATA)
        assert.ok(result.composition)
        const index = createComponentIndex(result.composition, {
            analysisStamp: analysisStampId('analysis:component-identity'),
            instanceNamespace: ENTRY_ID,
        })
        const component = index.bind([COMPONENT_NODE_ID]).handles[0]
        assert.ok(component)
        assert.equal(component.instanceId, COMPONENT_INSTANCE_ID)
        assert.notEqual(component.nodeId, component.instanceId)
    })

    it('内部语义部位显式报告缺失与歧义，不把 kind 当作唯一图片证明', () => {
        const project = parseHtmlSource(projectSource(), {mode: 'document', scope: 'project'})
        const assetId = '55555555-5555-4555-8555-555555555555'
        const entry = parseHtmlSource(
            `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1">
<template data-fc-fill="body"><figure data-fc-node-id="${assetId}" data-fc-node-kind="asset"><img><img></figure></template>
</template>`,
            {mode: 'fragment', scope: 'entry'},
        )
        const result = mergeEntryTemplate(project, entry, METADATA)
        assert.ok(result.composition)
        const index = createComponentIndex(result.composition, {
            analysisStamp: analysisStampId('analysis:asset'),
            instanceNamespace: ENTRY_ID,
        })
        const asset = index.query({kinds: ['asset']})[0]
        assert.ok(asset)
        assert.deepEqual(
            asset.semanticParts.find(part => part.id === 'asset-image'),
            {
                id: 'asset-image',
                status: 'ambiguous',
                nodeCount: 2,
                reason: '语义部位 asset-image 匹配到 2 个元素。',
            },
        )
        assert.equal(index.resolveSemanticPart(asset.handle, 'asset-image')?.length, 2)
    })
})
