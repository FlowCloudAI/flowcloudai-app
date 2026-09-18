// 本测试从页面页签的真实请求构造入口检查布局写回内容。
import assert from 'node:assert/strict'
import test from 'node:test'
import {utf16Range, type ComponentHandle} from '../domain/kernel/index.ts'
import {createPageLayoutPaddingRequest} from '../../document-editor/visual/pageAndViewRibbonModel.ts'

const NODE_ID = '11111111-1111-4111-8111-111111111111'

test('页面布局页签的内距命令发出受管 padding-block-start intent', () => {
    const request = createPageLayoutPaddingRequest(NODE_ID, 1)
    const handle: ComponentHandle = {
        handleId: 'handle:page-layout' as ComponentHandle['handleId'],
        nodeId: NODE_ID as ComponentHandle['nodeId'],
        instanceId: 'instance:page-layout',
        kind: 'paragraph',
        origin: {kind: 'author', source: {scope: 'entry', file: 'article.html'}, range: utf16Range(0, 1)},
        analysisStamp: 'analysis:page-layout' as ComponentHandle['analysisStamp'],
    }
    const intent = request.createIntents(new Map([[NODE_ID, handle]]))[0]
    assert.equal(intent?.kind, 'edit-property')
    assert.equal(intent?.property, 'padding-block-start')
    assert.deepEqual(intent?.action, {kind: 'set-value', value: '1rem'})
})
