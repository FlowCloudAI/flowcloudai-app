// 本测试固定 AI 会话落盘契约，防止源码、额外字段或不完整消息轮次进入持久化记录。
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    parseEntryAiConversation,
    parseEntryAiConversationList,
    parseEntryAiConversationWriteRequest,
} from './aiConversationContract.ts'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ASSISTANT_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'

const messages = [
    {id: USER_ID, role: 'user' as const, content: '检查当前页面。'},
    {
        id: ASSISTANT_ID,
        role: 'assistant' as const,
        content: '检查完成。',
        result: {
            model: 'deepseek-v4-flash',
            responseId: 'response-1',
            changedScopes: [],
            tools: [],
            diagnostics: [],
            usage: {inputTokens: 2, outputTokens: 1, totalTokens: 3},
            decisionOutcome: 'confirmed' as const,
        },
    },
]

describe('AI 会话落盘契约', () => {
    it('接受完整交替轮次并拒绝源码或半轮消息', () => {
        assert.equal(parseEntryAiConversationWriteRequest({title: '页面检查', messages}).ok, true)
        assert.equal(
            parseEntryAiConversationWriteRequest({
                title: '半轮',
                messages: messages.slice(0, 1),
            }).ok,
            false,
        )
        assert.equal(
            parseEntryAiConversationWriteRequest({
                title: '含源码',
                messages,
                articleHtml: '<main />',
            }).ok,
            false,
        )
    })

    it('校验会话详情与摘要列表', () => {
        const conversation = {
            id: CONVERSATION_ID,
            entryId: USER_ID,
            title: '页面检查',
            createdAt: '2026-09-02T00:00:00.000Z',
            updatedAt: '2026-09-02T00:01:00.000Z',
            messageCount: 2,
            preview: '检查完成。',
            messages,
        }
        assert.equal(parseEntryAiConversation(conversation).ok, true)
        assert.equal(parseEntryAiConversation({...conversation, messageCount: 1}).ok, false)
        const summary = {
            id: conversation.id,
            title: conversation.title,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            messageCount: conversation.messageCount,
            preview: conversation.preview,
        }
        assert.deepEqual(parseEntryAiConversationList({conversations: [summary]}), {
            ok: true,
            value: [summary],
            issues: [],
        })
    })
})
