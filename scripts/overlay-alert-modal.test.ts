/**
 * 本测试固定 Overlay 与 Alert 嵌套时的关闭所有权，避免 window 捕获监听再次越过最上层模态。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {shouldDismissOverlay} from '../src/shared/ui/overlay/overlayDismissalModel.ts'

test('Alert 模态打开时 Overlay 让出 Esc 与背板关闭', () => {
    assert.equal(shouldDismissOverlay(true, true), false)
})

test('没有 Alert 模态时 Overlay 保持原有可关闭规则', () => {
    assert.equal(shouldDismissOverlay(true, false), true)
    assert.equal(shouldDismissOverlay(false, false), false)
})
