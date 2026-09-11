/** AI 上下文提交分层和版本比较的最小回归检查。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
    buildTaskContextPayload,
    contextSubmissionVersion,
    DOCUMENT_CONTEXT_ATTRIBUTE,
    withDocumentContext,
} from '../src/features/ai-chat/lib/contextSubmission.ts'

test('参考材料与可信指令进入不同字段', () => {
    const context = buildTaskContextPayload({
        projectId: 'project-1',
        projectName: '世界一',
        entryId: 'entry-1',
        entrySnippet: '词条正文',
        systemPrompt: '使用简洁语气',
        toolAccessMode: 'reader',
        webSearchEnabled: false,
        editModeEnabled: false,
    })

    assert.equal(context.attributes?.entry_snippet, '词条正文')
    assert.equal(context.attributes?.conversation_system_prompt, undefined)
    assert.match(context.instructionAttributes?.conversation_system_prompt ?? '', /使用简洁语气/)
    assert.match(context.instructionAttributes?.ai_instructions ?? '', /所有写入类工具已被禁用/)
    assert.equal(context.flags?.read_only, true)
})

test('上下文版本与键插入顺序无关但会识别正文变化和移除', () => {
    const left = {
        attributes: {z: '3', a: '1'},
        instructionAttributes: {policy: 'same'},
        flags: {read_only: false},
    }
    const right = {
        attributes: {a: '1', z: '3'},
        instructionAttributes: {policy: 'same'},
        flags: {read_only: false},
    }
    assert.equal(contextSubmissionVersion(left), contextSubmissionVersion(right))

    const withDocument = withDocumentContext(left, '文档版本一')
    const changedDocument = withDocumentContext(left, '文档版本二')
    assert.equal(withDocument.attributes?.[DOCUMENT_CONTEXT_ATTRIBUTE], '文档版本一')
    assert.notEqual(
        contextSubmissionVersion(withDocument),
        contextSubmissionVersion(changedDocument),
    )
    assert.notEqual(contextSubmissionVersion(withDocument), contextSubmissionVersion(left))
})
