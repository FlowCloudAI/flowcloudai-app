// 本测试锁定功能区“详细设置”只生成 Dock 导航状态，不产生内核写入载荷。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    createPropertyDockNavigationRequest,
    propertyDockVisualTab,
} from './propertyDockNavigation.ts'

describe('property dock navigation', () => {
    it('详细设置只定位页签与属性段', () => {
        const request = createPropertyDockNavigationRequest('layout', 'grid-layout', 'dock:grid')
        assert.deepEqual(request, {
            requestId: 'dock:grid',
            tab: 'layout',
            section: 'grid-layout',
        })
        assert.equal('createIntents' in request, false)
    })

    it('内容入口落到文字属性页且拒绝错配段落', () => {
        assert.equal(propertyDockVisualTab('content'), 'text')
        assert.throws(
            () => createPropertyDockNavigationRequest('appearance', 'grid-layout'),
            /页签与目标段不匹配/u,
        )
    })
})
