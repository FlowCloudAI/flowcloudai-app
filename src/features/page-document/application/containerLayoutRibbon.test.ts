// 本测试从容器功能区值模型检查实际内核属性请求。
import assert from 'node:assert/strict'
import test from 'node:test'
import {utf16Range, type ComponentHandle} from '../domain/kernel/index.ts'
import {
    createContainerAlignRequest,
    createContainerColumnsRequest,
    createContainerGapRequest,
    createContainerJustifyRequest,
    createContainerLayoutRequest,
} from '../../document-editor/visual/containerLayoutRibbonModel.ts'

const NODE_ID = '11111111-1111-4111-8111-111111111111'

test('容器间距功能区发出受管 gap intent', () => {
    const request = createContainerGapRequest(NODE_ID, '1rem', 'mobile')
    const handle: ComponentHandle = {
        handleId: 'handle:container-layout' as ComponentHandle['handleId'],
        nodeId: NODE_ID as ComponentHandle['nodeId'],
        instanceId: 'instance:container-layout',
        kind: 'container',
        origin: {kind: 'author', source: {scope: 'entry', file: 'article.html'}, range: utf16Range(0, 1)},
        analysisStamp: 'analysis:container-layout' as ComponentHandle['analysisStamp'],
    }
    const intent = request.createIntents(new Map([[NODE_ID, handle]]))[0]
    assert.equal(intent?.kind, 'edit-property')
    assert.equal(intent?.property, 'gap')
    assert.deepEqual(intent?.action, {kind: 'set-value', value: '1rem'})
})

test('容器布局功能区通过绑定入口发出有限布局属性 intents', () => {
    const handle: ComponentHandle = {
        handleId: 'handle:container-layout' as ComponentHandle['handleId'],
        nodeId: NODE_ID as ComponentHandle['nodeId'],
        instanceId: 'instance:container-layout',
        kind: 'container',
        origin: {kind: 'author', source: {scope: 'entry', file: 'article.html'}, range: utf16Range(0, 1)},
        analysisStamp: 'analysis:container-layout' as ComponentHandle['analysisStamp'],
    }
    const bindings = new Map([[NODE_ID, handle]])
    const cases = [
        [createContainerLayoutRequest(NODE_ID, 'grid', 'desktop'), 'display', 'grid'],
        [createContainerColumnsRequest(NODE_ID, 'two', 'desktop'), 'grid-template-columns', 'repeat(2, minmax(0, 1fr))'],
        [createContainerAlignRequest(NODE_ID, 'center', 'desktop'), 'align-items', 'center'],
        [createContainerJustifyRequest(NODE_ID, 'space-between', 'desktop'), 'justify-content', 'space-between'],
    ] as const
    for (const [request, property, value] of cases) {
        const intent = request.createIntents(bindings)[0]
        assert.equal(intent?.kind, 'edit-property')
        assert.equal(intent?.property, property)
        assert.deepEqual(intent?.action, {kind: 'set-value', value})
    }
})
