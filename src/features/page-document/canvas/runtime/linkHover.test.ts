// 本测试固定运行时悬停策略：合法链接去重，组合期、非法链接和离开只产生安全状态。

import assert from 'node:assert/strict'
import test from 'node:test'
import {createCanvasLinkHoverTracker} from './linkHover.ts'

const rect = {top: 10, left: 20, width: 80, height: 16}
const link = 'entry://018f47a2-3b4c-7d5e-8f90-123456789abc'

test('运行时只上报作者白名单 href，同一锚点的多次 mouseover 合并', () => {
    const tracker = createCanvasLinkHoverTracker()
    const anchor = {}
    assert.equal(tracker.enter(anchor, 'javascript:alert(1)', null, rect, false), null)
    assert.equal(tracker.enter(anchor, 'https://example.invalid', null, rect, true), null)
    assert.deepEqual(tracker.enter(anchor, link, null, rect, false), {type: 'link-hover', href: link, nodeId: null, rect})
    assert.equal(tracker.enter(anchor, link, null, rect, false), null)
    assert.equal(tracker.leave({}), null)
    assert.deepEqual(tracker.leave(anchor), {type: 'link-hover', href: null, nodeId: null, rect: null})
    assert.equal(tracker.leave(anchor), null)
})

test('组合期不报告链接，渲染或失焦清理当前悬停只发送一次离开', () => {
    const tracker = createCanvasLinkHoverTracker()
    const anchor = {}
    assert.equal(tracker.enter(anchor, link, null, rect, true), null)
    assert.equal(tracker.clear(), null)
    assert.ok(tracker.enter(anchor, link, null, rect, false))
    assert.deepEqual(tracker.clear(), {type: 'link-hover', href: null, nodeId: null, rect: null})
    assert.equal(tracker.clear(), null)
})
