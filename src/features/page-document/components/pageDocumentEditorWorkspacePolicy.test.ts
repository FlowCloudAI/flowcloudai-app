// 这些测试锁定后台常驻编辑器不能占用共享宿主，并区分可视与只读预览的导航职责。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    shouldForwardPageDocumentNavigation,
    shouldOccupyPageDocumentSharedHost,
} from './pageDocumentEditorWorkspacePolicy.ts'

const editor = {projectId: 'project-a', entryId: 'entry-a'}
const host = {name: 'shared-host'}

describe('页面文档共享宿主独占策略', () => {
    it('非活动编辑器不 portal', () => {
        assert.equal(shouldOccupyPageDocumentSharedHost({active: false, editor, workspace: editor, host}), false)
    })

    it('entryId 不一致时不 portal', () => {
        assert.equal(shouldOccupyPageDocumentSharedHost({
            active: true,
            editor,
            workspace: {...editor, entryId: 'entry-b'},
            host,
        }), false)
    })

    it('projectId 不一致时不 portal', () => {
        assert.equal(shouldOccupyPageDocumentSharedHost({
            active: true,
            editor,
            workspace: {...editor, projectId: 'project-b'},
            host,
        }), false)
    })

    it('宿主为空时不 portal', () => {
        assert.equal(shouldOccupyPageDocumentSharedHost({active: true, editor, workspace: editor, host: null}), false)
    })

    it('活动身份与宿主都匹配时独占 portal', () => {
        assert.equal(shouldOccupyPageDocumentSharedHost({active: true, editor, workspace: editor, host}), true)
    })
})

describe('页面文档导航转交策略', () => {
    it('visual 只处理选中而不转交导航', () => {
        assert.equal(shouldForwardPageDocumentNavigation('visual'), false)
    })

    it('display 与 code 预览沿用现有导航行为', () => {
        assert.equal(shouldForwardPageDocumentNavigation('display'), true)
        assert.equal(shouldForwardPageDocumentNavigation('code'), true)
    })
})
