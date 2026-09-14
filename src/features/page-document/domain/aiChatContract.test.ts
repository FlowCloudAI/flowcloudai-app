// 这些测试冻结交互式 AI 的浏览器边界：严格消息顺序、草稿前置条件与工具轨迹都不能省略。
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {parseEntryAiChatRequest, parseEntryAiChatResult} from './aiChatContract.ts'

const SOURCES = {'article.html': '<template></template>', 'style.css': ''}

test('AI 对话请求必须交替并以当前 user 消息结束', () => {
    const request = {
        messages: [
            {role: 'user', content: '调整标题'},
            {role: 'assistant', content: '已调整。'},
            {role: 'user', content: '再改为蓝色'},
        ],
        draft: {
            baseRevision: 2,
            baseTemplateVersion: 1,
            baseProjectRevision: 3,
            entrySources: SOURCES,
            projectSources: SOURCES,
        },
    }
    assert.deepEqual(parseEntryAiChatRequest(request), {ok: true, value: request, issues: []})
    assert.equal(
        parseEntryAiChatRequest({...request, messages: request.messages.slice(0, 2)}).ok,
        false,
    )
    assert.equal(
        parseEntryAiChatRequest({
            ...request,
            messages: [
                {role: 'user', content: 'a'},
                {role: 'user', content: 'b'},
                {role: 'user', content: 'c'},
            ],
        }).ok,
        false,
    )
    assert.equal(
        parseEntryAiChatRequest({
            ...request,
            messages: [{role: 'user', content: 'x'.repeat(8_001)}],
        }).ok,
        false,
    )
})

test('AI 对话结果允许普通回答，也严格校验候选源码和工具轨迹', () => {
    const result = {
        provider: 'deepseek',
        apiFormat: 'openai-responses',
        model: 'deepseek-v4-flash',
        responseId: 'resp-chat',
        message: '当前页面使用两列布局。',
        draft: {entrySources: SOURCES, projectSources: SOURCES},
        changedScopes: [],
        tools: [],
        diagnostics: [],
        usage: {inputTokens: 10, outputTokens: 5, totalTokens: 15},
        pendingDecision: null,
    }
    assert.deepEqual(parseEntryAiChatResult(result), {ok: true, value: result, issues: []})
    const unchangedResult = {
        ...result,
        tools: [
            {
                callId: 'call-unchanged',
                name: 'apply_document_edit',
                scope: 'entry',
                status: 'unchanged',
                message: '当前候选已经满足此调用，无需重复修改。',
                changedFiles: [],
                diagnostics: [],
            },
        ],
    }
    assert.equal(parseEntryAiChatResult(unchangedResult).ok, true)
    const pending = {
        ...result,
        tools: [
            {
                callId: 'call-decision',
                name: 'apply_document_edit',
                scope: 'entry',
                status: 'needs-decision',
                message: '等待确认删除影响。',
                changedFiles: ['article.html'],
                diagnostics: [],
            },
        ],
        pendingDecision: {
            planId: 'ai-plan:fixture',
            impacts: [
                {
                    code: 'component-content-removed',
                    message: '将删除组件正文。',
                    requiresDecision: true,
                },
            ],
            draft: {
                entrySources: {...SOURCES, 'article.html': '<template></template><!-- removed -->'},
                projectSources: SOURCES,
            },
            changedScopes: ['entry'],
            diagnostics: [],
        },
    }
    assert.equal(parseEntryAiChatResult(pending).ok, true)
    assert.equal(
        parseEntryAiChatResult({
            ...pending,
            pendingDecision: {
                ...pending.pendingDecision,
                impacts: [
                    {
                        code: 'component-content-removed',
                        message: '将删除组件正文。',
                        requiresDecision: false,
                    },
                ],
            },
        }).ok,
        false,
    )
    assert.equal(parseEntryAiChatResult({...result, secret: 'x'}).ok, false)
    assert.equal(parseEntryAiChatResult({...result, changedScopes: ['entry', 'entry']}).ok, false)
})

test('版本化交接 fixture 的请求与响应通过同一运行时契约', () => {
    const fixture = JSON.parse(
        readFileSync(
            new URL('../../../contracts/fixtures/v1/ai-chat-turn.json', import.meta.url),
            'utf8',
        ),
    ) as {request: unknown; response: unknown}
    assert.equal(parseEntryAiChatRequest(fixture.request).ok, true)
    assert.equal(parseEntryAiChatResult(fixture.response).ok, true)
})
