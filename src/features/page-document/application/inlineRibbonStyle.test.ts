// 本测试固定行内工具在缺少可信选区时不产生绕过内核的请求。
import assert from 'node:assert/strict'
import test from 'node:test'
import {inlineRibbonEditAvailability} from '../../document-editor/visual/inlineRibbonStyleModel.ts'

test('行内样式缺少文字选区协议时安全禁用', () => {
    const availability = inlineRibbonEditAvailability()
    assert.equal(availability.enabled, false)
    assert.match(availability.reason, /文字选区/u)
})
