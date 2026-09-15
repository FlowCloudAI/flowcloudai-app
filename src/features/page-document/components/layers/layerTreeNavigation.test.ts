// 这些测试固定组件树的可见顺序和参考实现已有的方向键、首尾键及确认选择行为。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {LayerProjectionNode} from '../../domain/layerProjection.ts'
import {resolveLayerTreeKeyboardAction, visibleLayerTreeItems} from './layerTreeNavigation.ts'

function node(id: string, children: LayerProjectionNode[] = []): LayerProjectionNode {
    return {id, kind: 'container', label: id, tagName: 'div', attributes: {}, textContent: '', managed: true, range: null, children}
}

const roots = [node('a', [node('b'), node('c')]), node('d')]

describe('页面组件树键盘导航', () => {
    it('折叠父节点后可见顺序不包含其子节点', () => {
        assert.deepEqual(visibleLayerTreeItems(roots, new Set()).map(item => item.id), ['a', 'b', 'c', 'd'])
        assert.deepEqual(visibleLayerTreeItems(roots, new Set(['a'])).map(item => item.id), ['a', 'd'])
    })

    it('上下与首尾键沿当前可见顺序移动焦点', () => {
        const items = visibleLayerTreeItems(roots, new Set())
        assert.equal(resolveLayerTreeKeyboardAction(items, 'b', 'ArrowDown')?.focusId, 'c')
        assert.equal(resolveLayerTreeKeyboardAction(items, 'b', 'ArrowUp')?.focusId, 'a')
        assert.equal(resolveLayerTreeKeyboardAction(items, 'b', 'Home')?.focusId, 'a')
        assert.equal(resolveLayerTreeKeyboardAction(items, 'b', 'End')?.focusId, 'd')
    })

    it('左右键展开折叠、进入子节点或返回父节点', () => {
        const collapsed = visibleLayerTreeItems(roots, new Set(['a']))
        assert.equal(resolveLayerTreeKeyboardAction(collapsed, 'a', 'ArrowRight')?.toggleId, 'a')
        const expanded = visibleLayerTreeItems(roots, new Set())
        assert.equal(resolveLayerTreeKeyboardAction(expanded, 'a', 'ArrowRight')?.focusId, 'b')
        assert.equal(resolveLayerTreeKeyboardAction(expanded, 'b', 'ArrowLeft')?.focusId, 'a')
        assert.equal(resolveLayerTreeKeyboardAction(expanded, 'a', 'ArrowLeft')?.toggleId, 'a')
    })

    it('回车与空格只选择当前焦点节点', () => {
        const items = visibleLayerTreeItems(roots, new Set())
        assert.equal(resolveLayerTreeKeyboardAction(items, 'c', 'Enter')?.selectId, 'c')
        assert.equal(resolveLayerTreeKeyboardAction(items, 'c', ' ')?.selectId, 'c')
    })
})
