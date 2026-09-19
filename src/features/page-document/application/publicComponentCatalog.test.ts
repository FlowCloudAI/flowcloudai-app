// 本测试固定组件目录失败不阻断页面、坏记录不静默丢弃的会话边界。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {resolvePublicComponentCatalog} from './publicComponentCatalog.ts'

const VALID = {
    componentId: '11111111-1111-4111-8111-111111111111',
    revision: 1,
    html: '<article>正文</article>',
    css: '',
    propertySchema: [],
    partSchema: [],
    styleVariableSchema: [],
    assetDependencies: [],
    name: '卡片',
    category: '基础',
    preview: null,
    ownershipScope: {kind: 'project', id: '22222222-2222-4222-8222-222222222222'},
}

describe('公共组件目录降级', () => {
    it('任一组件列表调用失败时返回空目录与可见提示', () => {
        const result = resolvePublicComponentCatalog(
            {status: 'fulfilled', value: [VALID]},
            {status: 'rejected', reason: new Error('读取失败')},
        )
        assert.deepEqual(result.definitions, [])
        assert.match(result.warning ?? '', /页面文档已继续打开/u)
    })

    it('无法解析的定义被丢弃时保留合法定义并报告数量', () => {
        const result = resolvePublicComponentCatalog(
            {status: 'fulfilled', value: [VALID]},
            {status: 'fulfilled', value: [VALID, {...VALID, componentId: 'bad-id'}]},
        )
        assert.equal(result.definitions.length, 1)
        assert.match(result.warning ?? '', /1 条定义无法解析/u)
    })
})
