// 本测试固定公共组件本地化补丁的身份退休与引用重定向语义。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {PublicComponentDefinitionContract} from '../contracts/publicComponent.ts'
import {nodeId, sourceKey, type SourceDocument} from '../contracts/index.ts'
import {findElementsByAttribute, parseHtmlSource} from '../syntax/index.ts'
import {createPublicComponentLocalizationPatches} from './publicComponentLocalizationPatches.ts'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const COMPONENT_ID = '22222222-2222-4222-8222-222222222222'
const OLD_NODE_ID = '33333333-3333-4333-8333-333333333333'
const INSTANCE_ID = '44444444-4444-4444-8444-444444444444'
const NEW_ROOT_ID = '55555555-5555-4555-8555-555555555555'
const NEW_PARAGRAPH_ID = '66666666-6666-4666-8666-666666666666'

const definition: PublicComponentDefinitionContract = {
    componentId: COMPONENT_ID,
    revision: 1,
    html: '<section><p>静态正文</p></section>',
    css: `@layer fc-component { [data-fc-component="${COMPONENT_ID}"] { display: grid; } }`,
    propertySchema: [],
    partSchema: [],
    styleVariableSchema: [],
    assetDependencies: [],
    name: '本地化测试',
    category: '基础',
    preview: null,
    ownershipScope: {kind: 'project', id: PROJECT_ID},
}

function document(file: 'article.html' | 'style.css', content: string): SourceDocument {
    return {
        key: sourceKey('entry', file),
        content,
        contentHash: `fixture:${file}`,
        persistentRevision: 1,
    }
}

describe('公共组件本地化补丁', () => {
    it('退休实例身份并把指向实例节点的引用改指新根节点', () => {
        const html = `<div data-fc-node-id="${OLD_NODE_ID}" data-fc-node-kind="component" data-fc-component="${COMPONENT_ID}" data-fc-component-revision="latest" data-fc-instance="${INSTANCE_ID}"></div>`
        const article = document('article.html', html)
        const parsed = parseHtmlSource(html, {mode: 'fragment', scope: 'entry'})
        const element = findElementsByAttribute(parsed, 'data-fc-node-id', OLD_NODE_ID)[0]
        assert.ok(element)
        const result = createPublicComponentLocalizationPatches(
            article,
            document('style.css', ''),
            element,
            definition,
            [nodeId(NEW_ROOT_ID), nodeId(NEW_PARAGRAPH_ID)],
            [{targetObjectId: '77777777-7777-4777-8777-777777777777', targetNodeId: nodeId(OLD_NODE_ID), degraded: false}],
            [OLD_NODE_ID, INSTANCE_ID],
        )
        assert.equal(result.status, 'ready')
        if (result.status !== 'ready') return
        assert.deepEqual(result.identity.retiredNodeIds, [OLD_NODE_ID])
        assert.equal(result.identity.retiredInstanceId, INSTANCE_ID)
        assert.deepEqual(result.identity.references, [{
            targetObjectId: '77777777-7777-4777-8777-777777777777',
            targetNodeId: NEW_ROOT_ID,
            degraded: false,
        }])
    })
})
