// 本测试固定桌面页面文档独占入口、旧正文只读转换与移动端调用边界。

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, it} from 'node:test'
import {syncEntryRelationDrafts} from '../entries/lib/entryRelationPersistence.ts'
import type {EntryRelation} from '../../api'

const featureDirectory = dirname(fileURLToPath(import.meta.url))
const source = (path: string) => readFileSync(join(featureDirectory, path), 'utf8')

describe('桌面 Markdown 退场边界', () => {
    it('词条外壳不再挂载 Markdown 编辑预览或把旧正文传入保存命令', () => {
        const editor = source('../entries/components/EntryEditor.tsx')
        assert.doesNotMatch(editor, /<MarkdownEditor\b|<EntryMarkdown(?:Toolbar|FindBar|Outline)\b|db_save_entry_bundle/u)
        assert.match(editor, /db_update_entry\(/u)
        assert.match(editor, /convertLegacyMarkdown/u)
        assert.match(editor, /editorMode === 'edit'[\s\S]*<PageDocumentEditorEntry/u)
        const save = editor.slice(editor.indexOf('const handleSave ='), editor.indexOf('useEffect(() => {', editor.indexOf('const handleSave =')))
        assert.doesNotMatch(save, /\bcontent\s*:/u)
    })

    it('移动端查看与编辑调用保持旧路径，不开启桌面临时转换', () => {
        const mobile = source('../../app/mobile/pages/MobileEntryDetailView.tsx')
        const preview = source('canvas/entry/PageDocumentCanvasEntry.tsx')
        assert.doesNotMatch(mobile, /convertLegacyMarkdown|convertMarkdownToPageDocument/u)
        assert.match(preview, /convertLegacyMarkdown = false/u)
        assert.match(preview, /markdownParagraphsToHtml\(markdown\)/u)
    })

    it('关系改用独立命令同步，删除关系不碰旧正文', async () => {
        const deleted: string[] = []
        const relation = {
            id: 'relation-1', a_id: 'entry-1', b_id: 'entry-2', relation: 'one_way', content: '',
        } as EntryRelation
        await syncEntryRelationDrafts('entry-1', 'project-1', [], {
            list: async () => [relation],
            create: async () => {throw Error('不应创建')},
            update: async () => {throw Error('不应更新')},
            delete: async id => {deleted.push(id)},
        })
        assert.deepEqual(deleted, ['relation-1'])
    })

    it('关系内容更新与新建分别走关系命令，保留既有关系身份', async () => {
        const calls: string[] = []
        const relation = {
            id: 'relation-1', a_id: 'entry-1', b_id: 'entry-2', relation: 'one_way', content: '原关系',
        } as EntryRelation
        await syncEntryRelationDrafts('entry-1', 'project-1', [
            {id: 'relation-1', otherEntryId: 'entry-2', direction: 'outgoing', content: '新关系'},
            {otherEntryId: 'entry-3', direction: 'incoming', content: '新建'},
        ], {
            list: async () => [relation],
            create: async payload => {calls.push(`create:${payload.aId}:${payload.bId}`); return relation},
            update: async payload => {calls.push(`update:${payload.id}:${payload.content}`); return relation},
            delete: async id => {calls.push(`delete:${id}`)},
        })
        assert.deepEqual(calls, ['update:relation-1:新关系', 'create:entry-3:entry-1'])
    })
})
