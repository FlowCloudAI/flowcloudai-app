// 项目打开时的页面投影维护入口契约：前端必须调用已注册的独立后端命令。
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {it} from 'node:test'

it('项目打开会调用页面投影重建 API，并保留成功与跳过数量', () => {
    const api = readFileSync(new URL('../../../api/pageDocument.ts', import.meta.url), 'utf8')
    const project = readFileSync(new URL('../../../pages/ProjectEditor.tsx', import.meta.url), 'utf8')
    assert.match(api, /invoke\('page_document_rebuild_projection', \{projectId\}\)/u)
    assert.match(api, /rebuilt: number/u)
    assert.match(api, /skippedCount: number/u)
    assert.match(project, /pageDocumentRebuildProjection\(projectId\)/u)
    assert.match(project, /report\.skippedCount/u)
})
