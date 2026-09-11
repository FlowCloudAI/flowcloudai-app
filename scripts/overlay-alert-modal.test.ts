/**
 * 本测试固定 Overlay 与 Alert 嵌套时的关闭所有权，避免 window 捕获监听再次越过最上层模态。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {canHandleMobileBack} from '../src/app/mobile/mobileBackOwnershipModel.ts'
import {shouldDismissOverlay} from '../src/shared/ui/overlay/overlayDismissalModel.ts'

test('Alert 模态打开时 Overlay 让出 Esc 与背板关闭', () => {
    assert.equal(shouldDismissOverlay(true, true), false)
})

test('没有 Alert 模态时 Overlay 保持原有可关闭规则', () => {
    assert.equal(shouldDismissOverlay(true, false), true)
    assert.equal(shouldDismissOverlay(false, false), false)
})

test('Alert 模态打开时三个移动端返回入口都让出关闭所有权', () => {
    assert.equal(canHandleMobileBack('fallback', true), false)
    assert.equal(canHandleMobileBack('predictive', true), false)
    assert.equal(canHandleMobileBack('edge-gesture', true), false)
})

test('没有 Alert 模态时三个移动端返回入口保持原有处理路径', () => {
    assert.equal(canHandleMobileBack('fallback', false), true)
    assert.equal(canHandleMobileBack('predictive', false), true)
    assert.equal(canHandleMobileBack('edge-gesture', false), true)
})
