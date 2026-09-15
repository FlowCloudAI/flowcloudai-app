// 这些测试固定页面模式左栏的替换条件，以及返回分类时的目标和草稿确认边界。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    resolvePageDocumentSidebarReturn,
    shouldShowPageDocumentComponentTree,
} from './pageDocumentSidebarModel.ts'

describe('页面文档左栏模式', () => {
    it('活动词条处于页面模式时左栏只显示组件树', () => {
        assert.equal(shouldShowPageDocumentComponentTree('project-a', 'project-a'), true)
    })

    it('非页面模式或其他项目恢复原项目左栏', () => {
        assert.equal(shouldShowPageDocumentComponentTree(null, 'project-a'), false)
        assert.equal(shouldShowPageDocumentComponentTree('project-b', 'project-a'), false)
    })
})

describe('页面文档左栏返回分类', () => {
    it('有分类时返回词条自身分类', () => {
        assert.deepEqual(resolvePageDocumentSidebarReturn('category-a', false), {
            target: {kind: 'category', categoryId: 'category-a'},
            requiresConfirmation: false,
        })
    })

    it('无分类时返回项目根视图', () => {
        assert.deepEqual(resolvePageDocumentSidebarReturn(null, false), {
            target: {kind: 'project'},
            requiresConfirmation: false,
        })
    })

    it('草稿未保存时要求确认', () => {
        assert.equal(resolvePageDocumentSidebarReturn('category-a', true).requiresConfirmation, true)
    })
})
