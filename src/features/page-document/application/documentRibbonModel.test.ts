// 本测试固定功能区的收缩、页签和节点能力边界，避免界面层重复推断内核能力。

import assert from 'node:assert/strict'
import test from 'node:test'
import type {LayerProjectionNode} from '../domain/layerProjection.ts'
import {
    contextualRibbonTabForNode,
    documentRibbonDensity,
    DOCUMENT_HOME_RIBBON_GROUPS,
    DOCUMENT_HOME_RIBBON_PRIORITIES,
    homeRibbonGroupAvailability,
    resolveRibbonTab,
    ribbonGroupIsCollapsed,
    ribbonTabsForNode,
} from '../../document-editor/visual/documentRibbonModel.ts'

function node(
    kind: LayerProjectionNode['kind'],
    attributes: Record<string, string> = {},
): LayerProjectionNode {
    return {
        id: '11111111-1111-4111-8111-111111111111',
        label: kind,
        kind,
        tagName: kind === 'container' ? 'div' : null,
        attributes,
        textContent: '',
        managed: kind !== 'source',
        range: null,
        children: [],
    }
}

test('普通文字节点只显示固定创作页签，其他页签定义仍保留', () => {
    assert.deepEqual(ribbonTabsForNode(node('paragraph')), ['home', 'insert', 'page', 'view'])
    assert.equal(contextualRibbonTabForNode(node('heading')), null)
})

test('专属组件只增加对应的上下文页签', () => {
    assert.equal(contextualRibbonTabForNode(node('asset')), 'picture')
    assert.equal(contextualRibbonTabForNode(node('gallery')), 'gallery')
    assert.equal(contextualRibbonTabForNode(node('table-cell')), 'table')
    assert.equal(contextualRibbonTabForNode(node('container')), 'container')
    assert.equal(contextualRibbonTabForNode(node('list-item')), 'list')
    assert.equal(contextualRibbonTabForNode(node('divider')), 'divider')
})

test('固定根容器按页面处理且失效上下文稳定回到开始', () => {
    const root = node('container', {'data-fc-editor-root': ''})
    assert.equal(contextualRibbonTabForNode(root), null)
    assert.equal(resolveRibbonTab('container', root), 'home')
    assert.equal(resolveRibbonTab('view', root), 'view')
})

test('开始页签组顺序固定，节点能力只改变禁用原因', () => {
    assert.deepEqual(DOCUMENT_HOME_RIBBON_GROUPS, ['font', 'paragraph', 'style', 'edit', 'block'])
    assert.deepEqual(homeRibbonGroupAvailability(node('paragraph')), {
        font: null,
        paragraph: null,
        style: '当前节点不支持此组命令',
        edit: null,
        block: null,
    })
    assert.equal(homeRibbonGroupAvailability(node('heading')).style, null)
    assert.equal(homeRibbonGroupAvailability(node('asset')).paragraph, '当前节点不支持此组命令')
    assert.equal(
        homeRibbonGroupAvailability(node('container', {'data-fc-editor-root': ''})).block,
        '固定页面根不能移动或删除',
    )
    assert.equal(homeRibbonGroupAvailability(node('source')).font, '当前节点不支持此组命令')
    assert.equal(homeRibbonGroupAvailability(null).font, '先选择一个文档节点')
})

test('功能区按自身宽度收缩，并按组优先级决定折叠', () => {
    assert.equal(documentRibbonDensity(1600), 'full')
    assert.equal(documentRibbonDensity(1280), 'icons')
    assert.equal(documentRibbonDensity(1100), 'compact')
    assert.equal(documentRibbonDensity(860), 'minimal')
    assert.equal(ribbonGroupIsCollapsed('icons', 'low'), false)
    assert.equal(ribbonGroupIsCollapsed('compact', 'low'), true)
    assert.equal(ribbonGroupIsCollapsed('compact', 'normal'), false)
    assert.equal(ribbonGroupIsCollapsed('minimal', 'normal'), true)
    assert.equal(ribbonGroupIsCollapsed('minimal', 'essential'), false)
    assert.deepEqual(DOCUMENT_HOME_RIBBON_PRIORITIES, {
        font: 'essential',
        paragraph: 'high',
        style: 'low',
        edit: 'normal',
        block: 'low',
    })
})
